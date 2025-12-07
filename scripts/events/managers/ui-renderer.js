// ui-renderer.js: イベント管理画面のUI描画を担当します。
// サマリー表示、アクションパネル状態、選択ノート、チャットインジケーターなどのUI更新を管理します。

import { formatParticipantCount, ensureString } from "../helpers.js";
import { formatScheduleRange } from "../../operator/utils.js";
import { OPERATOR_MODE_SUPPORT } from "../../shared/operator-modes.js";
import { normalizeScheduleId } from "../../shared/channel-paths.js";

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

  /**
   * スケジュールコンフリクトコンテキストを構築します。
   * @returns {Object} スケジュールコンフリクトコンテキスト
   */
  buildScheduleConflictContext() {
    const event = this.app.getSelectedEvent();
    const eventId = event?.id || "";
    const context = {
      eventId,
      entries: [],
      options: [],
      selectableOptions: [],
      hasConflict: false,
      hasOtherOperators: false,
      hostScheduleId: "",
      hostScheduleKey: "",
      hostScheduleLabel: "",
      defaultKey: "",
      signature: ""
    };
    
    if (!eventId) {
      return context;
    }

    const scheduleMap = new Map(this.app.schedules.map((schedule) => [schedule.id, schedule]));
    const selfUid = ensureString(this.app.currentUser?.uid);
    const selfLabel = ensureString(this.app.currentUser?.displayName) || ensureString(this.app.currentUser?.email) || "あなた";
    
    // Firebase関連の処理をEventFirebaseManagerに委譲
    const { entries, hasSelfPresence } = this.app.firebaseManager.buildPresenceEntries(
      eventId,
      scheduleMap,
      selfUid
    );
    
    const hostContext = this.app.firebaseManager.resolveHostScheduleContext(eventId, { scheduleMap });
    const hostScheduleId = ensureString(hostContext.scheduleId);
    const hostScheduleKey = ensureString(hostContext.scheduleKey);
    const hostScheduleLabel = ensureString(hostContext.scheduleLabel);
    const hostScheduleRange = ensureString(hostContext.scheduleRange);
    const hostSchedule = hostContext.schedule || (hostScheduleId ? scheduleMap.get(hostScheduleId) || null : null);
    const committedScheduleId = ensureString(this.app.hostCommittedScheduleId);
    const committedSchedule = committedScheduleId ? scheduleMap.get(committedScheduleId) || null : null;
    const committedScheduleLabel = ensureString(this.app.hostCommittedScheduleLabel) || committedSchedule?.label || committedScheduleId;
    const committedScheduleRange = committedSchedule
      ? formatScheduleRange(committedSchedule.startAt, committedSchedule.endAt)
      : "";

    // 自己エントリの更新
    const selfEntry = entries.find((entry) => entry.isSelf);
    if (selfEntry) {
      selfEntry.scheduleId = hostScheduleId;
      if (hostScheduleKey) {
        selfEntry.scheduleKey = hostScheduleKey;
      }
      selfEntry.scheduleLabel = hostScheduleLabel || hostScheduleId || "未選択";
      selfEntry.scheduleRange = hostScheduleRange || selfEntry.scheduleRange || "";
      selfEntry.selectedScheduleId = ensureString(hostContext.selectedScheduleId);
      selfEntry.selectedScheduleLabel = ensureString(hostContext.selectedScheduleLabel);
    }

    context.hostScheduleId = hostScheduleId;
    context.hostScheduleKey = hostScheduleKey;
    context.hostScheduleLabel = hostScheduleLabel;
    context.hostScheduleRange = hostScheduleRange;
    context.hostSelectedScheduleId = ensureString(hostContext.selectedScheduleId);
    context.hostCommittedScheduleId = ensureString(hostContext.committedScheduleId);
    context.telopScheduleId = committedScheduleId;
    context.telopScheduleLabel = committedScheduleLabel;
    context.telopScheduleRange = committedScheduleRange;

    // 自己プレゼンスがない場合の追加
    if (!hasSelfPresence && hostScheduleId) {
      entries.push({
        entryId: selfUid ? `self::${selfUid}` : "self",
        uid: selfUid,
        displayName: selfLabel,
        scheduleId: hostScheduleId,
        scheduleKey: hostScheduleKey || hostScheduleId,
        scheduleLabel: hostScheduleLabel || hostScheduleId || "未選択",
        scheduleRange: hostScheduleRange || formatScheduleRange(hostSchedule?.startAt, hostSchedule?.endAt),
        isSelf: true,
        mode: this.app.operatorMode,
        skipTelop: this.app.operatorMode === OPERATOR_MODE_SUPPORT,
        selectedScheduleId: ensureString(hostContext.selectedScheduleId),
        selectedScheduleLabel: ensureString(hostContext.selectedScheduleLabel),
        updatedAt: Date.now()
      });
    }

    // エントリのソート
    entries.sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      return (a.displayName || "").localeCompare(b.displayName || "", "ja");
    });

    const telopEntries = entries.filter((entry) => ensureString(entry.scheduleId) && !entry.skipTelop);
    context.entries = telopEntries;
    context.allEntries = entries;

    // グループ化とオプションの構築
    const groups = new Map();
    entries.forEach((entry) => {
      const key = entry.scheduleKey || "";
      const existing = groups.get(key) || {
        key,
        scheduleId: entry.scheduleId || "",
        scheduleLabel: entry.scheduleLabel || "未選択",
        scheduleRange: entry.scheduleRange || "",
        members: [],
        telopMembers: []
      };
      if (!groups.has(key)) {
        groups.set(key, existing);
      }
      if (!existing.scheduleId && entry.scheduleId) {
        existing.scheduleId = entry.scheduleId;
      }
      if (!existing.scheduleLabel && entry.scheduleLabel) {
        existing.scheduleLabel = entry.scheduleLabel;
      }
      if (!existing.scheduleRange && entry.scheduleRange) {
        existing.scheduleRange = entry.scheduleRange;
      }
      existing.members.push(entry);
      if (!entry.skipTelop && ensureString(entry.scheduleId)) {
        existing.telopMembers.push(entry);
      }
    });

    const options = Array.from(groups.values())
      .filter((group) => group.telopMembers && group.telopMembers.length > 0)
      .map((group) => {
        const derivedScheduleId = group.scheduleId || this.app.firebaseManager.extractScheduleIdFromKey(group.key, eventId) || "";
        const schedule = derivedScheduleId ? scheduleMap.get(derivedScheduleId) : null;
        const scheduleId = schedule?.id || derivedScheduleId || "";
        const scheduleLabel = group.scheduleLabel || schedule?.label || scheduleId || "未選択";
        const scheduleRange = group.scheduleRange || formatScheduleRange(schedule?.startAt, schedule?.endAt);
        const containsSelf = group.telopMembers.some((member) => member.isSelf);
        return {
          key: group.key,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          members: group.members,
          containsSelf,
          isSelectable: Boolean(scheduleId)
        };
      });

    options.sort((a, b) => {
      if (a.containsSelf && !b.containsSelf) return -1;
      if (!a.containsSelf && b.containsSelf) return 1;
      return (a.scheduleLabel || "").localeCompare(b.scheduleLabel || "", "ja");
    });

    const selectableOptions = options.filter((option) => option.scheduleId);
    context.options = selectableOptions;
    context.hasOtherOperators = telopEntries.some((entry) => !entry.isSelf);
    context.selectableOptions = selectableOptions;

    // コンフリクトの検出
    const telopScheduleId = committedScheduleId;
    const conflictingTelopEntries = telopEntries.filter((entry) => {
      const entryScheduleId = ensureString(entry.scheduleId);
      return Boolean(telopScheduleId && entryScheduleId && entryScheduleId !== telopScheduleId);
    }));
    context.hasConflict = Boolean(telopScheduleId) && conflictingTelopEntries.length > 0;

    // デフォルトキーの設定
    const preferredOption =
      selectableOptions.find((option) => option.containsSelf) || selectableOptions[0] || null;
    context.defaultKey = preferredOption?.key || "";

    // シグネチャの生成
    const signatureSource = telopEntries.length ? telopEntries : entries;
    const signatureParts = signatureSource.map((entry) => {
      const entryId = entry.uid || entry.entryId || "anon";
      const scheduleKey = entry.scheduleKey || "none";
      return `${entryId}::${scheduleKey}`;
    });
    signatureParts.sort();
    const baseSignature = signatureParts.join("|") || "none";
    context.signature = `${eventId || "event"}::${baseSignature}`;

    return context;
  }

  /**
   * スケジュールコンフリクトプロンプトの状態を同期します。
   * @param {Object} context - スケジュールコンフリクトコンテキスト（オプション）
   */
  syncScheduleConflictPromptState(context = null) {
    const button = this.app.dom.scheduleNextButton;
    if (!button) {
      return;
    }
    const resolvedContext = context || this.app.scheduleConflictContext || this.buildScheduleConflictContext();
    const contextSignature = ensureString(resolvedContext?.signature);
    const pendingSignature = ensureString(this.app.scheduleConflictPromptSignature);
    const hasConflict = Boolean(resolvedContext?.hasConflict);
    const hasResolvedKey = Boolean(this.app.scheduleConsensusLastKey);
    const shouldIndicate =
      hasConflict &&
      pendingSignature &&
      contextSignature &&
      contextSignature === pendingSignature &&
      !hasResolvedKey;
    
    if (shouldIndicate) {
      if (!Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        button.dataset.conflictOriginalTitle = button.getAttribute("title") || "";
      }
      button.setAttribute("data-conflict-pending", "true");
      button.setAttribute(
        "title",
        "他のオペレーターと日程の調整が必要です。「確定」で日程を確定してください。"
      );
    } else {
      button.removeAttribute("data-conflict-pending");
      if (Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        const original = button.dataset.conflictOriginalTitle || "";
        if (original) {
          button.setAttribute("title", original);
        } else {
          button.removeAttribute("title");
        }
        delete button.dataset.conflictOriginalTitle;
      }
    }
  }

  /**
   * スケジュールコンフリクト状態を更新します。
   */
  updateScheduleConflictState() {
    const context = this.buildScheduleConflictContext();
    this.app.scheduleConflictContext = context;
    if (this.app.isScheduleConflictDialogOpen()) {
      this.app.renderScheduleConflictDialog(context);
    }
    this.enforceScheduleConflictState(context);
    this.syncScheduleConflictPromptState(context);
  }

  /**
   * スケジュールコンフリクト状態を強制適用します。
   * @param {Object} context - スケジュールコンフリクトコンテキスト（オプション）
   */
  enforceScheduleConflictState(context = null) {
    const hasConflict = Boolean(context?.hasConflict);
    const suppressOnce = this.app.suppressScheduleConflictPromptOnce;
    if (suppressOnce) {
      this.app.suppressScheduleConflictPromptOnce = false;
    }
    if (!hasConflict) {
      if (this.app.isScheduleConflictDialogOpen()) {
        if (this.app.dom.scheduleConflictForm) {
          this.app.dom.scheduleConflictForm.reset();
        }
        this.app.closeDialog(this.app.dom.scheduleConflictDialog);
      }
      this.app.scheduleConflictLastSignature = "";
      this.app.scheduleConflictPromptSignature = "";
      this.app.scheduleConflictLastPromptSignature = "";
      this.app.maybeClearScheduleConsensus(context);
      return;
    }
    const signature = ensureString(context?.signature);
    this.app.scheduleConflictLastSignature = signature;
    const hasSelection = Boolean(this.app.selectedScheduleId);
    const shouldPromptDueToNavigation = Boolean(this.app.pendingNavigationTarget);
    const shouldPromptDueToConflict =
      !shouldPromptDueToNavigation &&
      hasSelection &&
      signature &&
      signature !== this.app.scheduleConflictLastPromptSignature;
    if (suppressOnce) {
      if (signature) {
        this.app.scheduleConflictLastPromptSignature = signature;
      }
      return;
    }
    if (!this.app.isScheduleConflictDialogOpen()) {
      if (shouldPromptDueToNavigation && hasSelection) {
        this.app.openScheduleConflictDialog(context, {
          reason: "presence",
          originPanel: this.app.activePanel,
          target: this.app.pendingNavigationTarget || this.app.activePanel
        });
      } else if (shouldPromptDueToConflict) {
        this.app.openScheduleConflictDialog(context, {
          reason: "presence-auto",
          originPanel: this.app.activePanel,
          target: this.app.activePanel
        });
      }
    } else if (shouldPromptDueToConflict && signature) {
      this.app.scheduleConflictLastPromptSignature = signature;
    }
  }

  /**
   * スケジュールコンフリクトダイアログを開きます。
   * @param {Object} context - スケジュールコンフリクトコンテキスト（オプション）
   * @param {Object} meta - メタ情報（reason, originPanel, targetなど）
   */
  openScheduleConflictDialog(context = null, meta = {}) {
    if (!this.app.dom.scheduleConflictDialog) {
      return;
    }
    if (!context) {
      context = this.buildScheduleConflictContext();
      this.app.scheduleConflictContext = context;
    }
    const { reason = "unspecified", originPanel = "", target = "" } = meta || {};
    this.app.renderScheduleConflictDialog(context);
    this.app.clearScheduleConflictError();
    const signature = ensureString(context?.signature);
    if (signature) {
      this.app.scheduleConflictLastPromptSignature = signature;
    }
    const wasOpen = this.app.isScheduleConflictDialogOpen();
    if (!wasOpen) {
      this.app.openDialog(this.app.dom.scheduleConflictDialog);
      this.app.logFlowState("スケジュール確認モーダルを表示します", {
        reason,
        target,
        originPanel,
        conflict: {
          eventId: context?.eventId || "",
          hasConflict: Boolean(context?.hasConflict),
          optionCount: Array.isArray(context?.options) ? context.options.length : 0,
          entryCount: Array.isArray(context?.entries) ? context.entries.length : 0
        }
      });
    }
    this.app.scheduleConflictLastSignature = context?.signature || this.app.scheduleConflictLastSignature;
    this.syncScheduleConflictPromptState(context);
  }

  /**
   * スケジュールコンフリクトフォームの送信を処理します。
   * @param {Event} event - フォーム送信イベント
   */
  handleScheduleConflictSubmit(event) {
    event.preventDefault();
    const options = Array.from(
      this.app.dom.scheduleConflictOptions?.querySelectorAll(`input[name="${this.app.scheduleConflictRadioName}"]`) || []
    );
    const selected = options.find((input) => input.checked);
    if (!selected) {
      this.app.setScheduleConflictError("日程を選択してください。");
      return;
    }
    let scheduleId = ensureString(selected.dataset.scheduleId);
    const scheduleKey = ensureString(selected.value);
    if (!scheduleKey) {
      this.app.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    if (!scheduleId) {
      const eventId = ensureString(this.app.selectedEventId);
      scheduleId = this.app.extractScheduleIdFromKey(scheduleKey, eventId) || "";
      if (scheduleId) {
        selected.dataset.scheduleId = scheduleId;
      }
    }
    if (!scheduleId) {
      this.app.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    const scheduleMatch = this.app.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.app.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return;
    }
    scheduleId = scheduleMatch.id;
    selected.dataset.scheduleId = scheduleId;
    const context = this.app.scheduleConflictContext || this.buildScheduleConflictContext();
    const optionsContext = Array.isArray(context?.selectableOptions) && context.selectableOptions.length
      ? context.selectableOptions
      : Array.isArray(context?.options)
        ? context.options
        : [];
    const option = optionsContext.find((item) => item.key === scheduleKey || item.scheduleId === scheduleId) || null;
    const resolvedScheduleId = scheduleId;
    this.app.scheduleConflictContext = context;
    this.app.clearScheduleConflictError();
    this.app.setScheduleConflictSubmitting(true);
    this.app.confirmScheduleConsensus({ scheduleId: resolvedScheduleId, scheduleKey, option, context })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        if (
          resolvedScheduleId &&
          ensureString(this.app.selectedScheduleId) !== ensureString(resolvedScheduleId)
        ) {
          this.app.selectSchedule(resolvedScheduleId);
        }
        if (this.app.dom.scheduleConflictForm) {
          this.app.dom.scheduleConflictForm.reset();
        }
        this.app.clearScheduleConflictError();
        if (this.app.dom.scheduleConflictDialog) {
          this.app.closeDialog(this.app.dom.scheduleConflictDialog);
        }
        const navMeta = this.app.pendingNavigationMeta;
        const navTarget = this.app.pendingNavigationTarget || "";
        this.app.pendingNavigationTarget = "";
        this.app.navigationManager.pendingNavigationTarget = "";
        this.app.pendingNavigationMeta = null;
        this.app.navigationManager.pendingNavigationMeta = null;
        this.app.awaitingScheduleConflictPrompt = false;
        this.app.clearPendingNavigationTimer();
        let resolvedTarget = navTarget;
        let usedFallback = false;
        const metaOrigin = navMeta?.originPanel || "";
        const metaTarget = navMeta?.target || "";
        const isFlowFromSchedules =
          navMeta?.reason === "flow-navigation" && metaOrigin === "schedules";
        if (!resolvedTarget && metaTarget) {
          resolvedTarget = metaTarget;
          usedFallback = resolvedTarget !== navTarget;
        }
        // 日程確定後は新しいモーダルを開く（参加者リストには移動しない）
        if (isFlowFromSchedules) {
          this.app.openScheduleCompletionDialog();
        } else if (resolvedTarget) {
          // 他のナビゲーションの場合は従来通り
          this.app.showPanel(resolvedTarget);
          this.app.logFlowState("スケジュール合意の確定後にナビゲーションを継続します", {
            target: resolvedTarget,
            scheduleId,
            scheduleKey
          });
        }
      })
      .catch((error) => {
        console.error("Failed to resolve schedule conflict:", error);
        this.app.setScheduleConflictError("日程の確定に失敗しました。ネットワーク接続を確認して再度お試しください。");
      })
      .finally(() => {
        this.app.setScheduleConflictSubmitting(false);
      });
  }
}

