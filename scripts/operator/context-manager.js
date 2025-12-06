// context-manager.js: ページコンテキストと外部コンテキストの管理を担当します。
import { parseChannelParams, normalizeScheduleId } from "../shared/channel-paths.js";
import { OPERATOR_MODE_TELOP, normalizeOperatorMode } from "../shared/operator-modes.js";
import { derivePresenceScheduleKey as sharedDerivePresenceScheduleKey } from "../shared/presence-keys.js";
import { auth } from "./firebase.js";

/**
 * コンテキスト管理クラス
 * ページコンテキスト（URLパラメータ）と外部コンテキスト（埋め込み環境）の管理を行います。
 */
export class ContextManager {
  constructor(app) {
    this.app = app;
  }

  /**
   * URLクエリや埋め込み設定からイベント/日程情報を解析し、ページコンテキストとして返却します。
   * エラーに強い実装とし、欠落値には空文字を設定します。
   * @returns {{ eventId: string, scheduleId: string, eventName: string, scheduleLabel: string, startAt: string, endAt: string, scheduleKey: string, operatorMode: string }}
   */
  extractPageContext() {
    const context = {
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      scheduleKey: "",
      operatorMode: OPERATOR_MODE_TELOP
    };
    if (typeof window === "undefined") {
      return context;
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      const channel = parseChannelParams(params);
      context.eventId = channel.eventId || "";
      context.scheduleId = channel.scheduleId || "";
      context.eventName = String(params.get("eventName") ?? "").trim();
      context.scheduleLabel = String(params.get("scheduleLabel") ?? params.get("scheduleName") ?? "").trim();
      context.startAt = String(params.get("startAt") ?? params.get("scheduleStart") ?? params.get("start") ?? "").trim();
      context.endAt = String(params.get("endAt") ?? params.get("scheduleEnd") ?? params.get("end") ?? "").trim();
      const rawScheduleKey = String(params.get("scheduleKey") ?? "").trim();
      context.scheduleKey = this.app.derivePresenceScheduleKey(
        context.eventId,
        {
          scheduleKey: rawScheduleKey,
          scheduleId: context.scheduleId,
          scheduleLabel: context.scheduleLabel
        }
      );
      const hasInitialSelection = Boolean(context.eventId || context.scheduleId || context.scheduleKey);
      if (hasInitialSelection) {
        context.selectionConfirmed = false;
      }
    } catch (error) {
      // Ignore malformed page context payloads.
    }
    return context;
  }

  /**
   * ページ読み込み時に抽出した文脈情報をアプリケーションのstateに反映します。
   * URL指定のチャンネルが存在する場合にはローカルstateの選択肢として保持します。
   */
  applyContextToState() {
    if (!this.app.state) return;
    const context = this.app.pageContext || {};
    const selectionConfirmed = context.selectionConfirmed === true;
    const scheduleKey = this.app.derivePresenceScheduleKey(
      context.eventId,
      {
        scheduleKey: context.scheduleKey,
        scheduleId: context.scheduleId,
        scheduleLabel: context.scheduleLabel
      }
    );
    const committedScheduleKey = this.app.derivePresenceScheduleKey(
      context.eventId,
      {
        scheduleKey: context.committedScheduleKey,
        scheduleId: context.committedScheduleId,
        scheduleLabel: context.committedScheduleLabel
      }
    );
    this.app.state.activeEventId = selectionConfirmed ? context.eventId || "" : "";
    this.app.state.activeScheduleId = selectionConfirmed ? context.scheduleId || "" : "";
    this.app.state.activeEventName = selectionConfirmed ? context.eventName || "" : "";
    this.app.state.activeScheduleLabel = selectionConfirmed ? context.scheduleLabel || "" : "";
    this.app.state.selectionConfirmed = selectionConfirmed;
    this.app.state.committedScheduleId = context.committedScheduleId || "";
    this.app.state.committedScheduleLabel = context.committedScheduleLabel || "";
    this.app.state.committedScheduleKey = committedScheduleKey;
    if (selectionConfirmed && committedScheduleKey) {
      this.app.state.currentSchedule = committedScheduleKey;
      this.app.state.lastNormalSchedule = committedScheduleKey;
    } else if (selectionConfirmed && scheduleKey) {
      this.app.state.currentSchedule = scheduleKey;
      this.app.state.lastNormalSchedule = scheduleKey;
    } else if (!selectionConfirmed) {
      this.app.state.currentSchedule = "";
      this.app.state.lastNormalSchedule = "";
    }
    this.app.state.operatorMode = this.app.operatorMode;
  }

