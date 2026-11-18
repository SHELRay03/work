# -*- coding: utf-8 -*-
"""角色表格式转换 + 本地化清单填译。

convert:   {Gender, Name(zh), Name(en), Description(zh)} → {Gender, Source, Target, Intro, Profile}
fill:      主清单(中文Intro+空Target) + 参考清单(英文Intro+填好Target) → 合并填译
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

try:
    from openpyxl import load_workbook, Workbook
except ImportError:
    load_workbook = None
    Workbook = None


# 列名候选：按优先级匹配，命中任意一个就算该列
COLUMN_MAP = {
    'gender':  ['gender', '性别'],
    'name_zh': ['name (zh)', 'name(zh)', 'name_zh', '中文名', '中文姓名'],
    'name_en': ['name (en)', 'name(en)', 'name_en', '英文名', '英文姓名', 'english name'],
    'desc_zh': ['description (zh)', 'description(zh)', 'description', '简介', '描述', '备注', 'profile'],
    # ↓ 本地化清单专用列（与旧角色表兼容共存）
    'source':  ['source', '源词', '原词', '原文'],
    'target':  ['target', '目标词', '译词', '译文'],
    'intro':   ['intro', '角色定位', '简介标签'],
    'profile': ['profile', '人物小传', '备注'],
}

NEW_HEADERS = ['Gender', 'Source', 'Target', 'Intro', 'Profile']
DEFAULT_SHEET_TITLE = '本地化清单'


def _norm(s):
    return str(s or '').strip().lower()


def _safe_get(row, idx):
    if idx is None or idx >= len(row):
        return ''
    v = row[idx]
    return '' if v is None else str(v).strip()


# ----------------------------------------------------------------
# 读取层：xlsx / csv → 统一的 rows[[v, v, ...]] + header 位置字典
# ----------------------------------------------------------------

def _read_xlsx(src_bytes: bytes):
    if load_workbook is None:
        raise RuntimeError("缺少依赖 openpyxl：pip install openpyxl")
    wb = load_workbook(io.BytesIO(src_bytes))
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append(list(r))
    return rows


def _read_csv(src_bytes: bytes):
    # CSV 可能有 BOM（UTF-8-SIG）或 GBK；多种编码尝试
    text = None
    for enc in ('utf-8-sig', 'utf-8', 'gbk', 'gb18030'):
        try:
            text = src_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("CSV 无法识别编码，请另存为 UTF-8 或 GBK")

    # 尝试分号分隔（某些欧洲/本地化工具默认用分号）
    sample = text.splitlines()[:3]
    dialect = None
    try:
        dialect = csv.Sniffer().sniff('\n'.join(sample), delimiters='\t,;')
    except csv.Error:
        dialect = csv.excel  # 默认逗号

    rows = []
    reader = csv.reader(text.splitlines(), dialect)
    for row in reader:
        rows.append([(c if c is not None else '') for c in row])
    return rows


def _detect_format(filename: str):
    """按扩展名判断。.csv/.tsv/.txt 都按 CSV 处理，否则 xlsx。"""
    name = (filename or '').lower()
    if name.endswith(('.csv', '.tsv', '.txt')):
        return 'csv'
    return 'xlsx'  # 默认


def _read_source(src_bytes: bytes, filename: str):
    fmt = _detect_format(filename)
    if fmt == 'csv':
        return _read_csv(src_bytes)
    return _read_xlsx(src_bytes)


# ----------------------------------------------------------------
# 解析层：rows → 列索引字典
# ----------------------------------------------------------------

def _find_columns(rows):
    """扫首行（跳过空表头行）返回字段 key → 列索引。"""
    header_row = None
    for r in rows:
        if any(str(c).strip() for c in r):
            header_row = r
            break
    if header_row is None:
        return {}

    header = {}
    for col, v in enumerate(header_row):
        v_n = _norm(v)
        if not v_n:
            continue
        for key, candidates in COLUMN_MAP.items():
            if key in header:
                continue
            for cand in candidates:
                cand_n = _norm(cand)
                if cand_n == v_n or cand_n in v_n:
                    header[key] = col
                    break
    return header


# ----------------------------------------------------------------
# 主入口
# ----------------------------------------------------------------

def convert(
    src_bytes: bytes,
    filename: str = 'role_sheet.xlsx',
    blank_rows: int = 5,
    sheet_name: str = DEFAULT_SHEET_TITLE,
    preview_only: bool = False,
    preview_rows: int = 3,
):
    """转换源文件。

    preview_only=True 时只返回预览数据（前 preview_rows 条角色），不生成 xlsx。
    否则返回 (out_xlsx_bytes, report_dict)。
    """
    rows = _read_source(src_bytes, filename)
    cols = _find_columns(rows)

    missing = [k for k in ('name_zh', 'desc_zh') if k not in cols]
    if missing:
        raise ValueError(f"表头缺少必要列: {missing}（识别到的字段列: {cols}）")

    def _get(row, key):
        idx = cols.get(key)
        if idx is None or idx >= len(row):
            return ''
        return row[idx] if row[idx] is not None else ''

    # 收集全部转换后的角色数据（跳过空行）
    converted = []
    skipped = 0
    for row in rows[1:]:
        if not row or all((c is None or str(c).strip() == '') for c in row):
            skipped += 1
            continue
        converted.append({
            'gender':  _get(row, 'gender'),
            'source':  _get(row, 'name_zh'),
            'target':  '',
            'intro':   '',
            'profile': _get(row, 'desc_zh'),
        })

    report = {
        'written': len(converted),
        'skipped_blank_rows': skipped,
        'blank_rows_between': blank_rows,
        'columns_detected': cols,
        'sheet_name': sheet_name,
        'source_format': _detect_format(filename),
    }

    if preview_only:
        report['preview'] = converted[:preview_rows]
        return None, report

    # 写输出 xlsx
    if Workbook is None:
        raise RuntimeError("缺少依赖 openpyxl：pip install openpyxl")

    out = Workbook()
    ows = out.active
    ows.title = sheet_name
    ows.append(NEW_HEADERS)

    for item in converted:
        ows.append([item['gender'], item['source'], '', '', item['profile']])
        for _ in range(blank_rows):
            ows.append(['', '', '', '', ''])

    out_buf = io.BytesIO()
    out.save(out_buf)
    out_buf.seek(0)
    out_bytes = out_buf.getvalue()
    return out_bytes, report


# ----------------------------------------------------------------
# 主入口 2：本地化清单填译（主清单 + 参考清单 → 合并填译）
# ----------------------------------------------------------------

def fill_localization_checklist(
    main_bytes: bytes,
    ref_bytes: bytes,
    main_filename: str = '本地化清单.xlsx',
    ref_filename: str = '本地化清单1.xlsx',
    merge_sep: str = '/',
    sheet_name: str = DEFAULT_SHEET_TITLE,
    preview_only: bool = False,
    preview_rows: int = 5,
):
    """把主清单的空 Target 和中文 Intro 从参考清单里补全。

    主清单（本地化清单.xlsx）：Intro 有中文标签如 "女主/"，Target 为空
    参考清单（本地化清单1.xlsx）：Intro 有英文如 "Female Lead"，Target 已填好

    规则：
    1. 参考清单建 Source → {target, intro} 映射
    2. 主清单按 Source 匹配，填 Target
    3. Intro 合并：主清单 Intro 去掉末尾 "/"，加分隔符，加参考 Intro
       （只有主清单 Intro 非空时才合并）
    4. Profile 保持主清单原值不动
    """
    main_rows = _read_source(main_bytes, main_filename)
    ref_rows = _read_source(ref_bytes, ref_filename)

    main_cols = _find_columns(main_rows)
    ref_cols = _find_columns(ref_rows)

    # ---- 校验必要列 ----
    # 主清单需完整 5 列；参考清单只需 Source/Target/Intro
    # （用户常直接从 ChatGPT 粘贴三列 TSV，通常没有 Profile 列）
    main_need = {'source', 'target', 'intro', 'profile'}
    ref_need  = {'source', 'target', 'intro'}
    main_missing = main_need - set(main_cols.keys())
    ref_missing  = ref_need - set(ref_cols.keys())
    if main_missing:
        raise ValueError(f"主清单表头缺少列: {sorted(main_missing)}（识别到: {main_cols}）")
    if ref_missing:
        raise ValueError(f"参考清单表头缺少列: {sorted(ref_missing)}（识别到: {ref_cols}）")

    # ---- 从参考清单建映射 ----
    ref_map = {}
    for row in ref_rows[1:]:
        src = _safe_get(row, ref_cols.get('source'))
        if not src:
            continue
        ref_map[src] = {
            'target': _safe_get(row, ref_cols.get('target')),
            'intro':  _safe_get(row, ref_cols.get('intro')),
        }

    # ---- 遍历主清单做合并 ----
    merged = []
    matched = 0
    unmatched = 0

    for row in main_rows[1:]:
        src = _safe_get(row, main_cols.get('source'))
        gender = _safe_get(row, main_cols.get('gender'))
        profile = _safe_get(row, main_cols.get('profile'))
        main_intro = _safe_get(row, main_cols.get('intro'))
        existing_target = _safe_get(row, main_cols.get('target'))

        if not src:
            # 空行原样保留
            merged.append({
                'gender': gender, 'source': src, 'target': existing_target,
                'intro': main_intro, 'profile': profile,
            })
            continue

        m = ref_map.get(src)
        if m is None:
            unmatched += 1
            merged.append({
                'gender': gender, 'source': src, 'target': existing_target,
                'intro': main_intro, 'profile': profile,
            })
            continue

        matched += 1
        # Intro 合并：主清单非空时才做（保留末尾斜杠写法的中文标签）
        ref_intro = m['intro']
        if main_intro and ref_intro:
            cleaned = main_intro.rstrip(merge_sep).strip()
            merged_intro = f"{cleaned}{merge_sep}{ref_intro}"
        else:
            merged_intro = main_intro

        merged.append({
            'gender': gender,
            'source': src,
            'target': m['target'],
            'intro': merged_intro,
            'profile': profile,
        })

    report = {
        'matched':   matched,
        'unmatched': unmatched,
        'total_rows': len([r for r in merged if r['source']]),
        'ref_entries': len(ref_map),
        'columns_main': main_cols,
        'columns_ref':  ref_cols,
        'source_format_main': _detect_format(main_filename),
        'source_format_ref':  _detect_format(ref_filename),
    }

    if preview_only:
        report['preview'] = merged[:preview_rows]
        return None, report

    if Workbook is None:
        raise RuntimeError("缺少依赖 openpyxl：pip install openpyxl")

    out = Workbook()
    ows = out.active
    ows.title = sheet_name
    ows.append(NEW_HEADERS)

    for item in merged:
        ows.append([item['gender'], item['source'], item['target'],
                    item['intro'], item['profile']])

    out_buf = io.BytesIO()
    out.save(out_buf)
    out_buf.seek(0)
    out_bytes = out_buf.getvalue()
    return out_bytes, report
