// print-utils.js: 印刷プレビュー用の共通ユーティリティを提供します。

const PRINT_LOG_PREFIX = "[Print]";
const PRINT_SETTING_STORAGE_KEY = "qa.printSettings.v1";

const GEN_EI_FONT_BASE = new URL("../../assets/fonts/genei-gothic/", import.meta.url).href;
const DEFAULT_CUSTOM_PAGE_SIZE = { width: 210, height: 297 };
const DEFAULT_PRINT_SETTINGS = {
  paperSize: "A4",
  orientation: "portrait",
  margin: "5mm",
  customWidth: DEFAULT_CUSTOM_PAGE_SIZE.width,
  customHeight: DEFAULT_CUSTOM_PAGE_SIZE.height,
  showHeader: true,
  repeatHeader: false,
  showPageNumbers: true,
  showDate: true,
  showTime: true,
  showPhone: true,
  showEmail: true
};

const PRINT_PAPER_SIZE_MAP = {
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

const PRINT_PAPER_SIZES = new Set(Object.keys(PRINT_PAPER_SIZE_MAP));
const PRINT_ORIENTATIONS = new Set(["portrait", "landscape"]);
const PRINT_MARGINS = new Set(["5mm", "10mm", "15mm"]);

function logPrint(level, message, details) {
  if (typeof console === "undefined") return;
  const logger = (console[level] || console.log).bind(console);
  if (details !== undefined) {
    logger(`${PRINT_LOG_PREFIX} ${message}`, details);
  } else {
    logger(`${PRINT_LOG_PREFIX} ${message}`);
  }
}

function logPrintInfo(message, details) {
  logPrint("info", message, details);
}

function logPrintWarn(message, details) {
  logPrint("warn", message, details);
}

function logPrintError(message, details) {
  logPrint("error", message, details);
}

function logPrintDebug(message, details) {
  logPrint("debug", message, details);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrintCell(value, { placeholder = "&nbsp;" } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    return placeholder;
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function formatMetaDisplay(primary, id) {
  const primaryText = String(primary ?? "").trim();
  const idText = String(id ?? "").trim();
  if (primaryText && idText && primaryText !== idText) {
    return `${primaryText}（ID: ${idText}）`;
  }
  return primaryText || idText;
}

function formatPrintDateTimeRange(startAt, endAt) {
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

function normalizePageDimension(value, fallback = DEFAULT_CUSTOM_PAGE_SIZE.width) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 10), 2000);
}

function normalizePrintSettings(settings = {}, fallbackSettings = DEFAULT_PRINT_SETTINGS) {
  logPrintDebug("normalizePrintSettings start", { settings, fallbackSettings });
  const base = { ...DEFAULT_PRINT_SETTINGS, ...(fallbackSettings || {}) };
  const fallbackWidth = base.customWidth || DEFAULT_CUSTOM_PAGE_SIZE.width;
  const fallbackHeight = base.customHeight || DEFAULT_CUSTOM_PAGE_SIZE.height;
  const normalized = {
    paperSize: PRINT_PAPER_SIZES.has(settings?.paperSize) ? settings.paperSize : base.paperSize,
    orientation: PRINT_ORIENTATIONS.has(settings?.orientation) ? settings.orientation : base.orientation,
    margin: PRINT_MARGINS.has(settings?.margin) ? settings.margin : base.margin,
    customWidth: normalizePageDimension(settings?.customWidth, fallbackWidth),
    customHeight: normalizePageDimension(settings?.customHeight, fallbackHeight),
    showHeader: settings?.showHeader !== undefined ? Boolean(settings.showHeader) : base.showHeader,
    repeatHeader: settings?.repeatHeader !== undefined ? Boolean(settings.repeatHeader) : base.repeatHeader,
    showPageNumbers: settings?.showPageNumbers !== undefined ? Boolean(settings.showPageNumbers) : base.showPageNumbers,
    showDate: settings?.showDate !== undefined ? Boolean(settings.showDate) : base.showDate,
    showTime: settings?.showTime !== undefined ? Boolean(settings.showTime) : base.showTime,
    showPhone: settings?.showPhone !== undefined ? Boolean(settings.showPhone) : base.showPhone,
    showEmail: settings?.showEmail !== undefined ? Boolean(settings.showEmail) : base.showEmail
  };

  if (!normalized.showHeader) {
    normalized.repeatHeader = false;
  }

  if (normalized.paperSize !== "Custom") {
    normalized.customWidth = fallbackWidth;
    normalized.customHeight = fallbackHeight;
  }

  logPrintDebug("normalizePrintSettings result", normalized);
  return normalized;
}

function resolvePrintPageSize(printSettings = DEFAULT_PRINT_SETTINGS, fallbackSettings = DEFAULT_PRINT_SETTINGS) {
  const normalized = normalizePrintSettings(printSettings, fallbackSettings);
  const base = PRINT_PAPER_SIZE_MAP[normalized.paperSize];
  const width = base?.width || normalized.customWidth || DEFAULT_CUSTOM_PAGE_SIZE.width;
  const height = base?.height || normalized.customHeight || DEFAULT_CUSTOM_PAGE_SIZE.height;
  const resolved = normalized.orientation === "landscape"
    ? { width: height, height: width }
    : { width, height };
  logPrintDebug("resolvePrintPageSize", { printSettings, fallbackSettings, resolved });
  return resolved;
}

function buildParticipantPrintHtml({
  eventId,
  scheduleId,
  eventName,
  scheduleLabel,
  scheduleLocation,
  scheduleRange,
  groups,
  totalCount,
  generatedAt,
  printOptions
}, { defaultSettings = DEFAULT_PRINT_SETTINGS } = {}) {
  logPrintInfo("buildParticipantPrintHtml called", { eventId, scheduleId, printOptions, defaultSettings });
  const printSettings = normalizePrintSettings(printOptions, defaultSettings);
  const eventDisplayRaw = formatMetaDisplay(eventName, eventId);
  const scheduleDisplayRaw = formatMetaDisplay(scheduleLabel, scheduleId);
  const locationDisplayRaw = String(scheduleLocation || "").trim();
  const rangeDisplayRaw = String(scheduleRange || "").trim();
  const generatedAtDate = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime())
    ? generatedAt
    : new Date();
  const generatedDateFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const generatedTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const generatedDateText = generatedDateFormatter.format(generatedAtDate);
  const generatedTimeText = generatedTimeFormatter.format(generatedAtDate);
  const totalValue = Number.isFinite(totalCount)
    ? totalCount
    : (Array.isArray(groups)
      ? groups.reduce((sum, group) => sum + (group.participants?.length || 0), 0)
      : 0);

  const titleParts = [eventDisplayRaw, scheduleDisplayRaw]
    .map(part => String(part || "").trim())
    .filter(Boolean);
  const headingText = titleParts.length
    ? `${titleParts.join(" / ")} の参加者リスト`
    : "参加者リスト";
  const docTitle = titleParts.length
    ? `${titleParts.join(" / ")} - 参加者リスト`
    : "参加者リスト";

  const metaItems = [];
  if (eventDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">イベント:</span> <span class="print-meta__value">${escapeHtml(eventDisplayRaw)}</span></li>`
    );
  }
  if (scheduleDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">日程:</span> <span class="print-meta__value">${escapeHtml(scheduleDisplayRaw)}</span></li>`
    );
  }
  if (locationDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">会場:</span> <span class="print-meta__value">${escapeHtml(locationDisplayRaw)}</span></li>`
    );
  }
  if (rangeDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">時間:</span> <span class="print-meta__value">${escapeHtml(rangeDisplayRaw)}</span></li>`
    );
  }
  metaItems.push(
    `<li class="print-meta__item"><span class="print-meta__label">参加者数:</span> <span class="print-meta__value">${escapeHtml(`${totalValue}名`)}</span></li>`
  );
  if (printSettings.showDate || printSettings.showTime) {
    const generatedParts = [
      printSettings.showDate ? generatedDateText : "",
      printSettings.showTime ? generatedTimeText : ""
    ].filter(Boolean);
    const generatedLabel = printSettings.showDate && printSettings.showTime
      ? "出力日時"
      : printSettings.showDate
        ? "出力日"
        : "出力時刻";
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">${escapeHtml(generatedLabel)}:</span> <span class="print-meta__value">${escapeHtml(generatedParts.join(" "))}</span></li>`
    );
  }

  const groupsMarkup = (Array.isArray(groups) ? groups : [])
    .map(group => {
      const labelText = group.label || "班番号";
      const rawValue = String(group.value || "").trim();
      const displayValue = rawValue || (labelText === "班番号" ? "未設定" : "");
      const safeLabel = escapeHtml(labelText);
      const safeValue = displayValue ? escapeHtml(displayValue) : "—";
      const accessibleLabel = [labelText, displayValue].filter(Boolean).join(" ").trim();
      const tableAriaLabel = escapeHtml(accessibleLabel ? `${accessibleLabel} の参加者一覧` : "参加者一覧");
      const groupKeyAttr = escapeHtml(String(group.key || ""));
      const glRows = group.glLeaders && group.glLeaders.length
        ? group.glLeaders
            .map(leader => {
              const nameCell = formatPrintCell(leader.name, { placeholder: "—" });
              const metaCell = formatPrintCell(leader.meta, { placeholder: "—" });
              return `<tr><td>${nameCell}</td><td>${metaCell}</td></tr>`;
            })
            .join("\n")
        : '<tr><td colspan="2" class="print-group__gl-empty">—</td></tr>';
      const participantColumns = [
        { key: "index", header: "No.", className: "print-table__index", getValue: (entry, idx) => idx + 1 },
        { key: "name", header: "参加者名", className: "print-table__name", getValue: entry => formatPrintCell(entry?.name) },
        {
          key: "phonetic",
          header: "フリガナ",
          className: "print-table__phonetic",
          getValue: entry => formatPrintCell(entry?.phonetic || entry?.furigana || "")
        },
        {
          key: "department",
          header: "学部学科",
          className: "print-table__department",
          getValue: entry => formatPrintCell(entry?.department || "")
        }
      ];

      if (printSettings.showPhone) {
        participantColumns.push({
          key: "phone",
          header: "電話番号",
          className: "print-table__contact",
          getValue: entry => formatPrintCell(entry?.phone || "")
        });
      }

      if (printSettings.showEmail) {
        participantColumns.push({
          key: "email",
          header: "メールアドレス",
          className: "print-table__contact",
          getValue: entry => formatPrintCell(entry?.email || "")
        });
      }

      const participantHeaderCells = participantColumns
        .map(column => {
          const classAttr = column.className ? ` class="${column.className}"` : "";
          return `<th scope="col"${classAttr}>${column.header}</th>`;
        })
        .join("");

      const participantRows = group.participants && group.participants.length
        ? group.participants
            .map((entry, index) => {
              const cells = participantColumns
                .map(column => {
                  const classAttr = column.className ? ` class="${column.className}"` : "";
                  const value = column.getValue(entry, index);
                  return `<td${classAttr}>${value}</td>`;
                })
                .join("");
              return `<tr>${cells}</tr>`;
            })
            .join("\n")
        : `<tr class="print-table__empty"><td colspan="${participantColumns.length}">参加者がいません</td></tr>`;

      return `<section class="print-group" data-group-key="${groupKeyAttr}">
        <div class="print-group__header">
          <div class="print-group__meta">
            <div class="print-group__label">${safeLabel}</div>
            <div class="print-group__value">${safeValue}</div>
          </div>
          <div class="print-group__gl">
            <table class="print-group__gl-table" aria-label="GL情報">
              <thead>
                <tr><th scope="col">GL名前</th><th scope="col">学部学科</th></tr>
              </thead>
              <tbody>
                ${glRows}
              </tbody>
            </table>
          </div>
        </div>
        <table class="print-table" aria-label="${tableAriaLabel}">
          <thead>
            <tr>
              ${participantHeaderCells}
            </tr>
          </thead>
          <tbody>
            ${participantRows}
          </tbody>
        </table>
      </section>`;
    })
      .join("\n\n");

  const metaMarkup = metaItems.length
    ? `<ul class="print-meta">${metaItems.join("\n")}</ul>`
    : "";
  const sectionsMarkup = groupsMarkup || '<p class="print-empty">参加者リストが登録されていません。</p>';
  const pageMargin = printSettings.margin || "5mm";
  const pageSize = printSettings.paperSize || "A4";
  const pageOrientation = printSettings.orientation || "portrait";
  const { width: pageWidth, height: pageHeight } = resolvePrintPageSize(printSettings, defaultSettings);
  const pageSizeValue = pageSize === "Custom"
    ? `${pageWidth}mm ${pageHeight}mm`
    : `${pageSize} ${pageOrientation}`;
  const headerClass = printSettings.repeatHeader ? "print-header print-header--repeat" : "print-header";
  const footerTimestamp = [
    printSettings.showDate ? generatedDateText : "",
    printSettings.showTime ? generatedTimeText : ""
  ].filter(Boolean).join(" ");
  const footerItems = [];
  if (footerTimestamp) {
    footerItems.push(`<span class="print-footer__item">${escapeHtml(footerTimestamp)}</span>`);
  }
  if (printSettings.showPageNumbers) {
    footerItems.push('<span class="print-footer__item print-footer__page" aria-label="ページ番号"><span class="print-footer__page-number" aria-hidden="true"></span></span>');
  }
  const footerMarkup = footerItems.length
    ? `<footer class="print-footer"><div class="print-footer__items">${footerItems.join("")}</div></footer>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    :root { color-scheme: light; --page-margin: ${pageMargin}; --page-width: ${pageWidth}mm; --page-height: ${pageHeight}mm; --page-content-width: calc(var(--page-width) - (2 * var(--page-margin))); --page-content-height: calc(var(--page-height) - (2 * var(--page-margin))); --preview-scale: 1; }
    @font-face { font-family: "GenEi Gothic"; src: url("${GEN_EI_FONT_BASE}GenEiGothicP-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("${GEN_EI_FONT_BASE}GenEiGothicP-SemiBold.woff2") format("woff2"); font-weight: 600; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("${GEN_EI_FONT_BASE}GenEiGothicP-Heavy.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
    @page { size: ${pageSizeValue}; margin: ${pageMargin}; counter-increment: page; }
    body { counter-reset: page 1; }
    body { margin: 0; font-family: "GenEi Gothic", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif; font-size: 8.8pt; line-height: 1.5; color: #000; background: #f6f7fb; }
    .print-controls { margin-bottom: 6mm; }
    .print-controls__button { border: 0.25mm solid #000; background: #fff; color: #000; padding: 4px 12px; font-size: 8pt; cursor: pointer; }
    .print-controls__button:focus { outline: 1px solid #000; outline-offset: 2px; }
    .print-header { margin-bottom: 8mm; }
    .print-title { font-size: 14.4pt; margin: 0 0 4mm; }
    .print-meta { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2mm 12mm; font-size: 8pt; }
    .print-meta__label { font-weight: 600; margin-right: 2mm; }
    .print-group { border: 0.3mm solid #000; padding: 3mm; margin-bottom: 12mm; background: #fff; page-break-inside: avoid; break-inside: avoid; }
    .print-group__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 5mm; margin-bottom: 4mm; }
    .print-group__meta { min-width: 40mm; }
    .print-group__label { font-size: 7.2pt; color: #555; letter-spacing: 0.08em; margin-bottom: 1mm; text-transform: uppercase; }
    .print-group__value { font-size: 12.8pt; font-weight: 600; }
    .print-group__gl { flex: 1 1 auto; }
    .print-group__gl-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-group__gl-table th, .print-group__gl-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; }
    .print-group__gl-table th { background: #f0f0f0; }
    .print-group__gl-empty { text-align: center; color: #555; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-table th, .print-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
    .print-table th { background: #f5f5f5; }
    .print-table__index { width: 12mm; text-align: right; }
    .print-table__phonetic { font-size: 7.2pt; }
    .print-table__contact { white-space: nowrap; }
    .print-table__empty td { text-align: center; color: #555; }
    .print-empty { font-size: 8.8pt; margin: 0; }
    .print-footer { margin-top: 6mm; font-size: 8pt; color: #000; }
    .print-footer__items { display: flex; gap: 6mm; align-items: center; }
    .print-footer__page { margin-left: auto; }
    .print-footer__item { white-space: nowrap; }
    .print-surface {
      -webkit-print-color-adjust: exact;
      background: #fff;
      margin: 24px auto;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      aspect-ratio: calc(var(--page-width) / var(--page-height));
      height: auto;
      padding: var(--page-margin);
      width: var(--page-width);
      min-height: var(--page-height);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
      transform: scale(var(--preview-scale));
      transform-origin: top center;
    }
    @media print {
      body { background: #fff; }
      .print-surface {
        aspect-ratio: auto;
        box-shadow: none;
        margin: 0 auto;
        padding: 0;
        width: var(--page-content-width);
        min-height: var(--page-content-height);
        box-sizing: content-box;
        transform: none;
      }
    }
    .print-surface .print-controls { display: none; }
    .print-surface .print-group { break-inside: avoid-page; }
    .print-surface .print-footer { display: block; margin-top: auto; }
    .print-surface .print-footer__page-number::after { content: counter(page); }
  </style>
</head>
<body>
  <div class="print-surface" aria-label="参加者リストの印刷プレビュー">
    <div class="print-controls" role="group" aria-label="印刷操作">
      <button type="button" class="print-controls__button" onclick="window.print()">印刷する</button>
    </div>
    <header class="${headerClass}">
      <h1 class="print-title">${escapeHtml(headingText)}</h1>
      ${metaMarkup}
    </header>
    <main>
      ${sectionsMarkup}
    </main>
    ${footerMarkup}
  </div>
</body>
</html>`;
  logPrintInfo("buildParticipantPrintHtml generated", {
    eventId,
    scheduleId,
    groupsCount: Array.isArray(groups) ? groups.length : 0,
    totalCount,
    printSettings
  });
  return html;
}

