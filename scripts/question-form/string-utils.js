// string-utils.js: 文字列操作や正規化の補助関数を提供します。
let graphemeSegmenter = null;
if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
  graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
}

/**
 * Intl.Segmenterが利用可能であれば結合文字単位で文字列を走査するジェネレーター。
 * 絵文字など複数コードポイントで構成される文字を安全に扱うための基盤になります。
 * @param {string} value
 */
function* iterateGraphemes(value) {
  if (!value) {
    return;
  }
  if (graphemeSegmenter) {
    for (const segmentData of graphemeSegmenter.segment(value)) {
      yield segmentData.segment;
    }
    return;
  }
  for (const char of Array.from(value)) {
    yield char;
  }
}

/**
 * grapheme cluster単位での文字数を算出します。
 * @param {string} value
 * @returns {number}
 */
export function countGraphemes(value) {
  if (!value) return 0;
  let count = 0;
  for (const _ of iterateGraphemes(value)) {
    count += 1;
  }
  return count;
}

/**
 * 指定長で文字列を切り詰めます。結合文字の途中で切らないようiterateGraphemesを利用します。
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateGraphemes(value, maxLength) {
  const stringValue = String(value ?? "");
  if (!stringValue) {
    return "";
  }
  if (typeof maxLength !== "number" || maxLength <= 0) {
    return stringValue;
  }
  let count = 0;
  let result = "";
  for (const segment of iterateGraphemes(stringValue)) {
    if (count >= maxLength) {
      break;
    }
    result += segment;
    count += 1;
  }
  return result;
}

/**
 * Firebaseキー等に利用する想定の文字列をNFKC正規化し、制御文字を除去します。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKey(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .normalize("NFKC");
}

const CONTROL_CHAR_EXCEPT_LINE_BREAK = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * 複数行テキストを保存向けに整形します。行末の制御文字削除や連続改行の抑制を行います。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHAR_EXCEPT_LINE_BREAK, "")
    .replace(/\t+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * ラジオボタンのname属性として利用できる文字列に正規化します。
 * 許容文字を限定しつつ必要に応じて文字数制限も適用します。
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function sanitizeRadioName(value, maxLength) {
  const normalized = normalizeKey(value)
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}・\-＿ー\s]/gu, "")
    .trim();
  if (typeof maxLength === "number" && maxLength > 0) {
    return truncateGraphemes(normalized, maxLength);
  }
  return normalized;
}
