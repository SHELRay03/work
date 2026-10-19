'use strict';

// ------------------------- 全局状态 -------------------------
let scanData = null;   // /api/scan 返回
let langFull = {};     // 语种代码 -> 全名
let userLang = {};     // 映射表 code -> 用户选择的语种
let unitModels = [];   // 剧集单元模型
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);

const STATUS_TEXT = {
  ok: '复制', warn: '部分跳过', missing: '跳过', error: '失败', skipped: '跳过',
};

const MAX_ERRORS = 50; // 报告错误项最多展示条数

// ------------------------- 工具函数 -------------------------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function dirOf(path) {
  if (!path) return '';
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i >= 0 ? path.slice(0, i) : path;
}

// ------------------------- 映射表解析（与后端算法一致）-------------------------
const CODE_RE = /^\d{3,}$/;
const DIGIT_RUN_RE = /\d{3,}/g;
const HEADER_WORDS = ['剧名', '编号', '名称', '标题', '代码', '语种', '备注', '剧集',
  '状态', '序号', 'id', 'title', 'code', 'name', 'no', 'number'];

function longest(arr) {
  return arr.reduce((a, b) => (b.length > a.length ? b : a));
}

function parseTitleMap(text) {
  const rows = [];
  const report = { parsed: 0, skipped: 0, headers: 0, skipped_lines: [], duplicates: [], empty_titles: [] };
  const seen = new Set();

  (text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;

    let fields;
    if (raw.indexOf('\t') >= 0) fields = raw.split('\t').map((s) => s.trim());
    else if (/\s{2,}/.test(line)) fields = line.split(/\s{2,}/).map((s) => s.trim());
    else fields = [line];
    fields = fields.filter(Boolean);

    const codeIdx = fields.findIndex((f) => CODE_RE.test(f));
    let code;
    let title;

    if (codeIdx >= 0) {
      code = fields[codeIdx];
      const others = fields.filter((f, i) => i !== codeIdx && !CODE_RE.test(f));
      title = others.length ? longest(others) : '';
    } else {
      const runs = Array.from(line.matchAll(DIGIT_RUN_RE));
      if (!runs.length) {
        const words = fields.map((f) => f.toLowerCase());
        if (words.length >= 2 && words.every((w) => HEADER_WORDS.indexOf(w) >= 0)) {
          report.headers += 1;
          return;
        }
        report.skipped += 1;
        report.skipped_lines.push(raw);
        return;
      }
      const m = runs[runs.length - 1];
      code = m[0];
      if (fields.length >= 2) {
        const others = fields.filter((f) => !CODE_RE.test(f));
        title = others.length ? longest(others) : '';
      } else {
        title = (line.slice(0, m.index) + ' ' + line.slice(m.index + code.length))
          .replace(/\s{2,}/g, ' ').trim();
      }
    }

    if (seen.has(code)) { report.duplicates.push(code); return; }
    seen.add(code);
    if (!title) report.empty_titles.push(code);
    rows.push({ code, title, lang: '' });
  });

  report.parsed = rows.length;
  return { rows, report };
}

