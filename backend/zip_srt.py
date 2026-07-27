"""Find SRT files inside ZIPs (any folder depth) and flatten output names."""

from __future__ import annotations

import zipfile
from pathlib import PurePosixPath


def list_srt_entries(zipf: zipfile.ZipFile) -> list[tuple[str, str]]:
    """
    Return (inner_path, output_name) for each .srt in zip (any depth).
    output_name is flat for writing back; duplicate basenames get parent prefix.
    """
    raw: list[tuple[str, str]] = []
    for name in zipf.namelist():
        if name.endswith("/") or not name.lower().endswith(".srt"):
            continue
        raw.append((name, PurePosixPath(name).name))

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
