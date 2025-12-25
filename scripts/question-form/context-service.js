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
 * 正規化されたイベント情報を取得します。
 * @param {import("firebase/database").Database} database
 * @param {string} eventId
 * @returns {Promise<{ name: string } | null>}
 */
async function fetchEventInfo(database, eventId) {
  if (!eventId) return null;
  try {
    const eventRef = ref(database, `questionIntake/events/${eventId}`);
    const snapshot = await get(eventRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.val() || {};
    return { name: String(data.name || "") };
  } catch (error) {
    console.warn("Failed to fetch event info", error);
    return null;
  }
}

/**
 * 正規化されたスケジュール情報を取得します。
 * @param {import("firebase/database").Database} database
 * @param {string} eventId
 * @param {string} scheduleId
 * @returns {Promise<{ label: string, location: string, date: string, startAt: string, endAt: string } | null>}
 */
async function fetchScheduleInfo(database, eventId, scheduleId) {
  if (!eventId || !scheduleId) return null;
  try {
    const scheduleRef = ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`);
    const snapshot = await get(scheduleRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.val() || {};
    return {
      label: String(data.label || ""),
      location: String(data.location || ""),
      date: String(data.date || ""),
      startAt: String(data.startAt || ""),
      endAt: String(data.endAt || "")
    };
  } catch (error) {
    console.warn("Failed to fetch schedule info", error);
    return null;
  }
}

/**
 * 正規化された参加者情報を取得します。
 * @param {import("firebase/database").Database} database
 * @param {string} eventId
 * @param {string} scheduleId
 * @param {string} participantId
 * @returns {Promise<{ name: string } | null>}
 */
async function fetchParticipantInfo(database, eventId, scheduleId, participantId) {
  if (!eventId || !scheduleId || !participantId) return null;
  try {
    const participantRef = ref(database, `questionIntake/participants/${eventId}/${scheduleId}/${participantId}`);
    const snapshot = await get(participantRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.val() || {};
    return { name: String(data.name || "") };
  } catch (error) {
    // 参加者情報の取得に失敗した場合（nameフィールドは読み取り可能になったが、念のためエラーハンドリングを維持）
    console.warn("Failed to fetch participant info", error);
    return null;
  }
}

/**
 * Firebase上のトークン情報を取得し、フォーム文脈データに整形します。
 * 正規化されたデータ構造から情報を取得します。
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
  const tokenData = snapshot.val() || {};
  if (tokenData.revoked) {
    throw new Error("このリンクは無効化されています。運営までお問い合わせください。");
  }
  if (tokenData.expiresAt && Number(tokenData.expiresAt) && Date.now() > Number(tokenData.expiresAt)) {
    throw new Error("このリンクの有効期限が切れています。運営までお問い合わせください。");
  }

  // 正規化されたIDを取得
  const eventId = String(tokenData.eventId || "");
  const scheduleId = String(tokenData.scheduleId || "");
  const participantId = String(tokenData.participantId || "");

  // 正規化された場所から情報を取得
  const [eventInfo, scheduleInfo, participantInfo] = await Promise.all([
    fetchEventInfo(database, eventId),
    fetchScheduleInfo(database, eventId, scheduleId),
    fetchParticipantInfo(database, eventId, scheduleId, participantId)
  ]);

  return {
    eventId,
    eventName: eventInfo?.name || "",
    scheduleId,
    scheduleLabel: scheduleInfo?.label || "",
    scheduleDate: scheduleInfo?.date || "",
    scheduleLocation: scheduleInfo?.location || "",
    scheduleStart: scheduleInfo?.startAt || "",
    scheduleEnd: scheduleInfo?.endAt || "",
    participantId,
    participantName: participantInfo?.name || "",
    groupNumber: String(tokenData.groupNumber || ""),
    guidance: String(tokenData.guidance || "")
  };
}
