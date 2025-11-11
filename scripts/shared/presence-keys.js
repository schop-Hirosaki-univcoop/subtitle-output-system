import { normalizeScheduleId } from "./channel-paths.js";

const normalizeString = (value) => String(value ?? "").trim();

/**
 * Derive a stable presence schedule key used for operator/display coordination.
 * @param {string} eventId
 * @param {{ scheduleKey?: string, scheduleId?: string, scheduleLabel?: string }} payload
 * @param {string} entryId
 * @returns {string}
 */
export function derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
  const normalizedEvent = normalizeString(eventId);
  const normalizedEntry = normalizeString(entryId);
  const source = payload && typeof payload === "object" ? payload : {};

  const rawKey = normalizeString(source.scheduleKey);
  if (rawKey) {
    return rawKey;
  }

  const scheduleId = normalizeString(source.scheduleId);
  if (normalizedEvent && scheduleId) {
    return `${normalizedEvent}::${normalizeScheduleId(scheduleId)}`;
  }
  if (scheduleId) {
    return normalizeScheduleId(scheduleId);
  }

  const scheduleLabel = normalizeString(source.scheduleLabel);
  if (scheduleLabel) {
    const sanitized = scheduleLabel.replace(/\s+/g, " ").trim().replace(/::/g, "／");
    if (normalizedEvent) {
      return `${normalizedEvent}::label::${sanitized}`;
    }
    return `label::${sanitized}`;
  }

  if (normalizedEvent && normalizedEntry) {
    return `${normalizedEvent}::session::${normalizedEntry}`;
  }

  return normalizedEntry || normalizedEvent || "";
}
