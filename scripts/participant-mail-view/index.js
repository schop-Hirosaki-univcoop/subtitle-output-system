// index.js: 参加者向けメール閲覧ページの初期化とデータ取得を担います。
const TOKEN_PARAM_KEYS = ["token", "t", "key"];
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";

const elements = {
  statusMessage: document.getElementById("status-message"),
  errorMessage: document.getElementById("error-message"),
  metaCard: document.getElementById("meta-card"),
  metaSubject: document.getElementById("meta-subject"),
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

function setMetadata({ subject = "" }) {
  if (!elements.metaCard) return;
  elements.metaSubject.textContent = subject || "-";
  elements.metaCard.hidden = false;
}

function extractMailtoHref(href) {
  if (!href) {
    return null;
  }

  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("mailto:")) {
    return trimmed;
  }

  let decoded = trimmed;
  for (let i = 0; i < 3; i += 1) {
    const match = decoded.match(/mailto:[^\s"'<>]+/i);
    if (match && match[0]) {
      return match[0];
    }
    try {
      decoded = decodeURIComponent(decoded);
    } catch (error) {
      console.warn("Failed to decode potential mailto href", error);
      break;
    }
  }

  return null;
}

function prepareMailHtml(html) {
  if (typeof html !== "string" || !html.trim()) {
    return html;
  }

  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch (error) {
    console.warn("Failed to parse mail HTML. Fallback to raw HTML.", error);
    return html;
  }

  if (!doc) {
    return html;
  }

  const anchors = doc.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }

    let url;
    try {
      url = new URL(href, window.location.origin);
    } catch (error) {
      url = null;
    }

    const mailtoHref = extractMailtoHref(href);
    const isHttpLike = url && (url.protocol === "http:" || url.protocol === "https:");
    const shouldUnwrapMailto =
      mailtoHref &&
      (!isHttpLike ||
        anchor.hasAttribute("data-saferedirecturl") ||
        (url &&
          url.hostname &&
          /(?:^|\.)((?:accounts|mail)\.google\.com)$/i.test(url.hostname)));

    if (shouldUnwrapMailto) {
      anchor.setAttribute("href", mailtoHref);
      anchor.setAttribute("target", "_top");
      anchor.removeAttribute("rel");
      anchor.removeAttribute("data-saferedirecturl");
      continue;
    }

    if (url && (url.protocol === "mailto:" || url.protocol === "tel:")) {
      anchor.setAttribute("href", url.href);
      anchor.setAttribute("target", "_top");
      anchor.removeAttribute("rel");
      anchor.removeAttribute("data-saferedirecturl");
      continue;
    }

    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer noopener");
  }

  const forms = doc.querySelectorAll("form");
  for (const form of forms) {
    form.setAttribute("target", "_blank");
  }

  const serialized = doc.documentElement ? doc.documentElement.outerHTML : html;
  if (!doc.doctype) {
    return serialized;
  }

  const { name, publicId, systemId } = doc.doctype;
  let doctype = `<!DOCTYPE ${name}`;
  if (publicId) {
    doctype += ` PUBLIC "${publicId}"`;
  }
  if (!publicId && systemId) {
    doctype += " SYSTEM";
  }
  if (systemId) {
    doctype += ` "${systemId}"`;
  }
  doctype += ">";

  return `${doctype}${serialized}`;
}

function renderMailHtml(html) {
  if (!elements.mailFrame || !elements.mailCard) return;
  if (!html) {
    showError("メール本文の取得に失敗しました。時間をおいて再度お試しください。");
    return;
  }
  elements.mailFrame.srcdoc = prepareMailHtml(html);
  elements.mailCard.hidden = false;
}

async function fetchMailPayload(token) {
  const response = await fetch(GAS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8"
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
    const { subject = "", html = "" } = payload;

    clearError();
    setStatus("メール本文を表示しています。", { busy: false });
    if (subject) {
      document.title = `${subject} | 参加者メール閲覧ページ`;
    }
    setMetadata({ subject });
    renderMailHtml(html);
  } catch (error) {
    console.error("Failed to load participant mail", error);
    setStatus("メール情報の取得に失敗しました。", { busy: false });
    showError(error && error.message ? error.message : "通信エラーが発生しました。時間をおいて再度お試しください。");
  }
}

bootstrap();
