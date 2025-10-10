import { GAS_API_URL } from "./constants.js";

export function createApiClient(authInstance, onAuthStateChanged) {
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

  function fireAndForgetApi(payload) {
    apiPost(payload).catch((error) => {
      console.warn("API fire-and-forget failed", error);
    });
  }

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
