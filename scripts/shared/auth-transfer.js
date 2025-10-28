const STORAGE_KEY = "sos:operatorAuthTransfer";

function getSessionStorage() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch (error) {
    console.warn("Session storage unavailable", error);
  }
  return null;
}

export function storeAuthTransfer(payload = null) {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }
  try {
    if (!payload || typeof payload !== "object") {
      storage.removeItem(STORAGE_KEY);
      return false;
    }
    const record = {
      providerId: typeof payload.providerId === "string" ? payload.providerId : "",
      signInMethod: typeof payload.signInMethod === "string" ? payload.signInMethod : "",
      idToken: typeof payload.idToken === "string" ? payload.idToken : "",
      accessToken: typeof payload.accessToken === "string" ? payload.accessToken : "",
      timestamp: Date.now()
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch (error) {
    console.warn("Failed to store auth transfer payload", error);
    return false;
  }
}

export function consumeAuthTransfer() {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    storage.removeItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const timestamp = Number(parsed.timestamp);
    return {
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : "",
      signInMethod: typeof parsed.signInMethod === "string" ? parsed.signInMethod : "",
      idToken: typeof parsed.idToken === "string" ? parsed.idToken : "",
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : "",
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now()
    };
  } catch (error) {
    console.warn("Failed to consume auth transfer payload", error);
    return null;
  }
}

export function clearAuthTransfer() {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear auth transfer payload", error);
  }
}
