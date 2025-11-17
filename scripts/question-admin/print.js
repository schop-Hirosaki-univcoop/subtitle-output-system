import { state } from "./state.js";
import { dom } from "./dom.js";
import { parseDateTimeLocal } from "./utils.js";
import { combineDateAndTime, formatDatePart, formatTimePart } from "./calendar.js";
import { sortParticipants } from "./participants.js";
import {
  collectGroupGlLeaders,
  describeParticipantGroup,
  getEventGlAssignmentsMap,
  getEventGlRoster,
  getParticipantGroupKey
} from "./groups.js";
import {
  DEFAULT_CUSTOM_PAGE_SIZE,
  PRINT_MARGINS,
  PRINT_ORIENTATIONS,
  PRINT_PAPER_SIZE_MAP,
  PRINT_PAPER_SIZES,
  escapeHtml,
  formatMetaDisplay,
  formatPrintCell,
  formatPrintDateTimeRange,
  normalizePageDimension,
  resolvePrintPageSize
} from "../shared/print.js";

function buildParticipantPrintGroups({ eventId, scheduleId }) {
  const participants = sortParticipants(state.participants);
  const rosterMap = getEventGlRoster(eventId);
  const assignmentsMap = getEventGlAssignmentsMap(eventId);
  const groupsByKey = new Map();

  participants.forEach(entry => {
    const groupKey = getParticipantGroupKey(entry);
    let group = groupsByKey.get(groupKey);
    if (!group) {
      const { label, value } = describeParticipantGroup(groupKey);
      group = {
        key: groupKey,
        label,
        value,
        participants: []
      };
      groupsByKey.set(groupKey, group);
    }
    group.participants.push(entry);
  });

  return Array.from(groupsByKey.values())
    .filter(group => Array.isArray(group.participants) && group.participants.length > 0)
    .map(group => ({
      ...group,
      glLeaders: collectGroupGlLeaders(group.key, {
        eventId,
        scheduleId,
        rosterMap,
        assignmentsMap
      })
    }));
}

const PRINT_SETTING_STORAGE_KEY = "qa.printSettings.v1";

function normalizePrintSettings(settings = {}) {
  const fallbackWidth = state.printSettings?.customWidth || DEFAULT_CUSTOM_PAGE_SIZE.width;
  const fallbackHeight = state.printSettings?.customHeight || DEFAULT_CUSTOM_PAGE_SIZE.height;
  const normalized = {
    paperSize: PRINT_PAPER_SIZES.has(settings?.paperSize) ? settings.paperSize : state.printSettings.paperSize,
    orientation: PRINT_ORIENTATIONS.has(settings?.orientation) ? settings.orientation : state.printSettings.orientation,
    margin: PRINT_MARGINS.has(settings?.margin) ? settings.margin : state.printSettings.margin,
    customWidth: normalizePageDimension(settings?.customWidth, fallbackWidth),
    customHeight: normalizePageDimension(settings?.customHeight, fallbackHeight),
    showHeader: settings?.showHeader !== undefined ? Boolean(settings.showHeader) : state.printSettings.showHeader,
    repeatHeader: settings?.repeatHeader !== undefined ? Boolean(settings.repeatHeader) : state.printSettings.repeatHeader,
    showPageNumbers: settings?.showPageNumbers !== undefined ? Boolean(settings.showPageNumbers) : state.printSettings.showPageNumbers,
    showDate: settings?.showDate !== undefined ? Boolean(settings.showDate) : state.printSettings.showDate,
    showTime: settings?.showTime !== undefined ? Boolean(settings.showTime) : state.printSettings.showTime,
    showPhone: settings?.showPhone !== undefined ? Boolean(settings.showPhone) : state.printSettings.showPhone,
    showEmail: settings?.showEmail !== undefined ? Boolean(settings.showEmail) : state.printSettings.showEmail
  };

  if (!normalized.showHeader) {
    normalized.repeatHeader = false;
  }

  if (normalized.paperSize !== "Custom") {
    normalized.customWidth = fallbackWidth;
    normalized.customHeight = fallbackHeight;
  }

  return normalized;
}

function hydratePrintSettingsFromStorage() {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const stored = localStorage.getItem(PRINT_SETTING_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    const normalized = normalizePrintSettings(parsed);
    state.printSettings = normalized;
  } catch (error) {
    console.warn("[Print] Failed to load print settings from storage", error);
  }
}

