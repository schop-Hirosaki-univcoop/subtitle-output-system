import { getDatabaseInstance } from "./firebase.js";
import { fetchContextFromToken, extractToken } from "./context-service.js";
import { FormView } from "./view.js";
import {
  GENRE_OPTIONS,
  FORM_VERSION,
  firebaseConfig,
  MAX_QUESTION_LENGTH,
  MAX_RADIO_NAME_LENGTH
} from "./constants.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  countGraphemes,
  normalizeMultiline,
  sanitizeRadioName
} from "./string-utils.js";

const hasIntlDateTime = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
const DATE_FORMATTER = hasIntlDateTime
  ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
  : null;
const TIME_FORMATTER = hasIntlDateTime
  ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false })
  : null;

class FormValidationError extends Error {
  constructor(message, { focus } = {}) {
    super(message);
    this.name = "FormValidationError";
    this.focus = typeof focus === "function" ? focus : null;
  }

  invokeFocus() {
    if (!this.focus) return;
    try {
      this.focus();
    } catch (error) {
      console.error("Failed to focus field after validation error", error);
    }
  }
}

function parseDateTimeValue(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    if ([year, month, day].some(Number.isNaN)) return null;
    return new Date(year, month - 1, day);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    const [datePart, timePart] = trimmed.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const timeParts = timePart.split(":").map(Number);
    if ([year, month, day, ...timeParts].some(Number.isNaN)) return null;
    const [hour, minute, second = 0] = timeParts;
    return new Date(year, month - 1, day, hour, minute, second);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (DATE_FORMATTER) return DATE_FORMATTER.format(date);
  return date.toISOString().split("T")[0];
}

function formatTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (TIME_FORMATTER) return TIME_FORMATTER.format(date);
  return date.toTimeString().slice(0, 5);
}

