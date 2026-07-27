"""Compare two ZIPs of SRT files (e.g. toolkit vs manual VS Code)."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from .srt_fix import load_srt_bytes


@dataclass
class SubtitleDiff:
    file: str
    line_no: int
    timecode: str
    toolkit_text: str
    manual_text: str


@dataclass
class CompareSummary:
    files_compared: int = 0
    files_only_manual: list[str] = field(default_factory=list)
    files_only_toolkit: list[str] = field(default_factory=list)
    total_diffs: int = 0
    warnings: list[str] = field(default_factory=list)


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\r", " ").strip())

# 新增：工具函数 - 将整数毫秒转换为 SRT 标准时间格式 (HH:MM:SS,mmm)
def _ms_to_srt_time(ms: int) -> str:
    total_seconds = ms // 1000
    milliseconds = ms % 1000
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

from .zip_srt import list_srt_entries


def _list_srt_map(zip_bytes: bytes) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        for inner, out_name in list_srt_entries(zf):
            out[out_name] = zf.read(inner)
    return out


def _load_events(data: bytes) -> list[tuple[int, str, str]]:
    """Return list of (line_no, timecode, text)."""
    try:
        subs = load_srt_bytes(data)
    except Exception as exc:
        raise ValueError(f"invalid srt: {exc}") from exc
    events: list[tuple[int, str, str]] = []
    for i, ev in enumerate(subs):
        text = _norm_text(ev.text.replace("\n", " "))
        if not text:
            continue
        # 修复：ev.start 是整数毫秒，调用工具函数格式化
        start = ev.start
        tc = _ms_to_srt_time(start)
        events.append((len(events) + 1, tc, text))
    return events


def compare_srt_zips(manual_zip: bytes, toolkit_zip: bytes) -> tuple[list[SubtitleDiff], CompareSummary]:
    manual_map = _list_srt_map(manual_zip)
    toolkit_map = _list_srt_map(toolkit_zip)
    summary = CompareSummary()
    diffs: list[SubtitleDiff] = []

    manual_keys = set(manual_map)
    toolkit_keys = set(toolkit_map)
    summary.files_only_manual = sorted(manual_keys - toolkit_keys)
    summary.files_only_toolkit = sorted(toolkit_keys - manual_keys)

    for key in sorted(manual_keys & toolkit_keys):
        summary.files_compared += 1
        try:
            manual_events = _load_events(manual_map[key])
            toolkit_events = _load_events(toolkit_map[key])
        except ValueError as exc:
            summary.warnings.append(f"{key}: {exc}")
            continue

        display_name = key
        max_len = max(len(manual_events), len(toolkit_events))
        if len(manual_events) != len(toolkit_events):
            summary.warnings.append(
                f"{display_name}: line count manual={len(manual_events)} "
                f"toolkit={len(toolkit_events)}"
            )

        for idx in range(max_len):
            m_txt, t_txt = "", ""
            line_no = idx + 1
            timecode = ""

            if idx < len(manual_events) and idx < len(toolkit_events):
                m_no, m_tc, m_txt = manual_events[idx]
                t_no, t_tc, t_txt = toolkit_events[idx]
                line_no = idx + 1
                timecode = m_tc if m_tc == t_tc else f"{m_tc} | {t_tc}"
            elif idx < len(manual_events):
                _, timecode, m_txt = manual_events[idx]
                t_txt = ""
            else:
                _, timecode, t_txt = toolkit_events[idx]
                m_txt = ""

            if _norm_text(m_txt) != _norm_text(t_txt):
                diffs.append(
                    SubtitleDiff(
                        file=display_name,
                        line_no=line_no,
                        timecode=timecode,
                        toolkit_text=t_txt,
                        manual_text=m_txt,
                    )
                )

    summary.total_diffs = len(diffs)
    return diffs, summary


def diffs_to_csv(diffs: list[SubtitleDiff]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["file", "line_no", "timecode", "toolkit_text", "manual_text"])
    for d in diffs:
        w.writerow([d.file, d.line_no, d.timecode, d.toolkit_text, d.manual_text])
    return buf.getvalue().encode("utf-8-sig")