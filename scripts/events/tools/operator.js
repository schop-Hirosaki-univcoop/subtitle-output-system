// tools/operator.js: オペレーター用ツールの状態管理と同期処理を提供します。
import { logError } from "../helpers.js";

/**
 * ローダー状態の初期値を生成します。
 * 非同期読み込み処理の重複実行を防ぐ目的で利用します。
 * @returns {{ promise: Promise<unknown>|null, ready: boolean }}
 */
function createLoaderState() {
  return { promise: null, ready: false };
}

/**
 * オペレーター埋め込みツールのライフサイクルを管理するマネージャです。
 * 遅延ロード、事前ウォームアップ、状態同期、ドロワー制御を担当します。
 */
export class OperatorToolManager {
  constructor(app) {
    this.app = app;
    this.loaderState = createLoaderState();
    this.preloadPromise = null;
  }

  resetFlowState() {
    this.loaderState = createLoaderState();
    this.preloadPromise = null;
  }

  async load() {
    const state = this.loaderState;
    if (state.ready) {
      return;
    }

    if (!state.promise) {
      state.promise = (async () => {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.operatorEmbedPrefix = "op-";
        }
        await import("../../operator/index.js");
        state.ready = true;
      })().catch((error) => {
        logError("Failed to load operator tool", error);
        state.ready = false;
        state.promise = null;
        throw error;
      });
    }

    await state.promise;
  }

  async ensureReady() {
    await this.load();
    if (window.operatorEmbed?.waitUntilReady) {
      try {
        await window.operatorEmbed.waitUntilReady();
      } catch (error) {
        logError("Failed to wait for operator tool", error);
      }
    }
    return window.operatorEmbed?.app || null;
  }

  preloadGlobals() {
    if (!this.preloadPromise) {
      this.preloadPromise = (async () => {
        try {
          await this.ensureReady();
        } catch (error) {
          logError("Failed to preload operator tool", error);
        }
      })();
    }
    return this.preloadPromise;
  }

  async applyContext(context) {
    const payload = context && typeof context === "object" ? context : {};
    const hasSelection = Boolean(
      (payload.eventId && String(payload.eventId).trim()) ||
        (payload.scheduleId && String(payload.scheduleId).trim()) ||
        (payload.eventName && String(payload.eventName).trim()) ||
        (payload.scheduleLabel && String(payload.scheduleLabel).trim())
    );
    const hasEmbed = typeof window !== "undefined" && window.operatorEmbed?.app;
    const summary = {
      eventId: payload.eventId || "",
      scheduleId: payload.scheduleId || "",
      scheduleLabel: payload.scheduleLabel || "",
      operatorMode: payload.operatorMode || ""
    };
    this.app?.logFlowEvent?.("テロップ操作パネルへのコンテキスト適用リクエストを受け付けました", {
      hasSelection,
      hasEmbed,
      summary
    });
    if (!hasSelection && !hasEmbed) {
      this.app?.logFlowEvent?.("テロップ操作パネルへのコンテキスト適用をスキップします", {
        reason: "no-selection",
        summary
      });
      return;
    }
    try {
      const app = await this.ensureReady();
      this.app?.logFlowEvent?.("テロップ操作パネルにコンテキストを適用します", {
        summary,
        ready: Boolean(app)
      });
      app?.setContext?.(payload);
      this.app?.logFlowEvent?.("テロップ操作パネルへのコンテキスト適用が完了しました", {
        summary
      });
    } catch (error) {
      this.app?.logFlowEvent?.("テロップ操作パネルへのコンテキスト適用に失敗しました", {
        summary,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
      logError("Failed to sync operator tool", error);
    }
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

    const app = await this.ensureReady();
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
}
