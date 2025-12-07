// ui-manager.js: UI 関連の機能を担当します。
export class UIManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.getEmbedPrefix = context.getEmbedPrefix;
    this.isEmbeddedMode = context.isEmbeddedMode;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    
    // 定数
    this.FOCUS_TARGETS = context.FOCUS_TARGETS;
  }

  /**
   * 要素 ID による取得
   * @param {string} id - 要素 ID
   * @returns {Element|null}
   */
  getElementById(id) {
    const prefix = this.getEmbedPrefix();
    const candidates = [];

    if (prefix) {
      candidates.push(`${prefix}${id}`);
    }

    candidates.push(id);

    if (!prefix) {
      candidates.push(`qa-${id}`);
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      const element = document.getElementById(candidate);
      if (element) {
        return element;
      }
    }

    return null;
  }

  /**
   * ユーザーサマリーの描画
   * @param {Object|null} user - ユーザーオブジェクト
   */
  renderUserSummary(user) {
    if (!this.dom.userInfo) return;
    this.dom.userInfo.innerHTML = "";
    if (!user) {
      this.dom.userInfo.hidden = true;
      this.dom.userInfo.setAttribute("aria-hidden", "true");
      return;
    }

    const safeName = String(user.displayName || "").trim();
    const safeEmail = String(user.email || "").trim();
    const label = document.createElement("span");
    label.className = "user-label";
    label.textContent = safeName && safeEmail ? `${safeName} (${safeEmail})` : safeName || safeEmail || "";
    this.dom.userInfo.appendChild(label);
    this.dom.userInfo.hidden = false;
    this.dom.userInfo.removeAttribute("aria-hidden");
  }

  /**
   * ログインエラーの設定
   * @param {string} message - エラーメッセージ
   */
  setLoginError(message = "") {
    if (!this.dom.loginError) return;
    if (message) {
      this.dom.loginError.textContent = message;
      this.dom.loginError.hidden = false;
    } else {
      this.dom.loginError.textContent = "";
      this.dom.loginError.hidden = true;
    }
  }

  /**
   * 認証 UI の設定
   * @param {boolean} signedIn - ログイン状態
   */
  setAuthUi(signedIn) {
    const embedded = this.isEmbeddedMode();
    const shouldShowLogin = !signedIn && !embedded;
    const shouldShowAdmin = signedIn || embedded;
    this.toggleSectionVisibility(this.dom.loginCard, shouldShowLogin);
    this.toggleSectionVisibility(this.dom.adminMain, shouldShowAdmin);
    if (signedIn) {
      this.renderUserSummary(this.state.user);
      this.setLoginError("");
    } else {
      this.renderUserSummary(null);
    }

    if (this.dom.headerLogout) {
      this.dom.headerLogout.hidden = !signedIn;
      if (signedIn) {
        this.dom.headerLogout.removeAttribute("aria-hidden");
        this.dom.headerLogout.removeAttribute("inert");
        this.dom.headerLogout.disabled = false;
      } else {
        this.dom.headerLogout.setAttribute("aria-hidden", "true");
        this.dom.headerLogout.setAttribute("inert", "");
        this.dom.headerLogout.disabled = true;
      }
    }

    if (this.dom.logoutButton) {
      this.dom.logoutButton.hidden = !signedIn;
      this.dom.logoutButton.disabled = !signedIn;
      if (signedIn) {
        this.dom.logoutButton.removeAttribute("aria-hidden");
        this.dom.logoutButton.removeAttribute("inert");
      } else {
        this.dom.logoutButton.setAttribute("aria-hidden", "true");
        this.dom.logoutButton.setAttribute("inert", "");
      }
    }

    if (this.dom.addEventButton) {
      this.dom.addEventButton.disabled = !signedIn;
    }

    if (!signedIn) {
      if (this.dom.addScheduleButton) this.dom.addScheduleButton.disabled = true;
      if (this.dom.csvInput) this.dom.csvInput.disabled = true;
      if (this.dom.saveButton) this.dom.saveButton.disabled = true;
    }

    // updateParticipantActionPanelState は外部から渡される必要がある
    if (this.updateParticipantActionPanelState) {
      this.updateParticipantActionPanelState();
    }
  }

  /**
   * セクション表示の切り替え
   * @param {Element} element - 要素
   * @param {boolean} visible - 表示フラグ
   */
  toggleSectionVisibility(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    if (visible) {
      element.removeAttribute("aria-hidden");
      element.removeAttribute("inert");
    } else {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }
  }

  /**
   * 参加者番号テキストの適用
   * @param {Element} element - 要素
   * @param {number|undefined} index - インデックス
   */
  applyParticipantNoText(element, index) {
    if (!element) return;
    if (Number.isFinite(index)) {
      element.textContent = String(index);
    } else {
      element.textContent = "";
    }
  }

  /**
   * フォーカスターゲット要素の解決
   * @param {string} target - ターゲット名
   * @returns {Element|null}
   */
  resolveFocusTargetElement(target) {
    if (typeof document === "undefined") {
      return null;
    }

    switch (target) {
      case "participants":
        return this.getElementById("participant-title") || this.dom.participantDescription || null;
      case "schedules":
        return this.getElementById("schedule-title") || this.dom.scheduleDescription || null;
      case "events":
        return this.getElementById("event-title") || this.dom.eventList || null;
      default:
        return null;
    }
  }

  /**
   * 初期セクションへのフォーカス
   */
  maybeFocusInitialSection() {
    const target = this.state.initialFocusTarget;
    if (!target) return;
    if (!this.FOCUS_TARGETS.has(target)) return;

    this.state.initialFocusTarget = "";
    const element = this.resolveFocusTargetElement(target);
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const needsTabIndex = !element.hasAttribute("tabindex");
    if (needsTabIndex) {
      element.setAttribute("tabindex", "-1");
      element.dataset.tempFocusTarget = "true";
    }

    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus({ preventScroll: true });
      element.classList.add("section-focus-highlight");
      window.setTimeout(() => {
        element.classList.remove("section-focus-highlight");
        if (element.dataset.tempFocusTarget) {
          element.removeAttribute("tabindex");
          delete element.dataset.tempFocusTarget;
        }
      }, 2000);
    });
  }
}

