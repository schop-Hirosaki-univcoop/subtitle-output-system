// channel-paths.js: Realtime Database上のパス組成・正規化ユーティリティを提供します。
const LEGACY_RENDER_BASE = "render/state";
const LEGACY_NOW_SHOWING_PATH = `${LEGACY_RENDER_BASE}/nowShowing`;
const DEFAULT_SCHEDULE_KEY = "__default_schedule__";

/**
 * Firebaseのキーとして利用する文字列を正規化し、null/undefinedでも空文字を返します。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKey(value) {
  return String(value ?? "").trim();
}

/**
 * イベントIDを表示用・DB用のキーに整形します。
 * @param {unknown} eventId
 * @returns {string}
 */
export function normalizeEventId(eventId) {
  return normalizeKey(eventId);
}

/**
 * スケジュールIDを正規化し、空値の際は既定のキーにフォールバックします。
 * @param {unknown} scheduleId
 * @returns {string}
 */
export function normalizeScheduleId(scheduleId) {
  const normalized = normalizeKey(scheduleId);
  return normalized || DEFAULT_SCHEDULE_KEY;
}

/**
 * イベントとスケジュールIDからレンダリング用のパスを組み立てます。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {string}
 */
function buildEventScheduleBase(eventId, scheduleId) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    return LEGACY_RENDER_BASE;
  }
  const scheduleKey = normalizeScheduleId(scheduleId);
  return `render/events/${eventKey}/${scheduleKey}`;
}

/**
 * レンダリング状態を書き込むRealtime Databaseのパスを返します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {string}
 */
export function getRenderStatePath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  if (base === LEGACY_RENDER_BASE) {
    return LEGACY_RENDER_BASE;
  }
  return `${base}/state`;
}

/**
 * 現在表示中の字幕データを配置するパスを返します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {string}
 */
export function getNowShowingPath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  if (base === LEGACY_RENDER_BASE) {
    return LEGACY_NOW_SHOWING_PATH;
  }
  return `${base}/nowShowing`;
}

/**
 * サイドテロップのプリセットを配置するパスを返します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {string}
 */
export function getSideTelopPath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  if (base === LEGACY_RENDER_BASE) {
    return `${LEGACY_RENDER_BASE}/sideTelops`;
  }
  return `${base}/sideTelops`;
}

/**
 * 指定されたイベント/スケジュールのチャンネル情報をまとめて返します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {{
 *   isLegacy: boolean,
 *   eventId: string,
 *   scheduleId: string,
 *   basePath: string,
 *   renderStatePath: string,
 *   nowShowingPath: string
 * }}
 */
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

/**
 * URLSearchParamsからイベント/スケジュールIDを抽出します。
 * @param {URLSearchParams|any} searchParams
 * @returns {{ eventId: string, scheduleId: string }}
 */
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

/**
 * 対象チャンネルが旧仕様の構造かどうかを判定します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {boolean}
 */
export function isLegacyChannel(eventId, scheduleId) {
  return buildEventScheduleBase(eventId, scheduleId) === LEGACY_RENDER_BASE;
}

/**
 * 質問ステータスを配置するパスを返します。
 * 通常質問もPick Up Questionもイベントごとに分離されます。
 * @param {unknown} eventId イベントID（必須）
 * @param {boolean} isPickup Pick Up Questionかどうか（現在は使用されていませんが、将来の拡張のために残しています）
 * @returns {string}
 */
export function getQuestionStatusPath(eventId, isPickup = false) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    throw new Error("eventId is required for questionStatus path");
  }
  // Pick Up Questionも通常質問も同じ構造でイベントごとに分離
  return `questionStatus/${eventKey}`;
}
