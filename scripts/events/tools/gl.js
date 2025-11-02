import {
  database,
  ref,
  onValue,
  update,
  set,
  remove,
  serverTimestamp,
  getGlEventConfigRef,
  getGlApplicationsRef,
  getGlAssignmentsRef,
  getGlAssignmentRef,
  getGlFacultyLibraryRef,
  get
} from "../../operator/firebase.js";
import { ensureString, formatDateTimeLocal, logError } from "../helpers.js";

const ASSIGNMENT_VALUE_ABSENT = "__absent";
const ASSIGNMENT_VALUE_STAFF = "__staff";
const DEFAULT_FACULTY_LIBRARY_ID = "default";
const DEFAULT_FACULTY_LIBRARY_NAME = "共通リスト";
const FACULTY_LABEL_FALLBACK = "学科";
const DEFAULT_LEVEL_LABELS = ["学科", "課程", "専攻", "コース"];

function escapeSelector(value) {
  const text = ensureString(value);
  if (!text) {
    return "";
  }
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(text);
  }
  return text.replace(/[^a-zA-Z0-9_\-]/g, (char) => `\\${char}`);
}

function generateLocalId(prefix = "gl") {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getDefaultLevelLabel(depth = 0, fallback = FACULTY_LABEL_FALLBACK) {
  const label = DEFAULT_LEVEL_LABELS[depth];
  return ensureString(label) || ensureString(fallback) || FACULTY_LABEL_FALLBACK;
}

function createEmptyFaculty() {
  return {
    id: generateLocalId("faculty"),
    faculty: "",
    fallbackLabel: FACULTY_LABEL_FALLBACK,
    unitTree: null
  };
}

function createEmptyLevel(label = FACULTY_LABEL_FALLBACK) {
  const normalizedLabel = ensureString(label) || FACULTY_LABEL_FALLBACK;
  return {
    id: generateLocalId("level"),
    label: normalizedLabel,
    placeholder: `${normalizedLabel}を選択してください`,
    allowCustom: true,
    options: []
  };
}

function createEmptyOption(label = "") {
  const normalizedLabel = ensureString(label);
  return {
    id: generateLocalId("option"),
    label: normalizedLabel,
    value: normalizedLabel,
    children: null
  };
}

function normalizeFacultyCollection(raw) {
  if (!raw) {
    return [];
  }
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  return entries
    .map((entry) => normalizeFacultyEntry(entry))
    .filter(Boolean);
}

function normalizeFacultyEntry(raw) {
  if (!raw || (typeof raw !== "object" && typeof raw !== "string" && typeof raw !== "number")) {
    return null;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const facultyName = ensureString(raw);
    if (!facultyName) {
      return null;
    }
    return {
      id: generateLocalId("faculty"),
      faculty: facultyName,
      fallbackLabel: FACULTY_LABEL_FALLBACK,
      unitTree: null
    };
  }
  const facultyName = ensureString(raw.faculty ?? raw.name ?? "");
  if (!facultyName) {
    return null;
  }
  const fallbackLabel =
    ensureString(raw.fallbackLabel ?? raw.departmentLabel ?? raw.unitLabel ?? "") || FACULTY_LABEL_FALLBACK;
  const hierarchySource = raw.unitTree ?? raw.units ?? raw.hierarchy ?? null;
  let unitTree = normalizeUnitLevel(hierarchySource, fallbackLabel);
  if (!unitTree) {
    const departments = Array.isArray(raw.departments) ? raw.departments.map(ensureString).filter(Boolean) : [];
    if (departments.length) {
      const level = createEmptyLevel(fallbackLabel);
      level.options = departments.map((name) => createEmptyOption(name)).filter((option) => option.label);
      unitTree = level.options.length ? level : null;
    }
  }
  return {
    id: generateLocalId("faculty"),
    faculty: facultyName,
    fallbackLabel,
    unitTree
  };
}

function normalizeUnitLevel(raw, fallbackLabel = FACULTY_LABEL_FALLBACK) {
  if (!raw) {
    return null;
  }
  if (Array.isArray(raw)) {
    const level = createEmptyLevel(fallbackLabel);
    level.options = raw.map((item) => normalizeUnitOption(item, fallbackLabel)).filter(Boolean);
    return level.options.length ? level : null;
  }
  if (typeof raw !== "object") {
    return null;
  }
  const label =
    ensureString(raw.label ?? raw.name ?? raw.title ?? raw.type ?? fallbackLabel) || FACULTY_LABEL_FALLBACK;
  const placeholder =
    ensureString(raw.placeholder ?? raw.hint ?? "") || `${label}を選択してください`;
  const allowCustom = raw.allowCustom !== false;
  const source =
    raw.options ?? raw.values ?? raw.items ?? raw.list ?? raw.departments ?? raw.choices ?? raw.children ?? null;
  let options = [];
  if (Array.isArray(source)) {
    options = source.map((item) => normalizeUnitOption(item, label)).filter(Boolean);
  } else if (source && typeof source === "object") {
    options = Object.values(source)
      .map((item) => normalizeUnitOption(item, label))
      .filter(Boolean);
  }
  if (!options.length) {
    return null;
  }
  return {
    id: generateLocalId("level"),
    label,
    placeholder,
    allowCustom,
    options
  };
}

function normalizeUnitOption(raw, parentLabel = FACULTY_LABEL_FALLBACK) {
  if (!raw || (typeof raw !== "object" && typeof raw !== "string" && typeof raw !== "number")) {
    return null;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const label = ensureString(raw);
    if (!label) {
      return null;
    }
    return {
      id: generateLocalId("option"),
      label,
      value: label,
      children: null
    };
  }
  const label = ensureString(raw.label ?? raw.name ?? raw.title ?? raw.value ?? "");
  if (!label) {
    return null;
  }
  const value = ensureString(raw.value ?? raw.id ?? label);
  const childSource = raw.children ?? raw.child ?? raw.next ?? raw.unitTree ?? raw.units ?? null;
  const childLevel = normalizeUnitLevel(childSource, parentLabel);
  return {
    id: generateLocalId("option"),
    label,
    value,
    children: childLevel
  };
}

function stripUnitLevel(level) {
  if (!level) {
    return null;
  }
  const options = Array.isArray(level.options) ? level.options : [];
  return {
    label: ensureString(level.label) || FACULTY_LABEL_FALLBACK,
    placeholder: ensureString(level.placeholder) || `${ensureString(level.label) || FACULTY_LABEL_FALLBACK}を選択してください`,
    allowCustom: level.allowCustom !== false,
    options: options
      .map((option) => stripUnitOption(option))
      .filter(Boolean)
  };
}

function stripUnitOption(option) {
  if (!option) {
    return null;
  }
  const label = ensureString(option.label);
  if (!label) {
    return null;
  }
  const value = ensureString(option.value) || label;
  const payload = {
    label,
    value
  };
  const children = stripUnitLevel(option.children);
  if (children) {
    payload.children = children;
  }
  return payload;
}

function stripFacultyEntry(entry) {
  if (!entry) {
    return null;
  }
  const faculty = ensureString(entry.faculty);
  if (!faculty) {
    return null;
  }
  const payload = {
    faculty,
    fallbackLabel: ensureString(entry.fallbackLabel) || FACULTY_LABEL_FALLBACK
  };
  const unitTree = stripUnitLevel(entry.unitTree);
  if (unitTree) {
    payload.unitTree = unitTree;
  }
  return payload;
}

function cloneFacultyStructure(list = []) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((entry) => {
      const faculty = ensureString(entry?.faculty);
      if (!faculty) {
        return null;
      }
      const clone = {
        faculty,
        fallbackLabel: ensureString(entry?.fallbackLabel) || FACULTY_LABEL_FALLBACK
      };
      if (entry?.unitTree) {
        try {
          clone.unitTree = JSON.parse(JSON.stringify(entry.unitTree));
        } catch (error) {
          clone.unitTree = entry.unitTree;
        }
      }
      return clone;
    })
    .filter(Boolean);
}

