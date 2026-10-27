"""FastAPI web server for subtitle toolkit."""

from __future__ import annotations

import io
import json
import threading
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import jianying as jy
from . import reorganizer as rz
from . import role_sheet as rs
from .lang_maps import BASE_LANG, CATEGORIES, LANG_CHAR, LANG_FULL, guess_lang
from .pipeline import (
    parse_hit_id_json,
    process_audit_glossary,
    process_fix_zip,
    process_replace_zip,
)
from .scan_replace import scan_replace_zip
from .srt_compare import compare_srt_zips, diffs_to_csv

APP_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = APP_ROOT / "frontend"
if not FRONTEND_DIR.exists():
    FRONTEND_DIR = APP_ROOT / "docs"

app = FastAPI(title="Subtitle Toolkit", version="0.1.0")


# ----- 统一响应格式 -----
# 所有后端接口统一返回 {"ok": bool, "data": ..., "msg": "..."}
# 前端 catch 里只判断 !data.ok 即可

def ok(data=None, msg="", **kwargs):
    """成功响应。

    三种写法都支持：
      ok(report=..., job_id=...)    → 扁平化业务字段
      ok({"report": ..., "rows": ...}) → 传入 dict，自动展开
      ok()                           → 只有 ok=True, msg=""
    """
    if isinstance(data, dict):
        # 位置参数是 dict — 展开
        payload = {"ok": True, "msg": msg, **data, **kwargs}
    elif data is None:
        payload = {"ok": True, "msg": msg, **kwargs}
    else:
        payload = {"ok": True, "msg": msg, "data": data, **kwargs}
    return payload


def fail(msg, code=400):
    """失败响应。msg 是给用户看的错误信息，code 是 HTTP 状态码。"""
    return JSONResponse({"ok": False, "msg": str(msg)}, status_code=code)


@app.middleware("http")
async def no_store(request: Request, call_next):
    """本地工具禁用缓存，避免浏览器加载到过期的静态资源。"""
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    return resp


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


def _read_frontend_text(path: Path) -> str:
    """Read HTML/CSS/JS; tolerate UTF-8 or UTF-16 (Windows editor quirk)."""
    data = path.read_bytes()
    if not data:
        return ""
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-16")


def _html_page(filename: str) -> HTMLResponse:
    path = FRONTEND_DIR / filename
    if path.exists():
        return HTMLResponse(_read_frontend_text(path))
    return HTMLResponse(f"<p>missing: {filename}</p>", status_code=404)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    path = FRONTEND_DIR / "favicon.svg"
    if path.exists():
        return FileResponse(path, media_type="image/svg+xml")
    return Response(status_code=404)


@app.get("/", response_class=HTMLResponse)
async def home():
    return _html_page("index.html")


@app.get("/replace", response_class=HTMLResponse)
async def page_replace():
    return _html_page("replace.html")


@app.get("/fix", response_class=HTMLResponse)
async def page_fix():
    return _html_page("fix.html")


@app.get("/reorganize", response_class=HTMLResponse)
async def page_reorganize():
    return _html_page("reorganize.html")


@app.get("/audit", response_class=HTMLResponse)
async def page_audit():
    return _html_page("audit.html")


@app.get("/rename", response_class=HTMLResponse)
async def page_rename():
    return _html_page("rename.html")


@app.get("/jianying", response_class=HTMLResponse)
async def page_jianying():
    return _html_page("jianying.html")


@app.get("/role-sheet", response_class=HTMLResponse)
async def page_role_sheet():
    return _html_page("role_sheet.html")


def _zip_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/scan-replace")
async def scan_replace(
    glossary: UploadFile = File(...),
    subtitles: UploadFile = File(...),
    preview: bool = Form(False),
):
    gloss_bytes = await glossary.read()
    zip_bytes = await subtitles.read()
    limit = 1 if preview else None
    return ok(scan_replace_zip(
        gloss_bytes,
        zip_bytes,
        preview_limit=limit,
    ))


@app.post("/api/replace")
async def replace_terms(
    glossary: UploadFile = File(...),
    subtitles: UploadFile = File(...),
    preview: bool = Form(False),
    also_fix: bool = Form(True),
    round_trip: bool = Form(True),
    selected_hit_ids: str = Form(""),
):
    gloss_bytes = await glossary.read()
    zip_bytes = await subtitles.read()
    limit = 1 if preview else None
    allowed = parse_hit_id_json(selected_hit_ids) if selected_hit_ids.strip() else None
    out_zip, changes_csv, conflicts_xlsx = process_replace_zip(
        gloss_bytes,
        zip_bytes,
        preview_limit=limit,
        also_fix_srt=also_fix,
        round_trip_ass=round_trip,
        allowed_hit_ids=allowed,
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        with zipfile.ZipFile(io.BytesIO(out_zip), "r") as inner:
            for name in inner.namelist():
                z.writestr(f"replaced/{name}", inner.read(name))
        z.writestr("changes.csv", changes_csv)
        z.writestr("conflicts.xlsx", conflicts_xlsx)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="replace_result.zip"'},
    )


