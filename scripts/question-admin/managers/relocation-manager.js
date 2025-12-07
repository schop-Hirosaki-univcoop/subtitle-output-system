// relocation-manager.js: リロケーション機能のマネージャークラス
// 参加者の別日への移動機能を担当します。

/**
 * リロケーション機能のマネージャークラス
 * QuestionAdminApp からリロケーション機能を分離したモジュール
 */
export class RelocationManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.RELOCATE_LABEL = context.RELOCATE_LABEL;
    this.resolveParticipantActionTarget = context.resolveParticipantActionTarget;
    this.resolveParticipantUid = context.resolveParticipantUid;
    this.resolveParticipantStatus = context.resolveParticipantStatus;
    this.getScheduleLabel = context.getScheduleLabel;
    this.buildScheduleOptionLabel = context.buildScheduleOptionLabel;
    this.normalizeGroupNumberValue = context.normalizeGroupNumberValue;
    this.sortParticipants = context.sortParticipants;
    this.syncCurrentScheduleCache = context.syncCurrentScheduleCache;
    this.updateDuplicateMatches = context.updateDuplicateMatches;
    this.renderParticipants = context.renderParticipants;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.setUploadStatus = context.setUploadStatus;
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    this.setFormError = context.setFormError;
    this.formatParticipantIdentifier = context.formatParticipantIdentifier;
    this.commitParticipantQuickEdit = context.commitParticipantQuickEdit;
    this.getScheduleRecord = context.getScheduleRecord;
    this.ensureRowKey = context.ensureRowKey;
    this.ensureTeamAssignmentMap = context.ensureTeamAssignmentMap;
    this.findParticipantForSnapshot = context.findParticipantForSnapshot;
  }

  /**
   * 参加者スナップショットから参加者を検索
   * @param {Object} snapshot - スナップショット
   * @returns {Object|null}
   */
  findParticipantForSnapshot(snapshot) {
    if (!snapshot) {
      return null;
    }
    const uid = String(snapshot.uid || snapshot.key || "").trim();
    if (uid) {
      const matchByUid = this.state.participants.find(entry => {
        const entryUid = this.resolveParticipantUid(entry) || String(entry?.participantId || "");
        return entryUid === uid;
      });
      if (matchByUid) {
        return matchByUid;
      }
    }
    const rowKey = String(snapshot.rowKey || "").trim();
    if (rowKey) {
      const matchByRow = this.state.participants.find(entry => String(entry?.rowKey || "") === rowKey);
      if (matchByRow) {
        return matchByRow;
      }
    }
    const participantId = String(snapshot.participantId || "").trim();
    if (participantId) {
      const matchById = this.state.participants.find(entry => String(entry?.participantId || "") === participantId);
      if (matchById) {
        return matchById;
      }
    }
    return null;
  }

  /**
   * リロケーションプレビューをクリア
   * @param {Object} relocation - リロケーション情報
   */
  clearRelocationPreview(relocation) {
    if (!relocation || !relocation.eventId || !relocation.toScheduleId) {
      return;
    }
    if (!(this.state.eventParticipantCache instanceof Map)) {
      return;
    }
    const cache = this.state.eventParticipantCache.get(relocation.eventId);
    if (!cache || typeof cache !== "object") {
      return;
    }
    const list = Array.isArray(cache[relocation.toScheduleId]) ? cache[relocation.toScheduleId] : [];
    cache[relocation.toScheduleId] = list.filter(entry => {
      const entryUid = this.resolveParticipantUid(entry) || String(entry?.participantId || "");
      return entryUid !== relocation.uid;
    });
    this.state.eventParticipantCache.set(relocation.eventId, cache);
  }

  /**
   * リロケーションプレビューを更新/挿入
   * @param {Object} relocation - リロケーション情報
   */
  upsertRelocationPreview(relocation) {
    if (!relocation || !relocation.eventId || !relocation.toScheduleId) {
      return;
    }
    if (!(this.state.eventParticipantCache instanceof Map)) {
      this.state.eventParticipantCache = new Map();
    }
    const cache = this.state.eventParticipantCache.get(relocation.eventId) || {};
    const list = Array.isArray(cache[relocation.toScheduleId]) ? cache[relocation.toScheduleId].slice() : [];
    const filtered = list.filter(entry => {
      const entryUid = this.resolveParticipantUid(entry) || String(entry?.participantId || "");
      return entryUid !== relocation.uid;
    });

    const base = relocation.entrySnapshot || {};
    const destinationTeam = String(relocation.destinationTeamNumber || "");
    const sourceLabel = this.getScheduleLabel(relocation.eventId, relocation.fromScheduleId) || relocation.fromScheduleId || "";
    const scheduleRecord = this.getScheduleRecord(relocation.eventId, relocation.toScheduleId);
    const clone = this.ensureRowKey({
      key: relocation.uid,
      uid: relocation.uid,
      participantId: relocation.uid,
      legacyParticipantId: base.legacyParticipantId || "",
      name: base.name || "",
      phonetic: base.phonetic || base.furigana || "",
      furigana: base.phonetic || base.furigana || "",
      gender: base.gender || "",
      department: base.department || base.groupNumber || "",
      groupNumber: destinationTeam,
      scheduleId: relocation.toScheduleId,
      status: "relocated",
      isCancelled: false,
      isRelocated: true,
      relocationSourceScheduleId: relocation.fromScheduleId || "",
      relocationSourceScheduleLabel: sourceLabel,
      relocationDestinationTeamNumber: destinationTeam,
      token: base.token || "",
      phone: base.phone || "",
      email: base.email || "",
      guidance: base.guidance || "",
      scheduleLabel: scheduleRecord?.label || scheduleRecord?.date || scheduleRecord?.id || ""
    }, "relocation-preview");

    filtered.push(clone);
    cache[relocation.toScheduleId] = this.sortParticipants(filtered);
    this.state.eventParticipantCache.set(relocation.eventId, cache);
  }

  /**
   * リロケーションドラフトを適用
   * @param {Object} entry - 参加者エントリ
   * @param {string} destinationScheduleId - 移動先スケジュールID
   * @param {string} destinationTeamNumber - 移動先班番号
   */
  applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber) {
    const eventId = this.state.selectedEventId;
    const sourceScheduleId = this.state.selectedScheduleId;
    const uid = this.resolveParticipantUid(entry) || String(entry?.participantId || "");
    if (!eventId || !sourceScheduleId || !uid) {
      return;
    }

    const relocationMap = this.ensurePendingRelocationMap();
    const previous = relocationMap.get(uid);

    if (!destinationScheduleId) {
      if (previous) {
        this.clearRelocationPreview(previous);
        relocationMap.delete(uid);
      }
      entry.relocationDestinationScheduleId = "";
      entry.relocationDestinationScheduleLabel = "";
      entry.relocationDestinationTeamNumber = "";
      this.syncCurrentScheduleCache();
      this.updateDuplicateMatches();
      return;
    }

    const destinationLabel = this.getScheduleLabel(eventId, destinationScheduleId) || destinationScheduleId;
    entry.relocationDestinationScheduleId = destinationScheduleId;
    entry.relocationDestinationScheduleLabel = destinationLabel;
    entry.relocationDestinationTeamNumber = destinationTeamNumber;

    if (previous && previous.toScheduleId !== destinationScheduleId) {
      this.clearRelocationPreview(previous);
    }

    const snapshot = { ...entry };
    const relocation = {
      uid,
      participantId: entry.participantId,
      eventId,
      fromScheduleId: sourceScheduleId,
      toScheduleId: destinationScheduleId,
      destinationTeamNumber: destinationTeamNumber || "",
      entrySnapshot: snapshot
    };

    relocationMap.set(uid, relocation);
    this.upsertRelocationPreview(relocation);
    this.syncCurrentScheduleCache();
    this.updateDuplicateMatches();
  }

  /**
   * リロケーションドラフトを復元
   * @param {Array<string>} keys - 復元するキーのリスト
   * @returns {boolean}
   */
  restoreRelocationDrafts(keys = []) {
    if (!(this.state.relocationDraftOriginals instanceof Map)) {
      this.state.relocationDraftOriginals = new Map();
    }
    const draftMap = this.state.relocationDraftOriginals;
    const keyList = Array.isArray(keys) && keys.length ? keys : Array.from(draftMap.keys());
    if (!keyList.length) {
      return false;
    }
    const eventId = this.state.selectedEventId;
    const assignmentMap = eventId ? this.ensureTeamAssignmentMap(eventId) : null;
    let changed = false;
    keyList.forEach(key => {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) {
        return;
      }
      const snapshot = draftMap.get(normalizedKey);
      draftMap.delete(normalizedKey);
      if (!snapshot) {
        return;
      }
      const entry = this.findParticipantForSnapshot(snapshot);
      if (!entry) {
        return;
      }
      entry.groupNumber = snapshot.groupNumber || "";
      const groupValue = String(entry.groupNumber || "");
      entry.status = snapshot.status || this.resolveParticipantStatus(entry, groupValue);
      entry.isCancelled = Boolean(snapshot.isCancelled);
      entry.isRelocated = Boolean(snapshot.isRelocated);
      entry.relocationDestinationScheduleId = snapshot.relocationDestinationScheduleId || "";
      entry.relocationDestinationScheduleLabel = snapshot.relocationDestinationScheduleLabel || "";
      entry.relocationDestinationTeamNumber = snapshot.relocationDestinationTeamNumber || "";
      if (assignmentMap) {
        const assignmentKey = String(snapshot.uid || snapshot.participantId || snapshot.rowKey || normalizedKey).trim();
        const assignmentValue = String(snapshot.groupNumber || "");
        if (assignmentKey) {
          if (assignmentValue) {
            assignmentMap.set(assignmentKey, assignmentValue);
          } else {
            assignmentMap.delete(assignmentKey);
          }
        }
      }
      changed = true;
    });
    if (changed) {
      this.state.participants = this.sortParticipants(this.state.participants);
      this.syncCurrentScheduleCache();
      this.updateDuplicateMatches();
      this.renderParticipants();
      this.syncSaveButtonState();
    }
    return changed;
  }

  /**
   * リロケーションプロンプトアイテムにフォーカス
   * @param {string} targetKey - ターゲットキー
   */
  focusRelocationPromptItem(targetKey = "") {
    const normalizedKey = String(targetKey || "").trim();
    if (!normalizedKey || !this.dom.relocationList) {
      return;
    }

    const rows = Array.from(this.dom.relocationList.querySelectorAll(".relocation-item"));
    if (!rows.length) {
      return;
    }

    const findMatch = () =>
      rows.find(row => {
        if (!row) return false;
        const candidates = [row.dataset.uid, row.dataset.rowKey, row.dataset.participantId]
          .map(value => String(value || "").trim())
          .filter(Boolean);
        return candidates.includes(normalizedKey);
      });

    const focusRow = () => {
      const match = findMatch();
      if (!match) return;
      const select = match.querySelector("[data-relocation-select]");
      if (select && !select.disabled && typeof select.focus === "function") {
        select.focus();
        return;
      }
      const teamInput = match.querySelector("[data-relocation-team]");
      if (teamInput && typeof teamInput.focus === "function") {
        teamInput.focus();
      }
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focusRow);
    } else {
      setTimeout(focusRow, 0);
    }
  }

  /**
   * リロケーションプロンプトを描画
   */
  renderRelocationPrompt() {
    if (!this.dom.relocationList) {
      return;
    }

    const targets = Array.isArray(this.state.relocationPromptTargets) ? this.state.relocationPromptTargets.slice() : [];
    const cleanedTargets = [];
    const eventId = this.state.selectedEventId;
    const currentScheduleId = this.state.selectedScheduleId;
    const scheduleOptions = this.getRelocationScheduleOptions(eventId, currentScheduleId);
    const scheduleOptionMap = new Map(scheduleOptions.map(option => [option.id, option.label]));

    this.dom.relocationList.innerHTML = "";

    targets.forEach((target, index) => {
      if (!target) {
        return;
      }
      const { entry } = this.resolveParticipantActionTarget({
        participantId: target.participantId,
        rowKey: target.rowKey
      });
      if (!entry) {
        return;
      }

      const groupValue = String(entry.groupNumber || "");
      const status = this.resolveParticipantStatus(entry, groupValue);
      if (status !== "relocated") {
        return;
      }

      const uid = this.resolveParticipantUid(entry) || String(entry.participantId || "");
      const defaultInfo = this.resolveRelocationDefault(entry);
      const destinationId = defaultInfo.destinationId;
      const destinationTeam = defaultInfo.destinationTeam;
      const destinationLabel = destinationId
        ? this.getScheduleLabel(eventId, destinationId) || scheduleOptionMap.get(destinationId) || destinationId
        : "";
      const listItem = document.createElement("li");
      listItem.className = "relocation-item";
      listItem.dataset.uid = uid;
      listItem.dataset.participantId = entry.participantId || "";
      listItem.dataset.rowKey = entry.rowKey || "";

      const header = document.createElement("div");
      header.className = "relocation-item__header";
      const nameSpan = document.createElement("span");
      nameSpan.className = "relocation-item__name";
      nameSpan.textContent = entry.name || "氏名未設定";
      header.appendChild(nameSpan);

      const deptSpan = document.createElement("span");
      deptSpan.className = "relocation-item__meta";
      const department = entry.department || entry.groupNumber || "";
      const currentScheduleLabel = this.getScheduleLabel(eventId, currentScheduleId) || currentScheduleId || "";
      const currentTeam = entry.groupNumber || "";
      const metaParts = [];
      if (department) metaParts.push(department);
      if (currentScheduleLabel) metaParts.push(`現在: ${currentScheduleLabel}`);
      if (currentTeam && currentTeam !== this.RELOCATE_LABEL) metaParts.push(`班番号: ${currentTeam}`);
      deptSpan.textContent = metaParts.join(" / ");
      header.appendChild(deptSpan);

      const body = document.createElement("div");
      body.className = "relocation-item__body";

      const scheduleField = document.createElement("label");
      scheduleField.className = "relocation-item__field";
      const scheduleSelectId = `qa-relocation-schedule-${index}`;
      scheduleField.setAttribute("for", scheduleSelectId);
      scheduleField.textContent = "移動先の日程";

      const scheduleSelect = document.createElement("select");
      scheduleSelect.className = "input";
      scheduleSelect.id = scheduleSelectId;
      scheduleSelect.dataset.relocationSelect = "true";

      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "選択してください";
      scheduleSelect.appendChild(placeholderOption);

      let hasOptions = false;
      scheduleOptions.forEach(option => {
        const opt = document.createElement("option");
        opt.value = option.id;
        opt.textContent = option.label;
        if (destinationId && destinationId === option.id) {
          opt.selected = true;
        }
        scheduleSelect.appendChild(opt);
        hasOptions = true;
      });

      if (destinationId && !scheduleOptionMap.has(destinationId)) {
        const fallbackOption = document.createElement("option");
        fallbackOption.value = destinationId;
        fallbackOption.textContent = destinationLabel || destinationId;
        fallbackOption.selected = true;
        scheduleSelect.appendChild(fallbackOption);
        hasOptions = true;
      }

      if (!hasOptions) {
        scheduleSelect.disabled = true;
        placeholderOption.textContent = "移動先の日程がありません";
      }

      body.appendChild(scheduleSelect);

      const teamField = document.createElement("label");
      teamField.className = "relocation-item__field";
      const teamInputId = `qa-relocation-team-${index}`;
      teamField.setAttribute("for", teamInputId);
      teamField.textContent = "移動先の班番号";

      const teamInput = document.createElement("input");
      teamInput.className = "input";
      teamInput.type = "text";
      teamInput.id = teamInputId;
      teamInput.placeholder = "未定の場合は空欄";
      teamInput.dataset.relocationTeam = "true";
      teamInput.value = destinationTeam || "";

      teamField.appendChild(teamInput);

      body.appendChild(teamField);

      const note = document.createElement("p");
      note.className = "relocation-item__note";
      if (destinationId) {
        note.textContent = destinationLabel
          ? `現在の設定: ${destinationLabel}${destinationTeam ? ` / 班番号: ${destinationTeam}` : " / 班番号: 未定"}`
          : "現在の設定があります";
      } else if (!hasOptions) {
        note.textContent = "別日に移動するには他の日程を追加してください。";
      } else {
        note.textContent = "移動先の日程と班番号を確認してください。";
      }
      body.appendChild(note);

      listItem.appendChild(header);
      listItem.appendChild(body);

      this.dom.relocationList.appendChild(listItem);
      cleanedTargets.push({
        uid,
        participantId: entry.participantId || "",
        rowKey: entry.rowKey || ""
      });
    });

    this.state.relocationPromptTargets = cleanedTargets;

    if (this.dom.relocationDescription) {
      const count = cleanedTargets.length;
      this.dom.relocationDescription.textContent = count
        ? `「別日」と指定された参加者が${count}名います。移動先の日程と班番号を確認してください。`
        : "CSVで「別日」と入力された参加者、または「別日」ボタンから設定した参加者の移動先を選択してください。";
    }

    if (this.dom.relocationError) {
      this.dom.relocationError.hidden = true;
      this.dom.relocationError.textContent = "";
    }

    if (!cleanedTargets.length && this.dom.relocationDialog) {
      this.closeDialog(this.dom.relocationDialog, { reason: "empty" });
    }
  }

  /**
   * リロケーションプロンプトをキューに追加
   * @param {Array} targets - ターゲットリスト
   * @param {Object} options - オプション
   * @param {boolean} options.replace - 置き換えるかどうか
   * @param {string} options.focusKey - フォーカスキー
   * @returns {boolean}
   */
  queueRelocationPrompt(targets = [], { replace = false, focusKey = "" } = {}) {
    if (replace) {
      this.state.relocationPromptTargets = [];
    }

    const targetList = Array.isArray(targets) ? targets : [];
    if (!targetList.length) {
      if (replace || this.state.relocationPromptTargets?.length) {
        this.renderRelocationPrompt();
      }
      return false;
    }

    const existing = new Map();
    if (!replace && Array.isArray(this.state.relocationPromptTargets)) {
      this.state.relocationPromptTargets.forEach(item => {
        const key = item?.uid || item?.participantId || item?.rowKey;
        if (key) {
          existing.set(key, item);
        }
      });
    }

    const addedKeys = [];

    targetList.forEach(target => {
      const resolved = this.resolveParticipantActionTarget(target);
      const entry = resolved.entry;
      if (!entry) {
        return;
      }
      const groupValue = String(entry.groupNumber || "");
      const status = this.resolveParticipantStatus(entry, groupValue);
      if (status !== "relocated") {
        return;
      }
      const uid = this.resolveParticipantUid(entry) || String(entry.participantId || "");
      const key = uid || String(entry.rowKey || "") || String(resolved.index);
      if (!key) {
        return;
      }
      if (!existing.has(key)) {
        addedKeys.push(key);
      }
      existing.set(key, {
        uid,
        participantId: entry.participantId || "",
        rowKey: entry.rowKey || ""
      });
    });

    this.state.relocationPromptTargets = Array.from(existing.values());
    if (!this.state.relocationPromptTargets.length) {
      return false;
    }

    this.renderRelocationPrompt();

    const preferredFocusKey = String(focusKey || "").trim() || addedKeys[0] ||
      String(this.state.relocationPromptTargets[0]?.uid || "") ||
      String(this.state.relocationPromptTargets[0]?.rowKey || "") ||
      String(this.state.relocationPromptTargets[0]?.participantId || "");

    if (this.dom.relocationDialog) {
      this.openDialog(this.dom.relocationDialog);
    }

    if (preferredFocusKey) {
      this.focusRelocationPromptItem(preferredFocusKey);
    }

    return true;
  }

  /**
   * リロケーションフォームの送信処理
   * @param {Event} event - イベントオブジェクト
   */
  handleRelocationFormSubmit(event) {
    event.preventDefault();
    if (!this.dom.relocationList) {
      return;
    }

    const rows = Array.from(this.dom.relocationList.querySelectorAll(".relocation-item"));
    if (!rows.length) {
      this.closeDialog(this.dom.relocationDialog, { reason: "empty" });
      return;
    }

    const updates = [];
    let hasSelectableSchedule = false;
    rows.forEach(row => {
      const select = row.querySelector("[data-relocation-select]");
      const teamInput = row.querySelector("[data-relocation-team]");
      const participantId = row.dataset.participantId || "";
      const rowKey = row.dataset.rowKey || "";
      const uid = row.dataset.uid || participantId || "";
      const scheduleId = String(select?.value || "").trim();
      const groupNumber = this.normalizeGroupNumberValue(teamInput?.value || "");
      const selectable = Boolean(select && !select.disabled);
      if (selectable) {
        hasSelectableSchedule = true;
      }
      if (!scheduleId) {
        return;
      }
      updates.push({ uid, participantId, rowKey, scheduleId, groupNumber });
    });

    if (!updates.length) {
      if (this.dom.relocationError) {
        this.dom.relocationError.hidden = false;
        this.dom.relocationError.textContent = hasSelectableSchedule
          ? "移動先の日程を選択してください。"
          : "移動先として選択できる日程がありません。";
      }
      if (hasSelectableSchedule) {
        const focusRow = rows.find(row => {
          const select = row.querySelector("[data-relocation-select]");
          return select && !select.disabled && !select.value;
        });
        const focusTarget = focusRow?.querySelector("[data-relocation-select]");
        if (focusTarget instanceof HTMLElement) {
          focusTarget.focus();
        }
      }
      return;
    }

    const processed = [];

    updates.forEach(update => {
      const resolved = this.resolveParticipantActionTarget({
        participantId: update.participantId,
        rowKey: update.rowKey
      });
      const entry = resolved.entry;
      const index = resolved.index;
      if (!entry || index === -1) {
        return;
      }
      const uid = this.resolveParticipantUid(entry) || update.uid || "";
      const rowKey = String(entry.rowKey || update.rowKey || "");
      const participantId = String(entry.participantId || update.participantId || "");
      if (!uid && !rowKey && !participantId) {
        return;
      }
      entry.groupNumber = this.RELOCATE_LABEL;
      entry.status = "relocated";
      entry.isRelocated = true;
      entry.isCancelled = false;
      this.applyRelocationDraft(entry, update.scheduleId, update.groupNumber);
      this.state.participants[index] = entry;
      processed.push({ uid, rowKey, participantId });
    });

    if (!processed.length) {
      if (this.dom.relocationError) {
        this.dom.relocationError.hidden = false;
        this.dom.relocationError.textContent = "移動先の更新に失敗しました。";
      }
      return;
    }

    this.state.participants = this.sortParticipants(this.state.participants);
    this.syncCurrentScheduleCache();
    this.updateDuplicateMatches();
    this.renderParticipants();
    this.syncSaveButtonState();

    const processedKeys = new Set();
    processed.forEach(item => {
      [item.uid, item.participantId, item.rowKey]
        .map(value => String(value || "").trim())
        .filter(Boolean)
        .forEach(key => processedKeys.add(key));
    });
    this.state.relocationPromptTargets = Array.isArray(this.state.relocationPromptTargets)
      ? this.state.relocationPromptTargets.filter(item => {
          const key = item?.uid || item?.participantId || item?.rowKey;
          return key && !processedKeys.has(String(key));
        })
      : [];

    if (this.state.relocationDraftOriginals instanceof Map) {
      const draftMap = this.state.relocationDraftOriginals;
      processedKeys.forEach(key => {
        if (draftMap.has(key)) {
          draftMap.delete(key);
        }
      });
    }

    if (this.dom.relocationError) {
      this.dom.relocationError.hidden = true;
      this.dom.relocationError.textContent = "";
    }

    if (this.state.relocationPromptTargets.length) {
      this.renderRelocationPrompt();
    } else {
      this.closeDialog(this.dom.relocationDialog, { reason: "submit" });
    }

    const message = processed.length === 1
      ? "別日の移動先を設定しました。変更は未保存です。"
      : `別日の移動先を${processed.length}名分設定しました。変更は未保存です。`;
    this.setUploadStatus(message, "info");
  }

  /**
   * リロケーションダイアログの閉じる処理
   * @param {Event} event - イベントオブジェクト
   */
  handleRelocationDialogClose(event) {
    const reason = event?.detail?.reason || "dismiss";
    if (reason === "submit" || reason === "empty") {
      return;
    }
    if (!(this.state.relocationDraftOriginals instanceof Map) || !this.state.relocationDraftOriginals.size) {
      return;
    }

    const draftMap = this.state.relocationDraftOriginals;
    const remainingTargets = [];
    const revertKeys = new Set();

    if (Array.isArray(this.state.relocationPromptTargets)) {
      this.state.relocationPromptTargets.forEach(target => {
        if (!target) {
          return;
        }
        const { entry } = this.resolveParticipantActionTarget({
          participantId: target.participantId,
          rowKey: target.rowKey
        });
        if (!entry) {
          return;
        }
        const key = this.resolveRelocationDraftKey(entry, target, draftMap);
        if (key) {
          revertKeys.add(key);
        } else {
          remainingTargets.push(target);
        }
      });
    }

    this.state.relocationPromptTargets = remainingTargets;

    if (this.dom.relocationError) {
      this.dom.relocationError.hidden = true;
      this.dom.relocationError.textContent = "";
    }

    if (remainingTargets.length) {
      this.renderRelocationPrompt();
    } else if (this.dom.relocationList) {
      this.dom.relocationList.innerHTML = "";
    }

    if (!revertKeys.size) {
      return;
    }

    const restored = this.restoreRelocationDrafts(Array.from(revertKeys));
    if (restored) {
      this.setUploadStatus("別日の設定を取り消しました。", "info");
    }
  }

  /**
   * クイックリロケーションアクション
   * @param {string} participantId - 参加者ID
   * @param {number} rowIndex - 行インデックス
   * @param {string} rowKey - 行キー
   */
  handleQuickRelocateAction(participantId, rowIndex, rowKey) {
    const target = this.resolveParticipantActionTarget({ participantId, rowKey, rowIndex });
    const entry = target.entry;
    const index = target.index;
    if (!entry || index === -1) {
      this.setUploadStatus("別日に移動する対象の参加者が見つかりません。", "error");
      return;
    }

    this.storeRelocationDraftOriginal(entry);

    const relocationLabel = this.RELOCATE_LABEL;
    const updated = {
      ...entry,
      groupNumber: relocationLabel
    };
    const nextStatus = this.resolveParticipantStatus(updated, relocationLabel);
    updated.status = nextStatus;
    updated.isCancelled = nextStatus === "cancelled";
    updated.isRelocated = nextStatus === "relocated";
    updated.relocationDestinationScheduleId = "";
    updated.relocationDestinationScheduleLabel = "";
    updated.relocationDestinationTeamNumber = "";

    const uid = this.resolveParticipantUid(updated) || String(updated.participantId || "");
    if (uid) {
      const relocationMap = this.ensurePendingRelocationMap();
      const previous = relocationMap.get(uid);
      if (previous) {
        this.clearRelocationPreview(previous);
        relocationMap.delete(uid);
      }
    }

    const identifier = this.formatParticipantIdentifier(entry);
    const message = `${identifier}を${this.RELOCATE_LABEL}の移動対象として設定しました。移動先を選んで適用してください。`;
    const actionRowKey = String(entry.rowKey || "");
    const actionParticipantId = String(entry.participantId || "");
    const focusKey = uid || actionRowKey || actionParticipantId;

    this.commitParticipantQuickEdit(index, updated, { successMessage: message, successVariant: "info" });

    this.queueRelocationPrompt([{ participantId: actionParticipantId, rowKey: actionRowKey }], {
      focusKey
    });
  }

  /**
   * 選択された参加者のリロケーション処理
   * @param {Function} getSelectedParticipantTarget - 選択された参加者を取得する関数
   */
  handleRelocateSelectedParticipant(getSelectedParticipantTarget) {
    const target = getSelectedParticipantTarget();
    if (!target.entry) {
      this.setUploadStatus("別日に移動する対象の参加者が見つかりません。", "error");
      return;
    }
    const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
    const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
    this.handleQuickRelocateAction(participantId, null, rowKey);
  }
}

  /**
   * 保留中のリロケーションマップを確保
   * @returns {Map}
   */
  ensurePendingRelocationMap() {
    if (!(this.state.pendingRelocations instanceof Map)) {
      this.state.pendingRelocations = new Map();
    }
    return this.state.pendingRelocations;
  }

  /**
   * リロケーションドラフトマップを確保
   * @returns {Map}
   */
  ensureRelocationDraftMap() {
    if (!(this.state.relocationDraftOriginals instanceof Map)) {
      this.state.relocationDraftOriginals = new Map();
    }
    return this.state.relocationDraftOriginals;
  }

  /**
   * リロケーションドラフトの元の値を保存
   * @param {Object} entry - 参加者エントリ
   * @returns {string|null}
   */
  storeRelocationDraftOriginal(entry) {
    if (!entry) {
      return null;
    }
    const uid = this.resolveParticipantUid(entry) || "";
    const rowKey = String(entry.rowKey || "");
    const participantId = String(entry.participantId || "");
    const key = uid || rowKey || participantId;
    if (!key) {
      return null;
    }
    const map = this.ensureRelocationDraftMap();
    if (map.has(key)) {
      return key;
    }
    const groupValue = String(entry.groupNumber ?? "");
    map.set(key, {
      key,
      uid,
      rowKey,
      participantId,
      groupNumber: entry.groupNumber ?? "",
      status: entry.status || this.resolveParticipantStatus(entry, groupValue),
      isCancelled: Boolean(entry.isCancelled),
      isRelocated: Boolean(entry.isRelocated),
      relocationDestinationScheduleId: entry.relocationDestinationScheduleId || "",
      relocationDestinationScheduleLabel: entry.relocationDestinationScheduleLabel || "",
      relocationDestinationTeamNumber: entry.relocationDestinationTeamNumber || ""
    });
    return key;
  }

  /**
   * リロケーションドラフトキーを解決
   * @param {Object} entry - 参加者エントリ
   * @param {Object} target - ターゲット
   * @param {Map} draftMap - ドラフトマップ
   * @returns {string|null}
   */
  resolveRelocationDraftKey(entry, target = null, draftMap = this.state.relocationDraftOriginals) {
    if (!entry || !(draftMap instanceof Map) || !draftMap.size) {
      return null;
    }
    const candidates = [
      this.resolveParticipantUid(entry),
      target?.uid,
      entry?.participantId,
      target?.participantId,
      entry?.rowKey,
      target?.rowKey
    ];
    for (const candidate of candidates) {
      const normalized = String(candidate || "").trim();
      if (normalized && draftMap.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  /**
   * リロケーション先のスケジュールオプションを取得
   * @param {string} eventId - イベントID
   * @param {string} excludeScheduleId - 除外するスケジュールID
   * @returns {Array<{id: string, label: string}>}
   */
  getRelocationScheduleOptions(eventId, excludeScheduleId) {
    const event = this.state.events.find(evt => evt.id === eventId);
    if (!event || !Array.isArray(event.schedules)) {
      return [];
    }
    return event.schedules
      .filter(schedule => schedule && schedule.id && schedule.id !== excludeScheduleId)
      .map(schedule => ({ id: schedule.id, label: this.buildScheduleOptionLabel(schedule) || schedule.id }));
  }

  /**
   * リロケーションのデフォルト値を解決
   * @param {Object} entry - 参加者エントリ
   * @returns {{destinationId: string, destinationTeam: string}}
   */
  resolveRelocationDefault(entry) {
    const uid = this.resolveParticipantUid(entry) || String(entry.participantId || "");
    const relocationMap = this.ensurePendingRelocationMap();
    const pending = uid ? relocationMap.get(uid) : null;
    return {
      destinationId: pending?.toScheduleId || entry.relocationDestinationScheduleId || "",
      destinationTeam: pending?.destinationTeamNumber || entry.relocationDestinationTeamNumber || ""
    };
  }
}

