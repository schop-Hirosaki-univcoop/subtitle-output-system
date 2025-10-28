let graphemeSegmenter = null;
if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
  graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
}

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

export function countGraphemes(value) {
  if (!value) return 0;
  let count = 0;
  for (const _ of iterateGraphemes(value)) {
    count += 1;
  }
  return count;
}

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

export function normalizeKey(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .normalize("NFKC");
}

const CONTROL_CHAR_EXCEPT_LINE_BREAK = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function normalizeMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHAR_EXCEPT_LINE_BREAK, "")
    .replace(/\t+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

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
