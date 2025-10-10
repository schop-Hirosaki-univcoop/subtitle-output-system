import { getDatabaseInstance } from "./firebase.js";
import { fetchContextFromToken, extractToken } from "./context-service.js";
import { FormView } from "./view.js";
import {
  GAS_API_URL,
  GENRE_OPTIONS,
  FORM_VERSION,
  firebaseConfig,
  MAX_QUESTION_LENGTH,
  MAX_RADIO_NAME_LENGTH
} from "./constants.js";
import {
  countGraphemes,
  normalizeMultiline,
  sanitizeRadioName
} from "./string-utils.js";

export class QuestionFormApp {
  constructor({ view, database } = {}) {
    this.database = database ?? getDatabaseInstance(firebaseConfig);
    this.view = view ?? new FormView({
      maxRadioNameLength: MAX_RADIO_NAME_LENGTH,
      maxQuestionLength: MAX_QUESTION_LENGTH
    });
    this.state = {
      context: null,
      token: null,
      submittingController: null,
      dirty: false,
      locked: true
    };
  }

  init() {
    this.view.bindFormEvents({
      onSubmit: (event) => this.handleSubmit(event),
      onInput: () => this.markDirty(),
      onReset: () => this.handleReset(),
      onQuestionInput: () => this.handleQuestionInput(),
      onQuestionBlur: () => this.handleQuestionBlur(),
      onRadioNameBlur: () => this.handleRadioNameBlur(),
      onRadioNameInput: () => this.handleRadioNameInput(),
      onGenreChange: () => this.markDirty()
    });
    this.view.addBeforeUnloadListener((event) => this.handleBeforeUnload(event));
    this.updateQuestionCounter();
    this.prepareContext().catch((error) => {
      console.error(error);
      this.lockFormWithMessage("アクセスに失敗しました。時間をおいて再度お試しください。");
    });
  }

  async prepareContext() {
    const token = extractToken();
    if (!token) {
      this.lockFormWithMessage("このフォームには、運営から配布された専用リンクからアクセスしてください。");
      return;
    }

    this.state.token = token;
    this.view.setTokenValue(token);
    this.view.setContextGuard("アクセス権を確認しています…");

    try {
      const context = await fetchContextFromToken(this.database, token);
      this.applyContext(context);
    } catch (error) {
      console.error(error);
      this.lockFormWithMessage(error.message || "アクセスに必要な情報が不足しています。");
      this.view.clearFeedback();
    }
  }

  lockFormWithMessage(message) {
    this.state.locked = true;
    this.view.lockForm();
    this.view.setContextGuard(message);
    this.view.setSubmitBusy(false, true);
  }

  applyContext(context) {
    this.state.context = context;
    if (!context) {
      this.lockFormWithMessage("アクセス情報を確認できませんでした。運営までお問い合わせください。");
      return;
    }

    const displayName = context.participantName.trim();
    const eventName = context.eventName.trim();
    const scheduleLabel = context.scheduleLabel.trim();
    const scheduleDate = context.scheduleDate.trim();

    this.view.setHiddenContext({
      eventId: context.eventId,
      eventName,
      scheduleId: context.scheduleId,
      scheduleLabel,
      scheduleDate,
      participantId: context.participantId,
      groupNumber: context.groupNumber
    });

    if (displayName) {
      const limitedName = displayName.slice(0, MAX_RADIO_NAME_LENGTH);
      this.view.setRadioNameValue(limitedName);
    }

    const targetName = displayName || "ゲスト";
    const eventLabel = eventName ? `「${eventName}」` : "";
    const scheduleText = `あなたの参加日程：${scheduleLabel || scheduleDate || "未設定"}`;

    this.view.setContextBanner({
      welcomeText: `ようこそ${targetName}さん${eventLabel ? `、${eventLabel}` : ""}`,
      scheduleText
    });

    this.view.setGuidance(context.guidance?.trim() || "");
    this.view.setContextGuard("");
    this.view.setFormMetaVisible(true);
    this.view.unlockForm();
    this.view.setSubmitBusy(false, false);
    this.state.locked = false;
    this.state.dirty = false;
    this.updateQuestionCounter();
  }

  updateQuestionCounter() {
    const length = countGraphemes(this.view.getQuestionValue());
    this.view.updateQuestionCounter(length);
  }

  setFormBusy(isBusy) {
    this.view.setSubmitBusy(isBusy, this.state.locked);
  }

  markDirty() {
    this.state.dirty = true;
  }

  handleReset() {
    window.setTimeout(() => {
      this.state.dirty = false;
      this.updateQuestionCounter();
      this.view.clearFeedback();
    }, 0);
  }

  handleQuestionInput() {
    this.updateQuestionCounter();
  }

