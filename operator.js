import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, remove, get, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
    authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
    databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "subtitle-output-system-9bc14",
    storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
    messagingSenderId: "378400426909",
    appId: "1:378400426909:web:f1549aad61e3f7aacebd74"
};

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec'; 

// --- 初期化処理 ---
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
// ★ Display 側の状態ランプ購読
const renderRef = ref(database, 'render_state');
const lampEl = document.getElementById('render-lamp');
const phaseEl = document.getElementById('render-phase');
const sumEl    = document.getElementById('render-summary');
const titleEl  = document.getElementById('render-title');
const qEl      = document.getElementById('render-question');
const updEl    = document.getElementById('render-updated');
let lastUpdatedAt = 0;

function setLamp(phase){
    lampEl.className = 'lamp';
    switch (phase) {
        case 'visible': lampEl.classList.add('is-visible'); break;
        case 'showing':
        case 'hiding':  lampEl.classList.add('is-showing'); break;
        case 'hidden':  lampEl.classList.add('is-hidden');  break;
        case 'error':   lampEl.classList.add('is-error');   break;
        default:        lampEl.classList.add('is-hidden');  break;
    }
    phaseEl.textContent = phase || '-';
}

  function normalizeUpdatedAt(u){
    if (!u) return 0;
    if (typeof u === 'number') return u;        // RTDB: serverTimestamp → number(millis)
    if (u.seconds) return u.seconds*1000;       // もしオブジェクト形式なら
    return 0;
  }
  function formatRelative(ms){
    if (!ms) return '—';
    const diff = Math.max(0, Date.now() - ms);
    const s = Math.floor(diff/1000);
    if (s < 60) return `${s}秒前`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}時間前`;
    const d = Math.floor(h/24);
    return `${d}日前`;
  }

  onValue(renderRef, (snap)=>{
    const v = snap.val() || {};
    setLamp(v.phase);
    // 表示内容の反映
    const now = v.nowShowing || null;
    if (!now){
      titleEl.textContent = '（非表示）';
      qEl.textContent     = '';
    }else{
      const name = (now.name || '').trim();
      // “Pick Up Question” なら「ラジオネーム：」は付けない
      titleEl.textContent = name === 'Pick Up Question' ? name : `ラジオネーム：${name}`;
      qEl.textContent     = (now.question || '').replace(/\s+/g,' ').trim();
    }
    // 更新時刻＆フラッシュ
    const at = normalizeUpdatedAt(v.updatedAt);
    updEl.textContent = at ? `${new Date(at).toLocaleTimeString('ja-JP',{hour12:false})}（${formatRelative(at)}）` : '—';
    if (at && at > lastUpdatedAt){
      lastUpdatedAt = at;
      sumEl.classList.add('is-updated');
      document.querySelector('.render-indicator')?.classList.add('is-updated');
      setTimeout(()=>{
        sumEl.classList.remove('is-updated');
        document.querySelector('.render-indicator')?.classList.remove('is-updated');
      }, 800);
    }
  });

onValue(renderRef, (snap)=>{
    const v = snap.val() || {};
    setLamp(v.phase);
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const telopRef = ref(database, 'currentTelop');
const updateTriggerRef = ref(database, 'update_trigger');

// --- DOM要素の取得 ---
const dom = {
    loginContainer: document.getElementById('login-container'),
    mainContainer: document.getElementById('main-container'),
    actionPanel: document.getElementById('action-panel'),
    userInfo: document.getElementById('user-info'),
    questionsTableBody: document.querySelector('#questions-table tbody'),
    dictionaryTableBody: document.querySelector('#dictionary-table tbody'),
    logsTableBody: document.querySelector('#logs-table tbody'),
    addTermForm: document.getElementById('add-term-form'),
    newTermInput: document.getElementById('new-term'),
    newRubyInput: document.getElementById('new-ruby'),
    actionButtons: ['btn-display', 'btn-unanswer', 'btn-edit'].map(id => document.getElementById(id)),
    selectedInfo: document.getElementById('selected-info'),
    selectAllCheckbox: document.getElementById('select-all-checkbox'),
    batchUnanswerBtn: document.getElementById('btn-batch-unanswer')
};

Object.assign(dom, {
  logsStreamView: document.getElementById('logs-stream-view'),
  logStream: document.getElementById('log-stream'),
  logSearch: document.getElementById('log-search'),
  logAutoscroll: document.getElementById('log-autoscroll'),
});

// --- 状態管理変数 ---
let state = {
    allQuestions: [],
    allLogs: [],
    currentMainTab: 'questions',
    currentSubTab: 'normal',
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: true,
};
dom.logSearch.addEventListener('input', ()=>renderLogs());
dom.logAutoscroll.addEventListener('change', (e)=>{ state.autoScrollLogs = e.target.checked; });

// --- イベントリスナーの設定 ---
document.getElementById('login-button').addEventListener('click', login);
document.querySelectorAll('.main-tab-button').forEach(button => {
    button.addEventListener('click', () => switchMainTab(button.dataset.tab));
});
document.querySelectorAll('.sub-tab-button').forEach(button => {
    button.addEventListener('click', () => switchSubTab(button.dataset.subTab));
});
document.getElementById('manual-update-button').addEventListener('click', () => {
    fetchQuestions();
    fetchLogs();
});
document.getElementById('btn-display').addEventListener('click', handleDisplay);
document.getElementById('btn-unanswer').addEventListener('click', handleUnanswer);
document.getElementById('btn-edit').addEventListener('click', handleEdit);
document.getElementById('btn-clear').addEventListener('click', clearTelop);
document.getElementById('fetch-dictionary-button').addEventListener('click', fetchDictionary);

dom.addTermForm.addEventListener('submit', addTerm);
dom.selectAllCheckbox.addEventListener('change', handleSelectAll);
dom.batchUnanswerBtn.addEventListener('click', handleBatchUnanswer);
dom.questionsTableBody.addEventListener('change', (e) => {
  if (e.target && e.target.classList.contains('row-checkbox')) {
    updateBatchButtonVisibility();
  }
});

// --- ログイン状態の監視 ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // ログイン成功後、まずユーザー権限をチェック
        try {
            const result = await apiPost({ action: 'fetchSheet', sheet: 'users' });
            if (result.success && result.data) {
                const authorizedUsers = result.data.map(item => item['メールアドレス']); 
                if (authorizedUsers.includes(user.email)) {
                    // ログイン成功
                    dom.loginContainer.style.display = 'none';
                    dom.mainContainer.style.display = 'flex';
                    dom.actionPanel.style.display = 'flex';
                    dom.userInfo.innerHTML = `${user.displayName} (${user.email}) <button id="logout-button">ログアウト</button>`;
                    document.getElementById('logout-button').addEventListener('click', logout);
                    fetchQuestions();
                    fetchDictionary();
                    fetchLogs();
                    showToast(`ようこそ、${user.displayName}さん`, 'success');

                    // リアルタイム更新の監視を開始
                    let _rtTimer = null;
                    onValue(updateTriggerRef, (snapshot) => {
                      if (!snapshot.exists()) return;
                      clearTimeout(_rtTimer);
                      _rtTimer = setTimeout(()=>{ fetchQuestions(); fetchLogs(); }, 150);
                    });
                } else {
                    // --- 権限NG処理 ---
                    showToast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", 'error');
                    logout();
                }
            } else {
                // --- 権限確認失敗処理 ---
                showToast("ユーザー権限の確認に失敗しました。", 'error');
                logout();
            }
        } catch (error) {
            // --- エラー処理 ---
            console.error("Authorization check failed:", error);
            showToast("ユーザー権限の確認中にエラーが発生しました。", 'error');
            logout();
        }
    } else {
        // --- ログアウト時の処理 ---
        dom.loginContainer.style.display = 'block';
        dom.mainContainer.style.display = 'none';
        dom.actionPanel.style.display = 'none';
        dom.userInfo.innerHTML = '';
        // データベースの変更監視を停止
        off(updateTriggerRef);
    }
});

function switchMainTab(tabName) {
    if (!tabName) return;
    state.currentMainTab = tabName;
    document.querySelectorAll('.main-tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.main-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-content`);
    });
}

