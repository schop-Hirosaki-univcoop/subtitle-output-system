export const firebaseConfig = {
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "378400426909",
  appId: "1:378400426909:web:f1549aad61e3f7aacebd74"
};

export const GAS_API_URL =
  "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjoba pQ/exec".replace(
    /\s+/g,
    ""
  );

export const STEP_LABELS = [
  "認証",
  "在籍チェック",
  "管理者付与",
  "初期ミラー",
  "購読開始",
  "辞書取得",
  "ログ取得",
  "準備完了"
];

export const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];

export const DICTIONARY_STATE_KEY = "telop-ops-dictionary-open";
export const LOGS_STATE_KEY = "telop-ops-logs-open";
