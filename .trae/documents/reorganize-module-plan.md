# 语种重组模块实施计划

## Context

外包返还的根目录按"类别"组织文件夹（旁白/压制/原剧/字幕/净版），每个类别文件夹下按语种代码（de/en/es...）分子文件夹。用户需要将其重组为"按语种"组织：每个非英语语种产出一个父文件夹 `<语种名> <剧名>`，内部包含 原剧、净版视频、英<X>字幕、英<X>旁白、<X>语压制视频，并把源 xlsx 复制为「本地化清单.xlsx」。英语(en)固定为基准语言（用于「英X」前缀），不单独产出输出。

## 仓库研究结论

- 项目为纯前端 HTML/CSS/JS，无后端
- 已有 [preprocess.html](file:///d:/subtitle-toolkit/docs/preprocess.html) 提供 File System Access API 拖拽/点击选目录、`renameEntry`(move优先+复制删除回退)、`copyTree` 等可复用模式
- 语言映射在 preprocess.html 中已有 `LANG_CODE`（中→zh 等），需补充反查 `code→中文名` 与 `code→单字`
- style.css 提供 `.drop-zone`/`.panel`/`.actions`/`.scan-summary` 等样式
- 导航惯例：所有页面 `<nav class="hud-nav">` 顺序为 首页→预处理→术语替换→SRT修复→跨语言对齐→目录平铺

## 语言映射（新增常量）

```
LANG_FULL = { en:'英语', de:'德语', es:'西班牙语', ja:'日语', ko:'韩语', th:'泰语', fr:'法语', zh:'中文' }
LANG_CHAR = { en:'英', de:'德', es:'西', ja:'日', ko:'韩', th:'泰', fr:'法', zh:'中' }
```

## 源目录类别识别（按文件夹名关键字）

| 关键字 | 类别 | 输出子文件夹名 | 内容来源 | 操作 |
|---|---|---|---|---|
| 旁白 | VO | 英<X>旁白 | VO/<code>/ | 移动 |
| 压制 | DUB | <X>语压制视频 | DUB/<code>/ | 移动 |
| 原剧 | ORIG | 原剧 | ORIG 文件夹内全部 | 复制到每个输出 |
| 字幕 | SUB | 英<X>字幕 | SUB/<code>/ | 移动 |
| 净版 | CLEAN | 净版视频 | CLEAN 文件夹内全部 | 复制到每个输出 |

## 输出结构（每个非英语语种 L）

```
<LANG_FULL[L]> <剧名>/
├── 原剧/                     ← 复制自 ORIG
├── 净版视频/                 ← 复制自 CLEAN
├── 英<LANG_CHAR[L]>字幕/     ← 移动自 SUB/<L>/
├── 英<LANG_CHAR[L]>旁白/     ← 移动自 VO/<L>/
├── <LANG_CHAR[L]>语压制视频/ ← 移动自 DUB/<L>/
└── 本地化清单.xlsx            ← 复制自源目录 xlsx
```

## 文件与模块

### 新建
- `d:\subtitle-toolkit\docs\reorganize.html` —— 语种重组页面

### 修改
- `d:\subtitle-toolkit\docs\index.html` —— 首页卡片置顶（在预处理之前），nav 加「语种重组」
- `d:\subtitle-toolkit\docs\preprocess.html` / `replace.html` / `fix.html` / `align.html` / `flatten.html` —— nav 加 `<a href="reorganize.html">语种重组</a>`（在首页之后、预处理之前）

### 无需改动
- style.css —— 复用现有样式（drop-zone/panel/scan-summary/hit-table/file-item）
- srt.js —— 不涉及字幕解析

## 实现步骤

1. **reorganize.html 骨架**：复用 preprocess.html 的头部+nav（active=reorganize）+ drop-zone + 预览区 + 执行报告区
2. **常量定义**：LANG_FULL、LANG_CHAR、CATEGORY_KEYS
3. **选目录**：复用 `useRootHandle` 模式（点击 showDirectoryPicker + 拖拽 getAsFileSystemHandle）
4. **扫描源结构** `scanSource(rootHandle)`：
   - 遍历 root 直接子目录，按关键字识别 5 种类别
   - 对 VO/DUB/SUB 扫描其直接子目录，收集语种代码集合
   - 收集所有非英语语种为目标语种列表
   - 递归查找 .xlsx 文件路径
5. **预览渲染** `renderPreview()`：
   - 显示：识别到的类别文件夹、找到的语种（含英语标注"基准"）、xlsx 文件名
   - 按语种列出输出结构树（每个输出文件夹 → 6 个子项，标注来源）
6. **执行** `executeReorganize(rootHandle, plan)`：
   - 对每个目标语种 L：
     - 创建输出父文件夹 `getDirectoryHandle(outputName, {create:true})`
     - 复制 ORIG → 输出/原剧/（copyTree）
     - 复制 CLEAN → 输出/净版视频/
     - 移动 SUB/<L>/ → 输出/英<X>字幕/
     - 移动 VO/<L>/ → 输出/英<X>旁白/
     - 移动 DUB/<L>/ → 输出/<X>语压制视频/
     - 复制 xlsx → 输出/本地化清单.xlsx
   - 操作函数：`copyDir(srcHandle, dstHandle)`、`moveDir(parent, oldName, newName)`（move优先+复制删除回退，复用 preprocess 模式）
7. **报告**：每个语种输出成功/失败、每个子项操作结果
8. **首页卡片 + 4 个页面 nav** 添加「语种重组」链接

## 依赖与考虑

- 浏览器：仅 Chrome/Edge（File System Access API）
- 输出文件夹创建在**所选根目录内**，与源文件夹同级
- 移动操作：优先 `handle.move(newName)`，失败则复制+删除（与 preprocess 的 renameEntry 一致）
- 复制操作：递归 copyTree（文件 createWritable+write，目录递归创建）
- 若某类别文件夹缺失，对应输出子项跳过并在报告中标注
- 若某语种在某类别中无对应子文件夹，对应输出子项跳过
- xlsx 递归查找：取**第一个**找到的 .xlsx（若多个，报告中标注使用了哪个）
- 输出文件夹名冲突：若根目录已存在同名输出文件夹，跳过该语种并报告冲突

## 验证

1. 准备测试目录：`骑士长的诱惑/` 含 5 个类别文件夹，VO/DUB/SUB 内含 de/en/es 子文件夹，根目录放一个 xlsx
2. 拖入根目录，确认预览正确显示 3 个目标语种（德/西/...）及每个的输出结构
3. 执行后检查根目录下出现 `德语 骑士长的诱惑/`、`西班牙语 骑士长的诱惑/` 等
4. 检查 `德语 骑士长的诱惑/` 内含：原剧/、净版视频/、英德字幕/、英德旁白/、德语压制视频/、本地化清单.xlsx
5. 检查源 VO/DUB/SUB 中的 de/ 子文件夹已被移走（源文件夹变空或只剩 en/）
6. 检查 ORIG/CLEAN 仍在原位（复制未移动）

## 风险

- **大目录复制慢**：原剧/净版可能含大视频文件，复制耗时。加进度提示，逐个文件流式写入
- **move() 兼容性**：Chrome 110+ 才支持 move，已有回退方案
- **文件名冲突**：输出子文件夹已存在时（重复执行），合并/覆盖策略：对复制操作，若目标文件已存在则覆盖；对移动操作，若目标已存在则跳过并报告
- **xlsx 多个**：取第一个，报告中说明其余被忽略
- **误删风险**：移动操作会删除源，执行前在预览区明确提示"将移动源语种文件夹"
