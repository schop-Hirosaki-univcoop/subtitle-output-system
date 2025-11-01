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
  academicFields: document.getElementById("gl-academic-fields"),
  academicSelectTemplate: document.getElementById("gl-academic-select-template"),
  academicCustomField: document.getElementById("gl-academic-custom-field"),
  academicCustomLabel: document.getElementById("gl-academic-custom-label"),
  academicCustomInput: document.getElementById("gl-academic-custom"),
  emailInput: document.getElementById("gl-email"),
  clubInput: document.getElementById("gl-club"),
  studentIdInput: document.getElementById("gl-student-id"),
  noteInput: document.getElementById("gl-note"),
  shiftList: document.getElementById("gl-shift-list"),
  shiftFieldset: document.getElementById("gl-shift-fieldset"),
  submitButton: document.getElementById("gl-submit-button"),
  feedback: document.getElementById("gl-form-feedback"),
  formMeta: document.getElementById("gl-form-meta"),
  eventIdInput: document.getElementById("gl-event-id"),
  slugInput: document.getElementById("gl-slug"),
  privacyConsent: document.getElementById("gl-privacy-consent")
};

const state = {
  eventId: "",
  slug: "",
  eventName: "",
  faculties: [],
  schedules: [],
  unitSelections: [],
  currentCustomLabel: ""
};

const CUSTOM_OPTION_VALUE = "__custom";
const unitLevelMap = new WeakMap();

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
  otherOption.value = CUSTOM_OPTION_VALUE;
  otherOption.textContent = "その他";
  select.append(otherOption);
  if (faculties.some((entry) => ensureString(entry.faculty) === current)) {
    select.value = current;
  }
}

function createUnitTreeFromArray(list, label) {
  if (!Array.isArray(list)) return null;
  const values = list.map(ensureString).filter(Boolean);
  if (!values.length) return null;
  const normalizedLabel = ensureString(label) || "学科";
  return {
    label: normalizedLabel,
    placeholder: `${normalizedLabel}を選択してください`,
    allowCustom: true,
    options: values.map((value) => ({
      value,
      label: value,
      children: null
    }))
  };
}

function parseUnitOption(raw, fallbackValue) {
  if (typeof raw === "string" || typeof raw === "number") {
    const value = ensureString(raw);
    if (!value) return null;
    return { value, label: value, children: null };
  }
  if (!raw || typeof raw !== "object") return null;
  const value = ensureString(raw.value ?? raw.id ?? raw.code ?? fallbackValue ?? raw.label ?? raw.name ?? "");
  const label = ensureString(raw.label ?? raw.name ?? value);
  if (!value && !label) return null;
  const childLabel = ensureString(raw.childLabel ?? raw.nextLabel ?? "");
  const childSource = raw.children ?? raw.next ?? raw.units ?? null;
  let children = null;
  if (childSource) {
    children = parseUnitLevel(childSource, childLabel || undefined);
  }
  return {
    value: value || label,
    label: label || value,
    children
  };
}

function parseUnitLevel(raw, fallbackLabel) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const options = raw
      .map((item, index) => parseUnitOption(item, String(index)))
      .filter(Boolean);
    if (!options.length) return null;
    const label = ensureString(fallbackLabel) || "所属";
    return {
      label,
      placeholder: `${label}を選択してください`,
      allowCustom: true,
      options
    };
  }
  if (typeof raw !== "object") return null;
  const label =
    ensureString(raw.label ?? raw.name ?? raw.title ?? raw.type ?? fallbackLabel) || "学科";
  const placeholder =
    ensureString(raw.placeholder ?? raw.hint ?? "") || `${label}を選択してください`;
  const allowCustom = raw.allowCustom !== false;
  const source =
    raw.options ??
    raw.values ??
    raw.items ??
    raw.list ??
    raw.departments ??
    raw.choices ??
    null;
  let options = [];
  if (Array.isArray(source)) {
    options = source.map((item, index) => parseUnitOption(item, String(index))).filter(Boolean);
  } else if (source && typeof source === "object") {
    options = Object.entries(source)
      .map(([key, item]) => parseUnitOption(item, key))
      .filter(Boolean);
  }
  if (!options.length && Array.isArray(raw.children)) {
    options = raw.children.map((item, index) => parseUnitOption(item, String(index))).filter(Boolean);
  }
  if (!options.length) return null;
  return {
    label,
    placeholder,
    allowCustom,
    options
  };
}

function clearAcademicFields() {
  if (elements.academicFields) {
    elements.academicFields.innerHTML = "";
  }
  state.unitSelections = [];
  updateAcademicCustomField();
}

