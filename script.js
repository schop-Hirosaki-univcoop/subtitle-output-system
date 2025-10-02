// script.js
// Step 2で発行されたGASのWebアプリURLに、秘密のキーを付けて記述します
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec' + '?key=nanndemosoudann_23schop';

// データを取得する関数
async function fetchData() {
    try {
        const response = await fetch(GAS_WEB_APP_URL);
        const data = await response.json();
        
        // 取得したデータを画面に表示
        const container = document.getElementById('data-container');
        container.textContent = JSON.stringify(data, null, 2);

    } catch (error) {
        console.error('データの取得に失敗しました:', error);
    }
}

fetchData();