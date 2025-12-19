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
import { renderAcademicLevel } from "../tools/gl-academic-utils.js";

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
    // まず空にして、プレースホルダーを選択状態にする
    select.innerHTML = "";
    select.value = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "学年を選択してください";
    placeholder.disabled = true;
    placeholder.dataset.placeholder = "true";
    select.append(placeholder);
    INTERNAL_GRADE_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    // 既存の値が有効な場合のみ設定（無効な場合は空のまま）
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
    // まず空にして、プレースホルダーを選択状態にする
    select.innerHTML = "";
    select.value = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "学部を選択してください";
    placeholder.disabled = true;
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
    // 既存の値が有効な場合のみ設定（無効な場合は空のまま）
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
    renderAcademicLevel(
      level,
      depth,
      this.dom.glInternalAcademicFields,
      this.dom.glInternalAcademicSelectTemplate,
      unitLevelMap,
      onLevelChange,
      "gl-internal-academic-select"
    );
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
    // 日付順にソート（startAtまたはdateでソート）
    const sortedSchedules = [...schedules].sort((a, b) => {
      const aTime = a.startAt || (a.date ? Date.parse(a.date) : 0) || 0;
      const bTime = b.startAt || (b.date ? Date.parse(b.date) : 0) || 0;
      return aTime - bTime;
    });
    sortedSchedules.forEach((schedule) => {
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

  // ============================================
  // 応募者・スケジュール関連の描画メソッド
  // ============================================

  /**
   * スケジュールボードを描画
   * @param {Array} schedules - スケジュール配列
   * @param {Array} applications - 応募者配列
   * @param {Function} matchesFilter - フィルタマッチ関数
   * @returns {Object} 描画結果（visibleCount）
   */
  renderScheduleBoard(schedules, applications, matchesFilter) {
    const board = this.dom.glApplicationBoard;
    if (!board) {
      return { visibleCount: 0 };
    }
    board.innerHTML = "";
    const fragment = document.createDocumentFragment();
    let totalVisibleEntries = 0;
    schedules.forEach((schedule) => {
      const section = this.buildScheduleSection(schedule, applications, matchesFilter);
      if (!section) {
        return;
      }
      fragment.append(section.element);
      totalVisibleEntries += section.visibleCount;
    });
    board.append(fragment);
    return { visibleCount: totalVisibleEntries };
  }

  /**
   * 応募者リストを描画
   * @param {Array} schedules - スケジュール配列
   * @param {Array} applications - 応募者配列
   * @param {Function} matchesFilter - フィルタマッチ関数
   * @returns {Object} 描画結果（visibleCount）
   */
  renderApplicantList(schedules, applications, matchesFilter) {
    const list = this.dom.glApplicationList;
    if (!list) {
      return { visibleCount: 0 };
    }
    list.innerHTML = "";
    const scheduleEntries = Array.isArray(schedules) ? schedules : [];
    if (!scheduleEntries.length) {
      const empty = document.createElement("p");
      empty.className = "gl-applicant-matrix__empty";
      empty.textContent = "日程がまだ設定されていません。";
      list.append(empty);
      return { visibleCount: 0 };
    }

    const wrapper = document.createElement("div");
    wrapper.className = "gl-applicant-matrix-wrapper";
    const scroll = document.createElement("div");
    scroll.className = "gl-applicant-matrix-scroll";
    const table = document.createElement("table");
    table.className = "gl-applicant-matrix";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const applicantHeader = document.createElement("th");
    applicantHeader.className = "gl-applicant-matrix__header gl-applicant-matrix__header--applicant";
    applicantHeader.scope = "col";
    applicantHeader.textContent = "応募者";
    headerRow.append(applicantHeader);

    scheduleEntries.forEach((schedule) => {
      const th = document.createElement("th");
      th.className = "gl-applicant-matrix__header gl-applicant-matrix__header--schedule";
      th.scope = "col";
      th.dataset.scheduleId = ensureString(schedule.id);
      const title = document.createElement("div");
      title.className = "gl-applicant-matrix__schedule";
      const label = document.createElement("span");
      label.className = "gl-applicant-matrix__schedule-label";
      label.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
      title.append(label);
      if (schedule.date) {
        const date = document.createElement("span");
        date.className = "gl-applicant-matrix__schedule-date";
        date.textContent = schedule.date;
        title.append(date);
      }
      th.append(title);
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    let visibleRows = 0;
    applications.forEach((application) => {
      const row = this.createApplicantMatrixRow({ application, schedules: scheduleEntries, matchesFilter });
      if (!row) {
        return;
      }
      tbody.append(row);
      visibleRows += 1;
    });
    table.append(tbody);

    scroll.append(table);
    wrapper.append(scroll);
    list.append(wrapper);
    return { visibleCount: visibleRows };
  }

  /**
   * シフト列を作成
   * @param {Object} column - 列オブジェクト
   * @param {Array} entries - エントリー要素の配列
   * @returns {HTMLElement} 列要素
   */
  createShiftColumn(column, entries) {
    const columnEl = document.createElement("section");
    columnEl.className = "gl-shift-column";
    columnEl.dataset.variant = column.type;
    if (column.type === "team" && column.teamId) {
      columnEl.dataset.teamId = column.teamId;
    }
    const header = document.createElement("header");
    header.className = "gl-shift-column__header";
    const title = document.createElement("h5");
    title.className = "gl-shift-column__title";
    title.textContent = column.type === "team" ? column.label : column.label;
    header.append(title);
    const count = document.createElement("span");
    count.className = "gl-shift-column__count";
    count.textContent = `${entries.length}名`;
    header.append(count);
    columnEl.append(header);

    const body = document.createElement("div");
    body.className = "gl-shift-column__body";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "gl-shift-column__empty";
      empty.textContent = "該当なし";
      body.append(empty);
    } else {
      entries.forEach((entry) => body.append(entry));
    }
    columnEl.append(body);
    return columnEl;
  }

  /**
   * シフトエントリーを作成
   * @param {Object} params - パラメータ
   * @param {Object} params.application - 応募者オブジェクト
   * @param {Object} params.schedule - スケジュールオブジェクト
   * @param {Object} params.assignment - 割り当てオブジェクト
   * @param {string} params.assignmentValue - 割り当て値
   * @param {boolean} params.available - 利用可能かどうか
   * @param {Array} params.teams - 班配列
   * @param {string} params.bucketKey - バケットキー
   * @returns {HTMLElement} エントリー要素
   */
  createShiftEntry({ application, schedule, assignment, assignmentValue, available, teams, bucketKey }) {
    const item = document.createElement("article");
    item.className = "gl-shift-entry";
    item.dataset.glId = ensureString(application.id);
    item.dataset.scheduleId = ensureString(schedule.id);
    item.dataset.bucket = bucketKey;
    item.dataset.sourceType = application.sourceType === "internal" ? "internal" : "external";
    if (assignmentValue === ASSIGNMENT_VALUE_ABSENT) {
      item.dataset.assignmentStatus = "absent";
    } else if (assignmentValue === ASSIGNMENT_VALUE_STAFF) {
      item.dataset.assignmentStatus = "staff";
    } else if (assignmentValue === ASSIGNMENT_VALUE_UNAVAILABLE) {
      item.dataset.assignmentStatus = "unavailable";
    } else if (assignmentValue) {
      item.dataset.assignmentStatus = "team";
      item.dataset.teamId = assignmentValue;
    } else if (!available) {
      item.dataset.assignmentStatus = "unavailable";
    } else {
      item.dataset.assignmentStatus = "pending";
    }

    const header = document.createElement("header");
    header.className = "gl-shift-entry__header";
    const identity = document.createElement("div");
    identity.className = "gl-shift-entry__identity";
    const nameEl = document.createElement("span");
    nameEl.className = "gl-shift-entry__name";
    nameEl.textContent = ensureString(application.name) || "(無記入)";
    identity.append(nameEl);
    if (application.phonetic) {
      const phoneticEl = document.createElement("span");
      phoneticEl.className = "gl-shift-entry__phonetic";
      phoneticEl.textContent = application.phonetic;
      identity.append(phoneticEl);
    }
    header.append(identity);
    if (application.grade) {
      const gradeEl = document.createElement("span");
      gradeEl.className = "gl-shift-entry__grade";
      applyGradeBadge(gradeEl, application.grade);
      header.append(gradeEl);
    }
    item.append(header);

    const infoList = document.createElement("ul");
    infoList.className = "gl-shift-entry__info";
    const addInfo = (label, value) => {
      if (!value) {
        return;
      }
      const li = document.createElement("li");
      li.className = "gl-shift-entry__info-item";
      const labelEl = document.createElement("span");
      labelEl.className = "gl-shift-entry__info-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "gl-shift-entry__info-value";
      valueEl.textContent = value;
      li.append(labelEl, valueEl);
      infoList.append(li);
    };
    const academicPathText = buildAcademicPathText(application);
    if (academicPathText) {
      addInfo("所属", academicPathText);
    }
    addInfo("性別", ensureString(application.gender));
    addInfo("役割", ensureString(application.role));
    addInfo("サークル", ensureString(application.club));
    if (infoList.children.length) {
      item.append(infoList);
    }

    if (application.note) {
      const note = document.createElement("p");
      note.className = "gl-shift-entry__note";
      note.textContent = application.note;
      item.append(note);
    }

    const controls = document.createElement("div");
    controls.className = "gl-shift-entry__controls";
    const assignmentLabel = document.createElement("label");
    assignmentLabel.className = "gl-shift-entry__assignment";
    const assignmentText = document.createElement("span");
    assignmentText.className = "gl-shift-entry__assignment-text";
    assignmentText.textContent = "班割当";
    const select = document.createElement("select");
    select.className = "input input--dense";
    select.dataset.glAssignment = "true";
    select.dataset.scheduleId = ensureString(schedule.id);
    const options = buildAssignmentOptionsForApplication(application, teams);
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === assignmentValue) {
        opt.selected = true;
      }
      select.append(opt);
    });
    assignmentLabel.append(assignmentText, select);
    controls.append(assignmentLabel);

    const updatedLabel = formatAssignmentUpdatedLabel(assignment);
    if (updatedLabel) {
      const updated = document.createElement("span");
      updated.className = "gl-shift-entry__updated";
      updated.textContent = updatedLabel;
      controls.append(updated);
    }
    item.append(controls);
    return item;
  }

  /**
   * スケジュールセクションを構築
   * @param {Object} schedule - スケジュールオブジェクト
   * @param {Array} applications - 応募者配列
   * @param {Function} matchesFilter - フィルタマッチ関数
   * @returns {Object|null} セクション要素とvisibleCount
   */
  buildScheduleSection(schedule, applications, matchesFilter) {
    if (!schedule) {
      return null;
    }
    const state = this.getState();
    const config = state.config || {};
    
    const section = document.createElement("section");
    section.className = "gl-shift-section";
    section.dataset.scheduleId = ensureString(schedule.id);

    const header = document.createElement("header");
    header.className = "gl-shift-section__header";
    const title = document.createElement("h4");
    title.className = "gl-shift-section__title";
    title.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
    header.append(title);
    if (schedule.date) {
      const meta = document.createElement("p");
      meta.className = "gl-shift-section__meta";
      meta.textContent = schedule.date;
      header.append(meta);
    }
    const countEl = document.createElement("span");
    countEl.className = "gl-shift-section__count";
    countEl.textContent = "0名";
    header.append(countEl);
    section.append(header);

    const teams = getScheduleTeams(config, schedule.id);
    const columns = buildScheduleBuckets(teams);
    const columnOrder = [];
    const columnMap = new Map();
    columns.forEach((column) => {
      columnOrder.push(column.key);
      columnMap.set(column.key, { column, entries: [] });
    });
    const ensureTeamColumn = (key) => {
      if (!key.startsWith("team:")) {
        return null;
      }
      const teamId = key.replace(/^team:/, "");
      const column = { key, label: teamId || "班", type: "team", teamId };
      columnOrder.push(key);
      const data = { column, entries: [] };
      columnMap.set(key, data);
      return data;
    };

    let visibleCount = 0;
    applications.forEach((application) => {
      const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
      const value = resolveEffectiveAssignmentValue(application, assignment);
      const available = isApplicantAvailableForSchedule(application, schedule.id);
      const bucketKey = this.resolveAssignmentBucket(value, available);
      if (!matchesFilter(bucketKey)) {
        return;
      }
      const columnData = columnMap.get(bucketKey) || ensureTeamColumn(bucketKey);
      if (!columnData) {
        return;
      }
      const entryEl = this.createShiftEntry({
        application,
        schedule,
        assignment,
        assignmentValue: value,
        available,
        teams,
        bucketKey
      });
      columnData.entries.push(entryEl);
      visibleCount += 1;
    });

    const orderedKeys = [
      ...columnOrder,
      ...Array.from(columnMap.keys()).filter((key) => !columnOrder.includes(key))
    ];
    const columnsContainer = document.createElement("div");
    columnsContainer.className = "gl-shift-columns";
    orderedKeys.forEach((key) => {
      const data = columnMap.get(key);
      if (!data) {
        return;
      }
      const columnEl = this.createShiftColumn(data.column, data.entries);
      columnsContainer.append(columnEl);
    });

    const table = document.createElement("div");
    table.className = "gl-shift-table";
    table.append(columnsContainer);
    section.append(table);

    countEl.textContent = `${visibleCount}名`;
    section.dataset.totalEntries = String(visibleCount);
    return { element: section, visibleCount };
  }

  /**
   * 応募者マトリックス行を作成
   * @param {Object} params - パラメータ
   * @param {Object} params.application - 応募者オブジェクト
   * @param {Array} params.schedules - スケジュール配列
   * @param {Function} params.matchesFilter - フィルタマッチ関数
   * @returns {HTMLElement|null} 行要素
   */
  createApplicantMatrixRow({ application, schedules, matchesFilter }) {
    if (!application) {
      return null;
    }
    const state = this.getState();
    const config = state.config || {};
    
    const row = document.createElement("tr");
    row.className = "gl-applicant-matrix__row";
    row.dataset.glId = ensureString(application.id);

    const applicantCell = document.createElement("th");
    applicantCell.scope = "row";
    applicantCell.className = "gl-applicant-matrix__applicant";
    applicantCell.dataset.glId = ensureString(application.id);

    const badgeRow = document.createElement("div");
    badgeRow.className = "gl-applicant-matrix__badges";
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "gl-badge gl-badge--source";
    const sourceType = application.sourceType === "internal" ? "internal" : "external";
    sourceBadge.dataset.sourceType = sourceType;
    sourceBadge.textContent = sourceType === "internal" ? "内部" : "外部";
    badgeRow.append(sourceBadge);
    if (application.role) {
      const roleBadge = document.createElement("span");
      roleBadge.className = "gl-badge gl-badge--role";
      roleBadge.textContent = application.role;
      badgeRow.append(roleBadge);
    }

    const identity = document.createElement("div");
    identity.className = "gl-applicant-matrix__identity";
    const nameEl = document.createElement("span");
    nameEl.className = "gl-applicant-matrix__name";
    nameEl.textContent = ensureString(application.name) || "(無記入)";
    identity.append(nameEl);
    if (application.phonetic) {
      const phoneticEl = document.createElement("span");
      phoneticEl.className = "gl-applicant-matrix__phonetic";
      phoneticEl.textContent = application.phonetic;
      identity.append(phoneticEl);
    }
    const identityHeader = document.createElement("div");
    identityHeader.className = "gl-applicant-matrix__identity-header";
    identityHeader.append(identity);

    if (application.grade) {
      const gradeEl = document.createElement("span");
      gradeEl.className = "gl-applicant-matrix__grade";
      applyGradeBadge(gradeEl, application.grade);
      identityHeader.append(gradeEl);
    }

    applicantCell.append(badgeRow);
    applicantCell.append(identityHeader);

    const metaList = document.createElement("dl");
    metaList.className = "gl-applicant-matrix__meta";
    const addMeta = (label, value) => {
      if (!value) {
        return;
      }
      const dt = document.createElement("dt");
      dt.className = "gl-applicant-matrix__meta-label";
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.className = "gl-applicant-matrix__meta-value";
      dd.textContent = value;
      metaList.append(dt, dd);
    };

    const academicPathText = buildAcademicPathText(application);
    addMeta("所属", academicPathText);
    addMeta("性別", ensureString(application.gender));
    addMeta("役割", ensureString(application.role));
    addMeta("メール", ensureString(application.email));
    addMeta("サークル", ensureString(application.club));
    addMeta("学籍番号", ensureString(application.studentId));

    if (metaList.children.length) {
      applicantCell.append(metaList);
    }

    if (application.note) {
      const note = document.createElement("p");
      note.className = "gl-applicant-matrix__note";
      note.textContent = application.note;
      applicantCell.append(note);
    }

    row.append(applicantCell);

    schedules.forEach((schedule) => {
      const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
      const assignmentValue = resolveEffectiveAssignmentValue(application, assignment);
      const available = isApplicantAvailableForSchedule(application, schedule.id);
      const teams = getScheduleTeams(config, schedule.id);
      const cell = this.createApplicantMatrixCell({
        application,
        schedule,
        assignment,
        assignmentValue,
        available,
        teams,
        matchesFilter
      });
      row.append(cell);
    });

    return row;
  }

  /**
   * 応募者マトリックスセルを作成
   * @param {Object} params - パラメータ
   * @param {Object} params.application - 応募者オブジェクト
   * @param {Object} params.schedule - スケジュールオブジェクト
   * @param {Object} params.assignment - 割り当てオブジェクト
   * @param {string} params.assignmentValue - 割り当て値
   * @param {boolean} params.available - 利用可能かどうか
   * @param {Array} params.teams - 班配列
   * @param {Function} params.matchesFilter - フィルタマッチ関数
   * @returns {HTMLElement} セル要素
   */
  createApplicantMatrixCell({
    application,
    schedule,
    assignment,
    assignmentValue,
    available,
    teams,
    matchesFilter
  }) {
    const cell = document.createElement("td");
    cell.className = "gl-applicant-matrix__cell";
    cell.dataset.glId = ensureString(application.id);
    cell.dataset.scheduleId = ensureString(schedule.id);
    cell.dataset.sourceType = application.sourceType === "internal" ? "internal" : "external";
    const bucketKey = this.resolveAssignmentBucket(assignmentValue, available);
    const matches = matchesFilter(bucketKey);
    cell.dataset.bucket = bucketKey;
    cell.dataset.matchesFilter = matches ? "true" : "false";
    if (assignmentValue === ASSIGNMENT_VALUE_ABSENT) {
      cell.dataset.assignmentStatus = "absent";
    } else if (assignmentValue === ASSIGNMENT_VALUE_STAFF) {
      cell.dataset.assignmentStatus = "staff";
    } else if (assignmentValue === ASSIGNMENT_VALUE_UNAVAILABLE) {
      cell.dataset.assignmentStatus = "unavailable";
    } else if (assignmentValue) {
      cell.dataset.assignmentStatus = "team";
      cell.dataset.teamId = assignmentValue;
    } else if (!available) {
      cell.dataset.assignmentStatus = "unavailable";
    } else {
      cell.dataset.assignmentStatus = "pending";
    }

    const content = document.createElement("div");
    content.className = "gl-applicant-matrix__cell-content";

    const statusRow = document.createElement("div");
    statusRow.className = "gl-applicant-matrix__cell-header";
    const responseDescriptor = resolveScheduleResponseValue(application, schedule.id);
    const responseBadge = document.createElement("span");
    responseBadge.className = "gl-applicant-matrix__response-badge";
    const responseVariant = determineScheduleResponseVariant(responseDescriptor.raw, responseDescriptor.text);
    if (responseVariant) {
      responseBadge.classList.add(`gl-applicant-matrix__response-badge--${responseVariant}`);
    }
    responseBadge.textContent = responseDescriptor.text || "未回答";
    statusRow.append(responseBadge);
    content.append(statusRow);

    const control = document.createElement("div");
    control.className = "gl-applicant-matrix__assignment";
    const select = document.createElement("select");
    select.className = "input input--dense gl-applicant-matrix__select";
    select.dataset.glAssignment = "true";
    select.dataset.scheduleId = ensureString(schedule.id);
    select.setAttribute(
      "aria-label",
      `${ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程"}の班割当`
    );
    const options = buildAssignmentOptionsForApplication(application, teams);
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === assignmentValue) {
        opt.selected = true;
      }
      select.append(opt);
    });
    control.append(select);

    const updatedLabel = formatAssignmentUpdatedLabel(assignment);
    if (updatedLabel) {
      const updated = document.createElement("span");
      updated.className = "gl-applicant-matrix__updated";
      updated.textContent = updatedLabel;
      control.append(updated);
    }

    content.append(control);
    cell.append(content);
    return cell;
  }
}

