<template>
  <section class="module module--primary intake-module" aria-labelledby="form-title">
    <div class="module-header">
      <div class="module-heading">
        <h1 id="form-title">質問受付フォーム</h1>
        <p class="module-description">
          お送りした専用URLからアクセスし、ラジオネームと質問内容を入力してください。
        </p>
      </div>
    </div>
    <div class="module-body">
      <!-- コンテキストバナー: 招待リンク由来の挨拶や日程情報を表示 -->
      <div
        v-if="contextBannerVisible"
        id="context-banner"
        class="context-banner"
      >
        <p
          v-if="contextBanner.welcomeText"
          id="welcome-line"
          class="context-text context-text--welcome"
        >
          {{ contextBanner.welcomeText }}
        </p>
        <p
          v-if="contextBanner.descriptionText"
          id="intro-line"
          class="context-text context-text--intro"
        >
          {{ contextBanner.descriptionText }}
        </p>
        <p
          v-if="contextBanner.scheduleText"
          id="schedule-line"
          class="context-text context-text--schedule"
        >
          {{ contextBanner.scheduleText }}
        </p>
      </div>
      <!-- 利用制限表示: 認証エラーなどフォームを非表示にするガード -->
      <div
        v-if="contextGuardMessage"
        id="context-guard"
        class="context-guard"
        role="alert"
        aria-live="assertive"
        tabindex="-1"
      >
        {{ contextGuardMessage }}
      </div>

      <!-- 質問フォーム: ラジオネームと質問本文をサーバーへ送信 -->
      <form
        id="question-form"
        class="intake-form"
        novalidate
        autocomplete="on"
        :hidden="isLocked"
        :aria-hidden="isLocked"
        @submit.prevent="handleSubmit"
        @input="handleFormInput"
        @reset="handleReset"
      >
        <!-- Hidden fields -->
        <input id="access-token" name="access-token" type="hidden" :value="token" />
        <input id="event-id" name="event-id" type="hidden" :value="hiddenContext.eventId" />
        <input id="event-name" name="event-name" type="hidden" :value="hiddenContext.eventName" />
        <input id="schedule-id" name="schedule-id" type="hidden" :value="hiddenContext.scheduleId" />
        <input id="schedule" name="schedule" type="hidden" :value="hiddenContext.scheduleLabel" />
        <input id="schedule-date" name="schedule-date" type="hidden" :value="hiddenContext.scheduleDate" />
        <input
          id="schedule-location"
          name="schedule-location"
          type="hidden"
          :value="hiddenContext.scheduleLocation"
        />
        <input
          id="participant-id"
          name="participant-id"
          type="hidden"
          :value="hiddenContext.participantId"
        />
        <input id="group-number" name="group-number" type="hidden" :value="hiddenContext.groupNumber" />

        <div class="form-field">
          <!-- ラジオネーム入力: 配信表示名を収集 -->
          <div class="field-header">
            <label for="radio-name">ラジオネーム</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <input
            id="radio-name"
            ref="radioNameInputRef"
            name="radio-name"
            type="text"
            class="input"
            inputmode="text"
            autocomplete="off"
            :maxlength="MAX_RADIO_NAME_LENGTH"
            required
            :value="radioName"
            @input="handleRadioNameInput"
            @blur="handleRadioNameBlur"
          />
          <div class="field-footer">
            <p class="field-hint">{{ MAX_RADIO_NAME_LENGTH }}文字まで。本名ではなく番組用のお名前をご入力ください。</p>
          </div>
        </div>

        <div class="form-field">
          <!-- 質問本文入力: 60文字制限でテロップ化を想定 -->
          <div class="field-header">
            <label for="question-text">質問・お悩み</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <textarea
            id="question-text"
            ref="questionInputRef"
            name="question-text"
            class="input input--textarea"
            rows="6"
            :maxlength="MAX_QUESTION_LENGTH"
            placeholder="質問や相談内容を入力してください"
            required
            :value="question"
            @input="handleQuestionInput"
            @blur="handleQuestionBlur"
          ></textarea>
          <div class="field-footer">
            <p class="field-hint">句読点や改行を含めて{{ MAX_QUESTION_LENGTH }}文字以内で入力してください。</p>
            <p
              id="question-counter"
              class="field-hint field-hint--status"
              :class="{ 'status-error': questionLength > MAX_QUESTION_LENGTH }"
              role="status"
              aria-live="polite"
            >
              {{ questionLength }} / {{ MAX_QUESTION_LENGTH }}文字
            </p>
          </div>
        </div>

        <div class="form-field">
          <!-- ジャンル選択: オンエア時の分類と運営側並び替えに利用 -->
          <div class="field-header">
            <label for="genre">ジャンル</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <select
            id="genre"
            ref="genreSelectRef"
            name="genre"
            class="input"
            required
            :value="genre"
            @change="handleGenreChange"
          >
            <option value="" data-placeholder="true" disabled :selected="!genre">
              ジャンルを選択してください
            </option>
            <option
              v-for="option in GENRE_OPTIONS"
              :key="option"
              :value="option"
              :selected="genre === option"
            >
              {{ option }}
            </option>
          </select>
        </div>

        <div class="form-actions">
          <!-- 送信ボタンと送信後フィードバック領域 -->
          <button
            type="submit"
            class="btn btn-primary"
            id="submit-button"
            :disabled="isBusy || isLocked"
            :aria-busy="isBusy"
          >
            {{ isBusy ? "送信中…" : "送信する" }}
          </button>
          <p
            id="form-feedback"
            class="form-feedback"
            :class="{
              'form-feedback--success': feedbackType === 'success',
              'form-feedback--error': feedbackType === 'error',
            }"
            role="alert"
            aria-live="polite"
          >
            {{ feedbackMessage }}
          </p>
        </div>
      </form>
      <!-- 利用案内: 送信後の連絡方法や運営向け案内のテキスト -->
      <div
        v-if="formMetaVisible"
        class="form-meta"
        id="form-meta"
      >
        <p v-if="guidance" class="form-meta-line" id="form-guidance">
          {{ guidance }}
        </p>
        <p class="form-meta-line">フォームの利用方法やリンクに関するお問い合わせは、運営からのご案内に従ってください。</p>
        <p class="form-meta-line">送信後に内容を修正したい場合は、配布元までご連絡ください。</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { getDatabaseInstance } from "../../scripts/question-form/firebase.js";
