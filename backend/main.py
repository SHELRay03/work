"""FastAPI web server for subtitle toolkit."""

from __future__ import annotations

import io
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.background import BackgroundTask
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

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
    return JSONResponse(
        scan_replace_zip(
            gloss_bytes,
            zip_bytes,
            preview_limit=limit,
        )
    )


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
    return JSONResponse(
        {
            "summary": {
                "files_compared": summary.files_compared,
                "total_diffs": summary.total_diffs,
                "files_only_manual": summary.files_only_manual,
                "files_only_toolkit": summary.files_only_toolkit,
                "warnings": summary.warnings,
            },
            "rows": rows,
            "csv_download_hint": "Use compare page download button for ZIP export",
        }
    )


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


# ------- 语种重组（ZIP 进 ZIP 出） -------
_LANG_FULL = {'en': '英语', 'de': '德语', 'es': '西班牙语', 'es-BR': '西班牙语', 'ja': '日语', 'ko': '韩语', 'th': '泰语', 'fr': '法语', 'zh': '中文', 'zh-hant': '繁体中文'}
_LANG_CHAR = {'en': '英', 'de': '德', 'es': '西', 'es-BR': '西', 'ja': '日', 'ko': '韩', 'th': '泰', 'fr': '法', 'zh': '中', 'zh-hant': '中'}
_BASE_LANG = 'en'
_REORG_CATS = (('旁白', 'VO'), ('压制', 'DUB'), ('原剧', 'ORIG'), ('字幕', 'SUB'), ('净版', 'CLEAN'))


