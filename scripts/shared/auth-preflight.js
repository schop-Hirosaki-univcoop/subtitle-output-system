// auth-preflight.js: 認証プリフライト結果の共有とキャッシュ操作をまとめるモジュールです。
import { createApiClient } from "../operator/api-client.js";
import {
  auth as sharedAuth,
  onAuthStateChanged as sharedOnAuthStateChanged,
  get,
  questionsRef
} from "../operator/firebase.js";

const STORAGE_KEY = "sos:authPreflightContext";
const CONTEXT_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function safeGetStorage(kind) {
  try {
    if (typeof window === "undefined") return null;
    if (kind === "session") {
      return window.sessionStorage || null;
    }
    if (kind === "local") {
      return window.localStorage || null;
    }
  } catch (error) {
    console.warn(`Storage (${kind}) unavailable`, error);
  }
  return null;
}

function normalizeCredentialPayload(payload = null) {
  if (!payload || typeof payload !== "object") {
    return { providerId: "", signInMethod: "", idToken: "", accessToken: "" };
  }
  return {
    providerId: typeof payload.providerId === "string" ? payload.providerId : "",
    signInMethod: typeof payload.signInMethod === "string" ? payload.signInMethod : "",
    idToken: typeof payload.idToken === "string" ? payload.idToken : "",
    accessToken: typeof payload.accessToken === "string" ? payload.accessToken : ""
  };
}

function parseContext(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.version !== CONTEXT_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to parse auth preflight context", error);
    return null;
  }
}

function readFromStorage(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return parseContext(raw);
  } catch (error) {
    console.warn("Failed to read auth preflight context", error);
    return null;
  }
}

export function clearAuthPreflightContext() {
  ["session", "local"].forEach((kind) => {
    const storage = safeGetStorage(kind);
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn(`Failed to clear auth preflight context (${kind})`, error);
    }
  });
}

function writeToStorage(storage, serialized) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    console.warn("Failed to persist auth preflight context", error);
    return false;
  }
}

export function storeAuthPreflightContext(context) {
  if (!context || typeof context !== "object") {
    clearAuthPreflightContext();
    return false;
  }
  const serialized = JSON.stringify(context);
  let success = false;
  success = writeToStorage(safeGetStorage("session"), serialized) || success;
  success = writeToStorage(safeGetStorage("local"), serialized) || success;
  return success;
}

export function loadAuthPreflightContext({ now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const sources = [safeGetStorage("session"), safeGetStorage("local")];
  for (const storage of sources) {
    const context = readFromStorage(storage);
    if (!context) {
      continue;
    }
    if (!isAuthPreflightContextFresh(context, { now, maxAgeMs })) {
      continue;
    }
    return context;
  }
  return null;
}

export function isAuthPreflightContextFresh(context, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!context || typeof context !== "object") return false;
  const checkedAt = Number(context.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  return now - checkedAt <= maxAgeMs;
}

export class AuthPreflightError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "AuthPreflightError";
    this.code = code || "UNKNOWN_PREFLIGHT_ERROR";
    if (cause) {
      this.cause = cause;
    }
  }
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function countQuestions(data) {
  if (!data || typeof data !== "object") {
    return 0;
  }
  const keys = Object.keys(data).filter((key) => key !== "pickup");
  return keys.length;
}

async function ensureUser(authInstance, onAuthStateChangedFn) {
  if (authInstance?.currentUser) {
    return authInstance.currentUser;
  }
  return await new Promise((resolve) => {
    const unsubscribe = onAuthStateChangedFn(authInstance, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

export async function runAuthPreflight({
  auth = sharedAuth,
  onAuthStateChanged = sharedOnAuthStateChanged,
  credential = null,
  apiClientFactory = createApiClient,
  getNow = () => Date.now()
} = {}) {
  const user = await ensureUser(auth, onAuthStateChanged);
  if (!user) {
    throw new AuthPreflightError("サインイン状態を確認できませんでした。", "NOT_SIGNED_IN");
  }

  const api = apiClientFactory(auth, onAuthStateChanged);
  const normalizedEmail = normalizeEmail(user.email);
  let userSheetResult;
  try {
    userSheetResult = await api.apiPost({ action: "fetchSheet", sheet: "users" });
  } catch (error) {
    throw new AuthPreflightError("ユーザー一覧の取得に失敗しました。", "FETCH_USERS_FAILED", error);
  }

  const authorizedUsers = Array.isArray(userSheetResult?.data)
    ? userSheetResult.data
        .map((row) => normalizeEmail(row?.["メールアドレス"] || row?.email))
        .filter(Boolean)
    : [];
  if (authorizedUsers.length && normalizedEmail && !authorizedUsers.includes(normalizedEmail)) {
    throw new AuthPreflightError(
      "あなたのアカウントはこのシステムへのアクセスが許可されていません。",
      "NOT_IN_USER_SHEET"
    );
  }

  let ensureAdminResponse = null;
  try {
    ensureAdminResponse = await api.apiPost({ action: "ensureAdmin" });
  } catch (error) {
    throw new AuthPreflightError("管理者権限の同期に失敗しました。", "ENSURE_ADMIN_FAILED", error);
  }

  const now = getNow();
  let mirrorInfo = null;
  try {
    let snapshot = null;
    try {
      snapshot = await get(questionsRef);
    } catch (error) {
      console.warn("Failed to read questions during preflight", error);
    }

    if (!snapshot?.exists?.() || !snapshot.exists()) {
      try {
        await api.apiPost({ action: "mirrorSheet" });
        snapshot = await get(questionsRef);
      } catch (error) {
        console.warn("Failed to mirror questions during preflight", error);
        snapshot = null;
      }
    }

    const data = snapshot?.exists?.() && snapshot.exists() ? snapshot.val() || {} : {};
    mirrorInfo = { syncedAt: now, questionCount: countQuestions(data) };
  } catch (error) {
    console.warn("Failed to determine mirror state during preflight", error);
    mirrorInfo = null;
  }

  const context = {
    version: CONTEXT_VERSION,
    checkedAt: now,
    uid: user.uid || "",
    email: user.email || "",
    credential: normalizeCredentialPayload(credential),
    admin: {
      ensuredAt: now,
      sheetHash:
        typeof ensureAdminResponse?.sheetHash === "string"
          ? ensureAdminResponse.sheetHash
          : ensureAdminResponse?.data?.sheetHash || null
    },
    mirror: mirrorInfo
  };

  storeAuthPreflightContext(context);
  return context;
}

export function preflightContextMatchesUser(context, user) {
  if (!context || !user) return false;
  if (context.uid && user.uid && context.uid !== user.uid) {
    return false;
  }
  const normalizedContextEmail = normalizeEmail(context.email);
  const normalizedUserEmail = normalizeEmail(user.email);
  if (normalizedContextEmail && normalizedUserEmail && normalizedContextEmail !== normalizedUserEmail) {
    return false;
  }
  return true;
}
