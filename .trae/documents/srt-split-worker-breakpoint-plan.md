# srt.js 拆分 + identify Worker + 断点统一 实施计划

## Context（为什么做这个改动）

`d:\subtitle-toolkit\docs\srt.js`（1471 行）把 SRT 解析、替换引擎、n-gram 识别、AI API、文件保存工具混在一个文件，4 个页面（replace/fix/identify/align）全量加载且版本号不一致（v8~v11）。同时 `identify.html` 的术语识别在主线程执行，上百集 SRT 会让 UI 卡死——这违反项目硬约束"术语识别必须用 Web Workers 防 UI 阻塞"。另外 `style.css` 的响应式断点混乱（720/600/900 三个值混用），窄屏下不同区块堆叠顺序错位。

本次三项重构：① srt.js 拆 4 包按需加载；② identify 迁移到 Web Worker（AI 留主线程）；③ 断点统一到主断点 900px + 保留 600 做组件微调。

---

## 任务 1：srt.js 拆分（4 包 + utils 扩充）

### 拆分映射

| 新文件 | 内容 | 来源行号 |
|---|---|---|
| `srt-core.js` | parseSrt, formatTimecode, generateSrt, naturalCompare, extractSrtFromFileList, extractSrtFromDropEvent, readDroppedFolder, **PUNCTUATION**（公共常量，只在此定义一次） | srt.js L5-89, L623-693, L91-93 |
| `replace-engine.js` | parseGlossary, sortEntries, _tryAdd, findNonOverlapping, replaceText, scanTextHits（依赖 srt-core 的 PUNCTUATION，**不再声明**） | srt.js L417-560 |
| `identify-engine.js` | STOPWORDS, extractNgrams(V1+V2), detectPersonVariants, detectProperNouns, buildTermCandidates(V1+V2), detectNameByAffixes, classifyByContext, getActiveStopwords, loadStopwords, getDefaultStopwords, exportTermsToExcel(V1+V2), escapeRegex, isSubstringOnlyUsedIn, isPureStopwords, addNameCandidate | srt.js L91-149, L150-416, L710-1318 |
| `ai.js` | ZHIPU_API_URL, getZhipuApiKey, setZhipuApiKey, zhipuChat, zhipuRefineTerms, zhipuExplainTerm | srt.js L1320-1471 |
| `utils.js`（扩充） | 现有 escapeHtml + 新增 saveFilesToFolder, escapeHtmlAttr（= escapeHtml + `"` 转义） | srt.js L694-728, fix.html 内联 |

### 各页面加载方案（统一 ?v=12）

| 页面 | 引用脚本 |
|---|---|
| replace.html | srt-core + replace-engine + utils |
| fix.html | srt-core + utils（删内联 escapeHtmlAttr） |
| identify.html | srt-core + identify-engine + ai + utils |
| align.html | srt-core + utils |
| 其余页面（index/reorganize/preprocess/flatten/rename） | 仅 utils（不变） |
| scan-worker.js | `importScripts('srt-core.js?v=12')` + `importScripts('replace-engine.js?v=12')`（顺序不能反） |

### 执行顺序（三段式，零风险优先）

1. **建包阶段（不改任何引用）**：新建 4 个 .js 文件 + 扩充 utils.js，从 srt.js 原样搬运函数。**保留 srt.js 不动**，现有引用继续可用。每个新包顶部加注释 `// asset version: 12`。
2. **切换引用（逐页改，改一个测一个）**：顺序 align → fix → replace（含 scan-worker）→ identify。每页改完立即手动验证。
3. **删除 srt.js**：4 页全部切换并验证通过后删除，确认无遗漏引用。

### 风险点

- **PUNCTUATION 只在 srt-core 定义一次**，replace-engine 直接读全局，不再声明。
- **scan-worker.js 的 importScripts 顺序**：srt-core 必须在 replace-engine 之前。
- **fix.html 删内联 escapeHtmlAttr**（行 ~1077），避免与 utils 全局重名静默覆盖。
- **版本号统一手写 ?v=12**，不引入 ASSET_VER 常量（HTML 静态 src 无法被 JS 改写，Worker importScripts 也需静态字符串）。约定：今后任一包改动，所有 `?v=` 整体 +1。

