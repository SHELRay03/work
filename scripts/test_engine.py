import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.glossary import GlossaryEntry, sort_entries
from backend.replacer import replace_text
entries = sort_entries([
    GlossaryEntry("\u5927\u5c0f\u59d0", "young lady", 10),
    GlossaryEntry("RAY\u5927\u5c0f\u59d0", "Miss LILY RAY", 20),
])
for t in ["\u4f60\u597d\uff0cRAY\u5927\u5c0f\u59d0", "\u8fd9\u4f4d\u5927\u5c0f\u59d0\u8bf7\u7559\u6b65"]:
    r = replace_text(t, entries)
    print(t, "->", r.text)