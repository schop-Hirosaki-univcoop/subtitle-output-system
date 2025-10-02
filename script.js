// ====================================================================
// JavaScript Logic for Frontend Control (Modified for Hybrid API)
// TAKE/CLEAR機能の実装済み
// ====================================================================

document.addEventListener('DOMContentLoaded', () => {
    // --- API Configuration ---
    // ここは、あなたのGASデプロイURLと秘密のキーに置き換えてください
    const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec'; 
    const MY_SECRET_KEY = 'nanndemosoudann_23schop'; 
    const API_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}`;

    // スプレッドシートの列インデックス定数 (0から始まる)
    const COL = {
        TIMESTAMP: 0, RNAME: 1, QUESTION: 2, TEAM: 3, 
        SELECTED: 4, // 選択中 ('✔')
        COMPLETED: 5, // 回答済 ('✔')
        UID: 6
    };
    
    // 旧スクリプトのグローバル変数の一部
    let rawDataCache = [];
    let previousNames = "";
    let busy = false;
    let currentSelectedUid = null; 
    let overlayShown = false, overlayTimer = null;
    
    // UI要素
    const elements = {
        nameList: document.getElementById("nameList"),
        pvwMirror: document.getElementById('pvw-mirror'),
        approveButton: document.getElementById('approve-button'),
        // 他の要素も必要に応じて追加
    };

    // --- Utility Functions ---
    const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    function setBusy(on){
        busy = !!on;
        ['approve-button','reject-button','reset-all-button','force-standby-button','jump-onair-button'].forEach(id=>{
            const el = document.getElementById(id); if (el) el.disabled = !!on;
        });
        updateApproveButtonState();
    }
    
    function showToast(title, sub, kind='ok'){
        // 簡略化されたトーストロジック
        console.log(`[Toast ${kind}] ${title}: ${sub}`);
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
        msgE.textContent = msg || '送出更新中…';
        ov.classList.remove('hidden');
        ov.classList.add('show');
        overlayShown = true;
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = setTimeout(()=>{ if (overlayShown){ hideOverlay(); setBusy(false); } }, 12000);
    }

    function hideOverlay(){
        const ov = document.getElementById('overlay');
        if (!ov) return;
        ov.classList.remove('show');
        ov.classList.add('hidden');
        overlayShown = false;
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = null;
    }

    // --- 描画ロジック ---
    
    function updatePreviewMirror() {
        const pgmMirror = document.getElementById('preview-mirror');
        if (pgmMirror) pgmMirror.textContent = 'PGM Preview (Logic to be implemented)';
        updateApproveButtonState();
    }

    function displayNames(names) {
        const list = document.getElementById("nameList");
        const currentSig = JSON.stringify(names.map(item=>[item[COL.QUESTION],item[COL.RNAME], item[COL.SELECTED], item[COL.COMPLETED]]));
        
        if (currentSig === previousNames) return;
        previousNames = currentSig;
        list.innerHTML = "";

        const template = document.getElementById('tpl-question-item');
        let total = 0, onair = 0, completed = 0;
        let selectedRowData = null;

        names.forEach((item) => {
            if (!item || item.length < 7) return; 
            
            total++;
            const isSelected = item[COL.SELECTED] === '✔';
            const isCompleted = item[COL.COMPLETED] === '✔';
            
            if (isSelected) {
                onair++;
                selectedRowData = item;
            }
            if (isCompleted) completed++;

            const li = template.content.cloneNode(true).firstElementChild;
            li.dataset.uid = item[COL.UID];
            
            const rname = item[COL.RNAME] || '（匿名）';
            li.querySelector('.rname-chip').textContent = escapeHtml(rname);
            li.querySelector('.rname-chip').classList.toggle('is-rname', rname !== 'Pick Up Question');
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
            
            li.addEventListener("click", () => selectItem(li, item));
            list.appendChild(li);
        });

        document.getElementById('count-total').textContent = total;
        document.getElementById('count-onair').textContent = onair;
        document.getElementById('count-completed').textContent = completed;

        if (selectedRowData) {
            currentSelectedUid = selectedRowData[COL.UID];
            const selectedEl = document.querySelector(`[data-uid="${currentSelectedUid}"]`);
            if (selectedEl) selectedEl.classList.add('focused');
            
            elements.pvwMirror.innerHTML = `
                <div class="p-4 text-white text-left">
                    <p class="font-bold text-xl">${selectedRowData[COL.RNAME] || '（匿名）'}</p>
                    <p class="mt-2 text-sm">${selectedRowData[COL.QUESTION]}</p>
                </div>
            `;
        } else {
            currentSelectedUid = null;
            elements.pvwMirror.textContent = 'PVW Content Here';
        }

        document.body.classList.toggle('has-onair', onair > 0);
        updateApproveButtonState();
    }
    
    function selectItem(el, item) {
        document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
        el.classList.add('focused');

        currentSelectedUid = item[COL.UID];
        
        elements.pvwMirror.innerHTML = `
            <div class="p-4 text-white text-left">
                <p class="font-bold text-xl">${item[COL.RNAME] || '（匿名）'}</p>
                <p class="mt-2 text-sm">${item[COL.QUESTION]}</p>
            </div>
        `;
        updateApproveButtonState();
    }

    // --- PGM/TAKE ロジック (GAS APIと連携) ---
    
    function updateApproveButtonState() {
        const btn = elements.approveButton;
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
            }
        }
    }

    async function sendActionToGas(action, uid) {
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
                throw new Error(result.status || 'GASからの応答エラー');
            }
        } catch (error) {
            console.error("GAS POST Error:", error);
            showToast("操作失敗", error.message, "info");
        } finally {
            // 操作完了後、必ず最新のデータを再取得してUIを更新
            loadNames();
        }
    }
    
    // TAKEボタンのロジック (TAKE_CLEARアクションを実行)
    function setupApproveButtonLogic() {
        let armTimer = null;
        elements.approveButton.addEventListener("click", function() {
            if (elements.approveButton.dataset.armed !== '1') {
                elements.approveButton.dataset.armed = '1';
                showToast('ARM', 'もう一度クリックでTAKE/CLEAR', 'standby');
                clearTimeout(armTimer); 
                armTimer = setTimeout(()=>{ elements.approveButton.dataset.armed='0'; elements.approveButton.title='ダブルクリックでTAKE'; }, 1200);
                return;
            }
            
            elements.approveButton.dataset.armed = '0';
            handleTakeClear();
        });

        elements.approveButton.addEventListener("dblclick", function(e) {
            e.preventDefault(); 
            clearTimeout(armTimer);
            elements.approveButton.dataset.armed = '0';
            handleTakeClear();
        });
        
        document.getElementById("force-standby-button").addEventListener("click", function() {
            const onAirEl = document.querySelector('.name-box.approved');
            if (!onAirEl) { showToast('PGMはありません', '', 'info'); return; }
            const uid = onAirEl.dataset.uid;
            sendActionToGas('TAKE_CLEAR', uid);
        });
    }

    function handleTakeClear() {
        if (busy || elements.approveButton.disabled) return;

        const focusedEl = document.querySelector('.name-box.focused');
        const onAirEl = document.querySelector('.name-box.approved');

        let targetUid = null;
        
        if (focusedEl) {
            targetUid = focusedEl.dataset.uid;
        } else if (onAirEl) {
            targetUid = onAirEl.dataset.uid;
        } else {
            showToast('エラー', '対象項目がありません', 'info');
            return;
        }

        sendActionToGas('TAKE_CLEAR', targetUid);
    }
    
    // メインデータ読み込み (google.script.run.fetchNames の代替)
    async function loadNames() {
        setBusy(true); 
        if(rawDataCache.length === 0) showOverlay('リストデータを読み込み中...');

        try {
            const response = await fetch(API_ENDPOINT);
            if (!response.ok) {
                throw new Error(`APIアクセス失敗: ステータス ${response.status}`);
            }
            const rawData = await response.json();
            
            if (!Array.isArray(rawData) || rawData.length < 2) {
                throw new Error("GASから有効なデータが返されませんでした。");
            }
            
            rawDataCache = rawData.slice(1);
            displayNames(rawDataCache); 
            
        } catch (error) {
            console.error("loadNames failed:", error);
            document.getElementById("nameList").innerHTML = 
                `<li class="text-red-400 p-4">データ取得エラー: ${error.message}</li>`;
        } finally {
            hideOverlay();
            setBusy(false);
            updatePreviewMirror();
        }
    }


    // --- Initialization ---
    setupApproveButtonLogic();
    loadNames(); 
    setInterval(loadNames, 5000); 
});
