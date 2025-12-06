// ui-renderer.js: イベント管理画面のUI描画を担当します。
// サマリー表示、アクションパネル状態、選択ノート、チャットインジケーターなどのUI更新を管理します。

import { formatParticipantCount, ensureString } from "../helpers.js";
import { formatScheduleRange } from "../../operator/utils.js";

/**
 * UI描画クラス
 * EventAdminApp からUI描画機能を分離したモジュール
 */
export class EventUIRenderer {
  constructor(app) {
    this.app = app;
  }

  /**
   * イベントサマリーを更新します。
   */
  updateEventSummary() {
    const event = this.app.getSelectedEvent();
    if (this.app.dom.eventSummaryName) {
      this.app.dom.eventSummaryName.textContent = event ? event.name || event.id : "—";
    }
    if (this.app.dom.eventSummarySchedules) {
      if (event) {
        const count = typeof event.scheduleCount === "number" ? event.scheduleCount : (event.schedules?.length || 0);
        this.app.dom.eventSummarySchedules.textContent = `${count}件`;
      } else {
        this.app.dom.eventSummarySchedules.textContent = "—";
      }
    }
    if (this.app.dom.eventSummaryParticipants) {
      this.app.dom.eventSummaryParticipants.textContent = event
        ? formatParticipantCount(event.totalParticipants)
        : "—";
    }
    this.app.updateStageHeader();
    this.syncOperatorModeUi();
  }

  /**
   * スケジュールサマリーを更新します。
   */
  updateScheduleSummary() {
    if (!this.app.dom.scheduleSummary) return;

    const event = this.app.getSelectedEvent();
    const schedule = this.app.getSelectedSchedule();
    const hasSchedule = Boolean(event && schedule);
    const hasSelection = Boolean(this.app.selectedScheduleId);
    this.app.dom.scheduleSummary.hidden = !hasSchedule;
    if (this.app.dom.scheduleSummaryEmpty) {
      const shouldHidePlaceholder = hasSchedule || hasSelection;
      this.app.dom.scheduleSummaryEmpty.hidden = shouldHidePlaceholder;
      this.app.dom.scheduleSummaryEmpty.classList.toggle("is-hidden", shouldHidePlaceholder);
      if (!shouldHidePlaceholder) {
        this.app.dom.scheduleSummaryEmpty.textContent = event
          ? "日程を選択してください。"
          : "イベントを選択してください。";
      }
    }
    this.app.updateStageHeader();
    if (!hasSchedule) {
      return;
    }
    if (this.app.dom.scheduleSummaryLabel) {
      this.app.dom.scheduleSummaryLabel.textContent = schedule.label || schedule.id;
    }
    const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
    if (this.app.dom.scheduleSummaryRangeRow && this.app.dom.scheduleSummaryRange) {
      if (rangeText) {
        this.app.dom.scheduleSummaryRangeRow.hidden = false;
        this.app.dom.scheduleSummaryRange.textContent = rangeText;
      } else {
        this.app.dom.scheduleSummaryRangeRow.hidden = true;
        this.app.dom.scheduleSummaryRange.textContent = "";
      }
    }
    const locationText = ensureString(schedule.location).trim();
    if (this.app.dom.scheduleSummaryLocationRow && this.app.dom.scheduleSummaryLocation) {
      if (locationText) {
        this.app.dom.scheduleSummaryLocationRow.hidden = false;
        this.app.dom.scheduleSummaryLocation.textContent = locationText;
      } else {
        this.app.dom.scheduleSummaryLocationRow.hidden = true;
        this.app.dom.scheduleSummaryLocation.textContent = "";
      }
    }
    this.syncOperatorModeUi();
  }

  /**
   * 選択ノートを更新します。
   */
  updateSelectionNotes() {
    if (this.app.dom.eventSelectionNote) {
      const shouldShow = !this.app.selectedEventId && this.app.events.length > 0;
      this.app.dom.eventSelectionNote.hidden = !shouldShow;
    }
    if (this.app.dom.scheduleSelectionNote) {
      const shouldShow = Boolean(this.app.selectedEventId) && !this.app.selectedScheduleId && this.app.schedules.length > 0;
      this.app.dom.scheduleSelectionNote.hidden = !shouldShow;
    }
  }

