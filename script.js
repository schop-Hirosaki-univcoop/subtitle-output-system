// ====================================================================
// script.js: GAS時代のUX完全再現・全機能フルバージョン
// - 選択/選択解除/再選択/リスト外クリック/Esc解除/TAKE後自動解除
// - PVW/PGM表示・全API・辞書・一括編集・CSV・アクセシビリティ・細部まで網羅
// ====================================================================

const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec';
const MY_SECRET_KEY = 'nanndemosoudann_23schop';
const API_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}`;
const API_DICT_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}&dict=1`;

const COL = { TS:0, RNAME:1, Q:2, TEAM:3, SELECTED:4, DONE:5, UID:6 };

let rawDataCache = [];
let busy = false;
let currentSelectedUid = null;
let dictCache = [];
let dictTableRows = [];
let dictBulkMode = false;
let dictSelectedRow = null; // index in dictCache
let dictWorkingBulk = [];   // work copy for bulk edit

// ========== ユーティリティ ==========
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[m]);
}
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
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  toast.innerHTML = `<span class="icon" aria-hidden="true">★</span>
    <div class="txt">
      <div class="title">${escapeHtml(title)}</div>
      ${sub?`<div class="sub">${escapeHtml(sub)}</div>`:''}
    </div>`;
  toast.dataset.kind = kind;
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'), 2400);
}
function showOverlay(msg){
  const ov = document.getElementById('overlay');
  const msgE = document.getElementById('overlay-msg');
  if (!ov || !msgE) return;
  ov.setAttribute('aria-busy','true');
  ov.classList.remove('hidden');
  ov.classList.add('show');
  msgE.textContent = msg || '送出更新中…';
}
function hideOverlay(){
  const ov = document.getElementById('overlay');
  if (!ov) return;
  ov.setAttribute('aria-busy','false');
  ov.classList.remove('show');
  ov.classList.add('hidden');
}

// ========== 質問リスト描画/選択 ==========
function displayNames(names) {
  const list = document.getElementById("nameList");
  list.innerHTML = "";
  const template = document.getElementById('tpl-selected');
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
    li.setAttribute('tabindex', 0);
    // RN/FAQ
    const rnChip = li.querySelector('.rname-chip');
    rnChip.textContent = item[COL.RNAME] || '（匿名）';
    if (item[COL.RNAME] === "Pick Up Question") {
      rnChip.classList.add("is-faq");
      rnChip.setAttribute('aria-label','FAQ');
      li.setAttribute('aria-label', 'FAQ: ' + item[COL.Q]);
    } else if (item[COL.RNAME]) {
      rnChip.classList.add("is-rname");
    } else {
      rnChip.classList.remove("is-faq", "is-rname");
    }
    // 班
    const teamBox = li.querySelector('.team-box');
    teamBox.textContent = item[COL.TEAM] ? String(item[COL.TEAM]) + "班" : "";
    if (item[COL.RNAME] === "Pick Up Question") teamBox.style.display = "none";
    // 本文
    li.querySelector('.text-container').textContent = item[COL.Q];
    // タイムスタンプ
    let ts = item[COL.TS];
    if (ts instanceof Date && !isNaN(ts)) ts = ts.toISOString().slice(0,19).replace('T',' ');
    li.querySelector('.timestamp').textContent = ts||"";
    // ステータス
    li.classList.toggle("approved", isSelected);
    li.classList.toggle("completed", isCompleted);
    li.classList.toggle("open", !isSelected && !isCompleted);

    // 選択状態を復元
    if (item[COL.UID] === currentSelectedUid) {
      li.classList.add('focused');
      renderPVW(item);
    }

    li.addEventListener("click", (e) => {
      // GAS時代: もう一度クリックで選択解除
      if (currentSelectedUid === item[COL.UID]) {
        clearSelection();
        updateApproveButtonState();
        return;
      }
      selectItem(li, item);
    });
    li.addEventListener("keydown", e=>{
      if(e.key==="Enter"||e.key===" "){ e.preventDefault();
        if (currentSelectedUid === item[COL.UID]) {
          clearSelection();
          updateApproveButtonState();
          return;
        }
        selectItem(li,item);}
    });
    list.appendChild(li);
  });
  document.getElementById('count-total').textContent = total;
  document.getElementById('count-onair').textContent = onair;
  document.getElementById('count-completed').textContent = completed;
}
function selectItem(el, item) {
  document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
  el.classList.add('focused');
  currentSelectedUid = item[COL.UID];
  renderPVW(item);
  updateApproveButtonState();
  el.focus();
}
function clearSelection() {
  document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
  currentSelectedUid = null;
  clearPVW();
  updateApproveButtonState();
}
function clearPVW() {
  const pvwMirror = document.getElementById('pvw-mirror');
  if (pvwMirror) {
    pvwMirror.textContent = '';
    pvwMirror.innerHTML = '';
  }
}