function buildMinimalParticipantPrintPreview({
  participants = [],
  groupLabel = "参加者",
  groupValue = "",
  printOptions = {},
  generatedAt = new Date()
} = {}) {
  logPrintInfo("buildMinimalParticipantPrintPreview", { participantsCount: participants.length, groupLabel, groupValue, printOptions });
  return buildParticipantPrintHtml({
    eventId: "",
    scheduleId: "",
    eventName: "",
    scheduleLabel: "",
    scheduleLocation: "",
    scheduleRange: "",
    groups: [
      {
        key: "default",
        label: groupLabel,
        value: groupValue,
        participants,
        glLeaders: []
      }
    ],
    totalCount: participants.length,
    generatedAt,
    printOptions
  });
}

export {
  PRINT_LOG_PREFIX,
  PRINT_SETTING_STORAGE_KEY,
  DEFAULT_CUSTOM_PAGE_SIZE,
  DEFAULT_PRINT_SETTINGS,
  PRINT_PAPER_SIZE_MAP,
  PRINT_PAPER_SIZES,
  PRINT_ORIENTATIONS,
  PRINT_MARGINS,
  escapeHtml,
  formatPrintCell,
  formatMetaDisplay,
  formatPrintDateTimeRange,
  normalizePageDimension,
  normalizePrintSettings,
  resolvePrintPageSize,
  buildParticipantPrintHtml,
  buildMinimalParticipantPrintPreview,
  logPrintInfo,
  logPrintWarn,
  logPrintError,
  logPrintDebug
};