import { fetchContextFromToken, extractToken } from "../../scripts/question-form/context-service.js";
import {
  GENRE_OPTIONS,
  MAX_RADIO_NAME_LENGTH,
  MAX_QUESTION_LENGTH,
  firebaseConfig,
} from "../../scripts/question-form/constants.js";
import {
  countGraphemes,
  normalizeMultiline,
  sanitizeRadioName,
  truncateGraphemes,
} from "../../scripts/question-form/string-utils.js";
import { ensureTrimmedString, coalesceTrimmed } from "../../scripts/question-form/value-utils.js";
import { formatScheduleSummary } from "../../scripts/question-form/schedule-format.js";
import { buildContextDescription } from "../../scripts/question-form/context-copy.js";
import {
  createSubmissionController,
  isSubmissionAbortError,
  buildSubmissionPayload,
  submitQuestionRecord,
} from "../../scripts/question-form/submission-service.js";
import { ref as firebaseRef, set, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/**
 * フォーム送信時のバリデーション失敗を表す独自エラー。
 */
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

/**
 * トークンAPIから取得した文脈オブジェクトを整形し、空文字を排除します。
 */
function normalizeContextData(rawContext) {
  if (!rawContext || typeof rawContext !== "object") {
    return null;
  }
  return {
    eventId: ensureTrimmedString(rawContext.eventId),
    eventName: ensureTrimmedString(rawContext.eventName),
    scheduleId: ensureTrimmedString(rawContext.scheduleId),
    scheduleLabel: ensureTrimmedString(rawContext.scheduleLabel),
    scheduleDate: ensureTrimmedString(rawContext.scheduleDate),
    scheduleLocation: ensureTrimmedString(rawContext.scheduleLocation),
    scheduleStart: ensureTrimmedString(rawContext.scheduleStart),
    scheduleEnd: ensureTrimmedString(rawContext.scheduleEnd),
    participantId: ensureTrimmedString(rawContext.participantId),
    participantName: ensureTrimmedString(rawContext.participantName),
    groupNumber: ensureTrimmedString(rawContext.groupNumber),
    guidance: ensureTrimmedString(rawContext.guidance),
  };
}

// Firebase Database インスタンス
const database = getDatabaseInstance(firebaseConfig);

// フォーム状態
const token = ref("");
const isLocked = ref(true);
const isBusy = ref(false);
const isDirty = ref(false);
const submittingController = ref(null);

// コンテキスト情報
const context = ref(null);
const contextGuardMessage = ref("アクセス権を確認しています…");
const contextBanner = ref({
  welcomeText: "",
  descriptionText: "",
  scheduleText: "",
});
const hiddenContext = ref({
  eventId: "",
  eventName: "",
  scheduleId: "",
  scheduleLabel: "",
  scheduleDate: "",
  scheduleLocation: "",
  participantId: "",
  groupNumber: "",
});
const guidance = ref("");
const formMetaVisible = ref(false);

// フォーム入力値
const radioName = ref("");
const question = ref("");
const genre = ref("");

// フィードバック
const feedbackMessage = ref("");
const feedbackType = ref("");

// DOM要素参照
const radioNameInputRef = ref(null);
const questionInputRef = ref(null);
const genreSelectRef = ref(null);

// 計算プロパティ
const contextBannerVisible = computed(() => {
  return Boolean(
    contextBanner.value.welcomeText ||
      contextBanner.value.descriptionText ||
      contextBanner.value.scheduleText
  );
});

const questionLength = computed(() => {
  return countGraphemes(question.value);
});

// メソッド
const lockFormWithMessage = (message) => {
  abortPendingSubmission();
  isLocked.value = true;
  contextGuardMessage.value = message;
  isBusy.value = false;
  if (contextGuardMessage.value) {
    const guardEl = document.getElementById("context-guard");
    if (guardEl) {
      try {
        guardEl.focus();
      } catch (error) {
        // no-op
      }
    }
  }
};

const abortPendingSubmission = () => {
  if (submittingController.value) {
    submittingController.value.abort();
    submittingController.value = null;
  }
};

const startSubmissionController = () => {
  abortPendingSubmission();
  const controller = createSubmissionController();
  submittingController.value = controller;
  return controller;
};

const updateQuestionCounter = () => {
  // リアクティブなquestionLengthを使用するため、この関数は不要
  // ただし、互換性のために残す
};

const prepareContext = async () => {
  const extractedToken = extractToken();
  if (!extractedToken) {
    lockFormWithMessage("このフォームには、運営から配布された専用リンクからアクセスしてください。");
    return;
  }

  token.value = extractedToken;
  contextGuardMessage.value = "アクセス権を確認しています…";

  try {
    const rawContext = await fetchContextFromToken(database, extractedToken);
    applyContext(rawContext);
  } catch (error) {
    console.error(error);
    lockFormWithMessage(error.message || "アクセスに必要な情報が不足しています。");
    feedbackMessage.value = "";
  }
};

const applyContext = (rawContext) => {
  const normalizedContext = normalizeContextData(rawContext);
  context.value = normalizedContext;
  if (!normalizedContext) {
    lockFormWithMessage("アクセス情報を確認できませんでした。運営までお問い合わせください。");
    return;
  }

  hiddenContext.value = {
    eventId: normalizedContext.eventId,
    eventName: normalizedContext.eventName,
    scheduleId: normalizedContext.scheduleId,
    scheduleLabel: normalizedContext.scheduleLabel,
    scheduleDate: normalizedContext.scheduleDate,
    scheduleLocation: normalizedContext.scheduleLocation,
    participantId: normalizedContext.participantId,
    groupNumber: normalizedContext.groupNumber,
  };

  resetFormForContext();

  const targetName = normalizedContext.participantName || "ゲスト";
  const scheduleSummary = formatScheduleSummary({
    label: normalizedContext.scheduleLabel,
    date: normalizedContext.scheduleDate,
    start: normalizedContext.scheduleStart,
    end: normalizedContext.scheduleEnd,
  });
  const locationNote = normalizedContext.scheduleLocation
    ? `（会場：${normalizedContext.scheduleLocation}）`
    : "";
  const scheduleText = `あなたの参加日程：${scheduleSummary}${locationNote}`;
  const descriptionText = buildContextDescription(normalizedContext.eventName);

  contextBanner.value = {
    welcomeText: `ようこそ${targetName}さん`,
    descriptionText,
    scheduleText,
  };

  guidance.value = normalizedContext.guidance || "";
  contextGuardMessage.value = "";
  unlockFormForContext();
  isDirty.value = false;
};

const resetFormForContext = () => {
  radioName.value = "";
  question.value = "";
  genre.value = "";
  updateQuestionCounter();
  isDirty.value = false;
};

const unlockFormForContext = () => {
  formMetaVisible.value = true;
  isLocked.value = false;
  isBusy.value = false;
};

const handleFormInput = () => {
  isDirty.value = true;
};

const handleReset = () => {
  setTimeout(() => {
    resetFormForContext();
    feedbackMessage.value = "";
    feedbackType.value = "";
  }, 0);
};

const handleQuestionInput = () => {
  updateQuestionCounter();
};

const handleQuestionBlur = () => {
  const normalized = normalizeMultiline(question.value);
  if (normalized !== question.value) {
    question.value = normalized;
    updateQuestionCounter();
  }
};

const handleRadioNameBlur = () => {
  const sanitized = sanitizeRadioName(radioName.value, MAX_RADIO_NAME_LENGTH);
  radioName.value = sanitized;
};

const handleRadioNameInput = () => {
  const truncated = truncateGraphemes(radioName.value, MAX_RADIO_NAME_LENGTH);
  if (radioName.value !== truncated) {
    radioName.value = truncated;
  }
};

const handleGenreChange = () => {
  isDirty.value = true;
};

const hasValidContext = () => {
  return Boolean(context.value && token.value);
};

const getSanitizedFormData = () => {
  const sanitizedName = sanitizeRadioName(radioName.value, MAX_RADIO_NAME_LENGTH);
  if (radioName.value !== sanitizedName) {
    radioName.value = sanitizedName;
  }
  if (!sanitizedName) {
    throw new FormValidationError("ラジオネームを入力してください。", {
      focus: () => radioNameInputRef.value?.focus(),
    });
  }

  const normalizedQuestion = normalizeMultiline(question.value).trim();
  if (question.value !== normalizedQuestion) {
    question.value = normalizedQuestion;
  }

  const qLength = countGraphemes(normalizedQuestion);
  updateQuestionCounter();

  if (!qLength) {
    throw new FormValidationError("質問内容を入力してください。", {
      focus: () => questionInputRef.value?.focus(),
    });
  }
  if (qLength > MAX_QUESTION_LENGTH) {
    throw new FormValidationError(`質問は${MAX_QUESTION_LENGTH}文字以内で入力してください。`, {
      focus: () => questionInputRef.value?.focus(),
    });
  }

  const selectedGenre = genre.value;
  if (!selectedGenre) {
    throw new FormValidationError("ジャンルを選択してください。", {
      focus: () => genreSelectRef.value?.focus(),
    });
  }
  if (!GENRE_OPTIONS.includes(selectedGenre)) {
    throw new FormValidationError("ジャンルの選択が正しくありません。");
  }

  return { radioName: sanitizedName, question: normalizedQuestion, questionLength: qLength, genre: selectedGenre };
};

const captureSubmissionSnapshot = () => {
  const ctx = context.value ?? {};
  const groupNumber = coalesceTrimmed(hiddenContext.value.groupNumber, ctx.groupNumber);
  const scheduleLabel = coalesceTrimmed(hiddenContext.value.scheduleLabel, ctx.scheduleLabel);
  const scheduleDate = coalesceTrimmed(hiddenContext.value.scheduleDate, ctx.scheduleDate);
  const scheduleLocation = coalesceTrimmed(hiddenContext.value.scheduleLocation, ctx.scheduleLocation);
  const eventId = coalesceTrimmed(hiddenContext.value.eventId, ctx.eventId);
  const eventName = coalesceTrimmed(hiddenContext.value.eventName, ctx.eventName);
  const scheduleId = coalesceTrimmed(hiddenContext.value.scheduleId, ctx.scheduleId);
  const participantId = coalesceTrimmed(hiddenContext.value.participantId, ctx.participantId);

  return {
    groupNumber,
    scheduleLabel,
    scheduleDate,
    scheduleLocation,
    scheduleStart: ctx.scheduleStart,
    scheduleEnd: ctx.scheduleEnd,
    eventId,
    eventName,
    scheduleId,
    participantId,
    participantName: ctx.participantName,
    guidance: ctx.guidance,
  };
};

const handleSubmit = async (event) => {
  event.preventDefault();
  feedbackMessage.value = "";
  feedbackType.value = "";

  // フォームがロックされている場合は送信しない
  if (isLocked.value) {
    feedbackMessage.value = "フォームがロックされています。アクセス情報を確認してください。";
    feedbackType.value = "error";
    return;
  }

  if (!hasValidContext()) {
    feedbackMessage.value = "アクセス情報を確認できませんでした。リンクを再度開き直してください。";
    feedbackType.value = "error";
    return;
  }

  // ネイティブのフォームバリデーションを実行
  const form = event.target;
  if (form && typeof form.reportValidity === "function") {
    if (!form.reportValidity()) {
      feedbackMessage.value = "未入力の項目があります。確認してください。";
      feedbackType.value = "error";
      return;
    }
  }

  let formData;
  try {
    formData = getSanitizedFormData();
  } catch (error) {
    if (error instanceof FormValidationError) {
      error.invokeFocus();
      feedbackMessage.value = error.message;
      feedbackType.value = "error";
      return;
    }
    throw error;
  }

  const controller = startSubmissionController();
  isBusy.value = true;
  feedbackMessage.value = "送信中です…";
  feedbackType.value = "";

  try {
    const snapshot = captureSubmissionSnapshot();
    const { token: submissionToken, submission } = buildSubmissionPayload({
      token: token.value,
      formData,
      snapshot,
    });
    console.log("[DEBUG] submission payload", JSON.stringify(submission, null, 2));
    console.log("[DEBUG] token", submissionToken);
    const result = await submitQuestionRecord({
      database,
      controller,
      token: submissionToken,
      submission,
      context: context.value,
      databaseOps: { ref: firebaseRef, set, remove },
    });
    handleSubmitSuccess(result);
  } catch (error) {
    if (isSubmissionAbortError(error)) {
      return;
    }
    console.error(error);
    feedbackMessage.value = error.message || "送信時にエラーが発生しました。";
    feedbackType.value = "error";
  } finally {
    if (submittingController.value === controller) {
      submittingController.value = null;
    }
    isBusy.value = false;
  }
};

const handleSubmitSuccess = (result) => {
  if (result?.queueProcessed) {
    feedbackMessage.value = "送信しました。ありがとうございました！";
  } else {
    feedbackMessage.value = "送信しました。反映まで数秒かかる場合があります。";
  }
  feedbackType.value = "success";
  resetFormAfterSubmission();
};

const resetFormAfterSubmission = () => {
  question.value = "";
  genre.value = "";
  updateQuestionCounter();
  isDirty.value = false;
  // フォーカスを質問入力欄に移動
  setTimeout(() => {
    questionInputRef.value?.focus();
  }, 0);
};

const handleBeforeUnload = (event) => {
  if (isDirty.value && !submittingController.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};

// ライフサイクル
onMounted(() => {
  updateQuestionCounter();
  prepareContext().catch((error) => {
    console.error(error);
    lockFormWithMessage("アクセスに失敗しました。時間をおいて再度お試しください。");
  });
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onUnmounted(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  abortPendingSubmission();
});
</script>

