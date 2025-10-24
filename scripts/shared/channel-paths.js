const LEGACY_RENDER_BASE = "render/state";
const LEGACY_NOW_SHOWING_PATH = `${LEGACY_RENDER_BASE}/nowShowing`;
const DEFAULT_SCHEDULE_KEY = "__default_schedule__";

function normalizeKey(value) {
  return String(value ?? "").trim();
}

export function normalizeEventId(eventId) {
  return normalizeKey(eventId);
}

export function normalizeScheduleId(scheduleId) {
  const normalized = normalizeKey(scheduleId);
  return normalized || DEFAULT_SCHEDULE_KEY;
}

function buildEventScheduleBase(eventId, scheduleId) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    return LEGACY_RENDER_BASE;
  }
  const scheduleKey = normalizeScheduleId(scheduleId);
  return `render/events/${eventKey}/${scheduleKey}`;
}

export function getRenderStatePath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  if (base === LEGACY_RENDER_BASE) {
    return LEGACY_RENDER_BASE;
  }
  return `${base}/state`;
}

export function getNowShowingPath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  if (base === LEGACY_RENDER_BASE) {
    return LEGACY_NOW_SHOWING_PATH;
  }
  return `${base}/nowShowing`;
}

export function describeChannel(eventId, scheduleId) {
  const eventKey = normalizeEventId(eventId);
  const scheduleKey = normalizeScheduleId(scheduleId);
  if (!eventKey) {
    return {
      isLegacy: true,
      eventId: "",
      scheduleId: "",
      basePath: LEGACY_RENDER_BASE,
      renderStatePath: LEGACY_RENDER_BASE,
      nowShowingPath: LEGACY_NOW_SHOWING_PATH
    };
  }
  const basePath = `render/events/${eventKey}/${scheduleKey}`;
  return {
    isLegacy: false,
    eventId: eventKey,
    scheduleId: scheduleKey,
    basePath,
    renderStatePath: `${basePath}/state`,
    nowShowingPath: `${basePath}/nowShowing`
  };
}

export function parseChannelParams(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) {
    return { eventId: "", scheduleId: "" };
  }
  const eventId = normalizeEventId(
    searchParams.get("evt") ??
      searchParams.get("event") ??
      searchParams.get("eventId") ??
      searchParams.get("event_id")
  );
  const scheduleIdRaw =
    searchParams.get("sch") ??
    searchParams.get("schedule") ??
    searchParams.get("scheduleId") ??
    searchParams.get("schedule_id");
  const scheduleId = normalizeKey(scheduleIdRaw);
  return { eventId, scheduleId };
}

export function isLegacyChannel(eventId, scheduleId) {
  return buildEventScheduleBase(eventId, scheduleId) === LEGACY_RENDER_BASE;
}
