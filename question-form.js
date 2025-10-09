import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];
const TOKEN_PARAM_KEYS = ["token", "t", "key"];
const MAX_RADIO_NAME_LENGTH = 40;
const MAX_QUESTION_LENGTH = 400;

const firebaseConfig = {
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "154494683809",
  appId: "1:154494683809:web:2a309509672f2e86314e61"
};

const apps = getApps();
const app = apps.length ? getApp() : initializeApp(firebaseConfig);
const database = getDatabase(app);

const form = document.getElementById("question-form");
const radioNameInput = document.getElementById("radio-name");
const questionInput = document.getElementById("question-text");
const genreSelect = document.getElementById("genre");
const groupInput = document.getElementById("group-number");
const scheduleInput = document.getElementById("schedule");
const scheduleDateInput = document.getElementById("schedule-date");
const eventIdInput = document.getElementById("event-id");
const eventNameInput = document.getElementById("event-name");
const scheduleIdInput = document.getElementById("schedule-id");
const participantIdInput = document.getElementById("participant-id");
const tokenInput = document.getElementById("access-token");
const feedbackEl = document.getElementById("form-feedback");
const submitButton = document.getElementById("submit-button");
const contextBannerEl = document.getElementById("context-banner");
const welcomeLineEl = document.getElementById("welcome-line");
const scheduleLineEl = document.getElementById("schedule-line");
const contextGuardEl = document.getElementById("context-guard");
const questionCounterEl = document.getElementById("question-counter");
const formMetaEl = document.getElementById("form-meta");
const formGuidanceEl = document.getElementById("form-guidance");

const graphemeSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("ja", { granularity: "grapheme" })
  : null;

const state = {
  context: null,
  token: null,
  submittingController: null,
  dirty: false,
  locked: true
};

function countGraphemes(value) {
  if (!value) return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _ of graphemeSegmenter.segment(value)) {
      count += 1;
    }
    return count;
  }
  return Array.from(value).length;
}

function normalizeKey(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .normalize("NFKC");
}

function normalizeMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function sanitizeRadioName(value) {
  const normalized = normalizeKey(value)
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}・\-＿ー\s]/gu, "")
    .trim();
  return normalized.slice(0, MAX_RADIO_NAME_LENGTH);
}

function setFeedback(message, type = "") {
  if (!feedbackEl) return;
  feedbackEl.textContent = message || "";
  feedbackEl.classList.remove("form-feedback--success", "form-feedback--error");
  if (type === "success") {
    feedbackEl.classList.add("form-feedback--success");
  } else if (type === "error") {
    feedbackEl.classList.add("form-feedback--error");
  }
}

function setContextGuard(message) {
  if (!contextGuardEl) return;
  if (message) {
    contextGuardEl.hidden = false;
    contextGuardEl.removeAttribute("aria-hidden");
    contextGuardEl.textContent = message;
  } else {
    contextGuardEl.hidden = true;
    contextGuardEl.setAttribute("aria-hidden", "true");
    contextGuardEl.textContent = "";
  }
}

function setFormMetaVisible(visible) {
  if (formMetaEl) {
    formMetaEl.hidden = !visible;
    if (visible) {
      formMetaEl.removeAttribute("aria-hidden");
    } else {
      formMetaEl.setAttribute("aria-hidden", "true");
    }
  }
}

function hideForm() {
  if (form) {
    form.hidden = true;
    form.setAttribute("aria-hidden", "true");
    form.setAttribute("inert", "");
    form.dataset.locked = "true";
    setFormControlsDisabled(true);
  }
  if (contextBannerEl) {
    contextBannerEl.hidden = true;
    contextBannerEl.setAttribute("aria-hidden", "true");
  }
  setFormMetaVisible(false);
  state.locked = true;
}

function showForm() {
  if (form) {
    form.hidden = false;
    form.removeAttribute("aria-hidden");
    form.removeAttribute("inert");
    form.dataset.locked = "false";
    setFormControlsDisabled(false);
  }
  state.locked = false;
}

function setFormControlsDisabled(disabled) {
  if (!form) return;
  const elements = form.querySelectorAll("input:not([type=\"hidden\"]), select, textarea, button");
  elements.forEach(element => {
    element.disabled = disabled;
  });
}

