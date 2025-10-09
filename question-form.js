const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];

const form = document.getElementById("question-form");
const radioNameInput = document.getElementById("radio-name");
const questionInput = document.getElementById("question-text");
const groupInput = document.getElementById("group-number");
const genreSelect = document.getElementById("genre");
const scheduleInput = document.getElementById("schedule");
const scheduleHintEl = document.getElementById("schedule-hint");
const mappingStatusEl = document.getElementById("mapping-status");
const feedbackEl = document.getElementById("form-feedback");
const submitButton = document.getElementById("submit-button");

const state = {
  nameMap: new Map(),
  scheduleLockedValue: ""
};

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC");
}

function normalizeNameForLookup(value) {
  return normalizeKey(value).replace(/[\u200B-\u200D\uFEFF]/g, "");
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

function setMappingStatus(message, variant = "") {
  if (!mappingStatusEl) return;
  mappingStatusEl.textContent = message || "";
  mappingStatusEl.classList.remove("field-hint--status", "status-error");
  if (variant === "active") {
    mappingStatusEl.classList.add("field-hint--status");
  } else if (variant === "error") {
    mappingStatusEl.classList.add("status-error");
  }
}

function fillGroupFromName({ force = false } = {}) {
  const key = normalizeNameForLookup(radioNameInput.value);
  const mapped = key ? state.nameMap.get(key) : null;
  const alreadyAutoFilled = groupInput.dataset.autofilled === "true";

  if (mapped) {
    if (!force && groupInput.value && !alreadyAutoFilled) {
      return;
    }
    groupInput.value = mapped;
    groupInput.dataset.autofilled = "true";
  } else if (alreadyAutoFilled || force) {
    groupInput.value = "";
    delete groupInput.dataset.autofilled;
  }
}

function detectScheduleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const keys = ["schedule", "date", "day", "d"];
  let value = "";

  for (const key of keys) {
    const found = params.get(key);
    if (found) {
      value = found;
      break;
    }
  }

  if (!value) {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(last)) {
        value = last;
      } else if (/^\d{8}$/.test(last)) {
        value = `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`;
      }
    }
  }

  if (value) {
    scheduleInput.value = value;
    scheduleInput.readOnly = true;
    scheduleInput.dataset.locked = "true";
    state.scheduleLockedValue = value;
    if (scheduleHintEl) {
      scheduleHintEl.textContent = "URLに設定された日程を使用しています。";
    }
  } else {
    scheduleInput.readOnly = false;
    delete scheduleInput.dataset.locked;
    if (scheduleHintEl) {
      scheduleHintEl.textContent = "日程を直接入力してください。";
    }
  }
}

async function fetchNameMappings() {
  try {
    setMappingStatus("班番号リストを読み込んでいます…", "active");
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fetchNameMappings" })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result && result.error ? result.error : "読み込みに失敗しました。");
    }

    const entries = Array.isArray(result.mappings) ? result.mappings : [];
    const map = new Map();
    entries.forEach(entry => {
      const name = normalizeNameForLookup(entry.name);
      const groupNumber = normalizeKey(entry.groupNumber);
      if (!name || !groupNumber) return;
      if (!map.has(name)) {
        map.set(name, groupNumber);
      }
    });

    state.nameMap = map;
    if (map.size) {
      setMappingStatus(`班番号リストを${map.size}件読み込みました。`, "active");
      fillGroupFromName({ force: true });
    } else {
      setMappingStatus("現在登録されている班番号リストはありません。");
    }
  } catch (error) {
    console.error(error);
    setMappingStatus(error.message || "班番号リストの読み込みに失敗しました。", "error");
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
    schedule: scheduleInput.value.trim()
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
    if (!groupInput.dataset.autofilled) {
      groupInput.value = "";
    }
    if (state.scheduleLockedValue) {
      scheduleInput.value = state.scheduleLockedValue;
    }
    questionInput.focus();
  } catch (error) {
    console.error(error);
    setFeedback(error.message || "送信時にエラーが発生しました。", "error");
  } finally {
    submitButton.disabled = false;
  }
}

function init() {
  detectScheduleFromUrl();
  fetchNameMappings().catch(err => console.error(err));

  radioNameInput.addEventListener("input", () => fillGroupFromName());
  radioNameInput.addEventListener("blur", () => fillGroupFromName({ force: true }));
  groupInput.addEventListener("input", () => {
    if (groupInput.dataset.autofilled === "true") {
      delete groupInput.dataset.autofilled;
    }
  });
  form.addEventListener("submit", handleSubmit);
}

init();