// ========== リスト外クリック/Escで選択解除 ==========
function setupSelectionClearUX() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest('.name-box') && !e.target.closest('#dict-drawer') && !e.target.closest('#dict-pane')) {
      clearSelection();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
      // ドロワーも閉じる
      const dictDrawer = document.getElementById('dict-drawer');
      if (dictDrawer && dictDrawer.classList.contains('open')) {
        dictDrawer.classList.remove('open');
        dictDrawer.setAttribute('aria-expanded', 'false');
        document.body.appendChild(document.getElementById('dict-pane'));
        document.getElementById('toggle-dict').setAttribute('aria-expanded', 'false');
        document.getElementById('toggle-dict').focus();
      }
    }
  });
}

// ========== PVW/PGMミラー描画 ==========
function renderPVW(item) {
  const pvwMirror = document.getElementById('pvw-mirror');
  if (!pvwMirror) return;
  let label = '', labelClass = '';
  if(item[COL.RNAME] === "Pick Up Question") {
    label = 'FAQ'; labelClass = 'faq-chip';
  } else if (item[COL.TEAM]) {
    label = item[COL.TEAM]+'班'; labelClass = 'team-box';
  } else if (item[COL.RNAME]) {
    label = item[COL.RNAME]; labelClass = 'rname-chip';
  }
  pvwMirror.innerHTML = `
    <div class="tele-title">${label? `<span class="${labelClass}">${escapeHtml(label)}</span>`:""}
      <span>${escapeHtml(item[COL.RNAME]||'（匿名）')}</span>
    </div>
    <div class="tele-body">${escapeHtml(item[COL.Q])}</div>
  `;
  pvwMirror.setAttribute('aria-label','PVWプレビュー: '+(item[COL.RNAME]||'匿名')+" "+item[COL.Q]);
}
function updatePreviewMirror() {
  const selectedItem = rawDataCache.find(n => n[COL.SELECTED] === '✔');
  const previewMirror = document.getElementById('preview-mirror');
  if (selectedItem) {
    let label = '', labelClass = '';
    if(selectedItem[COL.RNAME] === "Pick Up Question") {
      label = 'FAQ'; labelClass = 'faq-chip';
    } else if (selectedItem[COL.TEAM]) {
      label = selectedItem[COL.TEAM]+'班'; labelClass = 'team-box';
    } else if (selectedItem[COL.RNAME]) {
      label = selectedItem[COL.RNAME]; labelClass = 'rname-chip';
    }
    previewMirror.innerHTML = `
      <div class="tele-title">${label? `<span class="${labelClass}">${escapeHtml(label)}</span>`:""}
        <span>${escapeHtml(selectedItem[COL.RNAME]||'（匿名）')}</span>
      </div>
      <div class="tele-body">${escapeHtml(selectedItem[COL.Q])}</div>
    `;
    previewMirror.setAttribute('aria-label','PGMプレビュー: '+(selectedItem[COL.RNAME]||'匿名')+" "+selectedItem[COL.Q]);
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
  btn.setAttribute('aria-label','TAKE/CLEAR');
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
    await loadNames();
    setBusy(false);
    hideOverlay();
    clearSelection();
    updatePreviewMirror();
  }
}