function buildPrintStyleSheet(printSettings = state.printSettings) {
  const normalized = normalizePrintSettings(printSettings);
  const pageMargin = normalized.margin || "5mm";
  const pageSize = normalized.paperSize || "A4";
  const pageOrientation = normalized.orientation || "portrait";
  const { width: pageWidth, height: pageHeight } = resolvePrintPageSize(normalized);
  const pageSizeValue = pageSize === "Custom"
    ? `${pageWidth}mm ${pageHeight}mm`
    : `${pageSize} ${pageOrientation}`;

  const stickyHeaderRule = normalized.repeatHeader
    ? `.print-surface .print-header--repeat { background: #fff; position: sticky; top: 0; }`
    : "";

  const printHeaderRule = normalized.repeatHeader
    ? `.print-header--repeat { position: running(printHeader); }
      @page { @top-center { content: element(printHeader); } }
      .print-header--repeat { background: #fff; }
      .print-header--repeat { position: sticky; top: 0; }`
    : "";

  const css = `:root { color-scheme: light; --page-margin: ${pageMargin}; --page-width: ${pageWidth}mm; --page-height: ${pageHeight}mm; --page-content-width: calc(var(--page-width) - (2 * var(--page-margin))); --page-content-height: calc(var(--page-height) - (2 * var(--page-margin))); --preview-scale: 1; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-SemiBold.woff2") format("woff2"); font-weight: 600; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-Heavy.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
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
    .print-group__label { font-size: 7.2pt; color: #555; letter-spacing: 0.08em; margin-bottom: 1mm; text-transform: uppercase;}
    .print-group__value { font-size: 12.8pt; font-weight: 600; }
    .print-group__gl { flex: 1 1 auto; }
    .print-group__gl-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-group__gl-table th, .print-group__gl-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; }
    .print-group__gl-table th { background: #f0f0f0; }
    .print-group__gl-empty { text-align: center; color: #555; }
    .print-group__stats { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2mm 6mm; font-size: 8pt; }
    .print-group__stat { display: inline-flex; gap: 1.5mm; align-items: baseline; }
    .print-group__stat-label { color: #555; }
    .print-group__stat-value { font-weight: 600; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-table th, .print-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
    .print-table th { background: #f5f5f5; }
    .print-table__index { width: 12mm; text-align: right; }
    .print-table__phonetic { font-size: 7.2pt; }
    .print-table__contact { white-space: nowrap; }
    .print-table__date { white-space: nowrap; }
    .print-table__time { white-space: nowrap; }
    .print-table__location { min-width: 25mm; }
    .print-table__count { text-align: right; width: 16mm; }
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
    .print-surface .print-controls { display: none; }
    .print-surface .print-group { break-inside: avoid-page; }
    .print-surface .print-footer { display: block; margin-top: auto; }
    .print-surface .print-footer__page-number::after { content: counter(page); }
    .print-surface .print-footer__page { margin-left: auto; }
    ${stickyHeaderRule}
    @media print {
      body { -webkit-print-color-adjust: exact; margin: 0; background: #fff; }
      .print-surface {
        display: flex;
        flex-direction: column;
        margin: 0 auto;
        padding: 0;
        box-shadow: none;
        transform: none;
        aspect-ratio: auto;
        width: var(--page-content-width);
        min-height: var(--page-content-height);
        box-sizing: content-box;
      }
      .print-controls { display: none; }
      .print-group { break-inside: avoid-page; }
      .print-footer {
        display: block;
        margin-top: auto;
        margin-bottom: 0;
        padding: 0;
      }
      .print-footer__page-number::after { content: counter(page); }
      .print-footer__page { margin-left: auto; }
      .print-surface {
        height: var(--page-content-height);
      }
      ${printHeaderRule}
    }
  `;

  return { css };
}

function buildPrintFooterMarkup(printSettings, generatedDateText, generatedTimeText) {
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

  return footerItems.length
    ? `<footer class="print-footer"><div class="print-footer__items">${footerItems.join("")}</div></footer>`
    : "";
}

function formatScheduleDateParts(schedule = {}) {
  const startAt = parseDateTimeLocal(schedule.startAt || "");
  const endAt = parseDateTimeLocal(schedule.endAt || "");
  const startTimeText = startAt ? formatTimePart(startAt) : String(schedule.startTime || "").trim();
  const endTimeText = endAt ? formatTimePart(endAt) : String(schedule.endTime || "").trim();
  const dateText = String(schedule.date || "").trim()
    || (startAt ? formatDatePart(startAt) : "")
    || (endAt ? formatDatePart(endAt) : "");

  return {
    dateText: dateText || "—",
    startTimeText: startTimeText || "—",
    endTimeText: endTimeText || "—"
  };
}