  /**
   * 画面コンテキストに保持しているイベント/日程選択情報を初期状態へ戻します。
   * 既存のその他のメタデータは維持しつつ、selectionConfirmedをfalseに戻します。
   */
  resetPageContextSelection() {
    let baseContext = {};
    if (this.app.pageContext && typeof this.app.pageContext === "object") {
      baseContext = { ...this.app.pageContext };
    } else if (this.app.initialPageContext && typeof this.app.initialPageContext === "object") {
      baseContext = { ...this.app.initialPageContext };
    }
    const normalizedMode = normalizeOperatorMode(baseContext.operatorMode ?? this.app.operatorMode);
    this.app.pageContext = {
      ...baseContext,
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      scheduleKey: "",
      committedScheduleId: "",
      committedScheduleLabel: "",
      committedScheduleKey: "",
      selectionConfirmed: false,
      operatorMode: normalizedMode || OPERATOR_MODE_TELOP
    };
    if (this.app.state) {
      this.app.state.selectionConfirmed = false;
      // 前回の選択情報をクリア
      this.app.state.activeEventId = "";
      this.app.state.activeScheduleId = "";
      this.app.state.activeEventName = "";
      this.app.state.activeScheduleLabel = "";
      this.app.state.currentSchedule = "";
      this.app.state.lastNormalSchedule = "";
      // channelAssignmentもクリアして、古い割り当て情報が表示されないようにする
      this.app.state.channelAssignment = null;
    }
  }

