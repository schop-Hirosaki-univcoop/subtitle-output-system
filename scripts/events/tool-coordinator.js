import { PANEL_CONFIG } from "./config.js";
import {
  ensureString,
  logError,
  waitForParticipantSelectionAck
} from "./helpers.js";
import { formatScheduleRange, formatRelative } from "../operator/utils.js";

export class ToolCoordinator {
  constructor(app) {
    this.app = app;
    this.embeddedTools = this.createEmbeddedToolState();
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.syncPromise = null;
    this.operatorPreloadPromise = null;
    this.participantSyncInfo = null;
    this.lastParticipantSyncSignature = "";
    this.lastParticipantsErrorMessage = "";
    this.handleParticipantSyncEvent = this.handleParticipantSyncEvent.bind(this);
    this.handleParticipantSelectionBroadcast = this.handleParticipantSelectionBroadcast.bind(this);
  }

  get dom() {
    return this.app.dom;
  }

  logParticipantAction(message, detail = null) {
    this.app.logParticipantAction(message, detail);
  }

  createEmbeddedToolState() {
    return {
      participants: { promise: null, ready: false },
      operator: { promise: null, ready: false }
    };
  }

  resetFlowState() {
    this.embeddedTools = this.createEmbeddedToolState();
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.syncPromise = null;
    this.operatorPreloadPromise = null;
    this.participantSyncInfo = null;
    this.lastParticipantSyncSignature = "";
    this.lastParticipantsErrorMessage = "";
    this.updateParticipantDataset(null);
    this.resetFrames();
  }

  resetContext({ clearDataset = false } = {}) {
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    this.lastParticipantSyncSignature = "";
    if (clearDataset) {
      this.updateParticipantDataset(null);
    }
  }

  isPendingSync() {
    return this.pendingSync;
  }

  setPendingSync(flag) {
    this.pendingSync = Boolean(flag);
  }

