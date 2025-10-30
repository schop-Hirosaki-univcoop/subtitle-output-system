// value-utils.js: 質問フォームで利用する文字列整形と値補完の共通ユーティリティです。

/**
 * 値を文字列化して前後の空白を除去します。
 * null/undefinedは空文字に揃えて扱いを簡素化します。
 * @param {unknown} value
 * @returns {string}
 */
export function ensureTrimmedString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value.trim() : String(value).trim();
}

/**
 * 可変長引数から最初に非空となる文字列を返します。
 * @param {...unknown} values
 * @returns {string}
 */
export function coalesceTrimmed(...values) {
  for (const value of values) {
    const trimmed = ensureTrimmedString(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}
