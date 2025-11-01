import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  push,
  set,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { FIREBASE_CONFIG } from "../shared/firebase-config.js";

const apps = getApps();
const firebaseApp = apps.length ? getApp() : initializeApp(FIREBASE_CONFIG);
const database = getDatabase(firebaseApp);

const elements = {
  form: document.getElementById("gl-entry-form"),
  contextBanner: document.getElementById("gl-context-banner"),
  contextEvent: document.getElementById("gl-context-event"),
  contextPeriod: document.getElementById("gl-context-period"),
  contextGuard: document.getElementById("gl-context-guard"),
  nameInput: document.getElementById("gl-name"),
  phoneticInput: document.getElementById("gl-phonetic"),
  gradeInput: document.getElementById("gl-grade"),
  facultySelect: document.getElementById("gl-faculty"),
  departmentSelect: document.getElementById("gl-department"),
  departmentCustomField: document.getElementById("gl-department-custom-field"),
  departmentCustomInput: document.getElementById("gl-department-custom"),
  emailInput: document.getElementById("gl-email"),
  clubInput: document.getElementById("gl-club"),
  studentIdInput: document.getElementById("gl-student-id"),
  shiftList: document.getElementById("gl-shift-list"),
  shiftFieldset: document.getElementById("gl-shift-fieldset"),
  submitButton: document.getElementById("gl-submit-button"),
  feedback: document.getElementById("gl-form-feedback"),
  formMeta: document.getElementById("gl-form-meta"),
  eventIdInput: document.getElementById("gl-event-id"),
  slugInput: document.getElementById("gl-slug")
};

const state = {
  eventId: "",
  slug: "",
  eventName: "",
  faculties: [],
  schedules: []
};

function ensureString(value) {
  return String(value ?? "").trim();
}

function parseTimestamp(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

function formatPeriod(startAt, endAt) {
  if (!startAt && !endAt) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  if (startAt && endAt) {
    return `${formatter.format(new Date(startAt))} 〜 ${formatter.format(new Date(endAt))}`;
  }
  if (startAt) {
    return `${formatter.format(new Date(startAt))} から募集開始`;
  }
  return `${formatter.format(new Date(endAt))} まで募集`;
}

function showGuard(message) {
  if (elements.contextGuard) {
    elements.contextGuard.textContent = message;
    elements.contextGuard.hidden = false;
  }
  if (elements.form) {
    elements.form.hidden = true;
  }
  if (elements.contextBanner) {
    elements.contextBanner.hidden = true;
  }
}

function hideGuard() {
  if (elements.contextGuard) {
    elements.contextGuard.hidden = true;
    elements.contextGuard.textContent = "";
  }
}

function renderFaculties(faculties) {
  if (!elements.facultySelect) return;
  const select = elements.facultySelect;
  const current = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "学部を選択してください";
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.dataset.placeholder = "true";
  select.append(placeholder);
  faculties.forEach((entry) => {
    const faculty = ensureString(entry.faculty);
    if (!faculty) return;
    const option = document.createElement("option");
    option.value = faculty;
    option.textContent = faculty;
    select.append(option);
  });
  const otherOption = document.createElement("option");
  otherOption.value = "__custom";
  otherOption.textContent = "その他";
  select.append(otherOption);
  if (faculties.some((entry) => ensureString(entry.faculty) === current)) {
    select.value = current;
  }
}

function renderDepartments(facultyName) {
  if (!elements.departmentSelect) return;
  const select = elements.departmentSelect;
  const previous = select.value;
  const previousLower = ensureString(previous).toLocaleLowerCase("ja-JP");
  const previousWasCustom = previous === "__custom";
  const previousCustomValue = ensureString(elements.departmentCustomInput?.value);
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "学科を選択してください";
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.dataset.placeholder = "true";
  select.append(placeholder);
  let departments = [];
  if (facultyName && facultyName !== "__custom") {
    const entry = state.faculties.find((item) => ensureString(item.faculty) === facultyName);
    departments = entry && Array.isArray(entry.departments) ? entry.departments.map(ensureString).filter(Boolean) : [];
  }
  const normalizedDepartments = departments.map((department) => ({
    label: department,
    key: department.toLocaleLowerCase("ja-JP")
  }));
  normalizedDepartments.forEach(({ label }) => {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    select.append(option);
  });
  const otherOption = document.createElement("option");
  otherOption.value = "__custom";
  otherOption.textContent = "その他";
  select.append(otherOption);
  const matched = normalizedDepartments.find((entry) => entry.key === previousLower);
  if (matched) {
    select.value = matched.label;
  } else if (previousWasCustom) {
    select.value = "__custom";
  }
  toggleDepartmentCustom(select.value === "__custom");
  if (select.value === "__custom" && elements.departmentCustomInput) {
    elements.departmentCustomInput.value = previousCustomValue;
  }
}

function toggleDepartmentCustom(visible) {
  if (!elements.departmentCustomField) return;
  elements.departmentCustomField.hidden = !visible;
  if (!visible && elements.departmentCustomInput) {
    elements.departmentCustomInput.value = "";
  }
}

function renderShifts(schedules) {
  if (!elements.shiftList) return;
  elements.shiftList.innerHTML = "";
  if (!Array.isArray(schedules) || !schedules.length) {
    const note = document.createElement("p");
    note.className = "form-meta-line";
    note.textContent = "現在登録されている日程はありません。";
    elements.shiftList.append(note);
    if (elements.shiftFieldset) {
      elements.shiftFieldset.hidden = true;
    }
    return;
  }
  if (elements.shiftFieldset) {
    elements.shiftFieldset.hidden = false;
  }
  schedules.forEach((schedule) => {
    const wrapper = document.createElement("label");
    wrapper.className = "gl-shift-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = schedule.id;
    checkbox.dataset.scheduleId = schedule.id;
    checkbox.name = `shift-${schedule.id}`;
    const title = schedule.label || schedule.date || schedule.id;
    const span = document.createElement("span");
    span.textContent = title;
    wrapper.append(checkbox, span);
    elements.shiftList.append(wrapper);
  });
}

function parseFaculties(raw) {
  if (!raw || typeof raw !== "object") return [];
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  return entries
    .map((entry) => ({
      faculty: ensureString(entry?.faculty ?? entry?.name ?? ""),
      departments: Array.isArray(entry?.departments)
        ? entry.departments.map(ensureString).filter(Boolean)
        : []
    }))
    .filter((entry) => entry.faculty);
}

function parseSchedules(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((schedule) => ({
        id: ensureString(schedule?.id),
        label: ensureString(schedule?.label || schedule?.date || schedule?.id),
        date: ensureString(schedule?.date)
      }))
      .filter((entry) => entry.id);
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([id, schedule]) => {
        const scheduleId = ensureString(schedule?.id) || ensureString(id);
        return {
          id: scheduleId,
          label: ensureString(schedule?.label || schedule?.date || scheduleId || id),
          date: ensureString(schedule?.date || schedule?.startAt || "")
        };
      })
      .filter((entry) => entry.id);
  }
  return [];
}

