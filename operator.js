import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, update, remove, get, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
    initializeAuth,
    browserSessionPersistence,
    browserPopupRedirectResolver,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
const displaySessionRef = ref(database, 'render_control/session');
const questionsRef = ref(database, 'questions');
const lampEl = document.getElementById('render-lamp');
const phaseEl = document.getElementById('render-phase');
const sumEl    = document.getElementById('render-summary');
const titleEl  = document.getElementById('render-title');
const qEl      = document.getElementById('render-question');
const updEl    = document.getElementById('render-updated');
const indicatorEl = document.querySelector('.render-indicator'); // ★ “古さ”の視覚表示に使用
let lastUpdatedAt = 0;
let renderTicker = null;

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
    // 表示内容の反映（hidden のときは中身が来ていても“非表示”優先）
    const isHidden = v.phase === 'hidden';
    const now = isHidden ? null : (v.nowShowing || null);
    if (!now){
      titleEl.textContent = '（非表示）';
      qEl.textContent     = '';
    }else{
      const name = (now.name || '').trim();
      // “Pick Up Question” なら「ラジオネーム：」は付けない
      titleEl.textContent = name === 'Pick Up Question' ? name : `ラジオネーム：${name}`;
      qEl.textContent     = (now.question || '').replace(/\s+/g,' ').trim();
    }
    // 更新時刻（前回値と比較してフラッシュ）
    const at = normalizeUpdatedAt(v.updatedAt) || 0;
    const prev = lastUpdatedAt || 0;
    if (at > 0) {
      lastUpdatedAt = at;
      redrawUpdatedAt();
    } else {
      lastUpdatedAt = 0;
      redrawUpdatedAt();
    }
    if (at > prev){
      sumEl.classList.add('is-updated');
      document.querySelector('.render-indicator')?.classList.add('is-updated');
      setTimeout(()=>{
        sumEl.classList.remove('is-updated');
        document.querySelector('.render-indicator')?.classList.remove('is-updated');
      }, 800);
    }
    // ticker を起動（多重起動防止）
    if (!renderTicker){
      // 相対時刻と“古さ”の状態を毎秒更新
      renderTicker = setInterval(()=>{ redrawUpdatedAt(); refreshStaleness(); }, 1000);
     }
    // 値が来たタイミングでも一度だけ評価
    refreshStaleness();
  });