function setupApproveButtonLogic() {
  let armTimer = null;
  const approveBtn = document.getElementById("approve-button");
  approveBtn.setAttribute('aria-label','TAKE/CLEAR');
  approveBtn.addEventListener("click", function() {
    if (this.disabled) return;
    if (this.dataset.armed !== '1') {
      this.dataset.armed = '1';
      this.classList.add('armed');
      showToast('ARM', 'もう一度クリックでTAKE/CLEAR', 'standby');
      clearTimeout(armTimer);
      armTimer = setTimeout(()=>{ 
        this.dataset.armed='0'; 
        this.classList.remove('armed');
        this.title='ダブルクリックでTAKE'; 
      }, 1200);
      return;
    }
    this.dataset.armed = '0';
    this.classList.remove('armed');
    handleTakeClear();
  });
  approveBtn.addEventListener("dblclick", function(e) {
    e.preventDefault();
    clearTimeout(armTimer);
    this.dataset.armed = '0';
    this.classList.remove('armed');
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
    displayNames(rawDataCache);
    currentSelectedUid = onAirItem[COL.UID];
    const el = document.querySelector(`.name-box[data-uid="${onAirItem[COL.UID]}"]`);
    if (el) {
      el.classList.add('focused');
      renderPVW(onAirItem);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('PGMへジャンプ', '', 'info');
    }
    updatePreviewMirror();
    updateApproveButtonState();
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
    if (currentSelectedUid) {
      const item = rawDataCache.find(x => x[COL.UID] === currentSelectedUid);
      if (item) {
        const el = document.querySelector(`.name-box[data-uid="${currentSelectedUid}"]`);
        if (el) el.classList.add('focused');
        renderPVW(item);
      }
    }
  } catch (error) {
    document.getElementById("nameList").innerHTML = `<li class="text-red-400 p-4">データ取得エラー: ${ellipsis(error.message, 80)}</li>`;
  } finally {
    hideOverlay();
    setBusy(false);
  }
}

// ========== ルビ辞書 管理・編集・一括編集・CSV ==========
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
function renderDictTable() {
  const tbody = document.getElementById('dict-tbody');
  tbody.innerHTML = '';
  dictTableRows = [];
  const data = dictBulkMode ? dictWorkingBulk : dictCache;
  data.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.row = row.row;
    tr.dataset.idx = idx;
    tr.className = row.enabled ? '' : 'disabled';
    if (dictBulkMode) tr.classList.toggle('bulk-selected', !!row._sel);
    tr.innerHTML = `
      <td class="col-select">
        ${dictBulkMode ? `<input type="checkbox" class="dict-row-select" data-row="${row.row}" tabindex="0" aria-label="行選択" ${row._sel?'checked':''}>` : ''}
      </td>
      <td class="col-term">${escapeHtml(row.term)}</td>
      <td class="col-ruby">${escapeHtml(row.ruby)}</td>
      <td class="col-mode">${escapeHtml(row.mode)}</td>
    `;
    tr.addEventListener('click', (e) => {
      if (dictBulkMode) {
        // 一括編集: 行クリックで選択トグル
        row._sel = !row._sel;
        tr.classList.toggle('bulk-selected', !!row._sel);
        const chk = tr.querySelector('.dict-row-select');
        if (chk) chk.checked = !!row._sel;
        updateDictBulkToolbar();
      } else {
        selectDictRow(idx);
      }
    });
    dictTableRows.push(tr);
    tbody.appendChild(tr);
  });
  updateDictPanel();
  updateDictBulkToolbar();
}
function selectDictRow(idx) {
  if (dictBulkMode) return;
  dictSelectedRow = idx;
  dictTableRows.forEach((tr, i) => tr.classList.toggle('selected', i === idx));
  updateDictPanel();
  dictTableRows[idx] && dictTableRows[idx].focus && dictTableRows[idx].focus();
}
function updateDictPanel() {
  const info = document.getElementById('dict-sel-summary');
  if (dictBulkMode) {
    info.textContent = '一括編集中';
    return;
  }
  if (dictSelectedRow == null || dictSelectedRow >= dictCache.length) {
    info.textContent = 'なし';
    document.getElementById('dict-toggle-enabled').checked = false;
    document.getElementById('dict-toggle-enabled').disabled = true;
    document.getElementById('dict-edit-row').disabled = true;
    document.getElementById('dict-delete-row').disabled = true;
    return;
  }
  const row = dictCache[dictSelectedRow];
  info.textContent = row.term;
  document.getElementById('dict-toggle-enabled').checked = !!row.enabled;
  document.getElementById('dict-toggle-enabled').disabled = false;
  document.getElementById('dict-edit-row').disabled = false;
  document.getElementById('dict-delete-row').disabled = false;
}
function updateDictBulkToolbar() {
  const count = dictWorkingBulk?.filter(r=>r._sel).length || 0;
  const lab = document.getElementById('dict-bulk-count');
  if (lab) lab.textContent = count;
  document.getElementById('dict-bulk-enable').disabled = !count;
  document.getElementById('dict-bulk-disable').disabled = !count;
  document.getElementById('dict-bulk-delete').disabled = !count;
  document.getElementById('dict-bulk-save').disabled = false;
}
function setupDictEvents() {
  document.getElementById('dict-reload').onclick = () => loadDict(true);
  document.getElementById('dict-edit-row').onclick = () => {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    document.getElementById('dict-term').value = row.term;
    document.getElementById('dict-ruby').value = row.ruby;
    document.getElementById('dict-mode').value = row.mode;
  };
  document.getElementById('dict-delete-row').onclick = async () => {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    if (!confirm(`本当に削除しますか？(${row.term})`)) return;
    await dictDelete(row.row);
    await loadDict(true);
    dictSelectedRow = null;
  };
  document.getElementById('dict-toggle-enabled').onchange = async function() {
    if (dictSelectedRow == null) return;
    const row = dictCache[dictSelectedRow];
    await dictEnable(row.row, this.checked);
    await loadDict(true);
  };
  document.getElementById('dict-save').onclick = async function(e) {
    e.preventDefault();
    const term = document.getElementById('dict-term').value.trim();
    const ruby = document.getElementById('dict-ruby').value.trim();
    const mode = document.getElementById('dict-mode').value.trim();
    if (!term || !ruby) { showToast('エラー', '用語とよみは必須です', 'info'); return; }
    if (!/^([ぁ-んア-ン一-龥ａ-ｚＡ-Ｚa-zA-Z0-9\-ー々]+)$/.test(term)) { showToast('エラー','用語に不正な文字があります','info'); return;}
    await dictUpsert(term, ruby, mode);
    await loadDict(true);
  };
  document.getElementById('btn-export-dict').onclick = function() {
    let csv = "term,ruby,mode,enabled\n";
    dictCache.forEach(row => {
      csv += [row.term, row.ruby, row.mode, row.enabled ? 1 : 0].map(s => `"${(s||'').replace(/"/g,'""')}"`).join(',') + "\n";
    });
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "dictionary.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
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
      if (!cols[0] || !cols[1]) { showToast('エラー', '空の用語またはよみを検出','info'); continue;}
      imported.push({term: cols[0], ruby: cols[1], mode: cols[2]||"any", enabled: cols[3]!=="0"});
    }
    if (!imported.length) { showToast('エラー', '有効な辞書行がありません', 'info'); return;}
    const strategy = document.getElementById('import-strategy').value;
    if (strategy==="replace") {
      for (const row of dictCache) await dictDelete(row.row);
      for (const row of imported) await dictUpsert(row.term, row.ruby, row.mode, row.enabled);
    } else {
      for (const row of imported) await dictUpsert(row.term, row.ruby, row.mode, row.enabled);
    }
    await loadDict(true);
  };
  // 一括編集
  document.getElementById('dict-bulk-edit').onclick = function() {
    dictBulkMode = true;
    dictWorkingBulk = dictCache.map(r=>({...r, _sel:false}));
    document.getElementById('dict-pane').classList.add('bulk-editing');
    renderDictTable();
  };
  document.getElementById('dict-bulk-enable').onclick = function() {
    dictWorkingBulk.forEach(r=>{if(r._sel) r.enabled = true;});
    renderDictTable();
  };
  document.getElementById('dict-bulk-disable').onclick = function() {
    dictWorkingBulk.forEach(r=>{if(r._sel) r.enabled = false;});
    renderDictTable();
  };
  document.getElementById('dict-bulk-delete').onclick = async function() {
    const targets = dictWorkingBulk.filter(r=>r._sel);
    if (!targets.length) { showToast('削除対象が選択されていません','', 'info'); return; }
    if (!confirm(`${targets.length}件を削除しますか？`)) return;
    for (const row of targets) await dictDelete(row.row);
    await loadDict(true);
    exitBulkEdit();
  };
  document.getElementById('dict-bulk-save').onclick = async function() {
    for (const row of dictWorkingBulk) {
      if (row.enabled !== dictCache.find(r=>r.row===row.row)?.enabled) {
        await dictEnable(row.row, row.enabled);
      }
    }
    await loadDict(true);
    exitBulkEdit();
  };
  document.getElementById('dict-bulk-cancel').onclick = function() {
    exitBulkEdit();
  };
}
function exitBulkEdit() {
  dictBulkMode = false;
  dictWorkingBulk = [];
  document.getElementById('dict-pane').classList.remove('bulk-editing');
  renderDictTable();
}
// --- GAS API ---
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

