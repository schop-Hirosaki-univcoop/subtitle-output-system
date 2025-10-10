import { dom } from "./dom.js";
import { calendarState, dialogCalendarState } from "./state.js";
import { parseDateTimeLocal } from "./utils.js";

function formatDatePart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimePart(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.length <= 10 ? `${trimmed}T00:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeDateInputValue(value) {
  const parsed = parseDateOnly(value || "");
  return parsed ? formatDatePart(parsed) : "";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateTimeLocal(date) {
  return `${formatDatePart(date)}T${formatTimePart(date)}`;
}

function combineDateAndTime(dateValue, timeValue) {
  const datePart = normalizeDateInputValue(dateValue);
  const timePart = String(timeValue || "").trim();
  if (!datePart || !timePart) return "";
  return `${datePart}T${timePart}`;
}

function setCalendarPickedDate(value, { updateInput = true } = {}) {
  const normalized = normalizeDateInputValue(value);
  calendarState.pickedDate = normalized;
  if (updateInput && dom.scheduleDateInput) {
    dom.scheduleDateInput.value = normalized;
  }
  setDialogCalendarPickedDate(normalized);
}

function setDialogCalendarPickedDate(value) {
  const normalized = normalizeDateInputValue(value);
  dialogCalendarState.selectedDate = normalized;
  const parsed = normalized ? parseDateOnly(normalized) : null;
  if (parsed) {
    dialogCalendarState.referenceDate = startOfMonth(parsed);
  } else if (!normalized) {
    dialogCalendarState.referenceDate = startOfMonth(new Date());
  }
  renderScheduleDialogCalendar();
}

function renderScheduleDialogCalendar() {
  const grid = dom.scheduleDialogCalendarGrid;
  const title = dom.scheduleDialogCalendarTitle;
  if (!grid || !title) return;

  const referenceMonth = startOfMonth(
    dialogCalendarState.referenceDate instanceof Date ? dialogCalendarState.referenceDate : new Date()
  );
  dialogCalendarState.referenceDate = referenceMonth;

  title.textContent = formatMonthTitle(referenceMonth);

  const today = startOfDay(new Date());
  const firstVisible = startOfDay(new Date(referenceMonth));
  firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay());

  grid.innerHTML = "";

  for (let index = 0; index < 42; index++) {
    const cellDate = new Date(firstVisible);
    cellDate.setDate(firstVisible.getDate() + index);

    const key = formatDatePart(cellDate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dialog-calendar-date";
    button.dataset.date = key;
    button.setAttribute("aria-label", `${key} を選択`);
    button.setAttribute("role", "gridcell");

    if (cellDate.getMonth() !== referenceMonth.getMonth()) {
      button.classList.add("is-outside");
    }
    if (isSameDay(cellDate, today)) {
      button.classList.add("is-today");
    }
    if (dialogCalendarState.selectedDate && dialogCalendarState.selectedDate === key) {
      button.classList.add("is-selected");
    }

    const label = document.createElement("span");
    label.textContent = String(cellDate.getDate());
    button.appendChild(label);

    button.addEventListener("click", () => {
      setCalendarPickedDate(key);
      if (dom.scheduleDateInput) {
        dom.scheduleDateInput.focus();
      }
    });

    grid.appendChild(button);
  }
}

function shiftScheduleDialogCalendarMonth(offset) {
  if (!offset) return;
  const base = startOfMonth(
    dialogCalendarState.referenceDate instanceof Date ? dialogCalendarState.referenceDate : new Date()
  );
  base.setMonth(base.getMonth() + offset);
  dialogCalendarState.referenceDate = base;
  renderScheduleDialogCalendar();
}

function prepareScheduleDialogCalendar(initialValue) {
  const normalized = normalizeDateInputValue(initialValue);
  if (normalized) {
    const parsed = parseDateOnly(normalized);
    if (parsed) {
      dialogCalendarState.referenceDate = startOfMonth(parsed);
    }
  } else {
    dialogCalendarState.referenceDate = startOfMonth(new Date());
  }
  dialogCalendarState.selectedDate = normalized;
  renderScheduleDialogCalendar();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long"
});

function formatMonthTitle(date) {
  return monthFormatter.format(date);
}

function getSchedulePrimaryDate(schedule) {
  if (!schedule) return null;
  const start = parseDateTimeLocal(schedule.startAt || "");
  if (start) return start;
  const dateOnly = parseDateOnly(schedule.date || "");
  if (dateOnly) return dateOnly;
  const end = parseDateTimeLocal(schedule.endAt || "");
  return end || null;
}

function describeScheduleRange(schedule) {
  if (!schedule) return "";
  const start = parseDateTimeLocal(schedule.startAt || "");
  const end = parseDateTimeLocal(schedule.endAt || "");
  const baseDate = String(schedule.date || "").trim();
  if (start && end) {
    const startDate = formatDatePart(start);
    const endDate = formatDatePart(end);
    const startText = `${startDate} ${formatTimePart(start)}`;
    const endTimeText = formatTimePart(end);
    const endText = startDate === endDate ? endTimeText : `${endDate} ${endTimeText}`;
    return `${startText}〜${endText}`;
  }
  if (start) {
    return `${formatDatePart(start)} ${formatTimePart(start)}〜`;
  }
  if (end) {
    return `${formatDatePart(end)} ${formatTimePart(end)}まで`;
  }
  if (baseDate) {
    return `日程: ${baseDate}`;
  }
  return "";
}

function syncScheduleEndMin() {
  if (!dom.scheduleStartTimeInput || !dom.scheduleEndTimeInput) return;
  dom.scheduleEndTimeInput.removeAttribute("min");
}

export {
  formatDatePart,
  formatTimePart,
  parseDateOnly,
  normalizeDateInputValue,
  formatDateTimeLocal,
  combineDateAndTime,
  setCalendarPickedDate,
  setDialogCalendarPickedDate,
  renderScheduleDialogCalendar,
  shiftScheduleDialogCalendarMonth,
  prepareScheduleDialogCalendar,
  startOfDay,
  startOfMonth,
  isSameDay,
  formatMonthTitle,
  getSchedulePrimaryDate,
  describeScheduleRange,
  syncScheduleEndMin,
  MS_PER_DAY
};
