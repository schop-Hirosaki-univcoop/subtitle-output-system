import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { TOKEN_PARAM_KEYS } from "./constants.js";

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

export async function fetchContextFromToken(database, token) {
  const tokenRef = ref(database, `questionIntake/tokens/${token}`);
  const snapshot = await get(tokenRef);
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
    participantId: String(data.participantId || ""),
    participantName: String(data.displayName || ""),
    groupNumber: String(data.teamNumber || data.groupNumber || ""),
    guidance: String(data.guidance || "")
  };
}
