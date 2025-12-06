// state-manager.js: イベント管理画面の状態管理を担当します。
// イベント・日程の選択状態、リスナー管理、選択コンテキストの構築を管理します。

import { ensureString } from "../helpers.js";
import { logError } from "../helpers.js";

/**
 * 状態管理クラス
 * EventAdminApp から状態管理機能を分離したモジュール
 */
export class EventStateManager {
  constructor(app) {
    this.app = app;
    
    // 状態管理関連のプロパティ
    this.events = [];
    this.selectedEventId = "";
    this.eventBatchSet = new Set();
    this.schedules = [];
    this.selectedScheduleId = "";
    this.scheduleBatchSet = new Set();
    this.selectionListeners = new Set();
    this.eventListeners = new Set();
    this.suppressSelectionNotifications = false;
    this.lastSelectionSignature = "";
    this.lastSelectionSource = "";
    this.forceSelectionBroadcast = true;
    this.participantHostInterface = null;
  }

  /**
   * 選択リスナーを追加します。
   * @param {Function} listener
   * @returns {Function} リスナーを削除する関数
   */
  addSelectionListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.selectionListeners.add(listener);
    this.forceSelectionBroadcast = true;
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  /**
   * イベントリスナーを追加します。
   * @param {Function} listener
   * @returns {Function} リスナーを削除する関数
   */
  addEventListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * 選択リスナーに通知します。
   * @param {string} source
   */
  notifySelectionListeners(source = "host") {
    if (this.suppressSelectionNotifications) {
      this.app.logParticipantAction("選択通知は抑制設定のため送信しません", { source });
      return;
    }
    const detail = { ...this.getCurrentSelectionContext(), source };
    const signature = [
      detail.eventId,
      detail.scheduleId,
      detail.eventName,
      detail.scheduleLabel,
      detail.startAt,
      detail.endAt
    ].join("::");
    if (
      !this.forceSelectionBroadcast &&
      signature === this.lastSelectionSignature &&
      source === this.lastSelectionSource
    ) {
      this.app.logParticipantAction("前回と同じ内容のため選択通知を省略しました", detail);
      return;
    }
    this.lastSelectionSignature = signature;
    this.lastSelectionSource = source;
    this.forceSelectionBroadcast = false;
    this.app.logParticipantAction("選択内容をリスナーに通知します", detail);
    this.selectionListeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        logError("Selection listener failed", error);
      }
    });
  }

  /**
   * イベントリスナーに通知します。
   */
  notifyEventListeners() {
    const snapshot = this.getParticipantEventsSnapshot();
    this.eventListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        logError("Event listener failed", error);
      }
    });
  }

  /**
   * 現在の選択コンテキストを取得します。
   * @returns {object}
   */
  getCurrentSelectionContext() {
    const event = this.app.getSelectedEvent();
    const selectedSchedule = this.app.getSelectedSchedule();
    const committedScheduleId = ensureString(this.app.hostCommittedScheduleId);
    const committedScheduleLabel = ensureString(this.app.hostCommittedScheduleLabel);
    const committedSchedule = committedScheduleId ? this.app.getCommittedSchedule() : null;
    const schedule = selectedSchedule || committedSchedule || null;
    const fallbackScheduleId = ensureString(this.selectedScheduleId) || committedScheduleId;
    const scheduleId = ensureString(schedule?.id) || fallbackScheduleId;
    const scheduleLabel = ensureString(schedule?.label) || committedScheduleLabel || scheduleId;
    const startAt = ensureString(schedule?.startAt) || ensureString(committedSchedule?.startAt);
    const endAt = ensureString(schedule?.endAt) || ensureString(committedSchedule?.endAt);
    const location = ensureString(schedule?.location) || ensureString(committedSchedule?.location);
    const committedScheduleKey = committedScheduleId
      ? this.app.derivePresenceScheduleKey(
          ensureString(event?.id || ""),
          { scheduleId: committedScheduleId, scheduleLabel: committedScheduleLabel },
          ensureString(this.app.hostPresenceSessionId)
        )
      : "";
    const scheduleKey = this.app.derivePresenceScheduleKey(
      ensureString(event?.id || ""),
      { scheduleId, scheduleLabel },
      ensureString(this.app.hostPresenceSessionId)
    );
    return {
      eventId: event?.id || "",
      eventName: event?.name || event?.id || "",
      scheduleId,
      scheduleLabel,
      startAt,
      endAt,
      location,
      operatorMode: this.app.operatorMode,
      committedScheduleId,
      committedScheduleLabel,
      committedScheduleKey,
      scheduleKey
    };
  }

  /**
   * 参加者イベントスナップショットを取得します。
   * @returns {Array}
   */
  getParticipantEventsSnapshot() {
    return this.events.map((event) => ({
      ...event,
      schedules: Array.isArray(event.schedules)
        ? event.schedules.map((schedule) => ({ ...schedule }))
        : []
    }));
  }

  /**
   * 参加者からの選択を適用します。
   * @param {object} detail
   */
  applySelectionFromParticipant(detail = {}) {
    const eventId = ensureString(detail?.eventId);
    const scheduleId = ensureString(detail?.scheduleId);
    const previousSuppression = this.suppressSelectionNotifications;
    this.suppressSelectionNotifications = true;
    this.app.logParticipantAction("参加者ツールからの選択反映リクエストを受け取りました", {
      eventId,
      scheduleId,
      source: detail?.source || "participants"
    });
    try {
      if (eventId || (!eventId && detail?.eventId === "")) {
        this.app.selectEvent(eventId);
      }
      if (scheduleId || (!scheduleId && detail?.scheduleId === "")) {
        this.app.selectSchedule(scheduleId);
      }
    } finally {
      this.suppressSelectionNotifications = previousSuppression;
    }
    this.notifySelectionListeners(detail?.source || "participants");
  }

  /**
   * 参加者ホストインターフェースを取得します。
   * @returns {object}
   */
  getParticipantHostInterface() {
    if (!this.participantHostInterface) {
      this.app.logParticipantAction("参加者ツール用ホストインターフェースを初期化します");
      this.participantHostInterface = {
        getSelection: () => this.getCurrentSelectionContext(),
        getEvents: () => this.getParticipantEventsSnapshot(),
        subscribeSelection: (listener) => this.addSelectionListener(listener),
        subscribeEvents: (listener) => this.addEventListener(listener),
        setSelection: (detail) => this.applySelectionFromParticipant(detail || {})
      };
    }
    return this.participantHostInterface;
  }

  /**
   * フロー状態を構築します。
   * @returns {object}
   */
  buildFlowState() {
    const event = this.app.getSelectedEvent();
    const schedule = this.app.getSelectedSchedule();
    const presence = this.app.operatorPresenceEntries.map((entry) => ({
      entryId: entry.entryId,
      uid: entry.uid,
      displayName: entry.displayName,
      scheduleId: entry.scheduleId,
      scheduleKey: entry.scheduleKey,
      scheduleLabel: entry.scheduleLabel,
      isSelf: Boolean(entry.isSelf),
      mode: entry.mode,
      updatedAt: entry.updatedAt
    }));
    const conflict = this.app.scheduleConflictContext
      ? {
          eventId: this.app.scheduleConflictContext.eventId,
          hasConflict: this.app.scheduleConflictContext.hasConflict,
          hasOtherOperators: this.app.scheduleConflictContext.hasOtherOperators,
          hostScheduleId: this.app.scheduleConflictContext.hostScheduleId,
          hostScheduleKey: this.app.scheduleConflictContext.hostScheduleKey,
          defaultKey: this.app.scheduleConflictContext.defaultKey,
          options: this.app.scheduleConflictContext.options.map((option) => ({
            key: option.key,
            scheduleId: option.scheduleId,
            scheduleLabel: option.scheduleLabel,
            scheduleRange: option.scheduleRange,
            containsSelf: option.containsSelf,
            memberCount: option.members?.length || 0
          }))
        }
      : null;
    return {
      stage: this.app.stage,
      activePanel: this.app.activePanel,
      pendingNavigationTarget: this.app.pendingNavigationTarget || "",
      operatorMode: this.app.operatorMode,
      currentUser: this.app.currentUser
        ? {
            uid: this.app.currentUser.uid || "",
            displayName: this.app.currentUser.displayName || "",
            email: this.app.currentUser.email || ""
          }
        : null,
      selectedEvent: event
        ? {
            id: event.id,
            name: event.name || "",
            scheduleCount: Array.isArray(event.schedules) ? event.schedules.length : 0
          }
        : null,
      selectedSchedule: schedule
        ? {
            id: schedule.id,
            label: schedule.label || "",
            startAt: schedule.startAt || "",
            endAt: schedule.endAt || ""
          }
        : null,
      operatorPresenceEventId: this.app.operatorPresenceEventId || "",
      operatorPresence: presence,
      scheduleConflict: conflict
    };
  }

  /**
   * 状態をリセットします。
   */
  resetState() {
    this.events = [];
    this.selectedEventId = "";
    this.eventBatchSet.clear();
    this.schedules = [];
    this.selectedScheduleId = "";
    this.scheduleBatchSet.clear();
    this.forceSelectionBroadcast = true;
    this.suppressSelectionNotifications = false;
    this.lastSelectionSignature = "";
    this.lastSelectionSource = "";
    this.selectionListeners.clear();
    this.eventListeners.clear();
    this.participantHostInterface = null;
  }

  /**
   * クリーンアップ処理を行います。
   */
  cleanup() {
    this.selectionListeners.clear();
    this.eventListeners.clear();
    this.participantHostInterface = null;
  }
}

