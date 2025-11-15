// schedule-calendar.js: オペレーター向け日程ダイアログに表示するカレンダーUIの制御を担当します。
import { ensureString } from "./helpers.js";

const calendarState = {
  pickedDate: ""
};

const dialogCalendarState = {
  referenceDate: startOfMonth(new Date()),
  selectedDate: ""
};

function formatDatePart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateOnly(value) {
  const raw = ensureString(value).trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.length <= 10 ? `${raw}T00:00` : raw;
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

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long"
});

function formatMonthTitle(date) {
  return monthFormatter.format(date);
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

function createScheduleDialogCalendarController(dom) {
  function renderScheduleDialogCalendar() {
    const grid = dom.scheduleDialogCalendarGrid;
    const title = dom.scheduleDialogCalendarTitle;
    if (!grid || !title) {
      return;
    }

    const referenceMonth = startOfMonth(
      dialogCalendarState.referenceDate instanceof Date
        ? dialogCalendarState.referenceDate
        : new Date()
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

  function setCalendarPickedDate(value, { updateInput = true } = {}) {
    const normalized = normalizeDateInputValue(value);
    calendarState.pickedDate = normalized;
    dialogCalendarState.selectedDate = normalized;
    if (normalized) {
      const parsed = parseDateOnly(normalized);
      if (parsed) {
        dialogCalendarState.referenceDate = startOfMonth(parsed);
      }
    } else {
      dialogCalendarState.referenceDate = startOfMonth(new Date());
    }
    if (updateInput && dom.scheduleDateInput) {
      dom.scheduleDateInput.value = normalized;
    }
    renderScheduleDialogCalendar();
  }

  function shiftScheduleDialogCalendarMonth(offset) {
    if (!offset) {
      return;
    }
    const base = startOfMonth(
      dialogCalendarState.referenceDate instanceof Date
        ? dialogCalendarState.referenceDate
        : new Date()
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

  function syncScheduleEndMin() {
    if (!dom.scheduleStartInput || !dom.scheduleEndInput) {
      return;
    }
    const startValue = ensureString(dom.scheduleStartInput.value).trim();
    if (startValue) {
      dom.scheduleEndInput.min = startValue;
    } else {
      dom.scheduleEndInput.removeAttribute("min");
    }
  }

  if (dom.scheduleDateInput) {
    dom.scheduleDateInput.addEventListener("input", () => {
      setCalendarPickedDate(dom.scheduleDateInput.value, { updateInput: false });
    });
  }

  if (dom.scheduleDialogCalendarPrev) {
    dom.scheduleDialogCalendarPrev.addEventListener("click", () => {
      shiftScheduleDialogCalendarMonth(-1);
    });
  }

  if (dom.scheduleDialogCalendarNext) {
    dom.scheduleDialogCalendarNext.addEventListener("click", () => {
      shiftScheduleDialogCalendarMonth(1);
    });
  }

  if (dom.scheduleStartInput) {
    dom.scheduleStartInput.addEventListener("input", () => {
      syncScheduleEndMin();
    });
  }

  return {
    calendarState,
    dialogCalendarState,
    setCalendarPickedDate,
    prepareScheduleDialogCalendar,
    shiftScheduleDialogCalendarMonth,
    syncScheduleEndMin,
    normalizeDateInputValue
  };
}

export {
  calendarState,
  dialogCalendarState,
  normalizeDateInputValue,
  createScheduleDialogCalendarController
};