function switchSubTab(tabName) {
    if (!tabName) return;
    state.currentSubTab = tabName;
    document.querySelectorAll('.sub-tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subTab === tabName);
    });
    renderQuestions(); // サブタブは質問リストを再描画するだけ
}

// --- データ取得処理 ---
async function fetchQuestions() {
    try {
        const result = await apiPost({ action: 'fetchSheet', sheet: 'answer' });
        if (result.success) {
            state.allQuestions = result.data; // 取得した全質問を保持
            renderQuestions(); // リストの描画処理を呼び出す
        }
    } catch (error) { console.error('通信エラーが発生しました: ' + error.message); }
}
async function fetchDictionary() {
    try {
        const result = await apiPost({ action: 'fetchSheet', sheet: 'dictionary' });
        if (result.success) {
            dom.dictionaryTableBody.innerHTML = '';
            result.data.forEach(item => {
                const tr = document.createElement('tr');

                const toggleBtn = document.createElement('button');
                toggleBtn.textContent = item.enabled ? '無効にする' : '有効にする';
                toggleBtn.addEventListener('click', () => toggleTerm(item.term, !item.enabled));

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '削除';
                deleteBtn.addEventListener('click', () => deleteTerm(item.term));

                tr.innerHTML = `
                    <td>${escapeHtml(item.term)}</td>
                    <td>${escapeHtml(item.ruby)}</td>
                    <td>${item.enabled ? '有効' : '無効'}</td>
                `;
                const actionTd = document.createElement('td');
                actionTd.appendChild(toggleBtn);
                actionTd.appendChild(deleteBtn);
                tr.appendChild(actionTd);
                
                if (!item.enabled) { tr.classList.add('disabled'); }
                dom.dictionaryTableBody.appendChild(tr);
            });

            // ▼ 有効な辞書だけを Firebase にミラー（display が購読）
            const enabledOnly = result.data.filter(i => i.enabled === true);
            await set(ref(database, 'dictionary'), enabledOnly);
        }
    } catch (error) { alert('辞書の取得に失敗: ' + error.message); }
}
async function fetchLogs() {
    try {
        const result = await apiPost({ action: 'fetchSheet', sheet: 'logs' });
        if (result.success) {
            state.allLogs = result.data;
            if (state.allLogs.length) console.debug('logs keys =', Object.keys(state.allLogs[0]));
            renderLogs();
        }
    } catch (error) { console.error('ログの取得に失敗:', error); }
}


