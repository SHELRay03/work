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

/**
 * 中文常用停用词表（用于过滤高频常用词）
 */
const STOPWORDS = new Set([
  // 助词、连词、介词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '它', '我们', '你们', '他们', '她们', '它们',
  // 时间、数量
  '现在', '今天', '明天', '昨天', '早上', '晚上', '刚才', '马上', '立刻', '马上', '一会儿', '一下', '一些', '一点', '一样', '一起', '一直', '已经', '还是', '那么', '这么', '这样', '那样', '怎么', '为什么',
  // 高频动词/形容词
  '知道', '明白', '了解', '觉得', '认为', '告诉', '听说', '看到', '听到', '发现', '感觉', '开始', '结束', '继续', '停止', '回来', '出去', '进来', '过去', '过来',
  // 指代
  '什么', '哪里', '谁', '哪个', '那些', '这些', '这个', '那个', '一样', '东西', '事情', '地方', '时候', '时间', '日子',
  // 语气词
  '啊', '吧', '呢', '吗', '哦', '呀', '啦', '哇', '嗯', '唉', '嗨',
  // 常见双字词
  '然后', '之后', '之前', '因为', '所以', '但是', '不过', '虽然', '如果', '除非', '只要', '只有', '无论', '不管',
  '大家', '各位', '朋友', '家人', '同事', '老板', '员工', '客户', '用户', '观众', '听众',
  '问题', '答案', '结果', '原因', '方法', '方式', '办法', '主意', '想法', '意见', '建议',
  '工作', '生活', '学习', '娱乐', '休息', '吃饭', '睡觉', '走路', '开车', '坐车', '打车',
  '真的', '确实', '实在', '真的', '也许', '可能', '应该', '必须', '需要', '不得不',
  '非常', '特别', '十分', '相当', '比较', '稍微', '有点', '有些', '太多', '太少', '多', '少',
  '就是', '只是', '不过', '然而', '而且', '或者', '还是', '以及', '包括', '关于', '对于',
  '这里', '那里', '下面', '上面', '中间', '旁边', '里面', '外面', '前面', '后面', '左边', '右边',
  '现在', '当时', '以前', '以后', '之间', '之内', '之外', '以上', '以下', '以来', '以来',
  '公司', '单位', '部门', '小组', '团队', '项目', '任务', '计划', '目标', '要求', '标准',
  '国家', '地区', '城市', '省份', '世界', '中国', '外国', '本地', '外地', '国内', '国际',
  '老板', '领导', '同事', '下属', '上司', '客户', '用户', '顾客', '商家', '合作伙伴',
  '父母', '父亲', '母亲', '爸爸', '妈妈', '孩子', '儿子', '女儿', '丈夫', '妻子', '老公', '老婆',
  '医生', '护士', '老师', '学生', '同学', '朋友', '邻居', '亲戚', '陌生人', '熟人',
  '大人', '小孩', '老人', '年轻人', '男人', '女人', '男生', '女生', '男孩', '女孩',
  '手机', '电脑', '电话', '网络', '电视', '报纸', '杂志', '书籍', '文件', '资料',
  '汽车', '火车', '飞机', '轮船', '自行车', '摩托车', '出租车', '地铁', '公交', '高铁',
  '饭店', '餐厅', '酒店', '旅馆', '商场', '超市', '市场', '商店', '店铺', '咖啡馆',
  '房子', '公寓', '别墅', '办公室', '会议室', '教室', '图书馆', '医院', '银行', '邮局',
  '高兴', '伤心', '生气', '害怕', '担心', '着急', '激动', '紧张', '放松', '累', '辛苦',
  '快乐', '幸福', '满意', '失望', '遗憾', '后悔', '惊讶', '震惊', '困惑', '迷茫',
  '成功', '失败', '进步', '退步', '增长', '减少', '增加', '降低', '提高', '下降',
  '注意', '小心', '当心', '留意', '关注', '关心', '照顾', '照料', '帮助', '支持',
  '同意', '反对', '赞成', '拒绝', '接受', '承认', '否认', '肯定', '否定', '犹豫',
  '回答', '提问', '询问', '质疑', '解释', '说明', '介绍', '描述', '表达', '沟通',
  '行动', '行为', '动作', '表现', '反应', '回应', '态度', '看法', '观点', '立场',
  '目的', '动机', '原因', '理由', '借口', '托辞', '根据', '依据', '基础', '前提',
  '结果', '后果', '影响', '作用', '效果', '效应', '价值', '意义', '重要性', '必要性',
  '方法', '手段', '途径', '渠道', '方式', '形式', '模式', '样式', '类型', '种类',
  '步骤', '程序', '流程', '过程', '阶段', '环节', '方面', '角度', '层次', '级别',
  '数据', '信息', '消息', '新闻', '报道', '公告', '通知', '通告', '声明', '宣言',
  '产品', '商品', '物品', '东西', '货物', '商品', '物件', '设备', '器材', '工具',
  '技术', '方法', '工艺', '流程', '标准', '规范', '规则', '制度', '体制', '体系',
  '资源', '资金', '材料', '原料', '能源', '动力', '力量', '能力', '实力', '竞争力',
  '环境', '条件', '背景', '基础', '前提', '要素', '因素', '变量', '参数', '指标',
  '时间', '空间', '范围', '领域', '行业', '产业', '市场', '领域', '范畴', '界限',
  '人员', '成员', '角色', '身份', '职位', '职务', '头衔', '称号', '头衔', '级别'
]);