function buildEventPrintHtml({ events = [], generatedAt, printOptions } = {}) {
  const printSettings = normalizePrintSettings(printOptions);
  const { css: printStyleSheet } = buildPrintStyleSheet(printSettings);
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

  const totalSchedules = events.reduce(
    (sum, event) => sum + (Array.isArray(event?.schedules) ? event.schedules.length : 0),
    0
  );
  const totalParticipants = events.reduce((sum, event) => {
    const scheduleSum = (event?.schedules || []).reduce(
      (scheduleTotal, schedule) => scheduleTotal + (Number(schedule?.participantCount) || 0),
      0
    );
    return sum + scheduleSum;
  }, 0);

  const headingText = "イベント・日程一覧";
  const docTitle = `${headingText}`;

  const metaItems = [
    `<li class="print-meta__item"><span class="print-meta__label">イベント:</span> <span class="print-meta__value">${escapeHtml(`${events.length}件`)}</span></li>`,
    `<li class="print-meta__item"><span class="print-meta__label">日程:</span> <span class="print-meta__value">${escapeHtml(`${totalSchedules}件`)}</span></li>`,
    `<li class="print-meta__item"><span class="print-meta__label">参加者数:</span> <span class="print-meta__value">${escapeHtml(`${totalParticipants}名`)}</span></li>`
  ];

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

  const eventSections = events.length
    ? events
        .map((event) => {
          const eventName = formatMetaDisplay(event?.name, event?.id);
          const scheduleCount = Array.isArray(event?.schedules) ? event.schedules.length : 0;
          const eventParticipants = (event?.schedules || []).reduce(
            (scheduleTotal, schedule) => scheduleTotal + (Number(schedule?.participantCount) || 0),
            0
          );
          const stats = [
            { label: "日程数", value: `${scheduleCount}件` },
            { label: "総参加者数", value: `${eventParticipants}名` }
          ];
          const tableAriaLabel = escapeHtml(eventName ? `${eventName} の日程一覧` : "日程一覧");
          const scheduleRows = scheduleCount
            ? event.schedules
                .map((schedule) => {
                  const { dateText, startTimeText, endTimeText } = formatScheduleDateParts(schedule);
                  const scheduleLabel = formatPrintCell(schedule?.label || schedule?.name || schedule?.id || "", { placeholder: "—" });
                  const scheduleDate = formatPrintCell(dateText, { placeholder: "—" });
                  const startTimeCell = formatPrintCell(startTimeText, { placeholder: "—" });
                  const endTimeCell = formatPrintCell(endTimeText, { placeholder: "—" });
                  const locationText = String(schedule?.location || schedule?.place || "").trim();
                  const locationCell = formatPrintCell(locationText, { placeholder: "—" });
                  const participantCount = Number(schedule?.participantCount) || 0;
                  const participantCell = formatPrintCell(`${participantCount}`, { placeholder: "0" });

                  return `<tr>
                    <td>${scheduleLabel}</td>
                    <td class="print-table__date">${scheduleDate}</td>
                    <td class="print-table__time">${startTimeCell}</td>
                    <td class="print-table__time">${endTimeCell}</td>
                    <td class="print-table__location">${locationCell}</td>
                    <td class="print-table__count">${participantCell}</td>
                  </tr>`;
                })
                .join("\n")
            : '<tr class="print-table__empty"><td colspan="6">日程が登録されていません</td></tr>';

          const statsMarkup = stats
            .map((stat) =>
              `<li class="print-group__stat"><span class="print-group__stat-label">${escapeHtml(stat.label)}:</span><span class="print-group__stat-value">${escapeHtml(stat.value)}</span></li>`
            )
            .join("");

          return `<section class="print-group" data-event-id="${escapeHtml(String(event?.id || ""))}">
            <div class="print-group__header">
              <div class="print-group__meta">
                <div class="print-group__label">イベント</div>
                <div class="print-group__value">${eventName ? escapeHtml(eventName) : "—"}</div>
              </div>
              <ul class="print-group__stats">${statsMarkup}</ul>
            </div>
            <table class="print-table" aria-label="${tableAriaLabel}">
              <thead>
                <tr>
                  <th scope="col">日程の表示名</th>
                  <th scope="col">日付</th>
                  <th scope="col">開始時刻</th>
                  <th scope="col">終了時刻</th>
                  <th scope="col">場所</th>
                  <th scope="col" class="print-table__count">参加者数</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleRows}
              </tbody>
            </table>
          </section>`;
        })
        .join("\n\n")
    : '<p class="print-empty">イベントが登録されていません。</p>';

  const headerClass = printSettings.repeatHeader ? "print-header print-header--repeat" : "print-header";
  const metaMarkup = metaItems.length ? `<ul class="print-meta">${metaItems.join("\n")}</ul>` : "";
  const footerMarkup = buildPrintFooterMarkup(printSettings, generatedDateText, generatedTimeText);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    ${printStyleSheet}
  </style>
</head>
<body class="print-surface">
  <div class="print-controls">
    <button type="button" class="print-controls__button" onclick="window.print()">このリストを印刷</button>
  </div>
  ${printSettings.showHeader ? `<header class="${headerClass}">
    <h1 class="print-title">${escapeHtml(headingText)}</h1>
    ${metaMarkup}
  </header>` : ""}
  ${eventSections}
  ${footerMarkup}
</body>
</html>`;
}

function persistPrintSettings(settings) {
  const normalized = normalizePrintSettings(settings);
  state.printSettings = normalized;
  if (typeof localStorage === "undefined") {
    return normalized;
  }
  try {
    localStorage.setItem(PRINT_SETTING_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn("[Print] Failed to persist print settings", error);
  }
  return normalized;
}

function applyPrintSettingsToForm(settings = state.printSettings) {
  const normalized = normalizePrintSettings(settings);
  if (dom.printPaperSizeInput) {
    dom.printPaperSizeInput.value = normalized.paperSize;
  }
  if (dom.printOrientationInput) {
    dom.printOrientationInput.value = normalized.orientation;
  }
  if (dom.printMarginInput) {
    dom.printMarginInput.value = normalized.margin;
  }
  if (dom.printCustomWidthInput) {
    dom.printCustomWidthInput.value = normalized.customWidth;
  }
  if (dom.printCustomHeightInput) {
    dom.printCustomHeightInput.value = normalized.customHeight;
  }
  if (dom.printShowHeaderInput) {
    dom.printShowHeaderInput.checked = normalized.showHeader;
  }
  if (dom.printRepeatHeaderInput) {
    dom.printRepeatHeaderInput.checked = normalized.repeatHeader && normalized.showHeader;
    dom.printRepeatHeaderInput.disabled = !normalized.showHeader;
  }
  if (dom.printShowPageNumberInput) {
    dom.printShowPageNumberInput.checked = normalized.showPageNumbers;
  }
  if (dom.printShowDateInput) {
    dom.printShowDateInput.checked = normalized.showDate;
  }
  if (dom.printShowTimeInput) {
    dom.printShowTimeInput.checked = normalized.showTime;
  }
  if (dom.printShowPhoneInput) {
    dom.printShowPhoneInput.checked = normalized.showPhone;
  }
  if (dom.printShowEmailInput) {
    dom.printShowEmailInput.checked = normalized.showEmail;
  }
}

function readPrintSettingsFromForm() {
  const settings = {
    paperSize: dom.printPaperSizeInput?.value,
    orientation: dom.printOrientationInput?.value,
    margin: dom.printMarginInput?.value,
    customWidth: dom.printCustomWidthInput?.value,
    customHeight: dom.printCustomHeightInput?.value,
    showHeader: dom.printShowHeaderInput ? dom.printShowHeaderInput.checked : undefined,
    repeatHeader: dom.printRepeatHeaderInput ? dom.printRepeatHeaderInput.checked : undefined,
    showPageNumbers: dom.printShowPageNumberInput ? dom.printShowPageNumberInput.checked : undefined,
    showDate: dom.printShowDateInput ? dom.printShowDateInput.checked : undefined,
    showTime: dom.printShowTimeInput ? dom.printShowTimeInput.checked : undefined,
    showPhone: dom.printShowPhoneInput ? dom.printShowPhoneInput.checked : undefined,
    showEmail: dom.printShowEmailInput ? dom.printShowEmailInput.checked : undefined
  };
  if (settings.showHeader === false) {
    settings.repeatHeader = false;
  }
  return normalizePrintSettings(settings);
}

function setupPrintSettingsDialog() {
  if (!dom.printSettingsForm) return;

  const syncHeaderControls = () => {
    if (!dom.printShowHeaderInput || !dom.printRepeatHeaderInput) return;
    const enabled = Boolean(dom.printShowHeaderInput.checked);
    dom.printRepeatHeaderInput.disabled = !enabled;
    if (!enabled) {
      dom.printRepeatHeaderInput.checked = false;
    }
  };

  const syncCustomSizeVisibility = () => {
    if (!dom.printPaperSizeInput || !dom.printCustomSizeField) return;
    const isCustom = dom.printPaperSizeInput.value === "Custom";
    dom.printCustomSizeField.hidden = !isCustom;
  };

  dom.printShowHeaderInput?.addEventListener("change", syncHeaderControls);
  dom.printPaperSizeInput?.addEventListener("change", syncCustomSizeVisibility);
  dom.printSettingsForm.addEventListener("change", () => {
    const settings = readPrintSettingsFromForm();
    persistPrintSettings(settings);
    updateActivePrintPreview({ autoPrint: false, forceReveal: true, quiet: true });
  });

  dom.printSettingsForm.addEventListener("submit", event => {
    event.preventDefault();
    const settings = readPrintSettingsFromForm();
    persistPrintSettings(settings);
    updateActivePrintPreview({ autoPrint: false, forceReveal: true });
  });

  applyPrintSettingsToForm(state.printSettings);
  syncHeaderControls();
  syncCustomSizeVisibility();
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
}) {
  const printSettings = normalizePrintSettings(printOptions);
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
    : groups.reduce((sum, group) => sum + (group.participants?.length || 0), 0);

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

  const groupsMarkup = groups
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
  const { css: printStyleSheet } = buildPrintStyleSheet(printSettings);
  const headerClass = printSettings.repeatHeader ? "print-header print-header--repeat" : "print-header";
  const footerMarkup = buildPrintFooterMarkup(printSettings, generatedDateText, generatedTimeText);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    ${printStyleSheet}
  </style>
</head>
<body class="print-surface">
  <div class="print-controls">
    <button type="button" class="print-controls__button" onclick="window.print()">このリストを印刷</button>
  </div>
  ${printSettings.showHeader ? `<header class="${headerClass}">
    <h1 class="print-title">${escapeHtml(headingText)}</h1>
    ${metaMarkup}
  </header>` : ""}
  ${sectionsMarkup}
  ${footerMarkup}
</body>
</html>`;
}

