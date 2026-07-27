# -*- coding: utf-8 -*-
from pathlib import Path

R = Path(__file__).resolve().parent.parent / "frontend"

MARK = """<span class="brand-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="1.5" rx=".5" fill="#fafffd"/><rect x="2" y="7.25" width="9" height="1.5" rx=".5" fill="#fafffd" opacity=".9"/><rect x="2" y="10.5" width="11" height="1.5" rx=".5" fill="#fafffd" opacity=".75"/></svg>
      </span>"""

def shell(title, active, page_title, page_sub, body, extra_script=""):
    nav = [
        ("/", "\u9996\u9875", active == "home"),
        ("/replace", "\u672f\u8bed\u66ff\u6362", active == "replace"),
        ("/fix", "SRT \u4fee\u590d", active == "fix"),
        ("/audit", "\u672f\u8bed\u4f53\u68c0", active == "audit"),
    ]
    nav_html = "".join(
        f'<a href="{h}" class="{"active" if on else ""}">{l}</a>' for h, l, on in nav
    )
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
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
      \u5b57\u5e55\u5de5\u5177\u7bb1
    </a>
    <nav class="hud-nav">{nav_html}</nav>
  </header>
  <main class="hud-main">
    <h1 class="page-title">{page_title}</h1>
    <p class="page-sub">{page_sub}</p>
    <section class="panel">
      <div class="panel-head"><span class="panel-dot"></span><h2>\u529f\u80fd\u64cd\u4f5c</h2></div>
{body}
    </section>
  </main>
  <script src="/static/common.js"></script>
{extra_script}
</body>
</html>
"""

REPLACE_BODY = """
      <div class="field"><label>\u672f\u8bed\u8868 (.xlsx)</label><input type="file" id="glossary" accept=".xlsx,.xls" /></div>
      <div class="field"><label>\u5b57\u5e55\u6587\u4ef6\u5939 (.zip)</label><input type="file" id="subsReplace" accept=".zip" /></div>
      <div class="opts">
        <label><input type="checkbox" id="preview" /> \u9884\u89c8\u6a21\u5f0f\uff08\u4ec5\u7b2c\u4e00\u96c6\uff09</label>
        <label><input type="checkbox" id="alsoFix" checked /> \u540c\u65f6 SRT \u89c4\u8303\u5316</label>
      </div>
      <div class="actions">
        <button type="button" id="btnReplace">\u5f00\u59cb\u66ff\u6362</button>
        <a class="link" href="/api/sample-glossary">\u793a\u4f8b\u672f\u8bed\u8868</a>
        <a class="link" href="/api/sample-subtitles">\u793a\u4f8b\u5b57\u5e55</a>
      </div>
      <div class="status" id="statusReplace"></div>
"""

REPLACE_JS = """
  <script>
    const btn=document.getElementById("btnReplace"),statusEl=document.getElementById("statusReplace");
    btn.onclick=()=>{const g=glossary.files[0],z=subsReplace.files[0];
      if(!g||!z)return alert("\u8bf7\u4e0a\u4f20\u672f\u8bed\u8868\u548c\u5b57\u5e55 ZIP");
      const fd=new FormData();fd.append("glossary",g);fd.append("subtitles",z);
      fd.append("preview",preview.checked);fd.append("also_fix",alsoFix.checked);fd.append("round_trip","true");
      apiPost("/api/replace",fd,statusEl,"replace_result.zip",btn);};
  </script>
"""

FIX_BODY = """
      <div class="field"><label>\u5b57\u5e55 (.zip)</label><input type="file" id="subsFix" accept=".zip" /></div>
      <div class="opts"><label>\u6bcf\u884c\u5b57\u6570 <input type="number" id="maxChars" value="42" min="20" max="80" /></label></div>
      <div class="actions"><button type="button" id="btnFix">\u6279\u91cf\u4fee\u590d</button></div>
      <div class="status" id="statusFix"></div>
"""

FIX_JS = """
  <script>
    const btn=document.getElementById("btnFix"),statusEl=document.getElementById("statusFix");
    btn.onclick=()=>{const z=subsFix.files[0];if(!z)return alert("\u8bf7\u9009\u62e9\u5b57\u5e55 ZIP");
      const fd=new FormData();fd.append("subtitles",z);fd.append("max_chars",maxChars.value);fd.append("round_trip","true");
      apiPost("/api/fix-srt",fd,statusEl,"fix_result.zip",btn);};
  </script>
"""

AUDIT_BODY = """
      <div class="field"><label>\u672f\u8bed\u8868 (.xlsx)</label><input type="file" id="glossaryAudit" accept=".xlsx,.xls" /></div>
      <div class="actions"><button type="button" id="btnAudit">\u5f00\u59cb\u4f53\u68c0</button></div>
      <div class="status" id="statusAudit"></div>
"""

AUDIT_JS = """
  <script>
    const btn=document.getElementById("btnAudit"),statusEl=document.getElementById("statusAudit");
    btn.onclick=()=>{const g=glossaryAudit.files[0];if(!g)return alert("\u8bf7\u9009\u62e9\u672f\u8bed\u8868");
      const fd=new FormData();fd.append("glossary",g);
      apiPost("/api/audit-glossary",fd,statusEl,"audit_report.txt",btn);};
  </script>
"""

pages = [
    ("replace.html", "\u672f\u8bed\u66ff\u6362 \u00b7 \u5b57\u5e55\u5de5\u5177\u7bb1", "replace",
     "\u672f\u8bed\u66ff\u6362", "\u4e0a\u4f20\u672f\u8bed\u8868\u4e0e\u5b57\u5e55\uff0c\u6309\u6700\u957f\u5339\u914d\u6279\u91cf\u66ff\u6362", REPLACE_BODY, REPLACE_JS),
    ("fix.html", "SRT \u6279\u91cf\u4fee\u590d \u00b7 \u5b57\u5e55\u5de5\u5177\u7bb1", "fix",
     "SRT \u6279\u91cf\u4fee\u590d", "\u6279\u91cf\u89c4\u8303\u5316\u5b57\u5e55\uff0c\u4fbf\u4e8e\u5bfc\u5165\u526a\u6620", FIX_BODY, FIX_JS),
    ("audit.html", "\u672f\u8bed\u8868\u4f53\u68c0 \u00b7 \u5b57\u5e55\u5de5\u5177\u7bb1", "audit",
     "\u672f\u8bed\u8868\u4f53\u68c0", "\u68c0\u67e5\u5d4c\u5957\u8bcd\u6761\u3001\u91cd\u590d\u9879\u7b49\u95ee\u9898", AUDIT_BODY, AUDIT_JS),
]

for fname, title, active, pt, ps, body, js in pages:
    (R / fname).write_text(shell(title, active, pt, ps, body, js), encoding="utf-8")
    print("ok", fname)

# common.js utf-8
(R / "common.js").write_text("""async function apiPost(url, fd, statusEl, filename, btn) {
  statusEl.className = "status";
  statusEl.textContent = "\\u5904\\u7406\\u4e2d\\u2026";
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(url, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text() || r.statusText);
    const b = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    statusEl.className = "status ok";
    statusEl.textContent = "\\u5df2\\u5b8c\\u6210\\uff0c\\u4e0b\\u8f7d\\u5df2\\u5f00\\u59cb";
  } catch (e) {
    statusEl.className = "status err";
    statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}
""", encoding="utf-8")
print("ok common.js")
