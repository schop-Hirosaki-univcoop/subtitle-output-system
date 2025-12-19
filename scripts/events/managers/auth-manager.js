// auth-manager.js: イベント管理画面の認証管理を担当します。
// Firebase認証、認証状態の監視、認証再開、管理者権限チェックを管理します。

import { auth, signOut, signInWithCredential, onAuthStateChanged, GoogleAuthProvider } from "../../operator/firebase.js";
import { get, glIntakeEventsRef, getGlApplicationsRef } from "../../operator/firebase.js";
import { consumeAuthTransfer } from "../../shared/auth-transfer.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../../shared/auth-preflight.js";
import { appendAuthDebugLog, replayAuthDebugLog } from "../../shared/auth-debug-log.js";
import { logError } from "../helpers.js";
import { goToLogin } from "../../shared/routes.js";

const AUTH_RESUME_FALLBACK_DELAY_MS = 4_000;

/**
 * setTimeout/clearTimeout を持つホストオブジェクトを検出します。
 * ブラウザ/Nodeの両環境で安全にタイマーを利用するためのフォールバックです。
 * @returns {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }}
 */
function getTimerHost() {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window;
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.setTimeout === "function") {
    return globalThis;
  }
  return {
    setTimeout,
    clearTimeout
  };
}

/**
 * 認証管理クラス
 * EventAdminApp から認証管理機能を分離したモジュール
 */
export class EventAuthManager {
  constructor(app) {
    this.app = app;
    this.api = app.api;
    
    // 認証関連のプロパティ
    this.auth = auth;
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.preflightContext = null;
    this.hasSeenAuthenticatedUser = Boolean(auth?.currentUser);
    this.authResumeFallbackTimer = 0;
    this.authResumeGracePeriodMs = AUTH_RESUME_FALLBACK_DELAY_MS;
    this.authResumeTimerHost = getTimerHost();
    this.authTransferAttempted = false;
  }

