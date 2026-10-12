// asset version: 12 — 改动任一包请整体 bump
// 依赖外部：srt-core.js（parseSrt）、identify-engine.js（buildTermCandidatesV2）
// 导出：self.onmessage 接收 identify 请求，返回 progress/result/error

/**
 * 术语识别 Web Worker
 * 将 buildTermCandidatesV2 移到后台线程，避免上百集 SRT 时主线程卡死。
 * AI 精排/解释仍由主线程调 ai.js（避免 Worker 内 fetch CORS 限制 + 凭证传递复杂度）。
 */
importScripts('srt-core.js?v=12');
importScripts('identify-engine.js?v=12');

self.onmessage = async function (e) {
  const { type, subtitleFiles, options } = e.data;
  try {
    const result = await buildTermCandidatesV2(subtitleFiles, options, (phase, current, total, message) => {
      self.postMessage({ type: 'progress', phase, current, total, message });
    });
    self.postMessage({ type: 'result', ...result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
