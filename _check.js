// 导航分组下拉
(function(){
  document.querySelectorAll('.hud-nav .group-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      document.querySelectorAll('.hud-nav .nav-group').forEach(g => {
        if (g !== btn.parentElement) g.classList.remove('open');
      });
      btn.parentElement.classList.toggle('open');
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.hud-nav .nav-group.open').forEach(g => g.classList.remove('open'));
  });
})();
const statusEl = document.getElementById("status");
function setMsg(text, cls) {
  statusEl.className = "status" + (cls ? " " + cls : "");
  statusEl.textContent = text;
}
const previewBtn = document.getElementById("preview");
const runBtn = document.getElementById("run");
let fileObj = null;
// localStorage：输出路径记忆上次值
(function() {
  const el = document.getElementById('outputPath');
  const saved = localStorage.getItem('rs_output_path');
  if (saved) el.value = saved;
  el.addEventListener('change', () => localStorage.setItem('rs_output_path', el.value.trim()));
})();
// 路径选择按钮：调后端弹 Windows 原生文件夹选择框
(function() {
  async function pickFolder(targetId) {
    const input = document.getElementById(targetId);
    const fd = new FormData();
    fd.append("title", "选择导出文件夹");
    fd.append("initial", (input.value || "").trim());
    try {
      const resp = await fetch("/api/pick-folder", { method: "POST", body: fd });
      const data = await resp.json();
      if (data.ok && data.path) {
        input.value = data.path;
        input.dispatchEvent(new Event("change"));  // 触发 localStorage 记忆
      }
    } catch (err) {
      alert("文件夹选择失败：" + err);
    }
  }
  document.querySelectorAll(".picker-btn").forEach(btn => {
    btn.addEventListener("click", () => pickFolder(btn.dataset.target));
  });
})();
// 开始转换按钮绑定（postConvert 为函数声明，存在提升，此处可安全引用）
runBtn.onclick = () => postConvert(false);
document.getElementById("xlsxInput").addEventListener("change", e => {
  fileObj = e.target.files?.[0] || null;
  document.getElementById("xlsxInfo").textContent =
    fileObj ? `已选择 ${fileObj.name}（${(fileObj.size / 1024).toFixed(1)} KB）` : "未选择";
  const ok = !!fileObj;
  previewBtn.disabled = !ok;
  runBtn.disabled = !ok;
  document.getElementById("previewBox").hidden = true;
  document.getElementById("report").innerHTML = "";
});
function buildFormData(extras = {}) {
  const fd = new FormData();
  fd.append("xlsx", fileObj);
  fd.append("blank_rows", parseInt(document.getElementById("blankRows").value, 10) || 5);
  fd.append("sheet_name", document.getElementById("sheetName").value.trim() || "本地化清单");
  for (const [k, v] of Object.entries(extras)) fd.append(k, v);
  const outPath = document.getElementById("outputPath").value.trim();
  if (outPath && !extras.preview_only) fd.append("output_path", outPath);
  return fd;
}
function renderPreview(rows) {
  const box = document.getElementById("previewBox");
  if (!rows || rows.length === 0) { box.hidden = true; return; }
  const table =
    `<table class="preview-table"><thead><tr>` +
    `<th style="width:40px">性别</th><th style="width:120px">Source</th>` +
    `<th style="width:120px">Target</th><th style="width:120px">Intro</th>` +
    `<th>Profile</th>` +
    `</tr></thead><tbody>` +
    rows.map(r =>
      `<tr>` +
      `<td>${r.gender || ''}</td>` +
      `<td>${r.source || ''}</td>` +
      `<td class="target">${r.target || '(留空)'}</td>` +
      `<td class="intro">${r.intro || '(留空)'}</td>` +
      `<td>${r.profile || ''}</td>` +
      `</tr>`
    ).join('') +
    `</tbody></table>`;
  box.innerHTML = table;
  box.hidden = false;
}
previewBtn.onclick = async () => {
  if (!fileObj) return;
  const reportEl = document.getElementById("report");
  previewBtn.disabled = true; reportEl.innerHTML = "";
  setMsg("正在解析文件…", "loading");
  try {
    const fd = buildFormData({ preview_only: "true" });
    const resp = await fetch("/api/role-sheet/convert", { method: "POST", body: fd });
    const data = await resp.json();
    if (data && data.confirm_needed) {
      const tgt = (data.existing && data.existing[0]) || "目标文件";
      if (confirm("目标文件已存在，覆盖吗？\n\n" + tgt)) { postConvert(true); } else { setMsg("已取消（未覆盖任何文件）", "warn"); }
      return;
    }
    if (!resp.ok || !data.ok) {
      setMsg("失败：" + (data.msg || resp.statusText), "err");
      return;
    }
    const r = data.report || {};
    renderPreview(r.preview);
    const colChips = Object.entries(r.columns_detected || {})
      .map(([k, v]) => `<span class="col-chip">${k} → 第 ${v} 列</span>`).join("");
    reportEl.innerHTML =
      `<div class="report-box">` +
      `<h3>📋 预览成功</h3>` +
      `<div class="report-meta">识别角色 <b>${r.written}</b> 条 · 跳过空行 ${r.skipped_blank_rows} · 每条追加 ${r.blank_rows_between} 行空白</div>` +
      `<div style="margin-top:0.5rem"><b>列识别：</b>${colChips || "(无)"}</div>` +
      `</div>`;
    setMsg("预览完成，确认无误后点击「开始转换」", "ok");
  } catch (err) {
    setMsg("网络错误：" + err.message, "err");
  } finally {
    previewBtn.disabled = false;
  }
};
async function postConvert(force) {
  if (!fileObj) { setMsg("请先选择文件", "warn"); return; }
  const blankRows = parseInt(document.getElementById("blankRows").value, 10);
  if (isNaN(blankRows) || blankRows < 0) { setMsg("空行数需是非负整数", "warn"); return; }
  runBtn.disabled = true;
  document.getElementById("report").innerHTML = "";
  setMsg("转换中…", "loading");
  try {
    const fd = buildFormData(force ? { force: "true" } : {});
    const resp = await fetch("/api/role-sheet/convert", { method: "POST", body: fd });
    const data = await resp.json();
    if (data && data.confirm_needed) {
      const tgt = (data.existing && data.existing[0]) || "目标文件";
      if (confirm("目标文件已存在，覆盖吗？\n\n" + tgt)) { postConvert(true); } else { setMsg("已取消（未覆盖任何文件）", "warn"); }
      return;
    }
    if (!resp.ok || !data.ok) {
      setMsg("失败：" + (data.msg || resp.statusText), "err");
      return;
    }
    const r = data.report || {};
    const colChips = Object.entries(r.columns_detected || {})
      .map(([k, v]) => `<span class="col-chip">${k} → 第 ${v} 列</span>`).join("");
    let msgBody =
      `<div class="report-box">` +
      `<h3>✅ 转换完成</h3>` +
      `<div class="report-meta">源格式 <b>${r.source_format}</b> · 目标工作表 <b>${r.sheet_name}</b> · 角色 ${r.written} 条 · 跳过空行 ${r.skipped_blank_rows} · 每条后追加 ${r.blank_rows_between} 行空白</div>` +
      `<div style="margin-top:0.5rem"><b>列识别：</b>${colChips || "(无)"}</div>` +
      `</div>`;
    if (data.saved_path) {
      msgBody += `<div class="report-box">💾 已保存到后端指定路径：<div class="saved-path">${data.saved_path}</div></div>`;
      setMsg("转换完成，文件已落盘", "ok");
    } else if (data.xlsx_base64) {
      const blob = base64ToBlob(data.xlsx_base64);
      triggerBrowserDownload(blob, data.download_name || `${r.sheet_name}.xlsx`);
      setMsg("已触发浏览器下载", "ok");
    }
    document.getElementById("report").innerHTML = msgBody;
  } catch (err) {
    setMsg("网络错误：" + err.message, "err");
  } finally {
    runBtn.disabled = false;
  }
};
function base64ToBlob(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// ========== 本地化清单填译（fill_localization_checklist） ==========
let fillMain = null, fillRef = null;
const fillMainInput = document.getElementById("mainInput");
const fillRefInput  = document.getElementById("refInput");
const fillMainInfo  = document.getElementById("mainInfo");
const fillRefInfo   = document.getElementById("refInfo");
const fillPreviewBtn = document.getElementById("fillPreview");
const fillRunBtn     = document.getElementById("fillRun");
const fillReportEl   = document.getElementById("fillReport");
const fillPreviewBox = document.getElementById("fillPreviewBox");
const fillStatusEl   = document.getElementById("fillStatus");
function setFillMsg(text, cls) {
  fillStatusEl.className = "status" + (cls ? " " + cls : "");
  fillStatusEl.textContent = text;
}
function _bindFillFile(input, infoEl, target) {
  input.addEventListener("change", e => {
    const f = e.target.files?.[0] || null;
    target.value = f;
    infoEl.textContent = f ? `已选择 ${f.name}（${(f.size/1024).toFixed(1)} KB）` : "未选择";
    fillReportEl.innerHTML = "";
    fillPreviewBox.hidden = true;
    const both = fillMain.value && fillRef.value;
    fillPreviewBtn.disabled = !both;
    fillRunBtn.disabled = !both;
  });
}
_bindFillFile(fillMainInput, fillMainInfo, fillMain);
_bindFillFile(fillRefInput,  fillRefInfo,  fillRef);
// localStorage：填译输出路径记忆
(function(){
  const el = document.getElementById('fillOutput');
  const saved = localStorage.getItem('rs_fill_output_path');
  if (saved) el.value = saved;
  el.addEventListener('change', () => localStorage.setItem('rs_fill_output_path', el.value.trim()));
})();
function renderFillPreview(report) {
  if (!report || !report.preview) return;
  const box = fillPreviewBox;
  box.hidden = false;
  let html = '<table class="preview-table"><thead><tr>';
  ['Gender','Source','Target','Intro','Profile'].forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';
  for (const row of report.preview) {
    html += `<tr>
      <td>${row.gender||''}</td>
      <td><b>${row.source||''}</b></td>
      <td class="target">${row.target||'<i>(未填)</i>'}</td>
      <td class="intro">${row.intro||''}</td>
      <td>${row.profile||''}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  box.innerHTML = html;
}
function renderFillReport(report) {
  if (!report) return;
  fillReportEl.innerHTML = `
    <div class="report-box">
      <h3>填译报告</h3>
      <div class="report-meta">
        <span class="col-chip">匹配成功 ${report.matched}</span>
        <span class="col-chip">未匹配 ${report.unmatched}</span>
        <span class="col-chip">参考条目 ${report.ref_entries}</span>
        <span class="col-chip">主清单总行数 ${report.total_rows}</span>
      </div>
    </div>
  `;
}
function postFill(force=false, previewOnly=false) {
  if (!fillMain.value || !fillRef.value) { setFillMsg("请先选择主清单和参考清单", "warn"); return; }
  setFillMsg(previewOnly ? "预览中…" : "填译中…");
  const fd = new FormData();
  fd.append("main", fillMain.value);
  fd.append("ref",  fillRef.value);
  fd.append("merge_sep", document.getElementById("mergeSep").value.trim() || "/");
  fd.append("sheet_name", document.getElementById("sheetName").value.trim() || "本地化清单");
  fd.append("preview_only", previewOnly ? "true" : "false");
  if (!previewOnly) fd.append("output_path", document.getElementById("fillOutput").value.trim());
  if (force) fd.append("force", "true");
  fetch("/api/role-sheet/fill", { method: "POST", body: fd })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) {
        if (data.confirm_needed) {
          if (confirm("目标文件已存在，覆盖吗？\n\n" + (data.existing||[]).join("\n"))) { postFill(true, previewOnly); }
          else { setFillMsg("已取消（未覆盖任何文件）", "warn"); }
        } else {
          setFillMsg("失败：" + (data.msg || "未知错误"), "err");
        }
        return;
      }
      const report = data.report;
      renderFillReport(report);
      if (previewOnly) {
        renderFillPreview(report);
        setFillMsg(`预览：匹配 ${report.matched} / 未匹配 ${report.unmatched}`);
        return;
      }
      if (data.saved_path) {
        setFillMsg(`✓ 已保存到：${data.saved_path}`);
        const saved = document.createElement("div");
        saved.className = "saved-path";
        saved.textContent = data.saved_path;
        fillReportEl.appendChild(saved);
      } else if (data.xlsx_base64) {
        const blob = new Blob([Uint8Array.from(atob(data.xlsx_base64), c=>c.charCodeAt(0))],
                              {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = data.download_name || "本地化清单.xlsx";
        a.click();
        setFillMsg("✓ 已触发浏览器下载");
      }
    })
    .catch(err => setFillMsg("请求失败：" + err, "err"));
}
fillPreviewBtn.onclick = () => postFill(false, true);
fillRunBtn.onclick     = () => postFill(false, false);