// --- データ描画関数 ---
async function renderQuestions() {
    const questionsToRender = state.allQuestions.filter(item => {
        const isPuq = item['ラジオネーム'] === 'Pick Up Question';
        return state.currentSubTab === 'puq' ? isPuq : !isPuq;
    });
    const snapshot = await get(telopRef);
    const currentTelop = snapshot.val();
    const currentSelectedUid = state.selectedRowData ? state.selectedRowData.uid : null;
    dom.questionsTableBody.innerHTML = '';
    questionsToRender.forEach(item => {
        const tr = document.createElement('tr');
        const isAnswered = item['回答済'] === true;
        tr.className = isAnswered ? 'locked' : '';
        tr.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            document.querySelectorAll('#questions-table tbody tr').forEach(row => row.classList.remove('selected-row'));
            tr.classList.add('selected-row');
            state.selectedRowData = { uid: item['UID'], name: item['ラジオネーム'], question: item['質問・お悩み'], isAnswered: isAnswered };
            dom.actionButtons.forEach(btn => btn.disabled = false);
            dom.actionButtons[0].disabled = isAnswered; // 回答済なら表示ボタンを無効化
            dom.actionButtons[1].disabled = !isAnswered; // 未回答なら未回答ボタンを無効化
            dom.selectedInfo.textContent = `選択中: ${escapeHtml(item['ラジオネーム'])}`;
        });
        if (item['UID'] === currentSelectedUid) { tr.classList.add('selected-row'); }
        if (currentTelop && currentTelop.name === item['ラジオネーム'] && currentTelop.question === item['質問・お悩み']) {
            tr.classList.add('now-displaying');
            if (state.lastDisplayedUid === item['UID']) {
                tr.classList.add('flash');
                tr.addEventListener('animationend', () => tr.classList.remove('flash'), { once: true });
                state.lastDisplayedUid = null;
            }
        }
        const statusText = item['選択中'] ? '表示中' : (isAnswered ? '回答済' : '未回答');
        tr.innerHTML = `
            <td><input type="checkbox" class="row-checkbox" data-uid="${item['UID']}"></td>
            <td>${escapeHtml(item['ラジオネーム'])}</td>
            <td>${escapeHtml(item['質問・お悩み'])}</td>
            <td>${statusText}</td>`;
        dom.questionsTableBody.appendChild(tr);
    });
    if (!questionsToRender.some(item => item['UID'] === currentSelectedUid)) {
        state.selectedRowData = null;
        dom.actionButtons.forEach(btn => btn.disabled = true);
        dom.selectedInfo.textContent = '行を選択してください';
    }
    updateBatchButtonVisibility();
}
function renderLogs(){
  const rows = applyLogFilters(state.allLogs || []);
  renderLogsStream(rows);
}