function populateContext(eventName, periodText) {
  if (!elements.contextBanner) return;
  elements.contextBanner.hidden = false;
  if (elements.contextEvent) {
    elements.contextEvent.textContent = eventName ? `対象イベント: ${eventName}` : "";
  }
  if (elements.contextPeriod) {
    if (periodText) {
      elements.contextPeriod.textContent = `募集期間: ${periodText}`;
      elements.contextPeriod.hidden = false;
    } else {
      elements.contextPeriod.hidden = true;
      elements.contextPeriod.textContent = "";
    }
  }
}

async function prepareForm() {
  hideGuard();
  const params = new URLSearchParams(window.location.search || "");
  const slug = ensureString(params.get("evt"));
  if (!slug) {
    showGuard("このフォームは専用URLからアクセスしてください。");
    return;
  }
  state.slug = slug;
  if (elements.slugInput) {
    elements.slugInput.value = slug;
  }
  const slugRef = ref(database, `glIntake/slugIndex/${slug}`);
  const slugSnap = await get(slugRef);
  if (!slugSnap.exists()) {
    showGuard("募集が終了したか、URLが無効です。運営までお問い合わせください。");
    return;
  }
  const eventId = ensureString(slugSnap.val());
  if (!eventId) {
    showGuard("イベント情報を特定できませんでした。運営までお問い合わせください。");
    return;
  }
  state.eventId = eventId;
  if (elements.eventIdInput) {
    elements.eventIdInput.value = eventId;
  }
  const configRef = ref(database, `glIntake/events/${eventId}`);
  const configSnap = await get(configRef);
  const config = configSnap.val() || {};
  const now = Date.now();
  const startAt = parseTimestamp(config.startAt);
  const endAt = parseTimestamp(config.endAt);
  if (startAt && now < startAt) {
    showGuard("まだ募集開始前です。募集開始までお待ちください。");
    return;
  }
  if (endAt && now > endAt) {
    showGuard("募集期間が終了しました。運営までお問い合わせください。");
    return;
  }
  state.faculties = parseFaculties(config.faculties || []);
  const scheduleSources = [config.schedules, config.scheduleSummary, config.scheduleOptions];
  let parsedSchedules = [];
  for (const source of scheduleSources) {
    parsedSchedules = parseSchedules(source);
    if (parsedSchedules.length) {
      break;
    }
  }
  state.schedules = parsedSchedules;
  const eventName = ensureString(config.eventName || eventId);
  state.eventName = eventName;
  const periodText = formatPeriod(startAt, endAt);
  populateContext(eventName, periodText);
  renderFaculties(state.faculties);
  renderDepartments(elements.facultySelect ? elements.facultySelect.value : "");
  renderShifts(state.schedules);
  if (elements.form) {
    elements.form.hidden = false;
  }
  if (elements.formMeta) {
    elements.formMeta.hidden = true;
  }
}

