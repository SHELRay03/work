// asset version: 12 — 改动任一包请整体 bump
// 依赖外部：srt-core.js 的 PUNCTUATION（直接读全局，不再声明）
// 导出：parseGlossary, sortEntries, _tryAdd, findNonOverlapping,
//        replaceText, scanTextHits

/**
 * 术语替换引擎
 * PUNCTUATION 由 srt-core.js 定义，此处直接读全局，不再声明
 */

function parseGlossary(entries) {
  return entries.map(e => ({
    source: e.source,
    target: e.target,
    priority: e.priority || 0,
    matchType: e.matchType || 'phrase',
    blockIfLonger: e.blockIfLonger !== false
  }));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (b.source.length !== a.source.length) {
      return b.source.length - a.source.length;
    }
    return b.priority - a.priority;
  });
}

function _tryAdd(start, end, entry, occupied, matches, conflicts, text) {
  for (const [oStart, oEnd] of occupied) {
    if (!(end <= oStart || start >= oEnd)) {
      if (entry.blockIfLonger && (oStart <= start && end <= oEnd)) {
        return;
      }
      const snippet = text.substring(Math.max(0, start - 5), Math.min(text.length, end + 5));
      conflicts.push(`overlap:${entry.source} context=...${snippet}...`);
      return;
    }
  }

  for (let j = matches.length - 1; j >= 0; j--) {
    const [mStart, mEnd, existing] = matches[j];
    if (!(end <= mStart || start >= mEnd)) {
      if (entry.source.length > existing.source.length ||
          (entry.source.length === existing.source.length && entry.priority > existing.priority)) {
        matches.splice(j, 1);
        occupied.splice(j, 1);
        break;
      }
      return;
    }
  }

  matches.push([start, end, entry]);
  occupied.push([start, end]);
}

function findNonOverlapping(text, entries) {
  const occupied = [];
  const matches = [];
  const conflicts = [];
  const textLower = text.toLowerCase();

  for (const entry of entries) {
    if (entry.matchType === 'regex') {
      try {
        const regex = new RegExp(entry.source, 'gi');
        let m;
        while ((m = regex.exec(text)) !== null) {
          _tryAdd(m.index, m.index + m[0].length, entry, occupied, matches, conflicts, text);
        }
      } catch (e) {
        continue;
      }
    } else if (entry.matchType === 'word') {
      const escaped = entry.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![\\w\\u4e00-\\u9fff])${escaped}(?![\\w\\u4e00-\\u9fff])`, 'gi');
      let m;
      while ((m = regex.exec(text)) !== null) {
        _tryAdd(m.index, m.index + m[0].length, entry, occupied, matches, conflicts, text);
      }
    } else {
      const entryLower = entry.source.toLowerCase();
      let pos = 0;
      while (true) {
        pos = textLower.indexOf(entryLower, pos);
        if (pos === -1) break;
        _tryAdd(pos, pos + entry.source.length, entry, occupied, matches, conflicts, text);
        pos++;
      }
    }
  }

  matches.sort((a, b) => a[0] - b[0]);
  return { matches, conflicts };
}

function replaceText(text, entries, options = {}) {
  const { matches, conflicts } = findNonOverlapping(text, sortEntries(entries));
  const allowedHitIds = options.allowedHitIds || null;
  const hitTargetOverrides = options.hitTargetOverrides || null; // { hitId: target }
  const fileName = options.fileName || '';
  const lineIndex = options.lineIndex || 0;

  if (matches.length === 0) {
    return { text, hits: [], conflicts };
  }

  // 过滤出允许替换的命中，并应用每个 hit 独立的 Target 覆盖
  const filteredMatches = [];
  for (const [start, end, entry] of matches) {
    const hitId = `${fileName}|${lineIndex}|${start}|${end}|${entry.source}`;
    const isAllowed = allowedHitIds === null || allowedHitIds.has(hitId);
    if (isAllowed) {
      // 应用每条命中独立的 Target 覆盖
      let effectiveTarget = entry.target;
      if (hitTargetOverrides && hitTargetOverrides[hitId]) {
        effectiveTarget = hitTargetOverrides[hitId];
      }
      filteredMatches.push([start, end, { ...entry, target: effectiveTarget }]);
    }
  }

  if (filteredMatches.length === 0) {
    return { text, hits: [], conflicts };
  }

  const placeholders = {};
  const hits = [];
  const parts = [];
  let cursor = 0;

  for (let i = 0; i < filteredMatches.length; i++) {
    const [start, end, entry] = filteredMatches[i];
    const before = text.substring(cursor, start);

    const needsSpaceBefore = before.length > 0 &&
                             !PUNCTUATION.includes(before[before.length - 1]) &&
                             before[before.length - 1] !== ' ';

    const needsSpaceAfter = end < text.length &&
                            !PUNCTUATION.includes(text[end]) &&
                            text[end] !== ' ';

    if (needsSpaceBefore) {
      parts.push(before + ' ');
    } else {
      parts.push(before);
    }

    const key = `__T${i.toString().padStart(4, '0')}__`;
    placeholders[key] = entry.target;
    parts.push(key);

    if (needsSpaceAfter) {
      parts.push(' ');
    }

    hits.push({
      source: entry.source,
      target: entry.target,
      start: start,
      end: end
    });

    cursor = end;
  }

  parts.push(text.substring(cursor));
  let result = parts.join('');

  for (const [key, target] of Object.entries(placeholders)) {
    result = result.replace(key, target);
  }

  return { text: result, hits, conflicts };
}

function scanTextHits(text, entries) {
  const { matches, conflicts } = findNonOverlapping(text, sortEntries(entries));
  const hits = [];

  for (const [start, end, entry] of matches) {
    hits.push({
      source: entry.source,
      target: entry.target,
      start: start,
      end: end
    });
  }

  return { hits, conflicts };
}
