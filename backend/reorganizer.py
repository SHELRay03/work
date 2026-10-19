# -*- coding: utf-8 -*-
"""核心逻辑：扫描源结构 / 解析剧名映射 / 生成重组计划 / 流式复制执行。

- 源文件只读，所有操作为复制；输出到源根目录同级的父文件夹。
- 合并 en + 目标语种时，输出目录保留原语种子目录结构。
- 支持两种模式：单剧模式（源目录本身含类别）与批量模式（父目录下多个编号剧集）。
"""

import re
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .lang_maps import (
    LANG_FULL,
    LANG_CHAR,
    BASE_LANG,
    CATEGORIES,
    FLAT_CATEGORIES,
    lang_sort_key,
)

CHUNK_SIZE = 1024 * 1024   # 1MB 分块流式复制
CONCURRENCY = 6            # 复制并发池大小
TEMP_PREFIX = '~$'         # Excel 临时文件前缀
CODE_RE = re.compile(r'^\d{3,}$')
DIGIT_RUN_RE = re.compile(r'\d{3,}')
# 表头词（当一行所有字段都是表头词且无编号时，判定为表头行，不计入「跳过」）
HEADER_WORDS = {'剧名', '编号', '名称', '标题', '代码', '语种', '备注', '剧集',
                '状态', '序号', 'id', 'title', 'code', 'name', 'no', 'number'}


# ============================ 扫描 ============================

def _match_category(name):
    """按关键字匹配类别，返回类别 id 或 None（按 CATEGORIES 顺序取首个命中）。"""
    for cat in CATEGORIES:
        if cat['key'] in name:
            return cat['id']
    return None


def _find_category_dirs(root):
    """扫描一级子目录，识别类别文件夹。"""
    found = {}
    for child in sorted(root.iterdir(), key=lambda p: p.name):
        if not child.is_dir():
            continue
        cid = _match_category(child.name)
        if cid and cid not in found:
            found[cid] = child
    return found


def _collect_langs(cat_dir):
    """收集类别目录下的语种代码子文件夹。"""
    langs = {}
    for child in sorted(cat_dir.iterdir(), key=lambda p: p.name):
        if child.is_dir() and child.name in LANG_FULL:
            langs[child.name] = child
    return langs


def scan(root):
    """扫描单个剧集目录，返回结构信息。"""
    root = Path(root)
    cat_map = {}
    all_langs = set()

    for cid, path in _find_category_dirs(root).items():
        entry = {'id': cid, 'name': path.name, 'path': str(path)}
        if cid in FLAT_CATEGORIES:
            entry['langs'] = None
        else:
            langs = _collect_langs(path)
            entry['langs'] = sorted(langs.keys(), key=lang_sort_key)
            all_langs.update(langs.keys())
        cat_map[cid] = entry

    xlsx = None
    for p in sorted(root.rglob('*.xlsx')):
        if not p.name.startswith(TEMP_PREFIX):
            xlsx = p
            break

    all_langs = sorted(all_langs, key=lang_sort_key)
    target_langs = [l for l in all_langs if l != BASE_LANG]

    return {
        'root': str(root),
        'cat_map': cat_map,
        'all_langs': all_langs,
        'target_langs': target_langs,
        'xlsx': str(xlsx) if xlsx else None,
    }


def _is_output_dir(path):
    """识别「重组产物父文件夹」，避免二次扫描时被误判为剧集。

    产物父文件夹含输出专有子目录：净版视频 / {简称}语压制视频 / 中文压制视频。
    """
    try:
        for child in path.iterdir():
            if child.is_dir() and (child.name == '净版视频'
                                   or child.name.endswith('压制视频')):
                return True
    except OSError:
        return False
    return False