@app.post("/api/fix-srt")
async def fix_srt(
    subtitles: UploadFile = File(...),
    round_trip: bool = Form(True),
):
    zip_bytes = await subtitles.read()
    out_zip, report_txt = process_fix_zip(
        zip_bytes,
        round_trip_ass=round_trip,
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        with zipfile.ZipFile(io.BytesIO(out_zip), "r") as inner:
            for name in inner.namelist():
                z.writestr(name, inner.read(name))
        z.writestr("fix_report.txt", report_txt)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="fix_result.zip"'},
    )


@app.post("/api/audit-glossary")
async def audit_glossary(glossary: UploadFile = File(...)):
    data = await glossary.read()
    report = process_audit_glossary(data)
    return Response(
        content=report,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="audit_report.txt"'},
    )


@app.post("/api/compare-subtitles")
async def compare_subtitles(
    manual: UploadFile = File(..., description="VS Code / 公司人工替换 ZIP"),
    toolkit: UploadFile = File(..., description="网站替换 ZIP"),
):
    manual_bytes = await manual.read()
    toolkit_bytes = await toolkit.read()
    diffs, summary = compare_srt_zips(manual_bytes, toolkit_bytes)
    rows = [
        {
            "file": d.file,
            "line_no": d.line_no,
            "timecode": d.timecode,
            "toolkit_text": d.toolkit_text,
            "manual_text": d.manual_text,
        }
        for d in diffs
    ]
    return ok({
        "summary": {
            "files_compared": summary.files_compared,
            "total_diffs": summary.total_diffs,
            "files_only_manual": summary.files_only_manual,
            "files_only_toolkit": summary.files_only_toolkit,
            "warnings": summary.warnings,
        },
        "rows": rows,
        "csv_download_hint": "Use compare page download button for ZIP export",
    })


@app.post("/api/compare-subtitles/download")
async def compare_subtitles_download(
    manual: UploadFile = File(...),
    toolkit: UploadFile = File(...),
):
    manual_bytes = await manual.read()
    toolkit_bytes = await toolkit.read()
    diffs, summary = compare_srt_zips(manual_bytes, toolkit_bytes)
    csv_bytes = diffs_to_csv(diffs)
    summary_txt = (
        f"files_compared: {summary.files_compared}\n"
        f"total_diffs: {summary.total_diffs}\n"
        f"only_in_manual: {', '.join(summary.files_only_manual) or '-'}\n"
        f"only_in_toolkit: {', '.join(summary.files_only_toolkit) or '-'}\n"
        + "".join(f"warn: {w}\n" for w in summary.warnings)
    ).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("compare_diffs.csv", csv_bytes)
        z.writestr("compare_summary.txt", summary_txt)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="compare_result.zip"'},
    )


@app.get("/api/sample-glossary")
async def sample_glossary():
    path = APP_ROOT / "samples" / "glossary_sample.xlsx"
    if path.exists():
        return FileResponse(path, filename="glossary_sample.xlsx")
    return Response(status_code=404, content="sample not found")


@app.get("/api/sample-subtitles")
async def sample_subtitles():
    path = APP_ROOT / "samples" / "subtitles_sample.zip"
    if path.exists():
        return FileResponse(path, filename="subtitles_sample.zip")
    return Response(status_code=404, content="sample not found")


# ============================ 语种重组 ============================

REORG_JOBS = {}  # job_id -> state


class ReorgScanReq(BaseModel):
    root: str
    show_name: str = ""
    title_map_text: str = ""
    lang_overrides: dict = {}


class ReorgExecReq(BaseModel):
    units: list = []
    conflict: str = "skip"


def _norm_root(value):
    return Path(str(value).strip().strip('"').strip("'"))


def _reorg_parse_rows(title_map_text, lang_overrides):
    """解析映射表并按用户选择/启发式为每行补语种。"""
    rows, report = rz.parse_title_map(title_map_text)
    overrides = lang_overrides or {}
    for row in rows:
        chosen = (overrides.get(row["code"]) or "").strip()
        row["lang"] = chosen or (guess_lang(row["title"]) or "")
    return rows, report


