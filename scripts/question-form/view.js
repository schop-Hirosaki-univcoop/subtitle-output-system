export class FormView {
  constructor({ document: doc = window.document, maxRadioNameLength = 40, maxQuestionLength = 400 } = {}) {
    this.document = doc;
    this.maxRadioNameLength = maxRadioNameLength;
    this.maxQuestionLength = maxQuestionLength;

    this.form = doc.getElementById("question-form");
    this.radioNameInput = doc.getElementById("radio-name");
    this.questionInput = doc.getElementById("question-text");
    this.genreSelect = doc.getElementById("genre");
    this.groupInput = doc.getElementById("group-number");
    this.scheduleInput = doc.getElementById("schedule");
    this.scheduleDateInput = doc.getElementById("schedule-date");
    this.eventIdInput = doc.getElementById("event-id");
    this.eventNameInput = doc.getElementById("event-name");
    this.scheduleIdInput = doc.getElementById("schedule-id");
    this.participantIdInput = doc.getElementById("participant-id");
    this.tokenInput = doc.getElementById("access-token");
    this.feedbackEl = doc.getElementById("form-feedback");
    this.submitButton = doc.getElementById("submit-button");
    this.contextBannerEl = doc.getElementById("context-banner");
    this.welcomeLineEl = doc.getElementById("welcome-line");
    this.introLineEl = doc.getElementById("intro-line");
    this.scheduleLineEl = doc.getElementById("schedule-line");
    this.contextGuardEl = doc.getElementById("context-guard");
    this.questionCounterEl = doc.getElementById("question-counter");
    this.formMetaEl = doc.getElementById("form-meta");
    this.formGuidanceEl = doc.getElementById("form-guidance");
  }

  lockForm() {
    if (this.form) {
      this.form.hidden = true;
      this.form.setAttribute("aria-hidden", "true");
      this.form.setAttribute("inert", "");
      this.form.dataset.locked = "true";
      this.#setFormControlsDisabled(true);
    }
    this.clearContextBanner();
    this.setFormMetaVisible(false);
  }

  unlockForm() {
    if (this.form) {
      this.form.hidden = false;
      this.form.removeAttribute("aria-hidden");
      this.form.removeAttribute("inert");
      this.form.dataset.locked = "false";
      this.#setFormControlsDisabled(false);
    }
  }

  #setFormControlsDisabled(disabled) {
    if (!this.form) return;
    const elements = this.form.querySelectorAll("input:not([type=\"hidden\"]), select, textarea, button");
    elements.forEach((element) => {
      element.disabled = disabled;
    });
  }

  #assignContextLine(element, text) {
    if (!element) return;
    const hasText = Boolean(text);
    element.textContent = text || "";
    if (hasText) {
      element.hidden = false;
      element.removeAttribute("aria-hidden");
    } else {
      element.hidden = true;
      element.setAttribute("aria-hidden", "true");
    }
  }

  setFeedback(message, type = "") {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = message || "";
    this.feedbackEl.classList.remove("form-feedback--success", "form-feedback--error");
    if (type === "success") {
      this.feedbackEl.classList.add("form-feedback--success");
    } else if (type === "error") {
      this.feedbackEl.classList.add("form-feedback--error");
    }
  }

  clearFeedback() {
    this.setFeedback("", "");
  }

  setContextGuard(message) {
    if (!this.contextGuardEl) return;
    if (message) {
      this.contextGuardEl.hidden = false;
      this.contextGuardEl.removeAttribute("aria-hidden");
      this.contextGuardEl.textContent = message;
      if (!this.contextGuardEl.hasAttribute("tabindex")) {
        this.contextGuardEl.setAttribute("tabindex", "-1");
      }
    } else {
      this.contextGuardEl.hidden = true;
      this.contextGuardEl.setAttribute("aria-hidden", "true");
      this.contextGuardEl.textContent = "";
      if (this.contextGuardEl.hasAttribute("tabindex")) {
        this.contextGuardEl.removeAttribute("tabindex");
      }
    }
  }

  focusContextGuard() {
    if (!this.contextGuardEl || this.contextGuardEl.hidden) {
      return;
    }
    try {
      this.contextGuardEl.focus();
    } catch (error) {
      // no-op: focusing may fail in older browsers
    }
  }

  setFormMetaVisible(visible) {
    if (!this.formMetaEl) return;
    this.formMetaEl.hidden = !visible;
    if (visible) {
      this.formMetaEl.removeAttribute("aria-hidden");
    } else {
      this.formMetaEl.setAttribute("aria-hidden", "true");
    }
  }

  setContextBanner({ welcomeText = "", descriptionText = "", scheduleText = "" } = {}) {
    if (!this.contextBannerEl) return;
    if (welcomeText || descriptionText || scheduleText) {
      this.contextBannerEl.hidden = false;
      this.contextBannerEl.removeAttribute("aria-hidden");
      this.#assignContextLine(this.welcomeLineEl, welcomeText);
      this.#assignContextLine(this.introLineEl, descriptionText);
      this.#assignContextLine(this.scheduleLineEl, scheduleText);
    } else {
      this.clearContextBanner();
    }
  }

  clearContextBanner() {
    if (!this.contextBannerEl) return;
    this.contextBannerEl.hidden = true;
    this.contextBannerEl.setAttribute("aria-hidden", "true");
    this.#assignContextLine(this.welcomeLineEl, "");
    this.#assignContextLine(this.introLineEl, "");
    this.#assignContextLine(this.scheduleLineEl, "");
  }

  setGuidance(text) {
    if (!this.formGuidanceEl) return;
    if (text) {
      this.formGuidanceEl.hidden = false;
      this.formGuidanceEl.textContent = text;
    } else {
      this.formGuidanceEl.hidden = true;
      this.formGuidanceEl.textContent = "";
    }
  }

  setTokenValue(token) {
    if (this.tokenInput) {
      this.tokenInput.value = token || "";
    }
  }

  setHiddenContext({
    eventId = "",
    eventName = "",
    scheduleId = "",
    scheduleLabel = "",
    scheduleDate = "",
    participantId = "",
    groupNumber = ""
  } = {}) {
    if (this.eventIdInput) this.eventIdInput.value = eventId;
    if (this.eventNameInput) this.eventNameInput.value = eventName;
    if (this.scheduleIdInput) this.scheduleIdInput.value = scheduleId;
    if (this.scheduleInput) this.scheduleInput.value = scheduleLabel;
    if (this.scheduleDateInput) this.scheduleDateInput.value = scheduleDate;
    if (this.participantIdInput) this.participantIdInput.value = participantId;
    if (this.groupInput) this.groupInput.value = groupNumber;
  }

  setRadioNameValue(value) {
    if (this.radioNameInput) {
      this.radioNameInput.value = value ?? "";
    }
  }

  getRadioNameValue() {
    return this.radioNameInput ? this.radioNameInput.value : "";
  }

  focusRadioName() {
    this.radioNameInput?.focus();
  }

  setQuestionValue(value) {
    if (this.questionInput) {
      this.questionInput.value = value ?? "";
    }
  }

  getQuestionValue() {
    return this.questionInput ? this.questionInput.value : "";
  }

  focusQuestion() {
    this.questionInput?.focus();
  }

  updateQuestionCounter(length) {
    if (!this.questionCounterEl) return;
    const safeLength = Number.isFinite(length) ? length : 0;
    this.questionCounterEl.textContent = `${safeLength} / ${this.maxQuestionLength}文字`;
    if (safeLength > this.maxQuestionLength) {
      this.questionCounterEl.classList.add("status-error");
    } else {
      this.questionCounterEl.classList.remove("status-error");
    }
  }

  reportValidity() {
    if (!this.form || typeof this.form.reportValidity !== "function") {
      return true;
    }
    return this.form.reportValidity();
  }

  getSelectedGenre() {
    return this.genreSelect ? this.genreSelect.value : "";
  }

  focusGenre() {
    this.genreSelect?.focus();
  }

  resetGenreSelection() {
    if (!this.genreSelect) return;
    const placeholderOption = this.genreSelect.querySelector("option[data-placeholder=\"true\"]");
    if (placeholderOption) {
      const wasDisabled = placeholderOption.disabled;
      if (wasDisabled) {
        placeholderOption.disabled = false;
      }
      placeholderOption.selected = true;
      this.genreSelect.value = placeholderOption.value;
      if (wasDisabled) {
        placeholderOption.disabled = true;
      }
    } else {
      this.genreSelect.value = "";
    }
  }

  getGroupNumber() {
    return this.groupInput ? this.groupInput.value.trim() : "";
  }

  getScheduleLabel() {
    return this.scheduleInput ? this.scheduleInput.value.trim() : "";
  }

  getScheduleDate() {
    return this.scheduleDateInput ? this.scheduleDateInput.value.trim() : "";
  }

  getEventId() {
    return this.eventIdInput ? this.eventIdInput.value.trim() : "";
  }

  getEventName() {
    return this.eventNameInput ? this.eventNameInput.value.trim() : "";
  }

  getScheduleId() {
    return this.scheduleIdInput ? this.scheduleIdInput.value.trim() : "";
  }

  getParticipantId() {
    return this.participantIdInput ? this.participantIdInput.value.trim() : "";
  }

  setSubmitBusy(isBusy, locked) {
    if (!this.submitButton) return;
    if (locked) {
      this.submitButton.disabled = true;
      this.submitButton.removeAttribute("aria-busy");
      return;
    }
    this.submitButton.disabled = Boolean(isBusy);
    if (isBusy) {
      this.submitButton.setAttribute("aria-busy", "true");
    } else {
      this.submitButton.removeAttribute("aria-busy");
    }
  }

  bindFormEvents({
    onSubmit,
    onInput,
    onReset,
    onQuestionInput,
    onQuestionBlur,
    onRadioNameBlur,
    onRadioNameInput,
    onGenreChange
  } = {}) {
    if (this.form && onSubmit) this.form.addEventListener("submit", onSubmit);
    if (this.form && onInput) this.form.addEventListener("input", onInput);
    if (this.form && onReset) this.form.addEventListener("reset", onReset);
    if (this.questionInput && onQuestionInput) this.questionInput.addEventListener("input", onQuestionInput);
    if (this.questionInput && onQuestionBlur) this.questionInput.addEventListener("blur", onQuestionBlur);
    if (this.radioNameInput && onRadioNameBlur) this.radioNameInput.addEventListener("blur", onRadioNameBlur);
    if (this.radioNameInput && onRadioNameInput) this.radioNameInput.addEventListener("input", onRadioNameInput);
    if (this.genreSelect && onGenreChange) this.genreSelect.addEventListener("change", onGenreChange);
  }

  addBeforeUnloadListener(handler) {
    if (typeof window !== "undefined" && handler) {
      window.addEventListener("beforeunload", handler);
    }
  }
}
