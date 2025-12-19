// auth-manager.js: 認証管理とユーザー権限チェックを担当します。
import { auth, provider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";
import { questionsRef, questionIntakeEventsRef, questionIntakeSchedulesRef, get, glIntakeEventsRef, getGlApplicationsRef } from "./firebase.js";
import { OPERATOR_MODE_TELOP } from "../shared/operator-modes.js";
import { goToLogin } from "../shared/routes.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../shared/auth-preflight.js";
import * as Questions from "./questions.js";

/**
 * 認証管理クラス
 * Firebase認証とユーザー権限チェックを管理します。
 */
export class AuthManager {
  constructor(app) {
    this.app = app;
  }

  /**
   * Google認証でログインします。
   */
  async login() {
    const btn = this.app.dom.loginButton;
    const originalText = btn ? btn.textContent : "";
    try {
      this.app.authFlow = "prompting";
      this.app.showLoader("サインイン中…");
      if (btn) {
        btn.disabled = true;
        btn.classList.add("is-busy");
        btn.textContent = "サインイン中…";
      }
      await signInWithPopup(auth, provider);
    } catch (error) {
      this.app.toast("ログインに失敗しました。", "error");
      this.app.hideLoader();
    } finally {
      this.app.authFlow = "done";
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
        btn.textContent = originalText;
      }
      if (this.app.pendingAuthUser !== null) {
        const user = this.app.pendingAuthUser;
        this.app.pendingAuthUser = null;
        await this.handleAuthState(user);
      }
    }
  }

  /**
   * ログアウトします。
   */
  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      // Ignore logout errors; UI state will refresh on auth callbacks.
    }
    this.app.authFlow = "idle";
    this.app.pendingAuthUser = null;
    this.app.preflightContext = null;
    this.app.hideLoader();
  }

  /**
   * プリフライトコンテキストをユーザー用に読み込みます。
   * @param {import("firebase/auth").User} user
   * @returns {object|null}
   */
  loadPreflightContextForUser(user) {
    if (!user) {
      return null;
    }
    const context = loadAuthPreflightContext();
    if (!context) {
      return null;
    }
    if (!preflightContextMatchesUser(context, user)) {
      return null;
    }
    return context;
  }

  /**
   * 認証状態の変化を処理します。
   * @param {import("firebase/auth").User|null} user
   */
  async handleAuthState(user) {
    if (!user) {
      this.app.preflightContext = null;
      this.showLoggedOutState();
      return;
    }
    this.app.preflightContext = this.loadPreflightContextForUser(user);
    const preflight = this.app.preflightContext;
    try {
      this.app.showLoader(this.app.isEmbedded ? "利用準備を確認しています…" : "権限を確認しています…");
      this.app.initLoaderSteps();
      const loginEmail = String(user.email || "").trim().toLowerCase();
      if (!preflight) {
        this.app.setLoaderStep(0, this.app.isEmbedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
        const result = await this.app.api.apiPost({ action: "fetchSheet", sheet: "users" });
        this.app.setLoaderStep(1, this.app.isEmbedded ? "必要な設定を確認しています…" : "在籍チェック中…");
        if (!result.success || !result.data) {
          throw new Error("ユーザー権限の確認に失敗しました。");
        }
        const authorizedUsers = result.data
          .map((item) => String(item["メールアドレス"] || "").trim().toLowerCase())
          .filter(Boolean);
        if (!authorizedUsers.includes(loginEmail)) {
          this.app.toast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
          await this.logout();
          this.app.hideLoader();
          return;
        }
      } else {
        this.app.setLoaderStep(0, this.app.isEmbedded ? "プリフライト結果を確認しています…" : "プリフライト結果を適用しています…");
        this.app.setLoaderStep(1, this.app.isEmbedded ? "権限キャッシュを適用しています…" : "在籍チェックをスキップしました。");
      }

      const shouldEnsureAdmin = !preflight?.admin?.ensuredAt;
      if (shouldEnsureAdmin) {
        this.app.setLoaderStep(2, this.app.isEmbedded ? "必要な権限を同期しています…" : "管理者権限の確認/付与…");
        try {
          await this.app.api.apiPost({ action: "ensureAdmin" });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : String(error || "");
          let message = "管理者権限の同期に失敗しました。時間をおいて再度お試しください。";
          if (/not in users sheet/i.test(rawMessage) || /Forbidden: not in users sheet/i.test(rawMessage)) {
            message = "あなたのアカウントはこのシステムへのアクセスが許可されていません。";
            this.app.toast(message, "error");
            await this.logout();
            this.app.hideLoader();
            return;
          }
          // 技術的なエラー（ネットワークエラーなど）の場合も処理を中断
          throw new Error(message);
        }
      } else {
        this.app.setLoaderStep(2, this.app.isEmbedded ? "管理者権限を適用しています…" : "管理者権限はプリフライト済みです。");
      }

      await this.renderLoggedInUi(user);
      this.app.setLoaderStep(3, this.app.isEmbedded ? "初期データを準備しています…" : "初期ミラーを確認しています…");
      this.app.updateLoader("初期データを準備しています…");
      let questionsSnapshot = null;
      try {
        questionsSnapshot = await get(questionsRef);
      } catch (error) {
        console.warn("Failed to load questions before subscriptions", error);
      }

      const hasQuestions = questionsSnapshot?.exists?.() && questionsSnapshot.exists();
      if (!hasQuestions) {
        this.app.setLoaderStep(3, this.app.isEmbedded ? "プリフライト済みの空データを適用しています…" : "プリフライトの結果を適用しています…");
      }

      this.app.setLoaderStep(4, this.app.isEmbedded ? "リアルタイム購読を開始しています…" : "購読開始…");
      this.app.updateLoader("データ同期中…");
      // questionStatusはイベントごとに分離されているため、初期ロード時は取得しない
      // リアルタイム購読で取得する（startQuestionStatusStream）
      const [eventsSnapshot, schedulesSnapshot] = await Promise.all([
        get(questionIntakeEventsRef),
        get(questionIntakeSchedulesRef)
      ]);
      const questionsValue = hasQuestions && questionsSnapshot?.val ? questionsSnapshot.val() || {} : {};
      this.app.eventsBranch = eventsSnapshot.val() || {};
      this.app.schedulesBranch = schedulesSnapshot.val() || {};
      this.app.applyQuestionsBranch(questionsValue);
      // questionStatusはstartQuestionStatusStreamで取得するため、ここでは空のMapを設定
      this.app.applyQuestionStatusSnapshot({});
      this.app.rebuildScheduleMetadata();
      this.app.applyContextToState();
      this.app.startQuestionsStream();
      this.app.startQuestionStatusStream();
      this.app.startScheduleMetadataStreams();
      this.app.fetchDictionary().catch((error) => {
        console.error("辞書の取得に失敗しました", error);
      });
      this.app.startDictionaryListener();
      this.app.startPickupListener();
      this.app.startSideTelopListener();
      // 初期化時にchannelAssignmentをクリアして、古い割り当て情報が表示されないようにする
      if (this.app.state) {
        this.app.state.channelAssignment = null;
      }
      this.app.startDisplaySessionMonitor();
      this.app.startDisplayPresenceMonitor();
      this.app.fetchLogs().catch((error) => {
        console.error("ログの取得に失敗しました", error);
      });
      this.app.finishLoaderSteps("準備完了");
      this.app.hideLoader();
      this.app.toggleDictionaryDrawer(!!this.app.preferredDictionaryOpen, false);
      this.app.toggleLogsDrawer(!!this.app.preferredLogsOpen, false);
      this.app.toast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.app.startLogsUpdateMonitor();
      this.app.resolveEmbedReady();
    } catch (error) {
      this.app.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.app.hideLoader();
    }
  }

  /**
   * 現在のユーザーが内部スタッフに登録されているかチェックし、未登録の場合はモーダルを表示します。
   * @param {import("firebase/auth").User} user
   */
  async checkInternalStaffRegistration(user) {
    try {
      const userEmail = String(user?.email || "").trim().toLowerCase();
      if (!userEmail) {
        return;
      }

      // すべてのイベントを取得
      const eventsSnapshot = await get(glIntakeEventsRef);
      const events = eventsSnapshot.val() || {};
      const eventIds = Object.keys(events).filter((id) => id && String(id).trim());

      if (eventIds.length === 0) {
        // イベントが存在しない場合はスキップ
        return;
      }

      // 各イベントの内部スタッフリストをチェック
      let isRegistered = false;
      for (const eventId of eventIds) {
        try {
          const applicationsRef = getGlApplicationsRef(eventId);
          const applicationsSnapshot = await get(applicationsRef);
          const applications = applicationsSnapshot.val() || {};
          
          // 内部スタッフ（sourceType: "internal"）でメールアドレスが一致するものを探す
          const found = Object.values(applications).some((app) => {
            if (!app || typeof app !== "object") return false;
            const appEmail = String(app.email || "").trim().toLowerCase();
            const sourceType = String(app.sourceType || "").trim();
            return sourceType === "internal" && appEmail === userEmail;
          });

          if (found) {
            isRegistered = true;
            break;
          }
        } catch (error) {
          // 個別のイベントチェックでエラーが発生しても続行
          console.warn(`Failed to check internal staff for event ${eventId}:`, error);
        }
      }

      // 未登録の場合はモーダルを表示
      if (!isRegistered) {
        // EventAdminAppにアクセス（operator.htmlはeventsページに埋め込まれている）
        const eventAdminApp = typeof window !== "undefined" ? window.eventAdminApp : null;
        if (eventAdminApp && typeof eventAdminApp.showInternalStaffRegistrationModal === "function") {
          // 次のイベントループで実行して、EventAdminAppの初期化が完了していることを確認
          // requestAnimationFrameを使用してDOMの準備が完了してから実行
          requestAnimationFrame(() => {
            if (eventAdminApp && typeof eventAdminApp.showInternalStaffRegistrationModal === "function") {
              eventAdminApp.showInternalStaffRegistrationModal(user, eventIds).catch((error) => {
                console.warn("Failed to show internal staff registration modal:", error);
              });
            }
          });
        }
      }
    } catch (error) {
      // 内部スタッフ登録チェックでエラーが発生してもログイン処理は続行
      console.warn("Failed to check internal staff registration:", error);
    }
  }

  /**
   * ログイン済みユーザー向けにUIを初期化し、必要な購読を開始します。
   * @param {import("firebase/auth").User} user
   * @returns {Promise<void>}
   */
  async renderLoggedInUi(user) {
    const previousUid = String(this.app.operatorIdentity?.uid || "").trim();
    const nextUid = String(user?.uid || "").trim();
    const wasAuthorized = this.app.isAuthorized === true;
    this.app.redirectingToIndex = false;
    this.app.operatorIdentity = {
      uid: nextUid,
      email: String(user?.email || "").trim(),
      displayName: String(user?.displayName || "").trim()
    };
    if (this.app.dom.loginContainer) this.app.dom.loginContainer.style.display = "none";
    if (this.app.dom.mainContainer) {
      this.app.dom.mainContainer.style.display = "";
      this.app.dom.mainContainer.hidden = false;
    }
    if (this.app.dom.actionPanel) {
      this.app.dom.actionPanel.style.display = "flex";
      this.app.dom.actionPanel.hidden = false;
    }
    const userChanged = !wasAuthorized || !previousUid || previousUid !== nextUid;
    this.app.isAuthorized = true;
    if (userChanged) {
      this.app.operatorMode = OPERATOR_MODE_TELOP;
      this.app.stopOperatorPresenceHeartbeat();
      this.app.operatorPresenceSyncQueued = false;
      this.app.operatorPresenceEntryKey = "";
      this.app.operatorPresenceEntryRef = null;
      this.app.operatorPresenceLastSignature = "";
      this.app.operatorPresenceSessionId = this.app.generatePresenceSessionId();
      this.app.operatorPresencePrimedEventId = "";
      this.app.operatorPresencePrimePromise = null;
      this.app.operatorPresencePrimeTargetEventId = "";
      await this.app.purgeOperatorPresenceSessionsForUser(nextUid, {
        excludeSessionId: String(this.app.operatorPresenceSessionId || "")
      });
      if (this.app.state) {
        this.app.state.operatorPresenceEventId = "";
        this.app.state.operatorPresenceByUser = new Map();
        this.app.state.operatorPresenceSelf = null;
      }
      this.app.resetPageContextSelection();
      if (this.app.pageContext && typeof this.app.pageContext === "object") {
        this.app.pageContext.operatorMode = OPERATOR_MODE_TELOP;
      }
      this.app.applyContextToState();
      if (typeof this.app.clearOperatorPresenceIntent === "function") {
        this.app.clearOperatorPresenceIntent();
      }
      Questions.updateScheduleContext(this.app, {
        syncPresence: false,
        trackIntent: false,
        presenceReason: "context-reset",
        selectionConfirmed: false,
        presenceOptions: {
          allowFallback: false,
          publishSchedule: false,
          publishEvent: false,
          useActiveSchedule: false
        }
      });
      this.app.renderChannelBanner();
      this.app.evaluateScheduleConflict();
    }
    if (this.app.dom.userInfo) {
      this.app.dom.userInfo.innerHTML = "";
      const label = document.createElement("span");
      label.className = "user-label";
      const safeDisplayName = String(user.displayName || "").trim();
      const safeEmail = String(user.email || "").trim();
      label.textContent = safeDisplayName && safeEmail ? `${safeDisplayName} (${safeEmail})` : safeDisplayName || safeEmail || "";
      const logoutButton = document.createElement("button");
      logoutButton.id = "logout-button";
      logoutButton.type = "button";
      logoutButton.textContent = "ログアウト";
      logoutButton.className = "btn btn-ghost btn-sm";
      logoutButton.addEventListener("click", () => this.logout());
      this.app.dom.userInfo.append(label, logoutButton);
      this.app.dom.userInfo.hidden = false;
    }
    if (this.app.pendingExternalContext) {
      const pendingContext = this.app.pendingExternalContext;
      this.app.pendingExternalContext = null;
      this.app.setExternalContext(pendingContext);
    }
    this.app.applyPreferredSubTab();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const activeEventId = String(
      this.app.state?.activeEventId || (contextConfirmed ? context.eventId : "") || ""
    ).trim();
    if (this.app.operatorPresencePrimedEventId && this.app.operatorPresencePrimedEventId !== activeEventId) {
      this.app.operatorPresencePrimedEventId = "";
    }
    this.app.primeOperatorPresenceSession(activeEventId).finally(() => this.app.syncOperatorPresence());
  }

  /**
   * ログアウト状態のUIを表示します。
   */
  showLoggedOutState() {
    if (this.app.redirectingToIndex) {
      return;
    }
    const ensureString = (value) => String(value ?? "").trim();
    const previousUid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
    const sessionId = ensureString(this.app.operatorPresenceSessionId);
    if (previousUid) {
      this.app.purgeOperatorPresenceSessionsForUser(previousUid, { excludeSessionId: sessionId });
    }
    this.app.isAuthorized = false;
    this.app.operatorIdentity = { uid: "", email: "", displayName: "" };
    this.app.dictionaryLoaded = false;
    this.app.toggleDictionaryDrawer(false, false);
    this.app.toggleLogsDrawer(false, false);
    this.app.cleanupRealtime();
    if (this.app.isEmbedded) {
      this.app.showLoader("サインイン状態を確認しています…");
    } else {
      this.app.hideLoader();
    }
    this.app.closeEditDialog();
    if (this.app.dom.loginContainer) {
      this.app.dom.loginContainer.style.display = this.app.isEmbedded ? "none" : "";
    }
    if (!this.app.isEmbedded && this.app.dom.loginButton) {
      this.app.dom.loginButton.disabled = false;
    }
    if (this.app.dom.mainContainer) {
      this.app.dom.mainContainer.style.display = "none";
    }
    if (this.app.dom.actionPanel) {
      this.app.dom.actionPanel.style.display = "none";
      this.app.dom.actionPanel.hidden = true;
    }
    if (this.app.dom.userInfo) {
      this.app.dom.userInfo.hidden = true;
      this.app.dom.userInfo.innerHTML = "";
    }
    if (typeof window !== "undefined" && !this.app.isEmbedded) {
      this.app.redirectingToIndex = true;
      goToLogin();
    }
  }
}

