"""Start server: python run.py"""

import os
import re
import uvicorn
from datetime import datetime
from pathlib import Path


def bump_static_versions():
    """启动前自动扫描 docs/ 下所有 HTML 文件，把 href/src 里已有的 ?v=XXX 版本号统一刷新。

    绝对安全策略：
    - 只替换已经存在的 ?v=后面的 token
    - 不删、不加、不清理任何其他字符
    - 保留 BOM、保留所有换行

    好处：本地开发时每次重启服务浏览器都会强制拉新 CSS/JS，不会卡旧缓存。
    GitHub Pages 部署时版本号就是最后一次 run.py 启动时写的值，固定且稳定。
    """
    import re

    root = Path(__file__).resolve().parent / "docs"
    if not root.exists():
        return
    ver = datetime.now().strftime("%Y%m%d-%H%M")
    # 只替换已经有 ?v= 的 href/src 属性，\g<N> 是 regex safe replacement
    pat = re.compile(r'((?:href|src)="[^"]+?\.(?:css|js|svg|woff2?|ttf|eot|ico))\?v=[^\s"\'>]+(")', re.IGNORECASE)
    changed = 0
    for html in root.glob("*.html"):
        raw = html.read_bytes()
        has_bom = raw.startswith(b'\xef\xbb\xbf')
        text = raw.decode('utf-8-sig', errors='replace')
        new, n = pat.subn(rf'\1?v={ver}\2', text)
        if n > 0:
            out = '\ufeff' + new.lstrip('\ufeff') if has_bom else new
            html.write_text(out, encoding='utf-8')
            changed += 1
    if changed > 0:
        print(f"[cache] bumped ?v= → {ver} in {changed} html file(s)")


if __name__ == "__main__":
    bump_static_versions()
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", os.environ.get("DEV_HOST", "0.0.0.0"))
    reload = os.environ.get("RELOAD", "false").lower() == "true"
    print(f"Starting server on {host}:{port}, reload={reload}")
    uvicorn.run("backend.main:app", host=host, port=port, reload=reload)