const PRINT_PREVIEW_DEFAULT_NOTE = "印刷設定を選ぶとここに最新のプレビューが表示されます。";
const PRINT_PREVIEW_LOAD_TIMEOUT_MS = 4000;
const PRINT_TARGETS = { PARTICIPANTS: "participants", EVENTS: "events" };
let activePrintPreviewTarget = PRINT_TARGETS.PARTICIPANTS;
let printPreviewInProgress = false;
let printPreviewAutoPrintPending = false;
let printPreviewCache = {
  html: "",
  title: "",
  metaText: "",
  printSettings: null,
  forcePopupFallback: false
};
let printPreviewLoadAbort = null;
let printActionButtonMissingLogged = false;

function setPrintActionButtonState(button, disabled) {
  if (!button) {
    return;
  }
  button.disabled = disabled;
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
  } else {
    button.removeAttribute("aria-disabled");
  }
}

function syncPrintViewButtonState() {
  const button = dom.openPrintViewButton;
  if (!button) {
    if (!printActionButtonMissingLogged) {
      printActionButtonMissingLogged = true;
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[Print] open-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
      }
    }
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "印刷用リスト";
  }

  if (button.dataset.printing === "true") {
    setPrintActionButtonState(button, true);
    const busyLabel = button.dataset.printingLabel || "印刷準備中…";
    if (!button.dataset.printingLabel) {
      button.dataset.printingLabel = busyLabel;
    }
    if (button.textContent !== busyLabel) {
      button.textContent = busyLabel;
    }
    return;
  }

  if (button.dataset.printLocked === "true") {
    setPrintActionButtonState(button, true);
    const defaultLabel = button.dataset.defaultLabel || "印刷用リスト";
    if (button.textContent !== defaultLabel) {
      button.textContent = defaultLabel;
    }
    return;
  }

  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && state.participants.length > 0;
  const disabled = !hasSelection || !hasParticipants;

  setPrintActionButtonState(button, disabled);

  if (disabled && activePrintPreviewTarget === PRINT_TARGETS.PARTICIPANTS) {
    closePrintPreview();
  }

  const baseLabel = button.dataset.defaultLabel || "印刷用リスト";
  if (button.textContent !== baseLabel) {
    button.textContent = baseLabel;
  }

  syncEventPrintButtonState();
}

function syncEventPrintButtonState() {
  const button = dom.openEventPrintViewButton;
  if (!button) return;

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "イベント一覧を印刷";
  }

  if (button.dataset.printing === "true") {
    setPrintActionButtonState(button, true);
    const busyLabel = button.dataset.printingLabel || "印刷準備中…";
    if (!button.dataset.printingLabel) {
      button.dataset.printingLabel = busyLabel;
    }
    if (button.textContent !== busyLabel) {
      button.textContent = busyLabel;
    }
    return;
  }

  if (button.dataset.printLocked === "true") {
    setPrintActionButtonState(button, true);
    const defaultLabel = button.dataset.defaultLabel || "イベント一覧を印刷";
    if (button.textContent !== defaultLabel) {
      button.textContent = defaultLabel;
    }
    return;
  }

  const hasEvents = Array.isArray(state.events) && state.events.length > 0;
  const disabled = !hasEvents;
  setPrintActionButtonState(button, disabled);

  if (disabled && activePrintPreviewTarget === PRINT_TARGETS.EVENTS) {
    closePrintPreview();
  }

  const baseLabel = button.dataset.defaultLabel || "イベント一覧を印刷";
  if (button.textContent !== baseLabel) {
    button.textContent = baseLabel;
  }
}

function setEventPrintButtonBusy(isBusy) {
  const button = dom.openEventPrintViewButton;
  if (!button) return;
  if (isBusy) {
    button.dataset.printing = "true";
  } else {
    delete button.dataset.printing;
  }
  syncEventPrintButtonState();
}

function setParticipantPrintButtonBusy(isBusy) {
  const button = dom.openPrintViewButton;
  if (!button) return;
  if (isBusy) {
    button.dataset.printing = "true";
  } else {
    delete button.dataset.printing;
  }
  syncPrintViewButtonState();
}
function normalizeLivePoliteness(value, { defaultValue = "" } = {}) {
  const normalize = (input) => {
    const trimmed = (input || "").trim().toLowerCase();
    return trimmed === "assertive" || trimmed === "polite" || trimmed === "off"
      ? trimmed
      : "";
  };

  return normalize(value) || normalize(defaultValue);
}

