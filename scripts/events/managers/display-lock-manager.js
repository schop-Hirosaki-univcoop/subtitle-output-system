// display-lock-manager.js: イベント管理画面のディスプレイロック機能を担当します。
// ディスプレイのチャンネル固定リクエスト、再試行、タイマー管理などを管理します。

import { ensureString, logError } from "../helpers.js";

const DISPLAY_LOCK_REASONS = new Set([
  "schedule-commit",
  "navigation",
  "consensus-submit",
  "consensus-apply",
  "consensus-align",
  "consensus-follow"
]);
const DISPLAY_LOCK_RETRY_DELAY_MS = 5_000;
const DISPLAY_LOCK_RETRY_LIMIT = 6;

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
 * ディスプレイロック機能を管理するクラス
 */
export class DisplayLockManager {
  /**
   * @param {object} app - EventAdminApp インスタンス
   */
  constructor(app) {
    this.app = app;
    this.pendingDisplayLockRequest = null;
    this.displayLockRetryTimer = 0;
  }

  /**
   * 指定された理由で自動ロックを実行すべきか判定します。
   * @param {string} reason - ロック理由
   * @returns {boolean}
   */
  shouldAutoLockDisplaySchedule(reason = "") {
    const normalized = ensureString(reason);
    return DISPLAY_LOCK_REASONS.has(normalized);
  }

