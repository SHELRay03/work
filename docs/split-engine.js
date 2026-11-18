// asset version: 4 — 改动本包请整体 bump
// 依赖外部：无（AI 调用通过注入的 chat 函数，默认取全局 zhipuChat）
// 导出：SplitEngine
//
// 字幕「按语言语法分段」核心引擎。
// - 计数单位按语言区分：东亚按字素（Intl.Segmenter grapheme），拉丁/韩语按词（word）
// - 双重预算：词语言除词数外再加「字符上限」，取更严者，兼顾单词长短
// - 条容量 = 每行预算 × 每条行数上限（日语 10字×2行=20字/条，英语 10词×3行=30词/条）。
//   「行数」只是容量乘数：一条字幕的文本是连续的，不插入换行符 \n。
// - 分段：调用智谱 GLM 在语法自然边界把超长字幕切成若干「条」，每条 ≤ 容量、尽量均分；
//   并发批量 + 失败规则兜底。
// - 时间：按切出的「条数」平均分配 start/end，末条对齐原结束时间。

const SplitEngine = (() => {
  'use strict';

  // ============ 语言配置（单一数据源） ============
  // unit: grapheme=按字素计（1 假名/汉字/泰语音节簇=1）；word=按词计
  // limit: 每行词/字预算；charUpper: 每行字符上限（仅词语言，作为视觉宽度安全网，0=不限制）
  // maxLinesPerCue: 每条字幕的「行数」（容量乘数）。条容量 = limit × maxLinesPerCue。
  //   注意：这里不真的插入换行——行数只决定一条能装多少字/词，文本保持连续。
  const LANG_CONFIG = {
    zh: { label: '中文',       unit: 'grapheme', unitName: '字',   limit: 12, charUpper: 0,  maxLinesPerCue: 2, locale: 'zh' },
    ja: { label: '日语',       unit: 'grapheme', unitName: '字',   limit: 10, charUpper: 0,  maxLinesPerCue: 2, locale: 'ja' },
    ko: { label: '韩语',       unit: 'word',     unitName: '词',   limit: 8,  charUpper: 20, maxLinesPerCue: 2, locale: 'ko' },
    th: { label: '泰语',       unit: 'grapheme', unitName: '音节', limit: 20, charUpper: 0,  maxLinesPerCue: 2, locale: 'th' },
    en: { label: '英语',       unit: 'word',     unitName: '词',   limit: 10, charUpper: 50, maxLinesPerCue: 3, locale: 'en' },
    es: { label: '西班牙语',   unit: 'word',     unitName: '词',   limit: 10, charUpper: 50, maxLinesPerCue: 3, locale: 'es' },
    de: { label: '德语',       unit: 'word',     unitName: '词',   limit: 10, charUpper: 55, maxLinesPerCue: 3, locale: 'de' },
    fr: { label: '法语',       unit: 'word',     unitName: '词',   limit: 10, charUpper: 50, maxLinesPerCue: 3, locale: 'fr' },
  };

  const DEFAULT_LIMIT       = Object.fromEntries(Object.entries(LANG_CONFIG).map(([k, v]) => [k, v.limit]));
  const DEFAULT_CHAR_UPPER  = Object.fromEntries(Object.entries(LANG_CONFIG).map(([k, v]) => [k, v.charUpper]));
  const LANG_LABEL          = Object.fromEntries(Object.entries(LANG_CONFIG).map(([k, v]) => [k, v.label]));
  const MAX_LINES           = Object.fromEntries(Object.entries(LANG_CONFIG).map(([k, v]) => [k, v.maxLinesPerCue]));
  const UNIT_NAME           = Object.fromEntries(Object.entries(LANG_CONFIG).map(([k, v]) => [k, v.unitName]));

  // 每种语言专门的语法断句指引
  const GRAMMAR_HINT = {
    zh: '在句号/问号/叹号/分号/逗号（。！？；，、）后断；在连词（因为、所以、但是、然后、而且）后断；在短语/意群边界断；不要把词语从中间拆开，不要把标点留在行首。',
    ja: '在「。！？」等标点之后、逗号「、」之后断开；在助词（て、に、を、は、が、で、と、も、から、まで、けど、ので 等）之后可断；在动词/形容词的终止形（た/だ/です/ます 等句尾）之后断开；不要把助词或标点留在行首，不要把单词、惯用搭配从中间拆开；引号「」括号（）内的内容尽量保持在同一行。',
    ko: '在 문장부호（。！？ , .）之后断开；在 종결어미（요/다/네요/죠/습니다 等句尾词尾）之后断开；在连接语尾（는데/지만/아서/어서 等）之后可断；不要拆开一个完整单词（空格分隔的单位），不要把 조사/어미 单独留在行首。',
    th: '在机器标点（。！？ , .）之后断开；在词组/短语的自然边界断开（如动词短语与名词短语之间）；泰语没有词间空格，尽量在语义完整的短语后断，绝不要把辅音+元音+声调符号从中间拆开；不要把标点留在行首。',
    en: 'Break at word boundaries and after conjunctions (and / but / or / so) and at clause boundaries; keep phrasal verbs and short phrases (e.g. "in order to", "take off") together; NEVER split a word in the middle; do not leave a preposition or conjunction at the start of a line.',
    es: 'Break at word boundaries and after conjunctions (y / pero / o / porque / sin embargo); keep the inverted opening punctuation "¿" and "¡" together with the text that follows it (never break right after an opening ¿ or ¡); NEVER split a word in the middle.',
    de: 'Break only at word boundaries, preferably after conjunctions (und / aber / oder / weil / dass); NEVER split a word in the middle. A very long compound noun (e.g. Donaudampfschifffahrtsgesellschaft) is an indivisible atomic unit: keep it whole on one line even if that line ends up longer than the budget — do not insert a hyphen or cut it.',
    fr: 'Break at word boundaries and after conjunctions (et / mais / ou / parce que); NEVER break at a narrow no-break space (U+202F, U+00A0) — keep "5 %", "M. Dupont", and "? ! ; :" intact; treat elisions like l\'heure / d\'accord / qu\'il as a single word; NEVER split a word in the middle.',
  };

  // ============ 分词 / 计数 ============
  const segCache = Object.create(null);
  function getSegmenter(locale, granularity) {
    const key = locale + '|' + granularity;
    if (key in segCache) return segCache[key];
    let seg = null;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) seg = new Intl.Segmenter(locale, { granularity });
    } catch (e) { seg = null; }
    segCache[key] = seg;
    return seg;
  }

  /**
   * 归一化单行：换行合并为空格，压缩多余空白，去首尾。
   * 词语言需要保留词间空格；字素语言忽略空白计数，故空格不影响校验。
   */
  function normalizeLine(text) {
    return String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t\u00A0\u202F]{2,}/g, ' ')
      .trim();
  }

  /**
   * 把文本切成单元数组：[{ text, weight }]
   *  word     : 词 weight=1，空白/标点 weight=0（Intl.Segmenter word，isWordLike）
   *  grapheme : 字素 weight=1，空白 weight=0（Intl.Segmenter grapheme，泰语音节簇不被拆开）
   * 均可无 Segmenter 时回退（Array.from / 空格切分）。
   */
  function tokenize(lang, text) {
    const cfg = LANG_CONFIG[lang] || LANG_CONFIG.ja;
    const s = normalizeLine(text);
    const units = [];

    if (cfg.unit === 'word') {
      const seg = getSegmenter(cfg.locale, 'word');
      if (seg) {
        for (const part of seg.segment(s)) {
          units.push({ text: part.segment, weight: part.isWordLike ? 1 : 0 });
        }
      } else {
        // 回退：保留空白分隔，非空白 token 计 1
        for (const t of s.split(/(\s+)/)) {
          if (!t) continue;
          units.push({ text: t, weight: /^\s+$/.test(t) ? 0 : 1 });
        }
      }
    } else {
      // grapheme
      const seg = getSegmenter(cfg.locale, 'grapheme');
      const arr = seg
        ? Array.from(seg.segment(s), p => p.segment)
        : Array.from(s);
      for (const g of arr) units.push({ text: g, weight: /\s/.test(g) ? 0 : 1 });
    }
    return units;
  }

  /** 按语言度量文本长度：词语言数词，字素语言数字素（忽略空白） */
  function measure(lang, text) {
    let n = 0;
    for (const u of tokenize(lang, text)) n += u.weight;
    return n;
  }

  /** 兼容旧接口：按字素计数（忽略空白），主要用于测试与通用场景 */
  function charCount(text) { return measure('ja', text); }

  /**
   * 视觉宽度：按字素计数（含空格与标点），用于「每行不超过几个字」的约束。
   * 与 measure 区别：measure 只数词/可见字素，visualWidth 数屏幕上实际占位的字符。
   * 不做 trim —— 便于逐单元累加；调用方检查整行时传入已归一化的字符串。
   */
  function visualWidth(text) {
    const s = String(text ?? '');
    if (!s) return 0;
    const seg = getSegmenter('und', 'grapheme');
    return (seg ? Array.from(seg.segment(s), p => p.segment) : Array.from(s)).length;
  }

  /** 解析字符上限：未传/空串用语言默认；显式 0 表示关闭该约束 */
  function resolveCharUpper(lang, raw) {
    const cfg = LANG_CONFIG[lang] || LANG_CONFIG.ja;
    if (cfg.unit !== 'word') return 0; // 字素语言本来就是按字素预算，无需第二重
    if (raw === undefined || raw === null || raw === '') return cfg.charUpper || 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : (cfg.charUpper || 0);
  }

  // 可安全断句的字符：标点、空格、右括号 —— 断在其「之后」
  const BREAK_AFTER = /[。！？!?.,，、;；:：)\]】」』》）]/;
  // 法语窄不换行空格：禁止在其处断开
  const NOBREAK_SPACE = /[\u00A0\u202F]/;

  /**
   * 均分切条（规则兜底 / AI 结果不均衡时的重排）。
   * 入参 limit / charUpper 是「条容量」= 每行预算 × 行数上限，由调用方换算后传入。
   * 双重预算：条数 = max(ceil(总词数/cueLimit), ceil(总字符数/cueCharUpper))，取更严者；
   * 词语言考虑单词长短差异，避免「同样词数但一条超宽」。字素语言 charUpper 恒为 0。
   * 切点按「复合进度」= max(词数进度, 字符进度) 引导，在 0.6~1.4 窗口内选语法边界；
   * 含 ≥2 个词的条不得超 cueCharUpper，单个不可分割超长词（德语复合词/URL）允许独占并超限。
   * word 语言只在完整词后断，grapheme 语言只在字素边界断；拼接回去与原文逐字一致。
   * 输出的每条都是连续文本，不含 \n。
   */
  function ruleSplit(text, limit, lang, charUpper, depth) {
    lang = lang || 'ja';
    depth = depth || 0;
    const cfg = LANG_CONFIG[lang] || LANG_CONFIG.ja;
    const units = tokenize(lang, text);
    const s = normalizeLine(text);
    const totalW = units.reduce((a, u) => a + u.weight, 0);
    const cUpper = resolveCharUpper(lang, charUpper);
    const totalC = cUpper > 0 ? units.reduce((a, u) => a + visualWidth(u.text), 0) : 0;

    const nByW = Math.ceil(totalW / limit);
    const nByC = cUpper > 0 ? Math.ceil(totalC / cUpper) : 0;
    const nSeg = Math.max(1, nByW, nByC);
    if (nSeg <= 1) return [s];

    const targetW = totalW / nSeg;
    const targetC = cUpper > 0 ? totalC / nSeg : 0;
    const progress = (w, c) => {
      let p = targetW > 0 ? w / targetW : 0;
      if (cUpper > 0 && targetC > 0) p = Math.max(p, c / targetC);
      return p;
    };

    const lines = [];
    let start = 0;

    for (let seg = 1; seg <= nSeg; seg++) {
      if (seg === nSeg) {
        const tail = units.slice(start).map(u => u.text).join('').trim();
        if (tail && measure(lang, tail) > 0) lines.push(tail);
        break;
      }
      // 默认硬切点：累加到复合进度 ≥1，或加入下一单元会让本行超字符上限
      let i = start, w0 = 0, c0 = 0;
      while (i < units.length) {
        const uc = visualWidth(units[i].text);
        if (cUpper > 0 && w0 > 0 && c0 + uc > cUpper) break; // 字符硬约束，绝不切词
        w0 += units[i].weight;
        c0 += uc;
        i++;
        if (progress(w0, c0) >= 1) break;
      }
      let cut = i > start ? i : start + 1;

      // 在窗口内选更合适的语法断点（复合进度最接近 1 者优先）
      let best = -1, bestDist = Infinity, w = 0, c = 0;
      for (let j = start; j < units.length; j++) {
        const u = units[j];
        w += u.weight;
        c += visualWidth(u.text);
        const p = progress(w, c);
        if (p > 1.4) break;
        if (cUpper > 0 && w > 1 && c > cUpper) break;  // 不允许产生超宽行的断点
        if (p < 0.6) continue;
        if (NOBREAK_SPACE.test(u.text)) continue;       // 不在不可断空格之后断
        // 法语窄不换行空格把两侧内容绑定为一个整体（如 5\u00A0%、M.\u00A0Dupont、?\u00A0!），
        // 若下一单元是窄空格，则不能在本单元之后断，否则会把绑定词组拆到两行。
        if (j + 1 < units.length && NOBREAK_SPACE.test(units[j + 1].text)) continue;
        const isBreak = BREAK_AFTER.test(u.text) || (cfg.unit === 'word'
          ? (u.weight > 0 || /\s/.test(u.text))                // 词边界（词本身或词后空白）
          : (/\s/.test(u.text) || BREAK_AFTER.test(u.text)));  // 字素语言：空格或标点
        if (!isBreak) continue;
        const d = Math.abs(p - 1);
        if (d < bestDist) { bestDist = d; best = j + 1; }
      }
      if (best > start) cut = best;
      if (cut <= start) cut = start + 1;

      const piece = units.slice(start, cut).map(u => u.text).join('').trim();
      if (measure(lang, piece) > 0) lines.push(piece);
      start = cut;
    }
    let result = lines.filter(l => measure(lang, l) > 0);

    // 末段吞余量可能留下超预算行（词数或字符数），对这类行再均分一次。
    // 单个不可分割超长词不处理；depth 限制递归，防止极端情况死循环。
    if (depth < 2) {
      const fixed = [];
      let changed = false;
      for (const l of result) {
        const w = measure(lang, l);
        const over = w > limit || (cUpper > 0 && w > 1 && visualWidth(l.trim()) > cUpper);
        if (over && w > 1) {
          const sub = ruleSplit(l, limit, lang, charUpper, depth + 1);
          if (sub.length > 1 && isFaithful(l, sub)) { fixed.push(...sub); changed = true; }
          else fixed.push(l);
        } else {
          fixed.push(l);
        }
      }
      if (changed) result = fixed;
    }
    return result;
  }

  /** 把 AI 的 text 回复解析为 {id -> lines[]} */
  function parseAiReply(content) {
    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      const match = String(content).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI 返回内容中没有 JSON');
      try {
        data = JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('AI 返回的 JSON 无法解析');
      }
    }
    const arr = data.results || data.lines_list || data.items || [];
    const map = {};
    for (const item of arr) {
      if (item.id === undefined || item.id === null) continue;
      let lines = item.lines || item.parts || item.segments || [];
      if (typeof lines === 'string') lines = [lines];
      map[String(item.id)] = lines
        .map(x => normalizeLine(typeof x === 'string' ? x : (x.text ?? '')))
        .filter(x => String(x).length > 0);
    }
    return map;
  }

  /** 校验：分段拼接后与原文本（忽略空白）一致 */
  function isFaithful(original, lines) {
    if (!Array.isArray(lines) || lines.length === 0) return false;
    const a = String(original ?? '').replace(/\s+/g, '');
    const b = lines.join('').replace(/\s+/g, '');
    return a === b;
  }

  /** 校验分段是否「足够平均」：不让任何一行过短、过长，或（词语言）超字符上限 */
  function isEvenEnough(lines, limit, lang, charUpper) {
    lang = lang || 'ja';
    if (!Array.isArray(lines) || lines.length <= 1) return true;
    const counts = lines.map(l => measure(lang, l));
    const sum = counts.reduce((a, b) => a + b, 0);
    const target = sum / counts.length;
    const minAllowed = Math.max(1, Math.floor(target * 0.6));
    const maxAllowed = Math.max(limit, Math.ceil(target * 1.4));
    if (!counts.every(c => c >= minAllowed && c <= maxAllowed)) return false;
    const cUpper = resolveCharUpper(lang, charUpper);
    if (cUpper > 0) {
      // 含 ≥2 个词的行不得超宽；单个不可分割超长词允许独占并超限
      if (lines.some(l => measure(lang, l) > 1 && visualWidth(l.trim()) > cUpper)) return false;
    }
    return true;
  }

  /**
   * 兼容旧接口：把若干「行」打包成「条」，行间用 \n 连接。
   * 注意：主流程已不再使用（新模型按条容量直接切分、条内不换行），仅为兼容保留。
   */
  function packLines(lines, maxLines) {
    const cues = [];
    const n = Math.max(1, parseInt(maxLines, 10) || 2);
    for (let i = 0; i < lines.length; i += n) {
      cues.push(lines.slice(i, i + n).join('\n'));
    }
    return cues;
  }

  /**
   * 把一条字幕的时间「尽量平均」分配到 N 条：整除后余数摊到前面几条，末条对齐原结束时间。
   * cues[i] 为一条连续文本（不含 \n）。
   */
  function allocateTiming(sub, cues) {
    const n = cues.length;
    const span = Math.max(n, sub.end - sub.start); // 至少每条 1ms
    const base = Math.floor(span / n);
    const rem = span - base * n;
    const out = [];
    let cursor = sub.start;
    for (let i = 0; i < n; i++) {
      const end = (i === n - 1) ? sub.end : cursor + base + (i < rem ? 1 : 0);
      out.push({
        index: sub.index, // 输出时由 generateSrt 重新编号，这里仅留来源信息
        start: cursor,
        end: end,
        text: cues[i],
        _srcIndex: sub.index,
      });
      cursor = end;
    }
    return out;
  }

  /**
   * @param cueLimit 每条字幕的容量上限（单位数）= 每行预算 × 行数
   * @param cueCharUpper 每条字幕的字符容量上限（词语言）= 每行字符上限 × 行数，0=不限制
   * @param maxLines 行数上限（容量乘数，仅用于向 AI 解释容量来源）
   * @param perLineLimit 每行预算（仅用于向 AI 解释容量来源）
   * @param perLineCharUpper 每行字符上限（仅用于解释）
   */
  function buildSystemPrompt(lang, cueLimit, cueCharUpper, maxLines, perLineLimit, perLineCharUpper) {
    const cfg = LANG_CONFIG[lang] || LANG_CONFIG.ja;
    const unitName = cfg.unitName;
    const sizeRule = `每条字幕不超过 ${cueLimit} ${unitName}（= 每行 ${perLineLimit} ${unitName} × 每条 ${maxLines} 行）` +
      (cueCharUpper > 0
        ? `，且每条不超过 ${cueCharUpper} 个字符（含空格与标点，控制视觉宽度；= 每行 ${perLineCharUpper} 字符 × ${maxLines} 行）`
        : '') +
      '；仅当单个词本身超长时可例外（超长词保持完整、可独占一条并允许超限，绝不切开）。';
    return [
      `你是专业的${cfg.label}字幕断句助手。任务：把每条过长的字幕，按${cfg.label}语法在自然的语义/语法边界切成若干「条」独立短字幕，${sizeRule}`,
      '',
      `${cfg.label}断句要点：${GRAMMAR_HINT[lang] || GRAMMAR_HINT.ja}`,
      '',
      '严格要求：',
      '1. 只能把原文切成连续的若干条，拼接后必须与原文逐字一致，禁止增删改任何字符（包括标点和空格）。',
      `2. ${sizeRule}`,
      cfg.unit === 'word'
        ? '3. 绝不要在一个词的中间断开；词之间的空格要保留。'
        : '3. 绝不要把标点留在条首；一个字素/音节（如泰语辅音+元音+声调）不可拆开。',
      '4. 保持语义完整，优先在停顿处断开。',
      `5. 【最重要】各条长度要尽量平均：先根据总长度决定切几条，再让每条接近「总长度÷条数」。严禁前几条填到上限、最后只剩一两个${unitName}。`,
      `   宁可每条略短，也不要出现悬殊的长短条；${cueCharUpper > 0 ? '同时兼顾词数与字符数，别让长词条超宽；' : ''}在均分前提下就近选择语法停顿处。`,
      '6. 【重要】每条字幕的文本必须连续，绝对不要插入换行符（\\n）或把一条拆成多行显示；lines 数组中每个元素就是一条完整字幕。',
      '7. 不需要断句的字幕也要原样返回（lines 中放原文）。',
      '',
      '严格以 JSON 返回，不要任何多余文字：',
      '{"results":[{"id":"原始id","lines":["第1条","第2条"]}]}',
      '必须覆盖输入中的每一条 id。',
    ].join('\n');
  }

  function buildUserPrompt(batch, lang, cueCharUpper) {
    const unitName = UNIT_NAME[lang] || '单位';
    const cUpper = cueCharUpper; // 已是「条容量」字符上限
    const rule = `每条不超过设定${unitName}数` + (cUpper > 0 ? `、不超过 ${cUpper} 个字符` : '') + '，条内不要换行';
    return `请断句（${rule}）：\n` +
      batch.map(b => `[${b.id}] ${b.text}`).join('\n');
  }

  /**
   * 主流程：对一组 SRT subtitle 分段。
   * @param {Array} subs - parseSrt 结果
   * @param {Object} opts - { lang, limit, charUpper, batchSize, chat }
   *   limit: 每行预算；charUpper: 每行字符上限（仅词语言生效；不传用默认，0 关闭）
   *   一条字幕容量 = 每行预算 × 行数上限；切出的每条为连续文本，不插入 \n
   *   chat(messages, options) => Promise<string>；默认用全局 zhipuChat
   * @param {Function} onProgress - (done, total, msg) => void
   * @returns {Promise<{subs:Array, stats:Object}>}
   */
  async function splitSubtitles(subs, opts = {}, onProgress = () => {}) {
    const lang = opts.lang || 'ja';
    const cfg = LANG_CONFIG[lang] || LANG_CONFIG.ja;
    const limit = Math.max(2, parseInt(opts.limit, 10) || cfg.limit);          // 每行预算
    const charUpper = resolveCharUpper(lang, opts.charUpper);                 // 每行字符上限
    const maxLines = Math.max(1, cfg.maxLinesPerCue);                         // 行数（容量乘数）
    const cueLimit = limit * maxLines;                                        // 条容量（单位数）
    const cueCharUpper = charUpper > 0 ? charUpper * maxLines : 0;            // 条容量（字符数）
    const batchSize = Math.max(1, parseInt(opts.batchSize, 10) || 20);
    const chatFn = opts.chat || ((...a) => (typeof zhipuChat === 'function' ? zhipuChat(...a) : Promise.reject(new Error('未找到 AI 调用函数'))));

    const needs = [];
    let wideRows = 0;
    for (const sub of subs) {
      const line = normalizeLine(sub.text);
      if (!line) continue;
      const w = measure(lang, line);
      const overWords = w > cueLimit;
      const overWidth = cueCharUpper > 0 && visualWidth(line) > cueCharUpper && w > 1;
      // w>1：只有一个不可分割单元（如单个德语超长复合词）时不必也无法切
      if (w > 1 && (overWords || overWidth)) {
        needs.push({ sub, line });
        if (overWidth && !overWords) wideRows++; // 纯因字符超宽才触发
      }
    }

    const decisions = new Map(); // subIndex -> { lines, source }
    let aiOk = 0, aiFail = 0, aiSkipped = 0, rebalanced = 0;

    const totalBatches = Math.ceil(needs.length / batchSize);
    for (let bi = 0; bi < totalBatches; bi++) {
      const slice = needs.slice(bi * batchSize, (bi + 1) * batchSize);
      const batch = slice.map((it, k) => ({ id: String(k), text: it.line }));
      let map = null;
      try {
        const content = await chatFn([
          { role: 'system', content: buildSystemPrompt(lang, cueLimit, cueCharUpper, maxLines, limit, charUpper) },
          { role: 'user', content: buildUserPrompt(batch, lang, cueCharUpper) },
        ], { model: 'glm-4-flash', temperature: 0.2, responseFormat: 'json' });
        map = parseAiReply(content);
      } catch (e) {
        map = null;
      }

      for (let k = 0; k < slice.length; k++) {
        const it = slice[k];
        const idx = subs.indexOf(it.sub);
        const aiLines = map && map[String(k)];
        if (aiLines && isFaithful(it.line, aiLines)) {
          // AI 结果合格，但若有某条仍超条容量（词数或字符），对该条再兜底细切
          const lineTooWide = ln => cueCharUpper > 0 && visualWidth(ln) > cueCharUpper && measure(lang, ln) > 1;
          const finalLines = [];
          let bad = false;
          for (const ln of aiLines) {
            if (measure(lang, ln) > cueLimit || lineTooWide(ln)) {
              const sub2 = ruleSplit(ln, cueLimit, lang, cueCharUpper);
              if (!isFaithful(ln, sub2)) { bad = true; break; }
              finalLines.push(...sub2);
            } else {
              finalLines.push(ln);
            }
          }
          if (!bad && finalLines.length > 0) {
            // 若 AI 切得悬殊或仍有超宽条，用均分规则重排整行
            if (!isEvenEnough(finalLines, cueLimit, lang, cueCharUpper)) {
              const evenLines = ruleSplit(it.line, cueLimit, lang, cueCharUpper);
              if (isFaithful(it.line, evenLines)) {
                decisions.set(idx, { lines: evenLines, source: 'ai-rebalanced' });
                aiOk++;
                rebalanced++;
                continue;
              }
            }
            decisions.set(idx, { lines: finalLines, source: 'ai' });
            aiOk++;
            continue;
          }
        }
        // 兜底：规则切条
        decisions.set(idx, { lines: ruleSplit(it.line, cueLimit, lang, cueCharUpper), source: 'rule' });
        aiFail++;
      }
      onProgress(bi + 1, totalBatches, `AI 断句 ${bi + 1}/${totalBatches} 批`);
    }
    aiSkipped = subs.length - needs.length;

    const out = [];
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const d = decisions.get(i);
      if (!d) { out.push({ ...sub }); continue; }
      if (d.lines.length <= 1) {
        out.push({ ...sub, text: d.lines[0] ?? normalizeLine(sub.text), _srcIndex: sub.index });
      } else {
        // d.lines 已是切好的「条」，每条连续文本（含 \n 会被归一化掉），时间按条数均分
        out.push(...allocateTiming(sub, d.lines));
      }
    }

    return {
      subs: out,
      stats: {
        total: subs.length,
        segmented: needs.length,
        unchanged: aiSkipped,
        aiOk,
        aiFail,
        rebalanced,
        after: out.length,
        batches: totalBatches,
        maxLinesPerCue: maxLines,
        cueLimit,
        cueCharUpper,
        charUpper,
        wideRows,
      },
    };
  }

  return {
    LANG_CONFIG,
    DEFAULT_LIMIT,
    DEFAULT_CHAR_UPPER,
    LANG_LABEL,
    MAX_LINES,
    UNIT_NAME,
    charCount,
    visualWidth,
    resolveCharUpper,
    measure,
    tokenize,
    normalizeLine,
    ruleSplit,
    packLines,
    parseAiReply,
    isFaithful,
    isEvenEnough,
    allocateTiming,
    buildSystemPrompt,
    buildUserPrompt,
    splitSubtitles,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SplitEngine;
