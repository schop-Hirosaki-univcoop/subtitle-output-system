// gl-renderer.js: GLツール用のUI描画機能
// gl-panel.js から分離（フェーズ2 段階2）

import { ensureString } from "../helpers.js";
import {
  ASSIGNMENT_VALUE_ABSENT,
  ASSIGNMENT_VALUE_STAFF,
  ASSIGNMENT_VALUE_UNAVAILABLE,
  MAX_TEAM_COUNT,
  INTERNAL_GRADE_OPTIONS,
  INTERNAL_CUSTOM_OPTION_VALUE,
  buildRenderableSchedules,
  getScheduleTeams,
  buildScheduleBuckets,
  applyGradeBadge,
  getGradeSortWeight,
  resolveScheduleResponseValue,
  determineScheduleResponseVariant,
  formatAssignmentUpdatedLabel,
  buildAcademicPathText,
  buildAssignmentOptionsForApplication,
  resolveEffectiveAssignmentValue,
  isApplicantAvailableForSchedule,
  formatAssignmentLabelForPrint,
  deriveTeamCountFromConfig
} from "./gl-utils.js";
import { buildGlShiftTablePrintHtml, logPrintWarn } from "../../shared/print-utils.js";

/**
 * GlRenderer: GLツールのUI描画を担当するクラス
 * GlToolManagerからUI描画機能を分離（フェーズ2 段階2）
 */
export class GlRenderer {
  constructor(context) {
    // DOM要素への参照
    this.dom = context.dom;
    
    // 状態への参照（読み取り専用として使用）
    this.getState = context.getState || (() => ({}));
    
    // コールバック関数
    this.onInternalAcademicLevelChange = context.onInternalAcademicLevelChange || (() => {});
    this.getInternalFaculties = context.getInternalFaculties || (() => []);
    this.getAssignmentForSchedule = context.getAssignmentForSchedule || (() => null);
    this.resolveAssignmentBucket = context.resolveAssignmentBucket || (() => "");
    this.createBucketMatcher = context.createBucketMatcher || (() => () => true);
    this.updateScheduleTeamNote = context.updateScheduleTeamNote || (() => {});
  }

  // ============================================
  // 内部スタッフ関連の描画メソッド
  // ============================================

  /**
   * 内部スタッフの学年オプションを描画
   */
  renderInternalGradeOptions() {
    const select = this.dom.glInternalGradeInput;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const current = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "学年を選択してください";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.dataset.placeholder = "true";
    select.append(placeholder);
    INTERNAL_GRADE_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    if (INTERNAL_GRADE_OPTIONS.includes(current)) {
      select.value = current;
    }
  }

  /**
   * 内部スタッフの学部を描画
   */
  renderInternalFaculties() {
    const select = this.dom.glInternalFacultyInput;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const faculties = this.getInternalFaculties();
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
    const customOption = document.createElement("option");
    customOption.value = INTERNAL_CUSTOM_OPTION_VALUE;
    customOption.textContent = "その他";
    select.append(customOption);
    if (faculties.some((entry) => ensureString(entry.faculty) === current)) {
      select.value = current;
    }
  }

  /**
   * 内部スタッフの学術レベルを描画
   * @param {Object} level - 学術レベルの定義
   * @param {number} depth - 深さ
   * @param {WeakMap} unitLevelMap - レベルマップ（状態管理用）
   * @param {Function} onLevelChange - レベル変更時のコールバック
   */
  renderInternalAcademicLevel(level, depth, unitLevelMap, onLevelChange) {
    if (!this.dom.glInternalAcademicFields || !this.dom.glInternalAcademicSelectTemplate) return;
    const fragment = this.dom.glInternalAcademicSelectTemplate.content.cloneNode(true);
    const field = fragment.querySelector(".gl-academic-field");
    const labelEl = field?.querySelector(".gl-academic-label");
    const select = field?.querySelector(".gl-academic-select");
    if (!(field instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) return;
    field.dataset.depth = String(depth);
    const selectId = `gl-internal-academic-select-${depth}`;
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
      customOption.value = INTERNAL_CUSTOM_OPTION_VALUE;
      customOption.textContent = "その他";
      customOption.dataset.isCustom = "true";
      select.append(customOption);
    }
    if (unitLevelMap) {
      unitLevelMap.set(select, level);
    }
    select.addEventListener("change", (event) => {
      if (event.target instanceof HTMLSelectElement) {
        onLevelChange(event.target);
      }
    });
    this.dom.glInternalAcademicFields.append(field);
  }

  /**
   * 内部スタッフのシフトリストを描画
   * @param {Array} schedules - スケジュール配列
   * @param {Object} shiftMap - シフトマップ
   */
  renderInternalShiftList(schedules = [], shiftMap = {}) {
    const container = this.dom.glInternalShiftList;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    if (!schedules.length) {
      const note = document.createElement("p");
      note.className = "gl-internal-shifts__empty";
      note.textContent = "日程がまだありません。募集設定から日程を追加してください。";
      container.append(note);
      return;
    }
    schedules.forEach((schedule) => {
      const wrapper = document.createElement("label");
      wrapper.className = "gl-internal-shifts__item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "gl-internal-shifts__checkbox";
      checkbox.dataset.scheduleId = ensureString(schedule.id);
      const key = ensureString(schedule.id);
      const fallback = Object.prototype.hasOwnProperty.call(shiftMap, "__default__")
        ? Boolean(shiftMap.__default__)
        : true;
      const value = Object.prototype.hasOwnProperty.call(shiftMap, key) ? Boolean(shiftMap[key]) : fallback;
      checkbox.checked = value;
      const label = document.createElement("span");
      label.className = "gl-internal-shifts__label";
      label.textContent = ensureString(schedule.label) || ensureString(schedule.date) || key || "日程";
      const date = ensureString(schedule.date);
      if (date) {
        const meta = document.createElement("span");
        meta.className = "gl-internal-shifts__meta";
        meta.textContent = date;
        label.append(document.createElement("br"), meta);
      }
      wrapper.append(checkbox, label);
      container.append(wrapper);
    });
  }

