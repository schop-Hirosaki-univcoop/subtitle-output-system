// print.js: 印刷プレビュー関連の共通ユーティリティをまとめます。

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPrintCell(value, { placeholder = "&nbsp;" } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    return placeholder;
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function formatMetaDisplay(primary, id) {
  const primaryText = String(primary ?? "").trim();
  const idText = String(id ?? "").trim();
  if (primaryText && idText && primaryText !== idText) {
    return `${primaryText}（ID: ${idText}）`;
  }
  return primaryText || idText;
}

export function formatPrintDateTimeRange(startAt, endAt) {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const startValid = start && !Number.isNaN(start.getTime());
  const endValid = end && !Number.isNaN(end.getTime());
  if (!startValid && !endValid) {
    return "";
  }

  const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  if (startValid && endValid) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const startText = dateFormatter.format(start);
    if (sameDay) {
      return `${startText} 〜 ${timeFormatter.format(end)}`;
    }
    return `${startText} 〜 ${dateFormatter.format(end)}`;
  }

  if (startValid) {
    return `${dateFormatter.format(start)} 〜`;
  }
  return `〜 ${dateFormatter.format(end)}`;
}

export const DEFAULT_CUSTOM_PAGE_SIZE = { width: 210, height: 297 };

export const PRINT_PAPER_SIZE_MAP = {
  Letter: { width: 216, height: 279 },
  Tabloid: { width: 279, height: 432 },
  Legal: { width: 216, height: 356 },
  Statement: { width: 140, height: 216 },
  Executive: { width: 184, height: 267 },
  Folio: { width: 216, height: 330 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  Custom: null
};

export const PRINT_PAPER_SIZES = new Set(Object.keys(PRINT_PAPER_SIZE_MAP));
export const PRINT_ORIENTATIONS = new Set(["portrait", "landscape"]);
export const PRINT_MARGINS = new Set(["5mm", "10mm", "15mm"]);

export function normalizePageDimension(value, fallback = DEFAULT_CUSTOM_PAGE_SIZE.width) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 10), 2000);
}

export function resolvePrintPageSize(
  printSettings,
  {
    paperSizeMap = PRINT_PAPER_SIZE_MAP,
    defaultCustomSize = DEFAULT_CUSTOM_PAGE_SIZE,
    orientation = printSettings?.orientation
  } = {}
) {
  const base = paperSizeMap[printSettings?.paperSize];
  const width = base?.width || printSettings?.customWidth || defaultCustomSize.width;
  const height = base?.height || printSettings?.customHeight || defaultCustomSize.height;
  return orientation === "landscape"
    ? { width: height, height: width }
    : { width, height };
}