// ========== 右サイドドロワーUI/ARIA/アニメ ==========
function setupDictDrawer() {
  const dictDrawer = document.getElementById('dict-drawer');
  const dictDrawerBody = document.getElementById('dict-drawer-body');
  const dictPane = document.getElementById('dict-pane');
  const toggleDictBtn = document.getElementById('toggle-dict');
  const dictDrawerClose = document.getElementById('dict-drawer-close');
  function openDictDrawer() {
    dictDrawer.classList.add('open');
    dictDrawer.setAttribute('aria-expanded', 'true');
    dictDrawerBody.appendChild(dictPane);
    toggleDictBtn.setAttribute('aria-expanded', 'true');
    dictPane.focus();
  }
  function closeDictDrawer() {
    dictDrawer.classList.remove('open');
    dictDrawer.setAttribute('aria-expanded', 'false');
    document.body.appendChild(dictPane);
    toggleDictBtn.setAttribute('aria-expanded', 'false');
    toggleDictBtn.focus();
  }
  toggleDictBtn.addEventListener('click', () => {
    if (!dictDrawer.classList.contains('open')) openDictDrawer();
    else closeDictDrawer();
  });
  dictDrawerClose.addEventListener('click', closeDictDrawer);
  dictDrawerClose.setAttribute('aria-label','辞書を閉じる');
  toggleDictBtn.setAttribute('tabindex','0');
  dictPane.setAttribute('tabindex','0');
  closeDictDrawer();
}

