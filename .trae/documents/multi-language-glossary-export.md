# 多语言清单 + 多文件夹导出 实施计划

## Context

`replace.html` 当前只支持单份本地化清单：上传一个 xlsx（Source/Target 两列）→ 扫描字幕命中 → 勾选 → 输出一份替换后字幕（ZIP 或文件夹）。用户希望一次性投入多份本地化清单（每份绑定一个目标语言），用同一份字幕扫描一次命中，结果按语言组织成多个子文件夹一并导出。同时希望保留"同一条字幕勾选一次复用到所有语言"的便利，又允许对单条命中做每语言独立的 Target 改写或跳过。冲突检测不需要。

替换流程目前完全在前端完成（`replace.html` 用 `JSZip` 本地打包、调用 `srt.js` 的 `replaceText`），无后端 API 调用。本次改造延续前端驱动模式，**不动后端**。

## 关键设计决策（已与用户确认）

1. **语言标签**：固定下拉 `en / zh-CN / ja / ko / es / th / fr / de`（每份上传的术语表独立选择）
2. **输出形态**：默认一个 ZIP，内部按语言分子文件夹 `replaced/<lang>/<file>.srt`；勾选"导出为文件夹"时走 File System Access API，弹一次 picker，在该目录下创建 `<lang>/` 子目录
3. **命中预览 UI**：一张大表，每行多列 Target（en | ja | ko | …），同一行勾选复用到所有语言
4. **勾选语义**：行级 checkbox = 主开关（在 `selectedIds` 里）；每语言 Target 单元格 = 可编辑文本输入框，**留空 = 跳过该语言对此命中的替换**，有值 = 用该值作为该语言的 Target
5. **不需要冲突检测**

## 兼容性

- **单术语表模式（向后兼容）**：用户只上传 1 份术语表 → 走现有单语言流程（`replaced/<file>.srt`，`langSuffix` 后缀仍生效），UI 与行为完全不变
- **多术语表模式（新）**：用户上传 2+ 份术语表，且至少 2 个不同语言标签 → 进入多语言流程

## 状态结构变更

替换原 `glossaryEntries / multiTargetMap / hitTargetOverrides` 为：

```js
let glossaryFiles = [];           // [{ file: File, lang: 'en' }]
let glossaryByLang = {};           // { en: entries[], ja: entries[], ... }
let langHitValue = {};             // { en: { [hitId]: 'target' }, ja: { ... } }
                                     // 默认值 = 该语言 glossary 的 target
                                     // 用户清空 = 该语言跳过此 hit
                                     // 用户改写 = 该语言用此值
let selectedIds = new Set();       // 不变，语言无关
let scanData = null;               // terms 结构里每个 hit 多带一个 targets 字段
```

`hitId` 格式不变：`${file}|${line}|${start}|${end}|${source}`，语言无关 → 同一行勾选天然复用到所有语言。

## 命中合并策略

对每条字幕文本，按"每语言独立调用 `scanTextHits`，按 hitId 合并"：

1. 对每个 lang L 调 `scanTextHits(text, glossaryByLang[L])` 得到该语言的 hits
2. 用 hitId 作为 key 把多语言的 hits 合并到一行：`hit.targets = { en: 'X', ja: 'Y' }`；某语言没有该 source 时 `targets[lang]` 缺省（UI 显示 `—`，单元格留空）

这样不同语言 glossary 的 Source 集合差异自然处理：A 语言有"陛下"而 B 语言没有时，命中行存在，B 列显示 `—`，B 语言默认跳过此 hit（空单元格）。

## 关键文件

