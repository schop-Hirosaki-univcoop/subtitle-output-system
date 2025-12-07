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
    this.selectSchedule = context.selectSchedule;
    this.refreshScheduleLocationHistory = context.refreshScheduleLocationHistory;
    this.populateScheduleLocationOptions = context.populateScheduleLocationOptions;
    this.hostSelectionSignature = context.hostSelectionSignature;
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
    
    // 選択ブロードキャスト関連の依存関数（後で移行予定）
    // isEmbeddedMode は既にメソッドとして実装されているため、依存関数として受け取る必要はない
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
  async attachHost(controller) {
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
          try {
            await this.applySelectionContext(selection);
          } catch (error) {
            console.error("Failed to apply initial host selection", error);
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
  async handleHostSelection(detail) {
    if (!detail || typeof detail !== "object") {
      return;
    }
    try {
      await this.applySelectionContext(detail);
    } catch (error) {
      console.error("Failed to apply selection from host", error);
    }
  }

  /**
   * ホストイベント更新の処理
   * @param {Array} events - イベント配列
   */
  handleHostEventsUpdate(events) {
    this.applyHostEvents(events, { preserveSelection: true });
  }

  /**
   * 選択ブロードキャストソースの取得
   * @returns {string}
   */
  getSelectionBroadcastSource() {
    return this.isEmbeddedMode() ? "participants" : "question-admin";
  }

  /**
   * 選択詳細のシグネチャ生成
   * @param {Object} detail - 選択詳細
   * @returns {string}
   */
  signatureForSelectionDetail(detail) {
    if (!detail || typeof detail !== "object") {
      return "";
    }
    const {
      eventId = "",
      scheduleId = "",
      eventName = "",
      scheduleLabel = "",
      startAt = "",
      endAt = ""
    } = detail;
    return [eventId, scheduleId, eventName, scheduleLabel, startAt, endAt].join("::");
  }

  /**
   * 選択詳細の構築
   * @returns {Object}
   */
  buildSelectionDetail() {
    const eventId = this.state.selectedEventId || "";
    const scheduleId = this.state.selectedScheduleId || "";
    const selectedEvent = Array.isArray(this.state.events)
      ? this.state.events.find(evt => evt.id === eventId) || null
      : null;
    const schedules = selectedEvent?.schedules || [];
    const schedule = scheduleId ? schedules.find(item => item.id === scheduleId) || null : null;
    const overrideKey = `${eventId}::${scheduleId}`;
    const override =
      scheduleId && this.state.scheduleContextOverrides instanceof Map
        ? this.state.scheduleContextOverrides.get(overrideKey) || null
        : null;

    return {
      eventId,
      scheduleId,
      eventName: selectedEvent?.name || "",
      scheduleLabel: schedule?.label || override?.scheduleLabel || "",
      startAt: schedule?.startAt || override?.startAt || "",
      endAt: schedule?.endAt || override?.endAt || ""
    };
  }

  /**
   * 選択変更のブロードキャスト
   * @param {Object} options - オプション
   * @param {string} options.source - ブロードキャストソース
   */
  broadcastSelectionChange(options = {}) {
    const source = options.source || this.getSelectionBroadcastSource();
    const detail = this.buildSelectionDetail();
    const signature = this.signatureForSelectionDetail(detail);
    const changed = signature !== this.lastSelectionBroadcastSignature;
    this.lastSelectionBroadcastSignature = signature;
    if (!changed || source === "host") {
      return;
    }
    // ホストコントローラーに選択を伝播
    if (this.isHostAttached()) {
      const controller = this.getHostController();
      if (controller && typeof controller.setSelection === "function") {
        try {
          controller.setSelection({ ...detail, source });
        } catch (error) {
          console.warn("Failed to propagate selection to host", error);
        }
      }
    }
    if (typeof document === "undefined") {
      return;
    }
    try {
      document.dispatchEvent(
        new CustomEvent("qa:selection-changed", {
          detail: {
            ...detail,
            source
          }
        })
      );
    } catch (error) {
      console.warn("Failed to dispatch selection change event", error);
    }
  }

  /**
   * 選択ブロードキャストシグネチャのリセット
   */
  resetSelectionBroadcastSignature() {
    this.lastSelectionBroadcastSignature = "";
  }

  /**
   * 選択コンテキストの適用
   * @param {Object} selection - 選択オブジェクト
   * @returns {Promise}
   */
  async applySelectionContext(selection = {}) {
    const {
      eventId = "",
      scheduleId = "",
      eventName = "",
      scheduleLabel = "",
      location = "",
      startAt = "",
      endAt = ""
    } = selection || {};
    const trimmedEventId = this.normalizeKey(eventId);
    const trimmedScheduleId = this.normalizeKey(scheduleId);
    if (!trimmedEventId) {
      this.hostSelectionBridge.lastSignature = "";
      return;
    }

    try {
      if (!(this.state.scheduleContextOverrides instanceof Map)) {
        this.state.scheduleContextOverrides = new Map();
      }
      if (!this.state.user) {
        this.state.initialSelection = {
          eventId: trimmedEventId,
          scheduleId: trimmedScheduleId || null,
          scheduleLabel: scheduleLabel || null,
          location: location || null,
          eventLabel: eventName || null,
          startAt: startAt || null,
          endAt: endAt || null
        };
        this.state.initialSelectionApplied = false;
        this.hostSelectionBridge.lastSignature = this.hostSelectionSignature({
          eventId: trimmedEventId,
          scheduleId: trimmedScheduleId,
          eventName,
          scheduleLabel,
          location,
          startAt,
          endAt
        });
        return;
      }

      if (!Array.isArray(this.state.events) || !this.state.events.some(evt => evt.id === trimmedEventId)) {
        await this.loadEvents({ preserveSelection: true });
      }

      const previousEventId = this.state.selectedEventId;
      const previousScheduleId = this.state.selectedScheduleId;
      const eventChanged = previousEventId !== trimmedEventId;
      const shouldReloadSchedule = Boolean(trimmedScheduleId)
        ? eventChanged || previousScheduleId !== trimmedScheduleId
        : false;

      if (eventChanged) {
        this.selectEvent(trimmedEventId, {
          nextScheduleId: trimmedScheduleId || null,
          skipParticipantLoad: Boolean(trimmedScheduleId),
          source: "host"
        });
      } else if (!trimmedScheduleId) {
        this.selectEvent(trimmedEventId, { source: "host" });
      }

      const selectedEvent = this.state.events.find(evt => evt.id === trimmedEventId) || null;
      if (selectedEvent && eventName) {
        selectedEvent.name = eventName;
      }

      const effectiveEventName = selectedEvent?.name || eventName || trimmedEventId;
      let effectiveScheduleLabel = scheduleLabel || (trimmedScheduleId ? trimmedScheduleId : "");
      let effectiveLocation = location || "";
      let effectiveStartAt = startAt || "";
      let effectiveEndAt = endAt || "";

      if (trimmedScheduleId) {
        const schedule = selectedEvent?.schedules?.find(item => item.id === trimmedScheduleId) || null;
        if (schedule) {
          if (scheduleLabel) schedule.label = scheduleLabel;
          if (location) schedule.location = location;
          if (startAt) schedule.startAt = startAt;
          if (endAt) schedule.endAt = endAt;
          effectiveScheduleLabel = schedule.label || trimmedScheduleId;
          effectiveLocation = schedule.location || "";
          effectiveStartAt = schedule.startAt || "";
          effectiveEndAt = schedule.endAt || "";
          if (this.state.scheduleContextOverrides instanceof Map) {
            this.state.scheduleContextOverrides.delete(`${trimmedEventId}::${trimmedScheduleId}`);
          }
        } else if (this.state.scheduleContextOverrides instanceof Map) {
          const override = {
            eventId: trimmedEventId,
            eventName: effectiveEventName,
            scheduleId: trimmedScheduleId,
            scheduleLabel: scheduleLabel || trimmedScheduleId,
            location: location || "",
            startAt: startAt || "",
            endAt: endAt || ""
          };
          this.state.scheduleContextOverrides.set(`${trimmedEventId}::${trimmedScheduleId}`, override);
          effectiveScheduleLabel = override.scheduleLabel;
          effectiveLocation = override.location || "";
          effectiveStartAt = override.startAt;
          effectiveEndAt = override.endAt;
        }
        this.selectSchedule(trimmedScheduleId, {
          forceReload: shouldReloadSchedule,
          preserveStatus: !shouldReloadSchedule,
          source: "host"
        });
      } else {
        this.updateParticipantContext({ preserveStatus: true });
      }

      this.refreshScheduleLocationHistory();
      this.populateScheduleLocationOptions(this.dom.scheduleLocationInput?.value || "");

      this.hostSelectionBridge.lastSignature = this.hostSelectionSignature({
        eventId: trimmedEventId,
        scheduleId: trimmedScheduleId,
        eventName: effectiveEventName,
        scheduleLabel: effectiveScheduleLabel,
        location: effectiveLocation,
        startAt: effectiveStartAt,
        endAt: effectiveEndAt
      });
    } catch (error) {
      console.error("questionAdminEmbed.setSelection failed", error);
      throw error;
    }
  }
}