class GlFacultyLibraryManager {
  constructor(app) {
    this.app = app;
    this.dom = app.dom;
    this.libraryId = DEFAULT_FACULTY_LIBRARY_ID;
    this.libraryName = DEFAULT_FACULTY_LIBRARY_NAME;
    this.faculties = [];
    this.loading = false;
    this.saving = false;
    this.dirty = false;
    this.listeners = new Set();
    this.unsubscribe = null;
    this.bindDom();
    this.attach();
  }

  bindDom() {
    if (this.dom.glFacultyAddButton) {
      this.dom.glFacultyAddButton.addEventListener("click", () => {
        this.addFaculty();
      });
    }
    if (this.dom.glFacultySaveButton) {
      this.dom.glFacultySaveButton.addEventListener("click", () => {
        this.save().catch((error) => {
          logError("Failed to save faculty library", error);
          this.setStatus("学部リストの保存に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glFacultyList) {
      this.dom.glFacultyList.addEventListener("input", (event) => this.handleInput(event));
      this.dom.glFacultyList.addEventListener("change", (event) => this.handleChange(event));
      this.dom.glFacultyList.addEventListener("click", (event) => this.handleClick(event));
    }
  }

  onChange(listener) {
    if (typeof listener === "function") {
      this.listeners.add(listener);
      listener(this.getSnapshot());
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyChange() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        logError("Failed to notify faculty library listener", error);
      }
    });
  }

  getSnapshot() {
    return {
      id: this.libraryId,
      name: this.libraryName,
      faculties: this.faculties.map((entry) => stripFacultyEntry(entry)).filter(Boolean)
    };
  }

  attach() {
    if (typeof this.unsubscribe === "function") {
      this.unsubscribe();
    }
    this.loading = true;
    this.updateLoadingState();
    this.unsubscribe = onValue(getGlFacultyLibraryRef(this.libraryId), (snapshot) => {
      this.loading = false;
      const value = snapshot.val() || {};
      this.applySnapshot(value);
    });
  }

  applySnapshot(raw) {
    const name = ensureString(raw?.name) || DEFAULT_FACULTY_LIBRARY_NAME;
    const faculties = normalizeFacultyCollection(raw?.faculties);
    this.libraryName = name;
    this.faculties = faculties;
    this.setDirty(false);
    this.render();
    this.notifyChange();
  }

  handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    const field = ensureString(target.dataset.field);
    if (!field) {
      return;
    }
    if (field === "faculty-name" || field === "fallback-label") {
      const facultyId = ensureString(target.closest("[data-faculty-id]")?.dataset.facultyId);
      if (!facultyId) {
        return;
      }
      const faculty = this.faculties.find((entry) => entry.id === facultyId);
      if (!faculty) {
        return;
      }
      if (field === "faculty-name") {
        faculty.faculty = ensureString(target.value);
      } else {
        faculty.fallbackLabel = ensureString(target.value) || FACULTY_LABEL_FALLBACK;
      }
      this.setDirty(true);
      return;
    }
    if (field === "level-label" || field === "level-placeholder") {
      const context = this.findLevelContextFromElement(target);
      if (!context) {
        return;
      }
      if (field === "level-label") {
        context.level.label = ensureString(target.value) || getDefaultLevelLabel(context.depth);
        if (context.depth === 0) {
          context.faculty.fallbackLabel = context.level.label || FACULTY_LABEL_FALLBACK;
        }
      } else {
        context.level.placeholder = ensureString(target.value) || `${context.level.label}を選択してください`;
      }
      this.setDirty(true);
      return;
    }
    if (field === "option-label" || field === "option-value") {
      const context = this.findOptionContextFromElement(target);
      if (!context) {
        return;
      }
      if (field === "option-label") {
        context.option.label = ensureString(target.value);
        if (!ensureString(context.option.value)) {
          context.option.value = context.option.label;
        }
      } else {
        context.option.value = ensureString(target.value);
      }
      this.setDirty(true);
    }
  }

  handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const field = ensureString(target.dataset.field);
    if (field === "level-allow-custom") {
      const context = this.findLevelContextFromElement(target);
      if (!context) {
        return;
      }
      context.level.allowCustom = target.checked;
      this.setDirty(true);
    }
  }

  handleClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = ensureString(target.dataset.action);
    if (!action) {
      return;
    }
    event.preventDefault();
    switch (action) {
      case "add-root-level":
        this.addRootLevel(target);
        break;
      case "remove-faculty":
        this.removeFaculty(target);
        break;
      case "add-option":
        this.addOption(target);
        break;
      case "remove-level":
        this.removeLevel(target);
        break;
      case "remove-option":
        this.removeOption(target);
        break;
      case "add-child-level":
        this.addChildLevel(target);
        break;
      default:
        break;
    }
  }

  addFaculty() {
    const faculty = createEmptyFaculty();
    this.faculties.push(faculty);
    this.render();
    this.setDirty(true);
    this.focusField(`[data-faculty-id="${escapeSelector(faculty.id)}"] [data-field="faculty-name"]`);
  }

  addRootLevel(trigger) {
    const facultyId = ensureString(trigger.closest("[data-faculty-id]")?.dataset.facultyId);
    if (!facultyId) {
      return;
    }
    const faculty = this.faculties.find((entry) => entry.id === facultyId);
    if (!faculty) {
      return;
    }
    const level = createEmptyLevel(getDefaultLevelLabel(0, faculty.fallbackLabel));
    faculty.unitTree = level;
    faculty.fallbackLabel = ensureString(level.label) || FACULTY_LABEL_FALLBACK;
    this.render();
    this.setDirty(true);
    this.focusField(`[data-level-id="${escapeSelector(level.id)}"] [data-field="level-label"]`);
  }

  addOption(trigger) {
    const context = this.findLevelContextFromElement(trigger);
    if (!context) {
      return;
    }
    const option = createEmptyOption();
    option.value = "";
    context.level.options.push(option);
    this.render();
    this.setDirty(true);
    this.focusField(`[data-option-id="${escapeSelector(option.id)}"] [data-field="option-label"]`);
  }

