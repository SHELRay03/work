// asset version: 12 — 改动任一包请整体 bump
// 依赖外部：无
// 导出：parseSrt, formatTimecode, generateSrt, PUNCTUATION, naturalCompare,
//        extractSrtFromFileList, readDroppedFolder, extractSrtFromDropEvent

/**
 * SRT 字幕解析与生成工具
 */

function parseSrt(text) {
  // 去 BOM、统一换行为 \n
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const subs = [];

  const toMs = (h, m, s, ms) =>
    parseInt(h, 10) * 3600000 +
    parseInt(m, 10) * 60000 +
    parseInt(s, 10) * 1000 +
    parseInt(ms.padEnd(3, '0'), 10);

  // 宽松时间码：小时/分钟/秒 1-2 位，毫秒 1-3 位，支持逗号或点号分隔
  const timeRegex = /(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

  // 以时间行作为块起始标志逐行扫描，不依赖块之间空行分隔
  // 这样可兼容非标准 SRT（块之间仅单换行、无空行）
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const timeMatch = line.match(timeRegex);

    if (timeMatch) {
      const start = toMs(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
      const end = toMs(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);

      // 时间行前一行若为纯数字，视为本块序号
      let index = NaN;
      if (i > 0 && /^\d+$/.test(lines[i - 1].trim())) {
        index = parseInt(lines[i - 1].trim(), 10);
      }

      // 收集文本行：时间行之后，直到下一个时间行或下一块的序号
      const textLines = [];
      i++;
      while (i < lines.length) {
        const tl = lines[i].trim();
        if (timeRegex.test(tl)) break; // 遇到下一个时间行，结束本块文本
        // 纯数字且下一行是时间行，视为下一块序号，结束本块文本
        if (/^\d+$/.test(tl) && i + 1 < lines.length && timeRegex.test(lines[i + 1].trim())) {
          break;
        }
        if (tl !== '') {
          textLines.push(tl);
        }
        i++;
      }

      if (!isNaN(start) && !isNaN(end) && textLines.length > 0) {
        subs.push({
          index: isNaN(index) ? subs.length + 1 : index,
          start: start,
          end: end,
          text: textLines.join('\n')
        });
      }
    } else {
      i++;
    }
  }

  return subs;
}

function formatTimecode(ms) {
  const hours = Math.floor(ms / 3600000);
  const remain = ms % 3600000;
  const minutes = Math.floor(remain / 60000);
  const remain2 = remain % 60000;
  const seconds = Math.floor(remain2 / 1000);
  const milliseconds = remain2 % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

function generateSrt(subs) {
  const lines = [];
  subs.forEach((sub, idx) => {
    lines.push((idx + 1).toString());
    lines.push(`${formatTimecode(sub.start)} --> ${formatTimecode(sub.end)}`);
    lines.push(sub.text);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * 公共标点常量（替换引擎、识别引擎共用）
 * 只在此处定义一次，其他包直接读全局 PUNCTUATION
 */
const PUNCTUATION = ',.!?;:，。！？；：、"\'（）()[]{}《》<>—–-~·@#$%^&*+=|\\/';

/**
 * 自然顺序比较：数字按数值参与比较，避免 ep10 排在 ep2 前面
 */
function naturalCompare(a, b) {
  const split = (s) => String(s).split(/(\d+)/).filter(x => x !== '');
  const aa = split(a);
  const bb = split(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const x = aa[i];
    const y = bb[i];
    const isNumX = /^\d+$/.test(x);
    const isNumY = /^\d+$/.test(y);
    if (isNumX && isNumY) {
      const n = Number(x) - Number(y);
      if (n !== 0) return n;
    } else {
      const lx = x.toLowerCase();
      const ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
    }
  }
  return aa.length - bb.length;
}

/**
 * 从 FileList 中提取 SRT 文件（支持 webkitdirectory 选择文件夹）
 * 按文件名数字大小自然排序（ep1, ep2, ..., ep10）
 */
function extractSrtFromFileList(fileList) {
  const results = [];
  for (const file of fileList) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.srt')) {
      const relPath = file.webkitRelativePath || file.name;
      results.push({ name: relPath, file: file });
    }
  }
  results.sort((a, b) => naturalCompare(a.name, b.name));
  return results;
}

/**
 * 递归读取拖入的文件夹
 */
function readDroppedFolder(entry, path = '') {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        const name = path + file.name;
        resolve([{ name: name, file: file }]);
      }, reject);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const allFiles = [];
      const readAll = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
            return;
          }
          const subPath = path + entry.name + '/';
          const promises = entries.map(e => readDroppedFolder(e, subPath));
          try {
            const results = await Promise.all(promises);
            for (const r of results) allFiles.push(...r);
            readAll();
          } catch (err) {
            reject(err);
          }
        }, reject);
      };
      readAll();
    } else {
      resolve([]);
    }
  });
}

/**
 * 从拖放事件中提取 SRT 文件
 */
async function extractSrtFromDropEvent(event) {
  const items = event.dataTransfer?.items;
  if (!items) return [];

  const results = [];
  const filePromises = [];

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      const file = item.getAsFile();
      if (file && file.name.toLowerCase().endsWith('.srt')) {
        results.push({ name: file.name, file: file });
      }
      continue;
    }
    if (entry.isDirectory || entry.isFile) {
      filePromises.push(readDroppedFolder(entry));
    }
  }

  const allFiles = await Promise.all(filePromises);
  for (const files of allFiles) {
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.srt')) {
        results.push(f);
      }
    }
  }

  // 按文件名数字大小自然排序（ep1, ep2, ..., ep10）
  results.sort((a, b) => naturalCompare(a.name, b.name));
  return results;
}
