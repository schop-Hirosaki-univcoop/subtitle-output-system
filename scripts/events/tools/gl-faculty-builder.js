import { ensureString } from "../helpers.js";

export const FACULTY_LEVEL_SUGGESTIONS = [
  "学科",
  "課程",
  "専攻",
  "コース",
  "プログラム",
  "領域"
];

export class GlFacultyBuilder {
  constructor(dom) {
    this.list = dom?.glFacultyList ?? null;
    this.emptyState = dom?.glFacultyEmpty ?? null;
    this.addButton = dom?.glFacultyAddButton ?? null;
    this.facultyTemplate = dom?.glFacultyTemplate ?? null;
    this.levelTemplate = dom?.glFacultyLevelTemplate ?? null;
    this.optionTemplate = dom?.glFacultyOptionTemplate ?? null;
    this.boundHandleAdd = () => {
      const card = this.addFaculty();
      const input = card?.querySelector("[data-faculty-name]");
      input?.focus();
    };
    if (this.addButton) {
      this.addButton.addEventListener("click", this.boundHandleAdd);
    }
    this.updateEmptyState();
  }

  destroy() {
    if (this.addButton) {
      this.addButton.removeEventListener("click", this.boundHandleAdd);
    }
  }

  updateEmptyState() {
    if (!this.emptyState) return;
    const hasEntries = Boolean(this.list && this.list.children.length);
    this.emptyState.hidden = hasEntries;
  }

  getFacultyCount() {
    if (!this.list) {
      return 0;
    }
    return this.list.querySelectorAll("[data-faculty-card]").length;
  }

  hasFaculties() {
    return this.getFacultyCount() > 0;
  }

  clear() {
    if (this.list) {
      this.list.innerHTML = "";
    }
    this.updateEmptyState();
  }

  setFaculties(faculties) {
    this.clear();
    if (!Array.isArray(faculties) || !faculties.length) {
      return;
    }
    faculties.forEach((entry) => {
      this.addFaculty(entry);
    });
    this.updateEmptyState();
  }

  addFaculty(raw = {}) {
    if (!this.list || !this.facultyTemplate) {
      return null;
    }
    const fragment = this.facultyTemplate.content.cloneNode(true);
    const card = fragment.querySelector("[data-faculty-card]");
    if (!card) {
      return null;
    }
    const facultyNameInput = card.querySelector("[data-faculty-name]");
    const fallbackInput = card.querySelector("[data-faculty-fallback]");
    const levelContainer = card.querySelector("[data-level-container]");
    const removeButton = card.querySelector("[data-remove-faculty]");
    const moveUpButton = card.querySelector("[data-move-up]");
    const moveDownButton = card.querySelector("[data-move-down]");
    if (facultyNameInput) {
      facultyNameInput.value = ensureString(raw?.faculty);
    }
    const fallbackFromData = ensureString(raw?.fallbackLabel);
    const rootLabelFromTree = ensureString(raw?.unitTree?.label || raw?.departmentLabel);
    const fallbackValue = fallbackFromData || rootLabelFromTree || "学科";
    if (fallbackInput) {
      fallbackInput.value = fallbackValue;
      if (fallbackInput.value && fallbackInput.value !== rootLabelFromTree) {
        fallbackInput.dataset.userEdited = "true";
      }
    }
    if (levelContainer) {
      const level = this.createLevel(raw?.unitTree, {
        depth: 0,
        isRoot: true,
        rootFallbackInput: fallbackInput,
        initialLabel: rootLabelFromTree || fallbackValue
      });
      if (level) {
        levelContainer.append(level);
      }
    }
    removeButton?.addEventListener("click", () => {
      card.remove();
      this.updateEmptyState();
    });
    moveUpButton?.addEventListener("click", () => {
      this.moveFaculty(card, -1);
    });
    moveDownButton?.addEventListener("click", () => {
      this.moveFaculty(card, 1);
    });
    this.list.append(card);
    this.updateEmptyState();
    return card;
  }

