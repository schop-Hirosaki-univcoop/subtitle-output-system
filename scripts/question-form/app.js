// app.js: 質問投稿フォームの起動処理と送信ハンドリングを統括するエントリースクリプトです。
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
  sanitizeRadioName,
  truncateGraphemes
} from "./string-utils.js";
import { ensureTrimmedString, coalesceTrimmed } from "./value-utils.js";
import { formatScheduleSummary } from "./schedule-format.js";
import { buildContextDescription } from "./context-copy.js";
import {
  createSubmissionController,
  isSubmissionAbortError,
  buildSubmissionPayload,
  submitQuestionRecord
} from "./submission-service.js";

/**
 * フォーム送信時のバリデーション失敗を表す独自エラー。
 * フォーカス移動関数を保持し、UI側で適切に入力欄へ誘導できます。
 */
class FormValidationError extends Error {
  constructor(message, { focus } = {}) {
    super(message);
    this.name = "FormValidationError";
    this.focus = typeof focus === "function" ? focus : null;
  }

  /**
   * 保持しているフォーカス移動処理があれば安全に実行します。
   */
  invokeFocus() {
    if (!this.focus) return;
    try {
      this.focus();
    } catch (error) {
      console.error("Failed to focus field after validation error", error);
    }
  }
}


/**
 * トークンAPIから取得した文脈オブジェクトを整形し、空文字を排除します。
 * @param {Record<string, unknown>|null|undefined} rawContext
 * @returns {ReturnType<typeof normalizeContextData>}
 */
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



/**
 * フォームの入力値を送信形式へ整形し、不要な空白やゼロ幅文字を取り除きます。
 * @param {{
 *   radioName: string,
 *   question: string,
 *   genre: string,
 *   groupNumber: string,
 *   scheduleLabel: string,
 *   scheduleDate: string,
 *   token: string,
 *   eventId: string,
 *   eventName: string,
 *   scheduleId: string,
 *   participantId: string
 * }} values
 * @returns {Record<string, string | number | boolean>}
 */
/**
 * 質問フォーム全体の状態管理と送信フローを統括するアプリケーションクラス。
 * ビュー層やFirebase依存を注入可能にし、テスト容易性を高めています。
 */
export class QuestionFormApp {
  /**
   * 依存するViewとDatabaseインスタンスを受け取り初期状態を確立します。
   * @param {{ view?: FormView, database?: import("firebase/database").Database }} [options]
   */
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

  /**
   * イベントハンドラのバインドや初回コンテキスト取得を行う初期化エントリーポイント。
   */
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

  /**
   * アクセストークンから参加者コンテキストを取得し、フォームを解錠します。
   */
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

  /**
   * フォームを操作不可にしつつ、ユーザーに向けた理由メッセージを表示します。
   * @param {string} message
   */
  lockFormWithMessage(message) {
    this.abortPendingSubmission();
    this.state.locked = true;
    this.view.lockForm();
    this.view.setContextGuard(message);
    this.view.setSubmitBusy(false, true);
    this.view.focusContextGuard();
  }

  /**
   * トークンAPIから取得した文脈情報をアプリへ反映し、フォームの文言を更新します。
   * @param {Record<string, unknown>|null} rawContext
   */
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

  /**
   * 現在の質問テキストからグラフェム長を算出し、カウンターを刷新します。
   */
  updateQuestionCounter() {
    const length = countGraphemes(this.view.getQuestionValue());
    this.view.updateQuestionCounter(length);
  }

  /**
   * フォーム送信時のボタン活性状態を制御します。
   * @param {boolean} isBusy
   */
  setFormBusy(isBusy) {
    this.view.setSubmitBusy(isBusy, this.state.locked);
  }

  /**
   * フォームに未保存変更があることをフラグで記録します。
   */
  markDirty() {
    this.state.dirty = true;
  }

  /**
   * 入力欄を既定値に戻し、必要に応じてフォーカスを移動させます。
   * @param {{ preserveRadioName?: boolean, focusQuestion?: boolean }} [options]
   */
  resetFormState({ preserveRadioName = false, focusQuestion = false } = {}) {
    if (!preserveRadioName) {
      this.view.setRadioNameValue("");
    }
    this.view.setQuestionValue("");
    this.view.resetGenreSelection();
    this.updateQuestionCounter();
    if (focusQuestion) {
      this.view.focusQuestion();
    }
    this.state.dirty = false;
  }

  /**
   * 現在の文脈に合わせてフォームを初期化します。
   */
  resetFormForContext() {
    this.resetFormState();
  }