function buildLangOptions(selected, allowBlank) {
  const sel = el('select', 'lang-select');
  if (allowBlank) {
    const opt = el('option', null, '语种（自动/未选）');
    opt.value = '';
    sel.appendChild(opt);
  }
  Object.keys(langFull).forEach((code) => {
    if (code === 'en') return;
    const opt = el('option', null, `${langFull[code]} (${code})`);
    opt.value = code;
    if (code === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

function renderTitleTable(rows) {
  const box = $('#titleTable');
  box.innerHTML = '';
  if (!rows.length) return;

  const table = el('div', 'ttable');
  const head = el('div', 'trow thead');
  head.appendChild(el('span', 'tcell code', '编号'));
  head.appendChild(el('span', 'tcell title-text', '剧名'));
  head.appendChild(el('span', 'tcell', '语种'));
  table.appendChild(head);

  rows.forEach((row) => {
    const line = el('div', 'trow');
    line.appendChild(el('span', 'tcell code', row.code));
    line.appendChild(el('span', 'tcell title-text', row.title || '（空）'));
    const cell = el('span', 'tcell');
    const sel = buildLangOptions(row.lang, true);
    sel.addEventListener('change', () => { userLang[row.code] = sel.value; });
    cell.appendChild(sel);
    line.appendChild(cell);
    table.appendChild(line);
  });
  box.appendChild(table);
}

function updateParseMsg(report) {
  const box = $('#parseMsg');
  if (!report) { box.textContent = ''; box.className = 'hint'; return; }
  const dups = report.duplicates || [];
  const empties = report.empty_titles || [];
  const parts = [`解析 ${report.parsed || 0} 行`];
  let warn = false;
  if (report.headers) parts.push(`识别表头 ${report.headers} 行`);
  if (report.skipped) { parts.push(`跳过 ${report.skipped} 行（未找到编号）`); warn = true; }
  if (dups.length) { parts.push(`重复编号 ${dups.length} 个`); warn = true; }
  if (empties.length) { parts.push(`空剧名 ${empties.length} 个`); warn = true; }
  box.textContent = parts.join(' · ');
  box.className = 'hint' + (warn ? ' warn' : '');
}

// ------------------------- 扫描 -------------------------
async function doScan() {
  const root = $('#rootPath').value.trim();
  const msg = $('#scanMsg');
  msg.className = 'msg';
  msg.textContent = '';
  if (!root) {
    msg.className = 'msg err';
    msg.textContent = '请先填写源目录路径。';
    return;
  }

  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.textContent = '扫描中…';

  try {
    const resp = await fetch('/api/reorganize/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        show_name: '',
        title_map_text: $('#titleMap').value,
        lang_overrides: userLang,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '扫描失败');

    scanData = data;
    langFull = data.lang_full || {};

    renderTitleTable(data.title_rows || []);
    updateParseMsg(data.parse_report);
    unitModels = buildUnitModels(data.units || []);
    renderPreview(data);
    msg.className = 'msg ok';
    msg.textContent = '扫描完成。';
  } catch (e) {
    scanData = null;
    unitModels = [];
    $('#stepPreview').classList.add('hidden');
    msg.className = 'msg err';
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '扫描结构';
  }
}

// ------------------------- 预览渲染 -------------------------
function buildUnitModels(units) {
  return units.map((u) => ({
    root: u.root,
    folderName: u.folder_name,
    showName: u.show_name,
    titleFromMap: u.title_from_map,
    langGuess: u.lang_guess,
    allLangs: u.all_langs,
    categories: u.categories,
    targetLangs: u.target_langs.slice(),
    langsChecked: new Set(u.target_langs),
    baseGroups: u.plan.groups,
    selected: true,
  }));
}

function groupView(unit, g) {
  const name = `${langFull[g.lang] || g.lang} ${unit.showName}`.trim();
  return Object.assign({}, g, {
    parent_name: name,
    parent_path: dirOf(unit.root) + '\\' + name,
  });
}

function langText(unit) {
  if (!unit.langsChecked.size) return '无目标语种';
  return Array.from(unit.langsChecked).map((c) => langFull[c] || c).join(' / ');
}

function renderPreview(data) {
  const preview = $('#stepPreview');
  preview.classList.remove('hidden');

  const modeInfo = $('#modeInfo');
  if (data.mode === 'single') {
    modeInfo.textContent = '单剧模式：所选目录本身含类别文件夹。';
  } else {
    const n = data.units.length;
    const skipped = data.skipped_dirs.length;
    modeInfo.innerHTML = '';
    modeInfo.appendChild(el('strong', null, '批量模式：'));
    modeInfo.appendChild(document.createTextNode(
      `识别到 ${n} 个编号剧集` +
      (skipped ? `，跳过 ${skipped} 个非剧集目录（${data.skipped_dirs.slice(0, 5).join('、')}${skipped > 5 ? '…' : ''}）` : '')));
  }

  const area = $('#unitArea');
  area.innerHTML = '';
  if (!unitModels.length) {
    area.appendChild(el('div', 'msg err',
      '未识别到任何含类别文件夹的剧集目录，请检查路径是否正确。'));
  }
  unitModels.forEach((unit) => area.appendChild(renderUnitCard(unit)));
  updateUnitCount();
}

function renderUnitCard(unit) {
  const card = document.createElement('details');
  card.className = 'unit-card';
  card.open = unit.baseGroups.some((g) => g.exists);

  // --- 概要行 ---
  const summary = el('summary', 'unit-summary');
  const check = el('input', 'unit-check');
  check.type = 'checkbox';
  check.checked = unit.selected;
  check.addEventListener('click', (e) => e.stopPropagation());
  check.addEventListener('change', () => {
    unit.selected = check.checked;
    updateUnitCount();
  });
  summary.appendChild(check);
  summary.appendChild(el('span', 'unit-code', unit.folderName));

  const showSpan = el('span', 'unit-show', unit.showName || '（无剧名）');
  summary.appendChild(showSpan);

  const langSpan = el('span', 'unit-langs', langText(unit));
  summary.appendChild(langSpan);

  const existsBadge = el('span', 'unit-badge',
    unit.baseGroups.some((g) => g.exists) ? '⚠ 已有输出' : '');
  existsBadge.className = 'unit-badge ' + (unit.baseGroups.some((g) => g.exists) ? 'warn' : '');
  summary.appendChild(existsBadge);
  card.appendChild(summary);

  // --- 展开内容 ---
  const body = el('div', 'unit-body');

  const f1 = el('div', 'field');
  f1.appendChild(el('label', null, '剧名（父文件夹命名：{语种全名} {剧名}）'));
  const nameInput = el('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = unit.showName;
  nameInput.addEventListener('input', () => {
    unit.showName = nameInput.value.trim();
    showSpan.textContent = unit.showName || '（无剧名）';
    updateUnitPlan(unit, planBox);
  });
  f1.appendChild(nameInput);
  const hint = el('div', 'hint', unit.titleFromMap
    ? `剧名来自映射表；识别语种建议：${unit.langGuess || '未识别'}`
    : '未在映射表中匹配到编号，已回退使用目录名，可手动修改。');
  f1.appendChild(hint);
  body.appendChild(f1);

  const f2 = el('div', 'field');
  f2.appendChild(el('label', null, '目标语种'));
  const picker = el('div', 'target-picker');
  if (!unit.targetLangs.length) {
    picker.appendChild(el('span', 'hint warn', '未检测到除英语外的目标语种'));
  }
  unit.targetLangs.forEach((code) => {
    const lab = el('label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = unit.langsChecked.has(code);
    cb.addEventListener('change', () => {
      if (cb.checked) unit.langsChecked.add(code); else unit.langsChecked.delete(code);
      langSpan.textContent = langText(unit);
      updateUnitPlan(unit, planBox);
      updateUnitCount();
    });
    lab.appendChild(cb);
    lab.appendChild(el('span', null, `${langFull[code] || code} (${code})`));
    picker.appendChild(lab);
  });
  f2.appendChild(picker);
  body.appendChild(f2);

  const cats = el('div', 'subpanel');
  cats.appendChild(el('h3', null, '类别识别'));
  const ul = el('ul', 'cat-list');
  unit.categories.forEach((c) => {
    const li = el('li');
    li.appendChild(el('span', 'cat-key', c.key));
    li.appendChild(el('span', 'cat-state ' + (c.found ? 'ok' : 'miss'), c.found ? '✓' : '✗'));
    const detail = c.found
      ? (c.has_lang_layer ? `${c.folder} / [${(c.langs || []).join(', ') || '无语种子目录'}]` : c.folder)
      : '未找到';
    li.appendChild(el('span', 'cat-folder', detail));
    ul.appendChild(li);
  });
  cats.appendChild(ul);
  body.appendChild(cats);

  const planBox = el('div', 'plan-area');
  body.appendChild(planBox);
  updateUnitPlan(unit, planBox);

  card.appendChild(body);
  return card;
}

function updateUnitPlan(unit, container) {
  const groups = unit.baseGroups
    .filter((g) => unit.langsChecked.has(g.lang))
    .map((g) => groupView(unit, g));
  renderPlan(container, groups);
}

function renderPlan(container, groups) {
  container.innerHTML = '';
  if (!groups.length) {
    container.appendChild(el('div', 'hint', '未选择目标语种，无输出。'));
    return;
  }
  groups.forEach((g) => {
    const card = el('div', 'plan-card');
    const head = el('div', 'plan-card-head');
    head.appendChild(el('span', 'parent-name', g.parent_name));
    head.appendChild(el('span', 'parent-path', g.parent_path));
    card.appendChild(head);

    const items = el('div', 'plan-items');
    g.items.forEach((it) => {
      const row = el('div', 'plan-item');
      const main = el('div', 'plan-item-main');
      main.appendChild(el('div', 'plan-item-sub', it.sub));
      let srcText = it.note || '';
      if (it.ops && it.ops.length) {
        srcText = `源：${dirOf(it.ops[0].src)}（${it.ops.length} 个文件）`;
      }
      main.appendChild(el('div', 'plan-item-src', srcText));
      row.appendChild(main);
      row.appendChild(el('span', 'status-tag ' + it.status, STATUS_TEXT[it.status] || it.status));
      items.appendChild(row);
    });
    card.appendChild(items);
    container.appendChild(card);
  });
}

function updateUnitCount() {
  const active = unitModels.filter((u) => u.selected && u.langsChecked.size);
  $('#unitCount').textContent = `已选 ${active.length} / ${unitModels.length} 个剧集`;
  $('#executeBtn').disabled = active.length === 0;
}

// ------------------------- 执行 -------------------------
function onExecuteClick() {
  const chosen = unitModels.filter((u) => u.selected && u.langsChecked.size);
  const msg = $('#execMsg');
  msg.className = 'msg';
  msg.textContent = '';
  if (!chosen.length) {
    msg.className = 'msg err';
    msg.textContent = '请至少选择一个含目标语种的剧集。';
    return;
  }

  const conflicts = [];
  chosen.forEach((u) => {
    u.baseGroups.forEach((g) => {
      if (u.langsChecked.has(g.lang) && g.exists) {
        conflicts.push(`${u.showName || u.folderName} / ${groupView(u, g).parent_name}`);
      }
    });
  });

  if (conflicts.length) {
    const list = $('#conflictList');
    list.innerHTML = '';
    conflicts.forEach((c) => list.appendChild(el('li', null, c)));
    $('#conflictModal').classList.remove('hidden');
  } else {
    startExecute('skip');
  }
}

function startExecute(conflict) {
  const units = unitModels
    .filter((u) => u.selected && u.langsChecked.size)
    .map((u) => ({
      root: u.root,
      show_name: u.showName || u.folderName,
      target_langs: Array.from(u.langsChecked),
    }));

  $('#conflictModal').classList.add('hidden');
  $('#executeBtn').disabled = true;
  $('#stepReport').classList.remove('hidden');
  resetProgress();

  fetch('/api/reorganize/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ units, conflict }),
  })
    .then(async (resp) => {
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '执行失败');
      pollJob(data.job_id);
    })
    .catch((e) => {
      $('#executeBtn').disabled = false;
      const msg = $('#execMsg');
      msg.className = 'msg err';
      msg.textContent = e.message;
    });
}

function resetProgress() {
  const fill = $('#progressFill');
  fill.style.width = '0%';
  fill.classList.add('pulse');
  const t = $('#progressText');
  t.textContent = '复制中';
  t.className = 'loading';
  $('#progressCount').textContent = '已复制 0 个';
  $('#progressPath').textContent = '';
  $('#reportArea').innerHTML = '';
}

function pollJob(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch('/api/reorganize/job/' + jobId);
      const state = await resp.json();
      if (!resp.ok) throw new Error(state.error || '任务查询失败');
      updateProgress(state);
      if (state.status === 'done') {
        clearInterval(pollTimer);
        pollTimer = null;
        renderReport(state);
      }
    } catch (e) {
      clearInterval(pollTimer);
      pollTimer = null;
      const t = $('#progressText');
      t.className = 'msg err';
      t.textContent = e.message;
    }
  }, 600);
}

function updateProgress(state) {
  $('#progressCount').textContent = `已复制 ${state.done} / ${state.total} 个`;
  $('#progressPath').textContent = state.current || '';
  const fill = $('#progressFill');
  if (state.total > 0) {
    fill.classList.remove('pulse');
    fill.style.width = Math.min(100, (state.done / state.total) * 100) + '%';
  } else {
    fill.classList.add('pulse');
  }
}

function statBlock(label, num, cls) {
  const block = el('div', 'stat');
  block.appendChild(el('div', 'num ' + cls, String(num)));
  block.appendChild(el('div', 'lbl', label));
  return block;
}

function renderReport(state) {
  const fill = $('#progressFill');
  fill.classList.remove('pulse');
  fill.style.width = '100%';
  const t = $('#progressText');
  t.className = 'msg ok';
  t.textContent = '完成';
  $('#progressPath').textContent = '';
  $('#executeBtn').disabled = false;

  const area = $('#reportArea');
  area.innerHTML = '';

  const s = state.summary || {};
  const summary = el('div', 'report-summary');
  summary.appendChild(statBlock('复制成功', s.copied || 0, 'ok'));
  summary.appendChild(statBlock('失败', s.failed || 0, 'err'));
  summary.appendChild(statBlock('剧集', s.units || 0, ''));
  summary.appendChild(statBlock('目标文件夹', s.groups || 0, ''));
  area.appendChild(summary);

  (state.reports || []).forEach((u) => {
    const box = el('div', 'report-unit');
    const head = el('div', 'report-unit-head');
    head.appendChild(el('span', null, u.show_name || u.code || '（无剧名）'));
    head.appendChild(el('span', 'unit-root', u.root));
    box.appendChild(head);

    (u.groups || []).forEach((g) => {
      const gbox = el('div', 'report-group');
      const gh = el('div', 'report-group-head');
      gh.appendChild(el('span', null, g.parent_name));
      if (g.skipped) gh.appendChild(el('span', 'skip-note', '（目标已存在，整组跳过）'));
      gbox.appendChild(gh);

      const items = el('div', 'report-items');
      g.items.forEach((it) => {
        const bad = (it.status === 'error' || it.status === 'missing');
        const row = el('div', 'report-item' + (bad ? ' bad' : ''));
        row.appendChild(el('span', 'item-name', it.sub));
        row.appendChild(el('span', 'item-meta',
          `${STATUS_TEXT[it.status] || it.status} · ${it.count} 个${it.note ? ' · ' + it.note : ''}`));
        items.appendChild(row);

        if (it.errors && it.errors.length) {
          const ul = el('ul', 'report-errors');
          it.errors.slice(0, MAX_ERRORS).forEach((m) => ul.appendChild(el('li', null, m)));
          items.appendChild(ul);
          if (it.errors.length > MAX_ERRORS) {
            items.appendChild(el('div', 'report-more',
              `… 另有 ${it.errors.length - MAX_ERRORS} 条错误未显示`));
          }
        }
      });
      gbox.appendChild(items);
      box.appendChild(gbox);
    });
    area.appendChild(box);
  });
}

// ------------------------- 事件绑定 -------------------------
$('#scanBtn').addEventListener('click', doScan);
$('#executeBtn').addEventListener('click', onExecuteClick);
$('#conflictSkip').addEventListener('click', () => startExecute('skip'));
$('#conflictOverwrite').addEventListener('click', () => startExecute('overwrite'));
$('#conflictCancel').addEventListener('click',
  () => $('#conflictModal').classList.add('hidden'));

$('#selectAllBtn').addEventListener('click', () => {
  unitModels.forEach((u) => { u.selected = true; });
  refreshUnitChecks();
});
$('#selectNoneBtn').addEventListener('click', () => {
  unitModels.forEach((u) => { u.selected = false; });
  refreshUnitChecks();
});

function refreshUnitChecks() {
  document.querySelectorAll('#unitArea .unit-check').forEach((cb, i) => {
    if (unitModels[i]) cb.checked = unitModels[i].selected;
  });
  updateUnitCount();
}

// 映射表输入：本地即时解析并保留已选语种
$('#titleMap').addEventListener('input', () => {
  const { rows, report } = parseTitleMap($('#titleMap').value);
  rows.forEach((r) => { if (userLang[r.code]) r.lang = userLang[r.code]; });
  renderTitleTable(rows);
  updateParseMsg(report);
});

$('#rootPath').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doScan();
});
