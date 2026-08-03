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