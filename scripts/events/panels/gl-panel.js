import {
  database,
  ref,
  onValue,
  update,
  set,
  push,
  serverTimestamp,
  getGlEventConfigRef,
  getGlAssignmentsRef,
  get,
  glIntakeFacultyCatalogRef
} from "../../operator/firebase.js";
import { ensureString, formatDateTimeLocal, logError } from "../helpers.js";
import { normalizeFacultyList } from "../tools/gl-faculty-utils.js";
import { buildGlShiftTablePrintHtml, logPrintWarn } from "../../shared/print-utils.js";
// ユーティリティ関数と定数を gl-utils.js からインポート（フェーズ2 段階1）
// UI描画機能を gl-renderer.js からインポート（フェーズ2 段階2）
// 応募管理機能を gl-application-manager.js からインポート（フェーズ2 段階3）
import { GlRenderer } from "./gl-renderer.js";
import { GlApplicationManager } from "./gl-application-manager.js";
import {
  ASSIGNMENT_VALUE_ABSENT,
  ASSIGNMENT_VALUE_STAFF,
  ASSIGNMENT_VALUE_UNAVAILABLE,
  MAX_TEAM_COUNT,
  ASSIGNMENT_BUCKET_UNASSIGNED,
  ASSIGNMENT_BUCKET_ABSENT,
  ASSIGNMENT_BUCKET_STAFF,
  ASSIGNMENT_BUCKET_UNAVAILABLE,
  INTERNAL_ROLE_OPTIONS,
  INTERNAL_GRADE_OPTIONS,
  INTERNAL_CUSTOM_OPTION_VALUE,
  toDateTimeLocalString,
  toTimestamp,
  parseTeamCount,
  buildSequentialTeams,
  deriveTeamCountFromConfig,
  sanitizeTeamList,
  normalizeScheduleTeamConfig,
  getScheduleTeams,
  buildScheduleBuckets,
  determineGradeBadgeVariant,
  applyGradeBadge,
  getGradeSortWeight,
  formatAssignmentLabelForPrint,
  resolveScheduleResponseValue,
  formatScheduleResponseText,
  determineScheduleResponseVariant,
  buildRenderableSchedules,
  isApplicantAvailableForSchedule,
  normalizeScheduleConfig,
  sanitizeScheduleEntries,
  buildScheduleConfigMap,
  scheduleSummaryMapsEqual,
  createSignature,
  normalizeAssignmentEntry,
  normalizeAssignmentSnapshot,
  normalizeApplications,
  formatTeamOptionLabel,
  buildAssignmentOptions,
  buildInternalAssignmentOptions,
  buildAssignmentOptionsForApplication,
  resolveAssignmentValue,
  resolveEffectiveAssignmentValue,
  resolveAssignmentStatus,
  formatAssignmentTimestamp,
  formatAssignmentUpdatedLabel,
  buildAcademicPathText
} from "./gl-utils.js";

