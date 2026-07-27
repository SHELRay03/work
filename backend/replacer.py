"""Longest-match term replacement with placeholder two-phase."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .glossary import GlossaryEntry, sort_entries


@dataclass
class ReplacementHit:
    source: str
    target: str
    start: int
    end: int
    row_index: int = 0


@dataclass
class ReplaceResult:
    text: str
    hits: list[ReplacementHit] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


@dataclass
class SubtitleChange:
    file_name: str
    index: int
    original: str
    replaced: str
    hits: list[ReplacementHit] = field(default_factory=list)


def _try_add(start, end, entry, occupied, matches, conflicts, text):
    for o_start, o_end in occupied:
        if not (end <= o_start or start >= o_end):
            if entry.block_if_longer and (o_start <= start and end <= o_end):
                return
            snippet = text[max(0, start - 5) : min(len(text), end + 5)]
            conflicts.append(f"overlap:{entry.source} context=...{snippet}...")
            return
    for m_start, m_end, existing in list(matches):
        if not (end <= m_start or start >= m_end):
            if entry.source_len > existing.source_len or (
                entry.source_len == existing.source_len
                and entry.priority > existing.priority
            ):
                matches.remove((m_start, m_end, existing))
                occupied[:] = [(a, b) for a, b in occupied if (a, b) != (m_start, m_end)]
                break
            return
    matches.append((start, end, entry))
    occupied.append((start, end))


def _find_non_overlapping(text, entries):
    occupied, matches, conflicts = [], [], []
    text_lower = text.lower()
    for entry in entries:
        if entry.match_type == "regex":
            try:
                regex = re.compile(entry.source, re.IGNORECASE)
            except re.error:
                continue
            for m in regex.finditer(text):
                _try_add(m.start(), m.end(), entry, occupied, matches, conflicts, text)
        elif entry.match_type == "word":
            escaped = re.escape(entry.source)
            for m in re.finditer(
                rf"(?<![\w\u4e00-\u9fff]){escaped}(?![\w\u4e00-\u9fff])", text, re.IGNORECASE
            ):
                _try_add(m.start(), m.end(), entry, occupied, matches, conflicts, text)
        else:
            start = 0
            entry_source_lower = entry.source.lower()
            while True:
                pos = text_lower.find(entry_source_lower, start)
                if pos == -1:
                    break
                _try_add(pos, pos + len(entry.source), entry, occupied, matches, conflicts, text)
                start = pos + 1
    matches.sort(key=lambda x: x[0])
    return matches, conflicts


def make_hit_id(file_name: str, line_index: int, start: int, end: int, source: str) -> str:
    return f"{file_name}|{line_index}|{start}|{end}|{source}"


PUNCTUATION = ',.!?;:，。！？；：、"\'（）()[]{}《》<>—–-~·@#$%^&*+=|\\/'

def replace_text(
    text: str,
    entries: list[GlossaryEntry],
    *,
    allowed_hit_ids: set[str] | None = None,
    file_name: str = "",
    line_index: int = 0,
) -> ReplaceResult:
    matches, conflicts = _find_non_overlapping(text, sort_entries(entries))
    if allowed_hit_ids is not None:
        filtered = []
        for start, end, entry in matches:
            hid = make_hit_id(file_name, line_index, start, end, entry.source)
            if hid in allowed_hit_ids:
                filtered.append((start, end, entry))
        matches = filtered
    if not matches:
        return ReplaceResult(text=text, conflicts=conflicts)
    placeholders, hits, parts, cursor = {}, [], [], 0
    for i, (start, end, entry) in enumerate(matches):
        before = text[cursor:start]
        needs_space_before = len(before) > 0 and before[-1] not in PUNCTUATION and before[-1] != " "
        needs_space_after = end < len(text) and text[end] not in PUNCTUATION and text[end] != " "
        if needs_space_before:
            parts.append(before + " ")
        else:
            parts.append(before)
        key = f"__T{i:04d}__"
        placeholders[key] = entry.target
        parts.append(key)
        if needs_space_after:
            parts.append(" ")
        hits.append(
            ReplacementHit(
                entry.source, entry.target, start, end, entry.row_index
            )
        )
        cursor = end
    parts.append(text[cursor:])
    stage2 = "".join(parts)
    for key, target in placeholders.items():
        stage2 = stage2.replace(key, target)
    return ReplaceResult(text=stage2, hits=hits, conflicts=conflicts)


def replace_subtitle_text(text, entries, speaker=None, **kwargs):
    if speaker:
        combined = sort_entries(
            [e for e in entries if e.speaker is None or e.speaker == speaker]
        )
    else:
        combined = sort_entries(entries)
    return replace_text(text, combined, **kwargs)


def scan_subtitle_hits(
    text: str,
    entries: list[GlossaryEntry],
    *,
    file_name: str,
    line_index: int,
) -> tuple[list[dict], list[str]]:
    """Find all matches without applying; return hit dicts + conflicts."""
    matches, conflicts = _find_non_overlapping(text, sort_entries(entries))
    hits = []
    for start, end, entry in matches:
        hid = make_hit_id(file_name, line_index, start, end, entry.source)
        snippet = text[max(0, start - 8) : min(len(text), end + 8)]
        hits.append(
            {
                "id": hid,
                "source": entry.source,
                "target": entry.target,
                "start": start,
                "end": end,
                "snippet": snippet,
                "row_index": entry.row_index,
            }
        )
    return hits, conflicts
