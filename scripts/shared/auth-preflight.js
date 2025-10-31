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

function createProgressReporter(onProgress) {
  if (typeof onProgress !== "function") {
    return () => {};
  }
  return (stage, phase, payload = null) => {
    try {
      onProgress({ stage, phase, payload });
    } catch (error) {
      console.warn("Auth preflight progress listener failed", error);
    }
  };
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

function isNotInUsersSheetError(error) {
  if (!error) return false;
  const message = typeof error.message === "string" ? error.message : String(error || "");
  if (/not in users sheet/i.test(message) || /Forbidden: not in users sheet/i.test(message)) {
    return true;
  }
  if (error.cause) {
    return isNotInUsersSheetError(error.cause);
  }
  return false;
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
  getNow = () => Date.now(),
  onProgress = null
} = {}) {
  const report = createProgressReporter(onProgress);
  const user = await ensureUser(auth, onAuthStateChanged);
  if (!user) {
    throw new AuthPreflightError("サインイン状態を確認できませんでした。", "NOT_SIGNED_IN");
  }

  const api = apiClientFactory(auth, onAuthStateChanged);
  const normalizedEmail = normalizeEmail(user.email);

  let ensureAdminResponse = null;
  try {
    report("ensureAdmin", "start");
    ensureAdminResponse = await api.apiPost({ action: "ensureAdmin" });
    const sheetHash =
      typeof ensureAdminResponse?.sheetHash === "string"
        ? ensureAdminResponse.sheetHash
        : ensureAdminResponse?.data?.sheetHash || null;
    report("ensureAdmin", "success", { sheetHash });
  } catch (error) {
    report("ensureAdmin", "error", { code: "ENSURE_ADMIN_FAILED", message: error?.message || null });
    if (isNotInUsersSheetError(error)) {
      throw new AuthPreflightError(
        "あなたのアカウントはこのシステムへのアクセスが許可されていません。",
        "NOT_IN_USER_SHEET",
        error
      );
    }
    throw new AuthPreflightError("管理者権限の同期に失敗しました。", "ENSURE_ADMIN_FAILED", error);
  }

  try {
    report("userSheet", "start");
    const userSheetResult = await api.apiPost({ action: "fetchSheet", sheet: "users" });
    const authorizedUsers = Array.isArray(userSheetResult?.data)
      ? userSheetResult.data
          .map((row) => normalizeEmail(row?.["メールアドレス"] || row?.email))
          .filter(Boolean)
      : [];
    if (authorizedUsers.length && normalizedEmail && !authorizedUsers.includes(normalizedEmail)) {
      report("userSheet", "error", { code: "NOT_IN_USER_SHEET", message: null });
      throw new AuthPreflightError(
        "あなたのアカウントはこのシステムへのアクセスが許可されていません。",
        "NOT_IN_USER_SHEET"
      );
    }
    report("userSheet", "success", { totalUsers: authorizedUsers.length, fallback: false });
  } catch (error) {
    if (isNotInUsersSheetError(error)) {
      report("userSheet", "error", { code: "NOT_IN_USER_SHEET", message: error?.message || null });
      throw new AuthPreflightError(
        "あなたのアカウントはこのシステムへのアクセスが許可されていません。",
        "NOT_IN_USER_SHEET",
        error
      );
    }
    console.warn("Failed to fetch users sheet during auth preflight", error);
    report("userSheet", "success", { totalUsers: null, fallback: true });
  }

  const now = getNow();
  let mirrorInfo = null;
  try {
    report("mirror", "start");
    let snapshot = null;
    try {
      snapshot = await get(questionsRef);
    } catch (error) {
      console.warn("Failed to read questions during preflight", error);
    }

    const data = snapshot?.exists?.() && snapshot.exists() ? snapshot.val() || {} : {};
    mirrorInfo = { syncedAt: now, questionCount: countQuestions(data) };
    report("mirror", "success", { questionCount: mirrorInfo.questionCount, fallback: false });
  } catch (error) {
    console.warn("Failed to determine mirror state during preflight", error);
    mirrorInfo = null;
    report("mirror", "success", { questionCount: null, fallback: true });
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
