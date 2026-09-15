# 预处理模块实施计划

## Context

外包剧工作流的痛点：外包返还的多个文件夹命名不规范，文件名带前导零和语言后缀（如 `01-en.srt`）。用户在进入"术语替换 → SRT 修复 → 目录平铺"流程前，需要先把文件夹按类型规范化命名（净版视频 / X语压制视频 / 原剧 / YX字幕 / Y语旁白 或 XY旁白），并清理文件名为 `数字.扩展名` 格式。本模块作为整个工作流的入口，独立成页，放在导航和首页卡片的第一位。

## 文件改动清单

### 新建
- `d:\subtitle-toolkit\docs\preprocess.html` —— 预处理模块主页面

### 修改（添加导航链接 + 首页卡片）
- `d:\subtitle-toolkit\docs\index.html` —— 添加首页卡片，**置顶**（在术语替换卡片之前），icon "预"
- `d:\subtitle-toolkit\docs\replace.html` —— nav 在"首页"和"术语替换"之间插入 `<a href="preprocess.html">预处理</a>`
- `d:\subtitle-toolkit\docs\fix.html` —— 同上
- `d:\subtitle-toolkit\docs\align.html` —— 同上
- `d:\subtitle-toolkit\docs\flatten.html` —— 同上

### 无需改动
- `style.css` —— 复用现有 `.panel` / `.drop-zone` / `.dz-inner` / `.dz-icon` / `.dz-hint` / `.dz-hover` / `.actions` / `.btn-primary` / `.btn-ghost` / `.status` / `.scan-summary` / `.file-item` / `.file-from` / `.preview-section` / `.skip` 等
- `srt.js` —— 复用其全局 `escapeHtml`（可选，也可页面内自带）

## 页面结构（preprocess.html 骨架）

```html
<nav class="hud-nav">
  <a href="index.html">首页</a>
  <a href="preprocess.html" class="active">预处理</a>
  <a href="replace.html">术语替换</a>
  <a href="fix.html">SRT 修复</a>
  <a href="align.html">跨语言对齐</a>
  <a href="flatten.html">目录平铺</a>
</nav>

<main class="hud-main">
  <h1 class="page-title">预处理</h1>
  <p class="page-sub">规范外包返还的文件夹名与文件名，作为后续流程的入口</p>

  <!-- 步骤 1：选择根目录（拖拽 + 点击） -->
  <section class="panel">
    <div class="panel-head"><span class="panel-dot"></span><h2>1. 选择根目录</h2></div>
    <p class="panel-sub">选择包含多个外包文件夹的根目录。</p>
    <div class="drop-zone" id="pickDrop">
      <div class="dz-inner">
        <div class="dz-icon">📁</div>
        <div id="pickText">点击选择根目录，或直接拖入文件夹</div>
        <div class="dz-hint">仅支持 Chrome/Edge；操作将修改原目录，请确保已备份</div>
      </div>
    </div>
    <div class="status" id="statusPick"></div>
  </section>

  <!-- 步骤 2：子目录归类 -->
  <section class="panel" id="cfgPanel" hidden>
    <div class="panel-head"><span class="panel-dot"></span><h2>2. 子目录归类</h2></div>
    <p class="panel-sub">为每个子文件夹选择类型与语言，将生成新文件夹名。</p>
    <div id="dirList"></div>
  </section>

  <!-- 步骤 3：预览 -->
  <section class="panel" id="previewPanel" hidden>
    <div class="panel-head"><span class="panel-dot"></span><h2>3. 改名预览</h2></div>
    <div id="previewSummary" class="scan-summary"></div>
    <div class="actions">
      <button type="button" id="btnExec" class="btn-primary">执行改名</button>
      <button type="button" id="btnReScan" class="btn-ghost">重新选择目录</button>
    </div>
    <div id="previewDetail"></div>
  </section>

  <!-- 步骤 4：报告 -->
  <section class="panel" id="reportPanel" hidden>
    <div class="panel-head"><span class="panel-dot"></span><h2>4. 执行报告</h2></div>
    <div id="reportContent"></div>
  </section>
</main>
```

## JS 关键设计

### 常量
```js
const TYPES = ['净版视频', 'X语压制视频', '原剧', 'YX字幕', '旁白'];
const NARR_MODES = ['Y语旁白', 'XY旁白'];
const LANGS = ['中', '英', '西', '日', '韩', '泰', '法', '德'];
```

### 选择根目录（复用 flatten.html 模式）
- 点击：`window.showDirectoryPicker({ mode: 'readwrite' })`
- 拖拽：`item.getAsFileSystemHandle()` 取 `kind === 'directory'` 的项
- 共用入口 `useRootHandle(handle)`：先 `handle.requestPermission({ mode: 'readwrite' })`，成功后扫描

### 扫描直接子目录（不递归）
```js
async function scanChildDirs(rootHandle) {
  const dirs = [];
  for await (const entry of rootHandle.values()) {
    if (entry.kind === 'directory') dirs.push({ handle: entry, name: entry.name });
  }
  return dirs.sort((a, b) => naturalCompare(a.name, b.name));
}
```

### 类型/语言 UI 动态启用
每个子目录一行：
```
原名 | [类型 ▾] | [X语 ▾] | [Y语 ▾] | [旁白模式 ▾]
```
- 类型 = `净版视频` 或 `原剧` → X、Y、旁白模式 disabled
- 类型 = `X语压制视频` → X enabled，Y、旁白模式 disabled
- 类型 = `YX字幕` → X、Y enabled，旁白模式 disabled
- 类型 = `旁白` → X、Y、旁白模式 enabled

