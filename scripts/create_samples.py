import io
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
SAMPLES.mkdir(exist_ok=True)

rows = [
    {"source": "RAY大小姐", "target": "Miss LILY RAY", "priority": 20},
    {"source": "大小姐", "target": "young lady", "priority": 10},
    {"source": "陆家", "target": "Lu family", "priority": 5},
]
pd.DataFrame(rows).to_excel(SAMPLES / "glossary_sample.xlsx", index=False)

srt = (
    "1\n00:00:01,000 --> 00:00:03,500\n你好，RAY大小姐\n\n"
    "2\n00:00:04,000 --> 00:00:06,000\n这位大小姐请留步\n"
)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("ep01.srt", srt.encode("utf-8"))
(SAMPLES / "subtitles_sample.zip").write_bytes(buf.getvalue())
print("samples ok")