  /**
   * イベントアクションパネルの状態を更新します。
   */
  updateEventActionPanelState() {
    const selected = this.app.getSelectedEvent();
    const batchIds = Array.from(this.app.eventBatchSet);
    const hasBatch = batchIds.length > 0;
    const panel = this.app.dom.eventActionPanel;
    if (panel) {
      panel.hidden = false;
      panel.classList.toggle("is-idle", !selected && !hasBatch);
    }
    if (this.app.dom.eventEditButton) {
      this.app.dom.eventEditButton.disabled = !selected || hasBatch;
    }
    if (this.app.dom.eventDeleteButton) {
      this.app.dom.eventDeleteButton.disabled = !selected || hasBatch;
    }
    if (this.app.dom.eventBatchDeleteButton) {
      this.app.dom.eventBatchDeleteButton.hidden = !hasBatch;
      this.app.dom.eventBatchDeleteButton.disabled = !hasBatch;
    }
    if (this.app.dom.eventSelectedInfo) {
      if (hasBatch) {
        this.app.dom.eventSelectedInfo.textContent = `${batchIds.length}件を選択中`;
      } else if (selected) {
        this.app.dom.eventSelectedInfo.textContent = selected.name || selected.id;
      } else {
        this.app.dom.eventSelectedInfo.textContent = "イベントを選択してください";
      }
    }
  }

  /**
   * スケジュールアクションパネルの状態を更新します。
   */
  updateScheduleActionPanelState() {
    const selected = this.app.getSelectedSchedule();
    const batchIds = Array.from(this.app.scheduleBatchSet);
    const hasBatch = batchIds.length > 0;
    const panel = this.app.dom.scheduleActionPanel;
    if (panel) {
      panel.hidden = false;
      panel.classList.toggle("is-idle", !selected && !hasBatch);
    }
    if (this.app.dom.scheduleEditButton) {
      this.app.dom.scheduleEditButton.disabled = !selected || hasBatch;
    }
    if (this.app.dom.scheduleDeleteButton) {
      this.app.dom.scheduleDeleteButton.disabled = !selected || hasBatch;
    }
    if (this.app.dom.scheduleBatchDeleteButton) {
      this.app.dom.scheduleBatchDeleteButton.hidden = !hasBatch;
      this.app.dom.scheduleBatchDeleteButton.disabled = !hasBatch;
    }
    if (this.app.dom.scheduleSelectedInfo) {
      if (hasBatch) {
        this.app.dom.scheduleSelectedInfo.textContent = `${batchIds.length}件を選択中`;
      } else if (selected) {
        this.app.dom.scheduleSelectedInfo.textContent = selected.label || selected.id;
      } else {
        this.app.dom.scheduleSelectedInfo.textContent = "日程を選択してください";
      }
    }
  }

  /**
   * オペレーターモードUIを同期します。
   */
  syncOperatorModeUi() {
    const hasEvent = Boolean(this.app.selectedEventId);
    if (this.app.dom.eventSummaryActions) {
      this.app.dom.eventSummaryActions.hidden = !hasEvent;
    }
    const copyButton = this.app.dom.eventSummaryCopyButton;
    if (copyButton) {
      const hasEventSelection = Boolean(this.app.selectedEventId);
      copyButton.disabled = !hasEventSelection;
      if (!hasEventSelection) {
        copyButton.classList.remove("is-success", "is-error");
        const defaultLabel = copyButton.dataset.defaultLabel || "表示URLをコピー";
        copyButton.textContent = defaultLabel;
        if (this.app.displayUrlCopyTimer) {
          clearTimeout(this.app.displayUrlCopyTimer);
          this.app.displayUrlCopyTimer = 0;
        }
        if (this.app.dom.eventSummaryCopyStatus) {
          this.app.dom.eventSummaryCopyStatus.textContent = "";
        }
      }
    }
    const gotoScheduleButton = this.app.dom.eventSummaryGotoScheduleButton;
    if (gotoScheduleButton) {
      gotoScheduleButton.disabled = !this.app.selectedEventId;
    }
  }

