"""Excel glossary parser."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

import pandas as pd

COLUMN_ALIASES = {
    "source": [
        "source",
        "中文",
        "原文",
        "源文",
        "词条",
        "术语",
        "chinese",
        "zh",
        "中文词条",
        "中文原文",
        "源",
    ],
    "target": [
        "target",
        "译文",
        "英文",
        "目标语",
        "翻译",
        "english",
        "en",
        "外语",
        "外文",
        "英文译名",
        "译名",
        "替换",
        "替换为",
        "替换内容",
        "目标文本",
        "目标",
    ],
    "priority": ["priority", "优先级", "优先"],
    "match_type": ["match_type", "匹配类型", "match", "类型"],
    "block_if_longer": ["block_if_longer", "禁止短词嵌套", "block", "嵌套保护"],
    "speaker": ["speaker", "说话人", "角色"],
    "notes": ["notes", "备注", "说明", "note"],
}

SOURCE_SPLIT_RE = re.compile(r"[/\\]+")

NON_TERM_COLUMNS = {
    "gender",
    "性别",
    "intro",
    "introduction",
    "旁白",
    "人物介绍",
    "介绍",
    "说明列",
}


@dataclass
class GlossaryEntry:
    source: str
    target: str
    priority: int = 0
    match_type: str = "phrase"
    block_if_longer: bool = True
    speaker: str | None = None
    notes: str | None = None
    row_index: int = 0

    @property
    def source_len(self) -> int:
        return len(self.source)


@dataclass
class GlossaryParseResult:
    entries: list[GlossaryEntry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sheet_name: str = ""


def _normalize_header(name: str) -> str:
    return re.sub(r"\s+", "", str(name).strip().lower())


def _find_column(df, field: str):
    aliases = {_normalize_header(a) for a in COLUMN_ALIASES[field]}
    for col in df.columns:
        nh = _normalize_header(col)
        if nh in NON_TERM_COLUMNS:
            continue
        if nh in aliases:
            return col
    return None


def _pick_sheet(xl: pd.ExcelFile):
    for name in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=name, nrows=3, dtype=str)
        if _find_column(df, "source") and _find_column(df, "target"):
            return name
    return xl.sheet_names[0]


def _parse_bool(val) -> bool:
    if pd.isna(val):
        return True
    s = str(val).strip().upper()
    return s not in ("N", "NO", "0", "FALSE", "F")


def _parse_priority(val) -> int:
    if pd.isna(val):
        return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0





def _expand_sources(src: str) -> list[str]:
    parts = [p.strip() for p in SOURCE_SPLIT_RE.split(src) if p.strip()]
    return parts if parts else [src]


def load_glossary_from_excel(
    source, sheet_name=0
) -> GlossaryParseResult:
    result = GlossaryParseResult()
    xl = pd.ExcelFile(source)
    if sheet_name == 0:
        sheet_name = _pick_sheet(xl)
    result.sheet_name = str(sheet_name)
    df = pd.read_excel(xl, sheet_name=sheet_name, dtype=str)
    df = df.dropna(how="all").reset_index(drop=True)
    if df.empty:
        result.warnings.append("empty glossary")
        return result
    col_source = _find_column(df, "source")
    col_target = _find_column(df, "target")
    if not col_source or not col_target:
        result.warnings.append(
            f"missing source/target columns. found: {list(df.columns)}"
        )
        return result
    col_priority = _find_column(df, "priority")
    col_match = _find_column(df, "match_type")
    col_block = _find_column(df, "block_if_longer")
    col_speaker = _find_column(df, "speaker")
    col_notes = _find_column(df, "notes")
    
    for idx, row in df.iterrows():
        src = str(row[col_source]).strip() if pd.notna(row[col_source]) else ""
        tgt = str(row[col_target]).strip() if pd.notna(row[col_target]) else ""
        if not src:
            continue
        if not tgt:
            result.warnings.append(f"row {idx + 2}: missing target for {src}")
            continue
        mt = "phrase"
        if col_match and pd.notna(row.get(col_match)):
            m = str(row[col_match]).strip().lower()
            if m in ("phrase", "word", "regex"):
                mt = m
        parts = _expand_sources(src)
        if len(parts) > 1:
            result.warnings.append(
                f"row {idx + 2}: split '{src}' into {len(parts)} terms (same target)"
            )
        
        # ========== 【修复区域开始】 ==========
        for part in parts:
            # 1. 统一4空格缩进  2. 新增 .append() 存入词条  3. 删除多余右括号
            result.entries.append(
                GlossaryEntry(
                    source=part,
                    target=tgt,
                    priority=_parse_priority(row[col_priority]) if col_priority else 0,
                    match_type=mt,
                    block_if_longer=_parse_bool(row[col_block]) if col_block else True,
                    speaker=(
                        str(row[col_speaker]).strip()
                        if col_speaker and pd.notna(row.get(col_speaker))
                        else None
                    ),
                    notes=(
                        str(row[col_notes]).strip()
                        if col_notes and pd.notna(row.get(col_notes))
                        else None
                    ),
                    row_index=idx + 2,
                )
            )
        # ========== 【修复区域结束】 ==========

    result.entries = sort_entries(result.entries)
    return result


def sort_entries(entries: list[GlossaryEntry]) -> list[GlossaryEntry]:
    return sorted(entries, key=lambda e: (e.source_len, e.priority), reverse=True)


def audit_glossary(entries: list[GlossaryEntry]) -> list[str]:
    issues: list[str] = []
    by_source: dict[str, list[int]] = {}
    for e in entries:
        by_source.setdefault(e.source, []).append(e.row_index)
    for src, rows in by_source.items():
        if len(rows) > 1:
            issues.append(
                f"duplicate Chinese '{src}' on rows {', '.join(map(str, rows))}"
            )
    for i, a in enumerate(entries):
        for b in entries[i + 1 :]:
            if a.source != b.source and a.source in b.source:
                issues.append(
                    f"nested: short '{a.source}' (row {a.row_index}) "
                    f"inside long '{b.source}' (row {b.row_index})"
                )
    if not issues:
        issues.append(
            "no nested/duplicate issues found. "
            "Tip: duplicate = same Chinese twice; nested = short word inside longer phrase."
        )
    return issues