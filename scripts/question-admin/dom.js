// dom.js: 質問管理UIで利用するDOMテンプレート生成とレンダリングヘルパーです。
function getPrefix() {
  if (typeof document === "undefined") {
    return "";
  }

  const html = document.documentElement;
  const existingPrefix = html?.dataset?.qaEmbedPrefix?.trim();
  if (existingPrefix) {
    return existingPrefix;
  }

  const embedSurface = document.querySelector("[data-qa-embed]");
  if (embedSurface) {
    const detectedPrefix =
      embedSurface.getAttribute("data-qa-embed-prefix")?.trim() || "qa-";
    if (html) {
      html.dataset.qaEmbedPrefix = detectedPrefix;
    }
    return detectedPrefix;
  }

  return "";
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
  participantModule: resolve("participant-module"),
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
  scheduleLocationInput: resolve("schedule-location-input"),
  scheduleLocationList: resolve("schedule-location-list"),
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
  participantDescription: resolve("participant-description"),
  participantDescriptionMain: resolve("participant-description-main"),
  participantTabList: resolve("participant-tablist"),
  participantManageTab: resolve("participant-tab-manage"),
  participantCsvTab: resolve("participant-tab-csv"),
  participantManagePanel: resolve("participant-tabpanel-manage"),
  participantCsvPanel: resolve("participant-tabpanel-csv"),
  downloadParticipantTemplateButton: resolve("download-participant-template"),
  openPrintViewButton: resolve("open-print-view-button"),
  printPreviewDialog: resolve("print-dialog"),
  printPreview: resolve("print-preview"),
  printPreviewFrame: resolve("print-preview-frame"),
  printPreviewMeta: resolve("print-preview-meta"),
  printPreviewNote: resolve("print-preview-note"),
  printPreviewPrintButton: resolve("print-preview-print"),
  printPreviewCloseButton: resolve("print-preview-close"),
  printSettingsForm: resolve("print-settings-form"),
  printPaperSizeInput: resolve("print-paper-size"),
  printOrientationInput: resolve("print-orientation"),
  printMarginInput: resolve("print-margin"),
  printShowHeaderInput: resolve("print-show-header"),
  printRepeatHeaderInput: resolve("print-repeat-header"),
  printShowPageNumberInput: resolve("print-show-page-number"),
  printShowDateInput: resolve("print-show-date"),
  printShowTimeInput: resolve("print-show-time"),
  printSettingsCancelButton: resolve("print-settings-cancel"),
  sendMailButton: resolve("send-mail-button"),
  csvInput: resolve("csv-input"),
  downloadTeamTemplateButton: resolve("download-team-template"),
  teamCsvInput: resolve("team-csv-input"),
  saveButton: resolve("save-button"),
  discardButton: resolve("discard-button"),
  clearParticipantsButton: resolve("clear-participants-button"),
  editSelectedParticipantButton: resolve("edit-selected-participant-button"),
  cancelSelectedParticipantButton: resolve("cancel-selected-participant-button"),
  relocateSelectedParticipantButton: resolve("relocate-selected-participant-button"),
  deleteSelectedParticipantButton: resolve("delete-selected-participant-button"),
  uploadStatus: resolve("upload-status"),
  participantActionPanel: resolve("participant-action-panel"),
  participantActionInfo: resolve("participant-action-info"),
  changePreview: resolve("change-preview"),
  changePreviewList: resolve("change-preview-list"),
  changePreviewCount: resolve("change-preview-count"),
  changePreviewNote: resolve("change-preview-note"),
  fileLabel: resolve("file-label"),
  teamFileLabel: resolve("team-file-label"),
  participantCardList: resolve("participant-card-list"),
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
dom.participantNameInput = resolve("participant-name-input");
dom.participantPhoneticInput = resolve("participant-phonetic-input");
dom.participantGenderInput = resolve("participant-gender-input");
dom.participantDepartmentInput = resolve("participant-department-input");
dom.participantTeamInput = resolve("participant-team-input");
dom.participantRelocationSummary = resolve("participant-relocation-summary");
dom.participantRelocationSummaryText = resolve("participant-relocation-summary-text");
dom.participantPhoneInput = resolve("participant-phone-input");
dom.participantEmailInput = resolve("participant-email-input");
dom.participantMailSentInput = resolve("participant-mail-sent-input");

dom.relocationDialog = resolve("relocation-dialog");
dom.relocationForm = resolve("relocation-form");
dom.relocationList = resolve("relocation-list");
dom.relocationDescription = resolve("relocation-description");
dom.relocationError = resolve("relocation-error");

dom.eventDialogForm = dom.eventForm;

dom.scheduleDialogFields = {
  label: dom.scheduleLabelInput,
  location: dom.scheduleLocationInput,
  date: dom.scheduleDateInput,
  start: dom.scheduleStartTimeInput,
  end: dom.scheduleEndTimeInput
};

dom.participantFormFields = {
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