  /**
   * 認証状態の監視を開始します。
   */
  observeAuthState() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      this.handleAuthState(user).catch((error) => {
        logError("Failed to handle event admin auth state", error);
        if (this.app.showAlert) {
          this.app.showAlert(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
        }
      });
    });
  }

  /**
   * 認証状態の監視を停止します。
   */
  stopObservingAuthState() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
  }

  /**
   * プリフライトコンテキストをユーザー用に読み込みます。
   * @param {import("firebase/auth").User|null} user
   * @returns {object|null}
   */
  loadPreflightContextForUser(user) {
    if (!user) {
      appendAuthDebugLog("events:preflight-context:skip", { reason: "no-user" }, { level: "debug" });
      return null;
    }
    const context = loadAuthPreflightContext();
    if (!context) {
      appendAuthDebugLog("events:preflight-context:missing");
      return null;
    }
    if (!preflightContextMatchesUser(context, user)) {
      appendAuthDebugLog("events:preflight-context:identity-mismatch", {
        contextUid: context?.uid || null,
        userUid: user?.uid || null
      });
      return null;
    }
    appendAuthDebugLog("events:preflight-context:loaded", {
      questionCount: context?.mirror?.questionCount ?? null
    });
    return context;
  }

  /**
   * 認証の再開を試みます。
   * @returns {Promise<boolean>}
   */
  async tryResumeAuth() {
    if (this.authTransferAttempted) {
      appendAuthDebugLog("events:auth-resume:skipped", { reason: "already-attempted" }, { level: "debug" });
      return false;
    }
    this.authTransferAttempted = true;
    appendAuthDebugLog("events:auth-resume:start");

    let transfer = consumeAuthTransfer();
    if (!this.isValidTransferPayload(transfer)) {
      const fallbackContext = loadAuthPreflightContext();
      appendAuthDebugLog("events:auth-resume:transfer-missing", {
        hasFallbackContext: Boolean(fallbackContext)
      });
      const fallbackCredential = fallbackContext?.credential;
      if (fallbackCredential && (fallbackCredential.idToken || fallbackCredential.accessToken)) {
        appendAuthDebugLog("events:auth-resume:fallback-credential", {
          hasIdToken: Boolean(fallbackCredential.idToken),
          hasAccessToken: Boolean(fallbackCredential.accessToken)
        });
        transfer = {
          providerId: fallbackCredential.providerId || GoogleAuthProvider.PROVIDER_ID,
          signInMethod: fallbackCredential.signInMethod || "",
          idToken: fallbackCredential.idToken || "",
          accessToken: fallbackCredential.accessToken || "",
          timestamp: Date.now()
        };
      }
    }

    if (!this.isValidTransferPayload(transfer)) {
      appendAuthDebugLog("events:auth-resume:invalid-payload", null, { level: "warn" });
      return false;
    }

    const providerId = transfer.providerId || "";
    if (providerId && providerId !== GoogleAuthProvider.PROVIDER_ID) {
      logError("Unsupported auth transfer provider", new Error(providerId));
      appendAuthDebugLog("events:auth-resume:unsupported-provider", { providerId }, { level: "error" });
      return false;
    }

    const idToken = transfer.idToken || "";
    const accessToken = transfer.accessToken || "";
    const credential = GoogleAuthProvider.credential(
      idToken || undefined,
      accessToken || undefined
    );
    if (!credential) {
      return false;
    }

    try {
      await signInWithCredential(auth, credential);
      appendAuthDebugLog("events:auth-resume:success");
      return true;
    } catch (error) {
      logError("Failed to resume auth from transfer payload", error);
      appendAuthDebugLog(
        "events:auth-resume:error",
        { code: error?.code || null, message: error?.message || null },
        { level: "error" }
      );
      return false;
    }
  }

  /**
   * 転送ペイロードが有効かどうかを判定します。
   * @param {unknown} payload
   * @returns {boolean}
   */
  isValidTransferPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const hasToken = Boolean((payload.idToken || "").trim()) || Boolean((payload.accessToken || "").trim());
    return hasToken;
  }

  /**
   * 認証再開フォールバックをスケジュールします。
   * @param {string} reason
   */
  scheduleAuthResumeFallback(reason = "unknown") {
    if (this.authResumeFallbackTimer) {
      appendAuthDebugLog("events:auth-resume:fallback-already-scheduled", { reason }, { level: "debug" });
      return;
    }
    const host = this.authResumeTimerHost || getTimerHost();
    const delayMs = Number.isFinite(this.authResumeGracePeriodMs)
      ? Math.max(0, this.authResumeGracePeriodMs)
      : 0;
    this.authResumeFallbackTimer = host.setTimeout(() => {
      this.authResumeFallbackTimer = 0;
      if (auth?.currentUser) {
        appendAuthDebugLog("events:auth-resume:fallback-aborted", {
          reason,
          uid: auth.currentUser.uid || null
        });
        return;
      }
      appendAuthDebugLog("events:auth-resume:fallback-trigger", { reason });
      this.app.showLoggedOutState();
    }, delayMs);
    appendAuthDebugLog("events:auth-resume:fallback-scheduled", { reason, delayMs });
  }

  /**
   * 認証再開フォールバックをキャンセルします。
   * @param {string} reason
   */
  cancelAuthResumeFallback(reason = "unknown") {
    if (!this.authResumeFallbackTimer) {
      return;
    }
    const host = this.authResumeTimerHost || getTimerHost();
    host.clearTimeout(this.authResumeFallbackTimer);
    this.authResumeFallbackTimer = 0;
    appendAuthDebugLog("events:auth-resume:fallback-cancelled", { reason }, { level: "debug" });
  }

  /**
   * 認証状態の変化を処理します。
   * @param {import("firebase/auth").User|null} user
   */
  async handleAuthState(user) {
    appendAuthDebugLog("events:handle-auth-state", {
      uid: user?.uid || null
    });
    this.currentUser = user;
    this.app.currentUser = user;
    
    // アプリケーションの状態を更新
    this.app.chat.handleAuthChange(user);
    this.app.startChatReadListener(user);
    this.app.updateUserLabel();
    
    this.preflightContext = this.loadPreflightContextForUser(user);
    this.app.preflightContext = this.preflightContext;
    
    if (!user) {
      this.app.fullscreenPromptShown = false;
      if (this.hasSeenAuthenticatedUser) {
        appendAuthDebugLog("events:handle-auth-state:signed-out");
        this.cancelAuthResumeFallback("signed-out");
        this.app.clearHostPresence();
        this.app.events = [];
        this.app.renderEvents();
        this.app.notifyEventListeners();
        this.app.notifySelectionListeners("host");
        this.app.clearAlert();
        this.app.showLoggedOutState();
        return;
      }
      if (await this.tryResumeAuth()) {
        appendAuthDebugLog("events:handle-auth-state:resuming");
        return;
      }
      this.scheduleAuthResumeFallback("initial-null-user");
      this.app.clearHostPresence();
      this.app.events = [];
      this.app.renderEvents();
      this.app.notifyEventListeners();
      this.app.notifySelectionListeners("host");
      this.app.clearAlert();
      return;
    }

    this.hasSeenAuthenticatedUser = true;
    this.cancelAuthResumeFallback("user-present");
    appendAuthDebugLog("events:handle-auth-state:user-present", {
      uid: user.uid || null
    });
    
    this.app.showLoggedInState();
    this.app.clearAlert();
    this.app.promptFullscreenChoice();

    try {
      this.app.beginEventsLoading("権限を確認しています…");
      await this.ensureAdminAccess();
      this.app.updateEventsLoadingMessage("イベント情報を読み込んでいます…");
      await this.app.loadEvents();
      this.app.updateEventSummary();
      this.app.updateScheduleSummary();
      this.app.updateStageHeader();
      this.app.updateSelectionNotes();
      this.app.tools.preloadOperatorGlobals();
    } catch (error) {
      logError("Event admin initialization failed", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.app.showAlert(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "イベント情報の読み込みに失敗しました。時間をおいて再度お試しください。";
      const message = error instanceof Error && error.message ? error.message : fallback;
      this.app.showAlert(message || fallback);
    } finally {
      this.app.endEventsLoading();
      this.app.clearLoadingIndicators();
      if (user) {
        this.app.syncHostPresence("auth-refresh");
      }
    }
  }

  /**
   * 管理者アクセスを確保します。
   */
  async ensureAdminAccess() {
    if (!this.api) {
      return;
    }
    if (this.preflightContext?.admin?.ensuredAt) {
      return;
    }
    try {
      await this.api.apiPost({ action: "ensureAdmin" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      let message = "権限の確認に失敗しました。時間をおいて再度お試しください。";
      if (/not in users sheet/i.test(rawMessage)) {
        message = "あなたのアカウントにはこのページへのアクセス権限がありません。管理者に確認してください。";
      }
      const err = new Error(message);
      err.code = "EVENT_INDEX_ACCESS_DENIED";
      err.cause = error;
      throw err;
    }
  }

  /**
   * 安全にサインアウトします。
   */
  async safeSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Failed to sign out after permission error:", error);
    }
  }

  /**
   * 権限エラーかどうかを判定します。
   * @param {unknown} error
   * @returns {boolean}
   */
  isPermissionError(error) {
    if (!error) return false;
    if (error.code === "EVENT_INDEX_ACCESS_DENIED") return true;
    const code = typeof error.code === "string" ? error.code : "";
    if (code.includes("PERMISSION")) return true;
    const message = error instanceof Error ? error.message : String(error || "");
    return /permission/i.test(message) || message.includes("権限");
  }

  /**
   * 現在のユーザーが指定されたイベントの内部スタッフに登録されているかチェックし、未登録の場合はモーダルを表示します。
   * @param {import("firebase/auth").User} user
   * @param {string} eventId - チェック対象のイベントID
   */
  async checkInternalStaffRegistration(user, eventId) {
    try {
      const userEmail = String(user?.email || "").trim().toLowerCase();
      if (!userEmail) {
        return;
      }

      if (!eventId || !String(eventId).trim()) {
        // イベントIDが指定されていない場合はスキップ
        return;
      }

      // 指定されたイベントの内部スタッフリストをチェック
      try {
        const applicationsRef = getGlApplicationsRef(eventId);
        const applicationsSnapshot = await get(applicationsRef);
        const applications = applicationsSnapshot.val() || {};
        
        // 内部スタッフ（sourceType: "internal"）でメールアドレスが一致するものを探す
        const isRegistered = Object.values(applications).some((app) => {
          if (!app || typeof app !== "object") return false;
          const appEmail = String(app.email || "").trim().toLowerCase();
          const sourceType = String(app.sourceType || "").trim();
          return sourceType === "internal" && appEmail === userEmail;
        });

        // 未登録の場合はモーダルを表示
        if (!isRegistered) {
          // EventAdminAppにアクセス
          const eventAdminApp = this.app;
          if (eventAdminApp && typeof eventAdminApp.showInternalStaffRegistrationModal === "function") {
            // 次のイベントループで実行して、DOMの準備が完了してから実行
            requestAnimationFrame(() => {
              if (eventAdminApp && typeof eventAdminApp.showInternalStaffRegistrationModal === "function") {
                eventAdminApp.showInternalStaffRegistrationModal(user, [eventId]).catch((error) => {
                  console.warn("Failed to show internal staff registration modal:", error);
                });
              }
            });
          }
        }
      } catch (error) {
        // イベントチェックでエラーが発生しても続行
        console.warn(`Failed to check internal staff for event ${eventId}:`, error);
      }
    } catch (error) {
      // 内部スタッフ登録チェックでエラーが発生してもログイン処理は続行
      console.warn("Failed to check internal staff registration:", error);
    }
  }

  /**
   * クリーンアップ処理を行います。
   */
  cleanup() {
    this.stopObservingAuthState();
    this.cancelAuthResumeFallback("cleanup");
  }
}

