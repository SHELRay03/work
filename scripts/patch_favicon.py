from pathlib import Path

link = '  <link rel="icon" href="/favicon.ico" type="image/svg+xml" />\n'
needle = '  <link rel="stylesheet" href="/static/style.css" />'
for p in Path(__file__).resolve().parent.parent.joinpath("frontend").glob("*.html"):
    t = p.read_text(encoding="utf-8")
    if "favicon.ico" in t:
        continue
    if needle in t:
        p.write_text(t.replace(needle, link + needle), encoding="utf-8")
        print("patched", p.name)
