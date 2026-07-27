"""Batch processing pipeline for zip in / zip out."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import PurePosixPath

from .glossary import audit_glossary, load_glossary_from_excel
from .replacer import SubtitleChange, replace_subtitle_text
from .reports import changes_to_csv, conflicts_to_xlsx
from .srt_fix import SrtFixReport, fix_srt_file, load_srt_bytes, subs_to_srt_bytes
from .srt_fix import normalize_subs
from .zip_srt import list_srt_entries


def process_replace_zip(
    glossary_bytes: bytes,
    subtitles_zip: bytes,
    *,
    preview_limit: int | None = None,
    also_fix_srt: bool = True,
    round_trip_ass: bool = True,
    allowed_hit_ids: set[str] | None = None,
) -> tuple[bytes, bytes, bytes]:
    """Returns (output_zip, changes_csv, conflicts_xlsx)."""
    gloss = load_glossary_from_excel(
        io.BytesIO(glossary_bytes)
    )
    entries = gloss.entries

    changes: list[SubtitleChange] = []
    conflict_rows: list[dict] = []
    out_buf = io.BytesIO()

    with zipfile.ZipFile(io.BytesIO(subtitles_zip), "r") as zin:
        with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as zout:
            items = list_srt_entries(zin)
            if preview_limit:
                items = items[:1]

            for inner, out_name in items:
                data = zin.read(inner)
                try:
                    subs = load_srt_bytes(data)
                except Exception:
                    zout.writestr(out_name, data)
                    continue

                for i, line in enumerate(subs):
                    if not line.text:
                        continue
                    original = line.text
                    result = replace_subtitle_text(
                        original,
                        entries,
                        allowed_hit_ids=allowed_hit_ids,
                        file_name=out_name,
                        line_index=i + 1,
                    )
                    if result.conflicts:
                        for msg in result.conflicts:
                            conflict_rows.append(
                                {
                                    "file": out_name,
                                    "subtitle_index": i + 1,
                                    "text_snippet": original[:80],
                                    "message": msg,
                                }
                            )
                    if result.text != original:
                        changes.append(
                            SubtitleChange(
                                file_name=out_name,
                                index=i + 1,
                                original=original,
                                replaced=result.text,
                                hits=result.hits,
                            )
                        )
                    line.text = result.text

                if also_fix_srt:
                    subs = normalize_subs(subs, round_trip_ass=round_trip_ass)
                out_data = subs_to_srt_bytes(subs)
                zout.writestr(out_name, out_data)

    out_buf.seek(0)
    return (
        out_buf.getvalue(),
        changes_to_csv(changes),
        conflicts_to_xlsx(conflict_rows),
    )


def process_fix_zip(
    subtitles_zip: bytes,
    *,
    round_trip_ass: bool = True,
) -> tuple[bytes, bytes]:
    """Returns (output_zip, fix_report_txt)."""
    from .reports import fix_reports_to_txt

    reports: list[SrtFixReport] = []
    out_buf = io.BytesIO()

    with zipfile.ZipFile(io.BytesIO(subtitles_zip), "r") as zin:
        with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for inner, out_name in list_srt_entries(zin):
                data = zin.read(inner)
                fixed, report = fix_srt_file(
                    data,
                    out_name,
                    round_trip_ass=round_trip_ass,
                )
                reports.append(report)
                zout.writestr(str(PurePosixPath("fixed") / out_name), fixed)

    out_buf.seek(0)
    return out_buf.getvalue(), fix_reports_to_txt(reports)


def process_audit_glossary(glossary_bytes: bytes) -> bytes:
    from .reports import audit_to_txt

    gloss = load_glossary_from_excel(io.BytesIO(glossary_bytes))
    issues = gloss.warnings + audit_glossary(gloss.entries)
    return audit_to_txt(issues)


def parse_hit_id_json(raw: str | None) -> set[str] | None:
    if not raw or not raw.strip():
        return None
    data = json.loads(raw)
    if isinstance(data, list):
        return set(str(x) for x in data)
    return None
