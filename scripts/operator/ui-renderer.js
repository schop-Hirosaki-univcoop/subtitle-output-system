// ui-renderer.js: UI描画を担当します。
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { auth } from "./firebase.js";

/**
 * UI描画クラス
 * UI要素の描画と更新を担当します。
 */
export class UIRenderer {
  constructor(app) {
    this.app = app;
  }

  /**
   * チャンネルバナーを描画します。
   * ディスプレイの状態、割り当て情報、ロックボタンの状態を更新します。
   */
  renderChannelBanner() {
    const banner = this.app.dom.channelBanner;
    if (!banner) {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[Operator] renderChannelBanner: banner element not found");
      }
      return;
    }
    const eventId = String(this.app.state?.activeEventId || "").trim();
    if (!eventId || !this.app.isAuthorized) {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[Operator] renderChannelBanner: early return", {
          eventId: eventId || "(empty)",
          isAuthorized: this.app.isAuthorized
        });
      }
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const statusEl = this.app.dom.channelStatus;
    const assignmentEl = this.app.dom.channelAssignment;
    const lockButton = this.app.dom.channelLockButton;
    const displaySessionActive = !!this.app.state.isDisplaySessionActive;
    const renderOnline = this.app.state.renderChannelOnline !== false;
    const displayActive = this.app.isDisplayOnline();
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずにnullにする
    // これにより、イベントを選んでいない状態で古いassignmentが表示されることを防ぐ
    const rawAssignment = eventId ? (this.app.state?.channelAssignment || this.app.getDisplayAssignment()) : null;
    // 現在選択中のイベントとディスプレイの割り当てのイベントが一致する場合のみ表示
    // これにより、イベントを選んでいないのに別のイベントの情報が表示されることを防ぐ
    const assignment = rawAssignment && String(rawAssignment.eventId || "").trim() === eventId ? rawAssignment : null;
    
    // デバッグログ: assignmentの取得状況を確認
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[Operator] renderChannelBanner assignment check", {
        eventId,
        hasChannelAssignment: !!this.app.state?.channelAssignment,
        channelAssignmentEventId: this.app.state?.channelAssignment ? String(this.app.state.channelAssignment.eventId || "").trim() : null,
        channelAssignmentScheduleId: this.app.state?.channelAssignment ? String(this.app.state.channelAssignment.scheduleId || "").trim() : null,
        hasDisplaySession: !!this.app.state?.displaySession,
        displaySessionEventId: this.app.state?.displaySession ? String(this.app.state.displaySession.eventId || "").trim() : null,
        displaySessionScheduleId: this.app.state?.displaySession ? String(this.app.state.displaySession.scheduleId || "").trim() : null,
        hasDisplaySessionAssignment: this.app.state?.displaySession ? !!(this.app.state.displaySession.assignment && typeof this.app.state.displaySession.assignment === "object") : false,
        rawAssignmentEventId: rawAssignment ? String(rawAssignment.eventId || "").trim() : null,
        rawAssignmentScheduleId: rawAssignment ? String(rawAssignment.scheduleId || "").trim() : null,
        assignmentEventId: assignment ? String(assignment.eventId || "").trim() : null,
        assignmentScheduleId: assignment ? String(assignment.scheduleId || "").trim() : null,
        assignmentMatches: rawAssignment ? String(rawAssignment.eventId || "").trim() === eventId : false
      });
    }
    const channelAligned = !this.app.hasChannelMismatch();
    const telopEnabled = this.app.isTelopEnabled();
    const assetChecked = this.app.state.isDisplayAssetChecked === true;
    const assetAvailable = this.app.state.displayAssetAvailable !== false;
    let statusText = "";
    let statusClass = "channel-banner__status";
    if (assetChecked && !assetAvailable) {
      statusText = "表示端末ページ（display.html）が見つかりません。";
      statusClass += " is-alert";
    } else if (!telopEnabled) {
      statusText = "テロップ操作なしモードです。送出・固定は行えません。";
      statusClass += " is-muted";
    } else if (!renderOnline) {
      statusText = "送出端末の表示画面が切断されています。";
      statusClass += " is-alert";
    } else if (!displaySessionActive) {
      statusText = "送出端末が接続されていません。";
      statusClass += " is-alert";
    } else if (!assignment || !assignment.eventId) {
      statusText = "ディスプレイの日程が未確定です。";
      statusClass += " is-alert";
    } else if (!channelAligned) {
      const summary = this.app.describeChannelAssignment();
      statusText = summary ? `ディスプレイは${summary}に固定されています。` : "ディスプレイは別の日程に固定されています。";
      statusClass += " is-alert";
    } else {
      statusText = "ディスプレイと日程が同期しています。";
    }
    if (statusEl) {
      statusEl.className = statusClass;
      statusEl.textContent = statusText;
    }
    if (assignmentEl) {
      // assignmentがnullの場合は空文字列を表示
      const summary = assignment ? this.app.describeChannelAssignment() : "";
      assignmentEl.textContent = summary || "—";
    }
    
    // ログ出力: ディスプレイの日程情報
    if (assignment && assignment.eventId) {
      const scheduleKey = assignment.canonicalScheduleKey || `${assignment.eventId}::${normalizeScheduleId(assignment.scheduleId || "")}`;
      const formattedDate = this.app.formatScheduleDateForLog(assignment, scheduleKey);
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log(`[Operator] ディスプレイの日程は${formattedDate}です`, {
          eventId: assignment.eventId,
          scheduleId: assignment.scheduleId,
          scheduleLabel: assignment.scheduleLabel,
          scheduleKey,
          formattedDate
        });
      }
    } else {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[Operator] ディスプレイの日程は(未設定)です", {
          hasAssignment: !!assignment,
          eventId: assignment?.eventId || null
        });
      }
    }
    
    if (lockButton) {
      if (assetChecked && !assetAvailable) {
        lockButton.textContent = "ページ未配置";
        lockButton.disabled = true;
      } else if (!telopEnabled) {
        lockButton.textContent = "テロップ操作なし";
        lockButton.disabled = true;
      } else {
        const { eventId: activeEventId, scheduleId } = this.app.getActiveChannel();
        const canLock =
          displayActive &&
          !!String(activeEventId || "").trim() &&
          !!String(scheduleId || "").trim() &&
          !this.app.state.isChannelLocking;
        if (displayActive && assignment && assignment.eventId && channelAligned) {
          lockButton.textContent = "固定済み";
          lockButton.disabled = true;
        } else {
          lockButton.textContent = assignment && assignment.eventId ? "この日程に切り替え" : "この日程に固定";
          lockButton.disabled = !canLock;
        }
        if (!displayActive) {
          lockButton.textContent = "この日程に固定";
        }
      }
    }
    this.renderChannelPresenceList();
  }

  /**
   * 現在イベントに参加しているオペレーター一覧を描画します。
   * 自身のpresenceやスキップ設定に応じて補足情報を加えます。
   */
  renderChannelPresenceList() {
    const list = this.app.dom.channelPresenceList;
    const placeholder = this.app.dom.channelPresenceEmpty;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const eventId = String(this.app.state?.activeEventId || "").trim();
    if (!eventId) {
      if (placeholder) {
        placeholder.hidden = false;
      }
      return;
    }
    const presenceMap = this.app.state?.operatorPresenceByUser instanceof Map ? this.app.state.operatorPresenceByUser : new Map();
    const groups = new Map();
    const selfUid = String(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "").trim();
    const selfSessionId = String(this.app.operatorPresenceSessionId || "").trim();
    presenceMap.forEach((value, entryId) => {
      if (!value) return;
      const valueEventId = String(value.eventId || "").trim();
      if (valueEventId && valueEventId !== eventId) return;
      const scheduleKey = this.app.derivePresenceScheduleKey(eventId, value, entryId);
      const label = this.app.resolveScheduleLabel(scheduleKey, value.scheduleLabel, value.scheduleId);
      const skipTelop = Boolean(value.skipTelop);
      const entry = groups.get(scheduleKey) || {
        key: scheduleKey,
        scheduleId: String(value.scheduleId || ""),
        label,
        members: []
      };
      if (!groups.has(scheduleKey)) {
        groups.set(scheduleKey, entry);
      }
      entry.label = entry.label || label;
      const memberUid = String(value.uid || "").trim();
      const fallbackId = String(entryId);
      const isSelfSession = selfSessionId && fallbackId === selfSessionId;
      const isSelfUid = memberUid && memberUid === selfUid;
      entry.members.push({
        uid: memberUid || fallbackId,
        name: String(value.displayName || value.email || memberUid || fallbackId || "").trim() || memberUid || fallbackId,
        isSelf: Boolean(isSelfSession || isSelfUid),
        skipTelop
      });
    });
    const items = Array.from(groups.values());
    if (!items.length) {
      if (placeholder) {
        placeholder.hidden = false;
      }
      return;
    }
    if (placeholder) {
      placeholder.hidden = true;
    }
    items.sort((a, b) => (a.label || "").localeCompare(b.label || "", "ja"));
    const currentKey = this.app.getCurrentScheduleKey();
    items.forEach((group) => {
      const item = document.createElement("li");
      item.className = "channel-presence-group";
      if (group.key && group.key === currentKey) {
        item.classList.add("is-active");
      }
      const title = document.createElement("div");
      title.className = "channel-presence-group__label";
      title.textContent = group.label || "未選択";
      item.appendChild(title);
      const members = document.createElement("div");
      members.className = "channel-presence-group__names";
      if (group.members && group.members.length) {
        group.members.forEach((member) => {
          const entry = document.createElement("span");
          entry.className = "channel-presence-group__name";
          entry.textContent = member.name || member.uid || "—";
          if (member.isSelf) {
            const badge = document.createElement("span");
            badge.className = "channel-presence-self";
            badge.textContent = "自分";
            entry.appendChild(badge);
          }
          if (member.skipTelop) {
            const badge = document.createElement("span");
            badge.className = "channel-presence-support";
            badge.textContent = "テロップ操作なし";
            entry.appendChild(badge);
          }
          members.appendChild(entry);
        });
      } else {
        const empty = document.createElement("span");
        empty.className = "channel-presence-group__name";
        empty.textContent = "オペレーターなし";
        members.appendChild(empty);
      }
      item.appendChild(members);
      list.appendChild(item);
    });
  }

  /**
   * presence衝突情報を元にダイアログのUIを更新します。
   * 選択肢の表示と操作ボタンの活性状態を整えます。
   */
  renderConflictDialog() {
    const conflict = this.app.state?.scheduleConflict;
    const optionsContainer = this.app.dom.conflictOptions;
    if (!optionsContainer) {
      return;
    }
    optionsContainer.innerHTML = "";
    if (this.app.dom.conflictError) {
      this.app.dom.conflictError.hidden = true;
      this.app.dom.conflictError.textContent = "";
    }
    if (!conflict || !Array.isArray(conflict.options) || conflict.options.length === 0) {
      return;
    }
    const radioName = "op-conflict-schedule";
    conflict.options.forEach((option, index) => {
      const optionKey = option.key || `${conflict.eventId}::${normalizeScheduleId(option.scheduleId || "")}`;
      const optionId = `op-conflict-option-${index}`;
      const labelEl = document.createElement("label");
      labelEl.className = "conflict-option";
      labelEl.setAttribute("for", optionId);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = optionId;
      radio.name = radioName;
      radio.value = optionKey;
      radio.checked = optionKey === this.app.state.conflictSelection;
      radio.className = "visually-hidden";
      labelEl.appendChild(radio);

      const header = document.createElement("div");
      header.className = "conflict-option__header";
      const title = document.createElement("span");
      title.className = "conflict-option__title";
      title.textContent = this.app.resolveScheduleLabel(optionKey, option.label, option.scheduleId);
      header.appendChild(title);
      if (conflict.assignmentKey && conflict.assignmentKey === optionKey) {
        const badge = document.createElement("span");
        badge.className = "conflict-option__badge";
        badge.textContent = "ディスプレイ";
        header.appendChild(badge);
      }
      labelEl.appendChild(header);

      const members = document.createElement("div");
      members.className = "conflict-option__members";
      if (option.members && option.members.length) {
        members.textContent = option.members
          .map((member) => {
            const base = String(member.name || member.uid || "").trim() || member.uid;
            const tags = [];
            if (member.isSelf) {
              tags.push("自分");
            }
            if (member.skipTelop) {
              tags.push("テロップ操作なし");
            }
            if (!tags.length) {
              return base;
            }
            return `${base}（${tags.join("・")}）`;
          })
          .join("、");
      } else {
        members.textContent = "参加オペレーターなし";
      }
      labelEl.appendChild(members);

      optionsContainer.appendChild(labelEl);
    });
  }

  /**
   * レンダリングチャンネルの到達状況を更新し、UIへ反映します。
   * @param {boolean|null|undefined} status
   */
  updateRenderAvailability(status) {
    if (!this.app.state) {
      return;
    }
    const sessionActive = this.app.state.isDisplaySessionActive === true;
    const snapshotActive = this.app.displaySessionStatusFromSnapshot === true;
    let normalized = status === true ? true : status === false ? false : null;
    if (normalized === false && (sessionActive || snapshotActive)) {
      normalized = null;
    }
    if (this.app.state.renderChannelOnline === normalized) {
      return;
    }
    this.app.state.renderChannelOnline = normalized;
    if (typeof this.app.updateActionAvailability === "function") {
      this.app.updateActionAvailability();
    }
    if (typeof this.app.updateBatchButtonVisibility === "function") {
      this.app.updateBatchButtonVisibility();
    }
    this.renderChannelBanner();
  }

  /**
   * フッターに表示する著作権表記を現在の年に合わせて更新します。
   */
  updateCopyrightYear() {
    if (!this.app.dom.copyrightYear) return;
    const currentYear = new Date().getFullYear();
    if (currentYear <= 2025) {
      this.app.dom.copyrightYear.textContent = "2025";
    } else {
      this.app.dom.copyrightYear.textContent = `2025 - ${currentYear}`;
    }
  }
}