def scan_units(root, title_map=None):
    """判断单剧/批量模式并返回剧集单元列表。

    - 若所选目录本身含类别文件夹 → 单剧模式，返回 [该目录]
    - 否则遍历其一级子目录，凡是能识别出类别且不是重组产物的即视为一个剧集单元
    返回 (mode, units, skipped_dirs)
    """
    root = Path(root)
    sr = scan(root)
    if sr['cat_map']:
        return 'single', [{'root': str(root), 'scan': sr}], []

    units = []
    skipped = []
    for child in sorted(root.iterdir(), key=lambda p: p.name):
        if not child.is_dir():
            continue
        if _is_output_dir(child):
            skipped.append(child.name)
            continue
        csr = scan(child)
        if csr['cat_map']:
            units.append({'root': str(child), 'scan': csr})
        else:
            skipped.append(child.name)
    return 'batch', units, skipped


def category_summary(sr):
    """给前端展示的类别识别结果。"""
    out = []
    for cat in CATEGORIES:
        entry = sr['cat_map'].get(cat['id'])
        out.append({
            'id': cat['id'],
            'key': cat['key'],
            'found': entry is not None,
            'folder': entry['name'] if entry else '',
            'langs': (entry['langs'] if entry else []) or [],
            'has_lang_layer': cat['id'] not in FLAT_CATEGORIES,
        })
    return out


# ============================ 剧名映射表解析 ============================

def parse_title_map(text):
    """解析多行「剧名 + 编号」表格。

    兼容：制表符或多空格分列、列顺序不固定、表头行、多余列、标题内含数字。
    返回 (rows, report)；rows 为 [{'code','title','lang'}]，lang 留空由上层猜/用户选。
    """
    rows = []
    skipped = []
    headers = 0
    seen = set()
    duplicates = []
    empty_titles = []

    for raw in (text or '').splitlines():
        line = raw.strip()
        if not line:
            continue

        # 分列：优先制表符，其次 2+ 空格
        if '\t' in raw:
            fields = [f.strip() for f in raw.split('\t')]
        elif re.search(r'\s{2,}', line):
            fields = [f.strip() for f in re.split(r'\s{2,}', line)]
        else:
            fields = [line]
        fields = [f for f in fields if f]

        # 选纯数字字段作为编号，自动适配列顺序
        code_idx = next((i for i, f in enumerate(fields) if CODE_RE.match(f)), None)

        if code_idx is not None:
            code = fields[code_idx]
            others = [f for i, f in enumerate(fields)
                      if i != code_idx and not CODE_RE.match(f)]
            # 多余列时取最长字段作为剧名（通常标题最长）
            title = max(others, key=len).strip() if others else ''
        else:
            matches = list(DIGIT_RUN_RE.finditer(line))
            if not matches:
                words = [f.lower() for f in fields]
                if len(words) >= 2 and all(w in HEADER_WORDS for w in words):
                    headers += 1
                    continue
                skipped.append({'line': raw, 'reason': '未找到编号'})
                continue
            m = matches[-1]
            code = m.group(0)
            if len(fields) >= 2:
                others = [f for f in fields if not CODE_RE.match(f)]
                title = max(others, key=len).strip() if others else ''
            else:
                title = re.sub(r'\s{2,}', ' ',
                               line[:m.start()] + ' ' + line[m.end():]).strip()

        if code in seen:
            duplicates.append(code)
            continue
        seen.add(code)

        if not title:
            empty_titles.append(code)
        rows.append({'code': code, 'title': title, 'lang': ''})

    report = {
        'parsed': len(rows),
        'skipped': len(skipped),
        'headers': headers,
        'skipped_lines': [s['line'] for s in skipped[:10]],
        'duplicates': duplicates,
        'empty_titles': empty_titles,
    }
    return rows, report


