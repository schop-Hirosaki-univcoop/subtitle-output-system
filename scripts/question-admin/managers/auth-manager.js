// auth-manager.js: 認証・初期化機能のマネージャークラス
// 認証状態の監視、在籍確認、管理者権限の確認を担当します。

import { onAuthStateChanged, signOut } from "../firebase.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../../shared/auth-preflight.js";

/**
 * 認証・初期化機能のマネージャークラス
 * QuestionAdminApp から認証・初期化機能を分離したモジュール
 */
export class AuthManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.api = context.api;
    this.auth = context.auth;
    this.getAuthIdToken = context.getAuthIdToken;
    this.firebaseConfig = context.firebaseConfig;
    this.goToLogin = context.goToLogin;
    this.setAuthUi = context.setAuthUi;
    this.setLoginError = context.setLoginError;
    this.showLoader = context.showLoader;
    this.hideLoader = context.hideLoader;
    this.initLoaderSteps = context.initLoaderSteps;
    this.setLoaderStep = context.setLoaderStep;
    this.finishLoaderSteps = context.finishLoaderSteps;
    this.resetState = context.resetState;
    this.renderUserSummary = context.renderUserSummary;
    this.isEmbeddedMode = context.isEmbeddedMode;
    this.STEP_LABELS = context.STEP_LABELS;
    this.ensureTokenSnapshot = context.ensureTokenSnapshot;
    this.loadEvents = context.loadEvents;
    this.loadParticipants = context.loadParticipants;
    this.drainQuestionQueue = context.drainQuestionQueue;
    this.resolveEmbedReady = context.resolveEmbedReady;
    this.maybeFocusInitialSection = context.maybeFocusInitialSection;
    this.sleep = context.sleep;
    this.setUploadStatus = context.setUploadStatus;
    this.redirectingToIndexRef = context.redirectingToIndexRef; // app.jsのredirectingToIndexへの参照
    
    // 内部状態
    this.AUTHORIZED_EMAIL_CACHE_MS = 5 * 60 * 1000;
    this.cachedAuthorizedEmails = null;
    this.cachedAuthorizedFetchedAt = 0;
    this.authorizedEmailsPromise = null;
  }
  
  /**
   * redirectingToIndexのgetter
   * @returns {boolean}
   */
  get redirectingToIndex() {
    return this.redirectingToIndexRef ? this.redirectingToIndexRef.current : false;
  }
  
  /**
   * redirectingToIndexのsetter
   * @param {boolean} value
   */
  set redirectingToIndex(value) {
    if (this.redirectingToIndexRef) {
      this.redirectingToIndexRef.current = value;
    }
  }

  /**
   * キャッシュされた認証済みメールアドレスを取得
   * @returns {Array<string>|null}
   */
  getCachedAuthorizedEmails() {
    if (!this.cachedAuthorizedEmails || !this.cachedAuthorizedFetchedAt) {
      return null;
    }
    if (Date.now() - this.cachedAuthorizedFetchedAt > this.AUTHORIZED_EMAIL_CACHE_MS) {
      return null;
    }
    return this.cachedAuthorizedEmails;
  }

  /**
   * 認証済みメールアドレスを取得
   * @returns {Promise<Array<string>>}
   */
  async fetchAuthorizedEmails() {
    const cached = this.getCachedAuthorizedEmails();
    if (cached) {
      return cached;
    }

    if (!this.authorizedEmailsPromise) {
      this.authorizedEmailsPromise = (async () => {
        const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
        if (!result || !result.success || !Array.isArray(result.data)) {
          throw new Error("ユーザー権限の確認に失敗しました。");
        }
        const emails = result.data
          .map(entry =>
            String(entry["メールアドレス"] || entry.email || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean);
        this.cachedAuthorizedEmails = emails;
        this.cachedAuthorizedFetchedAt = Date.now();
        return emails;
      })();
    }

    try {
      const emails = await this.authorizedEmailsPromise;
      return emails;
    } finally {
      this.authorizedEmailsPromise = null;
    }
  }

  /**
   * 新鮮なプリフライトコンテキストを取得
   * @param {Object} user - ユーザーオブジェクト
   * @returns {Object|null}
   */
  getFreshPreflightContext(user) {
    if (!user) {
      return null;
    }
    try {
      const context = loadAuthPreflightContext();
      if (!context) {
        return null;
      }
      if (!preflightContextMatchesUser(context, user)) {
        return null;
      }
      if (!context?.admin || !context.admin.ensuredAt) {
        return null;
      }
      return context;
    } catch (error) {
      console.warn("Failed to load auth preflight context", error);
      return null;
    }
  }

  /**
   * 在籍確認
   * @param {Object} user - ユーザーオブジェクト
   * @returns {Promise<void>}
   */
  async verifyEnrollment(user) {
    if (!user) {
      throw new Error("サインイン情報を確認できませんでした。");
    }

    const preflight = this.getFreshPreflightContext(user);
    if (preflight) {
      return;
    }

    const email = String(user.email || "").trim().toLowerCase();
    if (!email) {
      throw new Error("メールアドレスを確認できませんでした。");
    }

    const cached = this.getCachedAuthorizedEmails();
    if (cached && cached.includes(email)) {
      return;
    }

    try {
      const authorized = await this.fetchAuthorizedEmails();
      if (authorized.includes(email)) {
        return;
      }
    } catch (error) {
      console.warn("Failed to fetch authorized emails", error);
      throw new Error(error.message || "ユーザー権限の確認に失敗しました。");
    }

    throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
  }

  /**
   * 質問インテークアクセスを確認
   * @returns {Promise<boolean>}
   */
  async probeQuestionIntakeAccess() {
    const baseUrl = String(this.firebaseConfig.databaseURL || "").replace(/\/$/, "");
    if (!baseUrl) {
      throw new Error("リアルタイムデータベースのURLが設定されていません。");
    }

    const token = await this.getAuthIdToken(false);
    const url = `${baseUrl}/questionIntake/events.json?shallow=true&limitToFirst=1&auth=${encodeURIComponent(
      token
    )}`;
    const response = await fetch(url, { method: "GET" });
    if (response.ok) {
      return true;
    }

    const bodyText = await response.text().catch(() => "");
    const permissionIssue =
      response.status === 401 || response.status === 403 || /permission\s*denied/i.test(bodyText);
    if (permissionIssue) {
      return false;
    }

    const message = bodyText || `Realtime Database request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  /**
   * ユーザーシートに含まれていないエラーかどうかを判定
   * @param {Error} error - エラーオブジェクト
   * @returns {boolean}
   */
  isNotInUsersSheetError(error) {
    if (!error) {
      return false;
    }
    const message = String(error?.message || error || "");
    return /not in users sheet/i.test(message) || /NOT_IN_USER_SHEET/i.test(message);
  }

  /**
   * 質問インテークアクセスを待機
   * @param {Object} options - オプション
   * @param {number} options.attempts - 試行回数
   * @param {number} options.initialDelay - 初期遅延（ミリ秒）
   * @param {number} options.backoffFactor - バックオフ係数
   * @param {number} options.maxDelay - 最大遅延（ミリ秒）
   * @returns {Promise<boolean>}
   */
  async waitForQuestionIntakeAccess(options = {}) {
    const {
      attempts = 5,
      initialDelay = 250,
      backoffFactor = 1.8,
      maxDelay = 2000
    } = options || {};

    const attemptCount = Number.isFinite(attempts) && attempts > 0 ? Math.ceil(attempts) : 1;
    const sanitizedInitial = Number.isFinite(initialDelay) && initialDelay >= 0 ? initialDelay : 250;
    const sanitizedBackoff = Number.isFinite(backoffFactor) && backoffFactor > 1 ? backoffFactor : 1.5;
    const sanitizedMaxDelay = Number.isFinite(maxDelay) && maxDelay > 0 ? maxDelay : 4000;
    const baseUrl = String(this.firebaseConfig.databaseURL || "").replace(/\/$/, "");

    if (!baseUrl) {
      throw new Error("リアルタイムデータベースのURLが設定されていません。");
    }

    let waitMs = sanitizedInitial || 250;
    let lastError = null;

    for (let attempt = 0; attempt < attemptCount; attempt++) {
      try {
        const token = await this.getAuthIdToken(attempt > 0);
        const url =
          `${baseUrl}/questionIntake/events.json?shallow=true&limitToFirst=1&auth=${encodeURIComponent(token)}`;
        const response = await fetch(url, { method: "GET" });
        if (response.ok) {
          return true;
        }

        const bodyText = await response.text().catch(() => "");
        const permissionIssue =
          response.status === 401 ||
          response.status === 403 ||
          /permission\s*denied/i.test(bodyText);

        if (!permissionIssue) {
          const message = bodyText || `Realtime Database request failed (${response.status})`;
          throw new Error(message);
        }

        lastError = new Error("管理者権限の反映に時間がかかっています。数秒後に再度お試しください。");
      } catch (error) {
        lastError = error;
      }

      if (attempt < attemptCount - 1) {
        if (waitMs > 0) {
          await this.sleep(waitMs);
        }
        const nextDelay = Math.max(waitMs * sanitizedBackoff, sanitizedInitial || 250);
        waitMs = Math.min(sanitizedMaxDelay, Math.round(nextDelay));
      }
    }

    throw lastError || new Error("管理者権限の確認がタイムアウトしました。");
  }

  /**
   * 管理者権限を確認・同期
   * @returns {Promise<void>}
   */
  async ensureAdminAccess() {
    let ensureRequired = true;
    try {
      const hasAccess = await this.probeQuestionIntakeAccess();
      if (hasAccess) {
        ensureRequired = false;
      }
    } catch (error) {
      console.warn("Failed to probe question intake access", error);
    }

    if (!ensureRequired) {
      return;
    }

    try {
      await this.api.apiPost({ action: "ensureAdmin" });
    } catch (error) {
      if (this.isNotInUsersSheetError(error)) {
        throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
      }
      throw new Error(error?.message || "管理者権限の確認に失敗しました。");
    }

    try {
      await this.waitForQuestionIntakeAccess({ attempts: 6, initialDelay: 250 });
    } catch (error) {
      throw new Error(error?.message || "管理者権限の確認に失敗しました。");
    }
  }

  /**
   * 認証状態の監視を開始
   */
  initAuthWatcher() {
    onAuthStateChanged(this.auth, async user => {
      this.state.user = user;
      const embedded = this.isEmbeddedMode();
      if (!user) {
        if (embedded) {
          this.showLoader("利用状態を確認しています…");
        } else {
          this.hideLoader();
          if (this.dom.loginButton) {
            this.dom.loginButton.disabled = false;
            this.dom.loginButton.classList.remove("is-busy");
          }
        }
        this.setAuthUi(false);
        this.resetState();
        if (!this.redirectingToIndex && typeof window !== "undefined" && !embedded) {
          this.redirectingToIndex = true;
          this.goToLogin();
        }
        return;
      }

      this.redirectingToIndex = false;
      this.showLoader(embedded ? "利用準備を確認しています…" : "権限を確認しています…");
      const loaderLabels = embedded ? [] : this.STEP_LABELS;
      this.initLoaderSteps(loaderLabels);

      try {
        this.setLoaderStep(0, embedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
        this.setLoaderStep(1, embedded ? "利用条件を確認しています…" : "在籍状況を確認しています…");
        await this.verifyEnrollment(user);
        this.setLoaderStep(2, embedded ? "必要な権限を同期しています…" : "管理者権限を確認・同期しています…");
        await this.ensureAdminAccess();
        this.setLoaderStep(3, embedded ? "参加者データを準備しています…" : "初期データを取得しています…");
        // --- FIX 3: Parallelize token and event loading ---
        await Promise.all([
          this.ensureTokenSnapshot(true),
          this.loadEvents({ preserveSelection: false })
        ]);
        await this.loadParticipants();
        if (this.state.initialSelectionNotice) {
          this.setUploadStatus(this.state.initialSelectionNotice, "error");
          this.state.initialSelectionNotice = null;
        }
        await this.drainQuestionQueue();
        this.setLoaderStep(4, embedded ? "仕上げ処理を行っています…" : "初期データの取得が完了しました。仕上げ中…");
        this.setAuthUi(true);
        this.finishLoaderSteps("準備完了");
        this.resolveEmbedReady();
        if (this.state.initialFocusTarget) {
          window.setTimeout(() => this.maybeFocusInitialSection(), 400);
        }
      } catch (error) {
        console.error(error);
        this.setLoginError(error.message || "権限の確認に失敗しました。");
        await signOut(this.auth);
        this.resetState();
      } finally {
        this.hideLoader();
      }
    });
  }
}

