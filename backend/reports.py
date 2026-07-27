"""Export change and conflict reports."""

from __future__ import annotations

import csv
import io

from openpyxl import Workbook

from .replacer import SubtitleChange


def changes_to_csv(changes: list[SubtitleChange]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["file", "subtitle_index", "original", "replaced", "terms_hit"])
    for ch in changes:
        if ch.original != ch.replaced:
            terms = "; ".join(f"{h.source}->{h.target}" for h in ch.hits)
            writer.writerow([ch.file_name, ch.index, ch.original, ch.replaced, terms])
    return buf.getvalue().encode("utf-8-sig")


def conflicts_to_xlsx(conflict_rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "conflicts"
    headers = ["file", "subtitle_index", "text_snippet", "message"]
    ws.append(headers)
    for row in conflict_rows:
        ws.append([row.get(h, "") for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def audit_to_txt(issues: list[str]) -> bytes:
    lines = ["术语表体检报告", "=" * 40, ""]
    if not issues:
        lines.append("未发现明显问题。")
    else:
        for i, issue in enumerate(issues, 1):
            lines.append(f"{i}. {issue}")
    return "\n".join(lines).encode("utf-8")


def fix_reports_to_txt(reports: list) -> bytes:
    lines = ["SRT 修复报告", "=" * 40, ""]
    for r in reports:
        lines.append(f"## {r.file_name}")
        lines.append(f"  字幕条数: {r.event_count}")
        lines.append(f"  总时长(ms): {r.duration_ms}")
        for w in r.warnings:
            lines.append(f"  [警告] {w}")
        lines.append("")
    return "\n".join(lines).encode("utf-8")
