import { PANEL_CONFIG } from "../config.js";
import {
  ensureString,
  logError,
  waitForParticipantSelectionAck
} from "../helpers.js";
import { formatRelative, formatScheduleRange } from "../../operator/utils.js";

function createLoaderState() {
  return { promise: null, ready: false };
}

export class ParticipantToolManager {
  constructor(app) {
    this.app = app;
    this.loaderState = createLoaderState();
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.syncPromise = null;
    this.participantSyncInfo = null;
    this.lastParticipantSyncSignature = "";
    this.lastParticipantsErrorMessage = "";
    this.handleSyncEvent = this.handleSyncEvent.bind(this);
    this.handleSelectionBroadcast = this.handleSelectionBroadcast.bind(this);
  }

  get dom() {
    return this.app.dom;
  }

  logParticipantAction(message, detail = null) {
    this.app.logParticipantAction(message, detail);
  }

  resetFlowState() {
    this.loaderState = createLoaderState();
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.syncPromise = null;
    this.participantSyncInfo = null;
    this.lastParticipantSyncSignature = "";
    this.lastParticipantsErrorMessage = "";
    this.updateDataset(null);
  }

  resetContext({ clearDataset = false } = {}) {
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.lastParticipantSyncSignature = "";
    if (clearDataset) {
      this.updateDataset(null);
    }
  }

  isPendingSync() {
    return this.pendingSync;
  }

  setPendingSync(flag) {
    this.pendingSync = Boolean(flag);
  }

  prepareContextForSelection() {
    const context = this.app.getCurrentSelectionContext();
    this.logParticipantAction("参加者ツールへのコンテキスト適用を確認します", context);
    if (!context.eventId || !context.scheduleId) {
      this.pendingSync = false;
      this.lastContextSignature = "";
      this.lastContextApplied = false;
      this.updateDataset(null);
      const message = this.app.selectedEventId
        ? "日程を選択すると参加者リストを読み込みます。"
        : "イベントと日程を選択すると参加者リストを読み込みます。";
      this.logParticipantAction("選択が不足しているため参加者ツールの同期を保留します", {
        eventId: context.eventId,
        scheduleId: context.scheduleId
      });
      this.setParticipantStatus({ text: message, variant: "info" });
      return false;
    }

    this.updateDataset(context);
    const activeConfig = PANEL_CONFIG[this.app.activePanel] || PANEL_CONFIG.events;
    if (activeConfig.stage === "tabs" && activeConfig.requireSchedule) {
      this.pendingSync = false;
      this.logParticipantAction("参加者ツールの即時同期を開始します", {
        eventId: context.eventId,
        scheduleId: context.scheduleId
      });
      return true;
    }

    this.pendingSync = true;
    this.logParticipantAction("参加者ツールの同期を保留状態に設定しました", {
      eventId: context.eventId,
      scheduleId: context.scheduleId,
      activePanel: this.app.activePanel
    });
    return false;
  }

