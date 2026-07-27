async function apiPost(url, fd, statusEl, filename, btn) {
  statusEl.className = "status";
  statusEl.textContent = "\u5904\u7406\u4e2d\u2026";
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
    statusEl.textContent = "\u5df2\u5b8c\u6210\uff0c\u4e0b\u8f7d\u5df2\u5f00\u59cb";
  } catch (e) {
    statusEl.className = "status err";
    statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}
