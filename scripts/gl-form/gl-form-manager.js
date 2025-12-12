// gl-form-manager.js: GLフォーム用のフォーム管理機能
// gl-form/index.js から分離（フェーズ2 段階2）

import { CUSTOM_OPTION_VALUE, ensureString, formatScheduleOption } from "./gl-form-utils.js";

/**
 * GlFormManager: GLフォームのフォーム管理を担当するクラス
 * gl-form/index.js からフォーム管理機能を分離（フェーズ2 段階2）
 */
export class GlFormManager {
  constructor(context) {
    // DOM要素
    this.elements = context.elements || {};
    
    // 状態管理
    this.getState = context.getState || (() => ({}));
    this.setState = context.setState || (() => {});
    
    // ユーティリティ
    this.unitLevelMap = context.unitLevelMap || new WeakMap();
  }

  /**
   * ガードを表示
   * @param {string} message - メッセージ
   */
  showGuard(message) {
    if (this.elements.contextGuard) {
      this.elements.contextGuard.textContent = message;
      this.elements.contextGuard.hidden = false;
    }
    if (this.elements.form) {
      this.elements.form.hidden = true;
    }
    if (this.elements.contextBanner) {
      this.elements.contextBanner.hidden = true;
    }
  }

  /**
   * ガードを非表示
   */
  hideGuard() {
    if (this.elements.contextGuard) {
      this.elements.contextGuard.hidden = true;
      this.elements.contextGuard.textContent = "";
    }
  }

