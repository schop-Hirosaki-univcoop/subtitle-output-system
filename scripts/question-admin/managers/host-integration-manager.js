// host-integration-manager.js: 埋め込みモード・ホスト統合機能のマネージャークラス
// 埋め込みモードとホスト統合機能を担当します。

/**
 * 埋め込みモード・ホスト統合機能のマネージャークラス
 * QuestionAdminApp から埋め込みモード・ホスト統合機能を分離したモジュール
 */
export class HostIntegrationManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.normalizeKey = context.normalizeKey;
    this.selectEvent = context.selectEvent;
    this.loadEvents = context.loadEvents;
    this.finalizeEventLoad = context.finalizeEventLoad;
    this.updateParticipantContext = context.updateParticipantContext;
    
    // 定数
    this.HOST_SELECTION_ATTRIBUTE_KEYS = context.HOST_SELECTION_ATTRIBUTE_KEYS;
    
    // 一時的な依存関数（後で移行予定）
    this.applySelectionContext = context.applySelectionContext;
    this.stopHostSelectionBridge = context.stopHostSelectionBridge;
    this.startHostSelectionBridge = context.startHostSelectionBridge;
    
    // 内部状態
    this.embedReadyDeferred = null;
    this.hostSelectionBridge = {
      observer: null,
      lastSignature: "",
      pendingSignature: ""
    };
    this.lastSelectionBroadcastSignature = "";
    this.hostIntegration = {
      controller: null,
      selectionUnsubscribe: null,
      eventsUnsubscribe: null
    };
  }

  /**
   * 埋め込みプレフィックスの取得
   * @returns {string}
   */
  getEmbedPrefix() {
    if (typeof document === "undefined") {
      return "";
    }
    const html = document.documentElement;
    const existingPrefix = html?.dataset?.qaEmbedPrefix?.trim();
    if (existingPrefix) {
      return existingPrefix;
    }

    const embedSurface = document.querySelector("[data-qa-embed]");
    if (embedSurface) {
      const detectedPrefix =
        embedSurface.getAttribute("data-qa-embed-prefix")?.trim() || "qa-";
      if (html) {
        html.dataset.qaEmbedPrefix = detectedPrefix;
      }
      return detectedPrefix;
    }

    return "";
  }

  /**
   * 埋め込みモードの判定
   * @returns {boolean}
   */
  isEmbeddedMode() {
    return Boolean(this.getEmbedPrefix());
  }

  /**
   * 埋め込み準備完了の待機
   * @returns {Promise}
   */
  waitForEmbedReady() {
    if (this.state.user) {
      return Promise.resolve();
    }
    if (this.embedReadyDeferred?.promise) {
      return this.embedReadyDeferred.promise;
    }
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    this.embedReadyDeferred = { promise, resolve };
    return promise;
  }

  /**
   * 埋め込み準備完了の解決
   */
  resolveEmbedReady() {
    if (this.embedReadyDeferred?.resolve) {
      this.embedReadyDeferred.resolve();
    }
    this.embedReadyDeferred = null;
  }

  /**
   * ホストアタッチ状態の判定
   * @returns {boolean}
   */
  isHostAttached() {
    return Boolean(this.hostIntegration.controller);
  }

  /**
   * ホストコントローラーの取得
   * @returns {Object|null}
   */
  getHostController() {
    return this.hostIntegration.controller || null;
  }

  /**
   * ホストのデタッチ
   */
  detachHost() {
    if (this.hostIntegration.selectionUnsubscribe) {
      try {
        this.hostIntegration.selectionUnsubscribe();
      } catch (error) {
        console.warn("Failed to detach host selection listener", error);
      }
    }
    if (this.hostIntegration.eventsUnsubscribe) {
      try {
        this.hostIntegration.eventsUnsubscribe();
      } catch (error) {
        console.warn("Failed to detach host events listener", error);
      }
    }
    this.hostIntegration.controller = null;
    this.hostIntegration.selectionUnsubscribe = null;
    this.hostIntegration.eventsUnsubscribe = null;
    if (this.startHostSelectionBridge) {
      this.startHostSelectionBridge();
    }
  }

  /**
   * ホストのアタッチ
   * @param {Object} controller - ホストコントローラー
   */
  attachHost(controller) {
    this.detachHost();
    if (!controller || typeof controller !== "object") {
      return;
    }
    this.hostIntegration.controller = controller;
    this.stopHostSelectionBridge();
    this.hostSelectionBridge.lastSignature = "";
    this.hostSelectionBridge.pendingSignature = "";

    if (typeof controller.subscribeSelection === "function") {
      this.hostIntegration.selectionUnsubscribe = controller.subscribeSelection(
        (detail) => this.handleHostSelection(detail)
      );
    }
    if (typeof controller.subscribeEvents === "function") {
      this.hostIntegration.eventsUnsubscribe = controller.subscribeEvents(
        (events) => this.handleHostEventsUpdate(events)
      );
    }

    if (typeof controller.getEvents === "function") {
      try {
        const events = controller.getEvents();
        this.applyHostEvents(events, { preserveSelection: true });
      } catch (error) {
        console.warn("Failed to fetch events from host", error);
      }
    }

    if (typeof controller.getSelection === "function") {
      try {
        const selection = controller.getSelection();
        if (selection) {
          const promise = this.applySelectionContext(selection);
          if (promise && typeof promise.catch === "function") {
            promise.catch((error) => {
              console.error("Failed to apply initial host selection", error);
            });
          }
        }
      } catch (error) {
        console.warn("Failed to fetch initial selection from host", error);
      }
    }
  }

  /**
   * ホストイベントのクローン
   * @param {Object} event - イベントオブジェクト
   * @returns {Object|null}
   */
  cloneHostEvent(event) {
    if (!event || typeof event !== "object") {
      return null;
    }
    const schedules = Array.isArray(event.schedules)
      ? event.schedules.map((schedule) => ({ ...schedule }))
      : [];
    const scheduleCount = typeof event.scheduleCount === "number" ? event.scheduleCount : schedules.length;
    const totalParticipants = typeof event.totalParticipants === "number"
      ? event.totalParticipants
      : schedules.reduce((acc, item) => acc + Number(item?.participantCount || 0), 0);
    return {
      ...event,
      schedules,
      scheduleCount,
      totalParticipants
    };
  }

  /**
   * ホストイベントの適用
   * @param {Array} events - イベント配列
   * @param {Object} options - オプション
   * @param {boolean} options.preserveSelection - 選択を保持するか
   */
  applyHostEvents(events = [], { preserveSelection = true } = {}) {
    const previousEventId = preserveSelection ? this.state.selectedEventId : null;
    const previousScheduleId = preserveSelection ? this.state.selectedScheduleId : null;
    const previousEventsSnapshot = preserveSelection && Array.isArray(this.state.events)
      ? this.state.events.map((event) => ({
          id: event.id,
          name: event.name,
          schedules: Array.isArray(event.schedules)
            ? event.schedules.map((schedule) => ({ ...schedule }))
            : []
        }))
      : [];
    const cloned = Array.isArray(events)
      ? events.map((event) => this.cloneHostEvent(event)).filter(Boolean)
      : [];
    this.state.events = cloned;
    this.finalizeEventLoad({
      preserveSelection,
      previousEventId,
      previousScheduleId,
      previousEventsSnapshot,
      preserveStatus: true
    });
  }

  /**
   * ホスト選択の処理
   * @param {Object} detail - 選択詳細
   */
  handleHostSelection(detail) {
    if (!detail || typeof detail !== "object") {
      return;
    }
    const promise = this.applySelectionContext(detail);
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        console.error("Failed to apply selection from host", error);
      });
    }
  }

  /**
   * ホストイベント更新の処理
   * @param {Array} events - イベント配列
   */
  handleHostEventsUpdate(events) {
    this.applyHostEvents(events, { preserveSelection: true });
  }
}

