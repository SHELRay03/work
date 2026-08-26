"""Find SRT files inside ZIPs (any folder depth) and flatten output names."""

from __future__ import annotations

import re
import zipfile
from pathlib import PurePosixPath


def _natural_key(name: str) -> list:
    """自然排序键：数字按数值参与比较，避免 ep10 排在 ep2 前面。"""
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", name)
    ]


def list_srt_entries(zipf: zipfile.ZipFile) -> list[tuple[str, str]]:
    """
    Return (inner_path, output_name) for each .srt in zip (any depth).
    output_name is flat for writing back; duplicate basenames get parent prefix.
    Result is sorted by inner path in natural numeric order.
    """
    raw: list[tuple[str, str]] = []
    for name in zipf.namelist():
        if name.endswith("/") or not name.lower().endswith(".srt"):
            continue
        raw.append((name, PurePosixPath(name).name))

    # 按文件名数字大小排序（ep1, ep2, ..., ep10），而非首字母（数字）顺序
    raw.sort(key=lambda item: _natural_key(item[0]))

    seen: dict[str, int] = {}
    out: list[tuple[str, str]] = []
    for inner, base in raw:
        count = seen.get(base, 0)
        seen[base] = count + 1
        if count == 0:
            out_name = base
        else:
            parent = PurePosixPath(inner).parent.name
            out_name = (
                f"{parent}_{base}"
                if parent and parent not in (".", "")
                else f"{count + 1}_{base}"
            )
        out.append((inner, out_name))
    return out
