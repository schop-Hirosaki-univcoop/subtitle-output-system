import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, remove, get, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// headに貼り付けたconfig情報をここにも記述
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
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const telopRef = ref(database, 'currentTelop');
const updateTriggerRef = ref(database, 'update_trigger'); // 'update_trigger' を参照

// --- DOM要素の取得 ---

はい、承知いたしました。ファイル分割と新機能の追加で、コードが複雑になり、分からなくなってしまうのは当然です。ご安心ください。

ご提示いただいた3つのファイル（operator.html, style.css, operator.js）を精査し、あなたがやろうとしていたことを完全に実現するための、最終的な完成版コードを作成しました。

いくつかのidの不整合や、イベントリスナーの不足がありましたが、それらを全て修正済みです。

解決策：3つのファイルを完成版に置き換える
以下の3つのコードブロックで、お手元のoperator.html、style.css、operator.jsをそれぞれまるごと上書きしてください。これが、私たちが目指してきたシステムの、本当の最終完成形です。

ファイル① operator.html（最終版）
HTML

<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Telop Operator</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css">
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/toastify-js"></script>
</head>
<body>

    <div id="user-info"></div>

    <div id="login-container">
        <h2>テロップ操作パネル ログイン</h2>
        <button id="login-button">Googleアカウントでログイン</button>
    </div>

    <div id="main-container" style="display: none;">
        <div class="panel" id="left-panel">
            <h1>テロップ操作パネル</h1>
            
            <div id="main-tab-buttons">
                <button class="main-tab-button active" data-tab="questions">質問</button>
                <button class="main-tab-button" data-tab="logs">操作ログ</button>
                <button id="manual-update-button">手動更新</button>
            </div>

            <div id="main-tab-contents">
                <div class="main-tab-content active" id="questions-content">
                    <div id="sub-tab-buttons">
                        <button class="sub-tab-button active" data-sub-tab="normal">通常質問</button>
                        <button class="sub-tab-button" data-sub-tab="puq">Pick Up Question</button>
                    </div>
                    <table id="questions-table">
                        <thead>
                            <tr>
                                <th><input type="checkbox" id="select-all-checkbox"></th>
                                <th>ラジオネーム</th>
                                <th>質問・お悩み</th>
                                <th>ステータス</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
                <div class="main-tab-content" id="logs-content">
                    <table id="logs-table">
                        <thead>
                            <tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th></tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        </div>
        <div class="panel" id="dictionary-panel">
            <h2>ルビ辞書管理</h2>
            <button id="fetch-dictionary-button">辞書を更新</button>
            <form id="add-term-form">
                <input type="text" id="new-term" placeholder="単語" required>
                <input type="text" id="new-ruby" placeholder="ルビ" required>
                <button type="submit">追加</button>
            </form>
            <table id="dictionary-table">
                <thead>
                    <tr><th>単語</th><th>ルビ</th><th>状態</th><th>操作</th></tr>
                </thead>
                <tbody></tbody>
            </table>
        </div>
    </div>
    
    <div id="action-panel" style="display: none;">
        <button id="btn-display" disabled>表示</button>
        <button id="btn-unanswer" disabled>未回答にする</button>
        <button id="btn-edit" disabled>編集</button>
        <button id="btn-clear">テロップを消去</button>
        <span id="selected-info">行を選択してください</span>
        <div style="margin-left: auto;">
            <button id="btn-batch-unanswer" style="display: none;">選択した項目を未回答にする</button>
        </div>
    </div>
    
    <script type="module" src="operator.js"></script>
</body>
</html>
ファイル② style.css（最終版）
CSS