function formatScheduleSummary({ label = "", date = "", start = "", end = "" } = {}) {
  const trimmedLabel = String(label || "").trim();
  const trimmedDate = String(date || "").trim();
  const startDate = parseDateTimeValue(start);
  const endDate = parseDateTimeValue(end);
  const baseDate = startDate || parseDateTimeValue(trimmedDate);
  const fallback = trimmedLabel || trimmedDate;

  if (!baseDate && !fallback) {
    return "未設定";
  }

  const dateText = baseDate ? formatDateDisplay(baseDate) : "";
  if (!dateText) {
    return fallback || "未設定";
  }

  let timeText = "";
  if (startDate) {
    const startTime = formatTimeDisplay(startDate);
    if (startTime) {
      if (endDate && !Number.isNaN(endDate.getTime())) {
        const endTime = formatTimeDisplay(endDate);
        if (endTime) {
          if (startDate.toDateString() === endDate.toDateString()) {
            timeText = `${startTime}〜${endTime}`;
          } else {
            const endDateText = formatDateDisplay(endDate);
            timeText = endDateText ? `${startTime}〜${endDateText} ${endTime}` : `${startTime}〜${endTime}`;
          }
        }
      } else {
        timeText = `${startTime}〜`;
      }
    }
  }

  const needsLabelSuffix = trimmedLabel && trimmedLabel !== dateText;
  const rangeText = timeText ? `${dateText} ${timeText}` : dateText;
  if (rangeText) {
    return rangeText;
  }
  if (needsLabelSuffix) {
    return trimmedLabel;
  }
  return fallback || "未設定";
}

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
    this.view.focusContextGuard();
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
    const scheduleStart = context.scheduleStart.trim();
    const scheduleEnd = context.scheduleEnd.trim();

    this.view.setHiddenContext({
      eventId: context.eventId,
      eventName,
      scheduleId: context.scheduleId,
      scheduleLabel,
      scheduleDate,
      participantId: context.participantId,
      groupNumber: context.groupNumber
    });

    this.view.setRadioNameValue("");
    this.view.resetGenreSelection();

    const targetName = displayName || "ゲスト";
    const scheduleSummary = formatScheduleSummary({
      label: scheduleLabel,
      date: scheduleDate,
      start: scheduleStart,
      end: scheduleEnd
    });
    const scheduleText = `あなたの参加日程：${scheduleSummary}`;
    const descriptionText = eventName
      ? `こちらは「${eventName}」の中で行われる【なんでも相談ラジオ】の質問受付フォームです。気になることや相談したいことをお気軽にお寄せください。`
      : "こちらは【なんでも相談ラジオ】の質問受付フォームです。気になることや相談したいことをお気軽にお寄せください。";

    this.view.setContextBanner({
      welcomeText: `ようこそ${targetName}さん`,
      descriptionText,
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
      this.view.resetGenreSelection();
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

    if (!this.hasValidContext()) {
      this.view.setFeedback("アクセス情報を確認できませんでした。リンクを再度開き直してください。", "error");
      return;
    }

    if (!this.view.reportValidity()) {
      this.view.setFeedback("未入力の項目があります。確認してください。", "error");
      return;
    }

    let formData;
    try {
      formData = this.getSanitizedFormData();
    } catch (error) {
      if (error instanceof FormValidationError) {
        error.invokeFocus();
        this.view.setFeedback(error.message, "error");
        return;
      }
      throw error;
    }

    const controller = this.resetSubmissionController();
    this.setFormBusy(true);
    this.view.setFeedback("送信中です…");

    try {
      const result = await this.submitQuestion(controller, formData);
      this.handleSubmitSuccess(result);
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

  hasValidContext() {
    return Boolean(this.state.context && this.state.token);
  }

  getSanitizedFormData() {
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
      throw new FormValidationError("ラジオネームを入力してください。", {
        focus: () => this.view.focusRadioName()
      });
    }

    const normalizedQuestion = normalizeMultiline(this.view.getQuestionValue()).trim();
    if (this.view.getQuestionValue() !== normalizedQuestion) {
      this.view.setQuestionValue(normalizedQuestion);
    }

    const questionLength = countGraphemes(normalizedQuestion);
    this.updateQuestionCounter();

    if (!questionLength) {
      throw new FormValidationError("質問内容を入力してください。", {
        focus: () => this.view.focusQuestion()
      });
    }
    if (questionLength > MAX_QUESTION_LENGTH) {
      throw new FormValidationError(`質問は${MAX_QUESTION_LENGTH}文字以内で入力してください。`, {
        focus: () => this.view.focusQuestion()
      });
    }

    const genre = this.view.getSelectedGenre();
    if (!genre) {
      throw new FormValidationError("ジャンルを選択してください。", {
        focus: () => this.view.focusGenre()
      });
    }
    if (!GENRE_OPTIONS.includes(genre)) {
      throw new FormValidationError("ジャンルの選択が正しくありません。");
    }

    return { radioName: sanitizedName, question: normalizedQuestion, questionLength, genre };
  }

  resetSubmissionController() {
    if (this.state.submittingController) {
      this.state.submittingController.abort();
    }
    const controller = new AbortController();
    this.state.submittingController = controller;
    return controller;
  }

  handleSubmitSuccess(result) {
    if (result?.queueProcessed) {
      this.view.setFeedback("送信しました。ありがとうございました！", "success");
    } else {
      this.view.setFeedback("送信しました。反映まで数秒かかる場合があります。", "success");
    }
    this.view.setQuestionValue("");
    this.view.resetGenreSelection();
    this.updateQuestionCounter();
    this.view.focusQuestion();
    this.state.dirty = false;
  }

  createSubmissionData({ radioName, question, questionLength, genre }) {
    const token = this.state.token;
    if (!token) {
      throw new Error("アクセス情報が無効です。配布されたリンクからアクセスし直してください。");
    }

    const submissionBase = {
      token,
      radioName,
      question,
      questionLength,
      genre,
      groupNumber: this.view.getGroupNumber(),
      teamNumber: this.view.getGroupNumber(),
      scheduleLabel: this.view.getScheduleLabel(),
      scheduleDate: this.view.getScheduleDate(),
      scheduleStart: String(this.state.context?.scheduleStart || ""),
      scheduleEnd: String(this.state.context?.scheduleEnd || ""),
      eventId: this.view.getEventId(),
      eventName: this.view.getEventName(),
      scheduleId: this.view.getScheduleId(),
      participantId: this.view.getParticipantId(),
      participantName: this.state.context?.participantName || "",
      clientTimestamp: Date.now(),
      language: navigator.language || "",
      userAgent: navigator.userAgent || "",
      referrer: document.referrer || "",
      formVersion: FORM_VERSION,
      guidance: this.state.context?.guidance || "",
      origin: typeof window !== "undefined" && window.location ? window.location.origin : "",
      status: "pending"
    };

    const submission = Object.entries(submissionBase).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) {
        return acc;
      }
      if (typeof value === "string") {
        acc[key] = value.trim();
        return acc;
      }
      if (typeof value === "number") {
        acc[key] = value;
        return acc;
      }
      acc[key] = String(value);
      return acc;
    }, {});

    return { token, submission };
  }

  async submitQuestion(controller, formData) {
    if (controller?.signal?.aborted) {
      const error = new DOMException("Aborted", "AbortError");
      throw error;
    }

    const { token, submission } = this.createSubmissionData(formData);

    if (controller?.signal?.aborted) {
      const error = new DOMException("Aborted", "AbortError");
      throw error;
    }

    const questionUid = generateQuestionUid();
    const entryRef = ref(this.database, `questions/${questionUid}`);
    submission.uid = questionUid;

    let queueProcessed = false;
    const timestamp = Date.now();
    const questionRecord = buildQuestionRecord({
      uid: questionUid,
      token,
      submission,
      context: this.state.context,
      timestamp
    });

    try {
      await set(entryRef, questionRecord);
      queueProcessed = true;
    } catch (error) {
      const isPermissionError = error?.code === "PERMISSION_DENIED";
      const message = isPermissionError
        ? "フォームを送信できませんでした。リンクの有効期限が切れていないかご確認ください。"
        : "フォームを送信できませんでした。通信状況を確認して再度お試しください。";
      const clientError = new Error(message);
      clientError.cause = error;
      throw clientError;
    }

    return { queueProcessed };
  }
}

function getCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto;
  }
  if (typeof window !== "undefined" && window.crypto) {
    return window.crypto;
  }
  if (typeof self !== "undefined" && self.crypto) {
    return self.crypto;
  }
  return undefined;
}

function formatUuidFromBytes(bytes) {
  const toHex = (segment) => Array.from(segment, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    toHex(bytes.subarray(0, 4)),
    toHex(bytes.subarray(4, 6)),
    toHex(bytes.subarray(6, 8)),
    toHex(bytes.subarray(8, 10)),
    toHex(bytes.subarray(10))
  ].join("-");
}

function generateQuestionUid() {
  const cryptoObj = getCrypto();
  if (cryptoObj) {
    if (typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    if (typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return `q_${formatUuidFromBytes(bytes)}`;
    }
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10)).join("");
  return `q_${timestamp}_${randomPart.slice(0, 18)}`;
}

function buildQuestionRecord({
  uid,
  token,
  submission,
  context,
  timestamp
}) {
  const ensureString = (value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim());
  const coalescedGroup = ensureString(submission.groupNumber) || ensureString(context?.groupNumber);
  const scheduleLabel = ensureString(submission.scheduleLabel) || ensureString(context?.scheduleLabel);
  const scheduleStart = ensureString(submission.scheduleStart) || ensureString(context?.scheduleStart);
  const scheduleEnd = ensureString(submission.scheduleEnd) || ensureString(context?.scheduleEnd);
  const participantId = ensureString(submission.participantId) || ensureString(context?.participantId);
  const eventId = ensureString(submission.eventId) || ensureString(context?.eventId);
  const scheduleId = ensureString(submission.scheduleId) || ensureString(context?.scheduleId);
  const questionLength = Number(submission.questionLength);

  const record = {
    uid,
    token: ensureString(token),
    name: ensureString(submission.radioName),
    question: ensureString(submission.question),
    group: coalescedGroup,
    genre: ensureString(submission.genre) || "その他",
    schedule: scheduleLabel,
    scheduleStart,
    scheduleEnd,
    participantId,
    eventId,
    scheduleId,
    ts: timestamp,
    answered: false,
    selecting: false,
    updatedAt: timestamp,
    type: "normal"
  };

  if (Number.isFinite(questionLength) && questionLength > 0) {
    record.questionLength = questionLength;
  }

  return record;
}