function extractToken() {
  const params = new URLSearchParams(window.location.search);
  for (const key of TOKEN_PARAM_KEYS) {
    const value = params.get(key);
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z0-9_-]{12,128}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

async function fetchContextFromToken(token) {
  const tokenRef = ref(database, `questionIntake/tokens/${token}`);
  const snapshot = await get(tokenRef);
  if (!snapshot.exists()) {
    throw new Error("リンクが無効です。配布された最新のURLからアクセスしてください。");
  }
  const data = snapshot.val() || {};
  if (data.revoked) {
    throw new Error("このリンクは無効化されています。運営までお問い合わせください。");
  }
  if (data.expiresAt && Number(data.expiresAt) && Date.now() > Number(data.expiresAt)) {
    throw new Error("このリンクの有効期限が切れています。運営までお問い合わせください。");
  }
  return {
    eventId: String(data.eventId || ""),
    eventName: String(data.eventName || ""),
    scheduleId: String(data.scheduleId || ""),
    scheduleLabel: String(data.scheduleLabel || ""),
    scheduleDate: String(data.scheduleDate || ""),
    participantId: String(data.participantId || ""),
    participantName: String(data.displayName || ""),
    groupNumber: String(data.groupNumber || ""),
    guidance: String(data.guidance || "")
  };
}

function applyContext(context) {
  state.context = context;
  if (!form || !context) {
    hideForm();
    return;
  }

  const displayName = context.participantName.trim();
  const eventName = context.eventName.trim();
  const scheduleLabel = context.scheduleLabel.trim();
  const scheduleDate = context.scheduleDate.trim();

  eventIdInput.value = context.eventId || "";
  eventNameInput.value = eventName;
  scheduleIdInput.value = context.scheduleId || "";
  scheduleInput.value = scheduleLabel;
  scheduleDateInput.value = scheduleDate;
  participantIdInput.value = context.participantId || "";
  groupInput.value = context.groupNumber || "";

  if (displayName) {
    radioNameInput.value = displayName.slice(0, MAX_RADIO_NAME_LENGTH);
  }

  if (contextBannerEl) {
    contextBannerEl.hidden = false;
    contextBannerEl.removeAttribute("aria-hidden");
  }
  if (welcomeLineEl) {
    const targetName = displayName || "ゲスト";
    const eventLabel = eventName ? `「${eventName}」` : "";
    welcomeLineEl.textContent = `ようこそ${targetName}さん${eventLabel ? `、${eventLabel}` : ""}`;
  }
  if (scheduleLineEl) {
    const info = scheduleLabel || scheduleDate || "未設定";
    scheduleLineEl.textContent = `あなたの参加日程：${info}`;
  }

  if (formGuidanceEl) {
    const guidance = context.guidance ? context.guidance.trim() : "";
    if (guidance) {
      formGuidanceEl.hidden = false;
      formGuidanceEl.textContent = guidance;
    } else {
      formGuidanceEl.hidden = true;
      formGuidanceEl.textContent = "";
    }
  }

  setContextGuard("");
  setFormMetaVisible(true);
  showForm();
  updateQuestionCounter();
  state.dirty = false;
}

async function prepareContext() {
  const token = extractToken();
  if (!token) {
    hideForm();
    setContextGuard("このフォームには、運営から配布された専用リンクからアクセスしてください。");
    return;
  }

  state.token = token;
  if (tokenInput) {
    tokenInput.value = token;
  }

  setContextGuard("アクセス権を確認しています…");
  try {
    const context = await fetchContextFromToken(token);
    applyContext(context);
  } catch (error) {
    console.error(error);
    hideForm();
    setFeedback("", "");
    setContextGuard(error.message || "アクセスに必要な情報が不足しています。");
  }
}

function updateQuestionCounter() {
  if (!questionCounterEl) return;
  const length = countGraphemes(questionInput.value);
  questionCounterEl.textContent = `${length} / ${MAX_QUESTION_LENGTH}文字`;
  if (length > MAX_QUESTION_LENGTH) {
    questionCounterEl.classList.add("status-error");
  } else {
    questionCounterEl.classList.remove("status-error");
  }
}

function setFormBusy(isBusy) {
  if (!submitButton) return;
  if (state.locked) {
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "false");
    return;
  }
  submitButton.disabled = isBusy;
  submitButton.setAttribute("aria-busy", String(isBusy));
}

function markDirty() {
  state.dirty = true;
}

