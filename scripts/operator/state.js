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
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: autoScroll,
    displaySession: null,
    displaySessionActive: false,
    displaySessionLastActive: null
  };
}