def _reorg_unit_payload(root_str, sr, title_rows, override=""):
    name = Path(root_str).name
    title, lang = rz.resolve_title(name, title_rows)
    show_name = (override or "").strip() or title or name
    plan = rz.build_plan(sr, show_name, sr["target_langs"], code=name)
    return {
        "root": root_str,
        "folder_name": name,
        "code": "",
        "show_name": show_name,
        "title_from_map": title or "",
        "lang_guess": lang or "",
        "categories": rz.category_summary(sr),
        "all_langs": sr["all_langs"],
        "target_langs": sr["target_langs"],
        "xlsx": sr["xlsx"],
        "plan": plan,
    }


@app.post("/api/reorganize/scan")
def reorganize_scan(req: ReorgScanReq):
    root = _norm_root(req.root)
    if not root.is_dir():
        return fail(f"源根目录不存在或不是文件夹: {root}", 400)

    title_rows, report = _reorg_parse_rows(req.title_map_text, req.lang_overrides)
    mode, units, skipped = rz.scan_units(root)

    unit_payloads = []
    for i, u in enumerate(units):
        override = req.show_name if (mode == "single" and i == 0) else ""
        unit_payloads.append(_reorg_unit_payload(u["root"], u["scan"], title_rows, override))

    return ok({
        "mode": mode,
        "root": str(root),
        "units": unit_payloads,
        "skipped_dirs": skipped,
        "title_rows": title_rows,
        "parse_report": report,
        "categories_meta": [{"id": c["id"], "key": c["key"],
                             "has_lang_layer": c["id"] not in rz.FLAT_CATEGORIES}
                            for c in CATEGORIES],
        "lang_full": LANG_FULL,
        "lang_char": LANG_CHAR,
        "base_lang": BASE_LANG,
    })


@app.post("/api/reorganize/execute")
def reorganize_execute(req: ReorgExecReq):
    if not req.units:
        return fail("没有可执行的剧集单元。", 400)

    plans = []
    for u in req.units or []:
        root = _norm_root(u.get("root", ""))
        if not root.is_dir():
            return fail(f"源目录不存在: {root}", 400)
        sr = rz.scan(root)
        target_langs = u.get("target_langs") or sr["target_langs"]
        if not target_langs:
            continue
        show_name = (u.get("show_name") or "").strip() or root.name
        plans.append(rz.build_plan(sr, show_name, target_langs, code=root.name))

    if not plans:
        return fail("所选剧集均无目标语种（除英语外），无法重组。", 400)

    job_id = uuid.uuid4().hex
    state = {
        "id": job_id, "status": "running",
        "total": 0, "done": 0, "current": "",
        "errors": [], "reports": [], "summary": None,
    }
    REORG_JOBS[job_id] = state

    def worker():
        try:
            rz.execute(plans, req.conflict, state)
        except Exception as e:  # noqa: BLE001
            state["status"] = "done"
            state["errors"].append(
                {"group": "", "sub": "", "message": f"执行异常: {e}"})

    threading.Thread(target=worker, daemon=True).start()
    return ok({"job_id": job_id})


@app.get("/api/reorganize/job/{job_id}")
def reorganize_job(job_id: str):
    state = REORG_JOBS.get(job_id)
    if not state:
        return fail("任务不存在", 404)
    return ok(state)


# ============================ 剪映草稿 ============================

@app.post("/api/jianying/generate")
async def jianying_generate(
    mode: str = Form(default="upload"),
    files: list[UploadFile] = File(default=[]),
    rels: list[str] = Form(default=[]),
    groups: list[str] = Form(default=[]),
    video_dir: str = Form(default=""),
    subtitle_dir: str = Form(default=""),
    draft_folder: str = Form(default=""),
    name_prefix: str = Form(default=""),
    subtitle_dir_en: str = Form(default=""),
    subtitle_dir_zh: str = Form(default=""),
):
    if groups and len(groups) == len(files):
        uploads = [(g or "video", rel or up.filename or "unnamed", up.file)
                   for up, rel, g in zip(files, rels, groups)]
    else:
        # 旧格式兼容：无 groups 时全部归 video
        uploads = [(rel or up.filename or "unnamed", up.file)
                   for up, rel in zip(files, rels)]
    result = jy.generate(mode, uploads, video_dir, subtitle_dir,
                         draft_folder, name_prefix,
                         subtitle_dir_en, subtitle_dir_zh)
    if "error" in result:
        return fail(result["error"], 400)
    return ok(result)


@app.post("/api/jianying/list-manifests")
async def jianying_list_manifests(draft_folder: str = Form("")):
    """列出草稿目录下所有本工具生成的分集清单，供反拆分选择。"""
    if not draft_folder.strip():
        return fail("请填写剪映草稿目录")
    try:
        items = jy.list_manifests(draft_folder.strip())
    except ValueError as e:
        return fail(str(e))
    return ok(items=items)