// タブを閉じたら消えるセッション保存 + ポップアップ resolver を設定
const auth = initializeAuth(app, {
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const telopRef = ref(database, 'currentTelop');
const updateTriggerRef = ref(database, 'update_trigger');

// === 追加: 認証フローのゲート用フラグ ===
let _authFlow = 'idle';           // 'idle' | 'prompting' | 'done'
let _pendingAuthUser = null;      // prompting 中に onAuthStateChanged が渡してくる user を一時保持
// ローダー制御
function showLoader(msg){ document.getElementById('loading-overlay')?.removeAttribute('hidden'); updateLoader(msg); document.body.setAttribute('aria-busy','true'); }
function updateLoader(msg){ if (msg) { const t = document.getElementById('loading-text'); if (t) t.textContent = msg; } }
function hideLoader(){ document.getElementById('loading-overlay')?.setAttribute('hidden',''); document.body.removeAttribute('aria-busy'); }

// ===== 追加：段階ステップ（loader-steps が無ければ黙って何もしない） =====
const domSteps = { list: document.getElementById('loader-steps') };
const STEP_LABELS = [
  '認証', '在籍チェック', '管理者付与',
  '初期ミラー', '購読開始', '辞書取得', 'ログ取得', '準備完了'
];
function initLoaderSteps(){
  if (!domSteps.list) return;
  domSteps.list.innerHTML = STEP_LABELS.map((s,i)=>`<li data-step="${i}">${escapeHtml(s)}</li>`).join('');
}
function setStep(i, message){
  if (message) updateLoader(message);
  if (!domSteps.list) return;
  const items = domSteps.list.querySelectorAll('li');
  items.forEach((li, idx) => {
    li.classList.toggle('current', idx === i);
    li.classList.toggle('done', idx < i);
  });
}
function finishSteps(msg){ setStep(STEP_LABELS.length - 1, msg || '準備完了'); }


// 認証後の共通処理（元の onAuthStateChanged 内の “user あり” 分岐をそのまま移植）
async function handleAfterLogin(user) {
  if (!user) {
    // --- ログアウト時 ---
    dom.loginContainer.style.display = 'block';
    dom.mainContainer.style.display = 'none';
    dom.actionPanel.style.display = 'none';
    dom.userInfo.innerHTML = '';
    cleanupSubscriptions();
    hideLoader();
    return;
  }
  try {
    showLoader('権限を確認しています…');
    initLoaderSteps();
    setStep(0, '認証OK。ユーザー情報を確認中…');
    const result = await apiPost({ action: 'fetchSheet', sheet: 'users' });
    setStep(1, '在籍チェック中…');
      if (result.success && result.data) {
        const authorizedUsers = result.data
          .map(item => String(item['メールアドレス'] || '').trim().toLowerCase())
          .filter(Boolean);
        const loginEmail = String(user.email || '').trim().toLowerCase();
        if (authorizedUsers.includes(loginEmail)) {
        // ★ 管理者付与を“毎回”試す（冪等）: ルールで /admins 読めないため読まずに実行
        setStep(2, '管理者権限の確認/付与…');
        try {
          await apiPost({ action: 'ensureAdmin' });
        } catch (e) {
          // users未在籍などはここに来るが致命ではない
          console.warn('ensureAdmin non-fatal:', e);
        }
        dom.loginContainer.style.display = 'none';
        dom.mainContainer.style.display = 'flex';
        dom.actionPanel.style.display = 'flex';
        // 表示名・メールアドレスはテキストノードとして挿入し、XSS を防止
        dom.userInfo.innerHTML = '';
        const userLabel = document.createElement('span');
        userLabel.className = 'user-label';
        const safeDisplayName = String(user.displayName || '').trim();
        const safeEmail = String(user.email || '').trim();
        userLabel.textContent = safeDisplayName && safeEmail
          ? `${safeDisplayName} (${safeEmail})`
          : (safeDisplayName || safeEmail || '');
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logout-button';
        logoutBtn.type = 'button';
        logoutBtn.textContent = 'ログアウト';
        dom.userInfo.append(userLabel, logoutBtn);
        logoutBtn.addEventListener('click', logout);
        // 初回だけシート→RTDB ミラー（空なら）
        setStep(3, '初期ミラー実行中…');
        updateLoader('初期データを準備しています…');
        try {
          const s = await get(questionsRef);
          if (!s.exists()) await apiPost({ action: 'mirrorSheet' });
        } catch(_) {}
        // RTDB 初回データを取得 → UI へ反映 → ストリーム購読開始
        setStep(4, '購読開始…');
        updateLoader('データ同期中…');
        const first = await get(questionsRef);
        const m = first.val() || {};
        state.allQuestions = Object.values(m).map(x => ({
          'UID': x.uid, 'ラジオネーム': x.name, '質問・お悩み': x.question,
          '回答済': !!x.answered, '選択中': !!x.selecting,
        }));
        renderQuestions();
        startQuestionsStream(); // ← 以後リアルタイム
        startDisplaySessionMonitor();
        // 他パネルの初期読み込み
        setStep(5, '辞書取得…');
        await fetchDictionary();
        setStep(6, 'ログ取得…');
        await fetchLogs();
        finishSteps('準備完了');
        hideLoader();
        showToast(`ようこそ、${user.displayName}さん`, 'success');
        // update_trigger の購読（logs のリアルタイム反映）
        let _rtTimer = null;
        onValue(updateTriggerRef, (snapshot) => {
          if (!snapshot.exists()) return;
          clearTimeout(_rtTimer);
          _rtTimer = setTimeout(()=>{ fetchLogs(); }, 150);
        });
      } else {
        showToast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", 'error');
        await logout();
        hideLoader();
      }
    } else {
      showToast("ユーザー権限の確認に失敗しました。", 'error');
      await logout();
      hideLoader();
    }
  } catch (error) {
    console.error("Authorization check failed:", error);
    showToast("ユーザー権限の確認中にエラーが発生しました。", 'error');
    await logout();
    hideLoader();
  }
}

// --- DOM要素の取得 ---
const dom = {
    loginContainer: document.getElementById('login-container'),
    mainContainer: document.getElementById('main-container'),
    actionPanel: document.getElementById('action-panel'),
    userInfo: document.getElementById('user-info'),
    questionsTableBody: null, // テーブルは廃止
    cardsContainer: document.getElementById('questions-cards'),
    dictionaryTableBody: document.querySelector('#dictionary-table tbody'),
    logsTableBody: document.querySelector('#logs-table tbody'),
    addTermForm: document.getElementById('add-term-form'),
    newTermInput: document.getElementById('new-term'),
    newRubyInput: document.getElementById('new-ruby'),
    actionButtons: ['btn-display', 'btn-unanswer', 'btn-edit'].map(id => document.getElementById(id)),
    selectedInfo: document.getElementById('selected-info'),
    selectAllCheckbox: document.getElementById('select-all-checkbox'),
    batchUnanswerBtn: document.getElementById('btn-batch-unanswer'),
    clearButton: document.getElementById('btn-clear')
};

Object.assign(dom, {
  logsStreamView: document.getElementById('logs-stream-view'),
  logStream: document.getElementById('log-stream'),
  logSearch: document.getElementById('log-search'),
  logAutoscroll: document.getElementById('log-autoscroll'),
});

// --- 状態管理変数 ---
let state = null;

function initState(){
  state = {
    allQuestions: [],
    allLogs: [],
    currentMainTab: 'questions',
    currentSubTab: 'normal',
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: true,
    displaySession: null,
    displaySessionActive: false,
  };
}

initState();

updateActionAvailability();
dom.logSearch.addEventListener('input', ()=>renderLogs());
dom.logAutoscroll.addEventListener('change', (e)=>{ state.autoScrollLogs = e.target.checked; });

let lastSessionActive = null;

// --- イベントリスナーの設定 ---
document.getElementById('login-button').addEventListener('click', login);
document.querySelectorAll('.main-tab-button').forEach(button => {
    button.addEventListener('click', () => switchMainTab(button.dataset.tab));
});
document.querySelectorAll('.sub-tab-button').forEach(button => {
    button.addEventListener('click', () => switchSubTab(button.dataset.subTab));
});
document.getElementById('manual-update-button').addEventListener('click', () => {
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
// カード上のチェックは委譲
dom.cardsContainer.addEventListener('change', (e)=>{
  if (e.target && e.target.classList.contains('row-checkbox')) updateBatchButtonVisibility();
});

// --- ログイン状態の監視 ---
onAuthStateChanged(auth, (user) => {
  // ポップアップ中は UI 更新を保留（ポップアップが閉じた後に反映）
  if (_authFlow === 'prompting') {
    _pendingAuthUser = user || null;
    return;
  }
  handleAfterLogin(user);
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
function startQuestionsStream(){
  off(questionsRef);
  onValue(questionsRef, (snap)=>{
    const m = snap.val() || {};
    // RTDB → レンダ用配列（班番号・tsも保持）
    state.allQuestions = Object.values(m).map(x => ({
      'UID': x.uid,
      '班番号': (x.group ?? ''),     // ← 追加
      'ラジオネーム': x.name,
      '質問・お悩み': x.question,
      '回答済': !!x.answered,
      '選択中': !!x.selecting,
      '__ts': Number(x.ts || 0)      // ← ソート用の内部フィールド
    }));
    renderQuestions();
  });
}

function startDisplaySessionMonitor(){
  off(displaySessionRef);
  onValue(displaySessionRef, (snap) => {
    const data = snap.val() || null;
    const now = Date.now();
    const expiresAt = Number(data && data.expiresAt) || 0;
    const status = String(data && data.status || '');
    const active = !!data && status === 'active' && (!expiresAt || expiresAt > now);
    state.displaySession = data;
    state.displaySessionActive = active;
    if (lastSessionActive !== null && lastSessionActive !== active) {
      showToast(active ? '表示端末とのセッションが確立されました。' : '表示端末の接続が確認できません。', active ? 'success' : 'error');
    }
    lastSessionActive = active;
    updateActionAvailability();
    updateBatchButtonVisibility();
  }, (error) => {
    console.error('Failed to monitor display session:', error);
  });
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

// --- データ描画関数（カードUIへ） ---
async function renderQuestions() {
  // 1) サブタブでフィルタ
  let list = state.allQuestions.filter(item => {
    const isPuq = item['ラジオネーム'] === 'Pick Up Question';
    return state.currentSubTab === 'puq' ? isPuq : !isPuq;
  });
  // 2) 並び順：PUQ=「質問→ts→UID」、通常=「ts→名前→UID」
  const isPUQ = state.currentSubTab === 'puq';
  list.sort((a,b)=>{
    if (isPUQ){
      const ta = String(a['質問・お悩み'] ?? '');
      const tb = String(b['質問・お悩み'] ?? '');
      const t = ta.localeCompare(tb, 'ja', {numeric:true, sensitivity:'base'});
      if (t) return t;
      const da = a['__ts']||0, db = b['__ts']||0;
      if (da!==db) return da-db;
      return String(a['UID']).localeCompare(String(b['UID']));
    }else{
      const da = a['__ts']||0, db = b['__ts']||0;
      if (da!==db) return da-db;                    // 古い→新しい
      const na = String(a['ラジオネーム'] ?? ''), nb = String(b['ラジオネーム'] ?? '');
      const n = na.localeCompare(nb, 'ja', {numeric:true, sensitivity:'base'});
      if (n) return n;
      return String(a['UID']).localeCompare(String(b['UID']));
    }
  });

  const snap = await get(telopRef);
  const live = snap.val();
  const selectedUid = state.selectedRowData ? state.selectedRowData.uid : null;

  // --- カード描画 ---
  const host = dom.cardsContainer;
  host.innerHTML = '';
  list.forEach(item=>{
    const isAnswered = item['回答済'] === true;
    const status = item['選択中'] ? 'live' : (isAnswered ? 'answered' : 'pending');
    const statusText = status==='live' ? '表示中' : (status==='answered' ? '回答済' : '未回答');

    const card = document.createElement('article');
    card.className = `q-card ${status==='live'?'is-live':''} ${isAnswered?'is-answered':'is-pending'}`;
    card.dataset.uid = String(item['UID']);

    // 現在表示中のカードにマーキング（反応フラッシュ）
    if (live && live.name === item['ラジオネーム'] && live.question === item['質問・お悩み']) {
      card.classList.add('now-displaying');
      if (state.lastDisplayedUid === item['UID']) {
        card.classList.add('flash');
        card.addEventListener('animationend', ()=>card.classList.remove('flash'), {once:true});
        state.lastDisplayedUid = null;
      }
    }
    if (item['UID'] === selectedUid) card.classList.add('is-selected');

    card.innerHTML = `
      <header class="q-head">
        <div class="q-title">
          <span class="q-name">${escapeHtml(item['ラジオネーム'])}</span>
          ${item['ラジオネーム']==='Pick Up Question' ? '<span class="q-badge q-badge--puq">PUQ</span>' : ''}
        </div>
        <div class="q-meta">
          <span class="q-group">${escapeHtml(item['班番号'] ?? '') || ''}</span>
          <span class="chip chip--${status}">${statusText}</span>
          <label class="q-check">
            <input type="checkbox" class="row-checkbox">
          </label>
        </div>
      </header>
      <div class="q-text">${escapeHtml(item['質問・お悩み'])}</div>
    `;

    const checkbox = card.querySelector('.row-checkbox');
    if (checkbox) {
      checkbox.dataset.uid = String(item['UID']);
    }

    // カード選択
    card.addEventListener('click', (e)=>{
      const t = e.target;
      if (t instanceof Element && t.closest('.q-check')) return; // チェック操作は除外
      host.querySelectorAll('.q-card').forEach(el => el.classList.remove('is-selected'));
      card.classList.add('is-selected');
      state.selectedRowData = {
        uid: item['UID'],
        name: item['ラジオネーム'],
        question: item['質問・お悩み'],
        isAnswered
      };
      updateActionAvailability();
    });

    host.appendChild(card);
  });

  if (!list.some(x => x['UID'] === selectedUid)) {
    state.selectedRowData = null;
    updateActionAvailability();
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


// 追記：相対時刻を毎秒更新する描画関数
function redrawUpdatedAt(){
  if (!lastUpdatedAt){
    updEl.textContent = '—';
    return;
  }
  const t = new Date(lastUpdatedAt).toLocaleTimeString('ja-JP', { hour12:false });
  updEl.textContent = `${t}（${formatRelative(lastUpdatedAt)}）`;
}

// ★ “古さ”の視覚表示：30秒経過でごく僅かにトーンダウン
function refreshStaleness(){
  if (!indicatorEl) return;
  if (!lastUpdatedAt) { indicatorEl.classList.remove('is-stale'); return; }
  const age = Date.now() - lastUpdatedAt;
  if (Number.isFinite(age) && age >= 30_000) indicatorEl.classList.add('is-stale');
  else indicatorEl.classList.remove('is-stale');
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
    if (!state.displaySessionActive) {
        showToast('表示端末が接続されていません。', 'error');
        return;
    }
    if (!state.selectedRowData || state.selectedRowData.isAnswered) return;
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
        // 1) RTDB を先に更新（UIは即反映）
        const updates = {};
        if (previousTelop) {
          const prev = state.allQuestions.find(q => q['ラジオネーム'] === previousTelop.name && q['質問・お悩み'] === previousTelop.question);
          if (prev) {
            updates[`questions/${prev['UID']}/selecting`] = false;
            updates[`questions/${prev['UID']}/answered`] = true;
          }
        }
        updates[`questions/${state.selectedRowData.uid}/selecting`] = true;
        updates[`questions/${state.selectedRowData.uid}/answered`] = false;
        await update(ref(database), updates);
        await set(telopRef, { name: state.selectedRowData.name, question: state.selectedRowData.question });

        // 2) GAS へは“依頼”だけ（待たない）
        fireAndForgetApi({ action:'updateSelectingStatus', uid: state.selectedRowData.uid });
        if (previousTelop){
          const prev = state.allQuestions.find(q => q['ラジオネーム'] === previousTelop.name && q['質問・お悩み'] === previousTelop.question);
          if (prev) fireAndForgetApi({ action:'updateStatus', uid: prev['UID'], status: true });
        }
        state.lastDisplayedUid = state.selectedRowData.uid;
        logAction('DISPLAY', `RN: ${state.selectedRowData.name}`);
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
        } else { showToast('更新に失敗しました: ' + result.error, 'error'); }
    } catch (error) { showToast('通信エラー: ' + error.message, 'error'); }
}
function handleSelectAll(event) {
    dom.cardsContainer.querySelectorAll('.row-checkbox')
      .forEach(cb => { cb.checked = event.target.checked; });
    updateBatchButtonVisibility();
}
function updateBatchButtonVisibility() {
    if (!dom.batchUnanswerBtn) return;
    const active = !!state.displaySessionActive;
    const checkedCount = active ? document.querySelectorAll('.row-checkbox:checked').length : 0;
    dom.batchUnanswerBtn.style.display = active && checkedCount > 0 ? 'inline-block' : 'none';
    dom.batchUnanswerBtn.disabled = !active || checkedCount === 0;
}
async function handleEdit() {
    if (!state.selectedRowData) return;
    const newText = prompt("質問内容を編集してください：", state.selectedRowData.question);
    if (newText === null || newText.trim() === state.selectedRowData.question.trim()) return;
    try {
        // RTDB 先行
        await update(ref(database, `questions/${state.selectedRowData.uid}`), { question: newText.trim() });
        // GAS 同期依頼（非同期）
        fireAndForgetApi({ action:'editQuestion', uid: state.selectedRowData.uid, text: newText.trim() });
        logAction('EDIT', `UID: ${state.selectedRowData.uid}`);
        showToast('質問を更新しました。', 'success');
    } catch (error) { 
        showToast('通信エラー: ' + error.message, 'error');
    }
}
async function clearTelop() {
    if (!state.displaySessionActive) {
        showToast('表示端末が接続されていません。', 'error');
        return;
    }
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
        showToast('テロップを消去しました。', 'success');
    } catch(error) {
        showToast('テロップの消去中にエラーが発生しました: ' + error.message, 'error');
    }
}
function handleUnanswer() {
    if (!state.displaySessionActive) {
        showToast('表示端末が接続されていません。', 'error');
        return;
    }
    if (!state.selectedRowData || !state.selectedRowData.isAnswered) return;
    if (!confirm(`「${state.selectedRowData.name}」の質問を「未回答」に戻しますか？`)) return;
    // RTDB 先行
    update(ref(database, `questions/${state.selectedRowData.uid}`), { answered:false });
    // GAS 同期依頼（非同期）
    fireAndForgetApi({ action:'updateStatus', uid: state.selectedRowData.uid, status:false });
}
function handleBatchUnanswer() {
    if (!state.displaySessionActive) {
        showToast('表示端末が接続されていません。', 'error');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    if (!confirm(`${checkedBoxes.length}件の質問を「未回答」に戻しますか？`)) return;
    const uidsToUpdate = Array.from(checkedBoxes).map(cb => cb.dataset.uid);
    // RTDB 先行（まとめて）
    const updates = {};
    for (const uid of uidsToUpdate){ updates[`questions/${uid}/answered`] = false; }
    update(ref(database), updates);
    // GAS 同期依頼（非同期）
    fireAndForgetApi({ action:'batchUpdateStatus', uids: uidsToUpdate, status:false });
}

function updateActionAvailability() {
    if (!state) initState();

    const active = !!state.displaySessionActive;
    const selection = state.selectedRowData;

  dom.actionButtons.forEach(btn => { if (btn) btn.disabled = true; });
  if (dom.clearButton) dom.clearButton.disabled = !active;

  if (!dom.selectedInfo) {
    updateBatchButtonVisibility();
    return;
  }

  if (!active) {
    dom.selectedInfo.textContent = '表示端末が接続されていません';
    updateBatchButtonVisibility();
    return;
  }

  if (!selection) {
    dom.selectedInfo.textContent = '行を選択してください';
    updateBatchButtonVisibility();
    return;
  }

  dom.actionButtons.forEach(btn => { if (btn) btn.disabled = false; });
  if (dom.actionButtons[0]) dom.actionButtons[0].disabled = !!selection.isAnswered;
  if (dom.actionButtons[1]) dom.actionButtons[1].disabled = !selection.isAnswered;
  const safeName = String(selection.name ?? '');
  dom.selectedInfo.textContent = `選択中: ${safeName}`;
  updateBatchButtonVisibility();
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
  const btn = document.getElementById('login-button');
  const origText = btn ? btn.textContent : '';
  try {
    _authFlow = 'prompting';                 // ← ポップアップ開始
    showLoader('サインイン中…');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = 'サインイン中…';
    }
    await signInWithPopup(auth, provider);   // ← この Promise が解決 = ポップアップが閉じた
  } catch (error) {
    console.error("Login failed:", error);
    showToast("ログインに失敗しました。", 'error');
    hideLoader();
  } finally {
    _authFlow = 'done';
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = origText;
    }
    // prompting 中に来ていた onAuthStateChanged をここで反映
    if (_pendingAuthUser !== null) {
      const u = _pendingAuthUser;
      _pendingAuthUser = null;
      handleAfterLogin(u);
    }
  }
}
async function logout() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout failed:", error);
    }
    // 念のためゲートを初期化
    _authFlow = 'idle';
    _pendingAuthUser = null;
    hideLoader();
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

    const safeMessage = escapeHtml(String(message ?? ''));

    Toastify({
        text: safeMessage,
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

function fireAndForgetApi(payload){
  // 認証付き POST だが UI は待たない
  apiPost(payload).catch(()=>{ /* ログに出すならここ */ });
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

function cleanupSubscriptions(){
  try { off(questionsRef); } catch(_){}
  try { off(updateTriggerRef); } catch(_){}
  try { off(renderRef); } catch(_){}
  try { off(displaySessionRef); } catch(_){}
  if (renderTicker){ clearInterval(renderTicker); renderTicker = null; }
  state.displaySession = null;
  state.displaySessionActive = false;
  lastSessionActive = null;
  updateActionAvailability();
  updateBatchButtonVisibility();
}

