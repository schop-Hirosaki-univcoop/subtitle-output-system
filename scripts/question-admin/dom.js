const dom = {
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingText: document.getElementById("loading-text"),
  loaderSteps: document.getElementById("loader-steps"),
  loginCard: document.getElementById("login-card"),
  loginButton: document.getElementById("login-button"),
  adminMain: document.getElementById("admin-main"),
  headerLogout: document.getElementById("header-logout"),
  userInfo: document.getElementById("user-info"),
  logoutButton: document.getElementById("logout-button"),
  refreshButton: document.getElementById("refresh-button"),
  addEventButton: document.getElementById("add-event-button"),
  addScheduleButton: document.getElementById("add-schedule-button"),
  eventDialog: document.getElementById("event-dialog"),
  eventForm: document.getElementById("event-form"),
  eventNameInput: document.getElementById("event-name-input"),
  eventError: document.getElementById("event-error"),
  scheduleDialog: document.getElementById("schedule-dialog"),
  scheduleForm: document.getElementById("schedule-form"),
  scheduleLabelInput: document.getElementById("schedule-label-input"),
  scheduleDateInput: document.getElementById("schedule-date-input"),
  scheduleStartTimeInput: document.getElementById("schedule-start-time-input"),
  scheduleEndTimeInput: document.getElementById("schedule-end-time-input"),
  scheduleError: document.getElementById("schedule-error"),
  scheduleDialogCalendar: document.getElementById("schedule-dialog-calendar"),
  scheduleDialogCalendarTitle: document.getElementById("schedule-dialog-calendar-title"),
  scheduleDialogCalendarGrid: document.getElementById("schedule-dialog-calendar-grid"),
  scheduleDialogCalendarPrev: document.getElementById("schedule-dialog-calendar-prev"),
  scheduleDialogCalendarNext: document.getElementById("schedule-dialog-calendar-next"),
  eventList: document.getElementById("event-list"),
  eventEmpty: document.getElementById("event-empty"),
  scheduleList: document.getElementById("schedule-list"),
  scheduleEmpty: document.getElementById("schedule-empty"),
  scheduleDescription: document.getElementById("schedule-description"),
  participantContext: document.getElementById("participant-context"),
  participantDescription: document.getElementById("participant-description"),
  downloadParticipantTemplateButton: document.getElementById("download-participant-template"),
  csvInput: document.getElementById("csv-input"),
  downloadTeamTemplateButton: document.getElementById("download-team-template"),
  teamCsvInput: document.getElementById("team-csv-input"),
  saveButton: document.getElementById("save-button"),
  clearParticipantsButton: document.getElementById("clear-participants-button"),
  uploadStatus: document.getElementById("upload-status"),
  fileLabel: document.getElementById("file-label"),
  teamFileLabel: document.getElementById("team-file-label"),
  mappingTbody: document.getElementById("mapping-tbody"),
  adminSummary: document.getElementById("admin-summary"),
  loginError: document.getElementById("login-error"),
  copyrightYear: document.getElementById("copyright-year")
};

dom.eventDialogTitle = document.getElementById("event-dialog-title");
dom.scheduleDialogTitle = document.getElementById("schedule-dialog-title");
dom.participantDialog = document.getElementById("participant-dialog");
dom.participantForm = document.getElementById("participant-form");
dom.participantDialogTitle = document.getElementById("participant-dialog-title");
dom.participantError = document.getElementById("participant-error");
dom.participantIdInput = document.getElementById("participant-id-input");
dom.participantNameInput = document.getElementById("participant-name-input");
dom.participantPhoneticInput = document.getElementById("participant-phonetic-input");
dom.participantGenderInput = document.getElementById("participant-gender-input");
dom.participantDepartmentInput = document.getElementById("participant-department-input");
dom.participantTeamInput = document.getElementById("participant-team-input");
dom.participantPhoneInput = document.getElementById("participant-phone-input");
dom.participantEmailInput = document.getElementById("participant-email-input");

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

dom.confirmDialog = document.getElementById("confirm-dialog");
dom.confirmDialogTitle = document.getElementById("confirm-dialog-title");
dom.confirmDialogMessage = document.getElementById("confirm-dialog-message");
dom.confirmAcceptButton = document.getElementById("confirm-accept-button");
dom.confirmCancelButton = document.getElementById("confirm-cancel-button");

export { dom };
