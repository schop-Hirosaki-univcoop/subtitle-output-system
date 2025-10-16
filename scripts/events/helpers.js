import { formatScheduleRange } from "../operator/utils.js";

export const ensureString = (value) => String(value ?? "").trim();

export const formatDateTimeLocal = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

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

export const logError = (context, error) => {
  const detail =
    error && typeof error === "object" && "message" in error && error.message
      ? error.message
      : String(error ?? "不明なエラー");
  console.error(`${context}: ${detail}`);
};

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

export const wait = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
