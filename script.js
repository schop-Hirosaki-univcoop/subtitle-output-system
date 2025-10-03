// ====================================================================
// script.js: index.html用 完全版（GAS移植前の全機能を網羅）
// ====================================================================

// --- API設定 ---
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec';
const MY_SECRET_KEY = 'nanndemosoudann_23schop';
const API_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}`;
const API_DICT_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}&dict=1`;
const API_UPDATE_FLAG = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}&flag=1`;

const COL = { TS:0, RNAME:1, Q:2, TEAM:3, SELECTED:4, DONE:5, UID:6 };

// ------ グローバル状態 ------
let rawDataCache = [];
let busy = false;
let currentSelectedUid = null;
let dictCache = [];
let dictTableRows = [];
let dictBulkMode = false;
let dictSelectedRow = null;

// ========== ユーティリティ ==========
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);}
function ellipsis(s,n){s=String(s||''); return s.length>n? s.slice(0,n-1)+'…': s;}
function setBusy(on){
  busy = !!on;
  ['approve-button','reject-button','reset-all-button','force-standby-button','jump-onair-button'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.disabled = !!on;
  });
  updateApproveButtonState();
}
function showToast(title, sub, kind='ok'){
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerHTML = `<span class="icon">★</span><div class="txt"><div class="title">${escapeHtml(title)}</div>${sub?`<div class="sub">${escapeHtml(sub)}</div>`:''}</div>`;
  toast.dataset.kind = kind;
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'), 2400);
}
function showOverlay(msg){
  const ov = document.getElementById('overlay');
  const msgE = document.getElementById('overlay-msg');
  if (!ov || !msgE) return;
  ov.classList.remove('hidden');
  ov.classList.add('show');
  msgE.textContent = msg || '送出更新中…';
}
function hideOverlay(){
  const ov = document.getElementById('overlay');
  if (!ov) return;
  ov.classList.remove('show');
  ov.classList.add('hidden');
}

// ========== 質問リスト描画/選択 ==========
function displayNames(names) {
  const list = document.getElementById("nameList");
  list.innerHTML = "";
  const template = document.getElementById('tpl-selected');
  if (!template) return;
  let total = 0, onair = 0, completed = 0;
  names.forEach((item) => {
    if (!item || item.length < 7) return;
    total++;
    const isSelected = item[COL.SELECTED] === '✔';
    const isCompleted = item[COL.DONE] === '✔';
    if (isSelected) onair++;
    if (isCompleted) completed++;
    const li = template.content.firstElementChild.cloneNode(true);
    li.dataset.uid = item[COL.UID];
    // RN/FAQ判定
    const rnChip = li.querySelector('.rname-chip');
    rnChip.textContent = item[COL.RNAME] || '（匿名）';
    if (item[COL.RNAME] === "Pick Up Question") rnChip.classList.add("is-faq");
    else if (item[COL.RNAME]) rnChip.classList.add("is-rname");
    else rnChip.classList.remove("is-faq", "is-rname");
    // 班
    const teamBox = li.querySelector('.team-box');
    teamBox.textContent = item[COL.TEAM] ? String(item[COL.TEAM]) + "班" : "";
    // 質問
    li.querySelector('.text-container').textContent = item[COL.Q];
    // タイムスタンプ
    let ts = item[COL.TS];
    if (ts instanceof Date && !isNaN(ts)) ts = ts.toISOString().slice(0,19).replace('T',' ');
    li.querySelector('.timestamp').textContent = ts||"";
    // ステータス
    li.classList.toggle("approved", isSelected);
    li.classList.toggle("completed", isCompleted);
    li.classList.toggle("open", !isSelected && !isCompleted);
    li.addEventListener("click", (e) => {
      selectItem(li, item);
    });
    list.appendChild(li);
  });
  document.getElementById('count-total').textContent = total;
  document.getElementById('count-onair').textContent = onair;
  document.getElementById('count-completed').textContent = completed;
}

// 選択
function selectItem(el, item) {
  document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
  el.classList.add('focused');
  currentSelectedUid = item[COL.UID];
  renderPVW(item);
  updateApproveButtonState();
}

// ========== PVW/PGMミラー描画 ==========
function renderPVW(item) {
  const pvwMirror = document.getElementById('pvw-mirror');
  if (!pvwMirror) return;
  pvwMirror.innerHTML = `<div class="p-2 text-white text-left font-sans text-sm">
    <p class="font-bold">${escapeHtml(item[COL.RNAME] || '（匿名）')}</p>
    <p>${escapeHtml(ellipsis(item[COL.Q], 60))}</p>
  </div>`;
}
function updatePreviewMirror() {
  const selectedItem = rawDataCache.find(n => n[COL.SELECTED] === '✔');
  const previewMirror = document.getElementById('preview-mirror');
  if (selectedItem) {
    previewMirror.innerHTML = `<div class="p-2 text-white text-left font-sans text-sm">
      <p class="font-bold">${escapeHtml(selectedItem[COL.RNAME] || '（匿名）')}</p>
      <p>${escapeHtml(ellipsis(selectedItem[COL.Q], 60))}</p>
    </div>`;
  } else {
    previewMirror.textContent = '';
    previewMirror.innerHTML = '';
  }
  updateApproveButtonState();
}

// ========== PGM/TAKE/CLEAR/REJECT/RESETロジック ==========
function updateApproveButtonState() {
  const btn = document.getElementById("approve-button");
  if (!btn) return;
  const focusedEl = document.querySelector('.name-box.focused');
  const onAirEl = document.querySelector('.name-box.approved');
  const isCurrentlyPGM = !!onAirEl;
  btn.classList.remove('danger', 'standby');
  btn.textContent = 'TAKE';
  btn.disabled = false;
  btn.title = 'ダブルクリックでTAKE';
  if (focusedEl) {
    if (focusedEl.classList.contains('approved')) {
      btn.textContent = 'CLEAR';
      btn.classList.add('danger');
      btn.title = 'PGMをCLEAR（回答済に）';
    } else if (focusedEl.classList.contains('completed')) {
      btn.disabled = true;
      btn.title = '再エントリー後にTAKE可能';
    }
  } else {
    btn.textContent = isCurrentlyPGM ? 'CLEAR' : 'TAKE';
    btn.classList.add('standby');
    btn.disabled = !isCurrentlyPGM;
    if (isCurrentlyPGM) {
      btn.title = 'PGMを強制CLEAR';
      btn.classList.add('danger');
    } else {
      btn.title = 'PVWに項目を入れてください';
      btn.disabled = true;
    }
  }
}

async function sendActionToGas(action, uid = null) {
  showOverlay(`操作: ${action} を実行中...`);
  setBusy(true);
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, uid: uid })
    });
    const result = await response.json();
    if (result.status === 'ok') {
      showToast(`${action} 成功`, 'スプレッドシートを更新しました', 'ok');
    } else {
      throw new Error(result.message || 'GASからの応答エラー');
    }
  } catch (error) {
    showToast("操作失敗", ellipsis(error.message, 60), "info");
  } finally {
    loadNames();
    setBusy(false);
    hideOverlay();
  }
}

function setupApproveButtonLogic() {
  let armTimer = null;
  const approveBtn = document.getElementById("approve-button");
  approveBtn.addEventListener("click", function() {
    if (this.disabled) return;
    if (this.dataset.armed !== '1') {
      this.dataset.armed = '1';
      showToast('ARM', 'もう一度クリックでTAKE/CLEAR', 'standby');
      clearTimeout(armTimer);
      armTimer = setTimeout(()=>{ this.dataset.armed='0'; this.title='ダブルクリックでTAKE'; }, 1200);
      return;
    }
    this.dataset.armed = '0';
    handleTakeClear();
  });
  approveBtn.addEventListener("dblclick", function(e) {
    e.preventDefault();
    clearTimeout(armTimer);
    this.dataset.armed = '0';
    handleTakeClear();
  });

  function handleTakeClear() {
    if (busy || approveBtn.disabled) return;
    const focusedEl = document.querySelector('.name-box.focused');
    const onAirEl = document.querySelector('.name-box.approved');
    let targetUid = null;
    if (focusedEl) targetUid = focusedEl.dataset.uid;
    else if (onAirEl) targetUid = onAirEl.dataset.uid;
    else {
      showToast('エラー', '対象項目がありません', 'info');
      return;
    }
    sendActionToGas('TAKE_CLEAR', targetUid);
  }

  document.getElementById("reject-button").addEventListener("click", function() {
    if (this.disabled || busy) return;
    const focusedEl = document.querySelector('.name-box.focused');
    if (!focusedEl) { showToast('項目が選択されていません', '', 'info'); return; }
    if (!focusedEl.classList.contains('completed')) { showToast('回答済みの項目を選択してください', '', 'info'); return; }
    const uid = focusedEl.dataset.uid;
    sendActionToGas('REJECT', uid);
  });
  document.getElementById("reset-all-button").addEventListener("click", function() {
    if (this.disabled || busy) return;
    if (!confirm("本当に『オンエア済』をすべて未オンエアに戻しますか？")) return;
    sendActionToGas('RESET_ALL');
  });
  document.getElementById("force-standby-button").addEventListener("click", function() {
    if (this.disabled || busy) return;
    const onAirEl = document.querySelector('.name-box.approved');
    if (!onAirEl) { showToast('PGMはありません', '', 'info'); return; }
    if (!confirm("本当に現在のPGMを即時CLEAR（回答済みに）しますか？")) return;
    const uid = onAirEl.dataset.uid;
    sendActionToGas('TAKE_CLEAR', uid);
  });
  document.getElementById("jump-onair-button").addEventListener("click", function() {
    const onAirItem = rawDataCache.find(n => n[COL.SELECTED] === '✔');
    if (!onAirItem) { showToast('PGMはありません', '', 'info'); return; }
    loadNames();
    setTimeout(() => {
      const el = document.querySelector(`.name-box[data-uid="${onAirItem[COL.UID]}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectItem(el, onAirItem);
        showToast('PGMへジャンプ', '', 'info');
      }
    }, 50);
  });
}

