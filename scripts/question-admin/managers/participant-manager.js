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
  describeDuplicateMatch
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
}
