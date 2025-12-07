// token-api-manager.js: トークン・API関連の機能を担当します。
export class TokenApiManager {
  constructor(context) {
    this.state = context.state;
    
    // 依存関数
    this.ensureCrypto = context.ensureCrypto;
    this.base64UrlFromBytes = context.base64UrlFromBytes;
    this.fetchDbValue = context.fetchDbValue;
    this.GAS_API_URL = context.GAS_API_URL;
  }

  /**
   * 質問トークンの生成
   * @param {Set} existingTokens - 既存のトークンセット
   * @returns {string} 生成されたトークン
   */
  generateQuestionToken(existingTokens = this.state.knownTokens) {
    const used = existingTokens instanceof Set ? existingTokens : new Set();
    const cryptoObj = this.ensureCrypto();

    while (true) {
      let candidate = "";
      if (cryptoObj) {
        const bytes = new Uint8Array(24);
        cryptoObj.getRandomValues(bytes);
        candidate = this.base64UrlFromBytes(bytes).slice(0, 32);
      } else {
        const seed = `${Math.random()}::${Date.now()}::${Math.random()}`;
        candidate = btoa(seed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 32);
      }

      if (!candidate || candidate.length < 12) {
        continue;
      }
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  }

  /**
   * トークンスナップショットの確保
   * @param {boolean} force - 強制的に再取得するか
   * @returns {Promise<Object>} トークンレコード
   */
  async ensureTokenSnapshot(force = false) {
    if (!force && this.state.tokenSnapshotFetchedAt && Date.now() - this.state.tokenSnapshotFetchedAt < 10000) {
      return this.state.tokenRecords;
    }
    const tokens = (await this.fetchDbValue("questionIntake/tokens")) || {};
    this.state.tokenRecords = tokens;
    this.state.knownTokens = new Set(Object.keys(tokens));
    this.state.tokenSnapshotFetchedAt = Date.now();
    return this.state.tokenRecords;
  }

  /**
   * API クライアントの作成
   * @param {Function} getIdToken - IDトークン取得関数
   * @returns {Object} APIクライアントオブジェクト
   */
  createApiClient(getIdToken) {
    const self = this;
    async function apiPost(payload, retryOnAuthError = true) {
      const idToken = await getIdToken();
      const response = await fetch(self.GAS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ ...payload, idToken })
      });
      let json;
      try {
        json = await response.json();
      } catch (error) {
        throw new Error("サーバー応答の解析に失敗しました。");
      }
      if (!json.success) {
        const message = String(json.error || "");
        if (retryOnAuthError && /Auth/.test(message)) {
          await getIdToken(true);
          return await apiPost(payload, false);
        }
        throw new Error(message || "APIリクエストに失敗しました。");
      }
      return json;
    }

    return { apiPost };
  }

  /**
   * 質問キューのドレイン
   * @param {Object} api - APIクライアントオブジェクト
   * @returns {Promise<void>}
   */
  async drainQuestionQueue(api) {
    try {
      await api.apiPost({ action: "processQuestionQueue" });
    } catch (error) {
      console.warn("processQuestionQueue failed", error);
    }
  }
}