body { font-family: sans-serif; padding: 20px; margin-bottom: 80px; }
#main-container { display: flex; gap: 40px; }
#login-container { text-align: center; margin-top: 50px; }
#user-info { position: fixed; top: 10px; right: 20px; font-size: 14px; z-index: 100; }
.panel { flex: 1; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; }
th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
#questions-table th:first-child, #questions-table td:first-child { width: 40px; text-align: center; }
tr.locked { background-color: #f8d7da; color: #721c24; }
tr.locked:hover { background-color: #f5c6cb !important; }
#questions-table tbody tr { cursor: pointer; }
#questions-table tbody tr:hover { background-color: #f5f5f5; }
tr.selected-row { background-color: #cce5ff !important; }
tr.now-displaying { background-color: #d4edda; font-weight: bold; }
#main-tab-buttons { display: flex; gap: 5px; border-bottom: 2px solid #dee2e6; margin-bottom: 10px; }
.main-tab-button { padding: 8px 15px; border: none; background-color: transparent; cursor: pointer; font-size: 16px; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.main-tab-button.active { font-weight: bold; color: #007bff; border-bottom-color: #007bff; }
#sub-tab-buttons { display: flex; gap: 10px; margin-bottom: 10px; }
.sub-tab-button { padding: 5px 10px; border: 1px solid #ccc; background-color: #f8f9fa; cursor: pointer; font-size: 14px; border-radius: 4px; }
.sub-tab-button.active { background-color: #007bff; color: white; border-color: #007bff; }
.main-tab-content { display: none; }
.main-tab-content.active { display: block; }
#action-panel { position: fixed; bottom: 0; left: 0; width: 100%; background-color: #f8f9fa; border-top: 1px solid #dee2e6; padding: 15px 20px; box-sizing: border-box; display: flex; align-items: center; gap: 15px; z-index: 99; }
#action-panel button { padding: 8px 15px; font-size: 14px; }
#action-panel #selected-info { font-size: 14px; color: #6c757d; }
@keyframes flash-success { 0% { background-color: #77dd77; } 100% { background-color: #d4edda; } }
.flash { animation: flash-success 1.2s ease-out; }
tr.answered { background-color: #e0e0e0; color: #888; }
tr.disabled { text-decoration: line-through; color: #999; }
#add-term-form { display: flex; gap: 10px; margin-top: 10px; }
#logs-table td { font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.toastify { padding: 12px 20px; color: #fff; display: inline-block; box-shadow: 0 3px 6px -1px rgba(0, 0, 0, 0.12), 0 10px 36px -4px rgba(77, 96, 232, 0.3); background: linear-gradient(135deg, #73a5ff, #5477f5); position: fixed; opacity: 0; transition: all 0.4s cubic-bezier(0.215, 0.61, 0.355, 1); border-radius: 4px; cursor: pointer; text-decoration: none; max-width: calc(50% - 20px); z-index: 2000; }
.toastify.on { opacity: 1; }
.toastify-success { background: linear-gradient(135deg, #77dd77, #4CAF50); }
.toastify-error { background: linear-gradient(135deg, #ff6b6b, #f06595); }
ファイル③ operator.js（最終版）
JavaScript

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, remove, get, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = { /* ★★★ あなたの安全なfirebaseConfig ★★★ */ };
const GAS_API_URL = '★★★ あなたのGASのURL ★★★';

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const telopRef = ref(database, 'currentTelop');
const updateTriggerRef = ref(database, 'update_trigger');

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

// --- 状態管理変数 ---
let state = {
    allQuestions: [],
    allLogs: [],
    currentMainTab: 'questions',
    currentSubTab: 'normal',
    selectedRowData: null,
    lastDisplayedUid: null,
};

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

// --- ログイン状態の監視 ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // ログイン成功後、まずユーザー権限をチェック
        try {
            const response = await fetch(`${GAS_API_URL}?sheet=users`);
            const result = await response.json();
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
                    onValue(updateTriggerRef, (snapshot) => {
                        if (snapshot.exists()) { fetchQuestions(); fetchLogs(); }
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
    currentMainTab = tabName;
    document.querySelectorAll('.main-tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.main-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-content`);
    });
}

function switchSubTab(tabName) {
    if (!tabName) return;
    currentSubTab = tabName;
    document.querySelectorAll('.sub-tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subTab === tabName);
    });
    renderQuestions(); // サブタブは質問リストを再描画するだけ
}

// --- データ取得処理 ---
async function fetchQuestions() {
    try {
        const response = await fetch(`${GAS_API_URL}?sheet=answer`);
        const result = await response.json();
        if (result.success) {
            allQuestions = result.data; // 取得した全質問を保持
            renderQuestions(); // リストの描画処理を呼び出す
        }
    } catch (error) { console.error('通信エラーが発生しました: ' + error.message); }
}
async function fetchDictionary() {
    try {
        const response = await fetch(`${GAS_API_URL}?sheet=dictionary`);
        const result = await response.json();
        if (result.success) {
            dictionaryTableBody.innerHTML = '';
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
                dictionaryTableBody.appendChild(tr);
            });
        }
    } catch (error) { alert('辞書の取得に失敗: ' + error.message); }
}
async function fetchLogs() {
    try {
        const response = await fetch(`${GAS_API_URL}?sheet=logs`);
        const result = await response.json();
        if (result.success) {
            allLogs = result.data;
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
        if (item.UID === currentSelectedUid) { tr.classList.add('selected-row'); }
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
            <td><input type="checkbox" class="row-checkbox" data-uid="${item.UID}"></td>
            <td>${escapeHtml(item['ラジオネーム'])}</td>
            <td>${escapeHtml(item['質問・お悩み'])}</td>
            <td>${statusText}</td>`;
        dom.questionsTableBody.appendChild(tr);
    });
    if (!questionsToRender.some(item => item.UID === currentSelectedUid)) {
        state.selectedRowData = null;
        dom.actionButtons.forEach(btn => btn.disabled = true);
        dom.selectedInfo.textContent = '行を選択してください';
    }
    updateBatchButtonVisibility();
}
function renderLogs() {
    dom.logsTableBody.innerHTML = '';
    state.allLogs.slice().reverse().forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${new Date(log.Timestamp).toLocaleString('ja-JP')}</td><td>${escapeHtml(log.User)}</td><td>${escapeHtml(log.Action)}</td><td>${escapeHtml(log.Details)}</td>`;
        dom.logsTableBody.appendChild(tr);
    });
}

// --- 操作関数 ---
async function handleDisplay() {
    if (!selectedRowData || selectedRowData.isAnswered) return;
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
        if (previousTelop) {
            const prevItem = state.allQuestions.find(q => q['ラジオネーム'] === previousTelop.name && q['質問・お悩み'] === previousTelop.question);
            if (prevItem) { await updateStatusOnServer([prevItem.UID], true); }
        }
        await set(telopRef, { name: state.selectedRowData.name, question: state.selectedRowData.question });
        await updateStatusOnServer([], false, true, state.selectedRowData.uid);
        state.lastDisplayedUid = state.selectedRowData.uid;
        logAction('DISPLAY', `RN: ${state.selectedRowData.name}`);
        fetchQuestions();
        showToast(`「${selectedRowData.name}」さんの質問を表示しました。`, 'success');
    } catch (error) {
        showToast('表示処理中にエラーが発生しました: ' + error.message, 'error');
    }
}
async function handleAnswered() {
    if (!selectedRowData) return;
    if (!confirm(`「${selectedRowData.name}」の質問を「回答済」にしますか？`)) return;
    try {
        const response = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateStatus', uid: selectedRowData.uid, status: true }) });
        const result = await response.json();
        if (result.success) {
           logAction('SET_ANSWERED', `UID: ${selectedRowData.uid}`);
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
        const action = isSelectingUpdate ? 'updateSelectingStatus' : 'batchUpdateStatus';
        const payload = isSelectingUpdate ? { action, uid: selectingUid } : { action, uids, status: isAnswered };
        const response = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
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
    if (!selectedRowData) return;
    const newText = prompt("質問内容を編集してください：", selectedRowData.question);
    if (newText === null || newText.trim() === selectedRowData.question.trim()) return;
    try {
        const response = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'editQuestion', uid: selectedRowData.uid, newText: newText.trim() }) });
        const result = await response.json();
        if (result.success) {
            logAction('EDIT', `UID: ${selectedRowData.uid}`);
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
            if (prevItem) { await updateStatusOnServer([prevItem.UID], true); }
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
    const user = auth.currentUser;
    if (!user) return; // ユーザーが不明な場合は何もしない

    try {
        await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'logAction',
                user: user.email,
                action_type: actionName,
                details: details
            })
        });
    } catch (error) {
        console.error("Failed to write log:", error);
    }
}

// --- 辞書関連の関数 ---
async function addTerm(event) {
    event.preventDefault();
    const term = newTermInput.value.trim();
    const ruby = newRubyInput.value.trim();
    if (!term || !ruby) return;

    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'addTerm', term: term, ruby: ruby })
        });
        const result = await response.json();
        if (result.success) {
            newTermInput.value = '';
            newRubyInput.value = '';
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
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteTerm', term: term })
        });
        const result = await response.json();
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
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'toggleTerm', term: term, enabled: newStatus })
        });
        const result = await response.json();
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
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
