/**
 * 术语扫描 Web Worker
 * 将 parseSrt + scanTextHits 移到后台线程，避免主线程卡顿
 */
importScripts('srt.js?v=11');

self.onmessage = function (e) {
  const { type, subtitleFiles, glossaryEntries, glossaryByLang, activeLangs, preview } = e.data;

  try {
    const terms = {};
    let totalHits = 0;
    const limit = preview ? 1 : subtitleFiles.length;
    const isMulti = type === 'scan-multi';

    for (let i = 0; i < limit; i++) {
      const subFile = subtitleFiles[i];
      const subs = parseSrt(subFile.content);
      const outName = subFile.name.split('/').pop();

      for (let j = 0; j < subs.length; j++) {
        const line = subs[j];
        if (!line.text || !line.text.trim()) continue;

        const text = line.text.replace(/\n/g, ' ');
        const tc = formatTimecode(line.start);

        // 上下文（前后各 2 行）
        const ctxBefore = [];
        for (let k = Math.max(0, j - 2); k < j; k++) {
          ctxBefore.push({
            line_no: k + 1,
            timecode: formatTimecode(subs[k].start),
            text: (subs[k].text || '').replace(/\n/g, ' ')
          });
        }
        const ctxAfter = [];
        for (let k = j + 1; k < Math.min(subs.length, j + 3); k++) {
          ctxAfter.push({
            line_no: k + 1,
            timecode: formatTimecode(subs[k].start),
            text: (subs[k].text || '').replace(/\n/g, ' ')
          });
        }

        if (!isMulti) {
          // 单语言模式
          const { hits } = scanTextHits(text, glossaryEntries);
          for (const h of hits) {
            const src = h.source;
            const bucket = terms[src] || { source: src, target: h.target, hits: [] };
            bucket.hits.push({
              id: `${outName}|${j + 1}|${h.start}|${h.end}|${src}`,
              file: outName,
              line_no: j + 1,
              timecode: tc,
              line_text: text,
              source: h.source,
              target: h.target,
              start: h.start,
              end: h.end,
              context: { before: ctxBefore, after: ctxAfter }
            });
            totalHits++;
            terms[src] = bucket;
          }
        } else {
          // 多语言模式：每语言独立扫描，按 hitId 合并
          const mergedHits = {};
          for (const lang of activeLangs) {
            const { hits } = scanTextHits(text, glossaryByLang[lang]);
            for (const h of hits) {
              const id = `${outName}|${j + 1}|${h.start}|${h.end}|${h.source}`;
              if (!mergedHits[id]) {
                mergedHits[id] = {
                  id,
                  file: outName,
                  line_no: j + 1,
                  timecode: tc,
                  line_text: text,
                  source: h.source,
                  start: h.start,
                  end: h.end,
                  context: { before: ctxBefore, after: ctxAfter },
                  targets: {}
                };
              }
              mergedHits[id].targets[lang] = h.target;
            }
          }
          for (const h of Object.values(mergedHits)) {
            const src = h.source;
            const bucket = terms[src] || { source: src, hits: [] };
            bucket.hits.push(h);
            totalHits++;
            terms[src] = bucket;
          }
        }
      }

      // 进度通知
      self.postMessage({ type: 'progress', current: i + 1, total: limit });
    }

    const termList = Object.values(terms).sort((a, b) => {
      if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length;
      return b.source.length - a.source.length;
    });

    self.postMessage({
      type: 'result',
      scanData: {
        term_count: termList.length,
        hit_count: totalHits,
        terms: termList
      }
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
