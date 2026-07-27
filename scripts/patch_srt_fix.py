from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
content = (ROOT / "backend" / "srt_fix.py").read_text(encoding="utf-8")

NEW = r'''"""SRT batch normalization for CapCut."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import pysubs2


@dataclass
class SrtFixReport:
    file_name: str
    event_count: int = 0
    warnings: list[str] = field(default_factory=list)
    duration_ms: int = 0


def _detect_encoding(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb2312", "latin-1"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "utf-8"


def load_srt_bytes(data: bytes) -> pysubs2.SSAFile:
    enc = _detect_encoding(data)
    text = data.decode(enc, errors="replace")
    fd, path = tempfile.mkstemp(suffix=".srt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        return pysubs2.load(path, encoding="utf-8")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _wrap_line(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    chunks = []
    while len(text) > max_chars:
        chunks.append(text[:max_chars])
        text = text[max_chars:]
    if text:
        chunks.append(text)
    return "\n".join(chunks)


def _ass_round_trip(subs: pysubs2.SSAFile) -> pysubs2.SSAFile:
    fd, ap = tempfile.mkstemp(suffix=".ass")
    fd2, sp = tempfile.mkstemp(suffix=".srt")
    os.close(fd)
    os.close(fd2)
    try:
        subs.save(ap, format_="ass")
        mid = pysubs2.load(ap, encoding="utf-8")
        mid.save(sp, format_="srt")
        return pysubs2.load(sp, encoding="utf-8")
    finally:
        for p in (ap, sp):
            try:
                os.unlink(p)
            except OSError:
                pass


def normalize_subs(
    subs: pysubs2.SSAFile,
    *,
    max_chars_per_line: int = 42,
    round_trip_ass: bool = True,
) -> pysubs2.SSAFile:
    for line in subs:
        if line.text:
            t = line.text.replace("\r\n", "\n").replace("\r", "\n")
            parts = [p.strip() for p in t.split("\n") if p.strip()]
            if not parts:
                line.text = ""
                continue
            if len(parts) == 1:
                line.text = _wrap_line(parts[0], max_chars_per_line)
            else:
                line.text = "\n".join(_wrap_line(p, max_chars_per_line) for p in parts)
        if line.end <= line.start:
            line.end = line.start + 2000

    if round_trip_ass:
        subs = _ass_round_trip(subs)
    return subs


def subs_to_srt_bytes(subs: pysubs2.SSAFile) -> bytes:
    fd, path = tempfile.mkstemp(suffix=".srt")
    os.close(fd)
    try:
        subs.save(path, format_="srt")
        return Path(path).read_bytes()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def fix_srt_file(
    data: bytes,
    file_name: str,
    *,
    max_chars_per_line: int = 42,
    round_trip_ass: bool = True,
) -> tuple[bytes, SrtFixReport]:
    report = SrtFixReport(file_name=file_name)
    try:
        subs = load_srt_bytes(data)
    except Exception as e:
        report.warnings.append(f"parse error: {e}")
        return data, report

    report.event_count = len(subs)
    for i, line in enumerate(subs):
        if not line.text or not line.text.strip():
            report.warnings.append(f"event {i + 1}: empty text")
        dur = line.end - line.start
        if dur > 7000:
            report.warnings.append(f"event {i + 1}: duration {dur}ms > 7s")
        if i > 0 and line.start < subs[i - 1].end:
            report.warnings.append(f"event {i + 1}: overlaps previous")

    subs = normalize_subs(
        subs,
        max_chars_per_line=max_chars_per_line,
        round_trip_ass=round_trip_ass,
    )
    if subs:
        report.duration_ms = subs[-1].end
    return subs_to_srt_bytes(subs), report
'''

(ROOT / "backend" / "srt_fix.py").write_text(NEW, encoding="utf-8")
print("srt_fix rewritten")