async function handleSubmit(event) {
  event.preventDefault();
  setFeedback("", "");

  if (!state.context || !state.token) {
    setFeedback("アクセス情報を確認できませんでした。リンクを再度開き直してください。", "error");
    return;
  }

  if (!form.reportValidity()) {
    setFeedback("未入力の項目があります。確認してください。", "error");
    return;
  }

  const sanitizedName = sanitizeRadioName(radioNameInput.value);
  if (radioNameInput.value !== sanitizedName) {
    radioNameInput.value = sanitizedName;
  }
  if (!sanitizedName) {
    if (typeof radioNameInput.setCustomValidity === "function") {
      radioNameInput.setCustomValidity("ラジオネームを入力してください。");
      radioNameInput.reportValidity();
      radioNameInput.setCustomValidity("");
    }
    radioNameInput.focus();
    setFeedback("ラジオネームを入力してください。", "error");
    return;
  }
  const normalizedQuestion = normalizeMultiline(questionInput.value).trim();
  questionInput.value = normalizedQuestion;
  const questionLength = countGraphemes(normalizedQuestion);

  if (!questionLength) {
    setFeedback("質問内容を入力してください。", "error");
    questionInput.focus();
    return;
  }
  if (questionLength > MAX_QUESTION_LENGTH) {
    setFeedback("質問は400文字以内で入力してください。", "error");
    questionInput.focus();
    return;
  }

  if (!GENRE_OPTIONS.includes(genreSelect.value)) {
    setFeedback("ジャンルの選択が正しくありません。", "error");
    return;
  }

  if (state.submittingController) {
    state.submittingController.abort();
  }

  const controller = new AbortController();
  state.submittingController = controller;
  setFormBusy(true);
  setFeedback("送信中です…");

  const payload = {
    action: "submitQuestion",
    token: state.token,
    radioName: sanitizedName,
    question: normalizedQuestion,
    questionLength,
    groupNumber: groupInput.value.trim(),
    genre: genreSelect.value,
    schedule: scheduleInput.value.trim(),
    scheduleDate: scheduleDateInput.value.trim(),
    eventId: eventIdInput.value.trim(),
    eventName: eventNameInput.value.trim(),
    scheduleId: scheduleIdInput.value.trim(),
    participantId: participantIdInput.value.trim(),
    clientTimestamp: Date.now(),
    language: navigator.language || "",
    userAgent: navigator.userAgent || "",
    referrer: document.referrer || "",
    formVersion: "question-form@2024.10",
    guidance: state.context?.guidance || ""
  };

  try {
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
      } catch (err) {
        throw new Error("サーバーからの応答を読み取れませんでした。");
      }
    }
    if (!response.ok || !result.success) {
      throw new Error(result && result.error ? result.error : "送信に失敗しました。");
    }

    setFeedback("送信しました。ありがとうございました！", "success");
    questionInput.value = "";
    updateQuestionCounter();
    questionInput.focus();
    state.dirty = false;
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    console.error(error);
    setFeedback(error.message || "送信時にエラーが発生しました。", "error");
  } finally {
    if (state.submittingController === controller) {
      state.submittingController = null;
    }
    setFormBusy(false);
  }
}

function init() {
  prepareContext().catch(err => {
    console.error(err);
    hideForm();
    setContextGuard("アクセスに失敗しました。時間をおいて再度お試しください。");
  });
  if (form) {
    form.addEventListener("submit", handleSubmit);
    form.addEventListener("input", () => markDirty());
    form.addEventListener("reset", () => {
      window.setTimeout(() => {
        state.dirty = false;
        updateQuestionCounter();
        setFeedback("", "");
      }, 0);
    });
  }
  if (questionInput) {
    questionInput.addEventListener("input", updateQuestionCounter);
    questionInput.addEventListener("blur", () => {
      const sanitized = normalizeMultiline(questionInput.value);
      if (sanitized !== questionInput.value) {
        questionInput.value = sanitized;
        updateQuestionCounter();
      }
    });
  }
  if (radioNameInput) {
    radioNameInput.addEventListener("blur", () => {
      radioNameInput.value = sanitizeRadioName(radioNameInput.value);
    });
    radioNameInput.addEventListener("input", () => {
      if (radioNameInput.value.length > MAX_RADIO_NAME_LENGTH) {
        radioNameInput.value = radioNameInput.value.slice(0, MAX_RADIO_NAME_LENGTH);
      }
    });
  }
  if (genreSelect) {
    genreSelect.addEventListener("change", () => markDirty());
  }
  window.addEventListener("beforeunload", event => {
    if (state.dirty && !state.submittingController) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

init();