function removeAcademicFieldsAfter(depth) {
  if (!elements.academicFields) return;
  const fields = Array.from(elements.academicFields.querySelectorAll(".gl-academic-field"));
  fields.forEach((field) => {
    const fieldDepth = Number(field.dataset.depth ?? "0");
    if (fieldDepth > depth) {
      field.remove();
    }
  });
  state.unitSelections = state.unitSelections.filter((_, index) => index <= depth);
}

function updateAcademicCustomField(label) {
  if (!elements.academicCustomField) return;
  if (label) {
    state.currentCustomLabel = label;
    elements.academicCustomField.hidden = false;
    if (elements.academicCustomLabel) {
      elements.academicCustomLabel.textContent = `${label}（その他入力）`;
    }
    if (elements.academicCustomInput) {
      elements.academicCustomInput.placeholder = `${label}名を入力してください`;
      elements.academicCustomInput.setAttribute("required", "true");
    }
  } else {
    state.currentCustomLabel = "";
    elements.academicCustomField.hidden = true;
    if (elements.academicCustomInput) {
      elements.academicCustomInput.value = "";
      elements.academicCustomInput.placeholder = "所属名を入力してください";
      elements.academicCustomInput.removeAttribute("required");
    }
  }
}

function renderAcademicLevel(level, depth) {
  if (!elements.academicFields || !elements.academicSelectTemplate) return;
  const fragment = elements.academicSelectTemplate.content.cloneNode(true);
  const field = fragment.querySelector(".gl-academic-field");
  const labelEl = field?.querySelector(".gl-academic-label");
  const select = field?.querySelector(".gl-academic-select");
  if (!(field instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) return;
  field.dataset.depth = String(depth);
  const selectId = `gl-academic-select-${depth}`;
  select.id = selectId;
  select.dataset.depth = String(depth);
  select.dataset.levelLabel = level.label;
  if (labelEl instanceof HTMLLabelElement) {
    labelEl.setAttribute("for", selectId);
    labelEl.textContent = level.label;
  }
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.dataset.placeholder = "true";
  placeholder.textContent = level.placeholder || `${level.label}を選択してください`;
  select.append(placeholder);
  level.options.forEach((option, index) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    opt.dataset.optionIndex = String(index);
    if (option.children) {
      opt.dataset.hasChildren = "true";
    }
    select.append(opt);
  });
  if (level.allowCustom !== false) {
    const customOption = document.createElement("option");
    customOption.value = CUSTOM_OPTION_VALUE;
    customOption.textContent = "その他";
    customOption.dataset.isCustom = "true";
    select.append(customOption);
  }
  unitLevelMap.set(select, level);
  select.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) {
      handleAcademicLevelChange(event.target);
    }
  });
  elements.academicFields.append(field);
}

function handleAcademicLevelChange(select) {
  const depth = Number(select.dataset.depth ?? "0");
  removeAcademicFieldsAfter(depth);
  const level = unitLevelMap.get(select);
  const value = ensureString(select.value);
  if (!level || !value) {
    updateAcademicCustomField();
    return;
  }
  if (value === CUSTOM_OPTION_VALUE) {
    state.unitSelections[depth] = { label: level.label, value: "", isCustom: true };
    updateAcademicCustomField(level.label);
    return;
  }
  const selectedOption = select.selectedOptions[0];
  const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
  const option = optionIndex >= 0 ? level.options[optionIndex] : null;
  const displayLabel = ensureString(option?.label ?? selectedOption?.textContent ?? value);
  state.unitSelections[depth] = {
    label: level.label,
    value,
    displayLabel,
    isCustom: false
  };
  updateAcademicCustomField();
  if (option?.children) {
    renderAcademicLevel(option.children, depth + 1);
  }
}

function renderAcademicTreeForFaculty(facultyName) {
  clearAcademicFields();
  const name = ensureString(facultyName);
  if (!name || name === CUSTOM_OPTION_VALUE) {
    return;
  }
  const entry = state.faculties.find((item) => ensureString(item.faculty) === name);
  if (entry?.unitTree) {
    renderAcademicLevel(entry.unitTree, 0);
  } else if (entry?.fallbackLabel) {
    updateAcademicCustomField(entry.fallbackLabel);
  } else {
    updateAcademicCustomField("所属");
  }
  return rawDateText;
}

