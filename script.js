
// ====================================================================
// JavaScript Logic for Frontend Control (Modified for Hybrid API)
// ====================================================================

document.addEventListener('DOMContentLoaded', () => {
    // --- API Configuration ---
    const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec'; // 例: 'https://script.google.com/macros/s/ABCDEF/exec'
    const MY_SECRET_KEY = 'nanndemosoudann_23schop'; 
    const API_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}`;

    // スプレッドシートの列インデックス定数 (0から始まる)
    const COL = {
        TIMESTAMP: 0,
        RNAME: 1,
        QUESTION: 2,
        TEAM: 3,
        SELECTED: 4, // 選択中 ('✔')
        COMPLETED: 5, // 回答済 ('✔')
        UID: 6
    };
    
    // 旧スクリプトのグローバル変数の一部を再定義
    let rawDataCache = [];
    let previousNames = "";
    let filterOnlyOpen = false;
    let filterText = "";
    let busy = false;
    let currentSelectedIndex = null;
    let currentSelectedUid = null;
    let overlayShown = false, overlayTimer = null;
    
    // --- Utility Functions (Simplified/Adapted from old script) ---
    
    const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    function setBusy(on){
        busy = !!on;
        // UI要素を無効化するロジック
        ['approve-button','reject-button','reset-all-button','force-standby-button','jump-onair-button'].forEach(id=>{
            const el = document.getElementById(id); if (el) el.disabled = !!on;
        });
        // updateApproveButtonState(); // この機能は未実装
    }

    function showOverlay(msg){
        const ov = document.getElementById('overlay');
        const msgE = document.getElementById('overlay-msg');
        if (!ov || !msgE) return;

        msgE.textContent = msg || '送出更新中…';
        ov.classList.remove('hidden');
        ov.classList.add('flex');
        overlayShown = true;
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = setTimeout(()=>{ if (overlayShown){ hideOverlay(); setBusy(false); } }, 12000);
    }

    function hideOverlay(){
        const ov = document.getElementById('overlay');
        if (!ov) return;
        ov.classList.remove('flex');
        ov.classList.add('hidden');
        overlayShown = false;
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = null;
    }

    // --- Core Data Fetching Logic (Replaced google.script.run.fetchNames) ---
    
    // PGM/PVWプレビューの更新 (今回はUIのダミー表示のみ)
    function updatePreviewMirror() {
        // PGMプレビューのミラー更新ロジックをここに実装（現在はダミー）
        const pgmMirror = document.getElementById('preview-mirror');
        if (pgmMirror) pgmMirror.textContent = 'PGM Preview (Logic to be implemented)';
    }

    // 質問リストの描画
    function displayNames(names) {
        // 名前リストの描画ロジックは旧スクリプトから大幅に変更し、簡略化しています
        const list = document.getElementById("nameList");
        const currentSig = JSON.stringify(names.map(item=>[item[COL.QUESTION],item[COL.RNAME]]));
        
        if (currentSig === previousNames) return;
        previousNames = currentSig;
        list.innerHTML = "";

        const template = document.getElementById('tpl-question-item');
        let total = 0, onair = 0, completed = 0;

        names.forEach((item, index) => {
            total++;
            const isSelected = item[COL.SELECTED] === '✔';
            const isCompleted = item[COL.COMPLETED] === '✔';
            
            if (isSelected) onair++;
            if (isCompleted) completed++;

            // リストアイテムの作成
            const li = template.content.cloneNode(true).firstElementChild;
            li.dataset.uid = item[COL.UID];
            
            li.querySelector('.rname-chip').textContent = escapeHtml(item[COL.RNAME] || '（匿名）');
            li.querySelector('.text-container').textContent = escapeHtml(item[COL.QUESTION]);
            li.querySelector('.team-box').textContent = `班: ${item[COL.TEAM] || 'N/A'}`;
            
            const statusBox = li.querySelector('.status-box');
            if (isCompleted) {
                li.classList.add("completed");
                statusBox.textContent = '済';
                statusBox.classList.replace('bg-gray-500', 'bg-green-600');
            } else if (isSelected) {
                li.classList.add("approved");
                statusBox.textContent = 'PVW';
                statusBox.classList.replace('bg-gray-500', 'bg-blue-600');
            } else {
                statusBox.textContent = 'N';
            }
            
            // クリックイベントの追加
            li.addEventListener("click", () => selectItem(li));

            list.appendChild(li);
        });

        // カウンタの更新
        document.getElementById('count-total').textContent = total;
        document.getElementById('count-onair').textContent = onair;
        document.getElementById('count-completed').textContent = completed;
    }
    
    // 選択ロジック (簡易版)
    function selectItem(el) {
        document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
        el.classList.add('focused');

        // PVWプレビューのダミー更新
        const rname = el.querySelector('.rname-chip').textContent;
        const question = el.querySelector('.text-container').textContent;
        document.getElementById('pvw-mirror').innerHTML = `
            <div class="p-4 text-white text-left">
                <p class="font-bold text-xl">${rname}</p>
                <p class="mt-2 text-sm">${question}</p>
            </div>
        `;
    }

    // メインデータ読み込み (google.script.run.fetchNames の代替)
    async function loadNames() {
        showOverlay('リストデータを読み込み中...');
        setBusy(true); 
        try {
            const response = await fetch(API_ENDPOINT);
            if (!response.ok) {
                  // Unauthorized Access (403)やその他のエラーをキャッチ
                throw new Error(`APIアクセス失敗: ステータス ${response.status}`);
            }
            const rawData = await response.json();
            
            // JSONはスプレッドシートの2次元配列のはず
            if (!Array.isArray(rawData) || rawData.length === 0) {
                throw new Error("GASから有効なデータが返されませんでした。");
            }
            
            // ヘッダー行をスキップしてデータを表示
            rawDataCache = rawData.slice(1);
            displayNames(rawDataCache); 
            
        } catch (error) {
            console.error("loadNames failed:", error);
            document.getElementById("nameList").innerHTML = 
                `<li class="text-red-400">データ取得エラー: ${error.message}</li>`;
        } finally {
            hideOverlay();
            setBusy(false);
            // 他の要素の初期化 (updatePreviewMirrorなど、本来はここに続く)
            updatePreviewMirror();
        }
    }

    // --- Initialization ---
    
    // TAKE/REJECT/RESETボタンはまだ機能しないため、ダミーのクリックイベントを設定
    document.getElementById("approve-button").addEventListener('click', () => {
        showOverlay("TAKE操作は現在無効です。GAS側のAPI実装が必要です。");
        setTimeout(hideOverlay, 1500);
    });
    // 他のボタンも同様にイベントをバインドできます

    loadNames(); // データを読み込む
    // 5秒ごとに自動更新（GASのcheckUpdateFlagの代替）
    setInterval(loadNames, 5000); 
    // その他の旧スクリプトのinit関数は、対応するUI要素がないため省略
});