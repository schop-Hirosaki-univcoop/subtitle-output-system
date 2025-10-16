function getPrefix() {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement?.dataset?.qaEmbedPrefix || "";
}

function resolve(id) {
  const prefix = getPrefix();
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

const dom = {
  loadingOverlay: resolve("loading-overlay"),
  loadingText: resolve("loading-text"),
  loaderSteps: resolve("loader-steps"),
  loginCard: resolve("login-card"),
  loginButton: resolve("login-button"),
  adminMain: resolve("admin-main"),
  headerLogout: resolve("header-logout"),
  userInfo: resolve("user-info"),
  logoutButton: resolve("logout-button"),
  refreshButton: resolve("refresh-button"),
  addEventButton: resolve("add-event-button"),
  addScheduleButton: resolve("add-schedule-button"),
  eventDialog: resolve("event-dialog"),
  eventForm: resolve("event-form"),
  eventNameInput: resolve("event-name-input"),
  eventError: resolve("event-error"),
  scheduleDialog: resolve("schedule-dialog"),
  scheduleForm: resolve("schedule-form"),
  scheduleLabelInput: resolve("schedule-label-input"),
  scheduleDateInput: resolve("schedule-date-input"),
  scheduleStartTimeInput: resolve("schedule-start-time-input"),
  scheduleEndTimeInput: resolve("schedule-end-time-input"),
  scheduleError: resolve("schedule-error"),
  scheduleDialogCalendar: resolve("schedule-dialog-calendar"),
  scheduleDialogCalendarTitle: resolve("schedule-dialog-calendar-title"),
  scheduleDialogCalendarGrid: resolve("schedule-dialog-calendar-grid"),
  scheduleDialogCalendarPrev: resolve("schedule-dialog-calendar-prev"),
  scheduleDialogCalendarNext: resolve("schedule-dialog-calendar-next"),
  eventList: resolve("event-list"),
  eventEmpty: resolve("event-empty"),
  scheduleList: resolve("schedule-list"),
  scheduleEmpty: resolve("schedule-empty"),
  scheduleDescription: resolve("schedule-description"),
  participantContext: resolve("participant-context"),
  participantDescription: resolve("participant-description"),
  downloadParticipantTemplateButton: resolve("download-participant-template"),
  csvInput: resolve("csv-input"),
  downloadTeamTemplateButton: resolve("download-team-template"),
  teamCsvInput: resolve("team-csv-input"),
  saveButton: resolve("save-button"),
  discardButton: resolve("discard-button"),
  clearParticipantsButton: resolve("clear-participants-button"),
  uploadStatus: resolve("upload-status"),
  changePreview: resolve("change-preview"),
  changePreviewList: resolve("change-preview-list"),
  changePreviewCount: resolve("change-preview-count"),
  changePreviewNote: resolve("change-preview-note"),
  fileLabel: resolve("file-label"),
  teamFileLabel: resolve("team-file-label"),
  mappingTbody: resolve("mapping-tbody"),
  adminSummary: resolve("admin-summary"),
  loginError: resolve("login-error"),
  copyrightYear: resolve("copyright-year")
};

dom.eventDialogTitle = resolve("event-dialog-title");
dom.scheduleDialogTitle = resolve("schedule-dialog-title");
dom.participantDialog = resolve("participant-dialog");
dom.participantForm = resolve("participant-form");
dom.participantDialogTitle = resolve("participant-dialog-title");
dom.participantError = resolve("participant-error");
dom.participantIdInput = resolve("participant-id-input");
dom.participantNameInput = resolve("participant-name-input");
dom.participantPhoneticInput = resolve("participant-phonetic-input");
dom.participantGenderInput = resolve("participant-gender-input");
dom.participantDepartmentInput = resolve("participant-department-input");
dom.participantTeamInput = resolve("participant-team-input");
dom.participantPhoneInput = resolve("participant-phone-input");
dom.participantEmailInput = resolve("participant-email-input");

dom.eventDialogForm = dom.eventForm;

dom.scheduleDialogFields = {
  label: dom.scheduleLabelInput,
  date: dom.scheduleDateInput,
  start: dom.scheduleStartTimeInput,
  end: dom.scheduleEndTimeInput
};

dom.participantFormFields = {
  id: dom.participantIdInput,
  name: dom.participantNameInput,
  phonetic: dom.participantPhoneticInput,
  gender: dom.participantGenderInput,
  department: dom.participantDepartmentInput,
  team: dom.participantTeamInput,
  phone: dom.participantPhoneInput,
  email: dom.participantEmailInput
};

dom.confirmDialog = resolve("confirm-dialog");
dom.confirmDialogTitle = resolve("confirm-dialog-title");
dom.confirmDialogMessage = resolve("confirm-dialog-message");
dom.confirmAcceptButton = resolve("confirm-accept-button");
dom.confirmCancelButton = resolve("confirm-cancel-button");

export { dom };
