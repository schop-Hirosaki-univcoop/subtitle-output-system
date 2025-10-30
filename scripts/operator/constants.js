// constants.js: オペレーター機能で共通利用する定数群を定義します。
import { FIREBASE_CONFIG } from "../shared/firebase-config.js";

export const firebaseConfig = FIREBASE_CONFIG;

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
  "準備完了"
];

export const GENRE_ALL_VALUE = "all";
export const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];

export const DICTIONARY_STATE_KEY = "telop-ops-dictionary-open";
export const LOGS_STATE_KEY = "telop-ops-logs-open";
export const QUESTIONS_SUBTAB_KEY = "telop-ops-questions-subtab";
