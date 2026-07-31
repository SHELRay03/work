/**
 * SRT 字幕解析与生成工具
 */

function parseSrt(text) {
  const lines = text.split(/\r?\n/);
  const subs = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // 跳过空行
    if (!line) {
      i++;
      continue;
    }
    
    // 尝试解析序号
    const index = parseInt(line, 10);
    if (isNaN(index)) {
      i++;
      continue;
    }
    
    i++;
    
    // 解析时间码
    if (i >= lines.length) break;
    const timeLine = lines[i].trim();
    i++;
    
    const timeMatch = timeLine.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
    if (!timeMatch) continue;
    
    const start = parseInt(timeMatch[1]) * 3600000 +
                  parseInt(timeMatch[2]) * 60000 +
                  parseInt(timeMatch[3]) * 1000 +
                  parseInt(timeMatch[4]);
    
    const end = parseInt(timeMatch[5]) * 3600000 +
                parseInt(timeMatch[6]) * 60000 +
                parseInt(timeMatch[7]) * 1000 +
                parseInt(timeMatch[8]);
    
    // 解析文本（可能多行）
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }
    i++;
    
    subs.push({
      index: index,
      start: start,
      end: end,
      text: textLines.join('\n')
    });
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
 * 术语替换引擎
 */

const PUNCTUATION = ',.!?;:，。！？；：、"\'（）()[]{}《》<>—–-~·@#$%^&*+=|\\/';

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
  const fileName = options.fileName || '';
  const lineIndex = options.lineIndex || 0;
  
  console.log('[replaceText]', 'fileName:', fileName, 'lineIndex:', lineIndex);
  console.log('[replaceText]', 'matches found:', matches.length);
  console.log('[replaceText]', 'allowedHitIds size:', allowedHitIds ? allowedHitIds.size : 'null (all allowed)');
  
  if (matches.length === 0) {
    return { text, hits: [], conflicts };
  }
  
  // 过滤出允许替换的命中
  const filteredMatches = [];
  for (const [start, end, entry] of matches) {
    const hitId = `${fileName}|${lineIndex}|${start}|${end}|${entry.source}`;
    const isAllowed = allowedHitIds === null || allowedHitIds.has(hitId);
    console.log('[replaceText]', 'hitId:', hitId, 'allowed:', isAllowed);
    if (isAllowed) {
      filteredMatches.push([start, end, entry]);
    }
  }
  
  console.log('[replaceText]', 'filteredMatches:', filteredMatches.length, 'of', matches.length);
  
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

/**
 * 从 FileList 中提取 SRT 文件（支持 webkitdirectory 选择文件夹）
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
  
  return results;
}

/**
 * 使用 File System Access API 将文件写入文件夹
 * 返回 { success, message }
 */
async function saveFilesToFolder(fileMap) {
  // fileMap: [{ path, content }]
  if (!window.showDirectoryPicker) {
    return { success: false, message: '当前浏览器不支持文件夹导出，请使用 Chrome/Edge 或选择 ZIP 导出' };
  }
  
  try {
    const dirHandle = await window.showDirectoryPicker();
    
    for (const { path, content } of fileMap) {
      const parts = path.split('/');
      let current = dirHandle;
      
      // 创建子文件夹
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i], { create: true });
      }
      
      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    
    return { success: true, message: `已保存 ${fileMap.length} 个文件` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, message: '已取消保存' };
    }
    return { success: false, message: '保存失败：' + err.message };
  }
}