/**
 * 从文本数组中提取 n-gram 短语及频率
 * @param {string[]} texts - 所有字幕文本
 * @param {number} minLen - 最小短语长度
 * @param {number} maxLen - 最大短语长度
 * @returns {Map<string, {count: number, files: Set<string>}>} - 短语频率及出现文件
 */
function extractNgrams(texts, minLen = 2, maxLen = 4) {
  const freqMap = new Map();
  const fileMap = new Map(); // phrase -> Set of filenames
  
  for (const textEntry of texts) {
    const { text: rawText, file } = textEntry;
    // 去除标点和空白，保留中文字符
    const cleaned = rawText.replace(/[\s,\.\?\!\;\:\'\"\(\)\[\]\{\}\《\》\<\>\—\–\-\~\·\@\#\$\%\^\&\*\+\=\|\\\/，。！？；：、（）【】「」『』〈〉—～·@#$%^&*+=|\\\/]/g, '');
    
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i <= cleaned.length - len; i++) {
        const phrase = cleaned.substring(i, i + len);
        // 跳过纯数字或字母组合
        if (/^[0-9a-zA-Z]+$/.test(phrase)) continue;
        
        if (!freqMap.has(phrase)) {
          freqMap.set(phrase, 0);
          fileMap.set(phrase, new Set());
        }
        freqMap.set(phrase, freqMap.get(phrase) + 1);
        fileMap.get(phrase).add(file);
      }
    }
  }
  
  // 过滤停用词和只出现1次的
  const result = new Map();
  for (const [phrase, count] of freqMap) {
    if (count >= 2 && !STOPWORDS.has(phrase)) {
      result.set(phrase, { count, files: fileMap.get(phrase) });
    }
  }
  
  return result;
}

/**
 * 识别人物指代变体
 * 找到“短词是长词的子串，且长词高频”的情况
 * 例如："云知意" 包含 "知意"，如果 "云知意" 高频，则 "知意" 可能是简称
 * @param {Map<string, {count: number, files: Set<string>}>} phraseFreq - 短语频率
 * @returns {Array<{full: string, short: string, fullCount: number, shortCount: number, files: Set<string>}>}
 */
function detectPersonVariants(phraseFreq) {
  const variants = [];
  const phrases = [...phraseFreq.entries()].sort((a, b) => b[0].length - a[0].length); // 长词优先
  
  const usedAsVariant = new Set(); // 已作为变体的短词，避免重复
  
  for (const [longPhrase, longInfo] of phrases) {
    if (usedAsVariant.has(longPhrase)) continue; // 已被更长短词作为变体
    
    const longLen = longPhrase.length;
    // 找所有是该长词子串的短词
    for (const [shortPhrase, shortInfo] of phrases) {
      if (shortPhrase.length >= longLen) break; // 不会有更短的了
      if (usedAsVariant.has(shortPhrase)) continue; // 已作为其他的变体
      
      // 检查短词是否是长词的连续子串
      if (longPhrase.includes(shortPhrase)) {
        // 确认不是简单的包含，而是核心词素相同
        // 例如 "云知意" 包含 "知意"（是连续子串），但 "尚书令" 不包含 "书令"（非连续）
        // includes已经是连续子串，所以直接可用
        
        // 长词频率需明显高于短词频率的一半（排除短词本身就很常见的情况）
        if (longInfo.count >= Math.ceil(shortInfo.count / 2)) {
          variants.push({
            full: longPhrase,
            short: shortPhrase,
            fullCount: longInfo.count,
            shortCount: shortInfo.count,
            files: longInfo.files
          });
          usedAsVariant.add(shortPhrase);
        }
      }
    }
  }
  
  return variants;
}

/**
 * 识别专有名词/特殊词
 * 高频、长度≥2、排除常用词
 * @param {Map<string, {count: number, files: Set<string>}>} phraseFreq - 短语频率
 * @param {Set<string>} alreadyFound - 已被人物变体识别包含的短语
 * @returns {Array<{phrase: string, count: number, files: Set<string>}>}
 */