function collectAcademicPathState() {
  const selects = Array.from(elements.academicFields?.querySelectorAll(".gl-academic-select") ?? []);
  const path = [];
  let requiresCustom = false;
  let customLabel = "";
  let firstSelect = null;
  let pendingSelect = null;
  selects.forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) return;
    if (!firstSelect) {
      firstSelect = select;
    }
    const level = unitLevelMap.get(select);
    const levelLabel = level?.label ?? "";
    const value = ensureString(select.value);
    if (!value && !pendingSelect) {
      pendingSelect = select;
    }
    if (!value) return;
    if (value === CUSTOM_OPTION_VALUE) {
      requiresCustom = true;
      customLabel = levelLabel || customLabel;
      path.push({
        label: levelLabel,
        value: ensureString(elements.academicCustomInput?.value),
        isCustom: true,
        element: elements.academicCustomInput ?? null
      });
      return;
    }
    const selectedOption = select.selectedOptions[0];
    const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
    const option = optionIndex >= 0 && level ? level.options[optionIndex] : null;
    const storedValue = option ? option.value : value;
    path.push({
      label: levelLabel,
      value: storedValue,
      displayLabel: option ? option.label : ensureString(selectedOption?.textContent ?? storedValue),
      isCustom: false,
      element: select
    });
  });
  if (!selects.length && state.currentCustomLabel) {
    requiresCustom = true;
    customLabel = state.currentCustomLabel;
    path.push({
      label: state.currentCustomLabel,
      value: ensureString(elements.academicCustomInput?.value),
      isCustom: true,
      element: elements.academicCustomInput ?? null
    });
  }
  const customValue = ensureString(elements.academicCustomInput?.value);
  return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
}

function collectAcademicPathState() {
  const selects = Array.from(elements.academicFields?.querySelectorAll(".gl-academic-select") ?? []);
  const path = [];
  let requiresCustom = false;
  let customLabel = "";
  let firstSelect = null;
  let pendingSelect = null;
  selects.forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) return;
    if (!firstSelect) {
      firstSelect = select;
    }
    const level = unitLevelMap.get(select);
    const levelLabel = level?.label ?? "";
    const value = ensureString(select.value);
    if (!value && !pendingSelect) {
      pendingSelect = select;
    }
    if (!value) return;
    if (value === CUSTOM_OPTION_VALUE) {
      requiresCustom = true;
      customLabel = levelLabel || customLabel;
      path.push({
        label: levelLabel,
        value: ensureString(elements.academicCustomInput?.value),
        isCustom: true,
        element: elements.academicCustomInput ?? null
      });
      return;
    }
    const selectedOption = select.selectedOptions[0];
    const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
    const option = optionIndex >= 0 && level ? level.options[optionIndex] : null;
    const storedValue = option ? option.value : value;
    path.push({
      label: levelLabel,
      value: storedValue,
      displayLabel: option ? option.label : ensureString(selectedOption?.textContent ?? storedValue),
      isCustom: false,
      element: select
    });
  });
  if (!selects.length && state.currentCustomLabel) {
    requiresCustom = true;
    customLabel = state.currentCustomLabel;
    path.push({
      label: state.currentCustomLabel,
      value: ensureString(elements.academicCustomInput?.value),
      isCustom: true,
      element: elements.academicCustomInput ?? null
    });
  }
  const customValue = ensureString(elements.academicCustomInput?.value);
  return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
}

const shiftDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short"
});

const scheduleTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit"
});

function formatScheduleRange(startAt, endAt, fallbackDate) {
  const hasStartTime = Number.isFinite(startAt) && startAt > 0;
  const hasEndTime = Number.isFinite(endAt) && endAt > 0;
  if (hasStartTime && hasEndTime) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const startDateText = shiftDateFormatter.format(start);
    const endDateText = shiftDateFormatter.format(end);
    const startTimeText = scheduleTimeFormatter.format(start);
    const endTimeText = scheduleTimeFormatter.format(end);
    if (startDateText === endDateText) {
      return `${startDateText} ${startTimeText}〜${endTimeText}`;
    }
    return `${startDateText} ${startTimeText} 〜 ${endDateText} ${endTimeText}`;
  }
  if (hasStartTime) {
    const start = new Date(startAt);
    return `${shiftDateFormatter.format(start)} ${scheduleTimeFormatter.format(start)}`;
  }
  if (hasEndTime) {
    const end = new Date(endAt);
    return `${shiftDateFormatter.format(end)} ${scheduleTimeFormatter.format(end)}`;
  }
  const rawDateText = ensureString(fallbackDate);
  if (!rawDateText) {
    return "";
  }
  const parsed = Date.parse(rawDateText);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return `${shiftDateFormatter.format(date)} ${scheduleTimeFormatter.format(date)}`;
  }
  return rawDateText;
}

