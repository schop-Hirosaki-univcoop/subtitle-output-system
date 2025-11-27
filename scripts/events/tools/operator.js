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
  /**
   * @param {import('../app.js').EventsApp} app - 親アプリケーションインスタンス
   */
  constructor(app) {
    this.app = app;
    this.loaderState = createLoaderState();
    this.preloadPromise = null;
  }

  /**
   * 遅延ロードやプリロードの状態を初期化します。
   * イベント切り替え時に再ロードを強制する目的で呼び出します。
   */
  resetFlowState() {
    this.loaderState = createLoaderState();
    this.preloadPromise = null;
  }

  /**
   * オペレーター埋め込みのスクリプトを遅延ロードし、失敗時は状態を巻き戻します。
   * 多重読み込みを避けるために Promise を共有します。
   * @returns {Promise<void>}
   */
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
        const operatorModuleUrl = new URL("../../operator/index.js", import.meta.url);
        await import(operatorModuleUrl.href);
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

  /**
   * 埋め込みアプリが利用可能になるまで待機し、準備完了後に内部アプリケーションインスタンスを返します。
   * @returns {Promise<import('../../operator/app.js').OperatorApp|null>}
   */
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

  /**
   * 背景でオペレーターアプリの初期化を進めておき、ユーザー操作時の待ち時間を減らします。
   * @returns {Promise<void>}
   */
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

  /**
   * 選択されたイベントコンテキストをオペレーターアプリへ通知します。
   * 事前に状態を記録しておき、実際に同期が走ったかどうかをログにも残します。
   * @param {Record<string, unknown>} context
   * @returns {Promise<void>}
   */
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

  /**
   * ルビ辞書・操作ログのドロワー開閉状態を外部から制御します。
   * 真偽値が指定されたものだけ適用し、アプリ未初期化時の呼び出しにも安全に対応します。
   * @param {{ dictionary?: boolean, logs?: boolean }} param0
   * @returns {Promise<void>}
   */
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
