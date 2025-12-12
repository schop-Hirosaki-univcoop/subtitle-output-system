// navigation-manager.js: イベント管理画面の画面遷移制御を担当します。
// パネル表示、ステージ管理、ナビゲーションボタンの制御を管理します。

import {
  STAGE_SEQUENCE,
  STAGE_INFO,
  PANEL_CONFIG,
  PANEL_STAGE_INFO,
  FOCUSABLE_SELECTOR
} from "../config.js";
import { OPERATOR_MODE_TELOP } from "../../shared/operator-modes.js";
import { buildContextDescription } from "../helpers.js";
import { logError } from "../helpers.js";

/**
 * 画面遷移制御クラス
 * EventAdminApp から画面遷移制御機能を分離したモジュール
 */
export class EventNavigationManager {
  constructor(app) {
    this.app = app;
    
    // 画面遷移関連のプロパティ
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.pendingNavigationClearTimer = 0;
  }

  /**
   * ステージを設定します。
   * @param {string} stage
   */
  setStage(stage) {
    if (!STAGE_SEQUENCE.includes(stage)) {
      return;
    }
    this.stage = stage;
    this.stageHistory.add(stage);
    this.app.updateStageUi();
    this.updateFlowButtons();
    this.app.updateSelectionNotes();
  }