// ========== データ取得 ==========
async function loadNames() {
  setBusy(true);
  if(rawDataCache.length === 0) showOverlay('リストデータを読み込み中...');
  try {
    const response = await fetch(API_ENDPOINT);
    if (!response.ok) throw new Error(`APIアクセス失敗: ステータス ${response.status}`);
    const rawData = await response.json();
    if (!Array.isArray(rawData) || rawData.length < 2) throw new Error("GASから有効なデータが返されませんでした。");
    rawDataCache = rawData.slice(1);
    displayNames(rawDataCache);
    updatePreviewMirror();
  } catch (error) {
    document.getElementById("nameList").innerHTML = `<li class="text-red-400 p-4">データ取得エラー: ${ellipsis(error.message, 80)}</li>`;
  } finally {
    hideOverlay();
    setBusy(false);
  }
}

// ========== ルビ辞書管理(完全) ==========

// --- 1. 取得 ---
async function loadDict(showToastMsg) {
  try {
    const res = await fetch(API_DICT_ENDPOINT);
    const dict = await res.json();
    dictCache = Array.isArray(dict) ? dict : [];
    renderDictTable();
    if (showToastMsg) showToast('辞書再読込', '', 'ok');
  } catch (e) {
    showToast('辞書取得失敗', e.message, 'info');
  }
}