  handleQuestionBlur() {
    const sanitized = normalizeMultiline(this.view.getQuestionValue());
    if (sanitized !== this.view.getQuestionValue()) {
      this.view.setQuestionValue(sanitized);
      this.updateQuestionCounter();
    }
  }

  handleRadioNameBlur() {
    const sanitized = sanitizeRadioName(this.view.getRadioNameValue(), MAX_RADIO_NAME_LENGTH);
    this.view.setRadioNameValue(sanitized);
  }

  handleRadioNameInput() {
    const value = this.view.getRadioNameValue();
    if (value.length > MAX_RADIO_NAME_LENGTH) {
      this.view.setRadioNameValue(value.slice(0, MAX_RADIO_NAME_LENGTH));
    }
  }

  handleBeforeUnload(event) {
    if (this.state.dirty && !this.state.submittingController) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  async handleSubmit(event) {
    event.preventDefault();
    this.view.clearFeedback();

    if (!this.state.context || !this.state.token) {
      this.view.setFeedback("アクセス情報を確認できませんでした。リンクを再度開き直してください。", "error");
      return;
    }

    if (!this.view.reportValidity()) {
      this.view.setFeedback("未入力の項目があります。確認してください。", "error");
      return;
    }

    const sanitizedName = sanitizeRadioName(this.view.getRadioNameValue(), MAX_RADIO_NAME_LENGTH);
    if (this.view.getRadioNameValue() !== sanitizedName) {
      this.view.setRadioNameValue(sanitizedName);
    }
    if (!sanitizedName) {
      const input = this.view.radioNameInput;
      if (input && typeof input.setCustomValidity === "function") {
        input.setCustomValidity("ラジオネームを入力してください。");
        input.reportValidity();
        input.setCustomValidity("");
      }
      this.view.focusRadioName();
      this.view.setFeedback("ラジオネームを入力してください。", "error");
      return;
    }

    const normalizedQuestion = normalizeMultiline(this.view.getQuestionValue()).trim();
    if (this.view.getQuestionValue() !== normalizedQuestion) {
      this.view.setQuestionValue(normalizedQuestion);
    }
    const questionLength = countGraphemes(normalizedQuestion);

    if (!questionLength) {
      this.view.setFeedback("質問内容を入力してください。", "error");
      this.view.focusQuestion();
      return;
    }
    if (questionLength > MAX_QUESTION_LENGTH) {
      this.view.setFeedback("質問は400文字以内で入力してください。", "error");
      this.view.focusQuestion();
      return;
    }

    const genre = this.view.getSelectedGenre();
    if (!GENRE_OPTIONS.includes(genre)) {
      this.view.setFeedback("ジャンルの選択が正しくありません。", "error");
      return;
    }

    if (this.state.submittingController) {
      this.state.submittingController.abort();
    }

    const controller = new AbortController();
    this.state.submittingController = controller;
    this.setFormBusy(true);
    this.view.setFeedback("送信中です…");

    try {
      await this.submitQuestion(controller, {
        radioName: sanitizedName,
        question: normalizedQuestion,
        questionLength,
        genre
      });
      this.view.setFeedback("送信しました。ありがとうございました！", "success");
      this.view.setQuestionValue("");
      this.updateQuestionCounter();
      this.view.focusQuestion();
      this.state.dirty = false;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      console.error(error);
      this.view.setFeedback(error.message || "送信時にエラーが発生しました。", "error");
    } finally {
      if (this.state.submittingController === controller) {
        this.state.submittingController = null;
      }
      this.setFormBusy(false);
    }
  }

  async submitQuestion(controller, { radioName, question, questionLength, genre }) {
    const payload = {
      action: "submitQuestion",
      token: this.state.token,
      radioName,
      question,
      questionLength,
      groupNumber: this.view.getGroupNumber(),
      genre,
      schedule: this.view.getScheduleLabel(),
      scheduleDate: this.view.getScheduleDate(),
      eventId: this.view.getEventId(),
      eventName: this.view.getEventName(),
      scheduleId: this.view.getScheduleId(),
      participantId: this.view.getParticipantId(),
      clientTimestamp: Date.now(),
      language: navigator.language || "",
      userAgent: navigator.userAgent || "",
      referrer: document.referrer || "",
      formVersion: FORM_VERSION,
      guidance: this.state.context?.guidance || ""
    };

    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });

    const resultText = await response.text();
    let result = {};
    if (resultText) {
      try {
        result = JSON.parse(resultText);
      } catch (error) {
        throw new Error("サーバーからの応答を読み取れませんでした。");
      }
    }

    if (!response.ok || !result.success) {
      const message = result && result.error ? result.error : "送信に失敗しました。";
      throw new Error(message);
    }
  }
}
