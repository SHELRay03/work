# -*- coding: utf-8 -*-
"""语种常量表与「标题语种」启发式识别。

语种代码表固定，不可自造。
"""

import re

# 语种代码 -> 全名（用于父文件夹命名，如「德语 剧名」）
LANG_FULL = {
    'en': '英语',
    'de': '德语',
    'es': '西班牙语',
    'es-BR': '西班牙语',
    'ja': '日语',
    'ko': '韩语',
    'th': '泰语',
    'fr': '法语',
    'zh': '中文',
    'zh-hant': '繁体中文',
}

# 语种代码 -> 单字简称（用于拼接输出子文件夹名，如「英德字幕」）
LANG_CHAR = {
    'en': '英',
    'de': '德',
    'es': '西',
    'es-BR': '西',
    'ja': '日',
    'ko': '韩',
    'th': '泰',
    'fr': '法',
    'zh': '中',
    'zh-hant': '中',
}

BASE_LANG = 'en'

# 固定排序顺序
LANG_ORDER = ['en', 'de', 'es', 'es-BR', 'ja', 'ko', 'th', 'fr', 'zh', 'zh-hant']

# 类别：key 为文件夹名关键字，id 为内部标识
CATEGORIES = [
    {'key': '旁白', 'id': 'VO'},
    {'key': '压制', 'id': 'DUB'},
    {'key': '原剧', 'id': 'ORIG'},
    {'key': '字幕', 'id': 'SUB'},
    {'key': '净版', 'id': 'CLEAN'},
]

# 无语言分层的类别
FLAT_CATEGORIES = {'ORIG', 'CLEAN'}


def lang_sort_key(code):
    try:
        return LANG_ORDER.index(code)
    except ValueError:
        return len(LANG_ORDER) + 1


_KANA = re.compile(r'[\u3040-\u30ff]')
_HANGUL = re.compile(r'[\uac00-\ud7af]')
_THAI = re.compile(r'[\u0e00-\u0e7f]')
_CJK = re.compile(r'[\u4e00-\u9fff]')

_DE_HINT = re.compile(r'[äöüß]', re.I)
_FR_HINT = re.compile(r'[àâçéèêëîïôûùœÿ]', re.I)
_ES_HINT = re.compile(r'[ñ¿¡]', re.I)

_DE_WORDS = ('der', 'die', 'das', 'und', 'nicht', 'für', 'ist', 'ich', 'sie', 'mit', 'ein', 'eine')
_FR_WORDS = ('le', 'la', 'les', 'des', 'une', 'pour', 'est', 'je', 'ils', 'avec', 'dans', 'mon')
_ES_WORDS = ('el', 'los', 'las', 'una', 'para', 'es', 'yo', 'con', 'que', 'como', 'mi')


def guess_lang(text):
    """尽量猜测标题所属语种；不确定时返回 None，交由用户手动选择。"""
    if not text:
        return None
    if _KANA.search(text):
        return 'ja'
    if _HANGUL.search(text):
        return 'ko'
    if _THAI.search(text):
        return 'th'
    if _CJK.search(text):
        return 'zh'

    low = text.lower()
    scores = {'de': 0, 'fr': 0, 'es': 0}
    if _DE_HINT.search(low):
        scores['de'] += 3
    if _FR_HINT.search(low):
        scores['fr'] += 2
    if _ES_HINT.search(low):
        scores['es'] += 3

    words = set(re.findall(r'\w+', low))
    for w in _DE_WORDS:
        if w in words:
            scores['de'] += 1
    for w in _FR_WORDS:
        if w in words:
            scores['fr'] += 1
    for w in _ES_WORDS:
        if w in words:
            scores['es'] += 1

    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else None