function applyLogFilters(arr){
  const q = (dom.logSearch?.value || '').trim().toLowerCase();
  if (!q) return arr;
  return arr.filter(row=>{
    const rawTs = row.Timestamp ?? row.timestamp ?? row['時刻'] ?? row['タイムスタンプ'] ?? '';
    const tsText = (parseLogTimestamp(rawTs)?.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) || String(rawTs)).toLowerCase();
    const user    = String(row.User    ?? row.user    ?? row['ユーザー'] ?? '').toLowerCase();
    const action  = String(row.Action  ?? row.action  ?? row['アクション'] ?? '').toLowerCase();
    const details = String(row.Details ?? row.details ?? row['詳細'] ?? '').toLowerCase();
    const level   = getLogLevel(row).toLowerCase();
    return tsText.includes(q)||user.includes(q)||action.includes(q)||details.includes(q)||level.includes(q);
  });
}
function renderLogsStream(rows){
  const max = 500; // 重くならないよう上限
  const viewRows = rows.slice(-max);
  dom.logStream.innerHTML = '';
  for (const log of viewRows){
    const rawTs = log.Timestamp ?? log.timestamp ?? log['時刻'] ?? log['タイムスタンプ'] ?? '';
    const d = parseLogTimestamp(rawTs);
    const tsText = d ? d.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : String(rawTs||'');
    const user = String(log.User ?? '');
    const action = String(log.Action ?? '');
    const details = String(log.Details ?? '');
    const level = getLogLevel(log);      // ★ レベル判定
    const levelCls = `lvl-${level}`;     // log-line 用クラス
    const line = document.createElement('div');
    line.className = `log-line ${levelCls}`;
    line.innerHTML =
      `<span class="ts">[${escapeHtml(tsText)}]</span> ` +
      `<span class="badge level ${escapeHtml(level)}">${escapeHtml(level.toUpperCase())}</span> ` +
      `<span class="badge user">@${escapeHtml(user)}</span> ` +
      `<span class="badge action">${escapeHtml(action.toUpperCase())}</span> ` +
      `<span class="details">${escapeHtml(details)}</span>`;
    dom.logStream.appendChild(line);
  }
  if (state.autoScrollLogs) dom.logStream.scrollTop = dom.logStream.scrollHeight;
}

