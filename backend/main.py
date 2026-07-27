"""FastAPI web server for subtitle toolkit."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
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
