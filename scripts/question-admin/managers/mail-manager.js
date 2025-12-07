// mail-manager.js: メール送信機能のマネージャークラス
// 参加者への案内メール送信機能を担当します。

import { normalizeKey } from "../utils.js";
import {
  isMailDeliveryPending,
  resolveParticipantUid,
  signatureForEntries,
  snapshotParticipantList
} from "../participants.js";

/**
 * メール送信機能のマネージャークラス
 * QuestionAdminApp からメール送信機能を分離したモジュール
 */
export class MailManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.api = context.api;
    this.setUploadStatus = context.setUploadStatus;
    this.getSelectionRequiredMessage = context.getSelectionRequiredMessage;
    this.renderParticipants = context.renderParticipants;
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.setActionButtonState = context.setActionButtonState;
    this.confirmAction = context.confirmAction;
    
    // 内部状態
    this.mailActionButtonMissingLogged = false;
    this.lastMailActionStateSignature = "";
    
    // 定数
    this.MAIL_LOG_ENABLED = false;
    this.MAIL_LOG_OUTPUT_ENABLED = false;
    this.MAIL_LOG_PREFIX = "[Mail]";
  }

  /**
   * メール送信ログ（情報）
   * @param {string} message - メッセージ
   * @param {Object} details - 詳細情報
   */
  logMailInfo(message, details) {
    if (!this.MAIL_LOG_ENABLED || !this.MAIL_LOG_OUTPUT_ENABLED) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    const log = typeof console.info === "function" ? console.info.bind(console) : console.log.bind(console);
    if (details !== undefined) {
      log(`${this.MAIL_LOG_PREFIX} ${message}`, details);
    } else {
      log(`${this.MAIL_LOG_PREFIX} ${message}`);
    }
  }

  /**
   * メール送信ログ（警告）
   * @param {string} message - メッセージ
   * @param {Object} details - 詳細情報
   */
  logMailWarn(message, details) {
    if (!this.MAIL_LOG_ENABLED || !this.MAIL_LOG_OUTPUT_ENABLED) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    const log = typeof console.warn === "function" ? console.warn.bind(console) : console.log.bind(console);
    if (details !== undefined) {
      log(`${this.MAIL_LOG_PREFIX} ${message}`, details);
    } else {
      log(`${this.MAIL_LOG_PREFIX} ${message}`);
    }
  }

  /**
   * メール送信ログ（エラー）
   * @param {string} message - メッセージ
   * @param {Error} error - エラーオブジェクト
   * @param {Object} details - 詳細情報
   */
  logMailError(message, error, details) {
    if (!this.MAIL_LOG_ENABLED || !this.MAIL_LOG_OUTPUT_ENABLED) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    const log = typeof console.error === "function" ? console.error.bind(console) : console.log.bind(console);
    if (details !== undefined) {
      log(`${this.MAIL_LOG_PREFIX} ${message}`, error, details);
    } else if (error !== undefined) {
      log(`${this.MAIL_LOG_PREFIX} ${message}`, error);
    } else {
      log(`${this.MAIL_LOG_PREFIX} ${message}`);
    }
  }

  /**
   * 送信待ちの参加者数を取得
   * @returns {number}
   */
  getPendingMailCount() {
    if (!this.state.participants || !this.state.participants.length) {
      return 0;
    }
    return this.state.participants.filter(entry => isMailDeliveryPending(entry)).length;
  }

  /**
   * メールアクションボタンの状態を同期
   */
  syncMailActionState() {
    const button = this.dom.sendMailButton;
    if (!button) {
      if (!this.mailActionButtonMissingLogged) {
        this.mailActionButtonMissingLogged = true;
        this.logMailWarn("send-mail-button が見つからないため、メールアクションの状態を同期できませんでした。");
      }
      return;
    }
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "参加者へ案内メール送信";
    }

    const hasSelection = Boolean(this.state.selectedEventId && this.state.selectedScheduleId);
    const hasParticipantsWithEmail = hasSelection
      ? this.state.participants.some(entry => String(entry?.email || "").trim())
      : false;
    const pendingCount = hasSelection ? this.getPendingMailCount() : 0;
    const disabled =
      this.state.mailSending ||
      this.state.saving ||
      !hasSelection ||
      !hasParticipantsWithEmail ||
      pendingCount === 0;

    this.setActionButtonState(button, disabled);

    if (this.state.mailSending) {
      button.textContent = "メール送信中…";
      button.setAttribute("aria-busy", "true");
    } else {
      const baseLabel = button.dataset.defaultLabel || "参加者へ案内メール送信";
      button.textContent = pendingCount > 0 ? `${baseLabel}（${pendingCount}件）` : baseLabel;
      button.removeAttribute("aria-busy");
    }

    button.dataset.pendingCount = String(pendingCount);

    const signature = JSON.stringify({
      hasSelection,
      hasParticipantsWithEmail,
      pendingCount,
      mailSending: this.state.mailSending,
      disabled
    });
    if (signature !== this.lastMailActionStateSignature) {
      this.lastMailActionStateSignature = signature;
      this.logMailInfo("メールアクションの状態を更新しました", {
        hasSelection,
        hasParticipantsWithEmail,
        pendingCount,
        mailSending: this.state.mailSending,
        disabled
      });
    }
  }

  /**
   * メール送信結果メッセージを生成
   * @param {Object} options - オプション
   * @param {number} options.sent - 送信成功数
   * @param {number} options.failed - 送信失敗数
   * @param {number} options.skippedMissingEmail - メールアドレス未設定でスキップした数
   * @param {number} options.skippedAlreadySent - 送信済みでスキップした数
   * @returns {string}
   */
  buildMailStatusMessage({
    sent = 0,
    failed = 0,
    skippedMissingEmail = 0,
    skippedAlreadySent = 0
  } = {}) {
    const parts = [];
    if (sent > 0) {
      parts.push(`${sent}件のメールを送信しました。`);
    }
    if (failed > 0) {
      parts.push(`${failed}件でエラーが発生しました。`);
    }
    if (skippedMissingEmail > 0) {
      parts.push(`${skippedMissingEmail}件はメールアドレス未設定のため除外しました。`);
    }
    if (skippedAlreadySent > 0) {
      parts.push(`${skippedAlreadySent}件は送信済みのためスキップしました。`);
    }
    if (!parts.length) {
      const message = "送信対象の参加者が見つかりませんでした。";
      this.logMailInfo("メール送信結果メッセージを生成しました", {
        sent,
        failed,
        skippedMissingEmail,
        skippedAlreadySent,
        message
      });
      return message;
    }
    const message = parts.join(" ");
    this.logMailInfo("メール送信結果メッセージを生成しました", {
      sent,
      failed,
      skippedMissingEmail,
      skippedAlreadySent,
      message
    });
    return message;
  }

  /**
   * メール送信結果を状態に適用
   * @param {Array} results - メール送信結果の配列
   * @returns {number} 適用した件数
   */
  applyMailSendResults(results = []) {
    const count = Array.isArray(results) ? results.length : 0;
    this.logMailInfo("メール送信結果の適用を開始します", { count });
    if (!Array.isArray(results) || !results.length) {
      this.logMailInfo("適用可能なメール送信結果がありません");
      this.syncMailActionState();
      return 0;
    }

    const hadUnsavedChangesBefore = this.hasUnsavedChanges();
    const resultMap = new Map();
    results.forEach(item => {
      const key = normalizeKey(item?.participantId || item?.uid || "");
      if (!key) {
        return;
      }
      resultMap.set(key, {
        mailStatus: item.mailStatus,
        mailSentAt: item.mailSentAt,
        mailError: item.mailError,
        mailLastSubject: item.mailLastSubject,
        mailLastMessageId: item.mailLastMessageId,
        mailSentBy: item.mailSentBy,
        mailLastAttemptAt: item.mailLastAttemptAt,
        mailLastAttemptBy: item.mailLastAttemptBy
      });
    });

    if (!resultMap.size) {
      this.logMailInfo("適用すべきメール送信結果がありませんでした");
      this.syncMailActionState();
      return 0;
    }

    let updatedCount = 0;
    const updatedRowKeys = new Set();
    const updatedParticipantKeys = new Set();
    this.state.participants = this.state.participants.map(entry => {
      const key = resolveParticipantUid(entry) || String(entry.participantId || "").trim();
      if (!key || !resultMap.has(key)) {
        return entry;
      }
      const patch = resultMap.get(key);
      const nextEntry = { ...entry };

      if (patch.mailStatus !== undefined) {
        nextEntry.mailStatus = String(patch.mailStatus || "");
      }
      if (patch.mailSentAt !== undefined) {
        const value = Number(patch.mailSentAt);
        if (Number.isFinite(value) && value >= 0) {
          nextEntry.mailSentAt = value;
        }
      }
      if (patch.mailError !== undefined) {
        nextEntry.mailError = String(patch.mailError || "");
      }
      if (patch.mailLastSubject !== undefined) {
        nextEntry.mailLastSubject = String(patch.mailLastSubject || "");
      }
      if (patch.mailLastMessageId !== undefined) {
        nextEntry.mailLastMessageId = String(patch.mailLastMessageId || "");
      }
      if (patch.mailSentBy !== undefined) {
        nextEntry.mailSentBy = String(patch.mailSentBy || "");
      }
      if (patch.mailLastAttemptAt !== undefined) {
        const attemptValue = Number(patch.mailLastAttemptAt);
        if (Number.isFinite(attemptValue) && attemptValue >= 0) {
          nextEntry.mailLastAttemptAt = attemptValue;
        }
      }
      if (patch.mailLastAttemptBy !== undefined) {
        nextEntry.mailLastAttemptBy = String(patch.mailLastAttemptBy || "");
      }

      updatedCount += 1;
      updatedParticipantKeys.add(key);
      const rowKey = String(nextEntry.rowKey || entry.rowKey || "");
      if (rowKey) {
        updatedRowKeys.add(rowKey);
      }
      return nextEntry;
    });

    if (updatedCount > 0) {
      if (!hadUnsavedChangesBefore) {
        this.captureParticipantBaseline(this.state.participants);
      } else {
        if (Array.isArray(this.state.savedParticipantEntries) && this.state.savedParticipantEntries.length) {
          const baselineByParticipant = new Map();
          const baselineByRowKey = new Map();
          this.state.savedParticipantEntries.forEach(entry => {
            const participantKey =
              resolveParticipantUid(entry) || String(entry.participantId || "").trim();
            const rowKey = String(entry?.rowKey || "");
            if (participantKey) {
              baselineByParticipant.set(participantKey, entry);
            }
            if (rowKey) {
              baselineByRowKey.set(rowKey, entry);
            }
          });
          updatedParticipantKeys.forEach(key => {
            const baseline = baselineByParticipant.get(key);
            const patch = resultMap.get(key);
            if (!baseline || !patch) {
              return;
            }
            if (patch.mailStatus !== undefined) {
              baseline.mailStatus = String(patch.mailStatus || "");
            }
            if (patch.mailSentAt !== undefined) {
              const value = Number(patch.mailSentAt);
              if (Number.isFinite(value) && value >= 0) {
                baseline.mailSentAt = value;
              }
            }
            if (patch.mailError !== undefined) {
              baseline.mailError = String(patch.mailError || "");
            }
            if (patch.mailLastSubject !== undefined) {
              baseline.mailLastSubject = String(patch.mailLastSubject || "");
            }
            if (patch.mailLastMessageId !== undefined) {
              baseline.mailLastMessageId = String(patch.mailLastMessageId || "");
            }
            if (patch.mailSentBy !== undefined) {
              baseline.mailSentBy = String(patch.mailSentBy || "");
            }
            if (patch.mailLastAttemptAt !== undefined) {
              const attemptValue = Number(patch.mailLastAttemptAt);
              if (Number.isFinite(attemptValue) && attemptValue >= 0) {
                baseline.mailLastAttemptAt = attemptValue;
              }
            }
            if (patch.mailLastAttemptBy !== undefined) {
              baseline.mailLastAttemptBy = String(patch.mailLastAttemptBy || "");
            }
          });
          this.state.lastSavedSignature = signatureForEntries(this.state.savedParticipantEntries);

          if (
            Array.isArray(this.state.savedParticipants) &&
            this.state.savedParticipants.length &&
            updatedRowKeys.size
          ) {
            this.state.savedParticipants = this.state.savedParticipants.map(snapshot => {
              const rowKey = String(snapshot?.rowKey || "");
              if (!rowKey || !updatedRowKeys.has(rowKey)) {
                return snapshot;
              }
              const baseline = baselineByRowKey.get(rowKey);
              if (!baseline) {
                return snapshot;
              }
              const [nextSnapshot] = snapshotParticipantList([baseline]);
              return nextSnapshot || snapshot;
            });
          }
        }
      }
    }

    this.renderParticipants();
    this.syncMailActionState();
    this.logMailInfo("メール送信結果の適用が完了しました", {
      updatedCount,
      totalParticipants: this.state.participants.length
    });
    return updatedCount;
  }

  /**
   * 参加者へのメール送信を実行
   * @returns {Promise<void>}
   */
  async handleSendParticipantMail() {
    const eventId = this.state.selectedEventId ? String(this.state.selectedEventId) : "";
    const scheduleId = this.state.selectedScheduleId ? String(this.state.selectedScheduleId) : "";
    if (!eventId || !scheduleId) {
      this.logMailWarn("メール送信を開始できません。イベントまたは日程が未選択です。", {
        eventId,
        scheduleId
      });
      this.setUploadStatus(this.getSelectionRequiredMessage("メールを送信するには"), "error");
      this.syncMailActionState();
      return;
    }

    const pendingCount = this.getPendingMailCount();
    this.logMailInfo("送信対象の参加者数を集計しました", {
      eventId,
      scheduleId,
      pendingCount
    });
    if (pendingCount === 0) {
      this.logMailWarn("送信対象の参加者が見つかりませんでした", {
        eventId,
        scheduleId
      });
      this.setUploadStatus("送信対象の参加者が見つかりません。", "error");
      this.syncMailActionState();
      return;
    }

    this.state.mailSending = true;
    this.syncMailActionState();
    this.setUploadStatus("メール送信を開始しています…");
    this.logMailInfo("参加者メール送信処理を開始します", {
      eventId,
      scheduleId,
      pendingCount
    });

    try {
      this.logMailInfo("Apps Script にメール送信リクエストを送信します", {
        eventId,
        scheduleId
      });
      const response = await this.api.apiPost({
        action: "sendParticipantMail",
        eventId,
        scheduleId
      });
      const summary = response?.summary || {};
      const results = Array.isArray(response?.results) ? response.results : [];
      const messageText = String(response?.message || "").trim();
      this.logMailInfo("メール送信APIから応答を受信しました", {
        eventId,
        scheduleId,
        summary: {
          total: Number(summary.total || 0),
          sent: Number(summary.sent || 0),
          failed: Number(summary.failed || 0),
          skippedMissingEmail: Number(summary.skippedMissingEmail || 0),
          skippedAlreadySent: Number(summary.skippedAlreadySent || 0)
        },
        resultsCount: results.length
      });

      const appliedCount = this.applyMailSendResults(results);
      this.logMailInfo("メール送信結果を状態に反映しました", {
        eventId,
        scheduleId,
        appliedCount
      });

      const sent = Number(summary.sent || 0);
      const failed = Number(summary.failed || 0);
      const skippedMissingEmail = Number(summary.skippedMissingEmail || 0);
      const skippedAlreadySent = Number(summary.skippedAlreadySent || 0);
      const statusMessage =
        messageText ||
        this.buildMailStatusMessage({ sent, failed, skippedMissingEmail, skippedAlreadySent });
      const variant = failed > 0 ? "error" : sent > 0 ? "success" : "info";
      this.setUploadStatus(statusMessage, variant === "info" ? "" : variant);
      this.logMailInfo("メール送信処理が完了しました", {
        eventId,
        scheduleId,
        sent,
        failed,
        skippedMissingEmail,
        skippedAlreadySent,
        statusMessage,
        variant
      });
    } catch (error) {
      this.logMailError("メール送信リクエストでエラーが発生しました", error, {
        eventId,
        scheduleId
      });
      console.error(error);
      this.setUploadStatus(error?.message || "メール送信に失敗しました。", "error");
    } finally {
      this.state.mailSending = false;
      this.syncMailActionState();
      this.logMailInfo("メール送信処理を終了しました", {
        eventId,
        scheduleId
      });
    }
  }
}