- [docs/replace.html](file:///d:/subtitle-toolkit/docs/replace.html) — 主要改造（HTML + JS）
- [docs/style.css](file:///d:/subtitle-toolkit/docs/style.css) — 多语言表头与单元格样式；版本号 `?v=6 → ?v=7`
- [docs/srt.js](file:///d:/subtitle-toolkit/docs/srt.js) — **不改**，复用 `parseSrt` / `generateSrt` / `scanTextHits` / `replaceText` / `findNonOverlapping` / `naturalCompare` / `saveFilesToFolder`

## 实施步骤

### 1. HTML 调整（replace.html）

- "1. 上传与扫描" 区：
  - 隐藏原 `<input id="glossary" accept=".xlsx,.xls">`，改为 `<input type="file" id="glossary" multiple accept=".xlsx,.xls">`（multiple）
  - 新增"已选术语表"列表容器 `<ul id="glossaryList" class="glossary-list"></ul>`，每行：`<filename> <select class="glossary-lang">…</select> <button class="glossary-remove">×</button>`
  - "扫描替换位置"按钮文案不变；扫描时根据 `glossaryFiles.length` 自动判断模式

- 命中表格表头（多语言模式）：
  ```
  选 | 文件 | 句序 | 时间 | Source | en | ja | ko | … | 原文句（点击查看上下文）
  ```
  动态生成 N 个语言列（N = `glossaryFiles` 中不同 lang 的数量）

- "2. 执行替换" 区：
  - 多语言模式下隐藏 `langSuffix` 下拉（用子文件夹代替），单语言模式保留
  - `folderName` 输入保留，多语言模式下作为父文件夹名

### 2. JS 改造（replace.html `<script>` 块）

新增 / 修改函数：

- `addGlossaryFiles(fileList)` — 把新选中的 xlsx 推入 `glossaryFiles`，默认 lang = 第一个未占用的 LANG 选项
- `removeGlossary(idx)` — 删除某条
- `renderGlossaryList()` — 渲染已选术语表行，绑定语言下拉 change 与删除按钮
- `getActiveLangs()` — 返回 `glossaryFiles.map(g => g.lang)`（去重保序）

修改：

- `btnScan.onclick` — 加分支：
  - `glossaryFiles.length >= 2 && new Set(getActiveLangs()).size >= 2` → 走多语言扫描流程
  - 否则走原单语言流程（保持原代码不动）
- 多语言扫描流程：
  1. 对每个 `glossaryFiles[i]` 调 `loadGlossary(file)`，按 lang 存入 `glossaryByLang`
  2. `subtitleFiles` 加载不变（已含自然排序）
  3. 对每条字幕文本，按 lang 循环调 `scanTextHits`，按 hitId 合并 hits（带 `targets` 字段）
  4. 初始化 `langHitValue[lang][hitId] = default target`（缺省为空字符串）
  5. `selectedIds = new Set(allHitIds())` 默认全选
  6. 渲染 termList（按 source 聚合，badge 显示"多 N 语言"）+ 渲染 hitBody（多语言表）
- `renderHits()`（多语言版本）：
  - 表头动态生成语言列
  - 每行渲染：行 checkbox + 公共列（文件/句序/时间/Source）+ 每语言一个 `<input class="lang-target-input" data-hit-id data-lang>` + 原文句 cell
  - 默认 input value = `langHitValue[lang][hitId]`（缺省时为空 → 显示 placeholder "—"）
  - input `input` 事件 → 更新 `langHitValue[lang][hitId]`；空 = 跳过该语言
  - 行 checkbox `change` 事件 → 更新 `selectedIds`
- `btnReplace.onclick` — 加分支：
  - 多语言模式：对每个 lang L 循环执行：
    1. 复用原 `for (i = 0; i < subtitleFiles.length; i++)` 循环
    2. 构造 `allowedHitIds`：`new Set([...selectedIds].filter(id => langHitValue[L][id] !== ''))` — 选中且该语言单元格非空
    3. 构造 `overrides`：对每个选中且非默认 target 的 hitId 记录 `{ [hitId]: langHitValue[L][hitId] }`
    4. 调 `replaceText(text, glossaryByLang[L], { allowedHitIds, hitTargetOverrides: overrides, fileName, lineIndex })`
    5. `alsoFix` 规范化（已有逻辑）
    6. `generateSrt(subs)` → `outZip.file(\`${folderName}/${L}/${outName}\`, outContent)`
    7. 同时 push 到 `outputFiles`（用于文件夹导出，path = `${L}/${outName}`，不带 folderName 前缀，folderName 由 picker 选的父目录承担）
  - 输出：`outZip.generateAsync` → 下载 `replace_result_multi.zip`
  - 文件夹导出：`saveFilesToFolder(outputFiles)`，其中 path 用 `${L}/${outName}` 形式，让 `saveFilesToFolder` 在所选父目录下创建 `<lang>/` 子目录

- 上方 `glossary` input change 事件：调 `addGlossaryFiles(this.files)` 后 reset `value=''`（允许再次添加同名文件触发 change）

### 3. 样式（style.css）

- `.glossary-list` — 简洁列表，每行 flex 布局：filename + lang select + remove btn
- `.glossary-lang` — 紧凑下拉
- `.diff-table .lang-col` — 窄列（min-width: 80px），输入框 width: 100%
- `.diff-table th.lang-th` — 语言代码小字号、uppercase
- `.diff-table .lang-target-input` — 紧凑 input（border-bottom only, padding 2px 4px）
- `.diff-table .lang-target-input:placeholder-shown` — 灰色显示 "—"
- 版本号：`style.css?v=6 → ?v=7`、`srt.js?v=6` 保持不变（不改 srt.js）

### 4. 上下文 Modal 微调

- `showContextModal(h)` — 多语言模式下，legend 区域显示所有语言的 `(source → target)` 列表而非单一 target

## 验证

1. 启动：`uvicorn backend.main:app --reload`（或 `python -m backend.main`），浏览器打开 `http://localhost:8000/replace.html`（或直接 `file://` 打开 `docs/replace.html`）
2. **单语言回归**：只上传 1 份术语表 → 行为与改造前完全一致（`replaced/<file>.srt`，`langSuffix` 可用）
3. **多语言扫描**：上传 2 份术语表（en + ja），分别选语言标签 → 扫描 → 命中表显示 `Source | en | ja | …` 列；A 语言 glossary 没有的 source 在该列显示空（placeholder "—"）
4. **勾选复用**：勾掉某行 → 该行在所有语言输出中都不替换；勾上 → 全部语言按各自单元格值替换
5. **单语言改写**：在 en 单元格里清空值 → en 跳过此 hit，ja 仍替换；在 en 单元格输入自定义文本 → en 用该文本替换
6. **输出 ZIP**：下载 `replace_result_multi.zip`，内部结构 `replaced/en/ep01.srt`、`replaced/ja/ep01.srt`、…
7. **输出文件夹**（Chrome/Edge）：勾选"导出为文件夹"，picker 选一个目录 → 该目录下生成 `en/`、`ja/` 子目录
8. **冲突**：删除冲突检测路径（原 `multiTargetMap` / `targetSelectorWrap` 在多语言模式下隐藏；单语言模式仍保留以兼容）
9. **缓存**：CSS / JS 版本号已 bump，浏览器拉取最新

## 不做的事

- 不改后端 `pipeline.py` / `main.py` / `glossary.py`
- 不改 `srt.js`（`replaceText` / `scanTextHits` / `findNonOverlapping` 语言无关，直接复用）
- 不做 AI 候选校验（另一个独立任务）
- 不做跨模块流水线