// ========== ショートカット/操作補助 ==========
function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    if(e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
    if(e.key === '?' && !document.getElementById('help-modal')) {
      e.preventDefault();
      showHelpModal();
    }
  });
}
function showHelpModal(){
  const modal = document.createElement('div');
  modal.id = "help-modal";
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('tabindex','-1');
  modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#181d29;padding:28px 32px;border-radius:12px;max-width:480px;text-align:left;box-shadow:0 8px 32px #000;">
      <h2 style="font-size:1.15em;margin-bottom:.7em;color:#fff;">ショートカット一覧</h2>
      <ul style="line-height:1.8;color:#eee;padding-left:1.2em">
        <li><b>/</b> ... 検索バーにフォーカス</li>
        <li><b>Esc</b> ... 選択解除＆ドロワーやモーダルを閉じる</li>
        <li><b>Enter/Space</b> ... 質問リスト項目の選択/再クリックで解除</li>
        <li><b>?</b> ... このヘルプを表示</li>
      </ul>
      <button id="help-close" style="margin-top:1.7em;background:#2a3342;color:#fff;font-weight:bold;border-radius:8px;padding:7px 20px;">閉じる</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.focus();
  document.getElementById('help-close').onclick = ()=>{ modal.remove(); };
  modal.addEventListener('keydown', e=>{
    if(e.key==="Escape"||e.key==="Enter"||e.key===" "){ modal.remove(); }
  });
}

// ========== 初期化 ==========
document.addEventListener('DOMContentLoaded', () => {
  setupDictDrawer();
  setupApproveButtonLogic();
  loadNames();
  setInterval(loadNames, 5000);
  setupSelectionClearUX();
  setupShortcuts();
  setupDictEvents();
  loadDict();
});