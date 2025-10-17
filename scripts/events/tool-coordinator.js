import { logError } from "./helpers.js";
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
  }

  resetFlowState() {
    resetEmbeddedFrames();
    this.participants.resetFlowState();
    this.operator.resetFlowState();
    this.prepareFrames();
  }

  resetContext(options) {
    this.participants.resetContext(options);
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
    if (shouldSyncImmediately) {
      this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
    }
  }

  async syncEmbeddedTools() {
    this.prepareFrames();
    const result = await this.participants.sync();
    if (result?.context) {
      await this.operator.applyContext(result.context);
    }
  }

  preloadOperatorGlobals() {
    return this.operator.preloadGlobals();
  }

  setDrawerState(state) {
    return this.operator.setDrawerState(state);
  }
}