  /**
   * ディスプレイのチャンネル固定を要求します。
   * @param {string} scheduleId - スケジュールID
   * @param {object} options - オプション
   * @param {object|null} options.schedule - スケジュールオブジェクト
   * @param {string} options.reason - ロック理由
   * @returns {Promise<boolean>}
   */
  async requestDisplayScheduleLock(scheduleId, { schedule = null, reason = "" } = {}) {
    const eventId = ensureString(this.app.selectedEventId);
    const normalizedScheduleId = ensureString(scheduleId);
    if (!eventId || !normalizedScheduleId) {
      this.app.logFlowState("ディスプレイ固定リクエストをスキップします", {
        reason,
        eventId,
        scheduleId: normalizedScheduleId
      });
      this.clearPendingDisplayLock();
      return false;
    }
    if (!this.app.api) {
      this.app.logFlowState("API未初期化のためディスプレイ固定リクエストをスキップします", {
        reason,
        eventId,
        scheduleId: normalizedScheduleId
      });
      this.clearPendingDisplayLock();
      return false;
    }
    const scheduleLabel =
      ensureString(schedule?.label) || ensureString(this.app.hostCommittedScheduleLabel) || normalizedScheduleId;
    const operatorName =
      ensureString(this.app.currentUser?.displayName) || ensureString(this.app.currentUser?.email) || "";
    try {
      await this.app.api.apiPost({
        action: "lockDisplaySchedule",
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        operatorName
      });
      this.app.logFlowState("ディスプレイのチャンネル固定を要求しました", {
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        reason
      });
      this.clearPendingDisplayLock();
      return true;
    } catch (error) {
      this.app.logFlowState("ディスプレイのチャンネル固定に失敗しました", {
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        reason,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
      logError("Failed to lock display schedule", error);
      this.scheduleDisplayLockRetry(normalizedScheduleId, { schedule, reason });
      return false;
    }
  }

  /**
   * ディスプレイ固定の自動リクエストを開始します（再試行機能付き）。
   * @param {string} scheduleId - スケジュールID
   * @param {object} options - オプション
   * @param {object|null} options.schedule - スケジュールオブジェクト
   * @param {string} options.reason - ロック理由
   */
  requestDisplayScheduleLockWithRetry(scheduleId, { schedule = null, reason = "" } = {}) {
    const eventId = ensureString(this.app.selectedEventId);
    const normalizedScheduleId = ensureString(scheduleId);
    if (!eventId || !normalizedScheduleId) {
      this.clearPendingDisplayLock();
      return;
    }
    const attempt = {
      eventId,
      scheduleId: normalizedScheduleId,
      reason: ensureString(reason),
      schedule: schedule || null,
      attempts: 0
    };
    this.pendingDisplayLockRequest = attempt;
    this.clearDisplayLockRetryTimer();
    this.app.logFlowState("ディスプレイ固定の自動リクエストを開始します", {
      eventId,
      scheduleId: normalizedScheduleId,
      reason: ensureString(reason)
    });
    void this.performDisplayLockAttempt();
  }

  /**
   * ディスプレイ固定の試行を実行します。
   * @returns {Promise<void>}
   */
  async performDisplayLockAttempt() {
    const pending = this.pendingDisplayLockRequest;
    if (!pending) {
      return;
    }
    const eventId = ensureString(this.app.selectedEventId);
    const committedScheduleId = ensureString(this.app.hostCommittedScheduleId);
    if (!eventId || !committedScheduleId || committedScheduleId !== pending.scheduleId) {
      this.clearPendingDisplayLock();
      return;
    }
    const scheduleForLock =
      pending.schedule || this.app.schedules.find((item) => item.id === pending.scheduleId) || null;
    const success = await this.requestDisplayScheduleLock(pending.scheduleId, {
      schedule: scheduleForLock,
      reason: pending.reason
    });
    if (success) {
      return;
    }
    const attempts = Number(pending.attempts || 0) + 1;
    pending.attempts = attempts;
    if (attempts >= DISPLAY_LOCK_RETRY_LIMIT) {
      this.app.logFlowState("ディスプレイ固定の自動再試行を終了します", {
        eventId,
        scheduleId: pending.scheduleId,
        reason: pending.reason,
        attempts
      });
      this.clearPendingDisplayLock();
      return;
    }
  }

  /**
   * ディスプレイ固定の再試行をスケジュールします。
   * @param {string} scheduleId - スケジュールID
   * @param {object} options - オプション
   * @param {object|null} options.schedule - スケジュールオブジェクト
   * @param {string} options.reason - ロック理由
   */
  scheduleDisplayLockRetry(scheduleId, { schedule = null, reason = "" } = {}) {
    const pending = this.pendingDisplayLockRequest;
    const eventId = ensureString(this.app.selectedEventId);
    const committedScheduleId = ensureString(this.app.hostCommittedScheduleId);
    if (!eventId || !committedScheduleId || committedScheduleId !== ensureString(scheduleId)) {
      this.clearPendingDisplayLock();
      return;
    }
    if (!pending) {
      this.pendingDisplayLockRequest = {
        eventId,
        scheduleId: ensureString(scheduleId),
        reason: ensureString(reason),
        schedule: schedule || null,
        attempts: 0
      };
    }
    const timerHost = getTimerHost();
    this.clearDisplayLockRetryTimer();
    this.displayLockRetryTimer = timerHost.setTimeout(() => {
      this.displayLockRetryTimer = 0;
      void this.performDisplayLockAttempt();
    }, DISPLAY_LOCK_RETRY_DELAY_MS);
    this.app.logFlowState("ディスプレイ固定を再試行します", {
      eventId,
      scheduleId: ensureString(scheduleId),
      reason: ensureString(reason),
      attempts: this.pendingDisplayLockRequest?.attempts || 0
    });
  }

  /**
   * ディスプレイ固定の再試行タイマーをクリアします。
   */
  clearDisplayLockRetryTimer() {
    if (!this.displayLockRetryTimer) {
      return;
    }
    const timerHost = getTimerHost();
    timerHost.clearTimeout(this.displayLockRetryTimer);
    this.displayLockRetryTimer = 0;
  }

  /**
   * 保留中のディスプレイ固定リクエストをクリアします。
   */
  clearPendingDisplayLock() {
    this.pendingDisplayLockRequest = null;
    this.clearDisplayLockRetryTimer();
  }

  /**
   * クリーンアップ処理を実行します。
   */
  cleanup() {
    this.clearPendingDisplayLock();
  }
}