function detectProperNouns(phraseFreq, alreadyFound) {
  const nouns = [];
  
  for (const [phrase, info] of phraseFreq) {
    if (alreadyFound.has(phrase)) continue;
    if (phrase.length < 2) continue;
    
    // 计算出现的不同文件数（跨集出现的更可能是专有词）
    const fileCount = info.files.size;
    
    // 过滤条件：
    // 1. 出现频率≥2次
    // 2. 不是停用词
    // 3. 长度2-4字
    // 4. 跨文件出现越多越可能是专有词（阈值：至少2个文件）
    
    // 排除过于通用的词（根据长度调整最小频率）
    const minFreq = phrase.length <= 2 ? 5 : 2;
    if (info.count < minFreq) continue;
    
    // 至少在2个不同文件中出现（确保是跨集的，不是单集偶发）
    if (fileCount < 2) continue;
    
    nouns.push({
      phrase,
      count: info.count,
      files: info.files
    });
  }
  
  // 按频率降序
  nouns.sort((a, b) => b.count - a.count);
  return nouns;
}

/**
 * 构建候选术语列表
 * @param {Array<{name: string, content: string}>} subtitleFiles - SRT文件列表
 * @returns {Promise<{variants: Array, properNouns: Array, allTerms: Array}>}
 */
async function buildTermCandidates(subtitleFiles) {
  // 解析所有字幕，提取文本
  const texts = [];
  for (const file of subtitleFiles) {
    const subs = parseSrt(file.content);
    for (const sub of subs) {
      if (sub.text && sub.text.trim()) {
        texts.push({
          text: sub.text.replace(/\n/g, ''),
          file: file.name
        });
      }
    }
  }
  
  // 1. 提取所有n-gram短语频率
  const phraseFreq = extractNgrams(texts, 2, 4);
  
  // 2. 识别人物指代变体
  const variants = detectPersonVariants(phraseFreq);
  
  // 收集已被人物变体识别覆盖的短语
  const variantSet = new Set();
  for (const v of variants) {
    variantSet.add(v.full);
    variantSet.add(v.short);
  }
  
  // 3. 识别专有名词
  const properNouns = detectProperNouns(phraseFreq, variantSet);
  
  // 4. 合并为完整术语列表
  const allTerms = [];
  
  // 人物变体作为单独的Source（长词作为主，短词作为变体需要统一翻译）
  for (const v of variants) {
    allTerms.push({
      source: v.full,
      target: '', // 留空供用户填写
      category: '人物指代',
      frequency: v.fullCount,
      fileCount: v.files.size,
      note: `包含变体：${v.short}（出现${v.shortCount}次）`
    });
  }
  
  // 专有名词
  for (const n of properNouns) {
    allTerms.push({
      source: n.phrase,
      target: '',
      category: '专有名词',
      frequency: n.count,
      fileCount: n.files.size,
      note: ''
    });
  }
  
  return { variants, properNouns, allTerms };
}

/**
 * 将候选术语导出为 Excel 文件
 * @param {Array<{source: string, target: string, category: string, frequency: number, fileCount: number, note: string}>} terms
 * @param {string} filename - 导出的文件名
 */
