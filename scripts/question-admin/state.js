// state.js: 質問管理画面のアプリケーションステートとデータ整形ロジックを定義します。
const state = {
  events: [],
  selectedEventId: null,
  selectedScheduleId: null,
  participants: [],
  savedParticipants: [],
  savedParticipantEntries: [],
  lastSavedSignature: "",
  participantBaselineReady: false,
  user: null,
  saving: false,
  mailSending: false,
  tokenRecords: {},
  knownTokens: new Set(),
  participantTokenMap: new Map(),
  eventParticipantCache: new Map(),
  duplicateMatches: new Map(),
  duplicateGroups: new Map(),
  scheduleContextOverrides: new Map(),
  scheduleLocationHistory: new Set(),
  teamAssignments: new Map(),
  glRoster: new Map(),
  glAssignments: new Map(),
  printSettings: {
    paperSize: "A4",
    orientation: "portrait",
    margin: "5mm",
    customWidth: 210,
    customHeight: 297,
    showHeader: true,
    repeatHeader: false,
    showPageNumbers: true,
    showDate: true,
    showTime: true,
    showPhone: true,
    showEmail: true
  },
  lastUploadStatusMessage: "",
  lastUploadStatusVariant: "",
  tokenSnapshotFetchedAt: 0,
  editingParticipantId: null,
  editingRowKey: null,
  selectedParticipantId: "",
  selectedParticipantRowKey: "",
  pendingRelocations: new Map(),
  relocationDraftOriginals: new Map(),
  relocationPromptTargets: [],
  initialSelection: null,
  initialSelectionApplied: false,
  initialSelectionNotice: null,
  initialFocusTarget: "",
  activeParticipantTab: "manage"
};

const calendarState = {
  pickedDate: ""
};

const dialogCalendarState = {
  referenceDate: new Date(),
  selectedDate: ""
};

const loaderState = {
  items: [],
  currentIndex: -1
};

function resetTokenState() {
  state.tokenRecords = {};
  state.knownTokens = new Set();
  state.participantTokenMap = new Map();
  state.tokenSnapshotFetchedAt = 0;
}

export {
  state,
  calendarState,
  dialogCalendarState,
  loaderState,
  resetTokenState
};
