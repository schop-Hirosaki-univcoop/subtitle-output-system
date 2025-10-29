// api-client.js: バックエンドAPIとの通信ラッパーを実装し、REST呼び出しを標準化します。
import { GAS_API_URL } from "./constants.js";

export function createApiClient(authInstance, onAuthStateChanged) {
  /**
   * Firebase Auth の現在のユーザーから ID トークンを取得します。
   * 認証状態が確定していない場合は onAuthStateChanged で初回発火を待機します。
   * @param {boolean} [force=false] - キャッシュを無視して再取得するかどうか
   * @returns {Promise<string>}
   */
  async function getIdTokenSafe(force = false) {
    const user =
      authInstance.currentUser ||
      (await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(authInstance, (u) => {
          unsubscribe();
          resolve(u);
        });
      }));
    if (!user) throw new Error("Not signed in");
    return await user.getIdToken(force);
  }

  /**
   * Apps Script API に POST リクエストを送り、共通のエラーハンドリングを行います。
   * Auth 系のエラーが返ってきた場合には 1 度だけトークンを更新して再試行します。
   * @param {Record<string, unknown>} payload - GAS 側に送信するリクエストボディ
   * @param {boolean} [retryOnAuthError=true] - 認証エラー時にリトライを試みるか
   * @returns {Promise<any>}
   */
  async function apiPost(payload, retryOnAuthError = true) {
    const idToken = await getIdTokenSafe();
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, idToken })
    });
    let json;
    try {
      json = await res.json();
    } catch (error) {
      throw new Error("Bad JSON response");
    }
    if (!json.success) {
      const message = String(json.error || "");
      if (retryOnAuthError && /Auth/.test(message)) {
        await getIdTokenSafe(true);
        return await apiPost(payload, false);
      }
      throw new Error(`${message}${json.errorId ? " [" + json.errorId + "]" : ""}`);
    }
    return json;
  }

  /**
   * レスポンスを待たずに API を呼び出し、失敗はコンソールに記録します。
   * 即時性を重視するログ送信などで利用します。
   * @param {Record<string, unknown>} payload
   * @returns {void}
   */
  function fireAndForgetApi(payload) {
    apiPost(payload).catch((error) => {
      console.warn("API fire-and-forget failed", error);
    });
  }

  /**
   * オペレーター操作を GAS バックエンドへ記録します。
   * 失敗しても UI には影響させず、コンソールロギングのみに留めます。
   * @param {string} actionName - 操作の種類
   * @param {string} [details] - 追加情報
   * @returns {Promise<void>}
   */
  async function logAction(actionName, details = "") {
    try {
      await apiPost({
        action: "logAction",
        action_type: actionName,
        details
      });
    } catch (error) {
      console.error("Failed to write log:", error);
    }
  }

  return { apiPost, fireAndForgetApi, logAction };
}
