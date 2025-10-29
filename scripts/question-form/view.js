// view.js: フォームのDOM操作とバリデーションUI更新を担うビュー層です。
/**
 * 質問フォームのDOM操作を一元化し、画面状態管理を担うプレゼンテーション層。
 * HTML要素の参照とアクセシビリティ対応をまとめ、アプリケーションロジックから切り離します。
 */
export class FormView {
  /**
   * ビューが依存するDOMノードをキャッシュし、利用するバリデーション閾値を受け取ります。
   * @param {{ document?: Document, maxRadioNameLength?: number, maxQuestionLength?: number }} [options]
   */
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

  /**
   * フォーム全体を操作不可状態にし、支援テキストを初期化します。
   */
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

  /**
   * フォームのロックを解除してユーザーが再入力できるようにします。
   */
  unlockForm() {
    if (this.form) {
      this.form.hidden = false;
      this.form.removeAttribute("aria-hidden");
      this.form.removeAttribute("inert");
      this.form.dataset.locked = "false";
      this.#setFormControlsDisabled(false);
    }
  }

  /**
   * 入力要素・ボタン群に一括でdisabled属性を適用します。
   * @param {boolean} disabled
   */
  #setFormControlsDisabled(disabled) {
    if (!this.form) return;
    const elements = this.form.querySelectorAll("input:not([type=\"hidden\"]), select, textarea, button");
    elements.forEach((element) => {
      element.disabled = disabled;
    });
  }

  /**
   * バナー内のテキスト要素に内容を割り当て、空ならば非表示にします。
   * @param {HTMLElement|null} element
   * @param {string} text
   */
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

  /**
   * フォーム結果のメッセージを表示領域に描画します。
   * @param {string} message
   * @param {""|"success"|"error"} [type]
   */
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

  /**
   * 表示中のメッセージと状態クラスをリセットします。
   */
  clearFeedback() {
    this.setFeedback("", "");
  }

  /**
   * トークン不一致などフォーム利用不可時の警告表示を切り替えます。
   * @param {string} message
   */
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

  /**
   * コンテキスト警告要素にフォーカスを移し、読み上げを促します。
   */
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

  /**
   * イベント情報などのメタデータセクションを表示/非表示にします。
   * @param {boolean} visible
   */
  setFormMetaVisible(visible) {
    if (!this.formMetaEl) return;
    this.formMetaEl.hidden = !visible;
    if (visible) {
      this.formMetaEl.removeAttribute("aria-hidden");
    } else {
      this.formMetaEl.setAttribute("aria-hidden", "true");
    }
  }

  /**
   * フォーム上部の文脈バナーに複数行の説明を設定します。
   * @param {{ welcomeText?: string, descriptionText?: string, scheduleText?: string }} [options]
   */
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

  /**
   * バナー内の文言をすべて消去し、要素を非表示に戻します。
   */
  clearContextBanner() {
    if (!this.contextBannerEl) return;
    this.contextBannerEl.hidden = true;
    this.contextBannerEl.setAttribute("aria-hidden", "true");
    this.#assignContextLine(this.welcomeLineEl, "");
    this.#assignContextLine(this.introLineEl, "");
    this.#assignContextLine(this.scheduleLineEl, "");
  }

  /**
   * 補足説明テキストを表示領域へ反映します。
   * @param {string} text
   */
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

  /**
   * 認証用のアクセストークンをhidden要素へ設定します。
   * @param {string} token
   */
  setTokenValue(token) {
    if (this.tokenInput) {
      this.tokenInput.value = token || "";
    }
  }

  /**
   * イベントや参加者情報をhidden要素へバインドします。
   * @param {{ eventId?: string, eventName?: string, scheduleId?: string, scheduleLabel?: string, scheduleDate?: string, participantId?: string, groupNumber?: string }} [context]
   */
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

  /**
   * ラジオネーム入力欄へ値をセットします。
   * @param {string} value
   */
  setRadioNameValue(value) {
    if (this.radioNameInput) {
      this.radioNameInput.value = value ?? "";
    }
  }

  /**
   * ラジオネーム入力欄の現在値を取得します。
   * @returns {string}
   */
  getRadioNameValue() {
    return this.radioNameInput ? this.radioNameInput.value : "";
  }

  /**
   * ラジオネーム入力欄にフォーカスを移します。
   */
  focusRadioName() {
    this.radioNameInput?.focus();
  }

  /**
   * 質問本文のテキストエリアへ値を反映します。
   * @param {string} value
   */
  setQuestionValue(value) {
    if (this.questionInput) {
      this.questionInput.value = value ?? "";
    }
  }

  /**
   * 質問本文入力欄の内容を取得します。
   * @returns {string}
   */
  getQuestionValue() {
    return this.questionInput ? this.questionInput.value : "";
  }

  /**
   * 質問入力欄にフォーカスを移します。
   */
  focusQuestion() {
    this.questionInput?.focus();
  }

  /**
   * 文字数カウンターを最新状態に更新し、制限超過時にはエラー表示を行います。
   * @param {number} length
   */
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

  /**
   * ネイティブのフォーム検証を実行し、結果を返します。
   * @returns {boolean}
   */
  reportValidity() {
    if (!this.form || typeof this.form.reportValidity !== "function") {
      return true;
    }
    return this.form.reportValidity();
  }

  /**
   * 選択中のジャンル値を取得します。
   * @returns {string}
   */
  getSelectedGenre() {
    return this.genreSelect ? this.genreSelect.value : "";
  }

  /**
   * ジャンルセレクトボックスにフォーカスを移動させます。
   */
  focusGenre() {
    this.genreSelect?.focus();
  }

  /**
   * ジャンルの選択状態を初期値へ戻します。
   */
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

  /**
   * グループ番号入力欄の値を整形して返します。
   * @returns {string}
   */
  getGroupNumber() {
    return this.groupInput ? this.groupInput.value.trim() : "";
  }

  /**
   * 日程ラベル入力欄の値を返します。
   * @returns {string}
   */
  getScheduleLabel() {
    return this.scheduleInput ? this.scheduleInput.value.trim() : "";
  }

  /**
   * 日程日付入力欄の値を返します。
   * @returns {string}
   */
  getScheduleDate() {
    return this.scheduleDateInput ? this.scheduleDateInput.value.trim() : "";
  }

  /**
   * イベントID hiddenフィールドの値を返します。
   * @returns {string}
   */
  getEventId() {
    return this.eventIdInput ? this.eventIdInput.value.trim() : "";
  }

  /**
   * イベント名 hiddenフィールドの値を返します。
   * @returns {string}
   */
  getEventName() {
    return this.eventNameInput ? this.eventNameInput.value.trim() : "";
  }

  /**
   * 日程ID hiddenフィールドの値を返します。
   * @returns {string}
   */
  getScheduleId() {
    return this.scheduleIdInput ? this.scheduleIdInput.value.trim() : "";
  }

  /**
   * 参加者ID hiddenフィールドの値を返します。
   * @returns {string}
   */
  getParticipantId() {
    return this.participantIdInput ? this.participantIdInput.value.trim() : "";
  }

  /**
   * 送信ボタンの操作状態やbusy表示を制御します。
   * @param {boolean} isBusy
   * @param {boolean} locked
   */
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

  /**
   * フォームおよび関連要素にイベントハンドラを束ねて登録します。
   * @param {{ onSubmit?: EventListener, onInput?: EventListener, onReset?: EventListener, onQuestionInput?: EventListener, onQuestionBlur?: EventListener, onRadioNameBlur?: EventListener, onRadioNameInput?: EventListener, onGenreChange?: EventListener }} [handlers]
   */
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

  /**
   * ページ離脱警告を設定するため beforeunload イベントを登録します。
   * @param {EventListener} handler
   */
  addBeforeUnloadListener(handler) {
    if (typeof window !== "undefined" && handler) {
      window.addEventListener("beforeunload", handler);
    }
  }
}