  moveFaculty(card, direction) {
    if (!this.list || !card) return;
    const siblings = Array.from(this.list.querySelectorAll("[data-faculty-card]"));
    const index = siblings.indexOf(card);
    if (index < 0) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) {
      return;
    }
    const reference = siblings[targetIndex];
    if (direction < 0) {
      this.list.insertBefore(card, reference);
    } else {
      this.list.insertBefore(card, reference.nextSibling);
    }
    card.scrollIntoView({ block: "nearest" });
  }

  createLevel(raw = {}, options = {}) {
    if (!this.levelTemplate) {
      return null;
    }
    const { depth = 0, isRoot = false, rootFallbackInput = null, initialLabel = "", onRemove } = options;
    const fragment = this.levelTemplate.content.cloneNode(true);
    const level = fragment.querySelector("[data-level]");
    if (!level) {
      return null;
    }
    level.dataset.depth = String(depth);
    const labelInput = level.querySelector("[data-level-label]");
    const allowCustomInput = level.querySelector("[data-level-allow-custom]");
    const removeButton = level.querySelector("[data-remove-level]");
    const optionsContainer = level.querySelector("[data-options]");
    const addOptionButton = level.querySelector("[data-add-option]");
    const labelValue = ensureString(raw?.label) || ensureString(initialLabel) || "学科";
    if (labelInput) {
      labelInput.value = labelValue;
      if (isRoot && rootFallbackInput) {
        this.setupRootFallbackSync(labelInput, rootFallbackInput);
      }
    }
    if (allowCustomInput) {
      allowCustomInput.checked = raw?.allowCustom !== false;
    }
    if (removeButton) {
      if (isRoot) {
        removeButton.hidden = true;
      } else {
        removeButton.addEventListener("click", () => {
          level.remove();
          onRemove?.();
        });
      }
    }
    const attachChild = (childRaw) => {
      const childContainer = level.querySelector("[data-option-children]");
      if (!childContainer) {
        return;
      }
      childContainer.innerHTML = "";
      const childLevel = this.createLevel(childRaw, {
        depth: depth + 1,
        rootFallbackInput,
        onRemove: () => {
          childContainer.innerHTML = "";
          if (addChildButton) addChildButton.hidden = false;
          if (removeChildButton) removeChildButton.hidden = true;
        }
      });
      if (childLevel) {
        childContainer.append(childLevel);
        if (addChildButton) addChildButton.hidden = true;
        if (removeChildButton) removeChildButton.hidden = false;
      }
    };
    const optionList = Array.isArray(raw?.options) ? raw.options : [];
    optionList.forEach((entry) => {
      const option = this.createOption(entry, { parentLevel: level, rootFallbackInput });
      if (option) {
        optionsContainer?.append(option);
      }
    });
    if (!optionList.length) {
      // Ensure placeholder remains empty when no options exist.
      optionsContainer?.querySelectorAll("[data-option]").forEach((option) => option.remove());
    }
    const addChildButton = level.querySelector("[data-add-child]");
    const removeChildButton = level.querySelector("[data-remove-child]");
    addOptionButton?.addEventListener("click", () => {
      const option = this.createOption({}, { parentLevel: level, rootFallbackInput });
      if (!option || !optionsContainer) {
        return;
      }
      optionsContainer.append(option);
      const labelInputEl = option.querySelector("[data-option-label]");
      labelInputEl?.focus();
    });
    if (Array.isArray(raw?.options)) {
      raw.options.forEach((entry) => {
        const option = optionsContainer?.querySelector(`[data-option-label][value="${entry?.label}"]`);
        if (option) {
          option.dispatchEvent(new Event("input"));
        }
      });
    }
    return level;
  }

  createOption(raw = {}, options = {}) {
    if (!this.optionTemplate) {
      return null;
    }
    const { parentLevel = null, rootFallbackInput = null } = options;
    const fragment = this.optionTemplate.content.cloneNode(true);
    const option = fragment.querySelector("[data-option]");
    if (!option) {
      return null;
    }
    const labelInput = option.querySelector("[data-option-label]");
    const addChildButton = option.querySelector("[data-add-child]");
    const removeChildButton = option.querySelector("[data-remove-child]");
    const removeOptionButton = option.querySelector("[data-remove-option]");
    const childContainer = option.querySelector("[data-option-children]");
    if (labelInput) {
      labelInput.value = ensureString(raw?.label);
    }
    removeOptionButton?.addEventListener("click", () => {
      option.remove();
      if (!parentLevel) {
        return;
      }
      const optionsContainer = parentLevel.querySelector("[data-options]");
      const remainingOptions = optionsContainer?.querySelectorAll(":scope > [data-option]") ?? [];
      if (remainingOptions.length === 0 && rootFallbackInput) {
        delete rootFallbackInput.dataset.userEdited;
        rootFallbackInput.dispatchEvent(new Event("input"));
      }
    });
    const attachChild = (childRaw) => {
      if (!childContainer) {
        return;
      }
      childContainer.innerHTML = "";
      const childLevel = this.createLevel(childRaw, {
        depth: Number(parentLevel?.dataset.depth ?? "0") + 1,
        rootFallbackInput,
        onRemove: () => {
          childContainer.innerHTML = "";
          if (addChildButton) addChildButton.hidden = false;
          if (removeChildButton) removeChildButton.hidden = true;
        }
      });
      if (childLevel) {
        childContainer.append(childLevel);
        if (addChildButton) addChildButton.hidden = true;
        if (removeChildButton) removeChildButton.hidden = false;
      }
    };
    addChildButton?.addEventListener("click", () => {
      const suggested = this.suggestNextLabel(parentLevel);
      attachChild({ label: suggested });
      const childInput = childContainer?.querySelector("[data-level-label]");
      childInput?.focus();
    });
    removeChildButton?.addEventListener("click", () => {
      if (childContainer) {
        childContainer.innerHTML = "";
      }
      if (addChildButton) addChildButton.hidden = false;
      if (removeChildButton) removeChildButton.hidden = true;
    });
    if (raw?.children) {
      attachChild(raw.children);
    }
    return option;
  }

  setupRootFallbackSync(labelInput, fallbackInput) {
    if (!labelInput || !fallbackInput) return;
    const syncIfAllowed = () => {
      if (fallbackInput.dataset.userEdited === "true") {
        return;
      }
      const label = ensureString(labelInput.value) || "学科";
      fallbackInput.value = label;
    };
    labelInput.addEventListener("input", syncIfAllowed);
    fallbackInput.addEventListener("input", () => {
      const label = ensureString(labelInput.value);
      if (!fallbackInput.value) {
        delete fallbackInput.dataset.userEdited;
        fallbackInput.value = label || "学科";
      } else if (fallbackInput.value !== label) {
        fallbackInput.dataset.userEdited = "true";
      } else {
        delete fallbackInput.dataset.userEdited;
      }
    });
    syncIfAllowed();
  }

  suggestNextLabel(levelElement) {
    const currentLabel = ensureString(
      levelElement?.querySelector("[data-level-label]")?.value
    );
    if (!currentLabel) {
      return FACULTY_LEVEL_SUGGESTIONS[0];
    }
    const exactIndex = FACULTY_LEVEL_SUGGESTIONS.indexOf(currentLabel);
    if (exactIndex >= 0 && exactIndex < FACULTY_LEVEL_SUGGESTIONS.length - 1) {
      return FACULTY_LEVEL_SUGGESTIONS[exactIndex + 1];
    }
    if (currentLabel.endsWith("学科")) {
      return "専攻";
    }
    if (currentLabel.endsWith("課程")) {
      return "専攻";
    }
    return currentLabel;
  }

  collectFaculties() {
    if (!this.list) {
      return { faculties: [], errors: [] };
    }
    const cards = Array.from(this.list.querySelectorAll("[data-faculty-card]"));
    const faculties = [];
    const errors = [];
    cards.forEach((card, index) => {
      const nameInput = card.querySelector("[data-faculty-name]");
      const fallbackInput = card.querySelector("[data-faculty-fallback]");
      const levelContainer = card.querySelector("[data-level-container]");
      const facultyName = ensureString(nameInput?.value);
      if (!facultyName) {
        errors.push(`学部カード${index + 1}の学部名を入力してください。`);
        return;
      }
      const fallbackLabel = ensureString(fallbackInput?.value) || "学科";
      const rootLevel = levelContainer?.querySelector(":scope > [data-level]");
      const unitTree = this.buildLevelPayload(rootLevel, errors, {
        faculty: facultyName,
        levelLabel: fallbackLabel
      });
      const payload = {
        faculty: facultyName,
        fallbackLabel,
        departmentLabel: fallbackLabel
      };
      if (unitTree) {
        payload.unitTree = unitTree;
      } else {
        payload.unitTree = null;
      }
      faculties.push(payload);
    });
    return { faculties, errors };
  }

  buildLevelPayload(levelElement, errors = [], meta = {}) {
    if (!levelElement) {
      return null;
    }
    const labelInput = levelElement.querySelector("[data-level-label]");
    const allowCustomInput = levelElement.querySelector("[data-level-allow-custom]");
    const optionsContainer = levelElement.querySelector("[data-options]");
    const label = ensureString(labelInput?.value) || ensureString(meta?.levelLabel) || "所属";
    const optionElements = Array.from(optionsContainer?.querySelectorAll(":scope > [data-option]") ?? []);
    const options = optionElements
      .map((option) => this.buildOptionPayload(option, errors, { faculty: meta?.faculty, levelLabel: label }))
      .filter(Boolean);
    if (!options.length) {
      if (optionElements.length) {
        const prefix = meta?.faculty ? `学部「${meta.faculty}」の` : "";
        errors.push(`${prefix}${label}の選択肢を入力してください。`);
      }
      return null;
    }
    const placeholder = `${label}を選択してください`;
    return {
      label,
      placeholder,
      allowCustom: allowCustomInput?.checked !== false,
      options
    };
  }

  buildOptionPayload(optionElement, errors = [], meta = {}) {
    const labelInput = optionElement.querySelector("[data-option-label]");
    const childLevel = optionElement.querySelector("[data-option-children] > [data-level]");
    const label = ensureString(labelInput?.value);
    if (!label) {
      const levelLabel = ensureString(meta?.levelLabel) || "所属";
      const prefix = meta?.faculty ? `学部「${meta.faculty}」の` : "";
      errors.push(`${prefix}${levelLabel}の選択肢名を入力してください。`);
      return null;
    }
    const payload = {
      label,
      value: label
    };
    if (childLevel) {
      const childPayload = this.buildLevelPayload(childLevel, errors, { faculty: meta?.faculty });
      if (childPayload) {
        payload.children = childPayload;
      } else {
        const childLabelInput = childLevel.querySelector("[data-level-label]");
        const childLabel = ensureString(childLabelInput?.value) || "下位階層";
        const childOptionsContainer = childLevel.querySelector("[data-options]");
        const hasChildOptions = Boolean(
          childOptionsContainer?.querySelector("[data-option]")
        );
        if (!hasChildOptions) {
          const prefix = meta?.faculty ? `学部「${meta.faculty}」の` : "";
          errors.push(`${prefix}${childLabel}の選択肢を追加するか、階層を削除してください。`);
        }
      }
    }
    return payload;
  }
}