function parseLogTimestamp(ts) {
  if (ts == null) return null;
  if (ts instanceof Date && !isNaN(ts)) return ts;
  if (typeof ts === 'number') {
    if (ts > 1e12) return new Date(ts);        // epoch ms
    if (ts > 1e10) return new Date(ts * 1000); // epoch sec
    // Excel 序数 (1899-12-30起点)
    const ms = (ts - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof ts === 'string') {
    let s = ts.trim();
    if (!s) return null;
    // 2025/10/05 12:34:56 → Safari 対策
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
      const [dPart, tPart='00:00:00'] = s.split(' ');
      const [y,m,d] = dPart.split('/').map(Number);
      const [hh=0,mm=0,ss=0] = tPart.split(':').map(Number);
      return new Date(y, m-1, d, hh, mm, ss);
    }
    // 2025-10-05 12:34:56 → T 挿入
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  return null;
}

// --- 操作関数 ---
async function handleDisplay() {
    if (!state.selectedRowData || state.selectedRowData.isAnswered) return;
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
        if (previousTelop) {
            const prevItem = state.allQuestions.find(q => q['ラジオネーム'] === previousTelop.name && q['質問・お悩み'] === previousTelop.question);
            if (prevItem) { await updateStatusOnServer([prevItem['UID']], true); }
        }
        await set(telopRef, { name: state.selectedRowData.name, question: state.selectedRowData.question });
        await updateStatusOnServer([], false, true, state.selectedRowData.uid);
        state.lastDisplayedUid = state.selectedRowData.uid;
        logAction('DISPLAY', `RN: ${state.selectedRowData.name}`);
        fetchQuestions();
        showToast(`「${state.selectedRowData.name}」さんの質問を表示しました。`, 'success');
    } catch (error) {
        showToast('表示処理中にエラーが発生しました: ' + error.message, 'error');
    }
}
async function handleAnswered() {
    if (!state.selectedRowData) return;
    if (!confirm(`「${state.selectedRowData.name}」の質問を「回答済」にしますか？`)) return;
    try {
        const result = await apiPost({ action: 'updateStatus', uid: state.selectedRowData.uid, status: true });
        if (result.success) {
           logAction('SET_ANSWERED', `UID: ${state.selectedRowData.uid}`);
           fetchQuestions();
           showToast('ステータスを「回答済」に更新しました。', 'success');
        } else { 
            showToast('ステータスの更新に失敗しました: ' + result.error, 'error');
        }
    } catch (error) { 
        showToast('通信エラー: ' + error.message, 'error');
    }
}
async function updateStatusOnServer(uids, isAnswered, isSelectingUpdate = false, selectingUid = null) {
    try {
        const action = isSelectingUpdate
          ? (selectingUid === -1 ? 'clearSelectingStatus' : 'updateSelectingStatus')
          : 'batchUpdateStatus';
        const payload =
          action === 'updateSelectingStatus'   ? { action, uid: selectingUid } :
          action === 'clearSelectingStatus'    ? { action } :
                                                 { action, uids, status: isAnswered };
        const result = await apiPost(payload);
        if (result.success) {
            if (!isSelectingUpdate) {
                logAction(isAnswered ? 'BATCH_SET_ANSWERED' : 'BATCH_SET_UNANSWERED', `UIDs: ${uids.join(', ')}`);
                showToast(`${uids.length}件を更新しました。`, 'success');
            }
            fetchQuestions();
        } else { showToast('更新に失敗しました: ' + result.error, 'error'); }
    } catch (error) { showToast('通信エラー: ' + error.message, 'error'); }
}
function handleSelectAll(event) {
    document.querySelectorAll('.row-checkbox').forEach(checkbox => { checkbox.checked = event.target.checked; });
    updateBatchButtonVisibility();
}
function updateBatchButtonVisibility() {
    const checkedCount = document.querySelectorAll('.row-checkbox:checked').length;
    dom.batchUnanswerBtn.style.display = checkedCount > 0 ? 'inline-block' : 'none';
}
async function handleEdit() {
    if (!state.selectedRowData) return;
    const newText = prompt("質問内容を編集してください：", state.selectedRowData.question);
    if (newText === null || newText.trim() === state.selectedRowData.question.trim()) return;
    try {
        const result = await apiPost({ action: 'editQuestion', uid: state.selectedRowData.uid, newText: newText.trim() });
        if (result.success) {
            logAction('EDIT', `UID: ${state.selectedRowData.uid}`);
            showToast('質問を更新しました。', 'success');
            fetchQuestions();
        } else { 
            showToast('質問の更新に失敗しました: ' + result.error, 'error');
        }
    } catch (error) { 
        showToast('通信エラー: ' + error.message, 'error');
    }
}
async function clearTelop() {
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
        if (previousTelop) {
            const prevItem = state.allQuestions.find(q => q['ラジオネーム'] === previousTelop.name && q['質問・お悩み'] === previousTelop.question);
            if (prevItem) { await updateStatusOnServer([prevItem['UID']], true); }
        }
        await remove(telopRef);
        await updateStatusOnServer([], false, true, -1);
        logAction('CLEAR');
        fetchQuestions();
        showToast('テロップを消去しました。', 'success');
    } catch(error) {
        showToast('テロップの消去中にエラーが発生しました: ' + error.message, 'error');
    }
}
function handleUnanswer() {
    if (!state.selectedRowData || !state.selectedRowData.isAnswered) return;
    if (!confirm(`「${state.selectedRowData.name}」の質問を「未回答」に戻しますか？`)) return;
    updateStatusOnServer([state.selectedRowData.uid], false);
}
function handleBatchUnanswer() {
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    if (!confirm(`${checkedBoxes.length}件の質問を「未回答」に戻しますか？`)) return;
    const uidsToUpdate = Array.from(checkedBoxes).map(cb => cb.dataset.uid);
    updateStatusOnServer(uidsToUpdate, false);
}

