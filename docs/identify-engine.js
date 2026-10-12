// asset version: 12 — 改动任一包请整体 bump
// 依赖外部：srt-core.js 的 parseSrt
// 导出：STOPWORDS, extractNgrams, detectPersonVariants, detectProperNouns,
//        buildTermCandidates, exportTermsToExcel, loadStopwords, getDefaultStopwords,
//        getActiveStopwords, extractNgramsV2, isSubstringOnlyUsedIn, escapeRegex,
//        detectNameByAffixes, addNameCandidate, isPureStopwords, classifyByContext,
//        buildTermCandidatesV2, exportTermsToExcelV2

// ============================================================
// V1 术语识别引擎（基础版，保留向后兼容）
// ============================================================

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
 */
function extractNgrams(texts, minLen = 2, maxLen = 4) {
  const freqMap = new Map();
  const fileMap = new Map();

  for (const textEntry of texts) {
    const { text: rawText, file } = textEntry;
    const cleaned = rawText.replace(/[\s,\.\?\!\;\:\'\"\(\)\[\]\{\}\《\》\<\>\—\–\-\~\·\@\#\$\%\^\&\*\+\=\|\\\/，。！？；：、（）【】「」『』〈〉—～·@#$%^&*+=|\\\/]/g, '');

    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i <= cleaned.length - len; i++) {
        const phrase = cleaned.substring(i, i + len);
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

  const result = new Map();
  for (const [phrase, count] of freqMap) {
    if (count >= 2 && !STOPWORDS.has(phrase)) {
      result.set(phrase, { count, files: fileMap.get(phrase) });
    }
  }

  return result;
}

function detectPersonVariants(phraseFreq) {
  const variants = [];
  const phrases = [...phraseFreq.entries()].sort((a, b) => b[0].length - a[0].length);

  const usedAsVariant = new Set();

  for (const [longPhrase, longInfo] of phrases) {
    if (usedAsVariant.has(longPhrase)) continue;

    const longLen = longPhrase.length;
    for (const [shortPhrase, shortInfo] of phrases) {
      if (shortPhrase.length >= longLen) break;
      if (usedAsVariant.has(shortPhrase)) continue;

      if (longPhrase.includes(shortPhrase)) {
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

function detectProperNouns(phraseFreq, alreadyFound) {
  const nouns = [];

  for (const [phrase, info] of phraseFreq) {
    if (alreadyFound.has(phrase)) continue;
    if (phrase.length < 2) continue;

    const fileCount = info.files.size;
    const minFreq = phrase.length <= 2 ? 5 : 2;
    if (info.count < minFreq) continue;

    if (fileCount < 2) continue;

    nouns.push({
      phrase,
      count: info.count,
      files: info.files
    });
  }

  nouns.sort((a, b) => b.count - a.count);
  return nouns;
}

async function buildTermCandidates(subtitleFiles) {
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

  const phraseFreq = extractNgrams(texts, 2, 4);
  const variants = detectPersonVariants(phraseFreq);

  const variantSet = new Set();
  for (const v of variants) {
    variantSet.add(v.full);
    variantSet.add(v.short);
  }

  const properNouns = detectProperNouns(phraseFreq, variantSet);

  const allTerms = [];

  for (const v of variants) {
    allTerms.push({
      source: v.full,
      target: '',
      category: '人物指代',
      frequency: v.fullCount,
      fileCount: v.files.size,
      note: `包含变体：${v.short}（出现${v.shortCount}次）`
    });
  }

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

function exportTermsToExcel(terms, filename = 'candidate_terms.xlsx') {
  if (!window.XLSX) {
    throw new Error('需要先加载 SheetJS (xlsx) 库');
  }

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

  ws['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 30 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidate Terms');
  XLSX.writeFile(wb, filename);
}

// ============================================================
// V2 术语识别引擎（优化版：最大匹配去重 + 称谓启发式 + 上下文分类）
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

// ========== n-gram 提取 + 最大匹配去重 ==========

function extractNgramsV2(texts, options = {}) {
  const { minLen = 2, maxLen = 4, minFreq = 2 } = options;
  const activeStopwords = getActiveStopwords();
  const stopwordSet = activeStopwords.words;

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

  const allEntries = [...freqMap.entries()]
    .filter(([, count]) => count >= minFreq)
    .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);

  const mainEntries = new Map();
  const suppressed = new Set();

  for (const [phrase, count] of allEntries) {
    if (suppressed.has(phrase)) continue;

    let isRedundantSubstring = false;

    for (const [mainPhrase, mainCount] of mainEntries) {
      if (mainPhrase.includes(phrase) && mainPhrase !== phrase) {
        const ratio = count / mainCount;
        const lenDiff = mainPhrase.length - phrase.length;
        const onlyInLongPhrase = isSubstringOnlyUsedIn(phrase, mainPhrase, texts);

        if (lenDiff >= 1) {
          if (ratio > 0.6 || onlyInLongPhrase === false && ratio > 0.4) {
            // 保留为独立词条，不抑制
          } else if (ratio <= 0.4 || onlyInLongPhrase) {
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

function isSubstringOnlyUsedIn(shortPhrase, longPhrase, texts) {
  let shortTotalCount = 0;
  let shortOnlyInLongCount = 0;

  for (const { text } of texts) {
    const cleaned = text.replace(/[\s,.!?;:'"()\[\]{}《》<>—–\-~·@#$%^&*+=|\\\/，。！？；：、（）【】「」『』〈〉—～·]/g, '');

    const shortRegex = new RegExp(escapeRegex(shortPhrase), 'g');
    const shortMatches = cleaned.match(shortRegex);
    if (!shortMatches) continue;

    shortTotalCount += shortMatches.length;

    const longRegex = new RegExp(escapeRegex(longPhrase), 'g');
    const longMatches = cleaned.match(longRegex);
    const longCount = longMatches ? longMatches.length : 0;

    if (longCount >= shortMatches.length) {
      shortOnlyInLongCount += shortMatches.length;
    }
  }

  if (shortTotalCount === 0) return false;
  return (shortOnlyInLongCount / shortTotalCount) > 0.8;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========== 称谓前后缀启发式规则 ==========

function detectNameByAffixes(texts, options = {}) {
  const activeStopwords = getActiveStopwords();
  const { prefixes = [], suffixes = [] } = activeStopwords;
  const minNameLen = options.minNameLen || 2;
  const maxNameLen = options.maxNameLen || 3;

  const nameCandidates = new Map();

  for (const { text: rawText, file } of texts) {
    const cleaned = rawText.replace(/[\s,.!?;:'"()\[\]{}《》<>—–\-~·@#$%^&*+=|\\\/，。！？；：、（）【】「」『』〈〉—～·]/g, '');

    for (const prefix of prefixes) {
      const prefixLen = prefix.length;
      let idx = 0;
      while (idx < cleaned.length - prefixLen) {
        const seg = cleaned.substring(idx, idx + prefixLen);
        if (seg === prefix) {
          for (let nameLen = minNameLen; nameLen <= maxNameLen && idx + prefixLen + nameLen <= cleaned.length; nameLen++) {
            const name = cleaned.substring(idx + prefixLen, idx + prefixLen + nameLen);
            if (!/^[0-9a-zA-Z]/.test(name) && !activeStopwords.words.has(name)) {
              addNameCandidate(nameCandidates, name, file, 'prefix:' + prefix);
            }
          }
          idx += 1;
        } else {
          idx += 1;
        }
      }
    }

    for (const suffix of suffixes) {
      const suffixLen = suffix.length;
      let idx = 0;
      while (idx < cleaned.length - suffixLen) {
        const seg = cleaned.substring(idx, idx + suffixLen);
        if (seg === suffix) {
          for (let nameLen = minNameLen; nameLen <= maxNameLen && idx - nameLen >= 0; nameLen++) {
            const name = cleaned.substring(idx - nameLen, idx);
            if (!/^[0-9a-zA-Z]/.test(name) && !activeStopwords.words.has(name)) {
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
  for (const ch of name) {
    if (stopwordSet.has(ch)) return true;
  }
  return false;
}

// ========== 上下文词性区分 ==========

function classifyByContext(phrase, texts, options = {}) {
  const activeStopwords = getActiveStopwords();
  const { personTriggers, roleTriggers, placeTriggers } = activeStopwords;

  const scores = { person: 0, role: 0, place: 0 };
  const contextWindows = [];

  for (const { text: rawText, file } of texts) {
    const text = rawText.replace(/\n/g, '');

    let idx = 0;
    while (true) {
      idx = text.indexOf(phrase, idx);
      if (idx === -1) break;

      const beforeStart = Math.max(0, idx - 10);
      const afterEnd = Math.min(text.length, idx + phrase.length + 10);
      const before = text.substring(beforeStart, idx);
      const after = text.substring(idx + phrase.length, afterEnd);

      contextWindows.push({ before, after, file, position: idx });

      for (const trigger of personTriggers) {
        if (after.includes(trigger)) {
          scores.person += 2;
          break;
        }
      }
      if (/[对向跟给替为朝]/.test(before)) {
        scores.person += 1;
      }

      for (const trigger of roleTriggers) {
        if (before.includes(trigger)) {
          scores.role += 3;
          break;
        }
      }

      for (const trigger of placeTriggers) {
        if (after.startsWith(trigger) || before.endsWith(trigger)) {
          scores.place += 2;
          break;
        }
      }
      if (/[殿宫城府州阁堂院所部省郡县国邦]$/.test(phrase)) {
        scores.place += 3;
      }
      if (/[令尉卿相侯伯子男使者]$/.test(phrase)) {
        scores.role += 2;
      }

      idx += phrase.length;
    }
  }

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
 * @param {Function|null} onProgress - 进度回调 (phase, current, total, message)
 */
async function buildTermCandidatesV2(subtitleFiles, options = {}, onProgress = null) {
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

  // 2. 解析所有字幕，提取文本（按文件报进度）
  const texts = [];
  for (let i = 0; i < subtitleFiles.length; i++) {
    const file = subtitleFiles[i];
    if (onProgress) onProgress('parse', i + 1, subtitleFiles.length, `解析字幕中… ${i + 1}/${subtitleFiles.length}`);
    const subs = parseSrt(file.content);
    for (const sub of subs) {
      if (sub.text && sub.text.trim()) {
        texts.push({ text: sub.text.replace(/\n/g, ''), file: file.name });
      }
    }
  }

  // 3. n-gram 提取 + 最大匹配去重
  if (onProgress) onProgress('ngram', 0, 0, '提取 n-gram 短语…');
  const { freqMap, suppressed } = extractNgramsV2(texts, { minLen, maxLen, minFreq });

  // 4. 称谓启发式识别
  if (onProgress) onProgress('affix', 0, 0, '称谓启发式识别…');
  const nameCandidates = detectNameByAffixes(texts, { minNameLen: 2, maxNameLen: 3 });

  // 5. 合并候选
  const candidateMap = new Map();

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

  for (const [phrase, info] of freqMap) {
    if (candidateMap.has(phrase)) {
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
    const total = candidateEntries.length;
    for (let i = 0; i < total; i++) {
      const candidate = candidateEntries[i];
      if (onProgress && (i % 10 === 0 || i === total - 1)) {
        onProgress('classify', i + 1, total, `上下文分类… ${i + 1}/${total}`);
      }
      const classification = classifyByContext(candidate.source, texts);
      candidate.contextType = classification.type;
      candidate.contextScores = classification.scores;
      candidate.sampleContexts = classification.sampleContexts;

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
    if (a.category.startsWith('人物') && !b.category.startsWith('人物')) return -1;
    if (!a.category.startsWith('人物') && b.category.startsWith('人物')) return 1;
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
