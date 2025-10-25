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

  resetFlowState() {
    resetEmbeddedFrames();
    this.participants.resetFlowState();
    this.operator.resetFlowState();
    this.prepareFrames();
    this.lastOperatorContextSignature = null;
  }

  resetContext(options) {
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
      force: true
    }).catch((error) => logError("Failed to reset operator context", error));
  }

  prepareFrames() {
    prepareEmbeddedFrames(this.app.dom);
  }

  isPendingSync() {
    return this.participants.isPendingSync();
  }

  setPendingSync(flag) {
    this.participants.setPendingSync(flag);
  }

  prepareContextForSelection() {
    const shouldSyncImmediately = this.participants.prepareContextForSelection();
    this.syncOperatorContext().catch((error) => logError("Failed to sync operator context", error));
    if (shouldSyncImmediately) {
      this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
    }
  }

  async syncEmbeddedTools() {
    this.prepareFrames();
    const result = await this.participants.sync();
    if (result?.context) {
      await this.syncOperatorContext({ context: result.context, force: true });
    } else {
      await this.syncOperatorContext();
    }
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

  async syncOperatorContext({ context: overrideContext = null, force = false } = {}) {
    const baseContext = overrideContext && typeof overrideContext === "object"
      ? { ...overrideContext }
      : { ...this.app.getCurrentSelectionContext() };
    baseContext.operatorMode = normalizeOperatorMode(
      baseContext.operatorMode ?? this.app.operatorMode
    );
    const signature = this.buildOperatorContextSignature(baseContext);
    if (!force && signature === this.lastOperatorContextSignature) {
      return;
    }
    this.lastOperatorContextSignature = signature;
    try {
      await this.operator.applyContext(baseContext);
    } catch (error) {
      this.lastOperatorContextSignature = null;
      logError("Failed to sync operator context", error);
    }
  }
}
