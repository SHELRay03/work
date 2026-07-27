# -*- coding: utf-8 -*-
"""Write frontend/replace.html (UTF-8). Run: python scripts/patch_replace_page.py"""
from pathlib import Path

MARK = """<span class="brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="1.5" rx=".5" fill="#fafffd"/><rect x="2" y="7.25" width="9" height="1.5" rx=".5" fill="#fafffd" opacity=".9"/><rect x="2" y="10.5" width="11" height="1.5" rx=".5" fill="#fafffd" opacity=".75"/></svg>
      </span>"""

nav = "".join(
    f'<a href="{h}" class="{"active" if on else ""}">{l}</a>'
    for h, l, on in [
        ("/", "首页", False),
        ("/replace", "术语替换", True),
        ("/fix", "SRT 修复", False),
        ("/audit", "术语体检", False),
    ]
)

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>术语替换 · 字幕工具箱</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@500;600&display=swap" rel="stylesheet" />
  <link rel="icon" href="/favicon.ico" type="image/svg+xml" />
  <link rel="stylesheet" href="/static/style.css" />
</head>
<body>
  <div class="bg-layer" aria-hidden="true"></div>
  <header class="hud-top">
    <a href="/" class="brand">{MARK}
      字幕工具箱
    </a>
    <nav class="hud-nav">{nav}</nav>
  </header>
  <main class="hud-main">
    <h1 class="page-title">术语替换</h1>
    <p class="page-sub">将术语表中 Chinese 列的词条批量写入字幕（称呼、译法由你在表里人工维护）</p>
    <section class="panel">
      <div class="panel-head"><span class="panel-dot"></span><h2>功能说明</h2></div>
      <p class="card-desc">
        读取 <strong>Chinese</strong> → <strong>English</strong>（或日韩西等目标语列）逐行替换。
        Gender、Intro、Introduction 等列仅作你的备注，工具不会翻译或自动生成称呼。
        建议把需替换的词条（含林总、RAY大小姐等）都写在表里；更长词条优先匹配。
      </p>
      <div class="field">
        <label>术语表 (.xlsx)</label>
        <input type="file" id="glossary" accept=".xlsx,.xls" />
      </div>
      <div class="field">
        <label>字幕文件夹 (.zip)</label>
        <input type="file" id="subsReplace" accept=".zip" />
      </div>
      <div class="opts">
        <label><input type="checkbox" id="preview" /> 预览模式（仅处理 ZIP 内第一个 SRT）</label>
        <label><input type="checkbox" id="alsoFix" checked /> 替换后同时做 SRT 格式规范化</label>
      </div>
      <div class="actions">
        <button type="button" id="btnReplace">开始替换</button>
        <a class="link" href="/api/sample-glossary">示例术语表</a>
        <a class="link" href="/api/sample-subtitles">示例字幕</a>
      </div>
      <div class="status" id="statusReplace"></div>
    </section>
  </main>
  <script src="/static/common.js"></script>
  <script>
    document.getElementById("btnReplace").onclick = () => {{
      const g = glossary.files[0], z = subsReplace.files[0];
      if (!g || !z) return alert("请上传术语表和字幕 ZIP");
      const fd = new FormData();
      fd.append("glossary", g);
      fd.append("subtitles", z);
      fd.append("preview", preview.checked);
      fd.append("also_fix", alsoFix.checked);
      fd.append("round_trip", "true");
      apiPost("/api/replace", fd, statusReplace, "replace_result.zip", btnReplace);
    }};
  </script>
</body>
</html>
"""

Path(__file__).resolve().parent.parent.joinpath("frontend", "replace.html").write_text(
    html, encoding="utf-8"
)
print("replace.html ok")
