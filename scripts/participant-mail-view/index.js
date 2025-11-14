// index.js: 参加者向けメール閲覧ページの初期化とデータ取得を担います。
const TOKEN_PARAM_KEYS = ["token", "t", "key"];
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";

const elements = {
  statusMessage: document.getElementById("status-message"),
  errorMessage: document.getElementById("error-message"),
  metaCard: document.getElementById("meta-card"),
  metaSubject: document.getElementById("meta-subject"),
  metaParticipant: document.getElementById("meta-participant"),
  metaEvent: document.getElementById("meta-event"),
  metaSchedule: document.getElementById("meta-schedule"),
  mailCard: document.getElementById("mail-card"),
  mailFrame: document.getElementById("mail-frame"),
  statusCard: document.getElementById("status-card")
};

function extractToken(search = window.location.search, tokenKeys = TOKEN_PARAM_KEYS) {
  const params = new URLSearchParams(search || "");
  for (const key of tokenKeys) {
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

function setStatus(message, { busy = false } = {}) {
  if (!elements.statusMessage) return;
  elements.statusMessage.textContent = message;
  if (busy) {
    elements.statusMessage.setAttribute("aria-busy", "true");
  } else {
    elements.statusMessage.setAttribute("aria-busy", "false");
  }
}

function clearError() {
  if (!elements.errorMessage) return;
  elements.errorMessage.hidden = true;
  elements.errorMessage.textContent = "";
}

function showError(message) {
  if (!elements.errorMessage) return;
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
}

function buildScheduleSummary(context = {}) {
  const parts = [];
  if (context.scheduleDateLabel) {
    parts.push(context.scheduleDateLabel);
  }
  if (context.scheduleLabel && context.scheduleLabel !== context.scheduleDateLabel) {
    parts.push(context.scheduleLabel);
  }
  if (context.scheduleTimeRange) {
    parts.push(context.scheduleTimeRange);
  }
  const summary = parts.filter(Boolean).join(" / ");
  return summary || "-";
}

function setMetadata({ subject = "", context = {} }) {
  if (!elements.metaCard) return;
  elements.metaSubject.textContent = subject || "-";
  elements.metaParticipant.textContent = context.participantName || "-";
  elements.metaEvent.textContent = context.eventName || "-";
  elements.metaSchedule.textContent = buildScheduleSummary(context);
  elements.metaCard.hidden = false;
}

function renderMailHtml(html) {
  if (!elements.mailFrame || !elements.mailCard) return;
  if (!html) {
    showError("メール本文の取得に失敗しました。時間をおいて再度お試しください。");
    return;
  }
  elements.mailFrame.srcdoc = html;
  elements.mailCard.hidden = false;
}

async function fetchMailPayload(token) {
  const response = await fetch(GAS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "resolveParticipantMail",
      token,
      origin: window.location.origin
    })
  });

  if (!response.ok) {
    throw new Error("サーバーから正常な応答が得られませんでした。時間をおいて再試しください。");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("サーバー応答の解析に失敗しました。時間をおいて再試しください。");
  }

  if (!payload || payload.success === false) {
    const message = payload && payload.error ? String(payload.error) : "メール情報の取得に失敗しました。";
    throw new Error(message);
  }

  return payload;
}

async function bootstrap() {
  const token = extractToken();
  if (!token) {
    setStatus("アクセスキーが見つかりませんでした。", { busy: false });
    showError("リンクの形式が正しくありません。配布された最新のURLからアクセスしてください。");
    return;
  }

  clearError();
  setStatus("メール本文を読み込んでいます…", { busy: true });

  try {
    const payload = await fetchMailPayload(token);
    const { subject = "", html = "", context = {} } = payload;

    clearError();
    setStatus("メール本文を表示しています。", { busy: false });
    if (subject) {
      document.title = `${subject} | 参加者メール閲覧ページ`;
    }
    setMetadata({ subject, context });
    renderMailHtml(html);
  } catch (error) {
    console.error("Failed to load participant mail", error);
    setStatus("メール情報の取得に失敗しました。", { busy: false });
    showError(error && error.message ? error.message : "通信エラーが発生しました。時間をおいて再度お試しください。");
  }
}

bootstrap();
