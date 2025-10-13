import { queryDom } from "./dom.js";
import { database, ref, get } from "../operator/firebase.js";
import { formatScheduleRange } from "../operator/utils.js";

const ensureString = (value) => String(value ?? "").trim();

function formatParticipantCount(value) {
  if (value == null || value === "") {
    return "—";
  }
  const numberValue = Number(value);
  if (!Number.isNaN(numberValue)) {
    return `${numberValue}名`;
  }
  return `${value}`;
}

export class ScheduleHubApp {
  constructor() {
    this.dom = queryDom();
    this.context = this.parseContext();
    this.eventData = null;
    this.scheduleData = null;
  }

  parseContext() {
    const base = {
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      participantCount: "",
      scheduleKey: ""
    };

    if (typeof window === "undefined") {
      return base;
    }

    try {
      const params = new URLSearchParams(window.location.search || "");
      base.eventId = ensureString(params.get("eventId") ?? params.get("event"));
      base.scheduleId = ensureString(params.get("scheduleId") ?? params.get("schedule"));
      base.eventName = ensureString(params.get("eventName") ?? params.get("eventLabel"));
      base.scheduleLabel = ensureString(params.get("scheduleLabel") ?? params.get("scheduleName"));
      base.startAt = ensureString(params.get("startAt") ?? params.get("scheduleStart"));
      base.endAt = ensureString(params.get("endAt") ?? params.get("scheduleEnd"));
      base.participantCount = ensureString(params.get("participantCount") ?? params.get("participants"));
      base.scheduleKey = ensureString(params.get("scheduleKey"));
    } catch (error) {
      console.debug("failed to parse schedule hub context", error);
    }

    return base;
  }

  init() {
    this.updateBackLink();
    this.renderSummaryFromContext();
    this.updateActionLinks();

    if (!this.context.eventId || !this.context.scheduleId) {
      this.showError("イベントIDまたは日程IDが指定されていません。URL を確認してください。");
      this.toggleLoading(false);
      return;
    }

    this.toggleLoading(true);
    this.loadData();
  }

  toggleLoading(isLoading) {
    if (this.dom.loading) {
      this.dom.loading.hidden = !isLoading;
    }
  }

  renderSummaryFromContext() {
    const { eventName, scheduleLabel, startAt, endAt, participantCount } = this.context;

    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }

    if (this.dom.scheduleLabel && scheduleLabel) {
      this.dom.scheduleLabel.textContent = scheduleLabel;
    }

    if (this.dom.scheduleRange) {
      const rangeText = formatScheduleRange(startAt, endAt);
      if (rangeText) {
        this.dom.scheduleRange.textContent = rangeText;
        this.dom.scheduleRange.hidden = false;
      } else if (startAt || endAt) {
        this.dom.scheduleRange.textContent = "";
        this.dom.scheduleRange.hidden = true;
      }
    }

    if (this.dom.participantCount) {
      if (participantCount !== "") {
        this.dom.participantCount.textContent = formatParticipantCount(participantCount);
      } else {
        this.dom.participantCount.textContent = "—";
      }
    }

    if (this.dom.summary && (eventName || scheduleLabel || participantCount)) {
      this.dom.summary.hidden = false;
    }

    this.updateDocumentTitle();
    this.updateMetaNote();
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const eventLabel = ensureString(this.eventData?.name) || this.context.eventName;
    const scheduleLabel = ensureString(this.scheduleData?.label) || this.context.scheduleLabel;