  addChildLevel(trigger) {
    const context = this.findOptionContextFromElement(trigger);
    if (!context) {
      return;
    }
    if (context.option.children) {
      this.focusField(`[data-level-id="${escapeSelector(context.option.children.id)}"] [data-field="level-label"]`);
      return;
    }
    const label = getDefaultLevelLabel(context.depth + 1, context.faculty.fallbackLabel);
    context.option.children = createEmptyLevel(label);
    this.render();
    this.setDirty(true);
    this.focusField(`[data-level-id="${escapeSelector(context.option.children.id)}"] [data-field="level-label"]`);
  }

  removeFaculty(trigger) {
    const facultyId = ensureString(trigger.closest("[data-faculty-id]")?.dataset.facultyId);
    if (!facultyId) {
      return;
    }
    this.faculties = this.faculties.filter((entry) => entry.id !== facultyId);
    this.render();
    this.setDirty(true);
  }

  removeLevel(trigger) {
    const context = this.findLevelContextFromElement(trigger);
    if (!context) {
      return;
    }
    if (context.parentOption) {
      context.parentOption.children = null;
    } else {
      context.faculty.unitTree = null;
    }
    this.render();
    this.setDirty(true);
  }

  removeOption(trigger) {
    const context = this.findOptionContextFromElement(trigger);
    if (!context) {
      return;
    }
    context.level.options = context.level.options.filter((option) => option.id !== context.option.id);
    this.render();
    this.setDirty(true);
  }

  findLevelContextFromElement(element) {
    const facultyId = ensureString(element.closest("[data-faculty-id]")?.dataset.facultyId);
    const levelId = ensureString(element.closest("[data-level-id]")?.dataset.levelId);
    if (!facultyId || !levelId) {
      return null;
    }
    const faculty = this.faculties.find((entry) => entry.id === facultyId);
    if (!faculty) {
      return null;
    }
    const search = this.findLevelRecursive(faculty.unitTree, levelId, 0);
    if (!search) {
      return null;
    }
    return {
      faculty,
      level: search.level,
      parentOption: search.parentOption,
      depth: search.depth
    };
  }

  findOptionContextFromElement(element) {
    const facultyId = ensureString(element.closest("[data-faculty-id]")?.dataset.facultyId);
    const optionId = ensureString(element.closest("[data-option-id]")?.dataset.optionId);
    if (!facultyId || !optionId) {
      return null;
    }
    const faculty = this.faculties.find((entry) => entry.id === facultyId);
    if (!faculty) {
      return null;
    }
    const search = this.findOptionRecursive(faculty.unitTree, optionId, 0);
    if (!search) {
      return null;
    }
    return {
      faculty,
      option: search.option,
      level: search.parentLevel,
      depth: search.depth
    };
  }

  findLevelRecursive(level, targetId, depth, parentOption = null) {
    if (!level) {
      return null;
    }
    if (level.id === targetId) {
      return { level, parentOption, depth };
    }
    for (const option of level.options || []) {
      const child = this.findLevelRecursive(option.children, targetId, depth + 1, option);
      if (child) {
        return child;
      }
    }
    return null;
  }

  findOptionRecursive(level, targetId, depth) {
    if (!level) {
      return null;
    }
    for (const option of level.options || []) {
      if (option.id === targetId) {
        return { option, parentLevel: level, depth };
      }
      const child = this.findOptionRecursive(option.children, targetId, depth + 1);
      if (child) {
        return child;
      }
    }
    return null;
  }

  render() {
    const container = this.dom.glFacultyList;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    this.faculties.forEach((faculty) => {
      const card = this.renderFacultyCard(faculty);
      if (card) {
        container.append(card);
      }
    });
    if (this.dom.glFacultyEmpty) {
      this.dom.glFacultyEmpty.hidden = this.faculties.length > 0;
    }
    if (this.dom.glFacultyLibraryName) {
      this.dom.glFacultyLibraryName.textContent = this.libraryName || "—";
    }
    this.updateSaveButtonState();
    this.updateLoadingState();
  }

  renderFacultyCard(faculty) {
    if (!this.dom.glFacultyCardTemplate) {
      return null;
    }
    const fragment = this.dom.glFacultyCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector("[data-faculty-card]");
    if (!(card instanceof HTMLElement)) {
      return null;
    }
    card.dataset.facultyId = faculty.id;
    const nameInput = card.querySelector('[data-field="faculty-name"]');
    if (nameInput instanceof HTMLInputElement) {
      nameInput.value = faculty.faculty;
    }
    const fallbackInput = card.querySelector('[data-field="fallback-label"]');
    if (fallbackInput instanceof HTMLInputElement) {
      fallbackInput.value = faculty.fallbackLabel || FACULTY_LABEL_FALLBACK;
    }
    const fallbackContainer = card.querySelector('[data-fallback-container]');
    if (fallbackContainer instanceof HTMLElement) {
      fallbackContainer.hidden = Boolean(faculty.unitTree);
    }
    const addLevelButton = card.querySelector('[data-action="add-root-level"]');
    const levelContainer = card.querySelector('[data-level-container]');
    if (faculty.unitTree && levelContainer instanceof HTMLElement) {
      const levelCard = this.renderLevelCard(faculty.unitTree, 0);
      if (levelCard) {
        levelContainer.append(levelCard);
      }
      if (addLevelButton instanceof HTMLButtonElement) {
        addLevelButton.hidden = true;
      }
    } else if (addLevelButton instanceof HTMLButtonElement) {
      addLevelButton.hidden = false;
    }
    return card;
  }

  renderLevelCard(level, depth) {
    if (!this.dom.glFacultyLevelTemplate) {
      return null;
    }
    const fragment = this.dom.glFacultyLevelTemplate.content.cloneNode(true);
    const card = fragment.querySelector("[data-level-card]");
    if (!(card instanceof HTMLElement)) {
      return null;
    }
    card.dataset.levelId = level.id;
    card.dataset.depth = String(depth);
    const labelInput = card.querySelector('[data-field="level-label"]');
    if (labelInput instanceof HTMLInputElement) {
      labelInput.value = level.label;
    }
    const placeholderInput = card.querySelector('[data-field="level-placeholder"]');
    if (placeholderInput instanceof HTMLInputElement) {
      placeholderInput.value = level.placeholder;
    }
    const allowCustomInput = card.querySelector('[data-field="level-allow-custom"]');
    if (allowCustomInput instanceof HTMLInputElement) {
      allowCustomInput.checked = level.allowCustom !== false;
    }
    const optionsContainer = card.querySelector('[data-option-container]');
    if (optionsContainer instanceof HTMLElement) {
      level.options.forEach((option) => {
        const optionCard = this.renderOptionCard(option, depth + 1);
        if (optionCard) {
          optionsContainer.append(optionCard);
        }
      });
    }
    return card;
  }