function collectShifts() {
  const result = {};
  state.schedules.forEach((schedule) => {
    const checkbox = elements.shiftList?.querySelector(`input[data-schedule-id="${CSS.escape(schedule.id)}"]`);
    result[schedule.id] = checkbox ? checkbox.checked : false;
  });
  return result;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!state.eventId) {
    showGuard("イベント情報が取得できませんでした。運営までお問い合わせください。");
    return;
  }
  const facultyValue = ensureString(elements.facultySelect?.value);
  const departmentValue = ensureString(elements.departmentSelect?.value);
  const customDepartment = ensureString(elements.departmentCustomInput?.value);
  const department = departmentValue === "__custom" ? customDepartment : departmentValue;
  if (!facultyValue || facultyValue === "__custom") {
    elements.feedback.textContent = "学部を選択してください。";
    elements.feedback.dataset.variant = "error";
    elements.facultySelect?.focus();
    return;
  }
  if (!department) {
    elements.feedback.textContent = "学科を入力または選択してください。";
    elements.feedback.dataset.variant = "error";
    if (departmentValue === "__custom") {
      elements.departmentCustomInput?.focus();
    } else {
      elements.departmentSelect?.focus();
    }
    return;
  }
  const shifts = collectShifts();
  if (state.schedules.length && !Object.values(shifts).some(Boolean)) {
    elements.feedback.textContent = "参加可能な日程にチェックを入れてください。";
    elements.feedback.dataset.variant = "error";
    const firstCheckbox = elements.shiftList?.querySelector("input[type=checkbox]");
    if (firstCheckbox instanceof HTMLInputElement) {
      firstCheckbox.focus();
    }
    return;
  }
  const payload = {
    name: ensureString(elements.nameInput?.value),
    phonetic: ensureString(elements.phoneticInput?.value),
    grade: ensureString(elements.gradeInput?.value),
    faculty: facultyValue,
    department,
    email: ensureString(elements.emailInput?.value),
    club: ensureString(elements.clubInput?.value),
    studentId: ensureString(elements.studentIdInput?.value),
    shifts,
    eventId: state.eventId,
    eventName: state.eventName,
    slug: state.slug,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (!payload.name) {
    elements.feedback.textContent = "氏名を入力してください。";
    elements.feedback.dataset.variant = "error";
    elements.nameInput?.focus();
    return;
  }
  if (!payload.email) {
    elements.feedback.textContent = "メールアドレスを入力してください。";
    elements.feedback.dataset.variant = "error";
    elements.emailInput?.focus();
    return;
  }
  elements.feedback.textContent = "送信しています…";
  elements.feedback.dataset.variant = "progress";
  elements.submitButton?.setAttribute("disabled", "true");
  try {
    const applicationsRef = ref(database, `glIntake/applications/${state.eventId}`);
    const recordRef = push(applicationsRef);
    await set(recordRef, payload);
    elements.feedback.textContent = "応募を受け付けました。ご協力ありがとうございます。";
    elements.feedback.dataset.variant = "success";
    if (elements.form) {
      elements.form.reset();
      elements.form.hidden = true;
    }
    if (elements.formMeta) {
      elements.formMeta.hidden = false;
    }
  } catch (error) {
    console.error(error);
    elements.feedback.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
    elements.feedback.dataset.variant = "error";
    elements.submitButton?.removeAttribute("disabled");
  }
}

function bindEvents() {
  elements.facultySelect?.addEventListener("change", (event) => {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
    renderDepartments(value);
  });
  elements.departmentSelect?.addEventListener("change", (event) => {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
    toggleDepartmentCustom(value === "__custom");
  });
  elements.form?.addEventListener("submit", handleSubmit);
}

(async function init() {
  bindEvents();
  try {
    await prepareForm();
  } catch (error) {
    console.error(error);
    showGuard("フォームの初期化に失敗しました。時間をおいて再度お試しください。");
  }
})();
