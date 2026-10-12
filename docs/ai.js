// asset version: 12 — 改动任一包请整体 bump
// 依赖外部：无
// 导出：ZHIPU_API_URL, getZhipuApiKey, setZhipuApiKey, zhipuChat,
//        zhipuRefineTerms, zhipuExplainTerm

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
