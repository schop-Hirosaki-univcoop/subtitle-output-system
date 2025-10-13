const state = {
  events: [],
  selectedEventId: null,
  selectedScheduleId: null,
  participants: [],
  savedParticipants: [],
  lastSavedSignature: "",
  user: null,
  saving: false,
  tokenRecords: {},
  knownTokens: new Set(),
  participantTokenMap: new Map(),
  eventParticipantCache: new Map(),
  duplicateMatches: new Map(),
  duplicateGroups: new Map(),
  teamAssignments: new Map(),
  tokenSnapshotFetchedAt: 0,
  editingParticipantId: null,
  editingRowKey: null,
  initialSelection: null,
  initialSelectionApplied: false,
  initialSelectionNotice: null,
  initialFocusTarget: ""
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
