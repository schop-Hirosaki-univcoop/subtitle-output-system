// constants.js: 質問管理領域で使う定数・マッピング値を整理したモジュールです。
export const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
export const FORM_PAGE_PATH = "question-form.html";
export const STEP_LABELS = [
  "認証",
  "在籍チェック",
  "管理者付与",
  "初期データ取得",
  "仕上げ",
  "準備完了"
];
export const PARTICIPANT_TEMPLATE_HEADERS = [
  "名前",
  "フリガナ",
  "性別",
  "学部学科",
  "携帯電話",
  "メールアドレス"
];
export const TEAM_TEMPLATE_HEADERS = [
  "学部学科",
  "性別",
  "名前",
  "班番号",
  "uid"
];
export const CANCEL_LABEL = "キャンセル";
export const RELOCATE_LABEL = "別日";
export const GL_STAFF_GROUP_KEY = "__gl_staff__";
export const GL_STAFF_LABEL = "運営待機";
export const NO_TEAM_GROUP_KEY = "__no_team__";
export const firebaseConfig = {
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "378400426909",
  appId: "1:378400426909:web:f1549aad61e3f7aacebd74"
};
