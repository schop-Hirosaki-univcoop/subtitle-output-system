import { logError } from "./helpers.js";
import { normalizeOperatorMode } from "../shared/operator-modes.js";
import { OperatorToolManager } from "./tools/operator.js";
import { ParticipantToolManager } from "./tools/participant.js";
import { prepareEmbeddedFrames, resetEmbeddedFrames } from "./tools/frame-utils.js";

export class ToolCoordinator {
  constructor(app) {
    this.app = app;
    this.participants = new ParticipantToolManager(app);
    this.operator = new OperatorToolManager(app);
    this.handleParticipantSyncEvent = this.participants.handleSyncEvent;
    this.handleParticipantSelectionBroadcast = this.participants.handleSelectionBroadcast;
    this.lastOperatorContextSignature = null;
  }

  logFlow(message, detail = null) {
    this.app?.logFlowEvent?.(message, detail);
  }

  resetFlowState() {
    this.logFlow("埋め込みツールの状態を初期化します");
    resetEmbeddedFrames();
    this.participants.resetFlowState();
    this.operator.resetFlowState();
    this.prepareFrames();
    this.lastOperatorContextSignature = null;
  }

  resetContext(options) {
    this.logFlow("埋め込みツールの共有コンテキストをリセットします", options);
    this.participants.resetContext(options);
    this.lastOperatorContextSignature = null;
    this.syncOperatorContext({
      context: {
        eventId: "",
        scheduleId: "",
        eventName: "",
        scheduleLabel: "",
        startAt: "",
        endAt: "",
        operatorMode: this.app.operatorMode
      },
      force: true,
      reason: "reset-context"
    }).catch((error) => logError("Failed to reset operator context", error));
  }

  prepareFrames() {
    prepareEmbeddedFrames(this.app.dom);
  }

  isPendingSync() {
    return this.participants.isPendingSync();
  }

  setPendingSync(flag) {
    const previous = this.participants.isPendingSync();
    this.participants.setPendingSync(flag);
    const next = this.participants.isPendingSync();
    if (previous !== next) {
      this.logFlow("参加者ツールの同期待機状態を更新しました", {
        previous,
        next
      });
    }
  }

  prepareContextForSelection() {
    const selection = this.app.getCurrentSelectionContext();
    const pendingBefore = this.participants.isPendingSync();
    this.logFlow("参加者ツールへのコンテキスト準備を開始します", {
      selection,
      pendingBefore,
      activePanel: this.app.activePanel
    });
    const shouldSyncImmediately = this.participants.prepareContextForSelection();
    const pendingAfter = this.participants.isPendingSync();
    this.logFlow("参加者ツールのコンテキスト準備が完了しました", {
      selection,
      shouldSyncImmediately,
      pendingAfter
    });
    this.syncOperatorContext({ reason: "prepare-selection" }).catch((error) =>
      logError("Failed to sync operator context", error)
    );
    if (shouldSyncImmediately) {
      this.logFlow("選択変更に伴い埋め込みツールの即時同期を実行します", { selection });
      this.syncEmbeddedTools({ reason: "prepare-selection" }).catch((error) =>
        logError("Failed to sync tools", error)
      );
    }
    return shouldSyncImmediately;
  }

  async syncEmbeddedTools({ reason = "unspecified" } = {}) {
    this.prepareFrames();
    const selection = this.app.getCurrentSelectionContext();
    this.logFlow("埋め込みツールの同期を開始します", {
      reason,
      selection,
      pendingBefore: this.participants.isPendingSync()
    });
    const result = await this.participants.sync();
    const participantContext = result?.context || null;
    this.logFlow("参加者ツールの同期が完了しました", {
      reason,
      selection,
      hasContext: Boolean(participantContext)
    });
    if (participantContext) {
      await this.syncOperatorContext({
        context: participantContext,
        force: true,
        reason: "embedded-sync"
      });
    } else {
      await this.syncOperatorContext({ reason: "embedded-sync" });
    }
    this.logFlow("埋め込みツールの同期を完了しました", {
      reason,
      selection
    });
  }

  preloadOperatorGlobals() {
    return this.operator.preloadGlobals();
  }

  setDrawerState(state) {
    return this.operator.setDrawerState(state);
  }

  buildOperatorContextSignature(context = {}) {
    const ensure = (value) => String(value ?? "").trim();
    return [
      ensure(context.eventId),
      ensure(context.scheduleId),
      ensure(context.eventName),
      ensure(context.scheduleLabel),
      ensure(context.startAt),
      ensure(context.endAt),
      ensure(normalizeOperatorMode(context.operatorMode ?? this.app.operatorMode))
    ].join("::");
  }

  async syncOperatorContext({ context: overrideContext = null, force = false, reason = "unspecified" } = {}) {
    const baseContext = overrideContext && typeof overrideContext === "object"
      ? { ...overrideContext }
      : { ...this.app.getCurrentSelectionContext() };
    baseContext.operatorMode = normalizeOperatorMode(
      baseContext.operatorMode ?? this.app.operatorMode
    );
    const signature = this.buildOperatorContextSignature(baseContext);
    const alreadyApplied = signature === this.lastOperatorContextSignature;
    this.logFlow("テロップ操作パネルへのコンテキスト同期を要求しました", {
      reason,
      force,
      signature,
      alreadyApplied
    });
    if (!force && alreadyApplied) {
      return;
    }
    this.lastOperatorContextSignature = signature;
    try {
      this.logFlow("テロップ操作パネルへコンテキストを適用します", {
        reason,
        signature,
        context: {
          eventId: baseContext.eventId || "",
          scheduleId: baseContext.scheduleId || "",
          scheduleLabel: baseContext.scheduleLabel || "",
          operatorMode: baseContext.operatorMode || ""
        }
      });
      await this.operator.applyContext(baseContext);
      this.logFlow("テロップ操作パネルへのコンテキスト適用が完了しました", {
        reason,
        signature
      });
    } catch (error) {
      this.lastOperatorContextSignature = null;
      this.logFlow("テロップ操作パネルへのコンテキスト適用に失敗しました", {
        reason,
        signature,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
      logError("Failed to sync operator context", error);
    }
  }
}
