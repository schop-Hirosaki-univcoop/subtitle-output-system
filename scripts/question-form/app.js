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
import { ref, remove, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
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

function ensureTrimmedString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function coalesceTrimmed(...values) {
  for (const value of values) {
    const trimmed = ensureTrimmedString(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

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
  const trimmed = ensureTrimmedString(value);
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
  const trimmedLabel = ensureTrimmedString(label);
  const trimmedDate = ensureTrimmedString(date);
  const startDate = parseDateTimeValue(ensureTrimmedString(start));
  const endDate = parseDateTimeValue(ensureTrimmedString(end));
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

function normalizeContextData(rawContext) {
  if (!rawContext) {
    return null;
  }
  return {
    eventId: ensureTrimmedString(rawContext.eventId),
    eventName: ensureTrimmedString(rawContext.eventName),
    scheduleId: ensureTrimmedString(rawContext.scheduleId),
    scheduleLabel: ensureTrimmedString(rawContext.scheduleLabel),
    scheduleDate: ensureTrimmedString(rawContext.scheduleDate),
    scheduleStart: ensureTrimmedString(rawContext.scheduleStart),
    scheduleEnd: ensureTrimmedString(rawContext.scheduleEnd),
    participantId: ensureTrimmedString(rawContext.participantId),
    participantName: ensureTrimmedString(rawContext.participantName),
    groupNumber: ensureTrimmedString(rawContext.groupNumber),
    guidance: ensureTrimmedString(rawContext.guidance)
  };
}

function buildContextDescription(eventName) {
  const trimmedEventName = ensureTrimmedString(eventName);
  if (!trimmedEventName) {
    return "こちらは【なんでも相談ラジオ】の質問受付フォームです。気になることや相談したいことをお気軽にお寄せください。";
  }
  return `こちらは「${trimmedEventName}」の中で行われる【なんでも相談ラジオ】の質問受付フォームです。気になることや相談したいことをお気軽にお寄せください。`;
}

function createAbortError() {
  if (typeof DOMException === "function") {
    return new DOMException("Aborted", "AbortError");
  }
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function assertActiveController(controller) {
  if (controller?.signal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function sanitizeSubmissionPayload(values) {
  return Object.entries(values).reduce((acc, [key, value]) => {
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
}

function collectClientMetadata() {
  const nav = typeof navigator === "object" && navigator ? navigator : null;
  const doc = typeof document === "object" && document ? document : null;
  const win = typeof window === "object" && window ? window : null;

  const language = typeof nav?.language === "string" ? nav.language : "";
  const userAgent = typeof nav?.userAgent === "string" ? nav.userAgent : "";
  const referrer = typeof doc?.referrer === "string" ? doc.referrer : "";
  const origin = typeof win?.location?.origin === "string" ? win.location.origin : "";

  return { language, userAgent, referrer, origin };
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
    this.abortPendingSubmission();
    this.state.locked = true;
    this.view.lockForm();
    this.view.setContextGuard(message);
    this.view.setSubmitBusy(false, true);
    this.view.focusContextGuard();
  }

  applyContext(rawContext) {
    const context = normalizeContextData(rawContext);
    this.state.context = context;
    if (!context) {
      this.lockFormWithMessage("アクセス情報を確認できませんでした。運営までお問い合わせください。");
      return;
    }

    this.view.setHiddenContext({
      eventId: context.eventId,
      eventName: context.eventName,
      scheduleId: context.scheduleId,
      scheduleLabel: context.scheduleLabel,
      scheduleDate: context.scheduleDate,
      participantId: context.participantId,
      groupNumber: context.groupNumber
    });

    this.resetFormForContext();

    const targetName = context.participantName || "ゲスト";
    const scheduleSummary = formatScheduleSummary({
      label: context.scheduleLabel,
      date: context.scheduleDate,
      start: context.scheduleStart,
      end: context.scheduleEnd
    });
    const scheduleText = `あなたの参加日程：${scheduleSummary}`;
    const descriptionText = buildContextDescription(context.eventName);

    this.view.setContextBanner({
      welcomeText: `ようこそ${targetName}さん`,
      descriptionText,
      scheduleText
    });

    this.view.setGuidance(context.guidance || "");
    this.view.setContextGuard("");
    this.unlockFormForContext();
    this.state.dirty = false;
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

  resetFormForContext() {
    this.view.setRadioNameValue("");
    this.view.resetGenreSelection();
    this.updateQuestionCounter();
  }

  unlockFormForContext() {
    this.view.setFormMetaVisible(true);
    this.view.unlockForm();
    this.view.setSubmitBusy(false, false);
    this.state.locked = false;
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
      if (isAbortError(error)) {
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

  captureSubmissionSnapshot() {
    const context = this.state.context ?? {};
    const groupNumber = coalesceTrimmed(this.view.getGroupNumber(), context.groupNumber);
    const scheduleLabel = coalesceTrimmed(this.view.getScheduleLabel(), context.scheduleLabel);
    const scheduleDate = coalesceTrimmed(this.view.getScheduleDate(), context.scheduleDate);
    const eventId = coalesceTrimmed(this.view.getEventId(), context.eventId);
    const eventName = coalesceTrimmed(this.view.getEventName(), context.eventName);
    const scheduleId = coalesceTrimmed(this.view.getScheduleId(), context.scheduleId);
    const participantId = coalesceTrimmed(this.view.getParticipantId(), context.participantId);

    return {
      groupNumber,
      teamNumber: groupNumber,
      scheduleLabel,
      scheduleDate,
      scheduleStart: context.scheduleStart,
      scheduleEnd: context.scheduleEnd,
      eventId,
      eventName,
      scheduleId,
      participantId,
      participantName: context.participantName,
      guidance: context.guidance
    };
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

  abortPendingSubmission() {
    if (this.state.submittingController) {
      this.state.submittingController.abort();
      this.state.submittingController = null;
    }
  }

  resetSubmissionController() {
    this.abortPendingSubmission();
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
    this.resetFormAfterSubmission();
  }

  resetFormAfterSubmission() {
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

    const snapshot = this.captureSubmissionSnapshot();
    const clientMetadata = collectClientMetadata();
    const submissionBase = {
      token,
      radioName,
      question,
      questionLength,
      genre,
      groupNumber: snapshot.groupNumber,
      teamNumber: snapshot.teamNumber,
      scheduleLabel: snapshot.scheduleLabel,
      scheduleDate: snapshot.scheduleDate,
      scheduleStart: snapshot.scheduleStart,
      scheduleEnd: snapshot.scheduleEnd,
      eventId: snapshot.eventId,
      eventName: snapshot.eventName,
      scheduleId: snapshot.scheduleId,
      participantId: snapshot.participantId,
      participantName: snapshot.participantName,
      clientTimestamp: Date.now(),
      language: clientMetadata.language,
      userAgent: clientMetadata.userAgent,
      referrer: clientMetadata.referrer,
      formVersion: FORM_VERSION,
      guidance: snapshot.guidance,
      origin: clientMetadata.origin,
      status: "pending"
    };

    const submission = sanitizeSubmissionPayload(submissionBase);

    return { token, submission };
  }

  async submitQuestion(controller, formData) {
    assertActiveController(controller);

    const { token, submission } = this.createSubmissionData(formData);

    assertActiveController(controller);

    const questionUid = generateQuestionUid();
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
    const statusRecord = { answered: false, selecting: false, updatedAt: timestamp };

    const questionRef = ref(this.database, `questions/normal/${questionUid}`);
    const statusRef = ref(this.database, `questionStatus/${questionUid}`);
    let questionCreated = false;

    try {
      await set(questionRef, questionRecord);
      questionCreated = true;
      await set(statusRef, statusRecord);
      queueProcessed = true;
    } catch (error) {
      if (questionCreated) {
        try {
          await remove(questionRef);
        } catch (cleanupError) {
          console.warn("Failed to roll back question record after status write error", cleanupError);
        }
      }
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

function prefixQuestionUid(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return `q_${Date.now().toString(36)}`;
  }
  return value.startsWith("q_") ? value : `q_${value}`;
}

function generateQuestionUid() {
  const cryptoObj = getCrypto();
  if (cryptoObj) {
    if (typeof cryptoObj.randomUUID === "function") {
      return prefixQuestionUid(cryptoObj.randomUUID());
    }
    if (typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return prefixQuestionUid(formatUuidFromBytes(bytes));
    }
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10)).join("");
  return prefixQuestionUid(`${timestamp}_${randomPart.slice(0, 18)}`);
}

function buildQuestionRecord({
  uid,
  token,
  submission,
  context,
  timestamp
}) {
  const coalescedGroup = coalesceTrimmed(submission.groupNumber, context?.groupNumber);
  const scheduleLabel = coalesceTrimmed(submission.scheduleLabel, context?.scheduleLabel);
  const scheduleStart = coalesceTrimmed(submission.scheduleStart, context?.scheduleStart);
  const scheduleEnd = coalesceTrimmed(submission.scheduleEnd, context?.scheduleEnd);
  const participantId = coalesceTrimmed(submission.participantId, context?.participantId);
  const eventId = coalesceTrimmed(submission.eventId, context?.eventId);
  const scheduleId = coalesceTrimmed(submission.scheduleId, context?.scheduleId);
  const questionLength = Number(submission.questionLength);

  const record = {
    uid,
    token: ensureTrimmedString(token),
    name: ensureTrimmedString(submission.radioName),
    question: ensureTrimmedString(submission.question),
    group: coalescedGroup,
    genre: coalesceTrimmed(submission.genre) || "その他",
    schedule: scheduleLabel,
    scheduleStart,
    scheduleEnd,
    scheduleDate: coalesceTrimmed(submission.scheduleDate, context?.scheduleDate),
    participantId,
    participantName: coalesceTrimmed(submission.participantName, context?.participantName),
    guidance: coalesceTrimmed(submission.guidance, context?.guidance),
    eventId,
    eventName: coalesceTrimmed(submission.eventName, context?.eventName),
    scheduleId,
    ts: timestamp,
    updatedAt: timestamp,
    type: "normal"
  };

  if (Number.isFinite(questionLength) && questionLength > 0) {
    record.questionLength = questionLength;
  }

  return record;
}
