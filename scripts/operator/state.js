import { GENRE_OPTIONS } from "./constants.js";

export function createInitialState(autoScroll = true) {
  return {
    allQuestions: [],
    allLogs: [],
    currentSubTab: "normal",
    currentGenre: GENRE_OPTIONS[0],
    currentSchedule: "",
    lastNormalSchedule: "",
    availableSchedules: [],
    scheduleDetails: new Map(),
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: autoScroll,
    renderState: null,
    displaySession: null,
    displaySessionActive: false,
    displaySessionLastActive: null
  };
}