def resolve_title(root_name, title_rows):
    """按编号匹配剧名，返回 (title, lang)。

    编号 = 源目录名里能匹配到的数字串；优先精确相等，再回退子串匹配。
    """
    if not title_rows:
        return None, None
    runs = DIGIT_RUN_RE.findall(root_name)
    # 1) 精确相等优先
    for run in runs:
        for entry in title_rows:
            if str(entry.get('code', '')).strip() == run:
                return (entry.get('title', '') or '').strip(), (entry.get('lang') or None)
    # 2) 子串回退
    for entry in title_rows:
        code = str(entry.get('code', '')).strip()
        if code and code in root_name:
            return (entry.get('title', '') or '').strip(), (entry.get('lang') or None)
    return None, None


# ============================ 计划生成 ============================

def _iter_files(base):
    for p in sorted(base.rglob('*'), key=lambda x: x.as_posix()):
        if p.is_file():
            yield p, p.relative_to(base).as_posix()


def _item_whole(cid, out_name, entry):
    """整类复制（原剧、净版）：复制类别下全部内容，不区分语种。"""
    if not entry:
        return {'id': cid, 'sub': out_name, 'status': 'missing',
                'note': '类别缺失', 'ops': []}
    base = Path(entry['path'])
    ops = [{'src': str(p), 'dest': f'{out_name}/{rel}'} for p, rel in _iter_files(base)]
    status = 'ok' if ops else 'missing'
    note = '' if ops else '目录为空'
    return {'id': cid, 'sub': out_name, 'status': status, 'note': note, 'ops': ops}


def _item_lang_copy(cid, out_name, entry, langs):
    """按语种复制（保留语种子目录结构）。

    - 字幕/旁白：langs = [en, 目标语种]（合并）
    - 压制：langs = [目标语种]（仅复制该语种）
    """
    if not entry:
        return {'id': cid, 'sub': out_name, 'status': 'missing',
                'note': '类别缺失', 'ops': []}
    base = Path(entry['path'])
    have = set(entry.get('langs') or [])
    missing = [l for l in langs if l not in have]

    ops = []
    for l in langs:
        sub = base / l
        if sub.is_dir():
            for p, rel in _iter_files(sub):
                ops.append({'src': str(p), 'dest': f'{out_name}/{l}/{rel}'})

    if not ops:
        status = 'missing'
    elif missing:
        status = 'warn'
    else:
        status = 'ok'

    notes = []
    if missing:
        notes.append('缺少语种: ' + ', '.join(missing))
    if not ops:
        notes.append('无可复制内容')
    return {'id': cid, 'sub': out_name, 'status': status,
            'note': '；'.join(notes), 'ops': ops}


def dub_folder_name(lang):
    """压制文件夹命名特例：zh / zh-hant 固定为「中文压制视频」。"""
    if lang in ('zh', 'zh-hant'):
        return '中文压制视频'
    return f'{LANG_CHAR[lang]}语压制视频'


def merge_folder_name(lang, kind):
    """合并类子文件夹名：英{简称}字幕 / 英{简称}旁白。"""
    return f'英{LANG_CHAR[lang]}{kind}'


def build_plan(sr, show_name, target_langs, code=''):
    """为单个剧集、每个目标语种生成父文件夹的重组计划。"""
    root = Path(sr['root'])
    cat = sr['cat_map']
    groups = []

    for lang in target_langs:
        items = [
            _item_whole('ORIG', '原剧', cat.get('ORIG')),
            _item_whole('CLEAN', '净版视频', cat.get('CLEAN')),
            _item_lang_copy('SUB', merge_folder_name(lang, '字幕'),
                            cat.get('SUB'), [BASE_LANG, lang]),
            _item_lang_copy('VO', merge_folder_name(lang, '旁白'),
                            cat.get('VO'), [BASE_LANG, lang]),
            _item_lang_copy('DUB', dub_folder_name(lang), cat.get('DUB'), [lang]),
        ]

        xlsx = sr.get('xlsx')
        items.append({
            'id': 'XLSX',
            'sub': '本地化清单.xlsx',
            'status': 'ok' if xlsx else 'missing',
            'note': '' if xlsx else '未找到 xlsx 文件',
            'ops': [{'src': xlsx, 'dest': '本地化清单.xlsx'}] if xlsx else [],
        })

        parent_name = f"{LANG_FULL.get(lang, lang)} {show_name}".strip()
        parent_path = root.parent / parent_name
        groups.append({
            'lang': lang,
            'lang_full': LANG_FULL.get(lang, lang),
            'parent_name': parent_name,
            'parent_path': str(parent_path),
            'exists': parent_path.exists(),
            'items': items,
        })

    return {
        'root': str(root),
        'code': code,
        'show_name': show_name,
        'target_langs': target_langs,
        'groups': groups,
    }


