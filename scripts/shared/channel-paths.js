// channel-paths.js: Realtime Database上のパス組成・正規化ユーティリティを提供します。
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
 * eventIdが空の場合はエラーを投げます（レガシーパスへのフォールバックを削除）。
 * @param {unknown} eventId イベントID（必須）
 * @param {unknown} scheduleId スケジュールID
 * @returns {string}
 * @throws {Error} eventIdが空の場合
 */
function buildEventScheduleBase(eventId, scheduleId) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    throw new Error("eventId is required for render path");
  }
  const scheduleKey = normalizeScheduleId(scheduleId);
  return `render/events/${eventKey}/${scheduleKey}`;
}

/**
 * レンダリング状態を書き込むRealtime Databaseのパスを返します。
 * eventIdとscheduleIdが必須です。
 * @param {unknown} eventId イベントID（必須）
 * @param {unknown} scheduleId スケジュールID
 * @returns {string}
 * @throws {Error} eventIdが空の場合
 */
export function getRenderStatePath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  return `${base}/state`;
}

/**
 * 現在表示中の字幕データを配置するパスを返します。
 * eventIdとscheduleIdが必須です。
 * @param {unknown} eventId イベントID（必須）
 * @param {unknown} scheduleId スケジュールID
 * @returns {string}
 * @throws {Error} eventIdが空の場合
 */
export function getNowShowingPath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  return `${base}/nowShowing`;
}

/**
 * サイドテロップのプリセットを配置するパスを返します。
 * eventIdとscheduleIdが必須です。
 * @param {unknown} eventId イベントID（必須）
 * @param {unknown} scheduleId スケジュールID
 * @returns {string}
 * @throws {Error} eventIdが空の場合
 */
export function getSideTelopPath(eventId, scheduleId) {
  const base = buildEventScheduleBase(eventId, scheduleId);
  return `${base}/sideTelops`;
}

/**
 * 指定されたイベント/スケジュールのチャンネル情報をまとめて返します。
 * eventIdが必須です。
 * @param {unknown} eventId イベントID（必須）
 * @param {unknown} scheduleId スケジュールID
 * @returns {{
 *   isLegacy: boolean,
 *   eventId: string,
 *   scheduleId: string,
 *   basePath: string,
 *   renderStatePath: string,
 *   nowShowingPath: string
 * }}
 * @throws {Error} eventIdが空の場合
 */
export function describeChannel(eventId, scheduleId) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    throw new Error("eventId is required for channel description");
  }
  const scheduleKey = normalizeScheduleId(scheduleId);
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
 * レガシーパスは削除されたため、常にfalseを返します。
 * @param {unknown} eventId
 * @param {unknown} scheduleId
 * @returns {boolean}
 * @deprecated レガシーパスは削除されたため、常にfalseを返します。この関数は後方互換性のため残していますが、使用しないでください。
 */
export function isLegacyChannel(eventId, scheduleId) {
  return false;
}

/**
 * 質問ステータスを配置するパスを返します。
 * 通常質問: questionStatus/${eventId}/${scheduleId}
 * Pick Up Question: questionStatus/${eventId}/${scheduleId}
 * @param {unknown} eventId イベントID（必須）
 * @param {boolean} isPickup Pick Up Questionかどうか（現在は使用されていませんが、後方互換性のため残しています）
 * @param {unknown} scheduleId スケジュールID（必須）
 * @returns {string}
 * @throws {Error} eventIdが空の場合
 */
export function getQuestionStatusPath(eventId, isPickup = false, scheduleId = "") {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    throw new Error("eventId is required for questionStatus path");
  }
  // 通常質問もPick Up Questionも、スケジュールの中に作成する
  const scheduleKey = normalizeScheduleId(scheduleId);
  return `questionStatus/${eventKey}/${scheduleKey}`;
}