function normalizeLiveRegionRole(value) {
  const trimmed = (value || "").trim().toLowerCase();
  return trimmed === "status" || trimmed === "alert" ? trimmed : "";
}

function cachePrintPreview(
  { html = "", title = "", metaText = "", printSettings = null, forcePopupFallback } = {},
  { preserveFallbackFlag = false } = {}
) {
  const nextForcePopupFallback =
    forcePopupFallback !== undefined
      ? Boolean(forcePopupFallback)
      : preserveFallbackFlag
      ? Boolean(printPreviewCache.forcePopupFallback)
      : false;

  printPreviewCache = {
    html: html || "",
    title: title || "",
    metaText: metaText || "",
    printSettings: printSettings ? normalizePrintSettings(printSettings) : printPreviewCache.printSettings,
    forcePopupFallback: nextForcePopupFallback
  };
}

function setPrintPreviewNote(text = PRINT_PREVIEW_DEFAULT_NOTE, options = {}) {
  const { forceAnnounce = false, politeness, role } = options || {};
  if (!dom.printPreviewNote) {
    return;
  }

  const nextText = text || "";
  const currentText = dom.printPreviewNote.textContent || "";
  const rawCurrentLive = dom.printPreviewNote.getAttribute("aria-live");
  const roleOverride = role !== undefined ? normalizeLiveRegionRole(role) : null;
  const defaultPoliteness = roleOverride === "alert" ? "assertive" : "polite";
  const nextLive = normalizeLivePoliteness(politeness, { defaultValue: defaultPoliteness });
  const currentLive = normalizeLivePoliteness(rawCurrentLive, { defaultValue: "" });
  let nextRole =
    roleOverride !== null
      ? roleOverride
      : nextLive === "assertive"
      ? "alert"
      : nextLive === "polite"
      ? "status"
      : "";

  if (nextLive === "off") {
    nextRole = "";
  }
  const rawCurrentRole = dom.printPreviewNote.getAttribute("role");
  const currentRole = normalizeLiveRegionRole(rawCurrentRole);
  const liveChanged = nextLive !== currentLive;
  const roleChanged = nextRole !== currentRole;
  const liveNeedsClear = !nextLive && rawCurrentLive !== null;
  const roleNeedsClear = !nextRole && rawCurrentRole !== null;

  dom.printPreviewNote.classList.remove("print-preview__note--error");

  const shouldAnnounce =
    forceAnnounce || liveChanged || roleChanged || liveNeedsClear || roleNeedsClear;
  const shouldUpdateRole = roleChanged || roleNeedsClear || forceAnnounce;
  const shouldForceLiveReset = forceAnnounce && nextLive !== "off";
  const shouldForceRoleReset = forceAnnounce && shouldUpdateRole;

  const applyLive = (value) => {
    if (!value || value === "off") {
      dom.printPreviewNote.removeAttribute("aria-live");
    } else {
      dom.printPreviewNote.setAttribute("aria-live", value);
    }
  };

  if (!shouldAnnounce && currentText === nextText) {
    return;
  }

  if (shouldForceLiveReset) {
    applyLive("off");
  } else if (liveChanged || liveNeedsClear || nextLive === "off") {
    applyLive(nextLive);
  }

  if (shouldForceRoleReset) {
    dom.printPreviewNote.removeAttribute("role");
  }

  if (shouldUpdateRole && !shouldForceRoleReset) {
    if (nextRole) {
      dom.printPreviewNote.setAttribute("role", nextRole);
    } else {
      dom.printPreviewNote.removeAttribute("role");
    }
  }

  dom.printPreviewNote.textContent = "";

  const restoreLive = () => {
    if (shouldForceLiveReset) {
      applyLive(nextLive);
    }
  };

  const renderText = () => {
    if (shouldForceRoleReset) {
      if (nextRole) {
        dom.printPreviewNote.setAttribute("role", nextRole);
      } else {
        dom.printPreviewNote.removeAttribute("role");
      }
    }
    restoreLive();
    dom.printPreviewNote.textContent = nextText;
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(renderText);
  } else {
    renderText();
  }
}

function setPrintPreviewVisibility(visible) {
  const dialog = dom.printPreviewDialog;
  if (dialog) {
    if (visible) {
      openDialog(dialog);
      if (dom.printPreview) {
        dom.printPreview.hidden = false;
      }
    } else {
      closeDialog(dialog);
    }
    return true;
  }
  if (dom.printPreview) {
    dom.printPreview.hidden = !visible;
    return true;
  }
  return false;
}

function setPrintPreviewBusy(isBusy = false) {
  if (!dom.printPreview) {
    return;
  }
  dom.printPreview.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function clearPrintPreviewLoader() {
  if (!printPreviewLoadAbort) {
    return;
  }

  const { loadHandler, errorHandler, timeoutId } = printPreviewLoadAbort;

  if (timeoutId) {
    window.clearTimeout(timeoutId);
  }

  if (loadHandler && dom.printPreviewFrame) {
    try {
      dom.printPreviewFrame.removeEventListener("load", loadHandler);
    } catch (error) {
      // Ignore listener cleanup errors
    }
  }

  if (errorHandler && dom.printPreviewFrame) {
    try {
      dom.printPreviewFrame.removeEventListener("error", errorHandler);
    } catch (error) {
      // Ignore listener cleanup errors
    }
  }

  printPreviewLoadAbort = null;
}

function resetPrintPreview(options = {}) {
  const { skipCloseDialog = false } = options || {};
  clearPrintPreviewLoader();
  if (dom.printPreviewFrame) {
    dom.printPreviewFrame.srcdoc = "";
  }
  if (dom.printPreview) {
    dom.printPreview.classList.remove("print-preview--fallback");
  }
  setPrintPreviewBusy(false);
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = true;
    delete dom.printPreviewPrintButton.dataset.popupFallback;
  }
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.remove("print-preview__note--error");
  }
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = "";
  }
  cachePrintPreview({ forcePopupFallback: false });
  printPreviewAutoPrintPending = false;
  setPrintPreviewNote();
  if (skipCloseDialog) {
    if (dom.printPreview) {
      dom.printPreview.hidden = true;
    }
  } else {
    setPrintPreviewVisibility(false);
  }
}

