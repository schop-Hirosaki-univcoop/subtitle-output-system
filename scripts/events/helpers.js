// helpers.js: イベント管理機能で共有するフォーマットやバリデーションの補助関数集です。
import { formatScheduleRange } from "../operator/utils.js";

/**
 * 文字列化した値をトリムして返します。
 * undefined/nullを空文字に揃えて表示ブレを防ぎます。
 * @param {unknown} value
 * @returns {string}
 */
export const ensureString = (value) => String(value ?? "").trim();

/**
 * Dateオブジェクトから input[type="datetime-local"] 用の文字列表現を作ります。
 * @param {Date} date
 * @returns {string}
 */
export const formatDateTimeLocal = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * イベント/日程情報を組み合わせたアクセシビリティ向け説明を生成します。
 * @param {string} baseDescription
 * @param {{ id: string, name?: string }|null|undefined} event
 * @param {{ id: string, label?: string, startAt?: unknown, endAt?: unknown }|null|undefined} schedule
 * @returns {string}
 */
export function buildContextDescription(baseDescription, event, schedule) {
  const segments = [];
  if (event) {
    segments.push(`イベント: ${event.name || event.id}`);
  }
  if (schedule) {
    segments.push(`日程: ${schedule.label || schedule.id}`);
    const range = formatScheduleRange(schedule.startAt, schedule.endAt);
    if (range) {
      segments.push(`時間: ${range}`);
    }
  }
  if (!segments.length) {
    return baseDescription;
  }
  return `${baseDescription} 選択中 — ${segments.join(" / ")}`;
}

/**
 * エラーメッセージをコンソールに整形して出力します。
 * @param {string} context
 * @param {unknown} error
 */
export const logError = (context, error) => {
  const detail =
    error && typeof error === "object" && "message" in error && error.message
      ? error.message
      : String(error ?? "不明なエラー");
  console.error(`${context}: ${detail}`);
};

/**
 * 参加者数の表示用文字列を生成します。
 * 未設定時にはダッシュを返します。
 * @param {unknown} value
 * @returns {string}
 */
export function formatParticipantCount(value) {
  if (value == null || value === "") {
    return "—";
  }
  const numberValue = Number(value);
  if (!Number.isNaN(numberValue)) {
    return `${numberValue}名`;
  }
  return `${value}`;
}

/**
 * イベント>日程>参加者のネスト構造から重複排除したトークン集合を返します。
 * @param {Record<string, Record<string, { token?: string }>>|null|undefined} branch
 * @returns {Set<string>}
 */
export function collectParticipantTokens(branch) {
  const tokens = new Set();
  if (!branch || typeof branch !== "object") {
    return tokens;
  }

  Object.values(branch).forEach((scheduleBranch) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") return;
    Object.values(scheduleBranch).forEach((participant) => {
      const token = participant?.token;
      if (token) {
        tokens.add(String(token));
      }
    });
  });
  return tokens;
}

const PARTICIPANT_SYNC_TIMEOUT_MS = 6000;
const PARTICIPANT_SYNC_POLL_INTERVAL_MS = 150;

/**
 * 指定ミリ秒だけ遅延するPromiseを返します。
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export const wait = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * question-admin 埋め込みが参加者選択を反映したかポーリングで確認します。
 * タイムアウトまでに一致すれば true を返し、失敗時は false を返します。
 * @param {string} expectedEventId
 * @param {string} expectedScheduleId
 * @returns {Promise<boolean>}
 */
export async function waitForParticipantSelectionAck(expectedEventId, expectedScheduleId) {
  if (
    typeof window === "undefined" ||
    !window.questionAdminEmbed ||
    typeof window.questionAdminEmbed.getState !== "function"
  ) {
    return true;
  }

  const timeoutAt = Date.now() + PARTICIPANT_SYNC_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    try {
      const state = window.questionAdminEmbed.getState();
      if (state && state.eventId === expectedEventId && state.scheduleId === expectedScheduleId) {
        return true;
      }
    } catch (error) {
      break;
    }
    await wait(PARTICIPANT_SYNC_POLL_INTERVAL_MS);
  }
  return false;
}
