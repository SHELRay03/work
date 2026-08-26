import openpyxl, os
out_dir = r"D:\subtitle-toolkit\samples"
os.makedirs(out_dir, exist_ok=True)

# Create a ja glossary with overlapping but slightly different Source set
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Sheet1"
ws.append(["source", "target", "priority"])
ws.append(["RAY大小姐", "RAYお嬢様", 20])
ws.append(["大小姐", "お嬢様", 10])
ws.append(["请留步", "お待ちください", 5])   # only in ja glossary
wb.save(os.path.join(out_dir, "glossary_sample_ja.xlsx"))

# Create an en glossary that's slightly different from the original sample
# (to verify per-lang differences)
wb2 = openpyxl.Workbook()
ws2 = wb2.active
ws2.title = "Sheet1"
ws2.append(["source", "target", "priority"])
ws2.append(["RAY大小姐", "Miss RAY", 20])
ws2.append(["大小姐", "lady", 10])
ws2.append(["陆家", "Lu family", 5])   # only in en glossary
wb2.save(os.path.join(out_dir, "glossary_sample_en.xlsx"))

print("Created 2 test glossaries in", out_dir)
for f in os.listdir(out_dir):
    print(" -", f)