### 文件夹新名生成规则
```js
function buildFolderName({ type, X, Y, narrMode }) {
  if (type === '净版视频') return '净版视频';
  if (type === 'X语压制视频') return X + '压制视频';
  if (type === '原剧') return '原剧';
  if (type === 'YX字幕') return Y + X + '字幕';
  // type === '旁白'
  return narrMode === 'Y语旁白' ? Y + '语旁白' : X + Y + '旁白';
}
```
- 默认值：X='英'，Y='中'，narrMode='Y语旁白'

### 文件名归一化算法
```js
function normalizeFileName(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const m = base.match(/\d+/);           // 第一个数字段
  if (!m) return name;                    // 无数字保留原名
  const num = String(parseInt(m[0], 10)); // 去前导零，101 → 101 不变
  return ext ? num + '.' + ext : num;
}
```
- `01-en.srt` → `1.srt`（取 "01" 去前导零，丢弃 "-en"，保留 ".srt"）
- `01.en.srt` → `1.srt`（取 "01" 去前导零，丢弃 ".en"，保留 ".srt"）
- `101.mp4` → `101.mp4`（无前导零，不变）
- `note.txt` → 保留原名（无数字段）

### 同名冲突处理
- **子目录间冲突**：两个子目录选同类型 + 同语言组合 → 新文件夹名相同。预览阶段把冲突项整行加 `.skip` 红色高亮 + 标注"冲突"；执行阶段遇冲突跳过并写入报告。
- **文件名冲突**：子目录内 `01-en.srt` 和已有 `1.srt` 都会归一为 `1.srt` → 在子目录内做去重，后者加 ` (2)` 后缀（如 `1 (2).srt`、`1 (3).srt`）。

### 重命名可靠回退方案
File System Access API 的 `move()` 在 Chrome 110+ 可用，旧版本不支持。统一使用：
```js
async function renameEntry(parentHandle, oldName, newName, isDir) {
  // 方案 A：优先 move（如可用）
  if (parentHandle.move) {
    try {
      const h = isDir ? await parentHandle.getDirectoryHandle(oldName)
                      : await parentHandle.getFileHandle(oldName);
      await h.move(newName);
      return;
    } catch (e) { /* 落到方案 B */ }
  }
  // 方案 B：复制 + 删除
  if (isDir) {
    const src = await parentHandle.getDirectoryHandle(oldName);
    const dst = await parentHandle.getDirectoryHandle(newName, { create: true });
    for await (const entry of src.values())
      await copyTree(src, dst, entry);   // 递归：文件 createWritable + write，目录递归
    await parentHandle.removeEntry(oldName, { recursive: true });
  } else {
    const src = await parentHandle.getFileHandle(oldName);
    const dst = await parentHandle.getFileHandle(newName, { create: true });
    const w = await dst.createWritable();
    await w.write(await src.getFile());
    await w.close();
    await parentHandle.removeEntry(oldName);
  }
}
```

### 执行流程
1. 按行收集所有子目录的 `(type, X, Y, narrMode)` 配置
2. 对每个子目录生成 `newFolderName`
3. 全局检查重名：相同 newFolderName 标记为冲突，仅保留第一个
4. 预览：列出文件夹改名 + 文件改名表（按子目录分组）
5. 用户点"执行改名" → 调用 `renameEntry(rootHandle, oldDirName, newFolderName, true)` 改文件夹名 → 进入新文件夹，扫描所有文件 → 对每个文件 `renameEntry(newDirHandle, oldFileName, newFileName, false)`
6. 报告：列出成功/跳过/失败项

## 风险与边界

- **浏览器**：仅 Chrome/Edge 110+；不支持时禁用 drop-zone 并提示"请使用 Chrome/Edge"
- **权限失效**：每次执行前 `queryPermission`，失败重新 `requestPermission`
- **非法字符**：Windows 文件夹名禁 `\ / : * ? " < > |`；语言选项均为中文，类型字符串也无非法字符，无需额外校验
- **空子目录**：跳过文件改名步骤，仅改目录名
- **空根目录**：扫描后提示"未发现子文件夹"
- **拖拽非文件夹**：提示"请拖入文件夹，而非单个文件"

## 验证用例

1. **5 种类型 × 不同语言**：根目录下 5 个子目录分别选 5 种类型，X/Y 各异 → 检查生成名：
   - 净版视频 → `净版视频`
   - X=英 X语压制视频 → `英压制视频`
   - 原剧 → `原剧`
   - Y=中 X=英 YX字幕 → `中英字幕`
   - 旁白 Y语模式 Y=中 → `中语旁白`
   - 旁白 XY模式 X=英 Y=中 → `英中旁白`
2. **文件名归一化**：`01-en.srt`/`01.en.srt`/`101.mp4` → `1.srt`/`1.srt`/`101.mp4`
3. **无数字段保留**：`note.txt` → 保留 `note.txt`
4. **子目录冲突**：两个子目录选同类型同语言 → 第二个红色高亮，执行后跳过
5. **文件名冲突**：子目录内 `01-en.srt` 与 `1.srt` 共存 → 后者输出 `1 (2).srt`
6. **UI 联动**：切换类型为"净版视频" → X/Y/旁白模式全部 disabled；切换为"旁白" → 全部 enabled
7. **拖拽入口**：直接把根目录拖入 drop-zone，触发权限请求 + 扫描
8. **重新选择**：点击"重新选择目录" → 清空所有状态，回到步骤 1