# ============================ 执行 ============================

def _copy_one(src, dst):
    """分块流式复制；流式失败时回退整体一次性复制。"""
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(src, 'rb') as fi, open(dst, 'wb') as fo:
            while True:
                buf = fi.read(CHUNK_SIZE)
                if not buf:
                    break
                fo.write(buf)
    except Exception:
        shutil.copyfile(src, dst)


def execute(plans, conflict, state):
    """执行一个或多个剧集的重组计划，就地更新进度字典 state。

    plans: 计划列表（批量模式多个剧集）
    conflict: 'skip'（目标已存在则跳过整组）/ 'overwrite'（先删除再写入）
    单个文件失败不中断整体，错误收集到 state['errors']。
    """
    if isinstance(plans, dict):
        plans = [plans]

    lock = threading.Lock()
    unit_reports = []
    errors = []
    tasks = []

    for plan in plans:
        u_rep = {
            'root': plan['root'],
            'code': plan.get('code', ''),
            'show_name': plan['show_name'],
            'groups': [],
        }
        unit_reports.append(u_rep)

        for g in plan['groups']:
            parent = Path(g['parent_path'])
            g_rep = {
                'lang': g['lang'],
                'lang_full': g['lang_full'],
                'parent_name': g['parent_name'],
                'parent_path': g['parent_path'],
                'skipped': False,
                'items': [],
            }
            u_rep['groups'].append(g_rep)

            if parent.exists():
                if conflict == 'skip':
                    g_rep['skipped'] = True
                    for it in g['items']:
                        g_rep['items'].append({
                            'sub': it['sub'], 'status': 'skipped',
                            'count': 0, 'errors': [], 'note': '目标已存在，已跳过',
                        })
                    continue
                shutil.rmtree(parent)

            parent.mkdir(parents=True, exist_ok=True)

            for it in g['items']:
                rep = {
                    'sub': it['sub'], 'status': it['status'],
                    'count': 0, 'errors': [], 'note': it.get('note', ''),
                }
                g_rep['items'].append(rep)
                for op in it['ops']:
                    tasks.append((g_rep, rep, op))

    with lock:
        state['total'] = len(tasks)
        state['done'] = 0

    def run(task):
        g_rep, rep, op = task
        dst = Path(g_rep['parent_path']) / op['dest']
        try:
            _copy_one(op['src'], dst)
            with lock:
                rep['count'] += 1
                state['done'] += 1
                state['current'] = op['dest']
        except Exception as e:  # noqa: BLE001
            msg = f"{op['src']} -> {op['dest']}: {e}"
            with lock:
                rep['status'] = 'error'
                rep['errors'].append(msg)
                errors.append({'group': g_rep['parent_name'],
                               'sub': rep['sub'], 'message': msg})
                state['done'] += 1
                state['current'] = op['dest']

    if tasks:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            futures = [ex.submit(run, t) for t in tasks]
            for _ in as_completed(futures):
                pass

    summary = {
        'total': len(tasks),
        'copied': sum(r['count'] for u in unit_reports
                      for g in u['groups'] for r in g['items']),
        'failed': len(errors),
        'units': len(unit_reports),
        'groups': sum(len(u['groups']) for u in unit_reports),
    }

    state['reports'] = unit_reports
    state['errors'] = errors
    state['summary'] = summary
    state['current'] = ''
    state['status'] = 'done'
    return unit_reports
