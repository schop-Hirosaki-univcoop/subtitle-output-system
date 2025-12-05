// context-service.js: トークンやイベント情報を取得しフォームへ供給するサービス層です。
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
// URLクエリで許可するトークンキーの一覧を共有定義から利用します。
import { TOKEN_PARAM_KEYS } from "./constants.js";

/**
 * URLクエリからフォームアクセス用トークンを抽出します。
 * @param {string} [search]
 * @param {string[]} [tokenKeys]
 * @returns {string|null}
 */
export function extractToken(search = window.location.search, tokenKeys = TOKEN_PARAM_KEYS) {
  const params = new URLSearchParams(search);
  for (const key of tokenKeys) {
    const value = params.get(key);
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z0-9_-]{12,128}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Firebase上のトークン情報を取得し、フォーム文脈データに整形します。
 * @param {import("firebase/database").Database} database
 * @param {string} token
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchContextFromToken(database, token) {
  const tokenRef = ref(database, `questionIntake/tokens/${token}`);
  let snapshot;
  try {
    snapshot = await get(tokenRef);
  } catch (error) {
    const code = error?.code || "";
    let message = "アクセスに失敗しました。通信環境を確認して再度お試しください。";
    if (code === "PERMISSION_DENIED") {
      message = "アクセス権が確認できませんでした。リンクの有効期限や権限を運営までご確認ください。";
    } else if (code === "NETWORK_ERROR") {
      message = "通信エラーが発生しました。ネットワーク接続を確認してから再度アクセスしてください。";
    }
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
  if (!snapshot.exists()) {
    throw new Error("リンクが無効です。配布された最新のURLからアクセスしてください。");
  }
  const data = snapshot.val() || {};
  if (data.revoked) {
    throw new Error("このリンクは無効化されています。運営までお問い合わせください。");
  }
  if (data.expiresAt && Number(data.expiresAt) && Date.now() > Number(data.expiresAt)) {
    throw new Error("このリンクの有効期限が切れています。運営までお問い合わせください。");
  }
  return {
    eventId: String(data.eventId || ""),
    eventName: String(data.eventName || ""),
    scheduleId: String(data.scheduleId || ""),
    scheduleLabel: String(data.scheduleLabel || ""),
    scheduleDate: String(data.scheduleDate || ""),
    scheduleLocation: String(data.scheduleLocation || ""),
    scheduleStart: String(data.scheduleStart || ""),
    scheduleEnd: String(data.scheduleEnd || ""),
    participantId: String(data.participantId || ""),
    participantName: String(data.displayName || ""),
    groupNumber: String(data.groupNumber || ""),
    guidance: String(data.guidance || "")
  };
}