  renderOptionCard(option, depth) {
    if (!this.dom.glFacultyOptionTemplate) {
      return null;
    }
    const fragment = this.dom.glFacultyOptionTemplate.content.cloneNode(true);
    const card = fragment.querySelector("[data-option-card]");
    if (!(card instanceof HTMLElement)) {
      return null;
    }
    card.dataset.optionId = option.id;
    card.dataset.depth = String(depth);
    const labelInput = card.querySelector('[data-field="option-label"]');
    if (labelInput instanceof HTMLInputElement) {
      labelInput.value = option.label;
    }
    const valueInput = card.querySelector('[data-field="option-value"]');
    if (valueInput instanceof HTMLInputElement) {
      valueInput.value = option.value || "";
    }
    const addChildButton = card.querySelector('[data-action="add-child-level"]');
    const childContainer = card.querySelector('[data-child-container]');
    if (option.children && childContainer instanceof HTMLElement) {
      const levelCard = this.renderLevelCard(option.children, depth);
      if (levelCard) {
        childContainer.append(levelCard);
      }
      if (addChildButton instanceof HTMLButtonElement) {
        addChildButton.hidden = true;
      }
    } else if (addChildButton instanceof HTMLButtonElement) {
      addChildButton.hidden = false;
    }
    return card;
  }

  focusField(selector) {
    if (!selector || !this.dom.glFacultyList) {
      return;
    }
    requestAnimationFrame(() => {
      const element = this.dom.glFacultyList.querySelector(selector);
      if (element instanceof HTMLElement) {
        element.focus();
      }
    });
  }

  validate() {
    if (!this.faculties.length) {
      return { ok: true };
    }
    for (const faculty of this.faculties) {
      if (!ensureString(faculty.faculty)) {
        this.focusField(`[data-faculty-id="${escapeSelector(faculty.id)}"] [data-field="faculty-name"]`);
        return { ok: false, message: "学部名を入力してください。" };
      }
      if (faculty.unitTree) {
        const result = this.validateLevel(faculty, faculty.unitTree);
        if (!result.ok) {
          return result;
        }
      }
    }
    return { ok: true };
  }

  validateLevel(faculty, level) {
    if (!level.options.length) {
      this.focusField(`[data-level-id="${escapeSelector(level.id)}"] [data-field="level-label"]`);
      return { ok: false, message: `${level.label || "階層"}の選択肢を追加してください。` };
    }
    for (const option of level.options) {
      if (!ensureString(option.label)) {
        this.focusField(`[data-option-id="${escapeSelector(option.id)}"] [data-field="option-label"]`);
        return { ok: false, message: "選択肢の表示名を入力してください。" };
      }
      if (option.children) {
        const result = this.validateLevel(faculty, option.children);
        if (!result.ok) {
          return result;
        }
      }
    }
    return { ok: true };
  }

  async save() {
    const validation = this.validate();
    if (!validation.ok) {
      this.setStatus(validation.message, "error");
      return;
    }
    if (this.saving) {
      return;
    }
    this.saving = true;
    this.updateSaveButtonState();
    try {
      const payload = {
        id: this.libraryId,
        name: this.libraryName || DEFAULT_FACULTY_LIBRARY_NAME,
        faculties: this.faculties.map((entry) => stripFacultyEntry(entry)).filter(Boolean),
        updatedAt: serverTimestamp()
      };
      const uid = ensureString(this.app?.currentUser?.uid);
      if (uid) {
        payload.updatedByUid = uid;
      }
      const displayName = ensureString(this.app?.currentUser?.displayName);
      if (displayName) {
        payload.updatedByName = displayName;
      }
      await set(getGlFacultyLibraryRef(this.libraryId), payload);
      this.setStatus("学部リストを保存しました。", "success");
      this.setDirty(false);
    } catch (error) {
      logError("Failed to persist faculty library", error);
      this.setStatus("学部リストの保存に失敗しました。", "error");
    } finally {
      this.saving = false;
      this.updateSaveButtonState();
    }
  }

  setDirty(flag) {
    this.dirty = Boolean(flag);
    this.updateSaveButtonState();
  }

  setStatus(message, variant = "info") {
    if (!this.dom.glFacultyStatus) {
      return;
    }
    const text = ensureString(message);
    this.dom.glFacultyStatus.textContent = text;
    this.dom.glFacultyStatus.dataset.variant = variant;
    this.dom.glFacultyStatus.hidden = !text;
  }

  updateLoadingState() {
    if (!this.dom.glFacultyLoadingOverlay) {
      return;
    }
    this.dom.glFacultyLoadingOverlay.hidden = !this.loading;
  }

  updateSaveButtonState() {
    if (this.dom.glFacultySaveButton) {
      this.dom.glFacultySaveButton.disabled = !this.dirty || this.saving;
    }
  }
}

function toDateTimeLocalString(value) {
  if (!value) {
    return "";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return formatDateTimeLocal(new Date(numeric));
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return formatDateTimeLocal(date);
}

function toTimestamp(value) {
  if (!value) return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function parseTeamCount(value) {
  const text = ensureString(value).trim();
  if (!text) {
    return null;
  }
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    return Number.NaN;
  }
  return Math.floor(number);
}

function parseStoredTeamCount(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.floor(number);
}

function generateTeamNames(count = 0) {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }
  const total = Math.floor(count);
  const teams = [];
  for (let index = 1; index <= total; index += 1) {
    teams.push(`${index}班`);
  }
  return teams;
}

function sanitizeTeamList(list = []) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((team) => ensureString(team)).filter(Boolean);
}

function inferSequentialTeamCount(teams = []) {
  if (!Array.isArray(teams) || !teams.length) {
    return null;
  }
  const normalized = teams.map((team) => ensureString(team)).filter(Boolean);
  if (!normalized.length) {
    return null;
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const expected = `${index + 1}班`;
    if (normalized[index] !== expected) {
      return null;
    }
  }
  return normalized.length;
}

function normalizeScheduleConfig(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return sanitizeScheduleEntries(raw);
  }
  if (typeof raw === "object") {
    const entries = Object.entries(raw).map(([key, value]) => ({
      id: ensureString(value?.id) || ensureString(key),
      label: ensureString(value?.label || value?.date || value?.id || key),
      date: ensureString(value?.date || value?.startAt || "")
    }));
    return sanitizeScheduleEntries(entries);
  }
  return [];
}

function sanitizeScheduleEntries(schedules = []) {
  if (!Array.isArray(schedules) || !schedules.length) {
    return [];
  }
  return schedules
    .map((schedule) => ({
      id: ensureString(schedule?.id),
      label: ensureString(schedule?.label || schedule?.date || schedule?.id),
      date: ensureString(schedule?.date || schedule?.startAt || "")
    }))
    .filter((entry) => entry.id);
}

function buildScheduleConfigMap(schedules = []) {
  const entries = sanitizeScheduleEntries(schedules);
  return entries.reduce((acc, schedule) => {
    const id = schedule.id;
    if (!id) {
      return acc;
    }
    acc[id] = {
      id,
      label: schedule.label,
      date: schedule.date
    };
    return acc;
  }, {});
}