@app.post("/api/jianying/split-export")
async def jianying_split_export(
    srt: UploadFile = File(...),
    draft_folder: str = Form(""),
    manifest_name: str = Form(""),
    output_dir: str = Form(""),
    force: str = Form("false"),
):
    """把剪映导出的合并 SRT 按草稿分集清单反拆分为每集一个 SRT。"""
    if not output_dir.strip():
        return fail("请填写输出目录")
    if not manifest_name.strip():
        return fail("请先选择草稿清单")

    mp = Path(draft_folder.strip()) / manifest_name.strip() / jy.MANIFEST_NAME
    if not mp.is_file():
        return fail(f"未找到草稿清单：{mp}")
    try:
        manifest = json.loads(mp.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as e:
        return fail(f"清单文件解析失败：{e}")

    raw = await srt.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("gbk", errors="replace")

    is_force = force.strip().lower() in ("true", "1", "yes")
    try:
        result = jy.split_export(text, manifest, output_dir.strip(), force=is_force)
    except ValueError as e:
        return fail(str(e))

    if result.get("confirm_needed"):
        return JSONResponse(
            {"ok": False, "msg": "输出目录已存在同名文件",
             "confirm_needed": True, "existing": result["existing"]},
            status_code=409)
    return ok(result)


@app.post("/api/pick-folder")
async def pick_folder(title: str = Form("选择文件夹"), initial: str = Form("")):
    """弹出 Windows 原生文件夹选择对话框，返回用户选择的绝对路径（取消则返回空串）。

    在 FastAPI worker 主线程用 tkinter 弹窗；无显示环境（纯服务器）时返回 fail 并提示改用手动输入。
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return fail("本机缺少 tkinter，无法弹出文件夹选择框，请手动输入路径", 501)

    root = tk.Tk()
    root.withdraw()  # 不显示主窗口
    root.attributes("-topmost", True)

    # 把对话框放在前面，避免被 FastAPI 控制台盖住
    initial_dir = initial.strip()
    if initial_dir and Path(initial_dir).is_dir():
        chosen = filedialog.askdirectory(title=title, initialdir=initial_dir, parent=root)
    else:
        chosen = filedialog.askdirectory(title=title, parent=root)

    try:
        root.destroy()
    except Exception:
        pass

    if not chosen:
        return ok(path="", msg="已取消")
    return ok(path=chosen)


# ============================ 角色表转换 ============================

@app.post("/api/role-sheet/convert")
async def role_sheet_convert(
    xlsx: UploadFile = File(...),
    blank_rows: int = Form(5),
    sheet_name: str = Form("本地化清单"),
    preview_only: str = Form("false"),
    output_path: str = Form(""),
    force: str = Form("false"),
):
    import base64, re
    is_preview = preview_only.strip().lower() in ('true', '1', 'yes')
    safe_sheet = re.sub(r'[\\/:*?"<>|]', '_',
                        (sheet_name or "本地化清单").strip() or "本地化清单")
    data = await xlsx.read()
    try:
        out_bytes, report = rs.convert(
            data,
            filename=(xlsx.filename or "role_sheet"),
            blank_rows=blank_rows,
            sheet_name=(sheet_name or "本地化清单"),
            preview_only=is_preview,
        )
    except ValueError as e:
        return fail(str(e), 400)
    except RuntimeError as e:
        return fail(str(e), 500)

    if is_preview:
        return ok({"report": report})

    # 后端落盘：值以 .xlsx 结尾视为完整文件路径，否则视为文件夹（保存为 工作表名.xlsx）
    raw_out = (output_path or "").strip()
    if raw_out:
        if raw_out.lower().endswith(".xlsx"):
            out_file = Path(raw_out)
        else:
            out_file = Path(raw_out) / f"{safe_sheet}.xlsx"
        if out_file.exists() and force.strip().lower() not in ("true", "1", "yes"):
            return JSONResponse(
                {"ok": False, "msg": "目标文件已存在", "confirm_needed": True,
                 "existing": [str(out_file)]},
                status_code=409)
        try:
            out_file.parent.mkdir(parents=True, exist_ok=True)
            out_file.write_bytes(out_bytes)
            return ok({"report": report, "saved_path": str(out_file.resolve())})
        except OSError as e:
            return fail(f"无法写入 {out_file}：{e}", 400)

    # 兜底：返回 base64 让前端弹下载
    return ok({
        "report": report,
        "download_name": f"{safe_sheet}.xlsx",
        "xlsx_base64": base64.b64encode(out_bytes).decode("ascii"),
    })


# 根静态挂载：使页面中的相对资源路径（style.css、utils.js、页面间 *.html 链接）
# 在 uvicorn 下同样可用。必须放在所有路由之后，已注册路由优先匹配。
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="root-static")