// --- 2. 描画 ---
function renderDictTable() {
  const tbody = document.getElementById('dict-tbody');
  tbody.innerHTML = '';
  dictTableRows = [];
  dictCache.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.row = row.row;
    tr.dataset.idx = idx;
    tr.className = row.enabled ? '' : 'disabled';
    tr.innerHTML = `
      <td class="col-select"><input type="checkbox" class="dict-row-select" data-row="${row.row}"></td>
      <td class="col-term">${escapeHtml(row.term)}</td>
      <td class="col-ruby">${escapeHtml(row.ruby)}</td>
      <td class="col-mode">${escapeHtml(row.mode)}</td>
    `;
    tr.addEventListener('click', () => selectDictRow(idx));
    tbody.appendChild(tr);
    dictTableRows.push(tr);
  });
}

// --- 3. 選択 ---
function selectDictRow(idx) {
  if (dictBulkMode) return;
  dictSelectedRow = idx;
  dictTableRows.forEach((tr, i) => tr.classList.toggle('selected', i === idx));
  updateDictPanel();
}
function updateDictPanel() {
  // パネルの選択内容表示
  const info = document.getElementById('dict-sel-summary');
  if (dictSelectedRow == null || dictSelectedRow >= dictCache.length) {
    info.textContent = 'なし';
    return;
  }
  const row = dictCache[dictSelectedRow];
  info.textContent = row.term;
  document.getElementById('dict-toggle-enabled').checked = !!row.enabled;
}

