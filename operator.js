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
const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');
const actionPanel = document.getElementById('action-panel');
const userInfo = document.getElementById('user-info');
const questionsTableBody = document.querySelector('#questions-table tbody');
const dictionaryTableBody = document.querySelector('#dictionary-table tbody');
const logsTableBody = document.querySelector('#logs-table tbody');
const addTermForm = document.getElementById('add-term-form');
const newTermInput = document.getElementById('new-term');
const newRubyInput = document.getElementById('new-ruby');
const actionButtons = ['btn-display', 'btn-answered', 'btn-edit'].map(id => document.getElementById(id));
const selectedInfo = document.getElementById('selected-info');

// --- 状態管理変数 ---
let selectedRowData = null;
let lastDisplayedUid = null;
let allQuestions = []; // 全ての質問を保持する配列
let currentTab = 'normal'; // 現在表示中のタブ ('normal' or 'puq')

// --- イベントリスナーの設定 ---
document.getElementById('login-button').addEventListener('click', login);
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
});
document.getElementById('manual-update-button').addEventListener('click', () => {
    fetchQuestions();
    fetchLogs();
});
document.getElementById('btn-display').addEventListener('click', handleDisplay);
document.getElementById('btn-answered').addEventListener('click', handleAnswered);
document.getElementById('btn-edit').addEventListener('click', handleEdit);
document.getElementById('btn-clear').addEventListener('click', clearTelop);
document.getElementById('fetch-dictionary-button').addEventListener('click', fetchDictionary);
addTermForm.addEventListener('submit', addTerm);

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
                    loginContainer.style.display = 'none';
                    mainContainer.style.display = 'flex';
                    actionPanel.style.display = 'flex';
                    userInfo.innerHTML = `${user.displayName} (${user.email}) <button onclick="logout()">ログアウト</button>`;
                    document.getElementById('logout-button').addEventListener('click', logout);
                    fetchQuestions();
                    fetchDictionary();
                    fetchLogs();

                    // リアルタイム更新の監視を開始
                    onValue(updateTriggerRef, (snapshot) => {
                        if (snapshot.exists()) { fetchQuestions(); fetchLogs(); }
                    });
                } else {
                    // --- 権限NG処理 ---
                    alert("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
                    logout();
                }
            } else {
                // --- 権限確認失敗処理 ---
                alert("ユーザー権限の確認に失敗しました。");
                logout();
            }
        } catch (error) {
            // --- エラー処理 ---
            console.error("Authorization check failed:", error);
            alert("ユーザー権限の確認中にエラーが発生しました。");
            logout();
        }
    } else {
        // --- ログアウト時の処理 ---
        loginContainer.style.display = 'block';
        mainContainer.style.display = 'none';
        actionPanel.style.display = 'none';
        userInfo.innerHTML = '';
        // データベースの変更監視を停止
        off(updateTriggerRef);
    }
});

function switchTab(tabName) {
    if (!tabName) return;
    currentTab = tabName;
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    // 全てのコンテンツを一旦非表示
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');

    // 質問タブとログタブで表示を切り替える
    if (tabName === 'normal' || tabName === 'puq') {
        document.getElementById('questions-content').style.display = 'block';
        renderQuestions();
    } else if (tabName === 'logs') {
        document.getElementById('logs-content').style.display = 'block';
        renderLogs();
    }
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
    // 表示する質問をフィルタリング
    const questionsToRender = allQuestions.filter(item => {
        const isPuq = item['ラジオネーム'] === 'Pick Up Question';
        return currentTab === 'puq' ? isPuq : !isPuq;
    });
    // Firebaseから現在のテロップ情報を一度だけ取得
    const snapshot = await get(telopRef);
    const currentTelop = snapshot.val();

    const currentSelectedUid = selectedRowData ? selectedRowData.uid : null;
    questionsTableBody.innerHTML = '';
    
    questionsToRender.forEach(item => {
       const tr = document.createElement('tr');
       tr.addEventListener('click', () => {
           document.querySelectorAll('#questions-table tbody tr').forEach(row => row.classList.remove('selected-row'));
           tr.classList.add('selected-row');
           selectedRowData = { uid: item['UID'], name: item['ラジオネーム'], question: item['質問・お悩み'] };
           actionButtons.forEach(btn => btn.disabled = false);
           selectedInfo.textContent = `選択中: ${escapeHtml(item['ラジオネーム'])}`;
       });
       if (item['回答済'] === true) { tr.classList.add('answered'); }
       if (currentTelop && currentTelop.name === item['ラジオネーム'] && currentTelop.question === item['質問・お悩み']) {
           tr.classList.add('now-displaying');
           if (lastDisplayedUid === item['UID']) {
               tr.classList.add('flash');
               tr.addEventListener('animationend', () => tr.classList.remove('flash'), { once: true });
               lastDisplayedUid = null;
           }
       }
       const statusText = item['選択中'] === true ? '表示中' : (item['回答済'] === true ? '回答済' : '未回答');
       tr.innerHTML = `<td>${escapeHtml(item['ラジオネーム'])}</td><td>${escapeHtml(item['質問・お悩み'])}</td><td>${statusText}</td>`;
       questionsTableBody.appendChild(tr);
    });
    
    // 行選択をリセットする処理
    if (!questionsToRender.some(item => item.UID === currentSelectedUid)) {
       selectedRowData = null;
       actionButtons.forEach(btn => btn.disabled = true);
       selectedInfo.textContent = '行を選択してください';
    }
}
function renderLogs() {
    logsTableBody.innerHTML = '';
    allLogs.slice().reverse().forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(log.Timestamp).toLocaleString()}</td>
            <td>${escapeHtml(log.User)}</td>
            <td>${escapeHtml(log.Action)}</td>
            <td>${escapeHtml(log.Details)}</td>
        `;
        logsTableBody.appendChild(tr);
    });
}

// --- 操作関数 ---
async function handleDisplay() {
    if (!selectedRowData) return;
    try {
        await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateSelectingStatus', uid: selectedRowData.uid }) });
        await set(telopRef, { name: selectedRowData.name, question: selectedRowData.question });
        logAction('DISPLAY', `RN: ${selectedRowData.name}`);
        lastDisplayedUid = selectedRowData.uid;
        fetchQuestions();
    } catch (error) { alert('エラー: ' + error.message); }
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
        } else { alert('更新失敗: ' + result.error); }
    } catch (error) { alert('通信エラー: ' + error.message); }
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
            alert('質問を更新しました。');
            fetchQuestions();
        } else { alert('更新失敗: ' + result.error); }
    } catch (error) { alert('通信エラー: ' + error.message); }
}
async function clearTelop() {
    try {
        // UID: -1 を送ることで、GAS側で全てのフラグをクリアさせる
        await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'updateSelectingStatus', uid: -1 })
        });
        // localStorage.removeItem の代わりにFirebaseから削除する
        await remove(telopRef);
        logAction('CLEAR');
        fetchQuestions();
    } catch(error) {
        alert('ステータスのクリア中にエラーが発生しました: ' + error.message);
    }
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
            alert('追加失敗: ' + result.error);
        }
    } catch (error) {
        alert('通信エラー: ' + error.message);
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
            alert('削除失敗: ' + result.error);
        }
    } catch (error) {
        alert('通信エラー: ' + error.message);
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
            alert('状態の更新失敗: ' + result.error);
        }
    } catch (error) {
        alert('通信エラー: ' + error.message);
    }
}

// --- 認証関数 ---
async function login() {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed:", error);
        alert("ログインに失敗しました。");
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