function renderPreviewFallbackNote(message, metaText = "") {
  clearPrintPreviewLoader();
  if (dom.printPreviewFrame) {
    dom.printPreviewFrame.srcdoc = "";
  }
  if (dom.printPreview) {
    dom.printPreview.classList.add("print-preview--fallback");
  }
  const hasCachedHtml = Boolean(printPreviewCache?.html);
  const popupHint = hasCachedHtml
    ? " 画面右の「このリストを印刷」からポップアップ印刷を再試行できます。"
    : "";
  const noteText = `${message || "プレビューを表示できませんでした。"}${popupHint}`;
  const nextMetaText = metaText || printPreviewCache.metaText || "";

  setPrintPreviewVisibility(true);
  setPrintPreviewNote(noteText, { forceAnnounce: true, politeness: "assertive" });
  setPrintPreviewBusy(false);
  cachePrintPreview({
    ...printPreviewCache,
    metaText: nextMetaText,
    forcePopupFallback: true
  });
  printPreviewAutoPrintPending = false;
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = nextMetaText;
  }
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = !hasCachedHtml;
    if (hasCachedHtml) {
      dom.printPreviewPrintButton.dataset.popupFallback = "true";
    } else {
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
  }
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.add("print-preview__note--error");
  }
}

function openPopupPrintWindow(html, docTitle, printSettings = state.printSettings) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    return false;
  }

  try {
    printWindow.opener = null;
  } catch (error) {
    // Ignore opener errors
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } catch (error) {
    // Ignore document write errors
  }

  try {
    if (docTitle) {
      printWindow.document.title = docTitle;
    }
  } catch (error) {
    // Ignore title assignment errors
  }

  window.setTimeout(() => {
    try {
      printWindow.print();
    } catch (error) {
      // Ignore print errors
    }
  }, 150);

  return true;
}

function renderPrintPreview({
  html,
  metaText,
  title,
  autoPrint = false,
  printSettings
} = {}) {
  if (!dom.printPreview || !dom.printPreviewFrame) {
    return false;
  }

  setPrintPreviewBusy(true);

  const normalizedPrintSettings = normalizePrintSettings(
    printSettings || printPreviewCache.printSettings || state.printSettings
  );

  if (printPreviewCache.forcePopupFallback) {
    renderPreviewFallbackNote(
      "プレビューを利用できないためポップアップ印刷を使用します。",
      metaText || printPreviewCache.metaText || ""
    );

    if (autoPrint && printPreviewCache.html) {
      const fallbackOpened = openPopupPrintWindow(
        printPreviewCache.html,
        printPreviewCache.title,
        normalizedPrintSettings
      );
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }

    return false;
  }

  setPrintPreviewVisibility(true);
  if (dom.printPreview) {
    dom.printPreview.classList.remove("print-preview--fallback");
  }
  setPrintPreviewNote(autoPrint ? "プレビューを準備しています…" : "プレビューを更新しています…");
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.remove("print-preview__note--error");
  }
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = metaText || "";
  }
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = true;
    delete dom.printPreviewPrintButton.dataset.popupFallback;
  }

  cachePrintPreview({ html, title, metaText, printSettings: normalizedPrintSettings }, { preserveFallbackFlag: true });
  printPreviewAutoPrintPending = Boolean(autoPrint);
  clearPrintPreviewLoader();

  let loadTimeoutId = null;
  let settled = false;

  const settleLoad = () => {
    if (settled) {
      return false;
    }
    settled = true;
    if (loadTimeoutId) {
      window.clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
    if (dom.printPreviewFrame && printPreviewLoadAbort) {
      try {
        if (printPreviewLoadAbort.loadHandler) {
          dom.printPreviewFrame.removeEventListener("load", printPreviewLoadAbort.loadHandler);
        }
        if (printPreviewLoadAbort.errorHandler) {
          dom.printPreviewFrame.removeEventListener("error", printPreviewLoadAbort.errorHandler);
        }
      } catch (error) {
        // Ignore listener cleanup errors
      }
    }
    printPreviewLoadAbort = null;
    setPrintPreviewBusy(false);
    return true;
  };

  const handleLoad = () => {
    if (!settleLoad()) {
      return;
    }
    const hasWindow = Boolean(dom.printPreviewFrame?.contentWindow);
    const hasDocument = Boolean(dom.printPreviewFrame?.contentDocument);

    if (!hasWindow || !hasDocument) {
      renderPreviewFallbackNote(
        "プレビューの描画に失敗しました。ポップアップ印刷に切り替えました。",
        metaText
      );

      if (autoPrint && html) {
        const fallbackOpened = openPopupPrintWindow(html, title, normalizedPrintSettings);
        if (!fallbackOpened) {
          window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
        }
      }
      return;
    }

    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = false;
    }
    setPrintPreviewNote(
      autoPrint
        ? "プレビューを更新しました。印刷ダイアログを開きます。"
        : "プレビューを更新しました。画面右のボタンから印刷できます。"
    );

    try {
      if (title && dom.printPreviewFrame?.contentDocument) {
        dom.printPreviewFrame.contentDocument.title = title;
      }
    } catch (error) {
      // Ignore title assignment errors
    }

    if (printPreviewAutoPrintPending) {
      printPreviewAutoPrintPending = false;
      window.setTimeout(() => {
        printCachedPreview({ showAlertOnFailure: true });
      }, 150);
    }
  };

  const handleError = () => {
    if (!settleLoad()) {
      return;
    }

    renderPreviewFallbackNote(
      "プレビューの読み込み中にエラーが発生しました。ポップアップ印刷に切り替えました。",
      metaText
    );

    if (autoPrint && html) {
      const fallbackOpened = openPopupPrintWindow(html, title, normalizedPrintSettings);
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }
  };

  dom.printPreviewFrame.addEventListener("load", handleLoad);
  dom.printPreviewFrame.addEventListener("error", handleError);
  printPreviewLoadAbort = { loadHandler: handleLoad, errorHandler: handleError };

  dom.printPreviewFrame.srcdoc = html || "<!doctype html><title>プレビュー</title>";

  const handleTimeout = () => {
    if (!settleLoad()) {
      return;
    }

    renderPreviewFallbackNote(
      "プレビューの読み込みがタイムアウトしました。ポップアップ印刷に切り替えました。",
      metaText
    );

    if (autoPrint && html) {
      const fallbackOpened = openPopupPrintWindow(html, title, normalizedPrintSettings);
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }
  };

  loadTimeoutId = window.setTimeout(handleTimeout, PRINT_PREVIEW_LOAD_TIMEOUT_MS);
  printPreviewLoadAbort.timeoutId = loadTimeoutId;
  return true;
}