    if (eventLabel || scheduleLabel) {
      if (eventLabel && scheduleLabel) {
        document.title = `${scheduleLabel} / ${eventLabel} - 日程コントロールハブ`;
      } else {
        const label = scheduleLabel || eventLabel;
        document.title = `${label} - 日程コントロールハブ`;
      }
    }
  }

  updateMetaNote() {
    if (!this.dom.metaNote) return;
    const { eventId, scheduleId } = this.context;
    if (eventId || scheduleId) {
      const scheduleKey = this.resolveScheduleKey();
      this.dom.metaNote.hidden = false;
      this.dom.metaNote.textContent = `イベントID: ${eventId || "?"} / 日程ID: ${scheduleId || "?"}` +
        (scheduleKey ? ` / Key: ${scheduleKey}` : "");
    } else {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
    }
  }

  async loadData() {
    const { eventId, scheduleId } = this.context;

    try {
      const [eventSnapshot, scheduleSnapshot] = await Promise.all([
        get(ref(database, `questionIntake/events/${eventId}`)),
        get(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`))
      ]);

      if (!eventSnapshot.exists()) {
        throw new Error(`イベント「${eventId}」が見つかりません。`);
      }

      if (!scheduleSnapshot.exists()) {
        throw new Error(`日程「${scheduleId}」が見つかりません。`);
      }

      this.eventData = eventSnapshot.val();
      this.scheduleData = scheduleSnapshot.val();

      this.applyFetchedData();
      this.updateActionLinks();
      this.toggleLoading(false);
    } catch (error) {
      console.error(error);
      let message = "日程情報の読み込みに失敗しました。";
      if (error && typeof error.code === "string" && error.code.includes("PERMISSION")) {
        message = "データベースの読み取り権限がありません。管理者に確認してください。";
      } else if (error instanceof Error && error.message) {
        message = error.message;
      }
      this.toggleLoading(false);
      this.showError(message);
    }
  }

  applyFetchedData() {
    const eventName = ensureString(this.eventData?.name);
    const scheduleLabel = ensureString(this.scheduleData?.label);
    const startAt = ensureString(this.scheduleData?.startAt || this.context.startAt);
    const endAt = ensureString(this.scheduleData?.endAt || this.context.endAt);
    const participantCount = this.scheduleData?.participantCount ?? this.context.participantCount;

    if (eventName) {
      this.context.eventName = eventName;
    }
    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }

    if (scheduleLabel) {
      this.context.scheduleLabel = scheduleLabel;
    }
    if (this.dom.scheduleLabel && scheduleLabel) {
      this.dom.scheduleLabel.textContent = scheduleLabel;
    }

    if (startAt) {
      this.context.startAt = startAt;
    }
    if (endAt) {
      this.context.endAt = endAt;
    }

    if (this.dom.scheduleRange) {
      const rangeText = formatScheduleRange(startAt, endAt);
      if (rangeText) {
        this.dom.scheduleRange.textContent = rangeText;
        this.dom.scheduleRange.hidden = false;
      } else {
        this.dom.scheduleRange.textContent = "—";
        this.dom.scheduleRange.hidden = false;
      }
    }

    if (this.dom.participantCount) {
      const normalizedCount = participantCount ?? "";
      this.context.participantCount = normalizedCount === "" ? "" : String(normalizedCount);
      this.dom.participantCount.textContent = formatParticipantCount(normalizedCount);
    }

    if (this.dom.summary) {
      this.dom.summary.hidden = false;
    }

    this.updateDocumentTitle();
    this.updateMetaNote();
  }

  showError(message) {
    if (this.dom.alert) {
      this.dom.alert.textContent = message;
      this.dom.alert.hidden = false;
    }

    if (this.dom.actions) {
      this.dom.actions.hidden = true;
    }
  }

  resolveScheduleKey() {
    if (this.context.scheduleKey) {
      return this.context.scheduleKey;
    }
    if (this.context.eventId && this.context.scheduleId) {
      return `${this.context.eventId}::${this.context.scheduleId}`;
    }
    return "";
  }

  updateBackLink() {
    if (!this.dom.backLink || typeof window === "undefined") return;
    const url = new URL("question-admin.html", window.location.href);
    if (this.context.eventId) {
      url.searchParams.set("eventId", this.context.eventId);
    }
    this.dom.backLink.href = url.toString();
  }

  updateActionLinks() {
    if (typeof window === "undefined") return;
    const { eventId, scheduleId } = this.context;
    if (!eventId || !scheduleId) {
      if (this.dom.actions) {
        this.dom.actions.hidden = true;
      }
      return;
    }

    const scheduleLabel = ensureString(this.scheduleData?.label) || this.context.scheduleLabel;
    const eventName = ensureString(this.eventData?.name) || this.context.eventName;
    const startAt = ensureString(this.scheduleData?.startAt || this.context.startAt);
    const endAt = ensureString(this.scheduleData?.endAt || this.context.endAt);
    const scheduleKey = this.resolveScheduleKey();

    if (this.dom.operatorLink) {
      const operatorUrl = new URL("operator.html", window.location.href);
      operatorUrl.searchParams.set("eventId", eventId);
      operatorUrl.searchParams.set("scheduleId", scheduleId);
      operatorUrl.searchParams.set("scheduleKey", scheduleKey);
      if (eventName) operatorUrl.searchParams.set("eventName", eventName);
      if (scheduleLabel) operatorUrl.searchParams.set("scheduleLabel", scheduleLabel);
      if (startAt) operatorUrl.searchParams.set("startAt", startAt);
      if (endAt) operatorUrl.searchParams.set("endAt", endAt);
      this.dom.operatorLink.href = operatorUrl.toString();
    }

    if (this.dom.participantsLink) {
      const adminUrl = new URL("question-admin.html", window.location.href);
      adminUrl.searchParams.set("eventId", eventId);
      adminUrl.searchParams.set("scheduleId", scheduleId);
      adminUrl.searchParams.set("focus", "participants");
      if (scheduleLabel) adminUrl.searchParams.set("scheduleLabel", scheduleLabel);
      if (eventName) adminUrl.searchParams.set("eventName", eventName);
      this.dom.participantsLink.href = adminUrl.toString();
    }

    if (this.dom.actions) {
      this.dom.actions.hidden = false;
    }
  }
}
