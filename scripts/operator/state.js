import { OPERATOR_MODE_TELOP } from "../shared/operator-modes.js";

export function createInitialState(autoScroll = true) {
  return {
    questionsByUid: new Map(),
    questionStatusByUid: new Map(),
    allQuestions: [],
    allLogs: [],
    currentSubTab: "all",
    currentGenre: "",
    currentSchedule: "",
    lastNormalSchedule: "",
    availableSchedules: [],
    scheduleDetails: new Map(),
    scheduleMetadata: new Map(),
    activeEventId: "",
    activeScheduleId: "",
    activeEventName: "",
    activeScheduleLabel: "",
    eventsById: new Map(),
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: autoScroll,
    renderState: null,
    displaySession: null,
    displaySessionActive: false,
    displaySessionLastActive: null,
    autoLockAttemptKey: "",
    autoLockAttemptAt: 0,
    operatorPresenceEventId: "",
    operatorPresenceByUser: new Map(),
    operatorPresenceSelf: null,
    channelAssignment: null,
    channelLocking: false,
    scheduleConflict: null,
    conflictSelection: "",
    operatorMode: OPERATOR_MODE_TELOP
  };
}
