import { logError } from "../helpers.js";

function createLoaderState() {
  return { promise: null, ready: false };
}

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
    if (!context) {
      return;
    }
    try {
      const app = await this.ensureReady();
      app?.setContext?.(context);
    } catch (error) {
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
