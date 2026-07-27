"""Scan glossary hits in subtitles and grouped results for UI."""

from __future__ import annotations

import io
import zipfile

from .glossary import load_glossary_from_excel
from .replacer import scan_subtitle_hits
from .srt_fix import load_srt_bytes
from .zip_srt import list_srt_entries


def scan_replace_zip(
    glossary_bytes: bytes,
    subtitles_zip: bytes,
    *,
    preview_limit: int | None = None,
) -> dict:
    gloss = load_glossary_from_excel(
        io.BytesIO(glossary_bytes)
    )
    entries = gloss.entries
    terms: dict[str, dict] = {}
    total_hits = 0

    with zipfile.ZipFile(io.BytesIO(subtitles_zip), "r") as zin:
        items = list_srt_entries(zin)
        if preview_limit:
            items = items[:1]

        for inner, out_name in items:
            data = zin.read(inner)
            try:
                subs = load_srt_bytes(data)
            except Exception:
                continue

            for i, line in enumerate(subs):
                if not line.text or not line.text.strip():
                    continue
                text = line.text.replace("\n", " ")
                hits, _conflicts = scan_subtitle_hits(
                    text,
                    entries,
                    file_name=out_name,
                    line_index=i + 1,
                )
                # ========== 【修复开始】==========
                # line.start 是 总毫秒数(int)，手动换算为时/分/秒/毫秒
                total_ms = line.start
                hours = total_ms // 3600000
                remain = total_ms % 3600000

                minutes = remain // 60000
                remain = remain % 60000

                seconds = remain // 1000
                milliseconds = remain % 1000

                # 拼接标准 SRT 时间码格式
                tc = f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"
                # ========== 【修复结束】==========

                for h in hits:
                    src = h["source"]
                    bucket = terms.setdefault(
                        src,
                        {
                            "source": src,
                            "target": h["target"],
                            "hits": [],
                        },
                    )
                    bucket["hits"].append(
                        {
                            "id": h["id"],
                            "file": out_name,
                            "line_no": i + 1,
                            "timecode": tc,
                            "line_text": text,
                            "snippet": h["snippet"],
                            "source": h["source"],
                            "target": h["target"],
                            "start": h["start"],
                            "end": h["end"],
                        }
                    )
                    total_hits += 1

    term_list = sorted(
        terms.values(),
        key=lambda t: (-len(t["hits"]), -len(t["source"])),
    )
    return {
        "sheet_name": gloss.sheet_name,
        "warnings": gloss.warnings,
        "term_count": len(term_list),
        "hit_count": total_hits,
        "terms": term_list,
    }