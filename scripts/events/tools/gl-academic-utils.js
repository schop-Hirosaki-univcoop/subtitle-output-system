// gl-academic-utils.js: GL 内部スタッフ登録フォームの学術レベル（学部以下の所属）処理の共通ユーティリティ
// GL パネルと内部スタッフ登録モーダルで共通使用されるロジックを提供

import { ensureString } from "../helpers.js";
import { INTERNAL_CUSTOM_OPTION_VALUE } from "../panels/gl-utils.js";

/**
 * 学術レベル（学部以下の所属）を描画します。
 * @param {Object} level - 学術レベルの定義
 * @param {number} depth - 深さ（0から開始）
 * @param {HTMLElement} fieldsContainer - フィールドを追加するコンテナ要素
 * @param {HTMLTemplateElement} template - フィールドのテンプレート要素
 * @param {WeakMap} unitLevelMap - レベルマップ（状態管理用）
 * @param {Function|null} onLevelChange - レベル変更時のコールバック関数（null の場合は呼び出し元でイベントリスナーを追加）
 * @param {string} selectIdPrefix - セレクト要素のIDプレフィックス（例: "gl-internal-academic-select" または "flow-internal-staff-academic-select"）
 * @returns {HTMLSelectElement|null} 作成されたセレクト要素、または null
 */
export function renderAcademicLevel(level, depth, fieldsContainer, template, unitLevelMap, onLevelChange = null, selectIdPrefix = "gl-internal-academic-select") {
  if (!fieldsContainer || !template) return null;
  const fragment = template.content.cloneNode(true);
  const field = fragment.querySelector(".gl-academic-field");
  const labelEl = field?.querySelector(".gl-academic-label");
  const select = field?.querySelector(".gl-academic-select");
  if (!(field instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) return null;
  field.dataset.depth = String(depth);
  const selectId = `${selectIdPrefix}-${depth}`;
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
  // イベントリスナーは呼び出し元で管理する（クリーンアップのため）
  // onLevelChange が指定されている場合のみここで追加
  if (onLevelChange && typeof onLevelChange === "function") {
    select.addEventListener("change", (event) => {
      if (event.target instanceof HTMLSelectElement) {
        onLevelChange(event.target);
      }
    });
  }
  fieldsContainer.append(field);
  return select;
}

/**
 * 学術状態（学部以下の所属の選択状態）を収集します。
 * @param {HTMLElement} fieldsContainer - フィールドコンテナ要素
 * @param {WeakMap} unitLevelMap - レベルマップ
 * @param {HTMLInputElement|null} customInput - カスタム入力フィールド
 * @param {Object} academicState - 学術状態オブジェクト（`currentCustomLabel` プロパティを持つ）
 * @returns {Object} 収集された学術状態
 *   - `path`: 選択されたパスの配列
 *   - `requiresCustom`: カスタム入力が必要かどうか
 *   - `customLabel`: カスタムラベル
 *   - `customValue`: カスタム値
 *   - `firstSelect`: 最初のセレクト要素
 *   - `pendingSelect`: 未選択のセレクト要素
 */
export function collectAcademicState(fieldsContainer, unitLevelMap, customInput, academicState) {
  const selects = Array.from(fieldsContainer?.querySelectorAll(".gl-academic-select") ?? []);
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
    if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
      requiresCustom = true;
      customLabel = levelLabel || customLabel;
      path.push({
        label: levelLabel,
        value: ensureString(customInput?.value),
        isCustom: true,
        element: customInput ?? null
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
  if (!selects.length && academicState?.currentCustomLabel) {
    requiresCustom = true;
    customLabel = academicState.currentCustomLabel;
    path.push({
      label: academicState.currentCustomLabel,
      value: ensureString(customInput?.value),
      isCustom: true,
      element: customInput ?? null
    });
  }
  const customValue = ensureString(customInput?.value);
  return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
}

/**
 * 学術レベル変更を処理するためのヘルパー関数。
 * 選択されたオプションから情報を抽出します。
 * @param {HTMLSelectElement} select - 変更されたセレクト要素
 * @param {WeakMap} unitLevelMap - レベルマップ
 * @returns {Object|null} 処理結果
 *   - `depth`: 深さ
 *   - `level`: レベル定義
 *   - `value`: 選択された値
 *   - `isCustom`: カスタム値かどうか
 *   - `option`: 選択されたオプション（存在する場合）
 *   - `displayLabel`: 表示ラベル
 */
export function parseAcademicLevelChange(select, unitLevelMap) {
  const depth = Number(select.dataset.depth ?? "0");
  const level = unitLevelMap.get(select);
  const value = ensureString(select.value);
  if (!level || !value) {
    return null;
  }
  if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
    return {
      depth,
      level,
      value: "",
      isCustom: true,
      option: null,
      displayLabel: level.label
    };
  }
  const selectedOption = select.selectedOptions[0];
  const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
  const option = optionIndex >= 0 ? level.options[optionIndex] : null;
  const displayLabel = ensureString(option?.label ?? selectedOption?.textContent ?? value);
  return {
    depth,
    level,
    value: option ? option.value : value,
    isCustom: false,
    option,
    displayLabel
  };
}

