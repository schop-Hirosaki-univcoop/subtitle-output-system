// ====================================================================
// JavaScript Logic for Frontend Control (Modified for Hybrid API)
// TAKE/CLEAR, REJECT, RESET_ALL機能の実装済み
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
    const ellipsis = (s,n)=>{s=String(s||''); return s.length>n? s.slice(0,n-1)+'…': s;};
    const resolveItemFromUid = (uid) => rawDataCache.find(n => n[COL.UID] === uid);
    
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
        // PGMミラーの描画ロジックはdisplay.htmlに依存するため、ここでは簡略化
        const selectedItem = rawDataCache.find(n => n[COL.SELECTED] === '✔');
        const previewMirror = document.getElementById('preview-mirror');

        if (selectedItem) {
            previewMirror.innerHTML = `
                <div class="p-2 text-white text-left font-sans text-sm">
                    <p class="font-bold">${selectedItem[COL.RNAME] || '（匿名）'}</p>
                    <p>${ellipsis(selectedItem[COL.QUESTION], 60)}</p>
                </div>
            `;
        } else {
            previewMirror.textContent = 'PGMなし';
            previewMirror.innerHTML = '';
        }

        updateApproveButtonState();
    }

    function renderPVW(item) {
        // PVWミラーに選択中の項目を反映 (簡略版)
        const pvwMirror = document.getElementById('pvw-mirror');
        if (!pvwMirror) return;

        pvwMirror.innerHTML = `
            <div class="p-2 text-white text-left font-sans text-sm">
                <p class="font-bold">${item[COL.RNAME] || '（匿名）'}</p>
                <p>${ellipsis(item[COL.QUESTION], 60)}</p>
            </div>
        `;
    }
    
    function displayNames(names) {
        const list = document.getElementById("nameList");
        // データシグネチャの比較ロジックは省略し、常にリストを更新するシンプルな実装に
        
        list.innerHTML = "";

        const template = document.getElementById('tpl-selected');
        if (!template) return; // テンプレートがない場合は処理を中断

        let total = 0, onair = 0, completed = 0;
        
        names.forEach((item) => {
            if (!item || item.length < 7) return; 
            
            total++;
            const isSelected = item[COL.SELECTED] === '✔';
            const isCompleted = item[COL.COMPLETED] === '✔';
            
            if (isSelected) onair++;
            if (isCompleted) completed++;

            const li = template.content.cloneNode(true).firstElementChild;
            li.dataset.uid = item[COL.UID];
            li.dataset.rowindex = item[COL.UID]; // 互換性のためUIDを使う

            // データの埋め込み
            li.querySelector('.rname').textContent = escapeHtml(item[COL.RNAME] || '（匿名）');
            li.querySelector('.content').textContent = escapeHtml(item[COL.QUESTION]); 
            li.querySelector('.rname-prefix').hidden = (item[COL.RNAME] === 'Pick Up Question');
            li.querySelector('.faq-tag').hidden = (item[COL.RNAME] !== 'Pick Up Question');

            // ステータスとクラスの適用
            li.classList.toggle("approved", isSelected);
            li.classList.toggle("completed", isCompleted);
            li.classList.toggle("open", !isSelected && !isCompleted); // 未送出項目

            li.addEventListener("click", (e) => {
                if (e.target.closest('.edit-btn')) return; // 編集ボタンクリック時は選択しない
                selectItem(li, item);
            });
            list.appendChild(li);
        });

        // カウンターの更新
        document.getElementById('count-total').textContent = total;
        document.getElementById('count-onair').textContent = onair;
        document.getElementById('count-completed').textContent = completed;

        document.body.classList.toggle('has-onair', onair > 0);
        updatePreviewMirror();
    }
    
    function selectItem(el, item) {
        document.querySelectorAll('.name-box').forEach(i => i.classList.remove('focused'));
        el.classList.add('focused');

        currentSelectedUid = item[COL.UID];
        renderPVW(item); // PVWミラーに反映
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
            // フォーカスがない場合
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
            console.error("GAS POST Error:", error);
            showToast("操作失敗", ellipsis(error.message, 60), "info");
        } finally {
            // 操作完了後、必ず最新のデータを再取得してUIを更新
            loadNames();
        }
    }
    
    // TAKE/CLEAR/REJECT/RESETのロジック
    function setupApproveButtonLogic() {
        let armTimer = null;

        // --- TAKE / CLEAR (ダブルクリックロジック) ---
        elements.approveButton.addEventListener("click", function() {
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

        elements.approveButton.addEventListener("dblclick", function(e) {
            e.preventDefault(); 
            clearTimeout(armTimer);
            this.dataset.armed = '0';
            handleTakeClear();
        });

        function handleTakeClear() {
            if (busy || elements.approveButton.disabled) return;

            const focusedEl = document.querySelector('.name-box.focused');
            const onAirEl = document.querySelector('.name-box.approved');

            let targetUid = null;
            
            if (focusedEl) {
                // PVWにある項目をTAKEまたはCLEAR
                targetUid = focusedEl.dataset.uid;
            } else if (onAirEl) {
                // PGM中の項目を強制CLEAR（フォーカス無しの場合）
                targetUid = onAirEl.dataset.uid;
            } else {
                showToast('エラー', '対象項目がありません', 'info');
                return;
            }

            sendActionToGas('TAKE_CLEAR', targetUid);
        }

        // --- REJECT (再エントリー) ---
        document.getElementById("reject-button").addEventListener("click", function() {
            if (this.disabled || busy) return;
            const focusedEl = document.querySelector('.name-box.focused');
            if (!focusedEl) { showToast('項目が選択されていません', '', 'info'); return; }
            if (!focusedEl.classList.contains('completed')) { showToast('回答済みの項目を選択してください', '', 'info'); return; }

            const uid = focusedEl.dataset.uid;
            sendActionToGas('REJECT', uid);
        });

        // --- RESET_ALL (全再エントリー) ---
        document.getElementById("reset-all-button").addEventListener("click", function() {
            if (this.disabled || busy) return;
            if (!confirm("本当に『オンエア済』をすべて未オンエアに戻しますか？")) return;
            sendActionToGas('RESET_ALL');
        });
        
        // --- PANIC CLEAR (強制CLEAR) ---
        document.getElementById("force-standby-button").addEventListener("click", function() {
            if (this.disabled || busy) return;
            const onAirEl = document.querySelector('.name-box.approved');
            if (!onAirEl) { showToast('PGMはありません', '', 'info'); return; }
            if (!confirm("本当に現在のPGMを即時CLEAR（回答済みに）しますか？")) return;
            
            const uid = onAirEl.dataset.uid;
            sendActionToGas('TAKE_CLEAR', uid);
        });
        
        // --- PGMへジャンプ ---
        document.getElementById("jump-onair-button").addEventListener("click", function() {
            const onAirItem = rawDataCache.find(n => n[COL.SELECTED] === '✔');
            if (!onAirItem) { showToast('PGMはありません', '', 'info'); return; }

            // 検索・フィルタを解除して確実に要素を表示
            // ここでは簡易的に全リストを再描画し、PGM項目を選択
            loadNames(); 
            
            // 要素が再描画されるのを待ってからスクロール
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


    // メインデータ読み込み (google.script.run.fetchNames の代替)
    async function loadNames() {
        setBusy(true); 
        if(rawDataCache.length === 0) showOverlay('リストデータを読み込み中...');

        try {
            const response = await fetch(API_ENDPOINT);
            if (!response.ok) {
                // Unauthorized Access (403)やその他のエラーをキャッチ
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
                `<li class="text-red-400 p-4">データ取得エラー: ${ellipsis(error.message, 80)}</li>`;
        } finally {
            hideOverlay();
            setBusy(false);
            // 他の要素の初期化 (updatePreviewMirrorなど、本来はここに続く)
            updatePreviewMirror();
        }
    }


    // --- Initialization ---
    setupApproveButtonLogic();
    loadNames(); 
    setInterval(loadNames, 5000); 
});
