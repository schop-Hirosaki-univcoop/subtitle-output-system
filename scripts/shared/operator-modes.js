// operator-modes.js: オペレーターモードの定数と判定ヘルパーを集約した共通モジュールです。
export const OPERATOR_MODE_TELOP = "telop";
export const OPERATOR_MODE_SUPPORT = "support";

/**
 * 任意の入力値を既知のオペレーターモードに正規化します。
 * @param {string} value
 * @returns {"telop"|"support"}
 */
export function normalizeOperatorMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === OPERATOR_MODE_SUPPORT) {
    return OPERATOR_MODE_SUPPORT;
  }
  return OPERATOR_MODE_TELOP;
}

/**
 * 指定モードがテロップ操作モードかを判定します。
 * @param {string} mode
 * @returns {boolean}
 */
export function isTelopMode(mode) {
  return normalizeOperatorMode(mode) === OPERATOR_MODE_TELOP;
}