  /**
   * 内部スタッフリストを描画
   * @param {Array} applications - 応募者配列
   * @param {string} currentEventId - 現在のイベントID
   */
  renderInternalList(applications = [], currentEventId = "") {
    const list = this.dom.glInternalList;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    if (!currentEventId) {
      const note = document.createElement("li");
      note.className = "gl-internal-list__empty";
      note.textContent = "イベントを選択してください。";
      list.append(note);
      return;
    }
    const entries = applications
      .filter((application) => application && application.sourceType === "internal")
      .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name, "ja", { numeric: true }));
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "gl-internal-list__empty";
      empty.textContent = "内部スタッフはまだ登録されていません。";
      list.append(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "gl-internal-list__item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gl-internal-list__button";
      button.dataset.internalId = ensureString(entry.id);
      const name = document.createElement("span");
      name.className = "gl-internal-list__name";
      name.textContent = ensureString(entry.name) || "名前未設定";
      button.append(name);
      item.append(button);
      list.append(item);
    });
  }

  // ============================================
  // スケジュール班関連の描画メソッド
  // ============================================

  /**
   * スケジュール班の行要素を作成
   * @returns {HTMLElement} スケジュール班の行要素
   */
  createScheduleTeamRowElement() {
    const template = this.dom.glScheduleTeamTemplate;
    if (template?.content?.firstElementChild) {
      return template.content.firstElementChild.cloneNode(true);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "gl-schedule-team";
    const header = document.createElement("div");
    header.className = "gl-schedule-team__header";
    const title = document.createElement("div");
    title.className = "gl-schedule-team__title";
    const label = document.createElement("span");
    label.className = "gl-schedule-team__label";
    label.dataset.role = "schedule-label";
    const date = document.createElement("span");
    date.className = "gl-schedule-team__date";
    date.dataset.role = "schedule-date";
    title.append(label, date);
    const field = document.createElement("label");
    field.className = "gl-schedule-team__field";
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "gl-schedule-team__field-label";
    fieldLabel.textContent = "班の数";
    const input = document.createElement("input");
    input.className = "input input--dense gl-schedule-team__input";
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_TEAM_COUNT);
    input.step = "1";
    input.inputMode = "numeric";
    input.dataset.scheduleTeamInput = "true";
    field.append(fieldLabel, input);
    header.append(title, field);
    const note = document.createElement("p");
    note.className = "gl-schedule-team__note";
    note.dataset.role = "schedule-note";
    wrapper.append(header, note);
    return wrapper;
  }

  /**
   * スケジュール班コントロールを描画
   * @param {Array} schedules - スケジュール配列
   * @param {Array} applications - 応募者配列
   * @param {Object} config - 設定オブジェクト
   */
  renderScheduleTeamControls(schedules = [], applications = [], config = null) {
    const container = this.dom.glScheduleTeamsList;
    const empty = this.dom.glScheduleTeamsEmpty;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const renderableSchedules = buildRenderableSchedules(
      schedules,
      config?.schedules || [],
      applications
    );
    if (!renderableSchedules.length) {
      container.hidden = true;
      if (empty) {
        empty.hidden = false;
      }
      return;
    }
    container.hidden = false;
    if (empty) {
      empty.hidden = true;
    }
    const fragment = document.createDocumentFragment();
    const scheduleTeams = config?.scheduleTeams && typeof config.scheduleTeams === "object"
      ? config.scheduleTeams
      : {};
    renderableSchedules.forEach((schedule) => {
      const element = this.createScheduleTeamRowElement();
      element.dataset.scheduleId = ensureString(schedule.id);
      const labelEl = element.querySelector('[data-role="schedule-label"]');
      if (labelEl) {
        labelEl.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
      }
      const dateEl = element.querySelector('[data-role="schedule-date"]');
      if (dateEl) {
        const dateText = ensureString(schedule.date);
        dateEl.textContent = dateText;
        dateEl.hidden = !dateText;
      }
      const input = element.querySelector('[data-schedule-team-input]');
      if (input instanceof HTMLInputElement) {
        input.value = "";
        input.dataset.previousValue = "";
        const hasOverride = Object.prototype.hasOwnProperty.call(scheduleTeams, schedule.id);
        const entry = hasOverride ? scheduleTeams[schedule.id] : null;
        let overrideCount = null;
        if (entry) {
          if (Number.isFinite(entry?.teamCount)) {
            overrideCount = Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(Number(entry.teamCount))));
          } else if (Array.isArray(entry?.teams)) {
            overrideCount = deriveTeamCountFromConfig(entry.teams);
          }
        }
        if (Number.isFinite(overrideCount)) {
          input.value = String(overrideCount);
          input.dataset.previousValue = String(overrideCount);
        }
      }
      fragment.append(element);
      this.updateScheduleTeamNote(element, schedule.id);
    });
    container.append(fragment);
  }
}