  /**
   * 学部選択肢を描画
   * @param {Array} faculties - 学部データの配列
   */
  renderFaculties(faculties) {
    if (!this.elements.facultySelect) return;
    const select = this.elements.facultySelect;
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

  /**
   * 学歴フィールドをクリア
   */
  clearAcademicFields() {
    if (this.elements.academicFields) {
      this.elements.academicFields.innerHTML = "";
    }
    const state = this.getState();
    state.unitSelections = [];
    this.setState(state);
    this.updateAcademicCustomField();
  }

  /**
   * 指定深度以降の学歴フィールドを削除
   * @param {number} depth - 深度
   */
  removeAcademicFieldsAfter(depth) {
    if (!this.elements.academicFields) return;
    const fields = Array.from(this.elements.academicFields.querySelectorAll(".gl-academic-field"));
    fields.forEach((field) => {
      const fieldDepth = Number(field.dataset.depth ?? "0");
      if (fieldDepth > depth) {
        field.remove();
      }
    });
    const state = this.getState();
    state.unitSelections = state.unitSelections.filter((_, index) => index <= depth);
    this.setState(state);
  }

  /**
   * カスタムフィールドを更新
   * @param {string} label - ラベル
   */
  updateAcademicCustomField(label) {
    if (!this.elements.academicCustomField) return;
    const state = this.getState();
    if (label) {
      state.currentCustomLabel = label;
      this.elements.academicCustomField.hidden = false;
      if (this.elements.academicCustomLabel) {
        this.elements.academicCustomLabel.textContent = `${label}（その他入力）`;
      }
      if (this.elements.academicCustomInput) {
        this.elements.academicCustomInput.placeholder = `${label}名を入力してください`;
        this.elements.academicCustomInput.setAttribute("required", "true");
      }
    } else {
      state.currentCustomLabel = "";
      this.elements.academicCustomField.hidden = true;
      if (this.elements.academicCustomInput) {
        this.elements.academicCustomInput.value = "";
        this.elements.academicCustomInput.placeholder = "所属名を入力してください";
        this.elements.academicCustomInput.removeAttribute("required");
      }
    }
    this.setState(state);
  }

  /**
   * 学歴レベルを描画
   * @param {Object} level - レベルオブジェクト
   * @param {number} depth - 深度
   * @param {Function} onLevelChange - レベル変更時のコールバック
   */
  renderAcademicLevel(level, depth, onLevelChange) {
    if (!this.elements.academicFields || !this.elements.academicSelectTemplate) return;
    const fragment = this.elements.academicSelectTemplate.content.cloneNode(true);
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
    this.unitLevelMap.set(select, level);
    if (onLevelChange) {
      select.addEventListener("change", (event) => {
        if (event.target instanceof HTMLSelectElement) {
          onLevelChange(event.target);
        }
      });
    }
    this.elements.academicFields.append(field);
  }

  /**
   * 学歴レベル変更を処理
   * @param {HTMLSelectElement} select - セレクト要素
   * @param {Function} onRenderLevel - レベル描画時のコールバック
   */
  handleAcademicLevelChange(select, onRenderLevel) {
    const depth = Number(select.dataset.depth ?? "0");
    this.removeAcademicFieldsAfter(depth);
    const level = this.unitLevelMap.get(select);
    const value = ensureString(select.value);
    const state = this.getState();
    if (!level || !value) {
      this.updateAcademicCustomField();
      return;
    }
    if (value === CUSTOM_OPTION_VALUE) {
      state.unitSelections[depth] = { label: level.label, value: "", isCustom: true };
      this.setState(state);
      this.updateAcademicCustomField(level.label);
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
    this.setState(state);
    this.updateAcademicCustomField();
    if (option?.children && onRenderLevel) {
      onRenderLevel(option.children, depth + 1);
    }
  }

  /**
   * 学部に応じた学歴ツリーを描画
   * @param {string} facultyName - 学部名
   * @param {Function} onLevelChange - レベル変更時のコールバック
   */
  renderAcademicTreeForFaculty(facultyName, onLevelChange) {
    this.clearAcademicFields();
    const name = ensureString(facultyName);
    if (!name || name === CUSTOM_OPTION_VALUE) {
      return;
    }
    const state = this.getState();
    const entry = state.faculties.find((item) => ensureString(item.faculty) === name);
    if (entry?.unitTree) {
      this.renderAcademicLevel(entry.unitTree, 0, onLevelChange);
    } else if (entry?.fallbackLabel) {
      this.updateAcademicCustomField(entry.fallbackLabel);
    } else {
      this.updateAcademicCustomField("所属");
    }
  }

  /**
   * 学歴パスの状態を収集
   * @returns {Object} 学歴パスの状態
   */
  collectAcademicPathState() {
    const selects = Array.from(this.elements.academicFields?.querySelectorAll(".gl-academic-select") ?? []);
    const path = [];
    let requiresCustom = false;
    let customLabel = "";
    let firstSelect = null;
    let pendingSelect = null;
    const state = this.getState();
    selects.forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) return;
      if (!firstSelect) {
        firstSelect = select;
      }
      const level = this.unitLevelMap.get(select);
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
          value: ensureString(this.elements.academicCustomInput?.value),
          isCustom: true,
          element: this.elements.academicCustomInput ?? null
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
        value: ensureString(this.elements.academicCustomInput?.value),
        isCustom: true,
        element: this.elements.academicCustomInput ?? null
      });
    }
    const customValue = ensureString(this.elements.academicCustomInput?.value);
    return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
  }

  /**
   * シフト選択肢を描画
   * @param {Array} schedules - スケジュールデータの配列
   */
  renderShifts(schedules) {
    if (!this.elements.shiftList) return;
    this.elements.shiftList.innerHTML = "";
    if (!Array.isArray(schedules) || !schedules.length) {
      const note = document.createElement("p");
      note.className = "form-meta-line";
      note.textContent = "現在登録されている日程はありません。";
      this.elements.shiftList.append(note);
      if (this.elements.shiftFieldset) {
        this.elements.shiftFieldset.hidden = true;
      }
      return;
    }
    if (this.elements.shiftFieldset) {
      this.elements.shiftFieldset.hidden = false;
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
      this.elements.shiftList.append(wrapper);
    });
  }

  /**
   * コンテキスト情報を表示
   * @param {string} eventName - イベント名
   * @param {string} periodText - 期間テキスト
   */
  populateContext(eventName, periodText) {
    if (!this.elements.contextBanner) return;
    this.elements.contextBanner.hidden = false;
    if (this.elements.contextEvent) {
      this.elements.contextEvent.textContent = eventName ? `対象イベント: ${eventName}` : "";
    }
    if (this.elements.contextPeriod) {
      if (periodText) {
        this.elements.contextPeriod.textContent = `募集期間: ${periodText}`;
        this.elements.contextPeriod.hidden = false;
      } else {
        this.elements.contextPeriod.hidden = true;
        this.elements.contextPeriod.textContent = "";
      }
    }
  }
}