// --- 4. 編集 ---
function setupDictEvents() {
  // 再読み込み
  document.getElementById('dict-reload').onclick = () => loadDict(true);

  // 編集
  document.getElementById('dict-edit-row').onclick = () => {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    document.getElementById('dict-term').value = row.term;
    document.getElementById('dict-ruby').value = row.ruby;
    document.getElementById('dict-mode').value = row.mode;
  };

  // 削除
  document.getElementById('dict-delete-row').onclick = async () => {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    if (!confirm(`本当に削除しますか？(${row.term})`)) return;
    await dictDelete(row.row);
    await loadDict(true);
  };

  // 有効/無効
  document.getElementById('dict-toggle-enabled').onchange = async function() {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    await dictEnable(row.row, this.checked);
    await loadDict(true);
  };

  // 保存（追加/上書き）
  document.getElementById('dict-save').onclick = async function(e) {
    e.preventDefault();
    const term = document.getElementById('dict-term').value.trim();
    const ruby = document.getElementById('dict-ruby').value.trim();
    const mode = document.getElementById('dict-mode').value.trim();
    if (!term || !ruby) { alert('用語とよみは必須です'); return; }
    await dictUpsert(term, ruby, mode);
    await loadDict(true);
  };

  // CSVエクスポート
  document.getElementById('btn-export-dict').onclick = function() {
    let csv = "term,ruby,mode,enabled\n";
    dictCache.forEach(row => {
      csv += [row.term, row.ruby, row.mode, row.enabled ? 1 : 0].map(s => `"${s.replace(/"/g,'""')}"`).join(',') + "\n";
    });
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "dictionary.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // CSVインポート
  document.getElementById('btn-import-dict').onclick = function() {
    document.getElementById('file-import-dict').click();
  };
  document.getElementById('file-import-dict').onchange = async function() {
    const file = this.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    let imported = [];
    for (let i=1; i<lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.replace(/^"|"$/g,'').replace(/""/g,'"'));
      if (cols.length < 2) continue;
      imported.push({term: cols[0], ruby: cols[1], mode: cols[2]||"any", enabled: cols[3]!== "0"});
    }
    // 上書き/統合
    const strategy = document.getElementById('import-strategy').value;
    if (strategy==="replace") {
      for (const row of dictCache) await dictDelete(row.row);
      for (const row of imported) await dictUpsert(row.term, row.ruby, row.mode, row.enabled);
    } else {
      for (const row of imported) await dictUpsert(row.term, row.ruby, row.mode, row.enabled);
    }
    await loadDict(true);
  };
}

// --- 5: GAS API ---
async function dictUpsert(term, ruby, mode, enabled) {
  return fetch(API_DICT_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({dict:1, action:"UPSERT", term, ruby, mode, enabled})
  });
}
async function dictDelete(row) {
  return fetch(API_DICT_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({dict:1, action:"DEL", row})
  });
}
async function dictEnable(row, enabled) {
  return fetch(API_DICT_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({dict:1, action:"ENABLE", row, enabled})
  });
}

// ========== タブ切り替え ==========

function setupTabs() {
  document.getElementById('tabbtn-monitors').onclick = function() {
    document.getElementById('tab-monitors').classList.add('active');
    document.getElementById('tab-dict').classList.remove('active');
    this.classList.add('active');
    document.getElementById('tabbtn-dict').classList.remove('active');
  };
  document.getElementById('tabbtn-dict').onclick = function() {
    document.getElementById('tab-dict').classList.add('active');
    document.getElementById('tab-monitors').classList.remove('active');
    this.classList.add('active');
    document.getElementById('tabbtn-monitors').classList.remove('active');
  };
}

// ========== 初期化 ==========
document.addEventListener('DOMContentLoaded', () => {
  setupApproveButtonLogic();
  loadNames();
  setInterval(loadNames, 5000);
  setupDictEvents();
  loadDict();
  setupTabs();
});