---

## 任务 2：identify-worker.js 消息协议

### 消息格式（镜像 scan-worker.js 的 type 风格）

**主线程 → Worker（请求）**：
```
{ type: 'identify', subtitleFiles: [{name, content}], options: {scene, minFreq, minLen, maxLen, maxItems, classifyContext} }
```
subtitleFiles 在主线程已通过 loadSubtitleFiles 读好内容传入，Worker 不碰 File API。

**Worker → 主线程（响应）**三种：
- 进度：`{ type: 'progress', phase: 'parse'|'ngram'|'affix'|'classify', current, total, message }`
- 结果：`{ type: 'result', candidates, suppressedCount, nameCandidateCount, totalNgramCandidates }`
- 错误：`{ type: 'error', message }`

phase 对应 buildTermCandidatesV2 的 4 个对外可见阶段：parse=步骤2 解析字幕（按文件报 current/total），ngram=步骤3 提取 n-gram，affix=步骤4 称谓识别，classify=步骤6 上下文分类。其余步骤太快不报。

### buildTermCandidatesV2 签名改造

新签名：`async function buildTermCandidatesV2(subtitleFiles, options = {}, onProgress = null)`

约定 `onProgress(phase, current, total, message)`。parse 阶段在 for 循环内按文件报 current/total（唯一有意义的逐项进度），其余三阶段整体算完报一次 message 即可。onProgress 默认 null，向后兼容（主线程将来也能复用带 UI 进度条）。

### Worker 内部结构

```js
// identify-worker.js
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
```

### identify.html 主线程改造（行 368 onclick）

把 `await buildTermCandidatesV2(...)` 替换为：
1. `const worker = new Worker('identify-worker.js');`
2. `worker.postMessage({ type: 'identify', subtitleFiles, options });`
3. `worker.onmessage` 按 type 分发：
   - `progress` → 更新 statusIdentify.textContent（沿用现有 className 切换逻辑）
   - `result` → 赋值 candidates/fullResult，触发 renderAll/renderByCategory，显示 resultSummary
   - `error` → 走现有 catch 分支
4. Worker 用完即 `terminate`（识别是一次性任务，不常驻）。

**AI 按钮不动**：btnAiRefine / btnAiExplain 仍在主线程直接调 ai.js，从 localStorage 取 key（避免 Worker 内 fetch CORS 限制 + 凭证传递复杂度）。

### 风险点

- **loadStopwords 在 Worker 内 fetch stopwords.json**：同源 fetch 在 Worker 允许，但 **file:// 协议下 Worker 的 fetch 会被 Chrome 拦**。验证必须用本地 HTTP 服务器（见验证章节）。
- **Worker 内异常要 try/catch 包 postMessage error**，否则静默崩溃主线程无反馈。

---

## 任务 3：style.css 断点统一

### 逐项编辑清单

| 行号 | 当前 | 操作 | 原因 |
|---|---|---|---|
| 449-451 | `@media 720 .scan-layout 1fr` | **删除整块** | 与 2728 重复（2728 有 !important 更稳） |
| 572-576 | `@media 600 hud 微调` | **保留，加注释** | 组件级字号/间距微调，非结构性 |
| 1847-1877 | `@media 720 batch-toolbar/modal/context-line` | **720 改 900** | 结构性堆叠，应与 900 基准统一 |
| 2701-2705 | `@media 900 workflow-row` | 不动 | 已是基准 |
| 2728-2731 | `@media 900 scan-layout/healthResult` | 不动 | 基准 |

### 最终 @media 布局（3 个断点，分散但合理）

- 行 ~572：`@media 600` hud 组件微调（加注释 `/* 组件级微调：hud 间距/字号，独立于 900 结构断点 */`）
- 行 ~2701：`@media 900` workflow-row（首页工作流，基准来源）
- 行 ~2728：`@media 900` 合并 scan-layout + healthResult +（从 1847 移来的）batch-toolbar/modal/context-line

