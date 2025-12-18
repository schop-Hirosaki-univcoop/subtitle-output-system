// participant-manager.js: 参加者管理機能のマネージャークラス
// 参加者一覧の読み込み、描画、CRUD操作、保存を担当します。

import { rootDbRef, fetchDbValue, update } from "../firebase.js";
import {
  normalizeEventParticipantCache,
  syncCurrentScheduleCache,
  updateDuplicateMatches,
  normalizeParticipantRecord,
  getTeamAssignmentMap,
  applyAssignmentsToEntries,
  resolveParticipantUid,
  sortParticipants,
  signatureForEntries,
  diffParticipantLists,
  describeDuplicateMatch,
  getScheduleLabel,
  resolveParticipantStatus,
  normalizeGroupNumberValue,
  resolveMailStatusInfo,
  assignParticipantIds,
  ensureRowKey
} from "../participants.js";
import { normalizeKey } from "../utils.js";

/**
 * 参加者管理機能のマネージャークラス
 * QuestionAdminApp から参加者管理機能を分離したモジュール
 */
export class ParticipantManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.readHostSelectionDataset = context.readHostSelectionDataset;
    this.getHostSelectionElement = context.getHostSelectionElement;
    this.loadGlDataForEvent = context.loadGlDataForEvent;
    this.renderEvents = context.renderEvents;
    this.renderSchedules = context.renderSchedules;
    this.updateParticipantContext = context.updateParticipantContext;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.syncMailActionState = context.syncMailActionState;
    this.syncAllPrintButtonStates = context.syncAllPrintButtonStates;
    this.syncClearButtonState = context.syncClearButtonState;
    this.syncTemplateButtons = context.syncTemplateButtons;
    this.syncSelectedEventSummary = context.syncSelectedEventSummary;
    this.renderParticipantChangePreview = context.renderParticipantChangePreview;
    this.renderRelocationPrompt = context.renderRelocationPrompt;
    this.applyParticipantSelectionStyles = context.applyParticipantSelectionStyles;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    this.emitParticipantSyncEvent = context.emitParticipantSyncEvent;
    this.describeScheduleRange = context.describeScheduleRange;
    this.ensureTokenSnapshot = context.ensureTokenSnapshot;
    this.generateQuestionToken = context.generateQuestionToken;
    this.setUploadStatus = context.setUploadStatus;
    
    // renderParticipants に必要な依存関係
    this.buildParticipantCard = context.buildParticipantCard;
    this.getParticipantGroupKey = context.getParticipantGroupKey;
    this.createParticipantGroupElements = context.createParticipantGroupElements;
    this.getEventGlRoster = context.getEventGlRoster;
    this.getEventGlAssignmentsMap = context.getEventGlAssignmentsMap;
    this.resolveScheduleAssignment = context.resolveScheduleAssignment;
    this.renderGroupGlAssignments = context.renderGroupGlAssignments;
    this.clearParticipantSelection = context.clearParticipantSelection;
    this.participantChangeKey = context.participantChangeKey;
    this.CANCEL_LABEL = context.CANCEL_LABEL;
    this.GL_STAFF_GROUP_KEY = context.GL_STAFF_GROUP_KEY;
    
    // CRUD機能に必要な依存関係
    this.getDisplayParticipantId = context.getDisplayParticipantId;
    this.ensurePendingRelocationMap = context.ensurePendingRelocationMap;
    this.applyRelocationDraft = context.applyRelocationDraft;
    this.ensureTeamAssignmentMap = context.ensureTeamAssignmentMap;
    this.applyAssignmentsToEventCache = context.applyAssignmentsToEventCache;
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.confirmAction = context.confirmAction;
    this.setFormError = context.setFormError;
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    this.RELOCATE_LABEL = context.RELOCATE_LABEL;
    
    // handleSave に必要な依存関係
    this.getScheduleRecord = context.getScheduleRecord;
    this.loadEvents = context.loadEvents;
    
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * 参加者一覧を読み込む
   * @param {Object} options - オプション
   * @returns {Promise<void>}
   */
  async loadParticipants(options = {}) {
    const { statusMessage, statusVariant = "success", suppressStatus = false } = options || {};
    let eventId = this.state.selectedEventId ? String(this.state.selectedEventId) : "";
    let scheduleId = this.state.selectedScheduleId ? String(this.state.selectedScheduleId) : "";
    let selectionRecovered = false;

    if (!eventId || !scheduleId) {
      const hostSelection = this.readHostSelectionDataset(this.getHostSelectionElement());
      if (hostSelection) {
        const hostEventId = normalizeKey(hostSelection.eventId || "");
        const hostScheduleId = normalizeKey(hostSelection.scheduleId || "");
        if (hostEventId) {
          if (eventId !== hostEventId) {
            this.state.selectedEventId = hostEventId;
            eventId = hostEventId;
            selectionRecovered = true;
          }
          const matchedEvent = this.state.events.find(evt => evt.id === hostEventId) || null;
          if (matchedEvent && hostSelection.eventName) {
            matchedEvent.name = hostSelection.eventName;
          }
        }
        if (hostScheduleId && eventId && (!hostEventId || hostEventId === eventId)) {
          if (scheduleId !== hostScheduleId) {
            this.state.selectedScheduleId = hostScheduleId;
            scheduleId = hostScheduleId;
            selectionRecovered = true;
          }
          const parentEvent = this.state.events.find(evt => evt.id === eventId) || null;
          const scheduleRecord = parentEvent?.schedules?.find(s => s.id === hostScheduleId) || null;
          if (scheduleRecord) {
            if (hostSelection.scheduleLabel) scheduleRecord.label = hostSelection.scheduleLabel;
            if (hostSelection.location) scheduleRecord.location = hostSelection.location;
            if (hostSelection.startAt) scheduleRecord.startAt = hostSelection.startAt;
            if (hostSelection.endAt) scheduleRecord.endAt = hostSelection.endAt;
          }
        }
        if (eventId && scheduleId && this.state.scheduleContextOverrides instanceof Map) {
          const overrideKey = `${eventId}::${scheduleId}`;
          const selectedEvent = this.state.events.find(evt => evt.id === eventId) || null;
          const scheduleRecord = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
          if (!scheduleRecord) {
            const override = this.state.scheduleContextOverrides.get(overrideKey) || {};
            override.eventId = eventId;
            override.eventName = hostSelection.eventName || override.eventName || selectedEvent?.name || eventId;
            override.scheduleId = scheduleId;
            override.scheduleLabel = hostSelection.scheduleLabel || override.scheduleLabel || scheduleId;
            override.location = hostSelection.location || override.location || "";
            override.startAt = hostSelection.startAt || override.startAt || "";
            override.endAt = hostSelection.endAt || override.endAt || "";
            this.state.scheduleContextOverrides.set(overrideKey, override);
          }
        }
      }
    }

    this.state.selectedEventId = eventId || null;
    this.state.selectedScheduleId = scheduleId || null;
    this.state.mailSending = false;

    if (eventId) {
      this.loadGlDataForEvent(eventId).catch(error => console.error(error));
    }

    if (selectionRecovered) {
      this.renderEvents();
      this.renderSchedules();
      this.updateParticipantContext({ preserveStatus: true });
    }

    if (!eventId || !scheduleId) {
      this.state.participants = [];
      this.state.participantTokenMap = new Map();
      this.state.duplicateMatches = new Map();
      this.state.duplicateGroups = new Map();
      this.captureParticipantBaseline([], { ready: false });
      this.renderParticipants();
      this.updateParticipantContext();
      this.syncSaveButtonState();
      this.syncMailActionState();
      this.emitParticipantSyncEvent({
        success: false,
        eventId,
        scheduleId,
        participantCount: 0,
        reason: "selection-missing"
      });
      return;
    }

    try {
      await this.ensureTokenSnapshot(false);
      // --- FIX 1: Load current schedule participants ONLY ---
      let scheduleBranch = await fetchDbValue(
        `questionIntake/participants/${eventId}/${scheduleId}`
      );
      scheduleBranch =
        scheduleBranch && typeof scheduleBranch === "object" ? scheduleBranch : {};
      // Temporarily set eventBranch to just this schedule's data
      let eventBranch = { [scheduleId]: scheduleBranch };
      let normalized = Object.entries(scheduleBranch)
        .map(([participantKey, participantValue]) =>
          normalizeParticipantRecord(participantValue, participantKey)
        )
        .filter(entry => resolveParticipantUid(entry));
      
      // This cache is now incomplete, containing only the current schedule.
      // We will populate it fully in the deferred step.
      if (!(this.state.eventParticipantCache instanceof Map)) {
        this.state.eventParticipantCache = new Map();
      }
      this.state.eventParticipantCache.set(eventId, normalizeEventParticipantCache(eventBranch));

      let participants = sortParticipants(normalized);
      const assignmentMap = getTeamAssignmentMap(eventId);
      if (assignmentMap?.size) {
        const applyResult = applyAssignmentsToEntries(participants, assignmentMap);
        participants = sortParticipants(applyResult.entries);
      }

      this.state.participants = participants;
      this.state.pendingRelocations = new Map();
      this.state.relocationDraftOriginals = new Map();
      this.captureParticipantBaseline(participants);
      this.state.participantTokenMap = new Map(
        this.state.participants.map(entry => {
          const key = resolveParticipantUid(entry) || String(entry.participantId || "").trim();
          return [key, entry.token];
        }).filter(([key]) => Boolean(key))
      );
      this.state.participantTokenMap.forEach(token => {
        if (token) {
          this.state.knownTokens.add(token);
        }
      });
      this.state.duplicateMatches = new Map();
      this.state.duplicateGroups = new Map();
      const overrideKey = eventId && scheduleId ? `${eventId}::${scheduleId}` : "";
      const override = overrideKey && this.state.scheduleContextOverrides instanceof Map
        ? this.state.scheduleContextOverrides.get(overrideKey)
        : null;
      const selectedEvent = this.state.events.find(evt => evt.id === eventId) || null;
      const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
      const scheduleLabel = selectedSchedule?.label || override?.scheduleLabel || scheduleId;
      const eventName = selectedEvent?.name || override?.eventName || eventId;
      const scheduleRange = selectedSchedule
        ? this.describeScheduleRange(selectedSchedule)
        : override
          ? this.describeScheduleRange({
              id: scheduleId,
              label: scheduleLabel,
              startAt: override.startAt || "",
              endAt: override.endAt || "",
              date: override.date || (override.startAt ? String(override.startAt).slice(0, 10) : "")
            })
          : "";
      if (selectedSchedule) {
        selectedSchedule.participantCount = participants.length;
      }
      syncCurrentScheduleCache();
      if (this.dom.fileLabel) this.dom.fileLabel.textContent = "参加者CSVをアップロード";
      if (this.dom.teamFileLabel) this.dom.teamFileLabel.textContent = "班番号CSVをアップロード";
      if (this.dom.csvInput) this.dom.csvInput.value = "";
      if (!suppressStatus) {
        const defaultMessage = "現在の参加者リストを読み込みました。";
        this.setUploadStatus(statusMessage || defaultMessage, statusVariant);
      }

      // --- FIX 2: Defer duplicate check ---
      // Render the participant list immediately
      this.renderParticipants();

      // Now, load the full event data in the background for the duplicate check
      setTimeout(() => {
        if (this.state.selectedEventId !== eventId) return; // Abort if user navigated away
        fetchDbValue(`questionIntake/participants/${eventId}`).then(eventBranchRaw => {
          if (!eventBranchRaw || typeof eventBranchRaw !== "object" || this.state.selectedEventId !== eventId) {
            return;
          }
          // Now populate the cache with the FULL event data
          this.state.eventParticipantCache.set(eventId, normalizeEventParticipantCache(eventBranchRaw));
          // And NOW run the expensive duplicate check
          updateDuplicateMatches();
          // Re-render to show duplicate icons
          this.renderParticipants();
        }).catch(err => {
          console.warn("Background duplicate check failed:", err);
        });
      }, 100); // 100ms delay to ensure UI is responsive
      this.updateParticipantContext({ preserveStatus: true });
      this.syncSaveButtonState();
      this.syncAllPrintButtonStates();
      this.emitParticipantSyncEvent({
        success: true,
        eventId,
        scheduleId,
        participantCount: participants.length,
        eventName,
        scheduleLabel,
        scheduleRange
      });
    } catch (error) {
      console.error(error);
      this.state.participants = [];
      this.state.participantTokenMap = new Map();
      this.state.duplicateMatches = new Map();
      this.state.duplicateGroups = new Map();
      this.state.mailSending = false;
      this.captureParticipantBaseline([], { ready: false });
      this.setUploadStatus(error.message || "参加者リストの読み込みに失敗しました。", "error");
      this.renderParticipants();
      this.updateParticipantContext();
      this.syncSaveButtonState();
      this.syncMailActionState();
      this.syncAllPrintButtonStates();
    }
  }

  /**
   * 参加者一覧を描画する
   */
  renderParticipants() {
    const list = this.dom.participantCardList;
    if (!list) {
      this.syncSelectedEventSummary();
      return;
    }
    list.innerHTML = "";

    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    const duplicateMap = this.state.duplicateMatches instanceof Map ? this.state.duplicateMatches : new Map();
    const participants = sortParticipants(this.state.participants);
    const glRosterMap = this.getEventGlRoster(eventId);
    const glAssignmentsMap = this.getEventGlAssignmentsMap(eventId);

    const diff = diffParticipantLists(this.state.participants, this.state.savedParticipants || []);
    const changeInfoByKey = new Map();
    diff.added.forEach(entry => {
      const key = this.participantChangeKey(entry);
      if (!key || changeInfoByKey.has(key)) return;
      changeInfoByKey.set(key, { type: "added", current: entry });
    });
    diff.updated.forEach(item => {
      const key = this.participantChangeKey(item.current);
      if (!key || changeInfoByKey.has(key)) return;
      changeInfoByKey.set(key, {
        type: "updated",
        current: item.current,
        previous: item.previous,
        changes: item.changes
      });
    });

    list.setAttribute("data-count", String(participants.length));

    const fragment = document.createDocumentFragment();
    const groupMap = new Map();
    let selectionFound = false;
    const ensuredTeamGroups = new Set();
    let needsCancelGroup = false;
    let needsStaffGroup = false;

    participants.forEach((entry, index) => {
      const changeKey = this.participantChangeKey(entry, index);
      const changeInfo = changeInfoByKey.get(changeKey);
      const { card, isSelected } = this.buildParticipantCard(entry, index, {
        changeInfo,
        duplicateMap,
        eventId,
        scheduleId
      });
      if (isSelected) {
        selectionFound = true;
      }
      const groupKey = this.getParticipantGroupKey(entry);
      let group = groupMap.get(groupKey);
      if (!group) {
        const elements = this.createParticipantGroupElements(groupKey);
        group = { ...elements, count: 0, key: groupKey };
        groupMap.set(groupKey, group);
        fragment.appendChild(elements.section);
      }
      group.cardsContainer.appendChild(card);
      group.count += 1;
      ensuredTeamGroups.add(normalizeKey(groupKey || ""));
    });

    if (glAssignmentsMap instanceof Map) {
      glAssignmentsMap.forEach(entry => {
        const assignment = this.resolveScheduleAssignment(entry, scheduleId);
        if (!assignment) return;
        if (assignment.status === "absent") {
          needsCancelGroup = true;
        } else if (assignment.status === "staff") {
          needsStaffGroup = true;
        } else if (assignment.status === "team") {
          const teamKey = normalizeKey(assignment.teamId || "");
          if (teamKey) {
            if (!groupMap.has(teamKey)) {
              const elements = this.createParticipantGroupElements(teamKey);
              groupMap.set(teamKey, { ...elements, count: 0, key: teamKey });
              fragment.appendChild(elements.section);
            }
            ensuredTeamGroups.add(teamKey);
          }
        }
      });
    }

    if (needsCancelGroup && !groupMap.has(this.CANCEL_LABEL)) {
      const elements = this.createParticipantGroupElements(this.CANCEL_LABEL);
      groupMap.set(this.CANCEL_LABEL, { ...elements, count: 0, key: this.CANCEL_LABEL });
      fragment.appendChild(elements.section);
      ensuredTeamGroups.add(normalizeKey(this.CANCEL_LABEL));
    }

    if (needsStaffGroup && !groupMap.has(this.GL_STAFF_GROUP_KEY)) {
      const elements = this.createParticipantGroupElements(this.GL_STAFF_GROUP_KEY);
      groupMap.set(this.GL_STAFF_GROUP_KEY, { ...elements, count: 0, key: this.GL_STAFF_GROUP_KEY });
      fragment.appendChild(elements.section);
      ensuredTeamGroups.add(normalizeKey(this.GL_STAFF_GROUP_KEY));
    }

    groupMap.forEach(group => {
      group.countElement.textContent = `${group.count}名`;
      this.renderGroupGlAssignments(group, {
        eventId,
        rosterMap: glRosterMap,
        assignmentsMap: glAssignmentsMap,
        scheduleId
      });
    });

    list.setAttribute("data-group-count", String(groupMap.size));

    if ((this.state.selectedParticipantRowKey || this.state.selectedParticipantId) && !selectionFound) {
      this.clearParticipantSelection({ silent: true });
    }

    list.appendChild(fragment);

    if (this.dom.adminSummary) {
      const total = this.state.participants.length;
      const summaryEntries = [];
      const duplicateGroups = this.state.duplicateGroups instanceof Map ? this.state.duplicateGroups : new Map();
      duplicateGroups.forEach(group => {
        if (!group || !Array.isArray(group.records) || !group.records.length) return;
        const hasCurrent = group.records.some(record => record.isCurrent && String(record.scheduleId) === String(scheduleId));
        if (!hasCurrent) return;
        const detail = group.records
          .map(record => describeDuplicateMatch(record, eventId, scheduleId))
          .filter(Boolean)
          .join(" / ");
        if (!detail) return;
        const totalCount = group.totalCount || group.records.length;
        summaryEntries.push({ detail, totalCount });
      });

      let summaryText = total
        ? `登録済みの参加者: ${total}名`
        : "参加者リストはまだ登録されていません。";

      if (summaryEntries.length) {
        const preview = summaryEntries
          .slice(0, 3)
          .map(entry => `${entry.detail}（${entry.totalCount}件）`)
          .join(" / ");
        const remainder = summaryEntries.length > 3 ? ` / 他${summaryEntries.length - 3}件` : "";
        summaryText += ` / 重複候補 ${summaryEntries.length}件 (${preview}${remainder})`;
      }

      this.dom.adminSummary.textContent = summaryText;
    }

    this.renderParticipantChangePreview(diff, changeInfoByKey, participants);
    this.syncSaveButtonState();
    this.syncClearButtonState();
    this.syncTemplateButtons();
    this.renderRelocationPrompt();
    this.syncSelectedEventSummary();
    this.applyParticipantSelectionStyles();
    this.updateParticipantActionPanelState();
  }

  /**
   * 参加者編集フォームを開く
   * @param {string} participantId - 参加者ID
   * @param {string} rowKey - 行キー
   */
  openParticipantEditor(participantId, rowKey) {
    if (!this.dom.participantDialog) {
      this.setUploadStatus("編集対象の参加者が見つかりません。", "error");
      return;
    }
    const eventId = this.state.selectedEventId;
    let entry = null;
    if (rowKey) {
      entry = this.state.participants.find(item => String(item.rowKey || "") === String(rowKey));
    }
    if (!entry && participantId) {
      entry = this.state.participants.find(item => String(item.participantId) === String(participantId));
    }
    if (!entry) {
      this.setUploadStatus("指定された参加者が現在のリストに存在しません。", "error");
      return;
    }
    this.state.editingParticipantId = entry.participantId;
    this.state.editingRowKey = entry.rowKey || null;
    if (this.dom.participantDialogTitle) {
      const displayId = this.getDisplayParticipantId(entry.participantId);
      if (entry.participantId) {
        this.dom.participantDialogTitle.textContent = `参加者情報を編集（UID: ${displayId}）`;
        if (displayId !== String(entry.participantId).trim()) {
          this.dom.participantDialogTitle.setAttribute("title", `UID: ${entry.participantId}`);
        } else {
          this.dom.participantDialogTitle.removeAttribute("title");
        }
      } else {
        this.dom.participantDialogTitle.textContent = "参加者情報を編集";
        this.dom.participantDialogTitle.removeAttribute("title");
      }
    }
    if (this.dom.participantNameInput) this.dom.participantNameInput.value = entry.name || "";
    if (this.dom.participantPhoneticInput) this.dom.participantPhoneticInput.value = entry.phonetic || entry.furigana || "";
    if (this.dom.participantGenderInput) this.dom.participantGenderInput.value = entry.gender || "";
    if (this.dom.participantDepartmentInput) this.dom.participantDepartmentInput.value = entry.department || "";
    if (this.dom.participantTeamInput) this.dom.participantTeamInput.value = entry.groupNumber || "";
    if (this.dom.participantPhoneInput) this.dom.participantPhoneInput.value = entry.phone || "";
    if (this.dom.participantEmailInput) this.dom.participantEmailInput.value = entry.email || "";
    if (this.dom.participantMailSentInput) {
      const mailInfo = resolveMailStatusInfo(entry);
      this.dom.participantMailSentInput.checked = mailInfo.key === "sent";
      this.dom.participantMailSentInput.indeterminate = mailInfo.key === "missing";
      this.dom.participantMailSentInput.disabled = false;
    }

    const currentStatus = entry.status || resolveParticipantStatus(entry, entry.groupNumber || "");
    const isRelocated = currentStatus === "relocated";
    const relocationMap = this.ensurePendingRelocationMap();
    const uid = resolveParticipantUid(entry) || String(entry.participantId || "");

    if (this.dom.participantRelocationSummary) {
      let summaryText = "";
      if (isRelocated) {
        const pendingRelocation = relocationMap.get(uid);
        const destinationId = pendingRelocation?.toScheduleId || entry.relocationDestinationScheduleId || "";
        const destinationTeam = pendingRelocation?.destinationTeamNumber || entry.relocationDestinationTeamNumber || "";
        const destinationLabel = destinationId ? getScheduleLabel(eventId, destinationId) || destinationId : "";
        if (destinationId) {
          summaryText = destinationTeam
            ? `移動先: ${destinationLabel} / 班番号: ${destinationTeam || "未定"}`
            : `移動先: ${destinationLabel} / 班番号: 未定`;
        } else {
          summaryText = `${this.RELOCATE_LABEL}の設定があります。ポップアップから移動先を指定してください。`;
        }
      }
      this.dom.participantRelocationSummary.hidden = !summaryText;
      if (this.dom.participantRelocationSummaryText) {
        this.dom.participantRelocationSummaryText.textContent = summaryText;
      }
    }

    this.setFormError(this.dom.participantError);
    this.openDialog(this.dom.participantDialog);
  }

  /**
   * 参加者編集内容を保存する
   */
  saveParticipantEdits() {
    const eventId = this.state.selectedEventId;
    const participantId = this.state.editingParticipantId || "";
    const rowKey = this.state.editingRowKey || "";
    if (!participantId && !rowKey) {
      throw new Error("編集対象の参加者が不明です。");
    }
    let index = -1;
    if (rowKey) {
      index = this.state.participants.findIndex(entry => String(entry.rowKey || "") === String(rowKey));
    }
    if (index === -1) {
      index = this.state.participants.findIndex(entry => String(entry.participantId) === String(participantId));
    }
    if (index === -1) {
      throw new Error("対象の参加者が見つかりません。");
    }
    const name = String(this.dom.participantNameInput?.value || "").trim();
    if (!name) {
      throw new Error("氏名を入力してください。");
    }
    const phonetic = String(this.dom.participantPhoneticInput?.value || "").trim();
    const gender = String(this.dom.participantGenderInput?.value || "").trim();
    const department = String(this.dom.participantDepartmentInput?.value || "").trim();
    const groupNumber = normalizeGroupNumberValue(this.dom.participantTeamInput?.value || "");
    const phone = String(this.dom.participantPhoneInput?.value || "").trim();
    const email = String(this.dom.participantEmailInput?.value || "").trim();

    const existing = this.state.participants[index];
    const mailSentControl = this.dom.participantMailSentInput;
    const mailSentChecked = Boolean(mailSentControl && mailSentControl.checked && !mailSentControl.indeterminate);
    const updated = {
      ...existing,
      name,
      phonetic,
      furigana: phonetic,
      gender,
      department,
      groupNumber,
      phone,
      email
    };
    const existingMailSentAt = Number(existing?.mailSentAt || 0);
    if (!email) {
      updated.mailStatus = "";
      updated.mailSentAt = 0;
      updated.mailError = "";
    } else if (mailSentChecked) {
      const resolvedSentAt = existingMailSentAt > 0 ? existingMailSentAt : Date.now();
      updated.mailStatus = "sent";
      updated.mailSentAt = resolvedSentAt;
      updated.mailError = "";
      const existingAttempt = Number(existing?.mailLastAttemptAt || 0);
      const nextAttempt = Number.isFinite(existingAttempt) && existingAttempt > 0
        ? Math.max(existingAttempt, resolvedSentAt)
        : resolvedSentAt;
      updated.mailLastAttemptAt = nextAttempt;
    } else {
      updated.mailStatus = "";
      updated.mailSentAt = 0;
      updated.mailError = "";
    }
    const nextStatus = resolveParticipantStatus(updated, groupNumber);
    updated.status = nextStatus;
    updated.isCancelled = nextStatus === "cancelled";
    updated.isRelocated = nextStatus === "relocated";

    const uid = resolveParticipantUid(updated) || participantId;
    if (updated.isRelocated) {
      const relocationMap = this.ensurePendingRelocationMap();
      const pendingRelocation = uid ? relocationMap.get(uid) : null;
      const destinationScheduleId = String(
        pendingRelocation?.toScheduleId || existing.relocationDestinationScheduleId || ""
      ).trim();
      const destinationTeamNumber = String(
        pendingRelocation?.destinationTeamNumber || existing.relocationDestinationTeamNumber || ""
      ).trim();
      this.applyRelocationDraft(updated, destinationScheduleId, destinationTeamNumber);
    } else {
      this.applyRelocationDraft(updated, "", "");
    }

    this.state.participants[index] = updated;
    this.state.participants = sortParticipants(this.state.participants);

    if (eventId && uid) {
      const assignmentMap = this.ensureTeamAssignmentMap(eventId);
      if (assignmentMap) {
        assignmentMap.set(uid, groupNumber);
      }
      const singleMap = new Map([[uid, groupNumber]]);
      this.applyAssignmentsToEventCache(eventId, singleMap);
    }

    syncCurrentScheduleCache();
    updateDuplicateMatches();
    this.renderParticipants();
    this.syncSaveButtonState();
    if (this.hasUnsavedChanges()) {
      this.setUploadStatus("編集内容は未保存です。「適用」で確定します。");
    } else {
      this.setUploadStatus("適用済みの内容と同じため変更はありません。");
    }

    this.state.editingParticipantId = null;
    this.state.editingRowKey = null;
  }

  /**
   * 参加者を追加する
   * @param {Object} formData - フォームデータ
   * @returns {void}
   */
  addParticipant(formData) {
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      throw new Error("イベントと日程を選択してください。");
    }

    const name = String(formData.name || "").trim();
    if (!name) {
      throw new Error("氏名を入力してください。");
    }

    const phonetic = String(formData.phonetic || "").trim();
    const gender = String(formData.gender || "").trim();
    const department = String(formData.department || "").trim();
    const groupNumber = normalizeGroupNumberValue(formData.team || "");
    const phone = String(formData.phone || "").trim();
    const email = String(formData.email || "").trim();

    // 新しい参加者エントリを作成
    const newEntry = {
      name,
      phonetic,
      furigana: phonetic,
      gender,
      department,
      groupNumber,
      phone,
      email
    };

    // assignParticipantIds を使用してIDを割り当て
    const entries = assignParticipantIds([newEntry], this.state.participants, {
      eventId,
      scheduleId
    });
    const assignedEntry = entries[0];
    if (!assignedEntry) {
      throw new Error("参加者の追加に失敗しました。");
    }

    // rowKeyを生成
    ensureRowKey(assignedEntry, "add");

    // ステータスとメール情報を設定
    const status = resolveParticipantStatus(assignedEntry, groupNumber);
    assignedEntry.status = status;
    assignedEntry.isCancelled = status === "cancelled";
    assignedEntry.isRelocated = status === "relocated";
    assignedEntry.mailStatus = email ? "pending" : "missing";
    assignedEntry.mailSentAt = 0;
    assignedEntry.mailError = "";
    assignedEntry.mailLastAttemptAt = 0;

    // 既存の参加者リストに追加
    this.state.participants.push(assignedEntry);
    this.state.participants = sortParticipants(this.state.participants);

    // 班番号の割り当て
    const uid = resolveParticipantUid(assignedEntry);
    if (eventId && uid) {
      const assignmentMap = this.ensureTeamAssignmentMap(eventId);
      if (assignmentMap && groupNumber) {
        assignmentMap.set(uid, groupNumber);
      }
      if (groupNumber) {
        const singleMap = new Map([[uid, groupNumber]]);
        this.applyAssignmentsToEventCache(eventId, singleMap);
      }
    }

    syncCurrentScheduleCache();
    updateDuplicateMatches();
    this.renderParticipants();
    this.syncSaveButtonState();
    this.updateParticipantActionPanelState();
  }

  /**
   * 参加者を削除する
   * @param {string} participantId - 参加者ID
   * @param {number} rowIndex - 行インデックス
   * @param {string} rowKey - 行キー
   * @returns {Promise<void>}
   */
  async handleDeleteParticipant(participantId, rowIndex, rowKey) {
    let entry = null;
    if (rowKey) {
      entry = this.state.participants.find(item => String(item.rowKey || "") === String(rowKey));
    }
    if (participantId) {
      entry = entry || this.state.participants.find(item => String(item.participantId) === String(participantId));
    }
    if (!entry && Number.isInteger(rowIndex) && rowIndex >= 0) {
      const sorted = sortParticipants(this.state.participants);
      const candidate = sorted[rowIndex];
      if (candidate) {
        entry = this.state.participants.find(item => item === candidate || String(item.participantId) === String(candidate.participantId));
      }
    }

    if (!entry) {
      this.setUploadStatus("削除対象の参加者が見つかりません。", "error");
      return;
    }

    const nameLabel = entry.name ? `「${entry.name}」` : "";
    const displayId = this.getDisplayParticipantId(entry.participantId);
    const idLabel = entry.participantId ? `UID: ${displayId}` : "UID未設定";
    const description = nameLabel
      ? `参加者${nameLabel}（${idLabel}）を削除します。適用するまで確定されません。よろしいですか？`
      : `参加者（${idLabel}）を削除します。適用するまで確定されません。よろしいですか？`;

    const confirmed = await this.confirmAction({
      title: "参加者の削除",
      description,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    const removed = this.removeParticipantFromState(entry.participantId, entry, entry.rowKey);
    if (!removed) {
      this.setUploadStatus("参加者の削除に失敗しました。", "error");
      return;
    }

    const removedDisplayId = this.getDisplayParticipantId(removed.participantId);
    const identifier = removed.name
      ? `参加者「${removed.name}」`
      : removed.participantId
        ? `UID: ${removedDisplayId}`
        : "UID未設定";

    updateDuplicateMatches();
    this.renderParticipants();
    if (this.hasUnsavedChanges()) {
      this.setUploadStatus(`${identifier}を削除予定です。「適用」で確定します。`);
    } else {
      this.setUploadStatus("変更は適用済みの状態に戻りました。");
    }
  }

  /**
   * 状態から参加者を削除する（内部メソッド）
   * @param {string} participantId - 参加者ID
   * @param {Object} fallbackEntry - フォールバックエントリ
   * @param {string} rowKey - 行キー
   * @returns {Object|null} 削除された参加者エントリ
   */
  removeParticipantFromState(participantId, fallbackEntry, rowKey) {
    const targetId = String(participantId || "").trim();
    let removed = null;
    let nextList = [];

    if (rowKey) {
      const index = this.state.participants.findIndex(entry => String(entry.rowKey || "") === String(rowKey));
      if (index !== -1) {
        removed = this.state.participants[index];
        nextList = this.state.participants.filter((_, idx) => idx !== index);
      }
    }

    if (targetId) {
      removed = removed || this.state.participants.find(entry => String(entry.participantId) === targetId) || null;
      if (!removed) {
        return null;
      }
      if (!nextList.length) {
        nextList = this.state.participants.filter(entry => {
          if (String(entry.participantId) !== targetId) return true;
          if (!rowKey) return false;
          return String(entry.rowKey || "") !== String(rowKey);
        });
      }
    } else if (fallbackEntry) {
      const index = this.state.participants.findIndex(entry => entry === fallbackEntry);
      if (index === -1) {
        return null;
      }
      removed = this.state.participants[index];
      nextList = this.state.participants.filter((_, idx) => idx !== index);
    } else {
      return null;
    }

    this.state.participants = sortParticipants(nextList);

    syncCurrentScheduleCache();
    updateDuplicateMatches();

    const selectedEvent = this.state.events.find(evt => evt.id === this.state.selectedEventId);
    if (selectedEvent?.schedules) {
      const schedule = selectedEvent.schedules.find(s => s.id === this.state.selectedScheduleId);
      if (schedule) {
        schedule.participantCount = this.state.participants.length;
      }
    }

    this.renderParticipants();
    this.updateParticipantContext({ preserveStatus: true });
    this.state.editingParticipantId = null;
    this.state.editingRowKey = null;
    return removed;
  }

  /**
   * 参加者データをFirebaseに保存する
   * @param {Object} options - オプション
   * @returns {Promise<boolean>}
   */
  async handleSave(options = {}) {
    const { allowEmpty = false, successMessage = "参加者リストを更新しました。" } = options || {};
    if (this.state.saving) return;
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) return;
    const savingEmptyList = this.state.participants.length === 0;
    const hasPendingChanges = this.hasUnsavedChanges();

    if (!allowEmpty && savingEmptyList && !hasPendingChanges) {
      this.setUploadStatus("適用する参加者がありません。", "error");
      return false;
    }

    this.state.saving = true;
    if (this.dom.saveButton) this.dom.saveButton.disabled = true;
    this.syncSaveButtonState();
    this.setUploadStatus("適用中です…");
    this.syncClearButtonState();

    try {
      await this.ensureTokenSnapshot(true);
      const event = this.state.events.find(evt => evt.id === eventId);
      if (!event) {
        throw new Error("選択中のイベントが見つかりません。");
      }
      const schedule = event.schedules.find(s => s.id === scheduleId);
      if (!schedule) {
        throw new Error("選択中の日程が見つかりません。");
      }

      const now = Date.now();
      const previousTokens = new Map(this.state.participantTokenMap || []);
      const tokensToRemove = new Set(previousTokens.values());
      const participantsPayload = {};
      const nextTokenMap = new Map();
      const knownTokens = this.state.knownTokens instanceof Set ? this.state.knownTokens : new Set();
      const tokenRecords = this.state.tokenRecords || {};
      this.state.tokenRecords = tokenRecords;

      this.state.participants.forEach(entry => {
        const uid = resolveParticipantUid(entry);
        const participantId = uid || String(entry.participantId || "").trim();
        if (!participantId) return;

        let token = String(entry.token || "").trim();
        const previousToken = previousTokens.get(participantId) || "";
        if (previousToken) {
          tokensToRemove.delete(previousToken);
        }

        if (!token || (token !== previousToken && knownTokens.has(token))) {
          token = this.generateQuestionToken(knownTokens);
        } else if (!knownTokens.has(token)) {
          knownTokens.add(token);
        }

        entry.token = token;
        nextTokenMap.set(participantId, token);

        const guidance = String(entry.guidance || "");
        const departmentValue = String(entry.department || "");
        const storedDepartment = departmentValue;
        const groupNumber = String(entry.groupNumber || "");
        const status = entry.status || resolveParticipantStatus(entry, groupNumber) || "active";
        const isCancelled = entry.isCancelled === true || status === "cancelled";
        const isRelocated = entry.isRelocated === true || status === "relocated";
        const legacyIdRaw = String(entry.legacyParticipantId || "").trim();
        const legacyParticipantId = legacyIdRaw && legacyIdRaw !== participantId ? legacyIdRaw : "";
        const mailStatus = String(entry.mailStatus || "");
        const mailSentAtValue = Number(entry.mailSentAt || 0);
        const mailSentAt = Number.isFinite(mailSentAtValue) && mailSentAtValue >= 0 ? mailSentAtValue : 0;
        const mailError = String(entry.mailError || "");
        const mailLastSubject = String(entry.mailLastSubject || "");
        const mailLastMessageId = String(entry.mailLastMessageId || "");
        const mailSentBy = String(entry.mailSentBy || "");
        const mailLastAttemptAtValue = Number(entry.mailLastAttemptAt || 0);
        const mailLastAttemptAt =
          Number.isFinite(mailLastAttemptAtValue) && mailLastAttemptAtValue >= 0
            ? mailLastAttemptAtValue
            : 0;
        const mailLastAttemptBy = String(entry.mailLastAttemptBy || "");

        participantsPayload[participantId] = {
          participantId,
          uid: participantId,
          legacyParticipantId,
          name: String(entry.name || ""),
          phonetic: String(entry.phonetic || entry.furigana || ""),
          furigana: String(entry.phonetic || entry.furigana || ""),
          gender: String(entry.gender || ""),
          department: storedDepartment,
          groupNumber,
          phone: String(entry.phone || ""),
          email: String(entry.email || ""),
          token,
          guidance,
          status,
          isCancelled,
          isRelocated,
          relocationSourceScheduleId: String(entry.relocationSourceScheduleId || ""),
          relocationSourceScheduleLabel: String(entry.relocationSourceScheduleLabel || ""),
          relocationDestinationScheduleId: String(entry.relocationDestinationScheduleId || ""),
          relocationDestinationScheduleLabel: String(entry.relocationDestinationScheduleLabel || ""),
          relocationDestinationTeamNumber: String(entry.relocationDestinationTeamNumber || ""),
          mailStatus,
          mailSentAt,
          mailError,
          mailLastSubject,
          mailLastMessageId,
          mailSentBy,
          mailLastAttemptAt,
          mailLastAttemptBy,
          updatedAt: now
        };

        const existingTokenRecord = tokenRecords[token] || {};
        // 完全正規化: IDのみを保存し、名前やラベルなどの情報は正規化された場所から取得
        tokenRecords[token] = {
          eventId,
          scheduleId,
          participantId,
          participantUid: participantId,
          groupNumber,
          guidance: guidance || existingTokenRecord.guidance || "",
          revoked: false,
          expiresAt: existingTokenRecord.expiresAt,
          createdAt: existingTokenRecord.createdAt || now,
          updatedAt: now
        };
      });

      const relocationMap = this.ensurePendingRelocationMap();
      const relocationsToProcess = [];
      if (relocationMap instanceof Map) {
        relocationMap.forEach(relocation => {
          if (relocation && relocation.eventId === eventId && relocation.fromScheduleId === scheduleId) {
            relocationsToProcess.push(relocation);
          }
        });
      }

      const additionalUpdates = [];
      const processedRelocations = [];
      const questionsByParticipant = new Map();
      let questionStatusBranch = {};

      if (relocationsToProcess.length) {
        try {
          const fetchedQuestions = await fetchDbValue("questions/normal");
          if (fetchedQuestions && typeof fetchedQuestions === "object") {
            // tokenからparticipantIdを取得して質問をフィルタリング
            const tokenRecords = this.state.tokenRecords || {};
            Object.entries(fetchedQuestions).forEach(([questionUid, record]) => {
              if (!record || typeof record !== "object") return;
              const questionToken = String(record.token || "").trim();
              if (!questionToken) return;
              const tokenRecord = tokenRecords[questionToken] || {};
              const participantKey = String(tokenRecord.participantId || "");
              if (!participantKey) return;
              if (!questionsByParticipant.has(participantKey)) {
                questionsByParticipant.set(participantKey, []);
              }
              questionsByParticipant.get(participantKey).push({ questionUid, record });
            });
          }
        } catch (error) {
          console.warn("質問データの取得に失敗しました", error);
        }

        // questionStatusはイベントごとに分離されているため、eventIdが必要
        // レガシーパスquestionStatusからの取得は削除（イベントごとのquestionStatusのみ使用）
        // 質問データからeventIdを取得してquestionStatusを参照する必要がある場合は、
        // 個別の質問レコードからeventIdを取得してquestionStatus/${eventId}から取得する
        // ここでは空のオブジェクトを設定（必要に応じて個別に取得）
        questionStatusBranch = {};
      }

      relocationsToProcess.forEach(relocation => {
        if (!relocation || !relocation.toScheduleId) {
          return;
        }
        const uid = String(relocation.uid || relocation.participantId || "");
        if (!uid) {
          return;
        }
        const destinationScheduleId = String(relocation.toScheduleId);
        const originEntry = this.state.participants.find(item => String(item.participantId || "") === uid) || relocation.entrySnapshot || {};
        const destinationSchedule = this.getScheduleRecord(eventId, destinationScheduleId) || {};
        const destinationLabel = destinationSchedule.label || destinationSchedule.date || destinationSchedule.id || "";
        const destinationDate = destinationSchedule.date || "";
        const destinationStart = destinationSchedule.startAt || "";
        const destinationEnd = destinationSchedule.endAt || "";
        const destinationLocation = destinationSchedule.location || "";
        const destinationTeam = String(relocation.destinationTeamNumber || "");
        const token = nextTokenMap.get(uid) || "";
        const legacyId = String(originEntry.legacyParticipantId || "").trim();
        const guidanceText = String(originEntry.guidance || "");

        const relocatedRecord = {
          participantId: uid,
          uid: uid,
          legacyParticipantId: legacyId && legacyId !== uid ? legacyId : "",
          name: String(originEntry.name || ""),
          phonetic: String(originEntry.phonetic || originEntry.furigana || ""),
          furigana: String(originEntry.phonetic || originEntry.furigana || ""),
          gender: String(originEntry.gender || ""),
          department: String(originEntry.department || ""),
          phone: String(originEntry.phone || ""),
          email: String(originEntry.email || ""),
          groupNumber: destinationTeam,
          token,
          guidance: guidanceText,
          status: "relocated",
          isCancelled: false,
          isRelocated: true,
          relocationSourceScheduleId: scheduleId,
          relocationSourceScheduleLabel: schedule.label || scheduleId,
          relocationDestinationTeamNumber: destinationTeam,
          updatedAt: now
        };

        additionalUpdates.push([
          `questionIntake/participants/${eventId}/${destinationScheduleId}/${uid}`,
          relocatedRecord
        ]);

        const cacheBranch = this.state.eventParticipantCache instanceof Map ? this.state.eventParticipantCache.get(eventId) : null;
        const destinationList = cacheBranch && Array.isArray(cacheBranch[destinationScheduleId])
          ? cacheBranch[destinationScheduleId]
          : [];
        additionalUpdates.push([
          `questionIntake/schedules/${eventId}/${destinationScheduleId}/participantCount`,
          destinationList.length
        ]);
        additionalUpdates.push([
          `questionIntake/schedules/${eventId}/${destinationScheduleId}/updatedAt`,
          now
        ]);

        if (token) {
          const existingTokenRecord = this.state.tokenRecords[token] || {};
          // 完全正規化: IDのみを保存し、名前やラベルなどの情報は正規化された場所から取得
          this.state.tokenRecords[token] = {
            eventId,
            scheduleId: destinationScheduleId,
            participantId: uid,
            participantUid: uid,
            groupNumber: destinationTeam,
            guidance: guidanceText || existingTokenRecord.guidance || "",
            revoked: false,
            expiresAt: existingTokenRecord.expiresAt,
            createdAt: existingTokenRecord.createdAt || now,
            updatedAt: now
          };
        }

        const questionEntries = questionsByParticipant.get(uid) || [];
        questionEntries.forEach(({ questionUid, record }) => {
          if (!questionUid || !record) return;
          // questions/normalのレコードから削除されたフィールド（eventId, scheduleId, schedule等）は設定しない
          // tokenを更新することで、tokenから情報を取得できるようになる
          const updatedQuestion = { ...record };
          updatedQuestion.updatedAt = now;
          additionalUpdates.push([
            `questions/normal/${questionUid}`,
            updatedQuestion
          ]);

          // questionStatusはイベントごとに分離されているため、tokenからeventIdを取得
          const questionToken = String(record.token || "").trim();
          if (questionToken) {
            const tokenRecord = this.state.tokenRecords[questionToken] || {};
            const questionEventId = String(tokenRecord.eventId || eventId || "").trim();
            if (questionEventId) {
              // イベントごとのquestionStatusから取得を試みる（必要に応じて）
              // ここでは質問データの更新のみ行い、questionStatusは個別に管理される
              // 必要に応じて、questionStatus/${questionEventId}/${questionUid}から取得する処理を追加
            }
          }
        });

        processedRelocations.push(uid);
      });

      tokensToRemove.forEach(token => {
        if (!token) return;
        knownTokens.delete(token);
        delete this.state.tokenRecords[token];
      });

      this.state.knownTokens = knownTokens;

      const updates = {
        [`questionIntake/participants/${eventId}/${scheduleId}`]: participantsPayload,
        [`questionIntake/schedules/${eventId}/${scheduleId}/participantCount`]: this.state.participants.length,
        [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      };

      additionalUpdates.forEach(([path, value]) => {
        updates[path] = value;
      });

      Object.entries(this.state.tokenRecords).forEach(([token, record]) => {
        updates[`questionIntake/tokens/${token}`] = record;
      });

      // 空文字列のトークンを除外して、不正なパスが生成されるのを防ぐ
      tokensToRemove.forEach(token => {
        const trimmedToken = String(token || "").trim();
        if (trimmedToken) {
          updates[`questionIntake/tokens/${trimmedToken}`] = null;
        }
      });

      await update(rootDbRef(), updates);

      if (processedRelocations.length) {
        const relocationState = this.ensurePendingRelocationMap();
        processedRelocations.forEach(uid => {
          relocationState.delete(uid);
        });
      }

      this.state.participantTokenMap = nextTokenMap;
      this.captureParticipantBaseline(this.state.participants);
      this.setUploadStatus(successMessage || "参加者リストを更新しました。", "success");
      await this.loadEvents({ preserveSelection: true });
      await this.loadParticipants();
      this.state.tokenSnapshotFetchedAt = Date.now();
      this.updateParticipantContext({ preserveStatus: true });
      return true;
    } catch (error) {
      console.error(error);
      this.setUploadStatus(error.message || "適用に失敗しました。", "error");
      if (this.dom.saveButton) this.dom.saveButton.disabled = false;
      return false;
    } finally {
      this.state.saving = false;
      this.syncSaveButtonState();
      this.syncClearButtonState();
    }
  }
}