  prepareFrames() {
    if (typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    if (html) {
      if (!html.dataset.qaEmbedPrefix) {
        html.dataset.qaEmbedPrefix = "qa-";
      }
      if (!html.dataset.operatorEmbedPrefix) {
        html.dataset.operatorEmbedPrefix = "op-";
      }
    }

    const ensurePrepared = (element, loginSelector) => {
      if (!element || element.dataset.prepared === "true") {
        return;
      }
      element.dataset.prepared = "true";
      if (loginSelector) {
        const loginElement = element.querySelector(loginSelector);
        if (loginElement) {
          loginElement.remove();
        }
      }
    };

    ensurePrepared(this.dom.participantsTool, "#qa-login-card");
    ensurePrepared(this.dom.operatorTool, "#op-login-container");
    if (document.body) {
      document.body.classList.add("dictionary-collapsed", "logs-collapsed");
      document.body.classList.remove("dictionary-open", "logs-open");
    }
  }

  resetFrames() {
    this.embeddedTools = this.createEmbeddedToolState();
    this.lastContextSignature = "";
    this.lastContextApplied = false;
    this.pendingSync = false;
    if (typeof window !== "undefined") {
      try {
        window.questionAdminEmbed?.reset?.();
      } catch (error) {
        console.warn("Failed to reset participant tool state", error);
      }
      try {
        window.operatorEmbed?.reset?.();
      } catch (error) {
        console.warn("Failed to reset operator tool state", error);
      }
    }
  }

  updateParticipantDataset(context) {
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

  async loadEmbeddedTool(tool) {
    const entry = this.embeddedTools[tool];
    if (tool === "participants") {
      this.logParticipantAction("参加者ツールの読み込み処理を開始します", {
        entryExists: Boolean(entry),
        alreadyReady: Boolean(entry?.ready),
        hasPendingPromise: Boolean(entry?.promise)
      });
    }
    if (!entry) {
      if (tool === "participants") {
        this.logParticipantAction("参加者ツールの設定が見つからないため読み込みを中止します");
      }
      return;
    }
    if (entry.ready) {
      if (tool === "participants") {
        this.logParticipantAction("参加者ツールは既に読み込み済みです");
      }
      return;
    }
    if (!entry.promise) {
      if (tool === "participants") {
        this.logParticipantAction("参加者ツールの読み込みを初期化します");
      }
      entry.promise = (async () => {
        if (typeof document !== "undefined") {
          if (tool === "participants") {
            document.documentElement.dataset.qaEmbedPrefix = "qa-";
          } else if (tool === "operator") {
            document.documentElement.dataset.operatorEmbedPrefix = "op-";
          }
        }
        if (tool === "participants") {
          this.logParticipantAction("参加者ツールのスクリプトを読み込みます");
          await import("../question-admin/index.js");
          if (window.questionAdminEmbed?.attachHost) {
            this.logParticipantAction("参加者ツールにホストインターフェースを接続します");
            window.questionAdminEmbed.attachHost(this.app.getParticipantHostInterface());
            this.app.notifyEventListeners();
            this.app.notifySelectionListeners("host");
            this.logParticipantAction("参加者ツールの初期化シグナルを送信しました");
          }
        } else {
          await import("../operator/index.js");
        }
        entry.ready = true;
        if (tool === "participants") {
          this.logParticipantAction("参加者ツールの読み込み処理が完了しました");
        }
      })().catch((error) => {
        logError(`Failed to load ${tool} tool`, error);
        entry.ready = false;
        entry.promise = null;
        if (tool === "participants") {
          this.logParticipantAction("参加者ツールの読み込みに失敗しました", {
            error: error instanceof Error ? error.message : String(error ?? "")
          });
        }
        throw error;
      });
    } else if (tool === "participants") {
      this.logParticipantAction("参加者ツールの読み込み完了を待機します");
    }
    await entry.promise;
    if (tool === "participants") {
      this.logParticipantAction("参加者ツールの読み込みを確認しました");
    }
  }

  prepareContextForSelection() {
    const context = this.app.getCurrentSelectionContext();
    this.logParticipantAction("参加者ツールへのコンテキスト適用を確認します", context);
    if (!context.eventId || !context.scheduleId) {
      this.pendingSync = false;
      this.lastContextSignature = "";
      this.lastContextApplied = false;
      this.updateParticipantDataset(null);
      const message = this.app.selectedEventId
        ? "日程を選択すると参加者リストを読み込みます。"
        : "イベントと日程を選択すると参加者リストを読み込みます。";
      this.logParticipantAction("選択が不足しているため参加者ツールの同期を保留します", {
        eventId: context.eventId,
        scheduleId: context.scheduleId
      });
      this.setParticipantStatus({ text: message, variant: "info" });
      return;
    }
    this.updateParticipantDataset(context);
    const activeConfig = PANEL_CONFIG[this.app.activePanel] || PANEL_CONFIG.events;
    if (activeConfig.stage === "tabs" && activeConfig.requireSchedule) {
      this.pendingSync = false;
      this.logParticipantAction("参加者ツールの即時同期を開始します", {
        eventId: context.eventId,
        scheduleId: context.scheduleId
      });
      this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
    } else {
      this.pendingSync = true;
      this.logParticipantAction("参加者ツールの同期を保留状態に設定しました", {
        eventId: context.eventId,
        scheduleId: context.scheduleId,
        activePanel: this.app.activePanel
      });
    }
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

  async syncEmbeddedTools() {
    if (this.syncPromise) {
      this.logParticipantAction("参加者ツールの同期処理が進行中のため既存のPromiseを再利用します");
      return this.syncPromise;
    }

    const run = (async () => {
      this.prepareFrames();
      const schedule = this.app.getSelectedSchedule();
      const event = this.app.getSelectedEvent();
      if (!schedule || !event) {
        this.lastContextSignature = "";
        this.lastContextApplied = false;
        this.pendingSync = false;
        this.updateParticipantDataset(null);
        this.logParticipantAction("イベントまたは日程が未選択のため参加者ツールの同期を中止します", {
          selectedEventId: event?.id || "",
          selectedScheduleId: schedule?.id || ""
        });
        this.lastParticipantSyncSignature = "";
        return;
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
        return;
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
      this.updateParticipantDataset(context);
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
        await this.loadEmbeddedTool("participants");
        if (window.questionAdminEmbed?.waitUntilReady) {
          this.logParticipantAction("参加者ツールの準備完了を待機します", context);
          await window.questionAdminEmbed.waitUntilReady();
        }
        if (window.questionAdminEmbed?.setSelection) {
          this.logParticipantAction("参加者ツールへ選択情報を送信します", context);
          await window.questionAdminEmbed.setSelection(context);
          const acknowledged = await waitForParticipantSelectionAck(context.eventId, context.scheduleId);
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
      try {
        await this.loadEmbeddedTool("operator");
        if (window.operatorEmbed?.waitUntilReady) {
          await window.operatorEmbed.waitUntilReady();
        }
        if (window.operatorEmbed?.setContext) {
          window.operatorEmbed.setContext(context);
        }
      } catch (error) {
        logError("Failed to sync operator tool", error);
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
      } else {
        this.pendingSync = true;
        if (participantsError && this.app.activePanel === "participants") {
          const message = participantsError.message
            ? `参加者リストの初期化に失敗しました: ${participantsError.message}`
            : "参加者リストの初期化に失敗しました。時間をおいて再試行してください。";
          this.lastParticipantsErrorMessage = message;
          this.app.showAlert(message);
          this.setParticipantStatus({ text: message, variant: "error" });
        }
      }
    })();

    this.syncPromise = run.finally(() => {
      if (this.syncPromise === run) {
        this.syncPromise = null;
        this.logParticipantAction("参加者ツールの同期処理をクリーンアップしました");
      }
    });

    return this.syncPromise;
  }

  async ensureOperatorAppReady() {
    await this.loadEmbeddedTool("operator");
    if (window.operatorEmbed?.waitUntilReady) {
      try {
        await window.operatorEmbed.waitUntilReady();
      } catch (error) {
        logError("Failed to wait for operator tool", error);
      }
    }
    return window.operatorEmbed?.app || null;
  }

  preloadOperatorGlobals() {
    if (!this.operatorPreloadPromise) {
      this.operatorPreloadPromise = (async () => {
        try {
          await this.ensureOperatorAppReady();
        } catch (error) {
          logError("Failed to preload operator tool", error);
        }
      })();
    }
    return this.operatorPreloadPromise;
  }

  async setDrawerState({ dictionary, logs }) {
    const needsDictionary = typeof dictionary === "boolean";
    const needsLogs = typeof logs === "boolean";
    if (!needsDictionary && !needsLogs) {
      return;
    }
    if (!window.operatorEmbed?.app && dictionary === false && logs === false) {
      return;
    }
    const app = await this.ensureOperatorAppReady();
    if (!app) {
      return;
    }
    if (typeof dictionary === "boolean") {
      try {
        app.toggleDictionaryDrawer(dictionary, false);
      } catch (error) {
        logError("Failed to toggle dictionary drawer", error);
      }
    }
    if (typeof logs === "boolean") {
      try {
        app.toggleLogsDrawer(logs, false);
      } catch (error) {
        logError("Failed to toggle logs drawer", error);
      }
    }
  }

  handleParticipantSyncEvent(event) {
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
    const selectedEvent = this.app.getSelectedEvent();
    const selectedSchedule = this.app.getSelectedSchedule();
    const fallbackEventLabel = derivedEventName || selectedEvent?.name || derivedEventId;
    const fallbackScheduleLabel = derivedScheduleLabel || selectedSchedule?.label || derivedScheduleId;
    const signaturePayload = {
      eventId: derivedEventId,
      scheduleId: derivedScheduleId,
      success: successFlag,
      participantCount: normalizedParticipantCount,
      reason: normalizedReason,
      error: normalizedError,
      timestamp: normalizedTimestamp > 0 ? Math.floor(normalizedTimestamp / 1000) : 0
    };
    const signature = JSON.stringify(signaturePayload);
    if (signature && signature === this.lastParticipantSyncSignature) {
      this.logParticipantAction("同一内容の同期イベントを受信したため既存の状態を維持します", signaturePayload);
      return;
    }
    this.lastParticipantSyncSignature = signature;
    this.logParticipantAction("参加者ツールから同期イベントを受信しました", {
      eventId,
      scheduleId,
      derivedEventId,
      derivedScheduleId,
      derivedEventLabel: fallbackEventLabel,
      derivedScheduleLabel: fallbackScheduleLabel,
      success: detail.success !== false,
      detail
    });
    if (eventId && this.app.selectedEventId && eventId !== this.app.selectedEventId) {
      this.logParticipantAction("現在のイベント選択と一致しないため同期イベントを無視しました", {
        eventId,
        selectedEventId: this.app.selectedEventId
      });
      return;
    }
    if (scheduleId && this.app.selectedScheduleId && scheduleId !== this.app.selectedScheduleId) {
      this.logParticipantAction("現在の日程選択と一致しないため同期イベントを無視しました", {
        scheduleId,
        selectedScheduleId: this.app.selectedScheduleId
      });
      return;
    }
    const timestamp = normalizedTimestamp || Date.now();
    if ((!eventId || !scheduleId) && derivedEventId && derivedScheduleId) {
      this.logParticipantAction("同期イベントの選択情報が不足していたため最新の選択を補完して処理します", {
        providedEventId: eventId,
        providedScheduleId: scheduleId,
        derivedEventId,
        derivedScheduleId,
        derivedEventLabel: fallbackEventLabel,
        derivedScheduleLabel: fallbackScheduleLabel
      });
    }
    if (!derivedEventId || !derivedScheduleId) {
      if (!this.app.selectedEventId || !this.app.selectedScheduleId) {
        const message = this.app.selectedEventId
          ? "日程を選択すると参加者リストを読み込みます。"
          : "イベントと日程を選択すると参加者リストを読み込みます。";
        this.participantSyncInfo = null;
        this.setParticipantStatus({ text: message, variant: "info" });
        if (this.dom.participantsTool) {
          delete this.dom.participantsTool.dataset.syncedEventId;
          delete this.dom.participantsTool.dataset.syncedScheduleId;
          delete this.dom.participantsTool.dataset.syncedAt;
          this.logParticipantAction("同期イベントに選択情報が含まれていないため同期済みメタ情報をクリアしました", {
            eventId,
            scheduleId,
            derivedEventId,
            derivedScheduleId,
            derivedEventLabel: fallbackEventLabel,
            derivedScheduleLabel: fallbackScheduleLabel
          });
        } else {
          this.logParticipantAction(
            "同期イベントに選択情報が含まれていないものの同期済みメタ情報を保持する要素が見つかりません",
            {
              eventId,
              scheduleId,
              derivedEventId,
              derivedScheduleId,
              derivedEventLabel: fallbackEventLabel,
              derivedScheduleLabel: fallbackScheduleLabel
            }
          );
        }
        this.logParticipantAction("同期イベントに選択情報が含まれていないため案内メッセージを表示しました", {
          eventId,
          scheduleId,
          derivedEventId,
          derivedScheduleId,
          derivedEventLabel: fallbackEventLabel,
          derivedScheduleLabel: fallbackScheduleLabel
        });
      }
      this.lastParticipantSyncSignature = "";
      return;
    }

    const success = successFlag;
    if (success) {
      const participantCount = normalizedParticipantCount;
      const countText = Number.isFinite(participantCount) && participantCount >= 0 ? `参加者 ${participantCount}名` : "";
      let scheduleRange = ensureString(detail.scheduleRange);
      if (!scheduleRange) {
        const selectedSchedule = this.app.getSelectedSchedule();
        if (selectedSchedule) {
          scheduleRange = formatScheduleRange(selectedSchedule.startAt, selectedSchedule.endAt);
        }
      }
      const metaParts = [];
      if (countText) {
        metaParts.push(countText);
      }
      if (scheduleRange) {
        metaParts.push(`時間 ${scheduleRange}`);
      }
      const relative = timestamp ? formatRelative(timestamp) : "";
      if (relative && relative !== "—") {
        metaParts.push(`${relative}に更新`);
      }
      const eventLabel = fallbackEventLabel;
      const scheduleLabel = fallbackScheduleLabel;
      this.participantSyncInfo = {
        ...detail,
        eventId: derivedEventId,
        scheduleId: derivedScheduleId,
        eventName: eventLabel,
        scheduleLabel,
        timestamp
      };
      this.setParticipantStatus({
        text: `参加者リストを同期しました: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
        meta: metaParts.filter(Boolean).join(" / "),
        variant: "success"
      });
      if (this.dom.participantsTool) {
        this.dom.participantsTool.dataset.syncedEventId = derivedEventId;
        this.dom.participantsTool.dataset.syncedScheduleId = derivedScheduleId;
        this.dom.participantsTool.dataset.syncedAt = String(timestamp);
        this.logParticipantAction("参加者ツールの同期済みメタ情報を更新しました", {
          syncedEventId: this.dom.participantsTool.dataset.syncedEventId,
          syncedScheduleId: this.dom.participantsTool.dataset.syncedScheduleId,
          syncedAt: this.dom.participantsTool.dataset.syncedAt
        });
      }
      this.logParticipantAction("参加者ツールの同期完了イベントを処理しました", {
        eventId,
        scheduleId,
        derivedEventId,
        derivedScheduleId,
        derivedEventLabel: fallbackEventLabel,
        derivedScheduleLabel: fallbackScheduleLabel,
        participantCount,
        meta: metaParts
      });
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

  async handleParticipantSelectionBroadcast(event) {
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

    const tabPanels = new Set(["participants", "operator", "dictionary", "logs"]);
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