async function logAction(actionName, details = '') {
  try {
    await apiPost({
      action: 'logAction',   // ← ディスパッチ用
      action_type: actionName, // ← 保存したい「操作名」
      details
    });
  } catch(e){ console.error('Failed to write log:', e); }
}

// --- 辞書関連の関数 ---
async function addTerm(event) {
    event.preventDefault();
    const term = dom.newTermInput.value.trim();
    const ruby = dom.newRubyInput.value.trim();
    if (!term || !ruby) return;

    try {
        const result = await apiPost({ action: 'addTerm', term, ruby });
        if (result.success) {
            dom.newTermInput.value = '';
            dom.newRubyInput.value = '';
            fetchDictionary();
        } else {
            showToast('追加失敗: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('通信エラー: ' + error.message, 'error');
    }
}

async function deleteTerm(term) {
    if (!confirm(`「${term}」を辞書から削除しますか？`)) return;
    try {
        const result = await apiPost({ action: 'deleteTerm', term });
        if (result.success) {
            fetchDictionary();
        } else {
            showToast('削除失敗: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('通信エラー: ' + error.message, 'error');
    }
}

async function toggleTerm(term, newStatus) {
    try {
        const result = await apiPost({ action: 'toggleTerm', term, enabled: newStatus });
        if (result.success) {
            fetchDictionary();
        } else {
            showToast('状態の更新失敗: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('通信エラー: ' + error.message, 'error');
    }
}

// --- 認証関数 ---
async function login() {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed:", error);
        showToast("ログインに失敗しました。", 'error');
    }
}
async function logout() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout failed:", error);
    }
}

// --- ヘルパー関数 ---
function escapeHtml(v) {
  const s = v == null ? '' : String(v);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
}

function showToast(message, type = 'success') {
    const backgroundColor = type === 'success' 
        ? "linear-gradient(to right, #4CAF50, #77dd77)" 
        : "linear-gradient(to right, #f06595, #ff6b6b)";

    Toastify({
        text: message,
        duration: 3000,
        close: true,
        gravity: "top", // `top` or `bottom`
        position: "right", // `left`, `center` or `right`
        stopOnFocus: true, // Prevents dismissing of toast on hover
        style: {
            background: backgroundColor,
        },
        className: `toastify-${type}`
    }).showToast();
}

async function getIdTokenSafe(force = false) {
  const user = auth.currentUser || await new Promise(resolve => {
    const un = onAuthStateChanged(auth, u => { un(); resolve(u); });
  });
  if (!user) throw new Error('Not signed in');
  return await user.getIdToken(force);
}

async function apiPost(payload, retryOnAuthError = true) {
  const idToken = await getIdTokenSafe();
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // ← プリフライト回避
    body: JSON.stringify({ ...payload, idToken })
  });
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Bad JSON response'); }

  if (!json.success) {
    // トークン期限切れ等を想定して一度だけリフレッシュ再試行
    const msg = String(json.error || '');
    if (retryOnAuthError && /Auth/.test(msg)) {
      await getIdTokenSafe(true); // force refresh
      return await apiPost(payload, false);
    }
    throw new Error(`${msg}${json.errorId ? ' [' + json.errorId + ']' : ''}`);
  }
  return json;
}

function normKey(k){
  return String(k || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // ゼロ幅系を除去
    .replace(/\s+/g, '')                   // 空白除去
    .toLowerCase();
}
function pickUser(obj){
  const map = {};
  for (const [k,v] of Object.entries(obj)) map[normKey(k)] = v;
  // 優先候補
  for (const key of ['user','ユーザー','email','メールアドレス']) {
    if (map.hasOwnProperty(normKey(key))) return map[normKey(key)];
  }
  // 部分一致（念のため）
  for (const [k,v] of Object.entries(map)) {
    if (k.includes('user') || k.includes('email')) return v;
  }
  return '';
}
function pickAction(obj){
  const map = {};
  for (const [k,v] of Object.entries(obj)) map[normKey(k)] = v;
  for (const key of ['action','アクション']) {
    if (map.hasOwnProperty(normKey(key))) return map[normKey(key)];
  }
  for (const [k,v] of Object.entries(map)) if (k.includes('action')) return v;
  return '';
}
function pickDetails(obj){
  const map = {};
  for (const [k,v] of Object.entries(obj)) map[normKey(k)] = v;
  for (const key of ['details','詳細']) {
    if (map.hasOwnProperty(normKey(key))) return map[normKey(key)];
  }
  for (const [k,v] of Object.entries(map)) if (k.includes('detail')) return v;
  return '';
}

function getLogLevel(log){
  const a = String(log.Action || '').toLowerCase();
  const d = String(log.Details || '').toLowerCase();

  // 明確なエラー語やHTTPエラーコード
  if (/(error|failed|exception|timeout|unauthorized|forbidden|denied)/.test(a+d)) return 'error';
  if (/\b5\d{2}\b|\b4\d{2}\b/.test(d)) return 'error';

  // データ破壊・クリア系は注意喚起
  if (/(delete|clear|remove|reset|unanswer)/.test(a)) return 'warn';

  // 成功系（送出・回答更新・編集・追加 など）
  if (/(display|send|answer|set_answered|batch_set_answered|edit|add|toggle|update)/.test(a)) return 'success';

  // 取得系・ログ書き込みなどは情報レベル
  if (/(fetch|read|log|whoami)/.test(a)) return 'info';

  // デフォルト
  return 'info';
}