  /**
   * 文脈が有効な状態のときにフォームを操作可能に切り替えます。
   */
  unlockFormForContext() {
    this.view.setFormMetaVisible(true);
    this.view.unlockForm();
    this.view.setSubmitBusy(false, false);
    this.state.locked = false;
  }

  /**
   * フォームのリセットイベントを遅延処理し、UIとステートを同期させます。
   */
  handleReset() {
    window.setTimeout(() => {
      this.resetFormState();
      this.view.clearFeedback();
    }, 0);
  }

  /**
   * 質問入力の都度カウンターを更新します。
   */
  handleQuestionInput() {
    this.updateQuestionCounter();
  }

  /**
   * フォーカスが離れた際に改行やスペースを正規化します。
   */
  handleQuestionBlur() {
    const sanitized = normalizeMultiline(this.view.getQuestionValue());
    if (sanitized !== this.view.getQuestionValue()) {
      this.view.setQuestionValue(sanitized);
      this.updateQuestionCounter();
    }
  }

  /**
   * ラジオネーム入力を正規化し、制限長を強制します。
   */
  handleRadioNameBlur() {
    const sanitized = sanitizeRadioName(this.view.getRadioNameValue(), MAX_RADIO_NAME_LENGTH);
    this.view.setRadioNameValue(sanitized);
  }

  /**
   * 入力中のラジオネームを逐次トリミングして制限内に保ちます。
   */
  handleRadioNameInput() {
    const value = this.view.getRadioNameValue();
    const truncated = truncateGraphemes(value, MAX_RADIO_NAME_LENGTH);
    if (value !== truncated) {
      this.view.setRadioNameValue(truncated);
    }
  }

  /**
   * 未送信の変更がある場合に離脱確認ダイアログを表示します。
   * @param {BeforeUnloadEvent} event
   */
  handleBeforeUnload(event) {
    if (this.state.dirty && !this.state.submittingController) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  /**
   * フォーム送信処理のメインルーチン。バリデーション・Firebase書き込みを順に実行します。
   * @param {SubmitEvent} event
   */
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

    const controller = this.startSubmissionController();
    this.setFormBusy(true);
    this.view.setFeedback("送信中です…");

    try {
      const snapshot = this.captureSubmissionSnapshot();
      const { token, submission } = buildSubmissionPayload({
        token: this.state.token,
        formData,
        snapshot
      });
      const result = await submitQuestionRecord({
        database: this.database,
        controller,
        token,
        submission,
        context: this.state.context,
        databaseOps: { ref, set, remove }
      });
      this.handleSubmitSuccess(result);
    } catch (error) {
      if (isSubmissionAbortError(error)) {
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

  /**
   * コンテキストとトークンが揃っているかを判定します。
   * @returns {boolean}
   */
  hasValidContext() {
    return Boolean(this.state.context && this.state.token);
  }

  /**
   * 現在のフォーム入力とコンテキスト値を合成したスナップショットを返します。
   * @returns {Record<string, string>}
   */
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

  /**
   * 入力内容を検証しつつ送信可能な形式に正規化します。
   * 異常時はFormValidationErrorを投げ、呼び出し側でUI制御を行えます。
   * @returns {{ radioName: string, question: string, questionLength: number, genre: string }}
   */
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

  /**
   * 進行中の送信処理があればAbortControllerで中断します。
   */
  abortPendingSubmission() {
    if (this.state.submittingController) {
      this.state.submittingController.abort();
      this.state.submittingController = null;
    }
  }

  /**
   * 新しい送信制御用AbortControllerを生成し、既存処理を破棄します。
   * @returns {AbortController}
   */
  startSubmissionController() {
    this.abortPendingSubmission();
    const controller = createSubmissionController();
    this.state.submittingController = controller;
    return controller;
  }

  /**
   * 送信後の後処理をまとめ、完了メッセージとステート更新を行います。
   * @param {{ queueProcessed: boolean }} result
   */
  handleSubmitSuccess(result) {
    if (result?.queueProcessed) {
      this.view.setFeedback("送信しました。ありがとうございました！", "success");
    } else {
      this.view.setFeedback("送信しました。反映まで数秒かかる場合があります。", "success");
    }
    this.resetFormAfterSubmission();
  }

  /**
   * 正常送信後にフォーム内容を初期化し、再入力しやすい状態へ戻します。
   */
  resetFormAfterSubmission() {
    this.resetFormState({ preserveRadioName: true, focusQuestion: true });
  }

}

/**
 * ブラウザに実装された暗号APIを取得します。
 * 非対応環境ではnullを返し、代替処理へフォールバックさせます。
 * @returns {Crypto|null}
 */