function scheduleSummaryMapsEqual(first = {}, second = {}) {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) {
    return false;
  }
  return firstKeys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(second, key)) {
      return false;
    }
    const firstEntry = first[key] || {};
    const secondEntry = second[key] || {};
    return (
      ensureString(firstEntry.id) === ensureString(secondEntry.id) &&
      ensureString(firstEntry.label) === ensureString(secondEntry.label) &&
      ensureString(firstEntry.date) === ensureString(secondEntry.date)
    );
  });
}

function normalizeAssignmentSnapshot(snapshot = {}) {
  const map = new Map();
  if (!snapshot || typeof snapshot !== "object") {
    return map;
  }
  Object.entries(snapshot).forEach(([glId, value]) => {
    if (!glId) return;
    if (!value || typeof value !== "object") {
      return;
    }
    const status = ensureString(value.status);
    const teamId = ensureString(value.teamId);
    const assignment = {
      status: status || (teamId ? "team" : ""),
      teamId,
      updatedAt: Number(value.updatedAt) || 0,
      updatedByUid: ensureString(value.updatedByUid),
      updatedByName: ensureString(value.updatedByName)
    };
    map.set(glId, assignment);
  });
  return map;
}

function normalizeApplications(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }
  return Object.entries(snapshot)
    .map(([key, value]) => {
      if (!key || !value || typeof value !== "object") {
        return null;
      }
      const createdAt = Number(value.createdAt) || Number(value.updatedAt) || 0;
      const shifts = value.shifts && typeof value.shifts === "object" ? value.shifts : {};
      return {
        id: key,
        name: ensureString(value.name),
        phonetic: ensureString(value.phonetic),
        email: ensureString(value.email),
        grade: ensureString(value.grade),
        faculty: ensureString(value.faculty),
        department: ensureString(value.department),
        club: ensureString(value.club),
        studentId: ensureString(value.studentId),
        note: ensureString(value.note),
        shifts,
        createdAt,
        updatedAt: Number(value.updatedAt) || createdAt,
        raw: value
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name, "ja", { numeric: true }));
}

function buildAssignmentOptions(teams = []) {
  const normalizedTeams = Array.isArray(teams) ? teams.map((team) => ensureString(team)).filter(Boolean) : [];
  const options = [
    { value: "", label: "未割当" },
    ...normalizedTeams.map((team) => ({ value: team, label: `班: ${team}` })),
    { value: ASSIGNMENT_VALUE_ABSENT, label: "欠席" },
    { value: ASSIGNMENT_VALUE_STAFF, label: "運営待機" }
  ];
  return options;
}

function resolveAssignmentValue(assignment) {
  if (!assignment) {
    return "";
  }
  if (assignment.status === "absent") {
    return ASSIGNMENT_VALUE_ABSENT;
  }
  if (assignment.status === "staff") {
    return ASSIGNMENT_VALUE_STAFF;
  }
  if (assignment.status === "team" && assignment.teamId) {
    return assignment.teamId;
  }
  if (assignment.teamId) {
    return assignment.teamId;
  }
  return "";
}

function resolveAssignmentStatus(value) {
  if (value === ASSIGNMENT_VALUE_ABSENT) {
    return { status: "absent", teamId: "" };
  }
  if (value === ASSIGNMENT_VALUE_STAFF) {
    return { status: "staff", teamId: "" };
  }
  const teamId = ensureString(value);
  if (!teamId) {
    return { status: "", teamId: "" };
  }
  return { status: "team", teamId };
}

export class GlToolManager {
  constructor(app) {
    this.app = app;
    this.dom = app.dom;
//    this.facultyBuilder = new GlFacultyBuilder(this.dom);
    this.currentEventId = "";
    this.currentEventName = "";
    this.currentSchedules = [];
    this.config = null;
    this.applications = [];
    this.assignments = new Map();
    this.filter = "all";
    this.loading = false;
    this.scheduleSyncPending = false;
    this.configUnsubscribe = null;
    this.applicationsUnsubscribe = null;
    this.assignmentsUnsubscribe = null;
    this.facultyLibraryManager = new GlFacultyLibraryManager(app);
    this.librarySnapshot = null;
    this.facultyLibraryUnsubscribe = this.facultyLibraryManager.onChange((snapshot) =>
      this.applyFacultyLibrarySnapshot(snapshot)
    );
    this.selectionUnsubscribe = this.app.addSelectionListener((detail) => this.handleSelection(detail));
    this.eventsUnsubscribe = this.app.addEventListener((events) => this.handleEvents(events));
    this.bindDom();
    this.updateConfigVisibility();
  }

  applyFacultyLibrarySnapshot(snapshot) {
    this.librarySnapshot = snapshot || null;
    if (this.dom.glFacultyLibraryName) {
      this.dom.glFacultyLibraryName.textContent = ensureString(snapshot?.name) || "—";
    }
    if (this.config && (!Array.isArray(this.config.faculties) || !this.config.faculties.length)) {
      this.config.faculties = cloneFacultyStructure(snapshot?.faculties);
    }
    if (this.config && !ensureString(this.config.facultyLibraryId)) {
      this.config.facultyLibraryId = ensureString(snapshot?.id) || DEFAULT_FACULTY_LIBRARY_ID;
    }
    this.updateCopyButtonState();
  }

  getAvailableSchedules({ includeConfigFallback = false } = {}) {
    const eventId = ensureString(this.currentEventId);
    if (!eventId) {
      if (includeConfigFallback && Array.isArray(this.config?.schedules)) {
        return this.config.schedules.map((schedule) => ({ ...schedule }));
      }
      return [];
    }

    const scheduleSource = [];
    const selectedEventId = ensureString(this.app?.selectedEventId);
    if (Array.isArray(this.app?.schedules) && selectedEventId === eventId) {
      scheduleSource.push(...this.app.schedules);
    }

    if (!scheduleSource.length && Array.isArray(this.app?.events)) {
      const match = this.app.events.find((entry) => ensureString(entry.id) === eventId);
      if (match && Array.isArray(match.schedules)) {
        scheduleSource.push(...match.schedules);
      }
    }

    if (
      !scheduleSource.length &&
      typeof this.app?.getParticipantEventsSnapshot === "function"
    ) {
      const snapshot = this.app.getParticipantEventsSnapshot();
      const match = Array.isArray(snapshot)
        ? snapshot.find((entry) => ensureString(entry?.id) === eventId)
        : null;
      if (match && Array.isArray(match.schedules)) {
        scheduleSource.push(...match.schedules);
      }
    }

    if (!scheduleSource.length && includeConfigFallback && Array.isArray(this.config?.schedules)) {
      return this.config.schedules.map((schedule) => ({ ...schedule }));
    }

    return scheduleSource.map((schedule) => ({ ...schedule }));
  }

  refreshSchedules() {
    this.currentSchedules = this.getAvailableSchedules({ includeConfigFallback: true });
    this.syncScheduleSummaryCache();
  }