**不强行集中所有 @media 到文件末尾**：现有"组件就近 + 末尾汇总"混合结构，强行搬迁会产生大 diff 增加回归风险，且 600 的 hud 微调本就该贴着 hud 组件。

### 具体编辑

1. 删除行 449-451（含 `@media (max-width: 720px) {` 和 `}`）。
2. 行 572 上方加注释 `/* 组件级微调：hud 间距/字号，独立于 900 结构断点 */`。
3. 行 1847 的 `@media (max-width: 720px)` 改为 `@media (max-width: 900px)`，块内规则全部保留。
4. （可选）把改完的 1847 块内容移到 2728 块里合并成一个大 `@media 900`。若担心 diff 太大可保留两块分开，都 900 即可。

---

## 执行顺序

**任务 1（建包）→ 任务 1（切换引用）→ 任务 2（identify Worker）→ 任务 3（CSS 断点）**。

- 任务 2 依赖任务 1 的 identify-engine.js，必须 1 先完成。
- 任务 3（CSS）与 JS 无依赖，放最后能在 JS 重构稳定后专心做视觉验证，CSS 回归更易隔离。

---

## 验证

### 必须起本地 HTTP 服务器（file:// 不适用）

```
python -m http.server 8000 --directory d:\subtitle-toolkit\docs
```
访问 http://localhost:8000/各页.html。理由：Worker 内 fetch stopwords.json 在 file:// 下会被 Chrome 拦。

### 各页验证清单

1. **align.html**（最先切）：加载 `示例\字幕原版.srt` + `示例\公司替换.srt`，跑时间轴对比，确认 parseSrt/formatTimecode 正常。
2. **fix.html**：加载 SRT 跑健康检查 + 关键词删除，重点验 escapeHtmlAttr（改用 utils 版）渲染属性值无 XSS、表格正常。
3. **replace.html**：加载 `samples\glossary_sample.xlsx` + SRT 文件夹，点扫描——**必须验 scan-worker**（改了 importScripts 两个包），确认扫描结果条数、上下文前后 2 行正确。然后执行替换导出。
4. **identify.html**（任务 2 核心）：加载 SRT 文件夹，点开始识别——验证 Worker 模式下 statusIdentify 有阶段进度文本切换（parse→ngram→affix→classify）、最终候选数与拆分前一致。用 `samples\subtitles_sample.zip` 跑一次，确认不再卡死。AI 精排/解释需自备智谱 key，可选验。
5. **其余页面**（reorganize/rename/preprocess/flatten/index）：只引 utils.js，快速点一遍 nav 和核心功能即可。

### 关键回归信号

- F12 Console 有 "X is not defined" → 函数漏搬或加载顺序错。
- scan-worker 报 "scanTextHits is not defined" → replace-engine 没在 srt-core 之后 importScripts，或版本号没生效加载了旧缓存。
- Ctrl+F5 后看 Network 面板 `?v=12` 是否生效。
- DevTools 拖拽窗口宽度过 900px，看扫描页/修复页双栏→单栏切换。

### 关键文件清单

- d:\subtitle-toolkit\docs\srt.js（拆分源，搬运后删除）
- d:\subtitle-toolkit\docs\scan-worker.js（改 importScripts）
- d:\subtitle-toolkit\docs\identify.html（任务 2 主线程改造 + 任务 1 切 script 引用）
- d:\subtitle-toolkit\docs\identify-worker.js（新建）
- d:\subtitle-toolkit\docs\srt-core.js / replace-engine.js / identify-engine.js / ai.js（新建）
- d:\subtitle-toolkit\docs\utils.js（扩充）
- d:\subtitle-toolkit\docs\style.css（任务 3 改 @media，行 449/572/1847/2728）
- d:\subtitle-toolkit\docs\replace.html / fix.html / align.html（切 script 引用 + fix 删内联 escapeHtmlAttr）