def _zip_decode_name(info: zipfile.ZipInfo) -> str:
    """解压成员名：UTF-8 标志位优先，否则 cp437→GBK/UTF-8 还原中文（Windows 压缩常见 GBK）。"""
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    raw = name.encode('cp437', errors='replace')
    for enc in ('gbk', 'utf-8'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return name


def _zip_safe_parts(name: str):
    """防 zip-slip：拒绝绝对路径与 ..，返回规范化后的路径段。"""
    name = name.replace('\\', '/')
    if name.startswith('/') or (len(name) > 1 and name[1] == ':'):
        return None
    parts = [p for p in name.split('/') if p not in ('', '.')]
    if not parts or any(p == '..' for p in parts):
        return None
    return parts


def _reorg_out_subs(lang: str):
    c = _LANG_CHAR.get(lang, lang)
    # 中文/繁中固定为「中文压制视频」，其余语种为「X语压制视频」
    dub = '中文压制视频' if lang in ('zh', 'zh-hant') else f'{c}语压制视频'
    return (
        ('ORIG', '原剧', None),
        ('CLEAN', '净版视频', None),
        ('SUB', f'英{c}字幕', (_BASE_LANG, lang)),
        ('VO', f'英{c}旁白', (_BASE_LANG, lang)),
        ('DUB', dub, (lang,)),
    )


def reorganize_zip(src_fileobj, show_name=None):
    """按语种重组 ZIP。流式复制，ZIP_STORED 免压缩提速。返回 (输出文件对象, 摘要)。"""
    src = zipfile.ZipFile(src_fileobj)
    entries = []
    for info in src.infolist():
        if info.is_dir():
            continue
        parts = _zip_safe_parts(_zip_decode_name(info))
        if parts is None:
            raise ValueError(f'压缩包内存在不安全路径：{info.filename}')
        if parts:
            entries.append((info, parts))
    if not entries:
        raise ValueError('压缩包为空或没有有效文件')

    # 剧名：全部文件在同一顶层目录 → 取该目录名；否则用传入名
    firsts = {p[0] for _, p in entries}
    if len(firsts) == 1 and not show_name:
        show = next(iter(firsts))
        depth = 1
    else:
        show = show_name or '重组输出'
        depth = 0

    cats = {}
    lang_set = set()
    xlsx = None
    for info, parts in entries:
        rel = parts[depth:]
        if not rel:
            continue
        top = rel[0]
        if xlsx is None and rel[-1].lower().endswith('.xlsx'):
            xlsx = info
        hit = next((c for k, c in _REORG_CATS if k in top), None)
        if not hit:
            continue
        cat = cats.setdefault(hit, {'name': top, 'langs': {}, 'files': []})
        rest = rel[1:]
        if not rest:
            continue
        if hit in ('VO', 'DUB', 'SUB'):
            lang = rest[0].lower()
            if lang in _LANG_FULL:
                cat['langs'].setdefault(lang, []).append((rest[1:], info))
                lang_set.add(lang)
        else:
            cat['files'].append((rest, info))

    target_langs = sorted(l for l in lang_set if l != _BASE_LANG)
    if not target_langs:
        raise ValueError('未在 旁白/压制/字幕 中找到除 en 外的语种子文件夹')

    out_file = tempfile.TemporaryFile()
    out = zipfile.ZipFile(out_file, 'w', zipfile.ZIP_STORED)
    lines = [f'剧名: {show}', f'目标语种: {", ".join(target_langs)}', '']
    warnings = []

    def _copy(dst_name, info):
        with src.open(info) as s, out.open(dst_name, 'w') as d:
            shutil.copyfileobj(s, d, 1024 * 1024)

    for lang in target_langs:
        base_out = f'{_LANG_FULL[lang]} {show}'
        lines.append(f'[{base_out}]')
        for cid, sub_name, langs_spec in _reorg_out_subs(lang):
            cat = cats.get(cid)
            if cat is None:
                lines.append(f'  跳过 {sub_name}: 源类别缺失')
                continue
            dst_root = f'{base_out}/{sub_name}'
            if langs_spec is None:
                n = 0
                for relparts, info in cat['files']:
                    if not relparts:
                        continue
                    _copy(dst_root + '/' + '/'.join(relparts), info)
                    n += 1
                lines.append(f'  复制 {sub_name}: {n} 个文件' if n else f'  跳过 {sub_name}: 源为空')
            else:
                miss = [sl for sl in langs_spec if sl not in cat['langs']]
                if miss:
                    warnings.append(f'{dst_root}: 缺少 {cat["name"]}/' + ','.join(miss))
                    lines.append(f'  跳过 {sub_name}: 缺少 {",".join(miss)}')
                for sl in langs_spec:
                    if sl not in cat['langs']:
                        continue
                    n = 0
                    for relparts, info in cat['langs'][sl]:
                        if not relparts:
                            continue
                        _copy(dst_root + '/' + sl + '/' + '/'.join(relparts), info)
                        n += 1
                    lines.append(f'  复制 {sub_name}/{sl}: {n} 个文件')
        if xlsx is not None:
            _copy(base_out + '/本地化清单.xlsx', xlsx)
            lines.append('  复制 本地化清单.xlsx')
        else:
            lines.append('  跳过 本地化清单.xlsx: 源中未找到 xlsx')
        lines.append('')

    if warnings:
        lines.append('警告:')
        lines.extend(f'  {w}' for w in warnings)
    out.writestr('重组报告.txt', '\n'.join(lines))
    out.close()
    out_file.seek(0)
    return out_file, {'show': show, 'target_langs': target_langs, 'warnings': warnings}


@app.post("/api/reorganize")
async def reorganize_api(
    subtitles: UploadFile = File(..., description="按类别组织的源 ZIP"),
    show_name: str = Form(""),
):
    out_file, summary = reorganize_zip(subtitles.file, show_name=show_name.strip() or None)
    out_name = f"{summary['show']}_重组.zip"
    return StreamingResponse(
        out_file,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"reorganized.zip\"; filename*=UTF-8''{quote(out_name)}",
            "X-Reorg-Show": quote(summary['show']),
            "X-Reorg-Langs": ','.join(summary['target_langs']),
            "X-Reorg-Warnings": quote(' | '.join(summary['warnings'])[:900]),
        },
        background=BackgroundTask(out_file.close),
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
