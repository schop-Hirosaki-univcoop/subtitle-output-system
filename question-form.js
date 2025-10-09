const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const GENRE_OPTIONS = ["学び", "活動", "暮らし", "食・スポット", "移動・季節", "その他"];
const STORAGE_KEY = "question-form-name-map-v1";

const form = document.getElementById("question-form");
const radioNameInput = document.getElementById("radio-name");
const questionInput = document.getElementById("question-text");
const groupInput = document.getElementById("group-number");
const genreSelect = document.getElementById("genre");
const scheduleInput = document.getElementById("schedule");
const answerTimeInput = document.getElementById("answer-time");
const feedbackEl = document.getElementById("form-feedback");
const csvInput = document.getElementById("csv-upload");
const csvStatusEl = document.getElementById("csv-status");
const scheduleHintEl = document.getElementById("schedule-hint");

const state = {
  nameMap: new Map(),
  scheduleLockedValue: ""
};

function normalizeKey(value) {
  return (value ?? "")
    .toString()
    .trim()
    .normalize("NFKC");
}

function normalizeNameForLookup(value) {
  return normalizeKey(value).replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function setFeedback(message, type) {
  feedbackEl.textContent = message || "";
  feedbackEl.classList.remove("form-feedback--success", "form-feedback--error");
  if (!type) return;
  feedbackEl.classList.add(type === "error" ? "form-feedback--error" : "form-feedback--success");
}

function updateCsvStatus(message, stateType = "muted") {
  if (!csvStatusEl) return;
  csvStatusEl.textContent = message;
  csvStatusEl.classList.remove("helper-status--success", "helper-status--error");
  if (stateType === "success") {
    csvStatusEl.classList.add("helper-status--success");
  } else if (stateType === "error") {
    csvStatusEl.classList.add("helper-status--error");
  }
}

function loadNameMapFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const restored = new Map();
    parsed.forEach(entry => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const [nameKey, groupValue] = entry;
      if (typeof nameKey !== "string" || typeof groupValue !== "string") return;
      restored.set(nameKey, groupValue);
    });
    return restored;
  } catch (err) {
    console.warn("Failed to restore name map", err);
    return null;
  }
}

function persistNameMap(map) {
  try {
    const serialisable = Array.from(map.entries());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
  } catch (err) {
    console.warn("Failed to persist name map", err);
  }
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === ",")) {
      row.push(current);
      current = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(current);
      rows.push(row);
      current = "";
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.map(cols => cols.map(col => col.trim()));
}

function buildNameMapFromRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const detectHeader = rows[0].some(cell => /ラジオネーム|name|班番号|group/i.test(cell));
  let dataRows = rows;
  let nameIndex = 0;
  let groupIndex = 1;

  if (detectHeader) {
    const header = rows[0].map(cell => cell.toLowerCase());
    const findIndex = (keywords, fallback) => {
      for (const keyword of keywords) {
        const idx = header.findIndex(col => col.includes(keyword));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
    nameIndex = findIndex(["ラジオ", "radio", "name", "名前"], 0);
    groupIndex = findIndex(["班", "group", "number", "番号"], 1);
    dataRows = rows.slice(1);
  }

  const map = new Map();
  let imported = 0;
  dataRows.forEach((row, rowIndex) => {
    if (!row) return;
    const nameRaw = row[nameIndex];
    const groupRaw = row[groupIndex];
    const normName = normalizeNameForLookup(nameRaw);
    const groupValue = normalizeKey(groupRaw);
    if (!normName || !groupValue) return;
    map.set(normName, groupValue);
    imported++;
  });

  if (!imported) {
    throw new Error("CSVから有効なデータを読み込めませんでした。");
  }

  return map;
}

async function importCsvFile(file) {
  if (!file) return;
  try {
    updateCsvStatus("CSVを読み込んでいます…");
    const text = await file.text();
    const rows = parseCsv(text);
    const map = buildNameMapFromRows(rows);
    state.nameMap = map;
    persistNameMap(map);
    updateCsvStatus(`班番号リストを${map.size}件読み込みました。`, "success");
    fillGroupFromName({ force: true });
  } catch (error) {
    console.error(error);
    updateCsvStatus(error.message || "CSVの読み込みに失敗しました。", "error");
  }
}

function fillGroupFromName(options = {}) {
  const { force = false } = options;
  const key = normalizeNameForLookup(radioNameInput.value);
  const mapped = key ? state.nameMap.get(key) : null;
  const alreadyAutoFilled = groupInput.dataset.autofilled === "true";

  if (mapped) {
    if (!force && groupInput.value && !alreadyAutoFilled) {
      return;
    }
    groupInput.value = mapped;
    groupInput.dataset.autofilled = "true";
    groupInput.setAttribute("aria-describedby", "group-hint");
  } else if (alreadyAutoFilled || force) {
    groupInput.value = "";
    delete groupInput.dataset.autofilled;
  }
}

function detectScheduleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const candidates = ["schedule", "date", "day", "d"];
  let value = "";
  for (const key of candidates) {
    const found = params.get(key);
    if (found) {
      value = found;
      break;
    }
  }

  if (!value) {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart) {
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(lastPart)) {
        value = lastPart;
      } else if (/^\d{8}$/.test(lastPart)) {
        value = `${lastPart.slice(0, 4)}-${lastPart.slice(4, 6)}-${lastPart.slice(6, 8)}`;
      }
    }
  }

  if (value) {
    scheduleInput.value = value;
    scheduleInput.readOnly = true;
    scheduleInput.setAttribute("data-locked", "true");
    state.scheduleLockedValue = value;
    if (scheduleHintEl) {
      scheduleHintEl.textContent = "URLに設定された日程を使用しています。";
    }
  } else {
    scheduleInput.readOnly = false;
    scheduleInput.removeAttribute("data-locked");
    if (scheduleHintEl) {
      scheduleHintEl.textContent = "日程を直接入力してください。";
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setFeedback("", null);

  if (!form.reportValidity()) {
    setFeedback("未入力の項目があります。確認してください。", "error");
    return;
  }

  const radioName = normalizeKey(radioNameInput.value);
  const question = questionInput.value.trim();
  const groupNumber = groupInput.value.trim();
  const genre = genreSelect.value;
  const schedule = scheduleInput.value.trim();
  const answerTime = answerTimeInput.value.trim();

  if (!GENRE_OPTIONS.includes(genre)) {
    setFeedback("ジャンルの選択が正しくありません。", "error");
    return;
  }

  const submitButton = form.querySelector(".submit-button");
  submitButton.disabled = true;
  setFeedback("送信中です…", null);

  try {
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submitQuestion",
        radioName,
        question,
        groupNumber,
        genre,
        schedule,
        answerTime
      })
    });

    const text = await response.text();
    let result = {};
    if (text) {
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse response", parseError);
        throw new Error("サーバーからの応答を読み取れませんでした。");
      }
    }
    if (!response.ok || !result.success) {
      throw new Error(result && result.error ? result.error : "送信に失敗しました。");
    }

    setFeedback("送信しました。ありがとうございました！", "success");
    questionInput.value = "";
    answerTimeInput.value = "";
    if (state.scheduleLockedValue) {
      scheduleInput.value = state.scheduleLockedValue;
    }
    fillGroupFromName();
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
  const storedMap = loadNameMapFromStorage();
  if (storedMap && storedMap.size) {
    state.nameMap = storedMap;
    updateCsvStatus(`班番号リストを${storedMap.size}件読み込み済みです。`, "success");
    fillGroupFromName();
  }

  radioNameInput.addEventListener("input", () => fillGroupFromName());
  radioNameInput.addEventListener("blur", () => fillGroupFromName({ force: true }));
  groupInput.addEventListener("input", () => {
    if (groupInput.dataset.autofilled === "true") {
      delete groupInput.dataset.autofilled;
    }
  });
  csvInput.addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    importCsvFile(file);
    event.target.value = "";
  });
  form.addEventListener("submit", handleSubmit);
}

init();