function triggerPrintFromPreview() {
  if (!dom.printPreviewFrame) {
    return false;
  }
  const printWindow = dom.printPreviewFrame.contentWindow;
  if (!printWindow) {
    return false;
  }
  try {
    printWindow.focus();
    printWindow.print();
    return true;
  } catch (error) {
    return false;
  }
}

function printCachedPreview({ showAlertOnFailure = false } = {}) {
  const cachedHtml = printPreviewCache?.html || "";
  const cachedTitle = printPreviewCache?.title || "";
  const cachedMeta = printPreviewCache?.metaText || "";
  const cachedSettings = printPreviewCache?.printSettings || state.printSettings;
  const forcePopupFallback = printPreviewCache?.forcePopupFallback;

  if (!forcePopupFallback) {
    const printedInline = triggerPrintFromPreview();
    if (printedInline) {
      if (dom.printPreviewPrintButton) {
        delete dom.printPreviewPrintButton.dataset.popupFallback;
      }
      return true;
    }
  }

  if (cachedHtml) {
    renderPreviewFallbackNote("ブラウザの印刷ダイアログを新しいタブで開いています。", cachedMeta);

    const popupOpened = openPopupPrintWindow(cachedHtml, cachedTitle, cachedSettings);
    if (popupOpened) {
      cachePrintPreview({ ...printPreviewCache, forcePopupFallback: true });
      if (dom.printPreviewPrintButton) {
        dom.printPreviewPrintButton.dataset.popupFallback = "true";
      }
      return true;
    }
  }

  if (showAlertOnFailure) {
    window.alert("印刷を開始できませんでした。ブラウザのポップアップ設定をご確認ください。");
  }

  return false;
}

function closePrintPreview() {
  resetPrintPreview();
}

function updateActivePrintPreview(options = {}) {
  if (activePrintPreviewTarget === PRINT_TARGETS.EVENTS) {
    return updateEventPrintPreview(options);
  }
  return updateParticipantPrintPreview(options);
}

async function updateParticipantPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
  activePrintPreviewTarget = PRINT_TARGETS.PARTICIPANTS;
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    clearPrintPreviewLoader();
    if (dom.printPreview) {
      dom.printPreview.classList.remove("print-preview--fallback");
    }
    if (dom.printPreviewFrame) {
      dom.printPreviewFrame.srcdoc = "";
    }
    if (dom.printPreviewMeta) {
      dom.printPreviewMeta.textContent = "";
    }
    cachePrintPreview({ forcePopupFallback: false });
    setPrintPreviewVisibility(true);
    setPrintPreviewNote("印刷するにはイベントと日程を選択してください。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = true;
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
    if (!quiet) {
      window.alert("印刷するにはイベントと日程を選択してください。");
    }
    return false;
  }

  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    clearPrintPreviewLoader();
    if (dom.printPreview) {
      dom.printPreview.classList.remove("print-preview--fallback");
    }
    if (dom.printPreviewFrame) {
      dom.printPreviewFrame.srcdoc = "";
    }
    if (dom.printPreviewMeta) {
      dom.printPreviewMeta.textContent = "";
    }
    cachePrintPreview({ forcePopupFallback: false });
    setPrintPreviewVisibility(true);
    setPrintPreviewNote("印刷できる参加者がまだ登録されていません。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = true;
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
    if (!quiet) {
      window.alert("印刷できる参加者がまだ登録されていません。");
    }
    return false;
  }

  if (printPreviewInProgress) {
    return false;
  }

  const button = dom.openPrintViewButton;
  printPreviewInProgress = true;

  if (button) {
    button.dataset.printLocked = "true";
    syncPrintViewButtonState();
  }

  if (forceReveal) {
    setPrintPreviewVisibility(true);
  }

  const printSettings = readPrintSettingsFromForm();
  persistPrintSettings(printSettings);

  try {
    setParticipantPrintButtonBusy(true);
    try {
      try {
        await loadGlDataForEvent(eventId);
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[Print] GLデータの取得に失敗しました。最新の情報が反映されない場合があります。", error);
        }
      }

      const groups = buildParticipantPrintGroups({ eventId, scheduleId });
      if (!groups.length) {
        if (!quiet) {
          window.alert("印刷できる参加者がまだ登録されていません。");
        }
        return false;
      }

      const selectedEvent = state.events.find(evt => evt.id === eventId) || null;
      const schedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
      const eventName = selectedEvent?.name || "";
      const scheduleLabel = schedule?.label || "";
      const scheduleLocation = schedule?.location || schedule?.place || "";
      let startAt = schedule?.startAt || "";
      let endAt = schedule?.endAt || "";
      const scheduleDate = String(schedule?.date || "").trim();
      if (scheduleDate) {
        if (!startAt && schedule?.startTime) {
          startAt = combineDateAndTime(scheduleDate, schedule.startTime);
        }
        if (!endAt && schedule?.endTime) {
          endAt = combineDateAndTime(scheduleDate, schedule.endTime);
        }
      }
      const scheduleRange = formatPrintDateTimeRange(startAt, endAt);
      const totalCount = state.participants.length;
      const generatedAt = new Date();

      const html = buildParticipantPrintHtml({
        eventId,
        scheduleId,
        eventName,
        scheduleLabel,
        scheduleLocation,
        scheduleRange,
        groups,
        totalCount,
        generatedAt,
        printOptions: printSettings
      });

      const titleParts = [eventName || eventId || "", scheduleLabel || scheduleId || ""].filter(Boolean);
      const docTitle = titleParts.length ? `${titleParts.join(" / ")} - 参加者リスト` : "参加者リスト";

      const metaText = [eventName || eventId || "", scheduleLabel || scheduleId || "", `${totalCount}名`]
        .filter(text => String(text || "").trim())
        .join(" / ");

      cachePrintPreview(
        { html, title: docTitle, metaText, printSettings },
        { preserveFallbackFlag: true }
      );

      const previewRendered = renderPrintPreview({
        html,
        metaText,
        title: docTitle,
        autoPrint,
        printSettings
      });

      if (printPreviewCache.forcePopupFallback) {
        return true;
      }

      if (!previewRendered) {
        renderPreviewFallbackNote(
          "プレビュー枠を開けませんでした。ポップアップ許可後に再度お試しください。",
          metaText
        );

        const fallbackOpened = openPopupPrintWindow(html, docTitle, printSettings);
        if (!fallbackOpened) {
          window.alert("印刷プレビューを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
          return false;
        }
      }
      return true;
    } finally {
      setParticipantPrintButtonBusy(false);
    }
  } finally {
    printPreviewInProgress = false;
    if (button) {
      delete button.dataset.printLocked;
    }
    syncPrintViewButtonState();
  }
}

