// display-link-logger.js: テロップ表示画面のアクセスログを採取するヘルパーです。
// テロップ表示画面からのログであることを識別する共通プレフィックス。
const PREFIX = "[DisplayLink]";

/**
 * 指定されたログレベルで統一フォーマットのログを出力します。
 * @param {"log"|"info"|"warn"|"error"} level
 * @param {unknown} message
 * @param {...unknown} details
 */
function log(level, message, ...details) {
/*  const method = typeof console?.[level] === "function" ? console[level] : console.log;
  const normalizedMessage = typeof message === "string" ? message : String(message ?? "");
  const extras = details.filter((detail) => detail !== undefined);
  method.call(console, PREFIX, normalizedMessage, ...extras);
*/}

/**
 * 通常情報ログを出力します。
 * @param {unknown} message
 * @param {...unknown} details
 */
export function info(message, ...details) {
  log("info", message, ...details);
}

/**
 * 注意ログを出力します。
 * @param {unknown} message
 * @param {...unknown} details
 */
export function warn(message, ...details) {
  log("warn", message, ...details);
}

/**
 * エラーログを出力します。
 * @param {unknown} message
 * @param {...unknown} details
 */
export function error(message, ...details) {
  log("error", message, ...details);
}