// ユーティリティ関数は gl-utils.js に移行済み（フェーズ2 段階1）

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
    this.applicantSourceFilter = "all";
    this.applicantRoleFilter = "all";
    this.applicationView = "schedule";
    this.loading = false;
    this.scheduleSyncPending = false;
    this.configUnsubscribe = null;
    // applicationsUnsubscribeはGlApplicationManagerに移行（フェーズ2 段階3）
    this.assignmentsUnsubscribe = null;
    this.sharedFaculties = [];
    this.sharedSignature = "";
    this.sharedMeta = { updatedAt: 0, updatedByUid: "", updatedByName: "" };
    this.internalEditingId = "";
    this.internalEditingShifts = {};
    this.internalAcademicState = { currentCustomLabel: "", unitSelections: [] };
    this.internalUnitLevelMap = new WeakMap();
    this.sharedCatalogUnsubscribe = onValue(glIntakeFacultyCatalogRef, (snapshot) => {
      this.applySharedCatalog(snapshot.val() || {});
    });
    this.activeTab = "config";
    this.selectionUnsubscribe = this.app.addSelectionListener((detail) => this.handleSelection(detail));
    this.eventsUnsubscribe = this.app.addEventListener((events) => this.handleEvents(events));
    
    // GlRendererのインスタンスを作成（フェーズ2 段階2）
    this.renderer = new GlRenderer({
      dom: this.dom,
      getState: () => ({
        currentEventId: this.currentEventId,
        currentEventName: this.currentEventName,
        currentSchedules: this.currentSchedules,
        config: this.config,
        applications: this.applications,
        assignments: this.assignments,
        filter: this.filter,
        applicantSourceFilter: this.applicantSourceFilter,
        applicantRoleFilter: this.applicantRoleFilter,
        applicationView: this.applicationView,
        loading: this.loading
      }),
      onInternalAcademicLevelChange: (select) => this.handleInternalAcademicLevelChange(select),
      getInternalFaculties: () => this.getInternalFaculties(),
      getAssignmentForSchedule: (glId, scheduleId) => this.getAssignmentForSchedule(glId, scheduleId),
      resolveAssignmentBucket: (value, available) => this.resolveAssignmentBucket(value, available),
      createBucketMatcher: () => this.createBucketMatcher(),
      updateScheduleTeamNote: (element, scheduleId) => this.updateScheduleTeamNote(element, scheduleId)
    });
    
    // GlApplicationManagerのインスタンスを作成（フェーズ2 段階3）
    this.applicationManager = new GlApplicationManager({
      onApplicationsLoaded: (applications) => {
        this.loading = false;
        this.applications = applications;
        this.renderApplications();
      },
      getCurrentEventId: () => this.currentEventId,
      getConfig: () => this.config,
      getDefaultSlug: () => this.getDefaultSlug()
    });
    
    this.bindDom();
    this.updateConfigVisibility();
    this.resetInternalForm();
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
    // syncScheduleSummaryCache()は削除 - 設定保存時(saveConfig())にのみ処理されるため不要
    this.renderScheduleTeamControls();
    this.renderInternalShiftList();
  }

  renderInternalGradeOptions() {
    // GlRendererに委譲（フェーズ2 段階2）
    this.renderer.renderInternalGradeOptions();
  }

  getInternalFaculties() {
    const catalog = Array.isArray(this.sharedFaculties) ? this.sharedFaculties : [];
    const configFaculties = this.getConfigFaculties();
    return catalog.length ? catalog : configFaculties;
  }

  renderInternalFaculties() {
    // GlRendererに委譲（フェーズ2 段階2）
    this.renderer.renderInternalFaculties();
  }

  clearInternalAcademicFields() {
    this.internalAcademicState.unitSelections = [];
    const fields = this.dom.glInternalAcademicFields;
    if (fields) {
      fields.innerHTML = "";
    }
    this.updateInternalAcademicCustomField();
  }

  updateInternalAcademicCustomField(label) {
    const field = this.dom.glInternalAcademicCustomField;
    const labelEl = this.dom.glInternalAcademicCustomLabel;
    const input = this.dom.glInternalAcademicCustomInput;
    if (!field || !labelEl || !input) {
      return;
    }
    if (label) {
      this.internalAcademicState.currentCustomLabel = label;
      field.hidden = false;
      labelEl.textContent = `${label}（その他入力）`;
      input.placeholder = `${label}名を入力してください`;
      input.required = true;
    } else {
      this.internalAcademicState.currentCustomLabel = "";
      field.hidden = true;
      input.placeholder = "所属名を入力してください";
      input.required = false;
      input.value = "";
    }
  }

  removeInternalAcademicFieldsAfter(depth) {
    const fields = Array.from(this.dom.glInternalAcademicFields?.querySelectorAll(".gl-academic-field") ?? []);
    fields.forEach((field) => {
      const fieldDepth = Number(field.dataset.depth ?? "0");
      if (fieldDepth > depth) {
        field.remove();
      }
    });
    this.internalAcademicState.unitSelections = this.internalAcademicState.unitSelections.filter((_, index) => index <= depth);
  }

  renderInternalAcademicLevel(level, depth) {
    // GlRendererに委譲（フェーズ2 段階2）
    this.renderer.renderInternalAcademicLevel(level, depth, this.internalUnitLevelMap, (select) => {
      this.handleInternalAcademicLevelChange(select);
    });
  }

  handleInternalAcademicLevelChange(select) {
    const depth = Number(select.dataset.depth ?? "0");
    this.removeInternalAcademicFieldsAfter(depth);
    const level = this.internalUnitLevelMap.get(select);
    const value = ensureString(select.value);
    if (!level || !value) {
      this.updateInternalAcademicCustomField();
      return;
    }
    if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
      this.internalAcademicState.unitSelections[depth] = { label: level.label, value: "", isCustom: true };
      this.updateInternalAcademicCustomField(level.label);
      return;
    }
    const selectedOption = select.selectedOptions[0];
    const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
    const option = optionIndex >= 0 ? level.options[optionIndex] : null;
    const displayLabel = ensureString(option?.label ?? selectedOption?.textContent ?? value);
    this.internalAcademicState.unitSelections[depth] = {
      label: level.label,
      value: option ? option.value : value,
      displayLabel,
      isCustom: false
    };
    this.updateInternalAcademicCustomField();
    if (option?.children) {
      this.renderInternalAcademicLevel(option.children, depth + 1);
    }
  }

  renderInternalAcademicTreeForFaculty(facultyName) {
    this.clearInternalAcademicFields();
    const name = ensureString(facultyName);
    if (!name || name === INTERNAL_CUSTOM_OPTION_VALUE) {
      return;
    }
    const entry = this.getInternalFaculties().find((item) => ensureString(item.faculty) === name);
    if (entry?.unitTree) {
      this.renderInternalAcademicLevel(entry.unitTree, 0);
    } else if (entry?.fallbackLabel) {
      this.updateInternalAcademicCustomField(entry.fallbackLabel);
    } else {
      this.updateInternalAcademicCustomField("所属");
    }
  }

  collectInternalAcademicState() {
    const selects = Array.from(this.dom.glInternalAcademicFields?.querySelectorAll(".gl-academic-select") ?? []);
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
      const level = this.internalUnitLevelMap.get(select);
      const levelLabel = level?.label ?? "";
      const value = ensureString(select.value);
      if (!value && !pendingSelect) {
        pendingSelect = select;
      }
      if (!value) return;
      if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
        requiresCustom = true;
        customLabel = levelLabel || customLabel;
        path.push({
          label: levelLabel,
          value: ensureString(this.dom.glInternalAcademicCustomInput?.value),
          isCustom: true,
          element: this.dom.glInternalAcademicCustomInput ?? null
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
    if (!selects.length && this.internalAcademicState.currentCustomLabel) {
      requiresCustom = true;
      customLabel = this.internalAcademicState.currentCustomLabel;
      path.push({
        label: this.internalAcademicState.currentCustomLabel,
        value: ensureString(this.dom.glInternalAcademicCustomInput?.value),
        isCustom: true,
        element: this.dom.glInternalAcademicCustomInput ?? null
      });
    }
    const customValue = ensureString(this.dom.glInternalAcademicCustomInput?.value);
    return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
  }

  syncInternalAcademicInputs() {
    this.renderInternalGradeOptions();
    this.renderInternalFaculties();
    this.renderInternalAcademicTreeForFaculty(this.dom.glInternalFacultyInput?.value || "");
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
      this.dom.glTeamCountInput.addEventListener("change", () => {
        this.handleDefaultTeamCountChange();
      });
    }
    if (this.dom.glScheduleTeamsList) {
      this.dom.glScheduleTeamsList.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.matches("[data-schedule-team-input]")) {
          return;
        }
        this.handleScheduleTeamInput(target);
      });
    }
    const tabOrder = ["config", "applications"];
    const getTabButton = (tab) =>
      tab === "applications" ? this.dom.glTabApplicationsButton : this.dom.glTabConfigButton;
    tabOrder.forEach((tab) => {
      const button = getTabButton(tab);
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.setActiveTab(tab);
        button.focus();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        let index = tabOrder.indexOf(tab);
        for (let step = 0; step < tabOrder.length; step += 1) {
          index = (index + direction + tabOrder.length) % tabOrder.length;
          const targetTab = tabOrder[index];
          const targetButton = getTabButton(targetTab);
          if (targetButton && !targetButton.disabled) {
            targetButton.focus();
            this.setActiveTab(targetTab);
            break;
          }
        }
      });
    });
    this.setActiveTab(this.activeTab);
    if (this.dom.glApplicantSourceFilter) {
      this.dom.glApplicantSourceFilter.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.applicantSourceFilter = value || "all";
        this.renderApplications();
      });
    }
    if (this.dom.glApplicantRoleFilter) {
      this.dom.glApplicantRoleFilter.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.applicantRoleFilter = value || "all";
        this.renderApplications();
      });
    }
    if (this.dom.glFilterSelect) {
      this.dom.glFilterSelect.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.filter = value || "all";
        this.renderApplications();
      });
    }
    const viewOrder = ["schedule", "applicant", "internal"];
    const getViewButton = (key) => {
      if (key === "applicant") return this.dom.glApplicationViewApplicantButton;
      if (key === "internal") return this.dom.glApplicationViewInternalButton;
      return this.dom.glApplicationViewScheduleButton;
    };
    viewOrder.forEach((key) => {
      const button = getViewButton(key);
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.setActiveApplicationView(key);
        button.focus();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        let index = viewOrder.indexOf(key);
        for (let step = 0; step < viewOrder.length; step += 1) {
          index = (index + direction + viewOrder.length) % viewOrder.length;
          const targetKey = viewOrder[index];
          const targetButton = getViewButton(targetKey);
          if (targetButton && !targetButton.disabled) {
            targetButton.focus();
            this.setActiveApplicationView(targetKey);
            break;
          }
        }
      });
    });
    this.setActiveApplicationView(this.applicationView);
    if (this.dom.glApplicationViews) {
      this.dom.glApplicationViews.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.matches("[data-gl-assignment]")) {
          return;
        }
        const item = target.closest("[data-gl-id][data-schedule-id]");
        const glId = ensureString(item?.dataset.glId);
        const scheduleId = ensureString(item?.dataset.scheduleId || target.dataset.scheduleId);
        if (!glId || !scheduleId) {
          return;
        }
        const value = target.value;
        this.applyAssignment(glId, scheduleId, value).catch((error) => {
          logError("Failed to update GL assignment", error);
          this.setStatus("班割当の更新に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalForm) {
      this.dom.glInternalForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleInternalSubmit().catch((error) => {
          logError("Failed to save internal staff", error);
          this.setInternalStatus("内部スタッフの保存に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalShiftList) {
      this.dom.glInternalShiftList.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.scheduleId) {
          return;
        }
        this.internalEditingShifts = this.collectInternalShifts();
      });
    }
    if (this.dom.glInternalResetButton) {
      this.dom.glInternalResetButton.addEventListener("click", () => {
        this.resetInternalForm();
      });
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.addEventListener("click", () => {
        this.handleInternalDelete().catch((error) => {
          logError("Failed to delete internal staff", error);
          this.setInternalStatus("内部スタッフの削除に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalList) {
      this.dom.glInternalList.addEventListener("click", (event) => {
        const button = event.target instanceof HTMLElement
          ? event.target.closest("[data-internal-id]")
          : null;
        if (!button) {
          return;
        }
        const id = ensureString(button.dataset.internalId);
        if (!id) {
          return;
        }
        const target = this.applications.find((entry) => ensureString(entry.id) === id);
        if (target) {
          this.populateInternalForm(target);
        }
      });
    }
    if (this.dom.glInternalFacultyInput) {
      this.dom.glInternalFacultyInput.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
        this.renderInternalAcademicTreeForFaculty(value);
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

  setActiveApplicationView(view) {
    const normalized = view === "applicant" ? "applicant" : view === "internal" ? "internal" : "schedule";
    this.applicationView = normalized;
    const entries = [
      {
        key: "schedule",
        button: this.dom.glApplicationViewScheduleButton,
        panel: this.dom.glApplicationViewSchedulePanel
      },
      {
        key: "applicant",
        button: this.dom.glApplicationViewApplicantButton,
        panel: this.dom.glApplicationViewApplicantPanel
      },
      {
        key: "internal",
        button: this.dom.glApplicationViewInternalButton,
        panel: this.dom.glApplicationViewInternalPanel
      }
    ];
    entries.forEach(({ key, button, panel }) => {
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
    this.renderApplications();
  }

  getDefaultTeamCountPreview() {
    const rawValue = ensureString(this.dom.glTeamCountInput?.value).trim();
    if (!rawValue) {
      return deriveTeamCountFromConfig(this.config?.defaultTeams || this.config?.teams || []);
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      return deriveTeamCountFromConfig(this.config?.defaultTeams || this.config?.teams || []);
    }
    return count;
  }

  handleDefaultTeamCountChange() {
    if (!this.dom.glTeamCountInput) {
      return;
    }
    const rawValue = ensureString(this.dom.glTeamCountInput.value).trim();
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    if (!rawValue) {
      this.config.defaultTeams = [];
      this.config.teams = [];
      this.renderScheduleTeamControls();
      this.renderApplications();
      return;
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      this.setStatus(error, "error");
      return;
    }
    const teams = buildSequentialTeams(count);
    this.config.defaultTeams = teams;
    this.config.teams = teams;
    this.renderScheduleTeamControls();
    this.renderApplications();
  }

  setScheduleTeamOverride(scheduleId, count) {
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    if (!this.config.scheduleTeams || typeof this.config.scheduleTeams !== "object") {
      this.config.scheduleTeams = {};
    }
    this.config.scheduleTeams[scheduleId] = {
      teams: buildSequentialTeams(count),
      teamCount: count
    };
  }

  handleScheduleTeamInput(input) {
    const wrapper = input.closest("[data-schedule-id]");
    const scheduleId = ensureString(wrapper?.dataset.scheduleId);
    if (!scheduleId) {
      return;
    }
    const rawValue = ensureString(input.value).trim();
    if (!rawValue) {
      if (this.config && this.config.scheduleTeams && typeof this.config.scheduleTeams === "object") {
        delete this.config.scheduleTeams[scheduleId];
      }
      input.value = "";
      input.dataset.previousValue = "";
      this.updateScheduleTeamNote(wrapper, scheduleId);
      this.renderApplications();
      return;
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      input.setCustomValidity(error);
      input.reportValidity();
      this.setStatus(error, "error");
      const previous = ensureString(input.dataset.previousValue);
      if (previous) {
        input.value = previous;
      } else {
        input.value = "";
      }
      return;
    }
    input.setCustomValidity("");
    input.value = String(count);
    input.dataset.previousValue = String(count);
    this.setScheduleTeamOverride(scheduleId, count);
    this.updateScheduleTeamNote(wrapper, scheduleId);
    this.renderApplications();
  }

  updateScheduleTeamNote(element, scheduleId) {
    if (!element) {
      return;
    }
    const defaultCount = this.getDefaultTeamCountPreview();
    const note = element.querySelector('[data-role="schedule-note"]');
    const input = element.querySelector('[data-schedule-team-input]');
    if (input instanceof HTMLInputElement) {
      input.placeholder = defaultCount > 0 ? `${defaultCount}` : "";
    }
    const scheduleTeams = this.config?.scheduleTeams && typeof this.config.scheduleTeams === "object"
      ? this.config.scheduleTeams
      : {};
    const hasOverride = Object.prototype.hasOwnProperty.call(scheduleTeams, scheduleId);
    const entry = hasOverride ? scheduleTeams[scheduleId] : null;
    let overrideCount = null;
    if (entry) {
      if (Number.isFinite(entry?.teamCount)) {
        overrideCount = Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(Number(entry.teamCount))));
      } else if (Array.isArray(entry?.teams)) {
        overrideCount = deriveTeamCountFromConfig(entry.teams);
      }
    }
    let message = "";
    if (Number.isFinite(overrideCount)) {
      if (overrideCount > 0) {
        message = `${overrideCount}班を自動生成します。`;
      } else {
        message = "この日程では班を作成しません。";
      }
    } else if (defaultCount > 0) {
      message = `未入力の場合は${defaultCount}班で自動生成されます。`;
    } else {
      message = "未入力の場合は班を作成しません。";
    }
    if (note) {
      note.textContent = message;
    }
  }

  createScheduleTeamRowElement() {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.createScheduleTeamRowElement();
  }

  renderScheduleTeamControls() {
    // GlRendererに委譲（フェーズ2 段階2）
    this.renderer.renderScheduleTeamControls(
      this.currentSchedules,
      this.applications,
      this.config
    );
  }

  collectScheduleTeamSettings(defaultTeams = []) {
    const container = this.dom.glScheduleTeamsList;
    if (!container) {
      return {};
    }
    const inputs = Array.from(container.querySelectorAll("[data-schedule-team-input]"));
    const overrides = {};
    const seen = new Set();
    let firstInvalid = null;
    inputs.forEach((element) => {
      if (!(element instanceof HTMLInputElement)) {
        return;
      }
      const wrapper = element.closest("[data-schedule-id]");
      const scheduleId = ensureString(wrapper?.dataset.scheduleId);
      if (!scheduleId) {
        return;
      }
      seen.add(scheduleId);
      const rawValue = ensureString(element.value).trim();
      if (!rawValue) {
        element.setCustomValidity("");
        return;
      }
      const { count, error } = parseTeamCount(rawValue);
      if (error) {
        element.setCustomValidity(error);
        element.reportValidity();
        if (!firstInvalid) {
          firstInvalid = element;
        }
        return;
      }
      element.setCustomValidity("");
      overrides[scheduleId] = {
        teams: buildSequentialTeams(count),
        teamCount: count
      };
    });
    if (firstInvalid) {
      this.setStatus(firstInvalid.validationMessage || "班の数を確認してください。", "error");
      firstInvalid.focus();
      return null;
    }
    const existing = this.config?.scheduleTeams && typeof this.config.scheduleTeams === "object"
      ? this.config.scheduleTeams
      : {};
    Object.entries(existing).forEach(([scheduleId, value]) => {
      if (seen.has(scheduleId)) {
        return;
      }
      overrides[scheduleId] = value;
    });
    return normalizeScheduleTeamConfig(overrides, defaultTeams);
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
    this.setActiveTab("config");
    this.renderApplications();
    this.renderScheduleTeamControls();
    if (this.dom.glTeamCountInput) {
      this.dom.glTeamCountInput.value = "";
    }
  }

  resetContext(options = {}) {
    const reason = ensureString(options?.reason);
    const shouldPreserve = reason === "schedule-change" && !options?.clearDataset;
    if (shouldPreserve) {
      return;
    }
    this.applications = [];
    this.assignments = new Map();
    this.renderApplications();
    this.renderScheduleTeamControls();
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
    const hasEventId = Object.prototype.hasOwnProperty.call(detail, "eventId");
    const eventId = hasEventId ? ensureString(detail.eventId) : this.currentEventId;
    const eventName = ensureString(detail.eventName);
    const changed = eventId !== this.currentEventId;
    this.currentEventId = eventId;
    this.currentEventName = eventName || this.currentEventName || eventId;
    this.refreshSchedules();
    this.updateConfigVisibility();
    this.updateSlugPreview();
    this.setStatus("", "info");
    if (changed) {
      this.filter = "all";
      if (this.dom.glFilterSelect) {
        this.dom.glFilterSelect.value = "all";
      }
      this.applicantSourceFilter = "all";
      this.applicantRoleFilter = "all";
      if (this.dom.glApplicantSourceFilter) {
        this.dom.glApplicantSourceFilter.value = "all";
      }
      if (this.dom.glApplicantRoleFilter) {
        this.dom.glApplicantRoleFilter.value = "all";
      }
      this.resetInternalForm();
      this.setActiveTab("config");
      this.attachListeners();
    }
  }

  detachListeners() {
    if (typeof this.configUnsubscribe === "function") {
      this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
    // GlApplicationManagerに委譲（フェーズ2 段階3）
    this.applicationManager.unsubscribeApplications();
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
      this.resetInternalForm();
      this.renderApplications();
      return;
    }
    this.loading = true;
    this.renderApplications();
    this.configUnsubscribe = onValue(getGlEventConfigRef(this.currentEventId), (snapshot) => {
      this.applyConfig(snapshot.val() || {});
    });
    // GlApplicationManagerに委譲（フェーズ2 段階3）
    this.loading = true;
    this.applicationManager.subscribeApplications(this.currentEventId);
    this.assignmentsUnsubscribe = onValue(getGlAssignmentsRef(this.currentEventId), (snapshot) => {
      this.assignments = normalizeAssignmentSnapshot(snapshot.val() || {});
      this.renderApplications();
    });
  }

  applyConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const schedules = normalizeScheduleConfig(config.schedules);
    const defaultTeams = sanitizeTeamList(config.defaultTeams || config.teams || []);
    const scheduleTeams = normalizeScheduleTeamConfig(config.scheduleTeams || {}, defaultTeams);
    this.config = {
      slug: ensureString(config.slug),
      faculties: normalizeFacultyList(config.faculties || []),
      teams: defaultTeams,
      defaultTeams,
      scheduleTeams,
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
      const teamCount = deriveTeamCountFromConfig(this.config.defaultTeams);
      this.dom.glTeamCountInput.value = teamCount > 0 ? String(teamCount) : "";
    }
    this.updateSlugPreview();
    this.refreshSchedules();
    this.syncInternalAcademicInputs();
    this.renderApplications();
  }

  applySharedCatalog(raw) {
    const faculties = normalizeFacultyList(raw);
    const meta = raw && typeof raw === "object" ? raw : {};
    this.sharedFaculties = faculties;
    this.sharedSignature = createSignature(faculties);
    this.sharedMeta = {
      updatedAt: Number(meta.updatedAt) || 0,
      updatedByUid: ensureString(meta.updatedByUid),
      updatedByName: ensureString(meta.updatedByName)
    };
    this.syncInternalAcademicInputs();
    this.updateConfigVisibility();
  }

  getConfigFaculties() {
    return Array.isArray(this.config?.faculties) ? this.config.faculties : [];
  }

  useSharedFaculties() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    if (!this.sharedFaculties.length) {
      this.setStatus("共通設定が読み込まれていません。", "warning");
      return;
    }
    const faculties = normalizeFacultyList(this.sharedFaculties);
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    this.config.faculties = faculties;
    this.setStatus("共通設定を反映しました。必要に応じて保存してください。", "success");
  }

  // syncScheduleSummaryCache()を削除 - この処理は設定保存時(saveConfig())にのみ必要
  // イベント選択時の自動実行は権限エラーを引き起こすため削除

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
    if (this.dom.glApplicantSourceFilter) {
      this.dom.glApplicantSourceFilter.disabled = !hasEvent;
    }
    if (this.dom.glApplicantRoleFilter) {
      this.dom.glApplicantRoleFilter.disabled = !hasEvent;
    }
    if (this.dom.glFilterSelect) {
      this.dom.glFilterSelect.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewScheduleButton) {
      this.dom.glApplicationViewScheduleButton.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewApplicantButton) {
      this.dom.glApplicationViewApplicantButton.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewInternalButton) {
      this.dom.glApplicationViewInternalButton.disabled = !hasEvent;
    }
    const internalControls = [
      this.dom.glInternalNameInput,
      this.dom.glInternalEmailInput,
      this.dom.glInternalPhoneticInput,
      this.dom.glInternalGradeInput,
      this.dom.glInternalFacultyInput,
      this.dom.glInternalAcademicCustomInput,
      this.dom.glInternalClubInput,
      this.dom.glInternalStudentIdInput,
      this.dom.glInternalNoteInput,
      this.dom.glInternalSubmitButton,
      this.dom.glInternalResetButton
    ];
    internalControls.forEach((element) => {
      if (!element) return;
      element.disabled = !hasEvent;
    });
    if (this.dom.glInternalAcademicFields) {
      this.dom.glInternalAcademicFields
        .querySelectorAll("select")
        .forEach((select) => {
          if (select instanceof HTMLSelectElement) {
            select.disabled = !hasEvent;
          }
        });
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = !hasEvent || !this.internalEditingId;
    }
  }

  getDefaultSlug() {
    return ensureString(this.currentEventId);
  }

  updateSlugPreview() {
    const slug = this.getDefaultSlug();
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.disabled = !slug || !this.currentEventId;
    }
  }

  async saveConfig() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = this.getDefaultSlug();
    const startAt = toTimestamp(this.dom.glPeriodStartInput?.value || "");
    const endAt = toTimestamp(this.dom.glPeriodEndInput?.value || "");
    const faculties = normalizeFacultyList(this.config?.faculties || []);
    const { count: teamCount, error: teamError } = parseTeamCount(this.dom.glTeamCountInput?.value);
    if (teamError) {
      this.setStatus(teamError, "error");
      if (this.dom.glTeamCountInput) {
        this.dom.glTeamCountInput.focus();
      }
      return;
    }
    const teams = buildSequentialTeams(teamCount);
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
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    this.config.faculties = faculties;
    this.config.defaultTeams = teams;
    this.config.teams = teams;
    const scheduleTeams = this.collectScheduleTeamSettings(teams);
    if (scheduleTeams === null) {
      return;
    }
    this.config.scheduleTeams = scheduleTeams;
    // 完全正規化: eventNameは削除（eventIdから取得可能）
    const configPayload = {
      slug,
      startAt,
      endAt,
      faculties,
      teams,
      defaultTeams: teams,
      scheduleTeams,
      schedules: scheduleSummary,
      guidance: ensureString(this.config?.guidance),
      updatedAt: serverTimestamp(),
      eventId: this.currentEventId
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
    const slug = this.getDefaultSlug();
    if (!slug) {
      this.setStatus("イベントIDを取得できませんでした。", "error");
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

  setInternalStatus(message, variant = "info") {
    if (!this.dom.glInternalStatus) return;
    const text = ensureString(message);
    this.dom.glInternalStatus.textContent = text;
    this.dom.glInternalStatus.dataset.variant = variant;
    this.dom.glInternalStatus.hidden = !text;
  }

  buildInternalDefaultShifts() {
    const shifts = { __default__: true };
    this.currentSchedules.forEach((schedule) => {
      const id = ensureString(schedule?.id);
      if (id) {
        shifts[id] = true;
      }
    });
    return shifts;
  }

  renderInternalShiftList(shiftsOverride = null) {
    // GlRendererに委譲（フェーズ2 段階2）
    const schedules = Array.isArray(this.currentSchedules) ? this.currentSchedules : [];
    const shiftMap = shiftsOverride && typeof shiftsOverride === "object"
      ? { __default__: true, ...shiftsOverride }
      : this.internalEditingShifts && typeof this.internalEditingShifts === "object"
        ? { __default__: true, ...this.internalEditingShifts }
        : this.buildInternalDefaultShifts();
    this.renderer.renderInternalShiftList(schedules, shiftMap);
  }

  collectInternalShifts() {
    const container = this.dom.glInternalShiftList;
    const shifts = { __default__: true };
    if (!container) {
      return this.buildInternalDefaultShifts();
    }
    const inputs = Array.from(container.querySelectorAll("input[type='checkbox'][data-schedule-id]"));
    if (!inputs.length) {
      return this.buildInternalDefaultShifts();
    }
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const id = ensureString(input.dataset.scheduleId);
      if (!id) {
        return;
      }
      shifts[id] = Boolean(input.checked);
    });
    return shifts;
  }

  collectInternalFormData() {
    const name = ensureString(this.dom.glInternalNameInput?.value);
    if (!name) {
      this.setInternalStatus("氏名を入力してください。", "error");
      this.dom.glInternalNameInput?.focus();
      return null;
    }
    const email = ensureString(this.dom.glInternalEmailInput?.value);
    if (!email) {
      this.setInternalStatus("メールアドレスを入力してください。", "error");
      this.dom.glInternalEmailInput?.focus();
      return null;
    }
    const faculty = ensureString(this.dom.glInternalFacultyInput?.value);
    if (!faculty || faculty === INTERNAL_CUSTOM_OPTION_VALUE) {
      this.setInternalStatus("学部を選択してください。", "error");
      this.dom.glInternalFacultyInput?.focus();
      return null;
    }
    const academic = this.collectInternalAcademicState();
    if (academic.pendingSelect instanceof HTMLSelectElement) {
      const label = ensureString(academic.pendingSelect.dataset.levelLabel) || "所属";
      this.setInternalStatus(`${label}を選択してください。`, "error");
      academic.pendingSelect.focus();
      return null;
    }
    if (!academic.path.length) {
      const label = this.internalAcademicState.currentCustomLabel || "所属情報";
      this.setInternalStatus(`${label}を選択してください。`, "error");
      if (academic.firstSelect instanceof HTMLSelectElement) {
        academic.firstSelect.focus();
      }
      return null;
    }
    if (academic.requiresCustom && !academic.customValue) {
      const label = academic.customLabel || this.internalAcademicState.currentCustomLabel || "所属";
      this.setInternalStatus(`${label}を入力してください。`, "error");
      this.dom.glInternalAcademicCustomInput?.focus();
      return null;
    }
    const departmentSegment = academic.path[academic.path.length - 1];
    const department = ensureString(departmentSegment?.value);
    if (!department) {
      const label = ensureString(departmentSegment?.label) || "所属";
      this.setInternalStatus(`${label}を入力してください。`, "error");
      if (departmentSegment?.element instanceof HTMLElement) {
        departmentSegment.element.focus();
      }
      return null;
    }
    const academicPath = academic.path
      .map((segment) => ({
        label: ensureString(segment.label),
        value: ensureString(segment.value),
        display: ensureString(segment.displayLabel ?? segment.value),
        isCustom: Boolean(segment.isCustom)
      }))
      .filter((segment) => segment.value);
    const shifts = this.collectInternalShifts();
    return {
      name,
      phonetic: ensureString(this.dom.glInternalPhoneticInput?.value),
      email,
      grade: ensureString(this.dom.glInternalGradeInput?.value),
      faculty,
      department,
      academicPath,
      club: ensureString(this.dom.glInternalClubInput?.value),
      studentId: ensureString(this.dom.glInternalStudentIdInput?.value),
      note: ensureString(this.dom.glInternalNoteInput?.value),
      shifts
    };
  }

  populateInternalForm(application) {
    if (!application) {
      return;
    }
    this.internalEditingId = ensureString(application.id);
    if (this.dom.glInternalIdInput) {
      this.dom.glInternalIdInput.value = this.internalEditingId;
    }
    if (this.dom.glInternalNameInput) {
      this.dom.glInternalNameInput.value = ensureString(application.name);
    }
    if (this.dom.glInternalPhoneticInput) {
      this.dom.glInternalPhoneticInput.value = ensureString(application.phonetic);
    }
    if (this.dom.glInternalEmailInput) {
      this.dom.glInternalEmailInput.value = ensureString(application.email);
    }
    if (this.dom.glInternalGradeInput) {
      this.dom.glInternalGradeInput.value = ensureString(application.grade);
    }
    const facultyValue = ensureString(application.faculty);
    if (this.dom.glInternalFacultyInput) {
      this.dom.glInternalFacultyInput.value = facultyValue;
    }
    this.renderInternalAcademicTreeForFaculty(facultyValue);
    this.applyInternalAcademicPath(application);
    if (this.dom.glInternalClubInput) {
      this.dom.glInternalClubInput.value = ensureString(application.club);
    }
    if (this.dom.glInternalStudentIdInput) {
      this.dom.glInternalStudentIdInput.value = ensureString(application.studentId);
    }
    if (this.dom.glInternalNoteInput) {
      this.dom.glInternalNoteInput.value = ensureString(application.note);
    }
    this.internalEditingShifts = application.shifts && typeof application.shifts === "object"
      ? { __default__: true, ...application.shifts }
      : this.buildInternalDefaultShifts();
    this.renderInternalShiftList(this.internalEditingShifts);
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = !this.currentEventId;
    }
    if (this.dom.glInternalSubmitButton) {
      this.dom.glInternalSubmitButton.textContent = "内部スタッフを更新";
    }
    this.setInternalStatus("編集モードです。変更後に保存してください。", "info");
  }

  applyInternalAcademicPath(application) {
    const path = Array.isArray(application?.academicPath) ? application.academicPath : [];
    const department = ensureString(application?.department);
    let depth = 0;
    path.forEach((segment) => {
      const value = ensureString(segment?.value ?? segment);
      const select = this.dom.glInternalAcademicFields?.querySelector(
        `.gl-academic-select[data-depth="${depth}"]`
      );
      if (!(select instanceof HTMLSelectElement)) {
        return;
      }
      if (segment?.isCustom) {
        select.value = INTERNAL_CUSTOM_OPTION_VALUE;
        if (this.dom.glInternalAcademicCustomInput) {
          this.dom.glInternalAcademicCustomInput.value = value;
        }
      } else {
        select.value = value;
      }
      this.handleInternalAcademicLevelChange(select);
      depth += 1;
    });
    if (!path.length && department) {
      const firstSelect = this.dom.glInternalAcademicFields?.querySelector(
        ".gl-academic-select[data-depth=\"0\"]"
      );
      if (firstSelect instanceof HTMLSelectElement && this.internalUnitLevelMap.has(firstSelect)) {
        firstSelect.value = INTERNAL_CUSTOM_OPTION_VALUE;
        this.handleInternalAcademicLevelChange(firstSelect);
      }
      if (this.dom.glInternalAcademicCustomInput) {
        this.dom.glInternalAcademicCustomInput.value = department;
      }
    }
  }

  resetInternalForm() {
    this.internalEditingId = "";
    this.internalEditingShifts = this.buildInternalDefaultShifts();
    if (this.dom.glInternalForm) {
      this.dom.glInternalForm.reset();
    }
    if (this.dom.glInternalFacultyInput) {
      this.dom.glInternalFacultyInput.value = "";
    }
    if (this.dom.glInternalIdInput) {
      this.dom.glInternalIdInput.value = "";
    }
    this.syncInternalAcademicInputs();
    if (this.dom.glInternalSubmitButton) {
      this.dom.glInternalSubmitButton.textContent = "内部スタッフを追加";
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = true;
    }
    this.renderInternalShiftList(this.internalEditingShifts);
    this.setInternalStatus("", "info");
    this.updateConfigVisibility();
  }

  async handleInternalSubmit() {
    if (!this.currentEventId) {
      this.setInternalStatus("イベントを選択してください。", "warning");
      return;
    }
    const data = this.collectInternalFormData();
    if (!data) {
      return;
    }
    const existing = this.applications.find((entry) => ensureString(entry.id) === ensureString(this.internalEditingId));
    // GlApplicationManagerに委譲（フェーズ2 段階3）
    await this.applicationManager.saveInternalApplication(data, this.internalEditingId, this.applications);
    this.resetInternalForm();
    this.setInternalStatus(existing ? "内部スタッフを更新しました。" : "内部スタッフを追加しました。", "success");
    this.renderApplications();
  }

  async handleInternalDelete() {
    if (!this.currentEventId || !this.internalEditingId) {
      return;
    }
    // GlApplicationManagerに委譲（フェーズ2 段階3）
    await this.applicationManager.deleteInternalApplication(this.internalEditingId, this.assignments);
    this.resetInternalForm();
    this.setInternalStatus("内部スタッフを削除しました。", "success");
    this.renderApplications();
  }

  renderInternalList() {
    // GlRendererに委譲（フェーズ2 段階2）
    this.renderer.renderInternalList(this.applications, this.currentEventId);
  }

  renderApplications() {
    const board = this.dom.glApplicationBoard;
    const list = this.dom.glApplicationList;
    const viewsContainer = this.dom.glApplicationViews;
    if (board) {
      board.innerHTML = "";
    }
    if (list) {
      list.innerHTML = "";
    }
    this.renderInternalList();
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
      if (viewsContainer) {
        viewsContainer.hidden = true;
      }
      return;
    }
    if (this.dom.glApplicationLoading) {
      this.dom.glApplicationLoading.hidden = !this.loading;
    }
    if (viewsContainer) {
      viewsContainer.hidden = this.loading;
    }
    if (this.loading) {
      if (this.dom.glApplicationEmpty) {
        this.dom.glApplicationEmpty.hidden = true;
      }
      return;
    }
    const schedules = buildRenderableSchedules(
      this.currentSchedules,
      this.config?.schedules || [],
      this.applications
    );
    const matchesFilter = this.createBucketMatcher();
    const sourceFilter = ensureString(this.applicantSourceFilter) || "all";
    const roleFilter = ensureString(this.applicantRoleFilter) || "all";
    const filteredApplications = this.applications.filter((application) => {
      if (!application) {
        return false;
      }
      const sourceType = application.sourceType === "internal" ? "internal" : "external";
      if (sourceFilter === "internal" && sourceType !== "internal") {
        return false;
      }
      if (sourceFilter === "external" && sourceType !== "external") {
        return false;
      }
      const role = ensureString(application.role);
      if (roleFilter !== "all" && role !== roleFilter) {
        return false;
      }
      return schedules.some((schedule) => {
        const available = isApplicantAvailableForSchedule(application, schedule.id);
        const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
        const value = resolveEffectiveAssignmentValue(application, assignment);
        const bucketKey = this.resolveAssignmentBucket(value, available);
        return matchesFilter(bucketKey);
      });
    });
    const scheduleResult = this.renderer.renderScheduleBoard(schedules, filteredApplications, matchesFilter);
    const applicantResult = this.renderer.renderApplicantList(schedules, filteredApplications, matchesFilter);
    if (viewsContainer) {
      viewsContainer.hidden = false;
    }
    if (this.dom.glApplicationEmpty) {
      const activeView = this.applicationView;
      const shouldShowEmpty = activeView === "applicant"
        ? applicantResult.visibleCount === 0
        : activeView === "internal"
          ? false
          : scheduleResult.visibleCount === 0;
      this.dom.glApplicationEmpty.hidden = !shouldShowEmpty;
    }
  }

  renderScheduleBoard(schedules, applications, matchesFilter) {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.renderScheduleBoard(schedules, applications, matchesFilter);
  }

  renderApplicantList(schedules, applications, matchesFilter) {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.renderApplicantList(schedules, applications, matchesFilter);
  }

  createApplicantMatrixRow({ application, schedules, matchesFilter }) {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.createApplicantMatrixRow({ application, schedules, matchesFilter });
  }

  createApplicantMatrixCell({
    application,
    schedule,
    assignment,
    assignmentValue,
    available,
    teams,
    matchesFilter
  }) {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.createApplicantMatrixCell({
      application,
      schedule,
      assignment,
      assignmentValue,
      available,
      teams,
      matchesFilter
    });
  }

  buildShiftTablePrintPreview({ printSettings } = {}) {
    if (!this.currentEventId) {
      return { message: "イベントを選択してください。" };
    }

    const schedules = buildRenderableSchedules(
      this.currentSchedules,
      this.config?.schedules || [],
      this.applications
    );
    const printableSchedules = schedules.map((schedule) => ({
      id: ensureString(schedule.id),
      label: ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程",
      date: ensureString(schedule.date)
    }));

    const applications = Array.isArray(this.applications) ? this.applications.filter(Boolean) : [];
    if (!applications.length) {
      return { message: "印刷できるシフト情報がありません。" };
    }

    const entries = applications.map((application) => {
      const values = {};
      printableSchedules.forEach((schedule) => {
        const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
        const assignmentValue = resolveEffectiveAssignmentValue(application, assignment);
        const assignmentLabel = formatAssignmentLabelForPrint(assignmentValue);
        const responseDescriptor = resolveScheduleResponseValue(application, schedule.id);
        const responseText = ensureString(responseDescriptor.text);
        const displayValue = assignmentLabel || responseText || "未回答";
        values[schedule.id] = displayValue;
      });
      return {
        id: ensureString(application.id),
        name: ensureString(application.name) || "(無記入)",
        phonetic: ensureString(application.phonetic),
        grade: ensureString(application.grade),
        department: buildAcademicPathText(application),
        email: ensureString(application.email),
        sourceType: application.sourceType === "internal" ? "internal" : "external",
        values
      };
    });

    entries.sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, "ja", { numeric: true, sensitivity: "base" });
      if (nameCompare !== 0) {
        return nameCompare;
      }
      const gradeCompare = getGradeSortWeight(a.grade) - getGradeSortWeight(b.grade);
      if (gradeCompare !== 0) {
        return gradeCompare;
      }
      const departmentA = ensureString(a.department);
      const departmentB = ensureString(b.department);
      return departmentA.localeCompare(departmentB, "ja", { numeric: true, sensitivity: "base" });
    });

    const internalEntries = entries.filter((entry) => entry.sourceType === "internal");
    const externalEntries = entries.filter((entry) => entry.sourceType !== "internal");
    const sections = [];
    if (internalEntries.length) {
      sections.push({ label: "運営スタッフ", entries: internalEntries });
    }
    if (externalEntries.length) {
      sections.push({ label: "協力スタッフ", entries: externalEntries });
    }

    if (!sections.length) {
      return { message: "印刷できるシフト情報がありません。" };
    }

    try {
      return buildGlShiftTablePrintHtml({
        eventName: this.currentEventName,
        schedules: printableSchedules,
        sections,
        generatedAt: new Date(),
        printOptions: printSettings
      });
    } catch (error) {
      logPrintWarn("GL shift print generation failed", error);
      return { message: "シフト表の印刷データ生成に失敗しました。" };
    }
  }

  createBucketMatcher() {
    const filter = this.filter || "all";
    if (filter === "unassigned") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_UNASSIGNED;
    }
    if (filter === "assigned") {
      return (bucket) => bucket.startsWith("team:");
    }
    if (filter === "absent") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_ABSENT;
    }
    if (filter === "staff") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_STAFF;
    }
    return () => true;
  }

  getAssignmentForSchedule(glId, scheduleId) {
    if (!glId) {
      return null;
    }
    const entry = this.assignments.get(glId) || null;
    if (!entry) {
      return null;
    }
    const scheduleKey = ensureString(scheduleId);
    if (scheduleKey && entry.schedules instanceof Map && entry.schedules.has(scheduleKey)) {
      return entry.schedules.get(scheduleKey) || null;
    }
    return entry.fallback || null;
  }

  resolveAssignmentBucket(value, available) {
    if (value === ASSIGNMENT_VALUE_ABSENT) {
      return ASSIGNMENT_BUCKET_ABSENT;
    }
    if (value === ASSIGNMENT_VALUE_STAFF) {
      return ASSIGNMENT_BUCKET_STAFF;
    }
    if (value === ASSIGNMENT_VALUE_UNAVAILABLE) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    if (value) {
      return `team:${value}`;
    }
    if (!available) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    return ASSIGNMENT_BUCKET_UNASSIGNED;
  }

  buildScheduleSection(schedule, applications, matchesFilter) {
    // GlRendererに委譲（フェーズ2 段階2）
    return this.renderer.buildScheduleSection(schedule, applications, matchesFilter);
  }

  async applyAssignment(glId, scheduleId, value) {
    if (!this.currentEventId || !glId || !scheduleId) {
      return;
    }
    const { status, teamId } = resolveAssignmentStatus(value);
    const basePath = `glAssignments/${this.currentEventId}/${scheduleId}/${glId}`;
    if (!status && !teamId) {
      await update(ref(database), {
        [basePath]: null
      });
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
    await update(ref(database), {
      [basePath]: payload
    });
  }
}
