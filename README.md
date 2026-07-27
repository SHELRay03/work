
## 便携使用（移动硬盘）

- 推荐路径: `G:\subtitle-toolkit`（盘符可变；公司机若不支持 F: 请用 G:）
- 首次: 双击 `setup.bat`（**自动查找 Python，不依赖 PATH**）| 日常: 双击 `start.bat`
- 打不开网页: 先看 `start.bat` 黑窗口是否仍在运行，或运行 `scripts\doctor.bat` 生成诊断报告
- 详细说明与豆包排查模板: **`公司电脑使用说明.txt`**

# 短剧字幕工具箱 (Subtitle Toolkit)

本地 Web 工具：**按术语表批量替换字幕**、SRT 批量剪映兼容修复、术语表体检。不自动翻译称呼，表里写什么就替换什么。

## 快速开始

```bash
cd subtitle-toolkit
pip install -r requirements.txt
python run.py
```

浏览器打开 http://127.0.0.1:8000

## 功能

### 1. 术语替换
- 上传 Cliper 术语表 `glossary.xlsx` + 字幕文件夹 ZIP（多集 .srt）
- 只读 **Chinese → English**（或日韩西等目标语列）；Gender / Intro / Introduction 不参与替换
- **称呼、小名、x总 等译法请在表里人工维护**，工具不做自动生成
- **最长匹配优先**：先替换「RAY大小姐」，再替换「大小姐」，避免误替换
- 下载 `replace_result.zip`：`replaced/` 字幕、`changes.csv`、`conflicts.xlsx`

### 2. SRT 批量修复（剪映）
- 批量规范化 Cliper/Aegisub 导出异常的字幕
- 可选 ASS 往返，接近逐个 Aegisub 导入导出效果
- 输出在 `fixed/` 目录

### 3. 术语表体检
- 检测短词被长词包含、重复 source 等风险

## 术语表 Excel 列

Cliper 导出常用列名（工具会自动识别别名）：

| 列名 | 必填 | 说明 |
|------|------|------|
| Chinese / source / 中文 | 是 | 待替换原文 |
| English / target / 译文 | 是 | 写入字幕的目标语 |
| Gender | 否 | 仅备注，不参与替换 |
| Intro / Introduction | 否 | 旁白/人物介绍，不参与 SRT 替换 |
| priority / 优先级 | 否 | 数字越大越优先 |
| match_type | 否 | phrase / word / regex |
| block_if_longer | 否 | Y=已被长词占用时跳过短词（默认 Y） |
| speaker / 说话人 | 否 | 有说话人标签时按角色匹配 |
| notes / 备注 | 否 | 人工备注 |

**示例**：「RAY大小姐」单独一行且 priority 高于「大小姐」。

## 与你现有 SOP 的对接

| 原步骤 | 本工具 |
|--------|--------|
| 6 VS Code 手改术语 | Web 一键替换 + changes.csv 复核 |
| Cliper 译后 SRT 无法进剪映 | 批量 SRT 修复 |
| 逐个 Aegisub | 勾选 ASS 往返批量处理 |

建议流程：人工/豆包维护术语表（含称呼词条）→ **本工具替换中文 SRT** → Cliper 机翻 → **本工具修复译后 SRT** → 剪映校对。

## 试用检查清单

- [ ] 用示例术语表+示例字幕跑通替换，确认 RAY大小姐 未被拆坏
- [ ] 拿 1 集 Cliper 问题 SRT 跑修复，导入剪映对比
- [ ] 全文件夹 zip 批量处理 3 集以上
- [ ] 查看 conflicts.xlsx 处理歧义词条

## 项目结构

```
backend/     FastAPI + 替换/修复引擎
frontend/    Web 页面
samples/     示例文件
scripts/     测试与样例生成
run.py       启动入口
```