function exportTermsToExcel(terms, filename = 'candidate_terms.xlsx') {
  if (!window.XLSX) {
    throw new Error('需要先加载 SheetJS (xlsx) 库');
  }
  
  // 构建Excel行数据
  const rows = [
    ['Source', 'Target', 'Category', 'Frequency', 'File Count', 'Note'],
    ...terms.map(t => [
      t.source,
      t.target || '',
      t.category,
      t.frequency,
      t.fileCount,
      t.note || ''
    ])
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(rows);
  
  // 设置列宽
  ws['!cols'] = [
    { wch: 16 }, // Source
    { wch: 16 }, // Target
    { wch: 12 }, // Category
    { wch: 10 }, // Frequency
    { wch: 10 }, // File Count
    { wch: 30 }  // Note
  ];
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidate Terms');
  
  XLSX.writeFile(wb, filename);
}

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

// ============================================================
// 术语自动识别引擎（优化版）
// ============================================================

let stopwordsData = null;
let activeScene = 'ancient';

async function loadStopwords(sceneName) {
  if (stopwordsData && stopwordsData.active_scene === sceneName) {
    return stopwordsData;
  }
  try {
    const resp = await fetch('stopwords.json?v=2');
    if (!resp.ok) throw new Error('stopwords.json 加载失败');
    stopwordsData = await resp.json();
    stopwordsData.active_scene = sceneName || stopwordsData.active_scene;
    activeScene = stopwordsData.active_scene;
    return stopwordsData;
  } catch (e) {
    console.warn('[术语识别] 无法加载 stopwords.json，使用内置默认停用词');
    return getDefaultStopwords();
  }
}

function getDefaultStopwords() {
  return {
    version: '2.0-fallback',
    groups: {
      common: {
        label: '通用停用词',
        words: ['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
          '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
          '好', '自己', '这', '他', '她', '它', '我们', '你们', '他们',
          '什么', '哪里', '谁', '怎么', '大家', '然后', '之后', '之前',
          '因为', '所以', '但是', '不过', '还是', '那么', '这么', '这样', '那样',
          '啊', '吧', '呢', '吗', '哦', '呀', '啦', '嗯', '唉',
          '真的', '确实', '也许', '可能', '应该', '必须', '需要',
          '非常', '特别', '十分', '比较', '稍微', '有点', '有些',
          '就是', '只是', '然而', '而且', '或者', '以及', '包括',
          '知道', '明白', '了解', '觉得', '认为', '告诉', '听说', '看到',
          '开始', '结束', '继续', '回来', '出去', '进来', '过去', '过来']
      },
      variants: {
        label: '人物称谓变体',
        prefixes: ['公子', '大人', '陛下', '娘娘', '皇上', '微臣', '奴婢', '奴才', '小', '老'],
        suffixes: ['大人', '姑娘', '公子', '娘娘', '陛下', '先生', '小姐', '少爷',
          '夫人', '师傅', '老师', '哥', '姐', '弟', '妹', '爷', '奶']
      },
      context_rules: {
        label: '上下文分类规则',
        person_triggers: ['道', '说', '笑', '怒', '问', '答', '叹', '曰', '喊', '叫',
          '看', '望', '盯', '瞥', '点头', '摇头', '上前', '上前一步',
          '走', '跑', '冲', '退', '站', '坐', '跪', '躺'],
        role_triggers: ['任', '封', '贬', '升', '免', '罢', '授', '辞', '拜', '转',
          '出任', '任命', '升任', '贬为', '封为', '罢黜',
          '官职', '爵位', '官位', '品级'],
        place_triggers: ['去', '到', '在', '往', '离', '赴', '返', '回',
          '进京', '入朝', '出城', '入城', '归乡', '返乡']
      }
    },
    scenes: { general: ['common'], ancient: ['common', 'variants', 'context_rules'] },
    active_scene: 'ancient'
  };
}

function getActiveStopwords() {
  if (!stopwordsData) return getDefaultStopwords();
  const scene = stopwordsData.active_scene || 'ancient';
  const sceneGroups = (stopwordsData.scenes && stopwordsData.scenes[scene]) || ['common'];
  
  const words = new Set();
  const prefixes = [];
  const suffixes = [];
  const personTriggers = [];
  const roleTriggers = [];
  const placeTriggers = [];
  
  for (const groupName of sceneGroups) {
    const group = stopwordsData.groups[groupName];
    if (!group) continue;
    
    if (group.words) {
      for (const w of group.words) words.add(w);
    }
    if (group.prefixes) {
      for (const p of group.prefixes) prefixes.push(p);
    }
    if (group.suffixes) {
      for (const s of group.suffixes) suffixes.push(s);
    }
    if (group.person_triggers) {
      for (const t of group.person_triggers) personTriggers.push(t);
    }
    if (group.role_triggers) {
      for (const t of group.role_triggers) roleTriggers.push(t);
    }
    if (group.place_triggers) {
      for (const t of group.place_triggers) placeTriggers.push(t);
    }
  }
  
  return { words, prefixes, suffixes, personTriggers, roleTriggers, placeTriggers };
}

// ========== 1.1 n-gram 提取 + 最大匹配去重 ==========

/**
 * 从文本数组中提取 n-gram 短语及频率（带最大匹配去重）
 * 
 * 核心策略（来自经验教训）：
 * - 不使用"包含即否决"的粗粒度子串过滤
 * - 而是采用"最大匹配优先"原则：长短语被保留，其子串仅在频率显著低于长短语时被视为独立词条
 * - 使用结构化约束（长度差 + 频率比 + 位置特征）来区分"真子串"和"独立词"
 */
function extractNgramsV2(texts, options = {}) {
  const { minLen = 2, maxLen = 4, minFreq = 2 } = options;
  const activeStopwords = getActiveStopwords();
  const stopwordSet = activeStopwords.words;
  
  // 第一阶段：提取所有 n-gram 频率
  const freqMap = new Map();
  const fileMap = new Map();
  
  for (const textEntry of texts) {
    const { text: rawText, file } = textEntry;
    const cleaned = rawText.replace(/[\s,.!?;:'"()\[\]{}《》<>—–\-~·@#$%^&*+=|\\\/，。！？；：、（）【】「」『』〈〉—～·]/g, '');
    
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i <= cleaned.length - len; i++) {
        const phrase = cleaned.substring(i, i + len);
        if (/^[0-9a-zA-Z]+$/.test(phrase)) continue;
        if (stopwordSet.has(phrase)) continue;
        
        if (!freqMap.has(phrase)) {
          freqMap.set(phrase, 0);
          fileMap.set(phrase, new Set());
        }
        freqMap.set(phrase, freqMap.get(phrase) + 1);
        fileMap.get(phrase).add(file);
      }
    }
  }
  
  // 第二阶段：最大匹配去重
  // 按短语长度降序排列，长短语优先成为"主词条"
  const allEntries = [...freqMap.entries()]
    .filter(([, count]) => count >= minFreq)
    .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
  
  const mainEntries = new Map();
  const suppressed = new Set(); // 被长短语抑制的子串
  
  for (const [phrase, count] of allEntries) {
    if (suppressed.has(phrase)) continue;
    
    // 检查是否是已收录长短语的子串
    let isRedundantSubstring = false;
    
    for (const [mainPhrase, mainCount] of mainEntries) {
      if (mainPhrase.includes(phrase) && mainPhrase !== phrase) {
        // 结构化约束判断：
        // 1. 子串频率不显著低于长短语（比值 > 0.4 表示子串可能是独立词）
        const ratio = count / mainCount;
        
        // 2. 长度约束：长短语必须比子串长至少1字，且子串长度不能太长
        const lenDiff = mainPhrase.length - phrase.length;
        
        // 3. 位置约束：检查子串是否是长短语的"核心部分"
        //    例如 "云知意" -> "知意"（核心在尾部） vs "尚书令" -> "书令"（非连续）
        //    连续子串用 includes 已保证，这里额外检查子串是否只在长短语中出现
        const onlyInLongPhrase = isSubstringOnlyUsedIn(phrase, mainPhrase, texts);
        
        if (lenDiff >= 1) {
          // 如果子串频率接近长短语（ratio > 0.6），说明子串本身也很常见
          // 此时不抑制，而是保留两个词条，标记为"可能相关"
          if (ratio > 0.6 || onlyInLongPhrase === false && ratio > 0.4) {
            // 保留为独立词条，不抑制
          } else if (ratio <= 0.4 || onlyInLongPhrase) {
            // 子串频率明显低或仅出现在长短语中 -> 抑制
            isRedundantSubstring = true;
            suppressed.add(phrase);
            break;
          }
        }
      }
    }
    
    if (!isRedundantSubstring) {
      mainEntries.set(phrase, {
        count,
        files: fileMap.get(phrase),
        length: phrase.length
      });
    }
  }
  
  return { freqMap: mainEntries, suppressed };
}

/**
 * 检查短语B是否只作为短语A的子串出现（而非独立出现）
 * 通过统计包含A的文本 vs 包含B的文本的比例来判断
 */
function isSubstringOnlyUsedIn(shortPhrase, longPhrase, texts) {
  let shortTotalCount = 0;
  let shortOnlyInLongCount = 0;
  
  for (const { text } of texts) {
    // 去除标点后的文本
    const cleaned = text.replace(/[\s,.!?;:'"()\[\]{}《》<>—–\-~·@#$%^&*+=|\\\/，。！？；：、（）【】「」『』〈〉—～·]/g, '');
    
    // 统计短词出现次数
    const shortRegex = new RegExp(escapeRegex(shortPhrase), 'g');
    const shortMatches = cleaned.match(shortRegex);
    if (!shortMatches) continue;
    
    shortTotalCount += shortMatches.length;
    
    // 统计短词作为长词子串出现的次数
    const longRegex = new RegExp(escapeRegex(longPhrase), 'g');
    const longMatches = cleaned.match(longRegex);
    const longCount = longMatches ? longMatches.length : 0;
    
    // 简单启发式：如果长词出现次数 >= 短词出现次数，短词可能只是子串
    if (longCount >= shortMatches.length) {
      shortOnlyInLongCount += shortMatches.length;
    }
  }
  
  if (shortTotalCount === 0) return false;
  // 如果超过80%的短词出现都伴随着长词出现，认为短词只是子串
  return (shortOnlyInLongCount / shortTotalCount) > 0.8;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========== 1.2 称谓前后缀启发式规则 ==========

/**
 * 主动识别"称谓+姓名"模式
 * 不是被动统计频率，而是用结构化规则主动捕获人物名称
 * 
 * 识别类型：
 * - 前缀型：公子XX、大人XX、微臣XX、陛下XX、老师XX
 * - 后缀型：XX大人、XX姑娘、XX公子、XX娘娘、XX先生
 * - 双重型：大人XX先生
 */
function detectNameByAffixes(texts, options = {}) {
  const activeStopwords = getActiveStopwords();
  const { prefixes = [], suffixes = [] } = activeStopwords;
  const minNameLen = options.minNameLen || 2;
  const maxNameLen = options.maxNameLen || 3;
  
  const nameCandidates = new Map(); // name -> { count, files, sources: [] }
  
  for (const { text: rawText, file } of texts) {
    const cleaned = rawText.replace(/[\s,.!?;:'"()\[\]{}《》<>—–\-~·@#$%^&*+=|\\\/，。！？；：、（）【】「」『』〈〉—～·]/g, '');
    
    // 前缀匹配：prefix + name
    for (const prefix of prefixes) {
      const prefixLen = prefix.length;
      let idx = 0;
      while (idx < cleaned.length - prefixLen) {
        const seg = cleaned.substring(idx, idx + prefixLen);
        if (seg === prefix) {
          // 尝试提取前缀后的名字
          for (let nameLen = minNameLen; nameLen <= maxNameLen && idx + prefixLen + nameLen <= cleaned.length; nameLen++) {
            const name = cleaned.substring(idx + prefixLen, idx + prefixLen + nameLen);
            // 名字不应以数字/字母开头
            if (!/^[0-9a-zA-Z]/.test(name) && !activeStopwords.words.has(name)) {
              addNameCandidate(nameCandidates, name, file, 'prefix:' + prefix);
            }
          }
          // 只移1位，允许重叠匹配
          idx += 1;
        } else {
          idx += 1;
        }
      }
    }
    
    // 后缀匹配：name + suffix
    for (const suffix of suffixes) {
      const suffixLen = suffix.length;
      let idx = 0;
      while (idx < cleaned.length - suffixLen) {
        const seg = cleaned.substring(idx, idx + suffixLen);
        if (seg === suffix) {
          // 尝试提取后缀前的名字
          for (let nameLen = minNameLen; nameLen <= maxNameLen && idx - nameLen >= 0; nameLen++) {
            const name = cleaned.substring(idx - nameLen, idx);
            if (!/^[0-9a-zA-Z]/.test(name) && !activeStopwords.words.has(name)) {
              // 检查名字不是单纯的停用词组合
              if (!isPureStopwords(name, activeStopwords.words)) {
                addNameCandidate(nameCandidates, name, file, 'suffix:' + suffix);
              }
            }
          }
          idx += 1;
        } else {
          idx += 1;
        }
      }
    }
  }
  
  // 过滤：至少出现2次
  const result = new Map();
  for (const [name, info] of nameCandidates) {
    if (info.count >= 2) {
      result.set(name, info);
    }
  }
  
  return result;
}

function addNameCandidate(nameCandidates, name, file, source) {
  if (!nameCandidates.has(name)) {
    nameCandidates.set(name, { count: 0, files: new Set(), sources: new Set() });
  }
  const info = nameCandidates.get(name);
  info.count++;
  info.files.add(file);
  info.sources.add(source);
}

function isPureStopwords(name, stopwordSet) {
  // 名字中每个字都不是独立停用词
  for (const ch of name) {
    if (stopwordSet.has(ch)) return true;
  }
  return false;
}

// ========== 1.3 上下文词性区分 ==========

/**
 * 基于上下文判断短语的语义类型
 * 
 * 不做词性标注（无外部依赖），而是用"触发词"启发式规则：
 * - 短语后紧跟/邻近"道、说、笑"等 -> 高概率人名
 * - 短语前紧邻"任、封、贬"等 -> 高概率官职
 * - 短语邻近"去、到、在"+地名后缀 -> 可能地名
 */
function classifyByContext(phrase, texts, options = {}) {
  const activeStopwords = getActiveStopwords();
  const { personTriggers, roleTriggers, placeTriggers } = activeStopwords;
  
  const scores = { person: 0, role: 0, place: 0 };
  const contextWindows = [];
  
  for (const { text: rawText, file } of texts) {
    // 保留标点的原文用于上下文判断
    const text = rawText.replace(/\n/g, '');
    
    let idx = 0;
    while (true) {
      idx = text.indexOf(phrase, idx);
      if (idx === -1) break;
      
      // 提取短语前后各10字的上下文窗口
      const beforeStart = Math.max(0, idx - 10);
      const afterEnd = Math.min(text.length, idx + phrase.length + 10);
      const before = text.substring(beforeStart, idx);
      const after = text.substring(idx + phrase.length, afterEnd);
      
      contextWindows.push({ before, after, file, position: idx });
      
      // 人名触发：后文是否包含"道/说/笑/怒"等对话/动作动词
      for (const trigger of personTriggers) {
        if (after.includes(trigger)) {
          scores.person += 2;
          break;
        }
      }
      // 补充：前面有"对/向/跟"等介词 + 人名
      if (/[对向跟给替为朝]/.test(before)) {
        scores.person += 1;
      }
      
      // 官职触发：前文是否有"任/封/贬/升"等任命动词
      for (const trigger of roleTriggers) {
        if (before.includes(trigger)) {
          scores.role += 3;
          break;
        }
      }
      
      // 地名触发：后文有"去/到/在"或前文有"去/到/赴"
      for (const trigger of placeTriggers) {
        if (after.startsWith(trigger) || before.endsWith(trigger)) {
          scores.place += 2;
          break;
        }
      }
      // 地名启发：以"殿/宫/城/府/州/阁/堂"等结尾
      if (/[殿宫城府州阁堂院所部省郡县国邦]$/.test(phrase)) {
        scores.place += 3;
      }
      // 官职启发：以"令/尉/卿/相/侯/伯/子/男/使/者"等结尾
      if (/[令尉卿相侯伯子男使者]$/.test(phrase)) {
        scores.role += 2;
      }
      
      idx += phrase.length;
    }
  }
  
  // 判定类型
  const maxScore = Math.max(scores.person, scores.role, scores.place);
  let type = 'unknown';
  if (maxScore === 0) {
    type = 'unknown';
  } else if (scores.person > scores.role && scores.person > scores.place) {
    type = 'person';
  } else if (scores.role > scores.person && scores.role > scores.place) {
    type = 'role';
  } else if (scores.place > scores.person && scores.place > scores.role) {
    type = 'place';
  } else if (scores.person === maxScore && scores.person > 0) {
    type = 'person';
  } else {
    type = 'ambiguous';
  }
  
  return {
    type,
    scores,
    contextCount: contextWindows.length,
    sampleContexts: contextWindows.slice(0, 3).map(w => ({
      file: w.file,
      context: w.before + '【' + phrase + '】' + w.after
    }))
  };
}

// ========== 整合：构建候选术语 ==========

/**
 * 全流程构建候选术语
 * @param {Array<{name: string, content: string}>} subtitleFiles
 * @param {Object} options - { scene, minFreq, minLen, maxLen, maxItems, classifyContext }
 */
async function buildTermCandidatesV2(subtitleFiles, options = {}) {
  const {
    scene = 'ancient',
    minFreq = 2,
    minLen = 2,
    maxLen = 4,
    maxItems = 100,
    classifyContext = true
  } = options;
  
  // 1. 加载停用词
  await loadStopwords(scene);
  
  // 2. 解析所有字幕，提取文本
  const texts = [];
  for (const file of subtitleFiles) {
    const subs = parseSrt(file.content);
    for (const sub of subs) {
      if (sub.text && sub.text.trim()) {
        texts.push({ text: sub.text.replace(/\n/g, ''), file: file.name });
      }
    }
  }
  
  // 3. n-gram 提取 + 最大匹配去重
  const { freqMap, suppressed } = extractNgramsV2(texts, { minLen, maxLen, minFreq });
  
  // 4. 称谓启发式识别
  const nameCandidates = detectNameByAffixes(texts, { minNameLen: 2, maxNameLen: 3 });
  
  // 5. 合并候选
  const candidateMap = new Map();
  
  // 5a. 称谓识别的人名 -> 高优先级候选
  for (const [name, info] of nameCandidates) {
    if (!candidateMap.has(name)) {
      candidateMap.set(name, {
        source: name,
        frequency: info.count,
        fileCount: info.files.size,
        category: '人物指代',
        detectedBy: '称谓规则',
        note: '称谓启发式：' + [...info.sources].join(', ')
      });
    }
  }
  
  // 5b. n-gram 候选 -> 补充/合并
  for (const [phrase, info] of freqMap) {
    if (candidateMap.has(phrase)) {
      // 已是称谓识别的人名，更新信息
      const existing = candidateMap.get(phrase);
      existing.frequency = Math.max(existing.frequency, info.count);
      existing.fileCount = Math.max(existing.fileCount, info.files.size);
    } else {
      candidateMap.set(phrase, {
        source: phrase,
        frequency: info.count,
        fileCount: info.files.size,
        category: '待分类',
        detectedBy: 'n-gram 高频',
        note: ''
      });
    }
  }
  
  // 6. 上下文分类（可选）
  if (classifyContext) {
    const candidateEntries = [...candidateMap.values()];
    for (const candidate of candidateEntries) {
      const classification = classifyByContext(candidate.source, texts);
      candidate.contextType = classification.type;
      candidate.contextScores = classification.scores;
      candidate.sampleContexts = classification.sampleContexts;
      
      // 根据上下文调整类别
      if (candidate.category === '待分类') {
        if (classification.type === 'person') {
          candidate.category = '疑似人名';
        } else if (classification.type === 'role') {
          candidate.category = '疑似官职/称谓';
        } else if (classification.type === 'place') {
          candidate.category = '疑似地名';
        } else {
          candidate.category = '专有名词';
        }
      }
      
      candidate.classificationDetail = `人:${classification.scores.person} 职:${classification.scores.role} 地:${classification.scores.place}`;
    }
  }
  
  // 7. 排序 + 限制
  const result = [...candidateMap.values()].sort((a, b) => {
    // 人物指代优先
    if (a.category.startsWith('人物') && !b.category.startsWith('人物')) return -1;
    if (!a.category.startsWith('人物') && b.category.startsWith('人物')) return 1;
    // 按频率降序
    return b.frequency - a.frequency;
  }).slice(0, maxItems);
  
  return {
    candidates: result,
    suppressedCount: suppressed.size,
    nameCandidateCount: nameCandidates.size,
    totalNgramCandidates: freqMap.size
  };
}

// ========== 导出工具 ==========

function exportTermsToExcelV2(candidates, filename = 'candidate_terms.xlsx') {
  if (!window.XLSX) {
    throw new Error('需要先加载 SheetJS (xlsx) 库');
  }
  
  const rows = [
    ['Source', 'Target', 'Category', 'Frequency', 'File Count', 'Detection', 'Context', 'Note'],
    ...candidates.map(t => [
      t.source,
      t.target || '',
      t.category,
      t.frequency,
      t.fileCount,
      t.detectedBy || '',
      t.classificationDetail || '',
      t.note || ''
    ])
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
    { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 30 }
  ];
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidate Terms');
  XLSX.writeFile(wb, filename);
}

// ========== 智谱 AI API 调用 ==========

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// 获取存储的 API Key
function getZhipuApiKey() {
  return localStorage.getItem('zhipu_api_key') || '';
}

// 保存 API Key
function setZhipuApiKey(key) {
  localStorage.setItem('zhipu_api_key', key);
}

// 基础聊天请求
async function zhipuChat(messages, options = {}) {
  const apiKey = getZhipuApiKey();
  if (!apiKey) {
    throw new Error('请先在"AI 设置"中填写智谱 API Key');
  }

  const body = {
    model: options.model || 'glm-4-flash',
    messages: messages,
    temperature: options.temperature ?? 0.3,
    stream: false
  };

  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const resp = await fetch(ZHIPU_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      errMsg = errBody.error?.message || errBody.msg || errMsg;
    } catch (e) {}
    if (resp.status === 401) {
      throw new Error('API Key 无效或已过期，请检查"AI 设置"');
    }
    if (resp.status === 429) {
      throw new Error('请求频率过高或额度不足，请稍后再试');
    }
    throw new Error('智谱 API 调用失败：' + errMsg);
  }

  const data = await resp.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('智谱 API 返回结构异常');
  }
  return data.choices[0].message.content;
}

// AI 精排：批量判断候选词是否为术语，分类并给翻译建议
async function zhipuRefineTerms(candidatesBatch, scene) {
  const sceneDesc = {
    ancient: '古装/历史剧',
    modern: '现代/都市剧',
    scifi: '科幻/未来题材',
    general: '通用'
  }[scene] || '通用';

  const termsInfo = candidatesBatch.map((c, i) => {
    const ctx = (c.sampleContexts && c.sampleContexts[0]) 
      ? c.sampleContexts[0].context.substring(0, 60) 
      : '';
    return `${i + 1}. "${c.source}" (频率:${c.frequency}, 出现集数:${c.fileCount}) 上下文:"${ctx}"`;
  }).join('\n');

  const systemPrompt = `你是一个字幕翻译术语识别专家。我会给你一批从${sceneDesc}字幕中提取的候选词，请你判断每个词是否是需要人工翻译的专有名词（人名、地名、官职、特殊用词等），并给出分类和翻译建议。

判断标准：
- 人名：角色名称、称呼、绰号
- 官职：古代官位、头衔、封号
- 地名：城市、建筑、区域名
- 其他：武功招式、门派、特殊物品等需人工翻译的词
- 非术语：普通词汇、常用短语、语气词等（标记为 reject）

请严格以JSON格式返回，不要包含其他文字：
{"results":[{"index":1,"is_term":true,"category":"人名","target":"建议翻译","reason":"简短理由"}]}`;

  const userPrompt = `请分析以下候选词（共${candidatesBatch.length}个）：\n\n${termsInfo}`;

  const content = await zhipuChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { model: 'glm-4-flash', temperature: 0.2, responseFormat: 'json' });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // 尝试提取 JSON
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('AI 返回格式异常，无法解析为 JSON');
      }
    } else {
      throw new Error('AI 返回格式异常，无法解析');
    }
  }

  return parsed.results || [];
}