  /**
   * チャットインジケーターを更新します。
   */
  refreshChatIndicators() {
    this.refreshMobileChatIndicator();
    this.refreshDesktopChatIndicator();
  }

  /**
   * デスクトップチャットインジケーターを更新します。
   */
  refreshDesktopChatIndicator() {
    const container = this.app.dom.chatContainer;
    const indicator = this.app.dom.chatAttention;
    const countNode = this.app.dom.chatAttentionCount;
    const textNode = this.app.dom.chatAttentionText;
    const hasAttention = this.app.hasChatAttention();
    const count = this.app.chatUnreadCount || 0;

    if (container) {
      if (hasAttention) {
        container.setAttribute("data-has-updates", "true");
      } else {
        container.removeAttribute("data-has-updates");
      }
    }

    if (indicator) {
      if (hasAttention) {
        indicator.hidden = false;
      } else {
        indicator.hidden = true;
      }
    }

    if (countNode) {
      countNode.textContent = hasAttention ? (count > 99 ? "99+" : String(count)) : "";
    }

    if (textNode) {
      if (hasAttention) {
        const announce = count > 99 ? "99件以上" : `${count}件`;
        textNode.textContent = `新着メッセージが${announce}あります`;
      } else {
        textNode.textContent = "";
      }
    }
  }

  /**
   * モバイルチャットインジケーターを更新します。
   */
  refreshMobileChatIndicator() {
    const button = this.app.dom.chatMobileToggle;
    const badge = this.app.dom.chatMobileBadge;
    const srText = this.app.dom.chatMobileBadgeText;
    const count = this.app.chatUnreadCount || 0;
    const hasAttention = this.app.hasChatAttention();
    const isMobile = this.app.isMobileLayout();
    const isChatOpen = this.app.activeMobilePanel === "chat";
    const shouldShow = isMobile && !isChatOpen && hasAttention;

    if (button) {
      if (shouldShow) {
        button.setAttribute("data-has-updates", "true");
      } else {
        button.removeAttribute("data-has-updates");
      }
    }

    if (badge) {
      if (shouldShow) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.removeAttribute("hidden");
      } else {
        badge.textContent = "";
        badge.setAttribute("hidden", "");
      }
    }

    if (srText) {
      if (hasAttention) {
        const announce = count > 99 ? "99件以上" : `${count}件`;
        srText.textContent = `新着メッセージが${announce}あります`;
      } else {
        srText.textContent = "";
      }
    }
  }

  /**
   * メタノートを適用します。
   */
  applyMetaNote() {
    if (!this.app.dom.metaNote) {
      return;
    }
    const note = (this.app.eventCountNote || "").trim();
    if (!note) {
      this.app.dom.metaNote.hidden = true;
      this.app.dom.metaNote.textContent = "";
      return;
    }
    this.app.dom.metaNote.hidden = false;
    this.app.dom.metaNote.textContent = note;
  }

  /**
   * イベント選択キューを表示します。
   */
  revealEventSelectionCue() {
    if (this.app.dom.eventSelectionNote) {
      this.app.dom.eventSelectionNote.hidden = false;
      this.app.dom.eventSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.app.dom.eventSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.app.dom.eventList) {
      this.app.dom.eventList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /**
   * スケジュール選択キューを表示します。
   */
  revealScheduleSelectionCue() {
    if (this.app.dom.scheduleSelectionNote) {
      this.app.dom.scheduleSelectionNote.hidden = false;
      this.app.dom.scheduleSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.app.dom.scheduleSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.app.dom.scheduleList) {
      this.app.dom.scheduleList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

