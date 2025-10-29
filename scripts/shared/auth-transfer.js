// auth-transfer.js: 認証情報の引き継ぎ用ストレージ操作をカプセル化し、画面間のサインイン状態を保持します。
const STORAGE_KEY = "sos:operatorAuthTransfer";

/**
 * sessionStorage取得時のブラウザ依存例外を吸収するヘルパー。
 * プライベートブラウジングやセキュリティ制限で例外が投げられるケースに備えています。
 * @returns {Storage|null}
 */
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

/**
 * 認証資格情報をセッションストレージに保存し、次画面でのサインインに利用できるようにします。
 * @param {object|null} payload Firebase OAuthCredentialから抽出した情報
 * @returns {boolean}
 */
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

/**
 * 保存されている認証引き継ぎ情報を取得し、同時にストレージから削除します。
 * @returns {{ providerId: string, signInMethod: string, idToken: string, accessToken: string, timestamp: number }|null}
 */
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

/**
 * ストレージに残っている認証情報を破棄します。
 */
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