// AI 解释：针对单个术语，结合上下文给出详细说明
async function zhipuExplainTerm(phrase, contextLines, scene) {
  const sceneDesc = {
    ancient: '古装/历史剧',
    modern: '现代/都市剧',
    scifi: '科幻/未来题材',
    general: '通用'
  }[scene] || '通用';

  const ctxText = contextLines.map(ctx => {
    return `【${ctx.file}】\n${ctx.lines.map(l => 
      `${l.isMatch ? '▶' : ' '} #${l.index} ${l.text}`
    ).join('\n')}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `你是一个字幕翻译术语专家，擅长分析${sceneDesc}字幕中的人物和专有名词。请根据给定的术语和上下文，分析这个词语的含义并给出翻译建议。`;

  const userPrompt = `术语："${phrase}"

以下是该术语在字幕中出现的上下文：

${ctxText}

请回答以下问题（用简洁的中文）：
1. 这个词最可能是什么？（人名/地名/官职/其他专有名词/普通词汇）
2. 如果是人名，这个人是谁？有什么身份特征？
3. 是否需要人工翻译？为什么？
4. 建议的英文翻译是什么？（如不需要翻译则填"无需翻译"）`;

  const content = await zhipuChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { model: 'glm-4-flash', temperature: 0.4 });

  return content;
}