  async load() {
    const state = this.loaderState;
    this.logParticipantAction("参加者ツールの読み込み処理を開始します", {
      entryExists: Boolean(state),
      alreadyReady: Boolean(state?.ready),
      hasPendingPromise: Boolean(state?.promise)
    });
    if (!state) {
      this.logParticipantAction("参加者ツールの設定が見つからないため読み込みを中止します");
      return;
    }
    if (state.ready) {
      this.logParticipantAction("参加者ツールは既に読み込み済みです");
      return;
    }
    if (!state.promise) {
      this.logParticipantAction("参加者ツールの読み込みを初期化します");
      state.promise = (async () => {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.qaEmbedPrefix = "qa-";
        }
        this.logParticipantAction("参加者ツールのスクリプトを読み込みます");
        await import("../../question-admin/index.js");
        if (window.questionAdminEmbed?.attachHost) {
          this.logParticipantAction("参加者ツールにホストインターフェースを接続します");
          window.questionAdminEmbed.attachHost(this.app.getParticipantHostInterface());
          this.app.notifyEventListeners();
          this.app.notifySelectionListeners("host");
          this.logParticipantAction("参加者ツールの初期化シグナルを送信しました");
        }
        state.ready = true;
        this.logParticipantAction("参加者ツールの読み込み処理が完了しました");
      })().catch((error) => {
        logError("Failed to load participants tool", error);
        state.ready = false;
        state.promise = null;
        this.logParticipantAction("参加者ツールの読み込みに失敗しました", {
          error: error instanceof Error ? error.message : String(error ?? "")
        });
        throw error;
      });
    } else {
      this.logParticipantAction("参加者ツールの読み込み完了を待機します");
    }
    await state.promise;
    this.logParticipantAction("参加者ツールの読み込みを確認しました");
  }

  async ensureReady() {
    await this.load();
    if (window.questionAdminEmbed?.waitUntilReady) {
      this.logParticipantAction("参加者ツールの準備完了を待機します");
      await window.questionAdminEmbed.waitUntilReady();
    }
    return window.questionAdminEmbed || null;
  }

  updateDataset(context) {
    const tool = this.dom.participantsTool;
    if (!tool) {
      this.logParticipantAction("参加者ツールの埋め込み要素が見つからないためデータセットを更新できません", {
        context
      });
      return;
    }
    const clear = () => {
      delete tool.dataset.expectedEventId;
      delete tool.dataset.expectedEventName;
      delete tool.dataset.expectedScheduleId;
      delete tool.dataset.expectedScheduleLabel;
      delete tool.dataset.expectedStartAt;
      delete tool.dataset.expectedEndAt;
      delete tool.dataset.syncedEventId;
      delete tool.dataset.syncedScheduleId;
      delete tool.dataset.syncedAt;
      this.logParticipantAction("参加者ツールの期待コンテキストをクリアしました");
      this.lastParticipantSyncSignature = "";
    };
    if (!context || !context.eventId || !context.scheduleId) {
      clear();
      this.logParticipantAction("選択情報が不足しているため参加者ツールの期待値をリセットしました", {
        context
      });
      return;
    }
    tool.dataset.expectedEventId = context.eventId;
    tool.dataset.expectedEventName = context.eventName || context.eventId;
    tool.dataset.expectedScheduleId = context.scheduleId;
    tool.dataset.expectedScheduleLabel = context.scheduleLabel || context.scheduleId;
    tool.dataset.expectedStartAt = context.startAt || "";
    tool.dataset.expectedEndAt = context.endAt || "";
    this.logParticipantAction("参加者ツールの期待コンテキストを更新しました", context);
  }

  setParticipantStatus({ text = "", meta = "", variant = "info" } = {}) {
    const allowed = new Set(["info", "success", "error", "pending"]);
    const normalizedVariant = allowed.has(variant) ? variant : "info";
    this.logParticipantAction("参加者ステータスを更新しました", {
      text,
      meta,
      variant: normalizedVariant
    });
  }

  async sync() {
    if (this.syncPromise) {
      this.logParticipantAction("参加者ツールの同期処理が進行中のため既存のPromiseを再利用します");
      return this.syncPromise;
    }

    const run = (async () => {
      const schedule = this.app.getSelectedSchedule();
      const event = this.app.getSelectedEvent();
      if (!schedule || !event) {
        this.lastContextSignature = "";
        this.lastContextApplied = false;
        this.pendingSync = false;
        this.updateDataset(null);
        this.logParticipantAction("イベントまたは日程が未選択のため参加者ツールの同期を中止します", {
          selectedEventId: event?.id || "",
          selectedScheduleId: schedule?.id || ""
        });
        this.lastParticipantSyncSignature = "";
        return { context: null };
      }

      const eventLabel = event.name || event.id;
      const scheduleLabel = schedule.label || schedule.id;
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const contextKey = [
        event.id,
        schedule.id,
        event.name || "",
        schedule.label || "",
        schedule.startAt || "",
        schedule.endAt || ""
      ].join("::");
      if (this.lastContextSignature === contextKey && this.lastContextApplied) {
        this.pendingSync = false;
        this.logParticipantAction("参加者ツールは既に最新のコンテキストを保持しているため同期をスキップします", {
          eventId: event.id,
          scheduleId: schedule.id
        });
        return { context: null };
      }

      this.lastContextApplied = false;
      const context = {
        eventId: event.id,
        eventName: event.name || event.id,
        scheduleId: schedule.id,
        scheduleLabel: schedule.label || schedule.id,
        startAt: schedule.startAt || "",
        endAt: schedule.endAt || ""
      };
      this.updateDataset(context);
      this.logParticipantAction("参加者ツールとの同期を開始します", context);
      const pendingMeta = [];
      if (rangeText) {
        pendingMeta.push(`時間 ${rangeText}`);
      }
      pendingMeta.push("同期処理中…");
      this.setParticipantStatus({
        text: `参加者リストを同期しています: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
        meta: pendingMeta.join(" / "),
        variant: "pending"
      });

      let participantsSynced = false;
      let participantsError = null;
      try {
        await this.ensureReady();
        if (window.questionAdminEmbed?.setSelection) {
          this.logParticipantAction("参加者ツールへ選択情報を送信します", context);
          await window.questionAdminEmbed.setSelection(context);
          const acknowledged = await waitForParticipantSelectionAck(
            context.eventId,
            context.scheduleId
          );
          if (!acknowledged) {
            this.logParticipantAction("参加者ツールから選択反映の応答がありません", {
              eventId: context.eventId,
              scheduleId: context.scheduleId
            });
            throw new Error("参加者ツールに選択内容が反映されませんでした。");
          }
          this.logParticipantAction("参加者ツールが選択内容の受信を確認しました", {
            eventId: context.eventId,
            scheduleId: context.scheduleId
          });
        }
        participantsSynced = true;
        this.logParticipantAction("参加者ツールとの同期が完了しました", {
          eventId: context.eventId,
          scheduleId: context.scheduleId
        });
      } catch (error) {
        participantsError = error instanceof Error ? error : new Error(String(error ?? ""));
        logError("Failed to sync participant tool", error);
        this.logParticipantAction("参加者ツールとの同期中にエラーが発生しました", {
          eventId: context.eventId,
          scheduleId: context.scheduleId,
          error: participantsError.message || String(error ?? "")
        });
      }

      const overlay = typeof document !== "undefined" ? document.getElementById("qa-loading-overlay") : null;
      if (overlay) {
        overlay.hidden = true;
      }

      if (participantsSynced) {
        this.lastContextSignature = contextKey;
        this.lastContextApplied = true;
        this.pendingSync = false;
        const successMeta = [];
        if (rangeText) {
          successMeta.push(`時間 ${rangeText}`);
        }
        successMeta.push("同期完了");
        this.setParticipantStatus({
          text: `参加者リストの同期を完了しました: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
          meta: successMeta.join(" / "),
          variant: "success"
        });
        if (this.lastParticipantsErrorMessage && this.app.dom.alert && !this.app.dom.alert.hidden) {
          const currentText = String(this.app.dom.alert.textContent || "").trim();
          if (currentText === this.lastParticipantsErrorMessage.trim()) {
            this.app.clearAlert();
          }
        }
        this.lastParticipantsErrorMessage = "";
        return { context };
      }

      this.pendingSync = true;
      if (participantsError && this.app.activePanel === "participants") {
        const message = participantsError.message
          ? `参加者リストの初期化に失敗しました: ${participantsError.message}`
          : "参加者リストの初期化に失敗しました。時間をおいて再試行してください。";
        this.lastParticipantsErrorMessage = message;
        this.app.showAlert(message);
        this.setParticipantStatus({ text: message, variant: "error" });
      }
      return { context: null };
    })();

    this.syncPromise = run.finally(() => {
      if (this.syncPromise === run) {
        this.syncPromise = null;
        this.logParticipantAction("参加者ツールの同期処理をクリーンアップしました");
      }
    });

    return this.syncPromise;
  }

  handleSyncEvent(event) {
    if (!event || !event.detail) {
      this.logParticipantAction("参加者ツールからの同期イベントに詳細が含まれていません");
      return;
    }
    const detail = event.detail;
    const eventId = ensureString(detail.eventId);
    const scheduleId = ensureString(detail.scheduleId);
    const normalizedTimestamp = Number(detail.timestamp) || 0;
    const successFlag = detail.success !== false;
    const normalizedReason = ensureString(detail.reason);
    const normalizedError = ensureString(detail.error);
    const participantCountValue = Number(detail.participantCount);
    const normalizedParticipantCount = Number.isFinite(participantCountValue)
      ? participantCountValue
      : null;
    const dataset = (this.dom.participantsTool && this.dom.participantsTool.dataset) || {};
    const derivedEventId = ensureString(
      eventId || dataset.expectedEventId || dataset.syncedEventId || this.participantSyncInfo?.eventId || this.app.selectedEventId
    );
    const derivedScheduleId = ensureString(
      scheduleId || dataset.expectedScheduleId || dataset.syncedScheduleId || this.participantSyncInfo?.scheduleId || this.app.selectedScheduleId
    );
    const derivedEventName = ensureString(
      detail.eventName || dataset.expectedEventName || this.participantSyncInfo?.eventName
    );
    const derivedScheduleLabel = ensureString(
      detail.scheduleLabel || dataset.expectedScheduleLabel || this.participantSyncInfo?.scheduleLabel
    );
    const fallbackEventLabel = derivedEventName || derivedEventId;
    const fallbackScheduleLabel = derivedScheduleLabel || derivedScheduleId;
    const timestamp = normalizedTimestamp || Date.now();

    if (!successFlag) {
      const reason = normalizedReason;
      const error = normalizedError;
      const signatureKey = [
        derivedEventId,
        derivedScheduleId,
        reason,
        error
      ]
        .filter(Boolean)
        .join("::");
      if (this.lastParticipantSyncSignature === signatureKey) {
        this.logParticipantAction("同じエラー情報が既に処理済みのため参加者同期イベントを無視します", {
          eventId,
          scheduleId,
          derivedEventId,
          derivedScheduleId,
          reason,
          error
        });
        return;
      }
      this.lastParticipantSyncSignature = signatureKey;
    } else {
      this.lastParticipantSyncSignature = `${derivedEventId}::${derivedScheduleId}::success`;
    }

    this.logParticipantAction("参加者ツールから同期結果イベントを受信しました", {
      eventId,
      scheduleId,
      derivedEventId,
      derivedScheduleId,
      success: successFlag,
      participantCount: normalizedParticipantCount
    });

    if (successFlag) {
      const relative = timestamp ? formatRelative(timestamp) : "";
      const metaParts = [];
      if (normalizedParticipantCount !== null) {
        metaParts.push(`参加者 ${normalizedParticipantCount}人`);
      }
      if (relative && relative !== "—") {
        metaParts.push(`${relative}に同期`);
      }
      this.participantSyncInfo = {
        ...detail,
        eventId: derivedEventId,
        scheduleId: derivedScheduleId,
        eventName: fallbackEventLabel || detail.eventName || "",
        scheduleLabel: fallbackScheduleLabel || detail.scheduleLabel || "",
        timestamp
      };
      this.setParticipantStatus({
        text: `参加者リストを同期しました: イベント「${fallbackEventLabel}」/ 日程「${fallbackScheduleLabel}」`,
        meta: metaParts.join(" / "),
        variant: "success"
      });
      if (this.dom.participantsTool) {
        this.dom.participantsTool.dataset.syncedEventId = derivedEventId;
        this.dom.participantsTool.dataset.syncedScheduleId = derivedScheduleId;
        this.dom.participantsTool.dataset.syncedAt = String(timestamp);
      }
      this.lastParticipantsErrorMessage = "";
      return;
    }

    const reason = ensureString(detail.reason);
    if (reason === "selection-missing") {
      const message = this.app.selectedEventId
        ? "日程を選択すると参加者リストを読み込みます。"
        : "イベントと日程を選択すると参加者リストを読み込みます。";
      this.participantSyncInfo = null;
      this.setParticipantStatus({ text: message, variant: "info" });
      if (this.dom.participantsTool) {
        delete this.dom.participantsTool.dataset.syncedEventId;
        delete this.dom.participantsTool.dataset.syncedScheduleId;
        delete this.dom.participantsTool.dataset.syncedAt;
      }
      this.logParticipantAction("選択不足のため参加者ツールの同期が見送られたイベントを処理しました", {
        eventId,
        scheduleId,
        derivedEventId,
        derivedScheduleId,
        derivedEventLabel: fallbackEventLabel,
        derivedScheduleLabel: fallbackScheduleLabel
      });
      this.lastParticipantSyncSignature = "";
      return;
    }

    const errorMessage = ensureString(detail.error);
    const text = errorMessage
      ? `参加者リストの読み込みに失敗しました: ${errorMessage}`
      : "参加者リストの読み込みに失敗しました。";
    const relative = timestamp ? formatRelative(timestamp) : "";
    const metaParts = [];
    if (relative && relative !== "—") {
      metaParts.push(`${relative}に報告`);
    }
    this.participantSyncInfo = {
      ...detail,
      eventId: derivedEventId,
      scheduleId: derivedScheduleId,
      eventName: fallbackEventLabel || detail.eventName || "",
      scheduleLabel: fallbackScheduleLabel || detail.scheduleLabel || "",
      timestamp
    };
    this.setParticipantStatus({
      text,
      meta: metaParts.join(" / "),
      variant: "error"
    });
    this.logParticipantAction("参加者ツールの同期エラーイベントを処理しました", {
      eventId,
      scheduleId,
      derivedEventId,
      derivedScheduleId,
      derivedEventLabel: fallbackEventLabel,
      derivedScheduleLabel: fallbackScheduleLabel,
      error: errorMessage || "",
      reason: reason || ""
    });
    if (this.dom.participantsTool) {
      delete this.dom.participantsTool.dataset.syncedEventId;
      delete this.dom.participantsTool.dataset.syncedScheduleId;
      delete this.dom.participantsTool.dataset.syncedAt;
      this.logParticipantAction("エラーのため参加者ツールの同期済みメタ情報をクリアしました", {
        eventId,
        scheduleId,
        derivedEventId,
        derivedScheduleId,
        derivedEventLabel: fallbackEventLabel,
        derivedScheduleLabel: fallbackScheduleLabel
      });
    }
    this.lastParticipantSyncSignature = "";
  }

  async handleSelectionBroadcast(event) {
    if (!event || !event.detail) {
      this.logParticipantAction("参加者ツールからの選択イベントに詳細が含まれていません");
      return;
    }
    const { detail } = event;
    const source = ensureString(detail.source);
    if (source && source !== "participants" && source !== "question-admin") {
      this.logParticipantAction("参加者ツール以外のソースからの選択イベントのため無視します", {
        source
      });
      return;
    }
    const eventId = ensureString(detail.eventId);
    const scheduleId = ensureString(detail.scheduleId);
    if (!eventId) {
      this.logParticipantAction("選択イベントにイベントIDが含まれていないため無視します", {
        detail
      });
      return;
    }
    this.logParticipantAction("参加者ツールから選択イベントを受信しました", {
      eventId,
      scheduleId,
      source: source || "participants"
    });

    try {
      if (!this.app.events.some((item) => item.id === eventId)) {
        this.logParticipantAction("参加者ツールから通知されたイベントが未取得のため再読み込みを試みます", {
          eventId
        });
        await this.app.loadEvents();
      }
    } catch (error) {
      logError("Failed to refresh events after participant selection", error);
      this.logParticipantAction("参加者ツールからの選択イベント処理中にイベント再取得へ失敗しました", {
        eventId,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
      return;
    }

    const matchedEvent = this.app.events.find((item) => item.id === eventId) || null;
    if (!matchedEvent) {
      this.logParticipantAction("参加者ツールから通知されたイベントが見つかりません", {
        eventId
      });
      return;
    }

    const eventName = ensureString(detail.eventName);
    if (eventName) {
      matchedEvent.name = eventName;
    }

    if (!Array.isArray(matchedEvent.schedules)) {
      matchedEvent.schedules = [];
    }

    let scheduleRecord = null;
    if (scheduleId) {
      scheduleRecord = matchedEvent.schedules.find((item) => item.id === scheduleId) || null;
      if (!scheduleRecord) {
        scheduleRecord = {
          id: scheduleId,
          label: ensureString(detail.scheduleLabel) || scheduleId,
          startAt: ensureString(detail.startAt),
          endAt: ensureString(detail.endAt)
        };
        matchedEvent.schedules.push(scheduleRecord);
        this.logParticipantAction("参加者ツールから新しい日程情報を追加しました", {
          eventId,
          scheduleId
        });
      } else {
        const label = ensureString(detail.scheduleLabel);
        if (label) {
          scheduleRecord.label = label;
        }
        if (detail.startAt !== undefined) {
          scheduleRecord.startAt = ensureString(detail.startAt);
        }
        if (detail.endAt !== undefined) {
          scheduleRecord.endAt = ensureString(detail.endAt);
        }
        this.logParticipantAction("参加者ツールからの情報で既存の日程を更新しました", {
          eventId,
          scheduleId
        });
      }
    }

    matchedEvent.scheduleCount = matchedEvent.schedules.length;

    this.app.renderEvents();
    this.app.updateEventSummary();

    if (this.app.selectedEventId !== eventId) {
      this.app.selectEvent(eventId);
    } else {
      this.app.updateScheduleStateFromSelection(scheduleId);
    }

    if (scheduleId) {
      if (this.app.selectedScheduleId !== scheduleId) {
        this.app.selectSchedule(scheduleId);
      }
    } else if (this.app.selectedScheduleId) {
      this.app.selectSchedule("");
    }

    const tabPanels = new Set(["participants", "operator", "dictionary", "pickup", "logs"]);
    const targetPanel = tabPanels.has(this.app.activePanel) ? this.app.activePanel : "participants";
    this.app.showPanel(targetPanel);
    this.app.notifyEventListeners();
    this.app.notifySelectionListeners(source || "participants");
    this.logParticipantAction("参加者ツールからの選択イベント処理を完了しました", {
      eventId,
      scheduleId,
      activePanel: targetPanel
    });
  }
}
