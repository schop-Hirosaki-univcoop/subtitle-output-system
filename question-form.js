const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];

const REQUIRED_PARAM_KEYS = {
  eventId: ["event", "e", "eventId"],
  scheduleId: ["schedule", "s", "scheduleId"],
  participantId: ["participant", "member", "id", "participantId"]
};

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
const feedbackEl = document.getElementById("form-feedback");
const submitButton = document.getElementById("submit-button");
const contextBannerEl = document.getElementById("context-banner");
const welcomeLineEl = document.getElementById("welcome-line");
const scheduleLineEl = document.getElementById("schedule-line");
const contextGuardEl = document.getElementById("context-guard");

const state = {
  context: null
};

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC");
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
    contextGuardEl.textContent = message;
  } else {
    contextGuardEl.hidden = true;
    contextGuardEl.textContent = "";
  }
}

function hideForm() {
  if (form) {
    form.hidden = true;
  }
  if (contextBannerEl) {
    contextBannerEl.hidden = true;
  }
}

function showForm() {
  if (form) {
    form.hidden = false;
  }
}

function extractRequiredParams() {
  const params = new URLSearchParams(window.location.search);
  const resolved = {};

  for (const [key, aliases] of Object.entries(REQUIRED_PARAM_KEYS)) {
    let value = "";
    for (const alias of aliases) {
      const candidate = params.get(alias);
      if (candidate) {
        value = candidate;
        break;
      }
    }
    if (!value) {
      return null;
    }
    resolved[key] = value;
  }

  return resolved;
}

async function fetchContext(contextParams) {
  const response = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "fetchQuestionContext", ...contextParams })
  });
  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch (error) {
      throw new Error("サーバーからの応答を解析できませんでした。");
    }
  }
  if (!response.ok || !result.success) {
    throw new Error(result && result.error ? result.error : "アクセスが許可されていません。");
  }
  return result.context;
}

function applyContext(context) {
  state.context = context;
  if (!form || !context) {
    hideForm();
    return;
  }

  const displayName = String(context.participantName ?? "").trim();
  const eventName = String(context.eventName ?? "").trim();
  const scheduleLabel = String(context.scheduleLabel ?? "").trim();
  const scheduleDate = String(context.scheduleDate ?? "").trim();

  eventIdInput.value = context.eventId || "";
  eventNameInput.value = eventName;
  scheduleIdInput.value = context.scheduleId || "";
  scheduleInput.value = scheduleLabel;
  scheduleDateInput.value = scheduleDate;
  participantIdInput.value = context.participantId || "";
  groupInput.value = String(context.groupNumber ?? "").trim();

  if (displayName) {
    radioNameInput.value = displayName;
  }

  if (contextBannerEl) {
    contextBannerEl.hidden = false;
  }
  if (welcomeLineEl) {
    const targetName = displayName || "ゲスト";
    const eventLabel = eventName ? `「${eventName}」` : "";
    welcomeLineEl.textContent = `ようこそ${targetName}さん${eventLabel ? `、${eventLabel}` : ""}`;
  }
  if (scheduleLineEl) {
    const scheduleInfo = scheduleLabel || scheduleDate || "未設定";
    scheduleLineEl.textContent = `あなたの参加日程：${scheduleInfo}`;
  }

  setContextGuard("");
  showForm();
}

async function prepareContext() {
  const params = extractRequiredParams();
  if (!params) {
    hideForm();
    setContextGuard("このフォームには、配布されたURLからアクセスしてください。");
    return;
  }

  try {
    const context = await fetchContext(params);
    applyContext(context);
  } catch (error) {
    console.error(error);
    hideForm();
    setContextGuard(error.message || "アクセスに必要な情報が不足しています。");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setFeedback("", "");

  if (!form.reportValidity()) {
    setFeedback("未入力の項目があります。確認してください。", "error");
    return;
  }

  const payload = {
    action: "submitQuestion",
    radioName: normalizeKey(radioNameInput.value),
    question: questionInput.value.trim(),
    groupNumber: groupInput.value.trim(),
    genre: genreSelect.value,
    schedule: scheduleInput.value.trim(),
    scheduleDate: scheduleDateInput.value.trim(),
    eventId: eventIdInput.value.trim(),
    eventName: eventNameInput.value.trim(),
    scheduleId: scheduleIdInput.value.trim(),
    participantId: participantIdInput.value.trim()
  };

  if (!GENRE_OPTIONS.includes(payload.genre)) {
    setFeedback("ジャンルの選択が正しくありません。", "error");
    return;
  }

  submitButton.disabled = true;
  setFeedback("送信中です…");

  try {
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
    questionInput.focus();
  } catch (error) {
    console.error(error);
    setFeedback(error.message || "送信時にエラーが発生しました。", "error");
  } finally {
    submitButton.disabled = false;
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
  }
}

init();