  /**
   * パネルを表示します。
   * @param {string} panel
   */
  showPanel(panel) {
    let normalized = PANEL_CONFIG[panel] ? panel : "events";
    if (normalized === "operator" && this.app.operatorMode !== OPERATOR_MODE_TELOP) {
      const fallback = this.getOperatorPanelFallbackTarget();
      if (fallback && fallback !== "operator") {
        this.app.logFlowState("テロップ操作なしモードのためテロップ操作パネルを開けません", {
          requestedPanel: panel || "",
          fallbackPanel: fallback
        });
        normalized = fallback;
      } else {
        normalized = "events";
      }
    }
    const config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    if (config.requireEvent && !this.app.selectedEventId) {
      this.app.revealEventSelectionCue();
      this.activePanel = "events";
      this.setStage("events");
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    if (config.requireSchedule && !this.app.selectedScheduleId) {
      this.app.revealScheduleSelectionCue();
      this.activePanel = this.app.selectedEventId ? "schedules" : "events";
      this.setStage(this.activePanel);
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    this.activePanel = normalized;
    this.setStage(config.stage);
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    if (config.stage === "tabs") {
      this.app.tools.prepareFrames();
      const hasSelection = this.app.selectedEventId && this.app.selectedScheduleId;
      if (config.requireSchedule && hasSelection) {
        this.app.tools.setPendingSync(false);
        this.app.tools
          .syncEmbeddedTools({ reason: "panel-activation" })
          .catch((error) => logError("Failed to sync tools", error));
      } else if (this.app.tools.isPendingSync() && hasSelection) {
        this.app.tools.setPendingSync(false);
        this.app.tools
          .syncEmbeddedTools({ reason: "pending-sync-flush" })
          .catch((error) => logError("Failed to sync tools", error));
      }
    }
    this.handlePanelSetup(normalized, config).catch((error) => logError("Failed to prepare panel", error));
    
    // パネル表示後にflow-stage-panelsにフォーカスを当てる
    if (this.app.dom.flowStagePanels) {
      // 次のフレームでフォーカスを当てる（DOM更新を待つ）
      requestAnimationFrame(() => {
        if (this.app.dom.flowStagePanels && !this.app.activeDialog) {
          this.app.dom.flowStagePanels.focus();
        }
      });
    }
  }

  /**
   * パネルセットアップを処理します。
   * @param {string} panel
   * @param {object} config
   */
  async handlePanelSetup(panel, config) {
    if (config.stage !== "tabs") {
      await this.app.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (config.requireSchedule) {
      await this.app.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (panel === "dictionary") {
      await this.app.tools.setDrawerState({ dictionary: true, logs: false });
    } else if (panel === "logs") {
      await this.app.tools.setDrawerState({ dictionary: false, logs: true });
    } else {
      await this.app.tools.setDrawerState({ dictionary: false, logs: false });
    }
  }

  /**
   * パネルを有効化できるかどうかを判定します。
   * @param {string} panel
   * @param {object} config
   * @returns {boolean}
   */
  canActivatePanel(panel, config = PANEL_CONFIG[panel]) {
    const rules = config || PANEL_CONFIG.events;
    if ((panel || "") === "operator" && this.app.operatorMode !== OPERATOR_MODE_TELOP) {
      return false;
    }
    if (rules.requireEvent && !this.app.selectedEventId) {
      return false;
    }
    if (rules.requireSchedule && (!this.app.selectedScheduleId || !this.app.currentUser)) {
      return false;
    }
    return true;
  }

  /**
   * オペレーターパネルのフォールバックターゲットを取得します。
   * @param {object} options
   * @returns {string}
   */
  getOperatorPanelFallbackTarget({ preferSchedules = false } = {}) {
    if (!preferSchedules && this.canActivatePanel("participants", PANEL_CONFIG.participants)) {
      return "participants";
    }
    if (this.canActivatePanel("schedules", PANEL_CONFIG.schedules)) {
      return "schedules";
    }
    return "events";
  }

  /**
   * パネルモジュールを取得します。
   * @returns {object}
   */
  getPanelModules() {
    return {
      events: this.app.dom.eventsModule,
      schedules: this.app.dom.schedulesModule,
      gl: this.app.dom.glPanel,
      "gl-faculties": this.app.dom.glFacultyPanel,
      participants: this.app.dom.participantsPanel,
      operator: this.app.dom.operatorPanel,
      dictionary: this.app.dom.dictionaryPanel,
      pickup: this.app.dom.pickupPanel,
      logs: this.app.dom.logsPanel
    };
  }

  /**
   * モジュールの可視性を設定します。
   * @param {HTMLElement} module
   * @param {boolean} isVisible
   */
  setModuleVisibility(module, isVisible) {
    if (!module) return;
    module.hidden = !isVisible;
    module.classList.toggle("is-active", isVisible);
    this.setModuleAccessibility(module, isVisible);
  }

  /**
   * パネルの可視性を更新します。
   */
  updatePanelVisibility() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const modules = this.getPanelModules();
    Object.entries(modules).forEach(([name, element]) => {
      this.setModuleVisibility(element, name === activePanel);
    });
  }

  /**
   * パネルナビゲーションを更新します。
   */
  updatePanelNavigation() {
    const buttons = this.app.dom.panelButtons || [];
    buttons.forEach((button) => {
      const target = button.dataset.panelTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !this.canActivatePanel(target, config);
      button.disabled = disabled;
      const isActive = target === this.activePanel;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
    const shouldHidePanelNavigation = activeConfig.stage === "tabs";
    const navigations = this.app.dom.flowNavigations || [];
    navigations.forEach((nav) => {
      if (!nav) return;
      const isPanelNavigation = nav.classList.contains("flow-navigation--panel");
      if (isPanelNavigation) {
        nav.hidden = shouldHidePanelNavigation;
      } else {
        nav.hidden = false;
      }
    });
    this.updateNavigationButtons();
  }

  /**
   * ナビゲーションボタンを更新します。
   */
  updateNavigationButtons() {
    const buttons = this.app.dom.navigationButtons || [];
    buttons.forEach((button) => {
      if (!button) return;
      const target = button.dataset.flowNavTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !target || target === this.activePanel || !this.canActivatePanel(target, config);
      button.disabled = disabled;
    });
  }

  /**
   * サイドバーボタンを更新します。
   */
  updateSidebarButtons() {
    // サイドバーボタン（3-9: participants, gl, gl-faculties, operator, dictionary, pickup, logs）
    // をイベント確定または日程確定後に有効化
    const buttons = this.app.dom.sidebarPanelButtons || [];
    const eventCommitted = this.app.eventSelectionCommitted;
    const scheduleCommitted = this.app.scheduleSelectionCommitted;
    const canUseSidebarButtons = eventCommitted || scheduleCommitted;

    buttons.forEach((button) => {
      if (!button) return;
      const target = button.dataset.panelTarget || "";
      
      // イベントと日程のカード（1-2）は除外
      if (target === "events" || target === "schedules") {
        return;
      }

      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const canActivate = this.canActivatePanel(target, config);
      
      // サイドバーボタン（3-9）は、イベント確定または日程確定後に有効化
      const shouldEnable = canUseSidebarButtons && canActivate && target !== this.activePanel;
      button.disabled = !shouldEnable;
    });
  }

  /**
   * モジュールのアクセシビリティを設定します。
   * @param {HTMLElement} module
   * @param {boolean} isActive
   */
  setModuleAccessibility(module, isActive) {
    if (!module) return;
    if (typeof module.inert !== "undefined") {
      module.inert = !isActive;
    } else if (!isActive) {
      module.setAttribute("inert", "");
    } else {
      module.removeAttribute("inert");
    }

    if (isActive) {
      module.removeAttribute("aria-hidden");
      module.classList.remove("is-inert");
    } else {
      module.setAttribute("aria-hidden", "true");
      module.classList.add("is-inert");
    }

    const focusable = module.querySelectorAll(FOCUSABLE_SELECTOR);
    focusable.forEach((element) => {
      if (isActive) {
        if (Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
          const previous = element.dataset.flowSavedTabindex;
          if (previous === "") {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", previous);
          }
          delete element.dataset.flowSavedTabindex;
        }
      } else if (!Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
        const current = element.getAttribute("tabindex");
        element.dataset.flowSavedTabindex = current ?? "";
        element.setAttribute("tabindex", "-1");
      } else {
        element.setAttribute("tabindex", "-1");
      }
    });
  }

  /**
   * ステージインジケーターを更新します。
   */
  updateStageIndicator() {
    if (!Array.isArray(this.app.dom.stageIndicators)) return;
    const currentIndex = STAGE_SEQUENCE.indexOf(this.stage);
    this.app.dom.stageIndicators.forEach((indicator) => {
      const stageId = indicator?.dataset?.stageIndicator || "";
      const stageIndex = STAGE_SEQUENCE.indexOf(stageId);
      if (stageIndex === -1) return;
      indicator.classList.toggle("is-active", stageIndex === currentIndex);
      indicator.classList.toggle("is-complete", stageIndex < currentIndex);
      if (stageIndex === currentIndex) {
        indicator.setAttribute("aria-current", "step");
      } else {
        indicator.removeAttribute("aria-current");
      }
    });
  }

  /**
   * ステージヘッダーを更新します。
   */
  updateStageHeader() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const panelConfig = PANEL_CONFIG[activePanel] || PANEL_CONFIG.events;
    const stageInfo = PANEL_STAGE_INFO[activePanel] || STAGE_INFO[panelConfig.stage] || null;

    const title = stageInfo?.title ? String(stageInfo.title).trim() : "";
    const description = stageInfo?.description ? String(stageInfo.description).trim() : "";
    let baseText = "";
    if (title && description) {
      baseText = `${title} — ${description}`;
    } else if (description) {
      baseText = description;
    } else if (title) {
      baseText = title;
    }

    const needsEvent = Boolean(panelConfig.requireEvent || panelConfig.requireSchedule);
    const needsSchedule = Boolean(panelConfig.requireSchedule);
    const event = needsEvent ? this.app.getSelectedEvent() : null;
    const schedule = needsSchedule ? this.app.getSelectedSchedule() : null;

    if (needsEvent || needsSchedule) {
      const prefix = baseText || title || "選択対象";
      baseText = buildContextDescription(prefix, event, needsSchedule ? schedule : null);
    }

    this.app.stageNote = (baseText || "").trim();
    this.app.applyMetaNote();
  }

  /**
   * フローボタンを更新します。
   */
  updateFlowButtons() {
    const signedIn = Boolean(this.app.currentUser);
    const hasEvent = Boolean(this.app.selectedEventId);
    const hasSchedule = Boolean(this.app.selectedScheduleId);

    if (this.app.dom.addEventButton) {
      this.app.dom.addEventButton.disabled = !signedIn;
    }
    if (this.app.dom.refreshButton) {
      this.app.dom.refreshButton.disabled = !signedIn;
    }
    if (this.app.dom.eventPrintButton) {
      const hasEvents = this.app.events.length > 0;
      this.app.dom.eventPrintButton.disabled = !signedIn || !hasEvents;
    }
    if (this.app.dom.nextButton) {
      this.app.dom.nextButton.disabled = !signedIn || !hasEvent;
    }
    if (this.app.dom.addScheduleButton) {
      this.app.dom.addScheduleButton.disabled = !signedIn || !hasEvent;
    }
    if (this.app.dom.scheduleRefreshButton) {
      this.app.dom.scheduleRefreshButton.disabled = !signedIn || !hasEvent;
    }
    if (this.app.dom.scheduleNextButton) {
      this.app.dom.scheduleNextButton.disabled = !signedIn || !hasSchedule;
    }
    this.updateNavigationButtons();
    this.updateSidebarButtons();
  }

  /**
   * ステージUIを更新します。
   */
  updateStageUi() {
    if (this.app.dom.main) {
      this.app.dom.main.dataset.stage = this.stage;
    }
    this.updateStageHeader();
    this.updateStageIndicator();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.app.updateChatLayoutMetrics();
  }

  /**
   * 保留中のナビゲーションタイマーをクリアします。
   */
  clearPendingNavigationTimer() {
    if (!this.pendingNavigationClearTimer) {
      return;
    }
    const timerHost = this.getTimerHost();
    timerHost.clearTimeout(this.pendingNavigationClearTimer);
    this.pendingNavigationClearTimer = 0;
  }

  /**
   * 保留中のナビゲーションクリアをスケジュールします。
   */
  schedulePendingNavigationClear() {
    const timerHost = this.getTimerHost();
    this.clearPendingNavigationTimer();
    this.pendingNavigationClearTimer = timerHost.setTimeout(() => {
      this.pendingNavigationClearTimer = 0;
      this.pendingNavigationTarget = "";
      this.pendingNavigationMeta = null;
      this.app.awaitingScheduleConflictPrompt = false;
      this.app.syncScheduleConflictPromptState();
    }, this.getPendingNavigationClearDelayMs());
  }

  /**
   * タイマーホストを取得します。
   * @returns {object}
   */
  getTimerHost() {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      return window;
    }
    if (typeof global !== "undefined" && typeof global.setTimeout === "function") {
      return global;
    }
    return {
      setTimeout: () => 0,
      clearTimeout: () => {}
    };
  }

  /**
   * 保留中のナビゲーションクリアの遅延時間を取得します。
   * @returns {number}
   */
  getPendingNavigationClearDelayMs() {
    return 5_000;
  }

  /**
   * 状態をリセットします。
   */
  resetState() {
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.clearPendingNavigationTimer();
  }
}