  /**
   * 埋め込み環境などから渡された外部コンテキストをstateに適用します。
   * 受領直後にpresence同期と表示の更新を実行します。
   * @param {Record<string, any>} context
   */
  setExternalContext(context = {}) {
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[setExternalContext] Called", {
        eventId: context.eventId || "(empty)",
        scheduleId: context.scheduleId || "(empty)",
        selectionConfirmed: context.selectionConfirmed,
        committedScheduleId: context.committedScheduleId || "(empty)",
        stack: new Error().stack
      });
    }
    const ensureString = (value) => String(value ?? "").trim();
    const ownerUid = ensureString(context.ownerUid || context.operatorUid || context.uid);
    if (ownerUid) {
      const currentUid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
      if (!currentUid) {
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[setExternalContext] Early return: no currentUid, storing as pending", {
            ownerUid,
            hasOperatorIdentity: !!this.app.operatorIdentity,
            hasAuthCurrentUser: !!auth.currentUser
          });
        }
        this.app.pendingExternalContext = { ...context };
        return;
      }
      if (ownerUid !== currentUid) {
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[setExternalContext] Early return: ownerUid mismatch", {
            ownerUid,
            currentUid
          });
        }
        return;
      }
    }
    const eventId = ensureString(context.eventId);
    const scheduleId = ensureString(context.scheduleId);
    const eventName = ensureString(context.eventName);
    const scheduleLabel = ensureString(context.scheduleLabel);
    const committedScheduleId = ensureString(context.committedScheduleId);
    const committedScheduleLabel = ensureString(context.committedScheduleLabel);
    const committedScheduleKey = ensureString(context.committedScheduleKey);
    const startAt = ensureString(context.startAt);
    const endAt = ensureString(context.endAt);
    const scheduleKeyFromContext = ensureString(context.scheduleKey);
    const presenceEntryId = ensureString(context.presenceEntryId || context.entryId || context.sessionId);
    const scheduleKey = this.app.derivePresenceScheduleKey(
      eventId,
      { scheduleKey: scheduleKeyFromContext, scheduleId, scheduleLabel },
      presenceEntryId
    );
    const resolvedCommittedKey = this.app.derivePresenceScheduleKey(
      eventId,
      {
        scheduleKey: committedScheduleKey,
        scheduleId: committedScheduleId,
        scheduleLabel: committedScheduleLabel
      },
      presenceEntryId
    );
    const operatorMode = normalizeOperatorMode(context.operatorMode ?? context.mode);

    this.app.clearOperatorPresenceIntent();

    const selectionConfirmed = context.selectionConfirmed === true;
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[setExternalContext] Selection state", {
        selectionConfirmed,
        eventId: eventId || "(empty)",
        scheduleId: scheduleId || "(empty)",
        committedScheduleId: committedScheduleId || "(empty)"
      });
    }
    const effectiveEventId = selectionConfirmed ? eventId : "";
    const baseContext = { ...(this.app.pageContext || {}) };
    if (!selectionConfirmed) {
      baseContext.eventId = "";
      baseContext.scheduleId = "";
      baseContext.eventName = "";
      baseContext.scheduleLabel = "";
      baseContext.startAt = "";
      baseContext.endAt = "";
      baseContext.scheduleKey = "";
      baseContext.committedScheduleId = "";
      baseContext.committedScheduleLabel = "";
      baseContext.committedScheduleKey = "";
    }

    this.app.pageContext = {
      ...baseContext,
      eventId: selectionConfirmed ? eventId : "",
      scheduleId: selectionConfirmed ? scheduleId : "",
      eventName: selectionConfirmed ? eventName : "",
      scheduleLabel: selectionConfirmed ? scheduleLabel : "",
      committedScheduleId: selectionConfirmed ? committedScheduleId : "",
      committedScheduleLabel: selectionConfirmed ? committedScheduleLabel : "",
      committedScheduleKey: selectionConfirmed ? resolvedCommittedKey : "",
      startAt: selectionConfirmed ? startAt : "",
      endAt: selectionConfirmed ? endAt : "",
      scheduleKey: selectionConfirmed ? scheduleKey : "",
      operatorMode,
      selectionConfirmed
    };

    this.app.operatorMode = operatorMode;

    this.applyContextToState();

    if (!this.app.state.scheduleMetadata || !(this.app.state.scheduleMetadata instanceof Map)) {
      this.app.state.scheduleMetadata = new Map();
    }

    if (scheduleKey) {
      this.app.state.scheduleMetadata.set(scheduleKey, {
        key: scheduleKey,
        eventId,
        scheduleId,
        eventName,
        label: scheduleLabel || scheduleId,
        startAt,
        endAt
      });
    }
    if (resolvedCommittedKey) {
      this.app.state.scheduleMetadata.set(resolvedCommittedKey, {
        key: resolvedCommittedKey,
        eventId,
        scheduleId: committedScheduleId,
        eventName,
        label: committedScheduleLabel || committedScheduleId,
        startAt,
        endAt
      });
    }

    if (this.app.isAuthorized) {
      if (this.app.dom.mainContainer) {
        this.app.dom.mainContainer.style.display = "";
        this.app.dom.mainContainer.hidden = false;
      }
      if (this.app.dom.actionPanel) {
        this.app.dom.actionPanel.style.display = "flex";
        this.app.dom.actionPanel.hidden = false;
      }
    }

    if (this.app.isAuthorized && typeof this.app.queueOperatorPresenceSync === "function") {
      this.app.queueOperatorPresenceSync();
    }

    if (typeof this.app.updateScheduleContext === "function") {
      this.app.updateScheduleContext({ force: true });
    }

    if (typeof this.app.renderChannelBanner === "function") {
      this.app.renderChannelBanner();
    }
  }

  /**
   * アプリケーションの初期化が完了するまで待機します。
   * 埋め込み環境で使用されます。
   * @returns {Promise<void>}
   */
  waitUntilReady() {
    if (this.app.isAuthorized) {
      return Promise.resolve();
    }
    if (this.app.embedReadyDeferred?.promise) {
      return this.app.embedReadyDeferred.promise;
    }
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    this.app.embedReadyDeferred = { promise, resolve };
    return promise;
  }
}