  bindDom() {
    if (this.dom.glConfigSaveButton) {
      this.dom.glConfigSaveButton.addEventListener("click", () => {
        this.saveConfig().catch((error) => {
          logError("Failed to save GL config", error);
          this.setStatus("募集設定の保存に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.addEventListener("click", () => {
        this.copyFormUrl().catch((error) => {
          logError("Failed to copy GL form URL", error);
          this.setStatus("応募URLのコピーに失敗しました。", "error");
        });
      });
    }
    if (this.dom.glTeamCountInput) {
      this.dom.glTeamCountInput.addEventListener("input", () => this.updateTeamPreview());
    }
    if (this.dom.glFilterSelect) {
      this.dom.glFilterSelect.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.filter = value || "all";
        this.renderApplications();
      });
    }
    if (this.dom.glApplicationList) {
      this.dom.glApplicationList.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLSelectElement)) {
          return;
        }
        if (!event.target.matches("[data-gl-assignment]")) {
          return;
        }
        const item = event.target.closest("[data-gl-id]");
        const glId = item ? ensureString(item.dataset.glId) : "";
        if (!glId) {
          return;
        }
        const value = event.target.value;
        this.applyAssignment(glId, value).catch((error) => {
          logError("Failed to update GL assignment", error);
          this.setStatus("班割当の更新に失敗しました。", "error");
        });
      });
    }
  }

  setActiveTab(tab) {
    const normalized = tab === "applications" ? "applications" : "config";
    this.activeTab = normalized;
    const entries = [
      { tab: "config", button: this.dom.glTabConfigButton, panel: this.dom.glTabpanelConfig },
      { tab: "applications", button: this.dom.glTabApplicationsButton, panel: this.dom.glTabpanelApplications }
    ];
    entries.forEach(({ tab: key, button, panel }) => {
      const isActive = key === normalized;
      if (button) {
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
      }
      if (panel) {
        panel.hidden = !isActive;
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }
    });
  }

  resetFlowState() {
    this.detachListeners();
    this.currentEventId = "";
    this.currentEventName = "";
    this.currentSchedules = [];
    this.config = null;
//    this.facultyBuilder?.clear();
    this.applications = [];
    this.assignments = new Map();
    this.filter = "all";
    this.loading = false;
    this.updateConfigVisibility();
    this.setActiveTab("config");
    this.renderApplications();
    if (this.dom.glTeamCountInput) {
      this.dom.glTeamCountInput.value = "";
    }
  }

  resetContext() {
    this.applications = [];
    this.assignments = new Map();
    this.renderApplications();
  }

  handleEvents(events = []) {
    if (!Array.isArray(events)) {
      return;
    }
    const active = events.find((event) => ensureString(event.id) === this.currentEventId) || null;
    if (active) {
      this.currentEventName = ensureString(active.name) || this.currentEventId;
    }
    this.refreshSchedules();
    this.renderApplications();
    this.updateCopyButtonState();
  }

  handleSelection(detail = {}) {
    const eventId = ensureString(detail.eventId);
    const changed = eventId !== this.currentEventId;
    this.currentEventId = eventId;
    this.currentEventName = ensureString(detail.eventName) || eventId;
    this.refreshSchedules();
    this.updateConfigVisibility();
    this.updateCopyButtonState();
    this.setStatus("", "info");
    if (changed) {
      this.filter = "all";
      if (this.dom.glFilterSelect) {
        this.dom.glFilterSelect.value = "all";
      }
      this.setActiveTab("config");
      this.attachListeners();
    }
  }

  detachListeners() {
    if (typeof this.configUnsubscribe === "function") {
      this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
    if (typeof this.applicationsUnsubscribe === "function") {
      this.applicationsUnsubscribe();
      this.applicationsUnsubscribe = null;
    }
    if (typeof this.assignmentsUnsubscribe === "function") {
      this.assignmentsUnsubscribe();
      this.assignmentsUnsubscribe = null;
    }
  }

  attachListeners() {
    this.detachListeners();
    if (!this.currentEventId) {
      this.config = null;
      this.applications = [];
      this.assignments = new Map();
      this.renderApplications();
      return;
    }
    this.loading = true;
    this.renderApplications();
    this.configUnsubscribe = onValue(getGlEventConfigRef(this.currentEventId), (snapshot) => {
      this.applyConfig(snapshot.val() || {});
    });
    this.applicationsUnsubscribe = onValue(getGlApplicationsRef(this.currentEventId), (snapshot) => {
      this.loading = false;
      this.applications = normalizeApplications(snapshot.val() || {});
      this.renderApplications();
    });
    this.assignmentsUnsubscribe = onValue(getGlAssignmentsRef(this.currentEventId), (snapshot) => {
      this.assignments = normalizeAssignmentSnapshot(snapshot.val() || {});
      this.renderApplications();
    });
  }

  applyConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const schedules = normalizeScheduleConfig(config.schedules);
    const facultyLibraryId = ensureString(config.facultyLibraryId) || DEFAULT_FACULTY_LIBRARY_ID;
    const facultiesSource = Array.isArray(config.faculties) && config.faculties.length
      ? config.faculties
      : this.librarySnapshot?.faculties;
    const storedTeamCount = parseStoredTeamCount(config.teamCount);
    let teams = sanitizeTeamList(config.teams);
    let teamCount = storedTeamCount;
    if (teamCount !== null) {
      teams = generateTeamNames(teamCount);
    } else {
      const inferred = inferSequentialTeamCount(teams);
      if (inferred !== null) {
        teamCount = inferred;
      }
    }
    this.config = {
      slug: ensureString(config.slug) || this.currentEventId || "",
      facultyLibraryId,
      faculties: cloneFacultyStructure(facultiesSource),
      teams,
      teamCount,
      schedules,
      startAt: config.startAt || "",
      endAt: config.endAt || "",
      guidance: ensureString(config.guidance),
      updatedAt: Number(config.updatedAt) || 0,
      createdAt: Number(config.createdAt) || 0
    };
    if (this.dom.glPeriodStartInput) {
      this.dom.glPeriodStartInput.value = toDateTimeLocalString(this.config.startAt);
    }
    if (this.dom.glPeriodEndInput) {
      this.dom.glPeriodEndInput.value = toDateTimeLocalString(this.config.endAt);
    }
    if (this.dom.glTeamCountInput) {
      if (Number.isInteger(this.config.teamCount) && this.config.teamCount >= 0) {
        this.dom.glTeamCountInput.value = String(this.config.teamCount);
      } else {
        this.dom.glTeamCountInput.value = "";
      }
    }
    this.updateTeamPreview();
    this.updateCopyButtonState();
    this.refreshSchedules();
    this.renderApplications();
  }

  async syncScheduleSummaryCache() {
    if (!this.currentEventId || !this.config || this.scheduleSyncPending) {
      return;
    }
    const primarySchedules = this.getAvailableSchedules({ includeConfigFallback: false });
    const summaryList = sanitizeScheduleEntries(primarySchedules);
    if (!summaryList.length) {
      return;
    }
    const nextMap = buildScheduleConfigMap(summaryList);
    const currentMap = buildScheduleConfigMap(this.config.schedules || []);
    if (scheduleSummaryMapsEqual(currentMap, nextMap)) {
      return;
    }
    this.scheduleSyncPending = true;
    try {
      await update(ref(database), {
        [`glIntake/events/${this.currentEventId}/schedules`]: nextMap
      });
    } catch (error) {
      logError("Failed to sync GL schedule summary", error);
    } finally {
      this.scheduleSyncPending = false;
    }
  }

  updateTeamPreview() {
    if (!this.dom.glTeamPreview) {
      return;
    }
    const preview = this.dom.glTeamPreview;
    delete preview.dataset.variant;
    const inputValue = this.dom.glTeamCountInput instanceof HTMLInputElement ? this.dom.glTeamCountInput.value : "";
    const parsed = parseTeamCount(inputValue);
    if (Number.isNaN(parsed)) {
      preview.hidden = false;
      preview.textContent = "0以上の整数を入力してください。";
      preview.dataset.variant = "error";
      return;
    }
    if (parsed === null) {
      const currentTeams = sanitizeTeamList(this.config?.teams || []);
      if (currentTeams.length) {
        preview.hidden = false;
        preview.textContent = `現在の班: ${currentTeams.join("、")}`;
        preview.dataset.variant = "info";
      } else {
        preview.hidden = true;
        preview.textContent = "";
      }
      return;
    }
    if (parsed === 0) {
      preview.hidden = false;
      preview.textContent = "班は作成されません。";
      preview.dataset.variant = "muted";
      return;
    }
    const teams = generateTeamNames(parsed);
    if (!teams.length) {
      preview.hidden = true;
      preview.textContent = "";
      return;
    }
    preview.hidden = false;
    preview.textContent = `作成される班: ${teams.join("、")}`;
    preview.dataset.variant = "info";
  }

  updateConfigVisibility() {
    if (!this.dom.glConfigEventNote || !this.dom.glConfigContent) {
      return;
    }
    const hasEvent = Boolean(this.currentEventId);
    this.dom.glConfigEventNote.hidden = hasEvent;
    this.dom.glConfigContent.hidden = !hasEvent;
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.disabled = !hasEvent;
    }
    if (this.dom.glConfigSaveButton) {
      this.dom.glConfigSaveButton.disabled = !hasEvent;
    }
    this.updateCopyButtonState();
  }

  updateCopyButtonState() {
    if (!this.dom.glConfigCopyButton) {
      return;
    }
    const slug = ensureString(this.config?.slug) || this.currentEventId || "";
    this.dom.glConfigCopyButton.disabled = !slug || !this.currentEventId;
  }

  async saveConfig() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = ensureString(this.currentEventId);
    const startAt = toTimestamp(this.dom.glPeriodStartInput?.value || "");
    const endAt = toTimestamp(this.dom.glPeriodEndInput?.value || "");
    const rawTeamInput = this.dom.glTeamCountInput instanceof HTMLInputElement ? this.dom.glTeamCountInput.value : "";
    const parsedTeamCount = parseTeamCount(rawTeamInput);
    if (Number.isNaN(parsedTeamCount)) {
      this.setStatus("班の数は0以上の整数で入力してください。", "error");
      if (this.dom.glTeamCountInput instanceof HTMLInputElement) {
        this.dom.glTeamCountInput.focus();
      }
      this.updateTeamPreview();
      return;
    }
    let teamCount = parsedTeamCount;
    if (teamCount === null && Number.isInteger(this.config?.teamCount) && this.config.teamCount >= 0) {
      teamCount = this.config.teamCount;
    }
    let teams;
    if (teamCount === null) {
      teams = sanitizeTeamList(this.config?.teams || []);
    } else {
      teams = generateTeamNames(teamCount);
    }
    const previousSlug = ensureString(this.config?.slug);
    if (slug) {
      const slugSnapshot = await get(ref(database, `glIntake/slugIndex/${slug}`));
      const ownerEventId = ensureString(slugSnapshot.val());
      if (ownerEventId && ownerEventId !== this.currentEventId) {
        this.setStatus("同じイベントIDが別のGLフォームに割り当てられています。イベント設定を確認してください。", "error");
        return;
      }
    }
    const scheduleSummaryList = sanitizeScheduleEntries(
      this.getAvailableSchedules({ includeConfigFallback: true })
    );
    const scheduleSummary = buildScheduleConfigMap(scheduleSummaryList);
    const faculties = cloneFacultyStructure(
      this.librarySnapshot?.faculties?.length ? this.librarySnapshot.faculties : this.config?.faculties
    );
    const facultyLibraryId = ensureString(this.config?.facultyLibraryId) || DEFAULT_FACULTY_LIBRARY_ID;
    const configPayload = {
      slug,
      startAt,
      endAt,
      faculties,
      facultyLibraryId,
      teams,
      teamCount: teamCount === null ? null : teamCount,
      schedules: scheduleSummary,
      guidance: ensureString(this.config?.guidance),
      updatedAt: serverTimestamp(),
      eventId: this.currentEventId,
      eventName: this.currentEventName
    };
    if (this.config?.createdAt) {
      configPayload.createdAt = this.config.createdAt;
    } else {
      configPayload.createdAt = serverTimestamp();
    }
    const updates = {};
    updates[`glIntake/events/${this.currentEventId}`] = configPayload;
    if (slug) {
      updates[`glIntake/slugIndex/${slug}`] = this.currentEventId;
    }
    if (previousSlug && previousSlug !== slug) {
      updates[`glIntake/slugIndex/${previousSlug}`] = null;
    }
    await update(ref(database), updates);
    this.config.slug = slug;
    this.config.faculties = faculties;
    this.config.facultyLibraryId = facultyLibraryId;
    this.config.teamCount = teamCount;
    this.config.teams = teams;
    this.updateCopyButtonState();
    this.setStatus("募集設定を保存しました。", "success");
    this.updateTeamPreview();
  }

  async copyFormUrl() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = ensureString(this.config?.slug) || this.currentEventId;
    if (!slug) {
      this.setStatus("応募URLを生成できませんでした。", "warning");
      return;
    }
    let url = `${window.location.origin}${window.location.pathname}`;
    try {
      const currentUrl = new URL(window.location.href);
      const basePath = currentUrl.pathname.replace(/[^/]*$/, "");
      const formUrl = new URL("gl-form.html", `${currentUrl.origin}${basePath}`);
      formUrl.searchParams.set("evt", slug);
      url = formUrl.toString();
    } catch (error) {
      // fallback to relative path
      url = `gl-form.html?evt=${encodeURIComponent(slug)}`;
    }
    let success = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        success = true;
      } catch (error) {
        success = false;
      }
    }
    if (!success) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        success = document.execCommand("copy");
      } catch (error) {
        success = false;
      }
      document.body.removeChild(textarea);
    }
    this.setStatus(success ? "応募URLをコピーしました。" : "応募URLのコピーに失敗しました。", success ? "success" : "error");
    if (this.dom.glConfigCopyStatus) {
      this.dom.glConfigCopyStatus.textContent = success
        ? "GL応募フォームのURLをコピーしました。"
        : "GL応募フォームのURLをコピーできませんでした。";
    }
  }

  setStatus(message, variant = "info") {
    if (!this.dom.glConfigStatus) return;
    const text = ensureString(message);
    this.dom.glConfigStatus.textContent = text;
    this.dom.glConfigStatus.dataset.variant = variant;
    this.dom.glConfigStatus.hidden = !text;
  }

  renderApplications() {
    const list = this.dom.glApplicationList;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const hasEvent = Boolean(this.currentEventId);
    if (this.dom.glApplicationEventNote) {
      this.dom.glApplicationEventNote.hidden = hasEvent;
    }
    if (!hasEvent) {
      if (this.dom.glApplicationEmpty) {
        this.dom.glApplicationEmpty.hidden = true;
      }
      if (this.dom.glApplicationLoading) {
        this.dom.glApplicationLoading.hidden = true;
      }
      return;
    }
    const filtered = this.applyFilter(this.applications);
    if (this.dom.glApplicationLoading) {
      this.dom.glApplicationLoading.hidden = !this.loading;
    }
    if (this.dom.glApplicationEmpty) {
      this.dom.glApplicationEmpty.hidden = this.loading || filtered.length > 0;
    }
    if (this.loading || !filtered.length) {
      return;
    }
    const options = buildAssignmentOptions(this.config?.teams || []);
    const scheduleMap = new Map(
      this.currentSchedules.map((schedule) => [ensureString(schedule.id), schedule])
    );
    const fragment = document.createDocumentFragment();
    filtered.forEach((entry) => {
      const assignment = this.assignments.get(entry.id) || null;
      const item = document.createElement("li");
      item.className = "gl-application-card";
      item.dataset.glId = entry.id;

      const header = document.createElement("header");
      header.className = "gl-application-header";
      const nameBlock = document.createElement("div");
      nameBlock.className = "gl-application-name";
      const nameEl = document.createElement("span");
      nameEl.className = "gl-name";
      nameEl.textContent = entry.name || "(無記入)";
      const phoneticEl = document.createElement("span");
      phoneticEl.className = "gl-phonetic";
      if (entry.phonetic) {
        phoneticEl.textContent = entry.phonetic;
      } else {
        phoneticEl.textContent = "";
        phoneticEl.hidden = true;
      }
      nameBlock.append(nameEl, phoneticEl);
      header.append(nameBlock);
      if (entry.grade) {
        const gradeEl = document.createElement("span");
        gradeEl.className = "gl-grade";
        gradeEl.textContent = entry.grade;
        header.append(gradeEl);
      }
      item.append(header);

      const body = document.createElement("div");
      body.className = "gl-application-body";
      const details = document.createElement("dl");
      details.className = "gl-field-list";
      const addDetail = (label, value, className = "") => {
        if (!value) return;
        const row = document.createElement("div");
        row.className = "gl-field";
        if (className) {
          row.classList.add(className);
        }
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        row.append(dt, dd);
        details.append(row);
      };
      addDetail("学部", entry.faculty);
      addDetail("学科", entry.department);
      addDetail("メール", entry.email);
      addDetail("所属", entry.club);
      addDetail("学籍番号", entry.studentId);
      body.append(details);

      const shiftContainer = document.createElement("div");
      shiftContainer.className = "gl-shift-grid";
      const shiftTitle = document.createElement("span");
      shiftTitle.className = "gl-shift-title";
      shiftTitle.textContent = "シフト参加";
      shiftContainer.append(shiftTitle);
      const shiftList = document.createElement("ul");
      shiftList.className = "gl-shift-list";
      const shiftEntries = Object.entries(entry.shifts || {});
      if (!shiftEntries.length && scheduleMap.size) {
        scheduleMap.forEach((schedule, scheduleId) => {
          shiftEntries.push([scheduleId, false]);
        });
      }
      shiftEntries.forEach(([scheduleId, available]) => {
        const schedule = scheduleMap.get(scheduleId) || null;
        const li = document.createElement("li");
        li.className = "gl-shift-item";
        if (available) {
          li.classList.add("is-available");
        } else {
          li.classList.add("is-unavailable");
        }
        const label = schedule?.label || schedule?.date || scheduleId || "日程";
        li.textContent = label;
        shiftList.append(li);
      });
      shiftContainer.append(shiftList);
      body.append(shiftContainer);
      item.append(body);

      const footer = document.createElement("footer");
      footer.className = "gl-application-footer";
      const assignmentLabel = document.createElement("label");
      assignmentLabel.className = "gl-assignment-label";
      assignmentLabel.textContent = "班割当";
      const select = document.createElement("select");
      select.className = "input input--dense";
      select.dataset.glAssignment = "true";
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        if (option.value === resolveAssignmentValue(assignment)) {
          opt.selected = true;
        }
        select.append(opt);
      });
      assignmentLabel.append(select);
      footer.append(assignmentLabel);
      if (assignment && assignment.updatedAt) {
        const timestamp = document.createElement("span");
        timestamp.className = "gl-assignment-updated";
        const date = new Date(assignment.updatedAt);
        if (!Number.isNaN(date.getTime())) {
          timestamp.textContent = `更新: ${date.toLocaleString("ja-JP")}`;
        }
        footer.append(timestamp);
      }
      item.append(footer);

      fragment.append(item);
    });
    list.append(fragment);
  }

  applyFilter(applications) {
    const filter = this.filter || "all";
    if (filter === "all") {
      return applications.slice();
    }
    return applications.filter((entry) => {
      const assignment = this.assignments.get(entry.id) || null;
      const value = resolveAssignmentValue(assignment);
      if (filter === "unassigned") {
        return !value;
      }
      if (filter === "assigned") {
        return value && value !== ASSIGNMENT_VALUE_ABSENT && value !== ASSIGNMENT_VALUE_STAFF;
      }
      if (filter === "absent") {
        return value === ASSIGNMENT_VALUE_ABSENT;
      }
      if (filter === "staff") {
        return value === ASSIGNMENT_VALUE_STAFF;
      }
      return true;
    });
  }

  async applyAssignment(glId, value) {
    if (!this.currentEventId || !glId) {
      return;
    }
    const { status, teamId } = resolveAssignmentStatus(value);
    const refPath = getGlAssignmentRef(this.currentEventId, glId);
    if (!status && !teamId) {
      await remove(refPath);
      return;
    }
    const user = this.app?.currentUser || null;
    const payload = {
      status,
      teamId,
      updatedAt: serverTimestamp(),
      updatedByUid: ensureString(user?.uid),
      updatedByName: ensureString(user?.displayName) || ensureString(user?.email)
    };
    await set(refPath, payload);
  }
}
