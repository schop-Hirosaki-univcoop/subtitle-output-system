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
  get
} from "../../operator/firebase.js";
import { ensureString, formatDateTimeLocal, logError } from "../helpers.js";

const ASSIGNMENT_VALUE_ABSENT = "__absent";
const ASSIGNMENT_VALUE_STAFF = "__staff";

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

function parseFacultyConfig(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [facultyPart, departmentsPart = ""] = line.split(":");
      const faculty = ensureString(facultyPart);
      const departments = departmentsPart
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      return { faculty, departments };
    })
    .filter((entry) => entry.faculty);
}

function formatFacultyConfig(faculties = []) {
  if (!Array.isArray(faculties) || !faculties.length) {
    return "";
  }
  return faculties
    .map((entry) => {
      const faculty = ensureString(entry?.faculty);
      const departments = Array.isArray(entry?.departments)
        ? entry.departments.map((dept) => ensureString(dept)).filter(Boolean)
        : [];
      if (!faculty) {
        return "";
      }
      if (!departments.length) {
        return faculty;
      }
      return `${faculty}: ${departments.join(", ")}`;
    })
    .filter(Boolean)
    .join("\n");
}

function parseTeamConfig(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatTeamConfig(teams = []) {
  if (!Array.isArray(teams) || !teams.length) {
    return "";
  }
  return teams.map((team) => ensureString(team)).filter(Boolean).join("\n");
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
    this.selectionUnsubscribe = this.app.addSelectionListener((detail) => this.handleSelection(detail));
    this.eventsUnsubscribe = this.app.addEventListener((events) => this.handleEvents(events));
    this.bindDom();
    this.updateConfigVisibility();
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
    if (this.dom.glSlugInput) {
      this.dom.glSlugInput.addEventListener("input", () => {
        this.updateSlugPreview();
      });
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

  resetFlowState() {
    this.detachListeners();
    this.currentEventId = "";
    this.currentEventName = "";
    this.currentSchedules = [];
    this.config = null;
    this.applications = [];
    this.assignments = new Map();
    this.filter = "all";
    this.loading = false;
    this.updateConfigVisibility();
    this.renderApplications();
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
    this.updateSlugPreview();
  }

  handleSelection(detail = {}) {
    const eventId = ensureString(detail.eventId);
    const changed = eventId !== this.currentEventId;
    this.currentEventId = eventId;
    this.currentEventName = ensureString(detail.eventName) || eventId;
    this.refreshSchedules();
    this.updateConfigVisibility();
    this.updateSlugPreview();
    this.setStatus("", "info");
    if (changed) {
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
    this.config = {
      slug: ensureString(config.slug),
      faculties: Array.isArray(config.faculties) ? config.faculties : [],
      teams: Array.isArray(config.teams) ? config.teams : [],
      schedules,
      startAt: config.startAt || "",
      endAt: config.endAt || "",
      guidance: ensureString(config.guidance),
      updatedAt: Number(config.updatedAt) || 0,
      createdAt: Number(config.createdAt) || 0
    };
    if (this.dom.glSlugInput) {
      const slug = this.config.slug || this.currentEventId;
      if (this.dom.glSlugInput.value !== slug) {
        this.dom.glSlugInput.value = slug;
      }
    }
    if (this.dom.glPeriodStartInput) {
      this.dom.glPeriodStartInput.value = toDateTimeLocalString(this.config.startAt);
    }
    if (this.dom.glPeriodEndInput) {
      this.dom.glPeriodEndInput.value = toDateTimeLocalString(this.config.endAt);
    }
    if (this.dom.glFacultyConfigInput) {
      this.dom.glFacultyConfigInput.value = formatFacultyConfig(this.config.faculties);
    }
    if (this.dom.glTeamConfigInput) {
      this.dom.glTeamConfigInput.value = formatTeamConfig(this.config.teams);
    }
    this.updateSlugPreview();
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
  }

  updateSlugPreview() {
    if (!this.dom.glSlugPreview) {
      return;
    }
    const slug = ensureString(this.dom.glSlugInput?.value) || this.currentEventId || "sample";
    this.dom.glSlugPreview.textContent = slug;
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.disabled = !slug || !this.currentEventId;
    }
  }

  async saveConfig() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = ensureString(this.dom.glSlugInput?.value) || this.currentEventId;
    const startAt = toTimestamp(this.dom.glPeriodStartInput?.value || "");
    const endAt = toTimestamp(this.dom.glPeriodEndInput?.value || "");
    const faculties = parseFacultyConfig(this.dom.glFacultyConfigInput?.value || "");
    const teams = parseTeamConfig(this.dom.glTeamConfigInput?.value || "");
    const previousSlug = ensureString(this.config?.slug);
    if (slug) {
      const slugSnapshot = await get(ref(database, `glIntake/slugIndex/${slug}`));
      const ownerEventId = ensureString(slugSnapshot.val());
      if (ownerEventId && ownerEventId !== this.currentEventId) {
        this.setStatus("同じフォーム識別子が既に使用されています。別の識別子を入力してください。", "error");
        return;
      }
    }
    const scheduleSummaryList = sanitizeScheduleEntries(
      this.getAvailableSchedules({ includeConfigFallback: true })
    );
    const scheduleSummary = buildScheduleConfigMap(scheduleSummaryList);
    const configPayload = {
      slug,
      startAt,
      endAt,
      faculties,
      teams,
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
    this.setStatus("募集設定を保存しました。", "success");
  }

  async copyFormUrl() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = ensureString(this.dom.glSlugInput?.value) || this.currentEventId;
    if (!slug) {
      this.setStatus("フォーム識別子を入力してください。", "warning");
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
