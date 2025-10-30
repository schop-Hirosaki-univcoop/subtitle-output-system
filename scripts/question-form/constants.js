// constants.js: フォームで共通利用する固定値や検証ルールを管理します。
import { FIREBASE_CONFIG } from "../shared/firebase-config.js";

export const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];
export const TOKEN_PARAM_KEYS = ["token", "t", "key"];
export const MAX_RADIO_NAME_LENGTH = 20;
export const MAX_QUESTION_LENGTH = 60;
export const FORM_VERSION = "question-form@2024.11";

export const firebaseConfig = FIREBASE_CONFIG;