function formatScheduleOption(schedule) {
  const fallbackDate = ensureString(schedule.date);
  const rangeText = ensureString(formatScheduleRange(schedule.startAt, schedule.endAt, fallbackDate));
  const labelText = ensureString(schedule.label);
  if (rangeText && labelText && !rangeText.includes(labelText)) {
    return `${rangeText}（${labelText}）`;
  }
  return rangeText || labelText || ensureString(schedule.id);
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
    const title = formatScheduleOption(schedule);
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
    .map((entry) => {
      if (typeof entry === "string" || typeof entry === "number") {
        const facultyName = ensureString(entry);
        if (!facultyName) return null;
        return {
          faculty: facultyName,
          unitTree: null,
          fallbackLabel: "学科"
        };
      }
      const faculty = ensureString(entry?.faculty ?? entry?.name ?? "");
      if (!faculty) return null;
      const unitLabel = ensureString(entry?.departmentLabel ?? entry?.unitLabel ?? "");
      const hierarchySource = entry?.units ?? entry?.unitTree ?? entry?.hierarchy ?? null;
      let unitTree = parseUnitLevel(hierarchySource, unitLabel || "学科");
      if (!unitTree) {
        const departments = Array.isArray(entry?.departments)
          ? entry.departments.map(ensureString).filter(Boolean)
          : [];
        unitTree = createUnitTreeFromArray(departments, unitLabel || "学科");
      }
      const fallbackLabel = unitLabel || unitTree?.label || "学科";
      return {
        faculty,
        unitTree,
        fallbackLabel
      };
    })
    .filter(Boolean);
}

function parseSchedules(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((schedule) => ({
        id: ensureString(schedule?.id),
        label: ensureString(schedule?.label || schedule?.date || schedule?.id),
        date: ensureString(schedule?.date),
        startAt: parseTimestamp(schedule?.startAt),
        endAt: parseTimestamp(schedule?.endAt)
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
          date: ensureString(schedule?.date || schedule?.startAt || ""),
          startAt: parseTimestamp(schedule?.startAt),
          endAt: parseTimestamp(schedule?.endAt)
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
  renderAcademicTreeForFaculty(elements.facultySelect ? elements.facultySelect.value : "");
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
  if (!facultyValue || facultyValue === CUSTOM_OPTION_VALUE) {
    elements.feedback.textContent = "学部を選択してください。";
    elements.feedback.dataset.variant = "error";
    elements.facultySelect?.focus();
    return;
  }
  const academic = collectAcademicPathState();
  if (academic.pendingSelect instanceof HTMLSelectElement) {
    const label = ensureString(academic.pendingSelect.dataset.levelLabel) || "所属";
    elements.feedback.textContent = `${label}を選択してください。`;
    elements.feedback.dataset.variant = "error";
    academic.pendingSelect.focus();
    return;
  }
  if (!academic.path.length) {
    const label = state.currentCustomLabel || "所属情報";
    elements.feedback.textContent = `${label}を選択してください。`;
    elements.feedback.dataset.variant = "error";
    if (academic.firstSelect instanceof HTMLSelectElement) {
      academic.firstSelect.focus();
    } else if (elements.academicCustomInput) {
      elements.academicCustomInput.focus();
    }
    return;
  }
  if (academic.requiresCustom && !academic.customValue) {
    const label = academic.customLabel || state.currentCustomLabel || "所属";
    elements.feedback.textContent = `${label}を入力してください。`;
    elements.feedback.dataset.variant = "error";
    elements.academicCustomInput?.focus();
    return;
  }
  const departmentSegment = academic.path[academic.path.length - 1];
  const department = ensureString(departmentSegment?.value);
  if (!department) {
    const label = ensureString(departmentSegment?.label) || "所属";
    elements.feedback.textContent = `${label}を入力してください。`;
    elements.feedback.dataset.variant = "error";
    if (departmentSegment?.element instanceof HTMLElement) {
      departmentSegment.element.focus();
    } else {
      elements.academicCustomInput?.focus();
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
  if (elements.privacyConsent && !elements.privacyConsent.checked) {
    elements.feedback.textContent = "個人情報の取扱いについて同意してください。";
    elements.feedback.dataset.variant = "error";
    elements.privacyConsent.focus();
    return;
  }
  const academicPath = academic.path
    .map((segment) => ({
      label: ensureString(segment.label),
      value: ensureString(segment.value),
      display: ensureString(segment.displayLabel ?? segment.value),
      isCustom: Boolean(segment.isCustom)
    }))
    .filter((segment) => segment.value);
  const payload = {
    name: ensureString(elements.nameInput?.value),
    phonetic: ensureString(elements.phoneticInput?.value),
    grade: ensureString(elements.gradeInput?.value),
    faculty: facultyValue,
    department,
    academicPath,
    email: ensureString(elements.emailInput?.value),
    club: ensureString(elements.clubInput?.value),
    studentId: ensureString(elements.studentIdInput?.value),
    note: ensureString(elements.noteInput?.value),
    shifts,
    eventId: state.eventId,
    eventName: state.eventName,
    slug: state.slug,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (elements.privacyConsent) {
    payload.privacyConsent = true;
  }
  if (!payload.note) {
    delete payload.note;
  }
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
      renderAcademicTreeForFaculty(elements.facultySelect ? elements.facultySelect.value : "");
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
    renderAcademicTreeForFaculty(value);
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