async function updateEventPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
  activePrintPreviewTarget = PRINT_TARGETS.EVENTS;

  if (!Array.isArray(state.events) || state.events.length === 0) {
    clearPrintPreviewLoader();
    if (dom.printPreview) {
      dom.printPreview.classList.remove("print-preview--fallback");
    }
    if (dom.printPreviewFrame) {
      dom.printPreviewFrame.srcdoc = "";
    }
    if (dom.printPreviewMeta) {
      dom.printPreviewMeta.textContent = "";
    }
    cachePrintPreview({ forcePopupFallback: false });
    setPrintPreviewVisibility(true);
    setPrintPreviewNote("印刷できるイベントがまだ登録されていません。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = true;
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
    if (!quiet) {
      window.alert("印刷できるイベントがまだ登録されていません。");
    }
    return false;
  }

  if (printPreviewInProgress) {
    return false;
  }

  const button = dom.openEventPrintViewButton;
  printPreviewInProgress = true;

  if (button) {
    button.dataset.printLocked = "true";
    syncEventPrintButtonState();
  }

  if (forceReveal) {
    setPrintPreviewVisibility(true);
  }

  const printSettings = readPrintSettingsFromForm();
  persistPrintSettings(printSettings);

  try {
    setEventPrintButtonBusy(true);

    const events = Array.isArray(state.events) ? state.events : [];
    const totalSchedules = events.reduce(
      (sum, event) => sum + (Array.isArray(event?.schedules) ? event.schedules.length : 0),
      0
    );
    const totalParticipants = events.reduce((sum, event) => {
      const scheduleSum = (event?.schedules || []).reduce(
        (scheduleTotal, schedule) => scheduleTotal + (Number(schedule?.participantCount) || 0),
        0
      );
      return sum + scheduleSum;
    }, 0);

    const generatedAt = new Date();
    const docTitle = "イベント・日程一覧";
    const html = buildEventPrintHtml({ events, generatedAt, printOptions: printSettings });
    const metaText = [
      `イベント ${events.length}件`,
      `日程 ${totalSchedules}件`,
      `参加者 ${totalParticipants}名`
    ]
      .filter(text => String(text || "").trim())
      .join(" / ");

    cachePrintPreview(
      { html, title: docTitle, metaText, printSettings },
      { preserveFallbackFlag: true }
    );

    const previewRendered = renderPrintPreview({
      html,
      metaText,
      title: docTitle,
      autoPrint,
      printSettings
    });

    if (printPreviewCache.forcePopupFallback) {
      return true;
    }

    if (!previewRendered) {
      renderPreviewFallbackNote(
        "プレビュー枠を開けませんでした。ポップアップ許可後に再度お試しください。",
        metaText
      );

      const fallbackOpened = openPopupPrintWindow(html, docTitle, printSettings);
      if (!fallbackOpened) {
        window.alert("印刷プレビューを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
        return false;
      }
    }

    return true;
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("[Print] イベント一覧の印刷プレビューに失敗しました。", error);
    }
    setPrintPreviewNote("イベント一覧の印刷プレビューを更新できませんでした。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    return false;
  } finally {
    setEventPrintButtonBusy(false);
    printPreviewInProgress = false;
    if (button) {
      delete button.dataset.printLocked;
    }
    syncEventPrintButtonState();
  }
}

async function openParticipantPrintView() {
  activePrintPreviewTarget = PRINT_TARGETS.PARTICIPANTS;
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    window.alert("印刷するにはイベントと日程を選択してください。");
    return;
  }

  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    window.alert("印刷できる参加者がまだ登録されていません。");
    return;
  }

  if (printPreviewInProgress) {
    return;
  }

  setPrintPreviewVisibility(true);
  applyPrintSettingsToForm(state.printSettings);
  await updateParticipantPrintPreview({ autoPrint: false, forceReveal: true });
}

async function openEventPrintView({ autoPrint = false, forceReveal = true, quiet = false } = {}) {
  activePrintPreviewTarget = PRINT_TARGETS.EVENTS;

  if (!Array.isArray(state.events) || state.events.length === 0) {
    if (!quiet) {
      window.alert("印刷できるイベントがまだ登録されていません。");
    }
    return;
  }

  if (printPreviewInProgress) {
    return;
  }

  if (forceReveal) {
    setPrintPreviewVisibility(true);
  }
  applyPrintSettingsToForm(state.printSettings);
  await updateEventPrintPreview({ autoPrint, forceReveal, quiet });
}

export {
  applyPrintSettingsToForm,
  closePrintPreview,
  hydratePrintSettingsFromStorage,
  openEventPrintView,
  openParticipantPrintView,
  printCachedPreview,
  resetPrintPreview,
  setEventPrintButtonBusy,
  setParticipantPrintButtonBusy,
  setupPrintSettingsDialog,
  syncEventPrintButtonState,
  syncPrintViewButtonState,
  updateEventPrintPreview,
  updateParticipantPrintPreview
};

