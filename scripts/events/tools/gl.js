import {
  database,
  ref,
  onValue,
  update,
  set,
  push,
  serverTimestamp,
  getGlEventConfigRef,
  getGlApplicationsRef,
  getGlAssignmentsRef,
  get,
  glIntakeFacultyCatalogRef
} from "../../operator/firebase.js";
import { ensureString, formatDateTimeLocal, logError } from "../helpers.js";
import { normalizeFacultyList } from "./gl-faculty-utils.js";

const ASSIGNMENT_VALUE_ABSENT = "__absent";
const ASSIGNMENT_VALUE_STAFF = "__staff";
const ASSIGNMENT_VALUE_UNAVAILABLE = "__unavailable";
const MAX_TEAM_COUNT = 50;
const ASSIGNMENT_BUCKET_UNASSIGNED = "__unassigned";
const ASSIGNMENT_BUCKET_ABSENT = "__bucket_absent";
const ASSIGNMENT_BUCKET_STAFF = "__bucket_staff";
const ASSIGNMENT_BUCKET_UNAVAILABLE = "__bucket_unavailable";
const SCHEDULE_RESPONSE_POSITIVE_KEYWORDS = ["yes", "true", "1", "available", "参加", "参加可", "ok", "可能", "出席", "参加する"];
const SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS = ["no", "false", "0", "unavailable", "不可", "欠席", "参加不可", "不参加", "参加できない"];
const SCHEDULE_RESPONSE_STAFF_KEYWORDS = ["staff", "運営", "待機", "サポート"];
const INTERNAL_ROLE_OPTIONS = ["司会", "受付", "ラジオ", "機材", "GL", "撮影", "その他"];
const INTERNAL_GRADE_OPTIONS = [
  "1年",
  "2年",
  "3年",
  "4年",
  "修士1年",
  "修士2年",
  "博士1年",
  "博士2年",
  "博士3年",
  "その他（備考欄に記入してください）"
];
const INTERNAL_CUSTOM_OPTION_VALUE = "__custom";

function toDateTimeLocalString(value) {
  if (!value) {
    return "";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return formatDateTimeLocal(new Date(numeric));
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return formatDateTimeLocal(date);
}

function toTimestamp(value) {
  if (!value) return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function parseTeamCount(value) {
  const raw = ensureString(value).trim();
  if (!raw) {
    return { count: 0, error: "" };
  }
  if (!/^\d+$/.test(raw)) {
    return { count: 0, error: "班の数は0以上の整数で入力してください。" };
  }
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { count: 0, error: "班の数は0以上の整数で入力してください。" };
  }
  if (numeric > MAX_TEAM_COUNT) {
    return { count: 0, error: `班は最大${MAX_TEAM_COUNT}班まで設定できます。` };
  }
  return { count: numeric, error: "" };
}

function buildSequentialTeams(count = 0) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(count))) : 0;
  if (safeCount <= 0) {
    return [];
  }
  const teams = [];
  for (let index = 1; index <= safeCount; index += 1) {
    teams.push(`${index}班`);
  }
  return teams;
}

function deriveTeamCountFromConfig(teams = []) {
  if (!Array.isArray(teams)) {
    return 0;
  }
  return teams.map((team) => ensureString(team)).filter(Boolean).length;
}

function sanitizeTeamList(source) {
  if (!source) {
    return [];
  }
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source?.teams)
      ? source.teams
      : [];
  return list
    .map((team) => ensureString(team))
    .map((team) => team.trim())
    .filter((team, index, array) => Boolean(team) && array.indexOf(team) === index)
    .slice(0, MAX_TEAM_COUNT);
}

function normalizeScheduleTeamConfig(raw, fallback = []) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const normalized = {};
  const fallbackTeams = sanitizeTeamList(fallback);
  Object.entries(raw).forEach(([scheduleId, value]) => {
    const id = ensureString(scheduleId);
    if (!id) {
      return;
    }
    const source = value && typeof value === "object" ? value : {};
    const hasExplicitCount = Object.prototype.hasOwnProperty.call(source, "teamCount") && Number.isFinite(source.teamCount);
    const teamCountValue = hasExplicitCount ? Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(Number(source.teamCount)))) : null;
    const teamsFromSource = sanitizeTeamList(source.teams || value);
    let teams = teamsFromSource.slice();
    if (!teams.length) {
      if (hasExplicitCount) {
        teams = buildSequentialTeams(teamCountValue);
      } else if (fallbackTeams.length) {
        teams = fallbackTeams.slice();
      }
    }
    if (!teams.length && !hasExplicitCount) {
      return;
    }
    const teamCount = hasExplicitCount ? teamCountValue : deriveTeamCountFromConfig(teams);
    normalized[id] = {
      teams,
      teamCount
    };
  });
  return normalized;
}

function getScheduleTeams(config, scheduleId) {
  const id = ensureString(scheduleId);
  const defaultTeams = sanitizeTeamList(config?.defaultTeams || config?.teams || []);
  if (!id) {
    return defaultTeams;
  }
  const scheduleTeams = config?.scheduleTeams && typeof config.scheduleTeams === "object"
    ? config.scheduleTeams[id]
    : null;
  const explicitTeams = sanitizeTeamList(scheduleTeams?.teams || scheduleTeams);
  if (explicitTeams.length) {
    return explicitTeams;
  }
  const teamCount = Number.isFinite(scheduleTeams?.teamCount)
    ? Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(scheduleTeams.teamCount)))
    : null;
  if (teamCount !== null) {
    return buildSequentialTeams(teamCount);
  }
  return defaultTeams;
}

function buildScheduleBuckets(teams = []) {
  const columns = [];
  teams.forEach((teamId) => {
    const value = ensureString(teamId);
    if (!value) {
      return;
    }
    columns.push({ key: `team:${value}`, label: value, type: "team", teamId: value });
  });
  columns.push({ key: ASSIGNMENT_BUCKET_UNASSIGNED, label: "未割当", type: "unassigned" });
  columns.push({ key: ASSIGNMENT_BUCKET_ABSENT, label: "欠席", type: "absent" });
  columns.push({ key: ASSIGNMENT_BUCKET_STAFF, label: "運営待機", type: "staff" });
  columns.push({ key: ASSIGNMENT_BUCKET_UNAVAILABLE, label: "参加不可", type: "unavailable" });
  return columns;
}

function determineGradeBadgeVariant(grade) {
  const raw = ensureString(grade).trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)).toLowerCase();
  const digitMatch = normalized.match(/\d/);
  if (digitMatch) {
    const digit = digitMatch[0];
    if (digit >= "1" && digit <= "6") {
      return `year${digit}`;
    }
  }
  return "other";
}

function applyGradeBadge(element, grade) {
  if (!element) {
    return;
  }
  const text = ensureString(grade).trim();
  if (!text) {
    return;
  }
  const variant = determineGradeBadgeVariant(text);
  element.classList.add("gl-grade-badge");
  if (variant) {
    element.classList.add(`gl-grade-badge--${variant}`);
  }
  element.textContent = text;
}

function resolveScheduleResponseValue(application, scheduleId) {
  if (!application || typeof application !== "object") {
    return { raw: undefined, text: "" };
  }
  const shifts = application.shifts && typeof application.shifts === "object" ? application.shifts : {};
  const key = ensureString(scheduleId);
  let raw;
  if (key && Object.prototype.hasOwnProperty.call(shifts, key)) {
    raw = shifts[key];
  } else if (!key || key === "__default__") {
    raw = shifts.__default__;
  }
  if (raw === undefined && Object.prototype.hasOwnProperty.call(shifts, "__default__")) {
    raw = shifts.__default__;
  }
  const text = formatScheduleResponseText(raw);
  return { raw, text };
}

function formatScheduleResponseText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "参加可能" : "参加不可";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? `${value}` : "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatScheduleResponseText(entry))
      .filter(Boolean)
      .join(" / ");
  }
  if (typeof value === "object") {
    const prioritizedKeys = ["label", "text", "status", "value", "answer"];
    for (const key of prioritizedKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const resolved = formatScheduleResponseText(value[key]);
        if (resolved) {
          return resolved;
        }
      }
    }
    const nested = Object.values(value)
      .map((entry) => formatScheduleResponseText(entry))
      .filter(Boolean);
    if (nested.length) {
      return nested.join(" / ");
    }
  }
  return "";
}

function determineScheduleResponseVariant(raw, text) {
  if (raw === true) {
    return "available";
  }
  if (raw === false) {
    return "unavailable";
  }
  const normalized = ensureString(text)
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (SCHEDULE_RESPONSE_STAFF_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "staff";
  }
  if (SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "unavailable";
  }
  if (SCHEDULE_RESPONSE_POSITIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "available";
  }
  return "other";
}

function buildRenderableSchedules(primary = [], fallbackSchedules = [], applications = []) {
  const scheduleMap = new Map();
  const pushSchedule = (schedule) => {
    const id = ensureString(schedule?.id);
    if (!id || scheduleMap.has(id)) {
      return;
    }
    scheduleMap.set(id, {
      id,
      label: ensureString(schedule?.label || schedule?.date || schedule?.name || id),
      date: ensureString(schedule?.date || schedule?.startAt || "")
    });
  };
  sanitizeScheduleEntries(primary).forEach(pushSchedule);
  sanitizeScheduleEntries(fallbackSchedules).forEach(pushSchedule);
  if (!scheduleMap.size) {
    const scheduleIds = new Set();
    applications.forEach((application) => {
      if (!application || typeof application !== "object") {
        return;
      }
      const shifts = application.shifts && typeof application.shifts === "object" ? application.shifts : {};
      Object.keys(shifts || {}).forEach((key) => {
        const id = ensureString(key);
        if (id) {
          scheduleIds.add(id);
        }
      });
    });
    scheduleIds.forEach((id) => {
      pushSchedule({ id, label: id });
    });
  }
  if (!scheduleMap.size) {
    pushSchedule({ id: "__default__", label: "日程未設定" });
  }
  return Array.from(scheduleMap.values());
}

function isApplicantAvailableForSchedule(application, scheduleId) {
  if (!application || typeof application !== "object") {
    return false;
  }
  const shifts = application.shifts && typeof application.shifts === "object" ? application.shifts : {};
  const key = ensureString(scheduleId);
  if (!key || key === "__default__") {
    if (!Object.keys(shifts).length) {
      return true;
    }
    if (key === "__default__") {
      return Boolean(shifts.__default__);
    }
  }
  const value = shifts[key];
  if (
    !Object.prototype.hasOwnProperty.call(shifts, key) &&
    Object.prototype.hasOwnProperty.call(shifts, "__default__")
  ) {
    return Boolean(shifts.__default__);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["yes", "true", "1", "available", "参加", "ok"].includes(normalized)) {
      return true;
    }
    if (["no", "false", "0", "unavailable", "不可", "欠席"].includes(normalized)) {
      return false;
    }
  }
  return Boolean(value);
}

function normalizeScheduleConfig(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return sanitizeScheduleEntries(raw);
  }
  if (typeof raw === "object") {
    const entries = Object.entries(raw).map(([key, value]) => ({
      id: ensureString(value?.id) || ensureString(key),
      label: ensureString(value?.label || value?.date || value?.id || key),
      date: ensureString(value?.date || value?.startAt || "")
    }));
    return sanitizeScheduleEntries(entries);
  }
  return [];
}

function sanitizeScheduleEntries(schedules = []) {
  if (!Array.isArray(schedules) || !schedules.length) {
    return [];
  }
  return schedules
    .map((schedule) => ({
      id: ensureString(schedule?.id),
      label: ensureString(schedule?.label || schedule?.date || schedule?.id),
      date: ensureString(schedule?.date || schedule?.startAt || "")
    }))
    .filter((entry) => entry.id);
}

function buildScheduleConfigMap(schedules = []) {
  const entries = sanitizeScheduleEntries(schedules);
  return entries.reduce((acc, schedule) => {
    const id = schedule.id;
    if (!id) {
      return acc;
    }
    acc[id] = {
      id,
      label: schedule.label,
      date: schedule.date
    };
    return acc;
  }, {});
}

function scheduleSummaryMapsEqual(first = {}, second = {}) {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) {
    return false;
  }
  return firstKeys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(second, key)) {
      return false;
    }
    const firstEntry = first[key] || {};
    const secondEntry = second[key] || {};
    return (
      ensureString(firstEntry.id) === ensureString(secondEntry.id) &&
      ensureString(firstEntry.label) === ensureString(secondEntry.label) &&
      ensureString(firstEntry.date) === ensureString(secondEntry.date)
    );
  });
}

function createSignature(list) {
  try {
    return JSON.stringify(list);
  } catch (error) {
    return "";
  }
}

function normalizeAssignmentEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const status = ensureString(raw.status);
  const teamId = ensureString(raw.teamId);
  if (!status && !teamId) {
    return null;
  }
  return {
    status: status || (teamId ? "team" : ""),
    teamId,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedByUid: ensureString(raw.updatedByUid),
    updatedByName: ensureString(raw.updatedByName)
  };
}

function normalizeAssignmentSnapshot(snapshot = {}) {
  const map = new Map();
  if (!snapshot || typeof snapshot !== "object") {
    return map;
  }
  const ensureEntry = (glId) => {
    const id = ensureString(glId);
    if (!id) {
      return null;
    }
    if (!map.has(id)) {
      map.set(id, { fallback: null, schedules: new Map() });
    }
    return map.get(id) || null;
  };

  Object.entries(snapshot).forEach(([outerKey, outerValue]) => {
    if (!outerValue || typeof outerValue !== "object") {
      return;
    }
    const legacyEntry = normalizeAssignmentEntry(outerValue);
    if (legacyEntry) {
      const entry = ensureEntry(outerKey);
      if (!entry) {
        return;
      }
      entry.fallback = legacyEntry;
      const excludedKeys = new Set(["status", "teamId", "updatedAt", "updatedByUid", "updatedByName", "schedules"]);
      const scheduleSource = outerValue?.schedules && typeof outerValue.schedules === "object"
        ? outerValue.schedules
        : outerValue;
      Object.entries(scheduleSource || {}).forEach(([scheduleId, scheduleValue]) => {
        if (excludedKeys.has(scheduleId)) {
          return;
        }
        const normalized = normalizeAssignmentEntry(scheduleValue);
        if (!normalized) {
          return;
        }
        const key = ensureString(scheduleId);
        if (!key) {
          return;
        }
        entry.schedules.set(key, normalized);
      });
      if (outerValue?.schedules && typeof outerValue.schedules === "object") {
        Object.entries(outerValue.schedules).forEach(([scheduleId, scheduleValue]) => {
          const normalized = normalizeAssignmentEntry(scheduleValue);
          if (!normalized) {
            return;
          }
          const key = ensureString(scheduleId);
          if (!key) {
            return;
          }
          entry.schedules.set(key, normalized);
        });
      }
      return;
    }

    const scheduleId = ensureString(outerKey);
    if (!scheduleId) {
      return;
    }
    Object.entries(outerValue).forEach(([glId, assignmentValue]) => {
      const normalized = normalizeAssignmentEntry(assignmentValue);
      if (!normalized) {
        return;
      }
      const entry = ensureEntry(glId);
      if (!entry) {
        return;
      }
      entry.schedules.set(scheduleId, normalized);
    });
  });
  return map;
}

function normalizeApplications(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }
  return Object.entries(snapshot)
    .map(([key, value]) => {
      if (!key || !value || typeof value !== "object") {
        return null;
      }
      const createdAt = Number(value.createdAt) || Number(value.updatedAt) || 0;
      const shifts = value.shifts && typeof value.shifts === "object" ? value.shifts : {};
      const sourceType = value.sourceType === "internal" ? "internal" : "external";
      const role = ensureString(value.role);
      return {
        id: key,
        name: ensureString(value.name),
        phonetic: ensureString(value.phonetic),
        email: ensureString(value.email),
        grade: ensureString(value.grade),
        faculty: ensureString(value.faculty),
        department: ensureString(value.department),
        academicPath: Array.isArray(value.academicPath) ? value.academicPath : [],
        club: ensureString(value.club),
        studentId: ensureString(value.studentId),
        note: ensureString(value.note),
        shifts,
        role,
        sourceType,
        createdAt,
        updatedAt: Number(value.updatedAt) || createdAt,
        raw: value
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name, "ja", { numeric: true }));
}

function buildAssignmentOptions(teams = []) {
  const normalizedTeams = Array.isArray(teams) ? teams.map((team) => ensureString(team)).filter(Boolean) : [];
  const options = [
    { value: "", label: "未割当" },
    ...normalizedTeams.map((team) => ({ value: team, label: `班: ${team}` })),
    { value: ASSIGNMENT_VALUE_UNAVAILABLE, label: "参加不可" },
    { value: ASSIGNMENT_VALUE_ABSENT, label: "欠席" },
    { value: ASSIGNMENT_VALUE_STAFF, label: "運営待機" }
  ];
  return options;
}

function buildInternalAssignmentOptions(teams = [], role = "") {
  const normalizedTeams = Array.isArray(teams) ? teams.map((team) => ensureString(team)).filter(Boolean) : [];
  const baseRoles = INTERNAL_ROLE_OPTIONS.map((entry) => ensureString(entry)).filter(Boolean);
  const normalizedRole = ensureString(role);
  if (normalizedRole && !baseRoles.includes(normalizedRole)) {
    baseRoles.push(normalizedRole);
  }
  const uniqueRoles = Array.from(new Set(baseRoles));
  const options = [
    { value: "", label: "未割当" },
    ...normalizedTeams.map((team) => ({ value: team, label: `班: ${team}` })),
    ...uniqueRoles.map((entry) => ({ value: entry, label: entry })),
    { value: ASSIGNMENT_VALUE_UNAVAILABLE, label: "参加不可" },
    { value: ASSIGNMENT_VALUE_ABSENT, label: "欠席" }
  ];
  return options;
}

function buildAssignmentOptionsForApplication(application, teams = []) {
  if (application?.sourceType === "internal") {
    return buildInternalAssignmentOptions(teams, application?.role);
  }
  return buildAssignmentOptions(teams);
}

function resolveAssignmentValue(assignment) {
  if (!assignment) {
    return "";
  }
  if (assignment.status === "absent") {
    return ASSIGNMENT_VALUE_ABSENT;
  }
  if (assignment.status === "staff") {
    return ASSIGNMENT_VALUE_STAFF;
  }
  if (assignment.status === "unavailable") {
    return ASSIGNMENT_VALUE_UNAVAILABLE;
  }
  if (assignment.status === "team" && assignment.teamId) {
    return assignment.teamId;
  }
  if (assignment.teamId) {
    return assignment.teamId;
  }
  return "";
}

function resolveEffectiveAssignmentValue(application, assignment) {
  const value = resolveAssignmentValue(assignment);
  if (application?.sourceType === "internal" && !value) {
    const role = ensureString(application.role);
    if (role && role !== "GL") {
      return role;
    }
  }
  return value;
}

function resolveAssignmentStatus(value) {
  if (value === ASSIGNMENT_VALUE_UNAVAILABLE) {
    return { status: "unavailable", teamId: "" };
  }
  if (value === ASSIGNMENT_VALUE_ABSENT) {
    return { status: "absent", teamId: "" };
  }
  if (value === ASSIGNMENT_VALUE_STAFF) {
    return { status: "staff", teamId: "" };
  }
  const teamId = ensureString(value);
  if (!teamId) {
    return { status: "", teamId: "" };
  }
  return { status: "team", teamId };
}

function formatAssignmentTimestamp(assignment) {
  if (!assignment || !assignment.updatedAt) {
    return "";
  }
  const date = new Date(Number(assignment.updatedAt));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ja-JP");
}

function formatAssignmentUpdatedLabel(assignment) {
  const updatedText = formatAssignmentTimestamp(assignment);
  if (!updatedText) {
    return "";
  }
  const updatedBy = ensureString(assignment?.updatedByName) || ensureString(assignment?.updatedByUid);
  return updatedBy ? `更新: ${updatedText} (${updatedBy})` : `更新: ${updatedText}`;
}

function buildAcademicPathText(application) {
  if (!application || typeof application !== "object") {
    return "";
  }
  const faculty = ensureString(application.faculty);
  const segments = Array.isArray(application.academicPath)
    ? application.academicPath
        .map((segment) => {
          if (!segment) {
            return "";
          }
          if (typeof segment === "object") {
            return ensureString(segment.display) || ensureString(segment.value);
          }
          return ensureString(segment);
        })
        .filter(Boolean)
    : [];
  const parts = [];
  if (faculty) {
    parts.push(faculty);
  }
  parts.push(...segments);
  return parts.join(" / ");
}

export class GlToolManager {
  constructor(app) {
    this.app = app;
    this.dom = app.dom;
    this.currentEventId = "";
    this.currentEventName = "";
    this.currentSchedules = [];
    this.config = null;
    this.applications = [];
    this.assignments = new Map();
    this.filter = "all";
    this.applicantSourceFilter = "all";
    this.applicantRoleFilter = "all";
    this.applicationView = "schedule";
    this.loading = false;
    this.scheduleSyncPending = false;
    this.configUnsubscribe = null;
    this.applicationsUnsubscribe = null;
    this.assignmentsUnsubscribe = null;
    this.sharedFaculties = [];
    this.sharedSignature = "";
    this.sharedMeta = { updatedAt: 0, updatedByUid: "", updatedByName: "" };
    this.internalEditingId = "";
    this.internalEditingShifts = {};
    this.internalAcademicState = { currentCustomLabel: "", unitSelections: [] };
    this.internalUnitLevelMap = new WeakMap();
    this.sharedCatalogUnsubscribe = onValue(glIntakeFacultyCatalogRef, (snapshot) => {
      this.applySharedCatalog(snapshot.val() || {});
    });
    this.activeTab = "config";
    this.selectionUnsubscribe = this.app.addSelectionListener((detail) => this.handleSelection(detail));
    this.eventsUnsubscribe = this.app.addEventListener((events) => this.handleEvents(events));
    this.bindDom();
    this.updateConfigVisibility();
    this.resetInternalForm();
  }

  getAvailableSchedules({ includeConfigFallback = false } = {}) {
    const eventId = ensureString(this.currentEventId);
    if (!eventId) {
      if (includeConfigFallback && Array.isArray(this.config?.schedules)) {
        return this.config.schedules.map((schedule) => ({ ...schedule }));
      }
      return [];
    }

    const scheduleSource = [];
    const selectedEventId = ensureString(this.app?.selectedEventId);
    if (Array.isArray(this.app?.schedules) && selectedEventId === eventId) {
      scheduleSource.push(...this.app.schedules);
    }

    if (!scheduleSource.length && Array.isArray(this.app?.events)) {
      const match = this.app.events.find((entry) => ensureString(entry.id) === eventId);
      if (match && Array.isArray(match.schedules)) {
        scheduleSource.push(...match.schedules);
      }
    }

    if (
      !scheduleSource.length &&
      typeof this.app?.getParticipantEventsSnapshot === "function"
    ) {
      const snapshot = this.app.getParticipantEventsSnapshot();
      const match = Array.isArray(snapshot)
        ? snapshot.find((entry) => ensureString(entry?.id) === eventId)
        : null;
      if (match && Array.isArray(match.schedules)) {
        scheduleSource.push(...match.schedules);
      }
    }

    if (!scheduleSource.length && includeConfigFallback && Array.isArray(this.config?.schedules)) {
      return this.config.schedules.map((schedule) => ({ ...schedule }));
    }

    return scheduleSource.map((schedule) => ({ ...schedule }));
  }

  refreshSchedules() {
    this.currentSchedules = this.getAvailableSchedules({ includeConfigFallback: true });
    this.syncScheduleSummaryCache();
    this.renderScheduleTeamControls();
    this.renderInternalShiftList();
  }

  renderInternalGradeOptions() {
    const select = this.dom.glInternalGradeInput;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const current = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "学年を選択してください";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.dataset.placeholder = "true";
    select.append(placeholder);
    INTERNAL_GRADE_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    if (INTERNAL_GRADE_OPTIONS.includes(current)) {
      select.value = current;
    }
  }

  getInternalFaculties() {
    const catalog = Array.isArray(this.sharedFaculties) ? this.sharedFaculties : [];
    const configFaculties = this.getConfigFaculties();
    return catalog.length ? catalog : configFaculties;
  }

  renderInternalFaculties() {
    const select = this.dom.glInternalFacultyInput;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const faculties = this.getInternalFaculties();
    const current = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "学部を選択してください";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.dataset.placeholder = "true";
    select.append(placeholder);
    faculties.forEach((entry) => {
      const faculty = ensureString(entry.faculty);
      if (!faculty) return;
      const option = document.createElement("option");
      option.value = faculty;
      option.textContent = faculty;
      select.append(option);
    });
    const customOption = document.createElement("option");
    customOption.value = INTERNAL_CUSTOM_OPTION_VALUE;
    customOption.textContent = "その他";
    select.append(customOption);
    if (faculties.some((entry) => ensureString(entry.faculty) === current)) {
      select.value = current;
    }
  }

  clearInternalAcademicFields() {
    this.internalAcademicState.unitSelections = [];
    const fields = this.dom.glInternalAcademicFields;
    if (fields) {
      fields.innerHTML = "";
    }
    this.updateInternalAcademicCustomField();
  }

  updateInternalAcademicCustomField(label) {
    const field = this.dom.glInternalAcademicCustomField;
    const labelEl = this.dom.glInternalAcademicCustomLabel;
    const input = this.dom.glInternalAcademicCustomInput;
    if (!field || !labelEl || !input) {
      return;
    }
    if (label) {
      this.internalAcademicState.currentCustomLabel = label;
      field.hidden = false;
      labelEl.textContent = `${label}（その他入力）`;
      input.placeholder = `${label}名を入力してください`;
      input.required = true;
    } else {
      this.internalAcademicState.currentCustomLabel = "";
      field.hidden = true;
      input.placeholder = "所属名を入力してください";
      input.required = false;
      input.value = "";
    }
  }

  removeInternalAcademicFieldsAfter(depth) {
    const fields = Array.from(this.dom.glInternalAcademicFields?.querySelectorAll(".gl-academic-field") ?? []);
    fields.forEach((field) => {
      const fieldDepth = Number(field.dataset.depth ?? "0");
      if (fieldDepth > depth) {
        field.remove();
      }
    });
    this.internalAcademicState.unitSelections = this.internalAcademicState.unitSelections.filter((_, index) => index <= depth);
  }

  renderInternalAcademicLevel(level, depth) {
    if (!this.dom.glInternalAcademicFields || !this.dom.glInternalAcademicSelectTemplate) return;
    const fragment = this.dom.glInternalAcademicSelectTemplate.content.cloneNode(true);
    const field = fragment.querySelector(".gl-academic-field");
    const labelEl = field?.querySelector(".gl-academic-label");
    const select = field?.querySelector(".gl-academic-select");
    if (!(field instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) return;
    field.dataset.depth = String(depth);
    const selectId = `gl-internal-academic-select-${depth}`;
    select.id = selectId;
    select.dataset.depth = String(depth);
    select.dataset.levelLabel = level.label;
    if (labelEl instanceof HTMLLabelElement) {
      labelEl.setAttribute("for", selectId);
      labelEl.textContent = level.label;
    }
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.dataset.placeholder = "true";
    placeholder.textContent = level.placeholder || `${level.label}を選択してください`;
    select.append(placeholder);
    level.options.forEach((option, index) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      opt.dataset.optionIndex = String(index);
      if (option.children) {
        opt.dataset.hasChildren = "true";
      }
      select.append(opt);
    });
    if (level.allowCustom !== false) {
      const customOption = document.createElement("option");
      customOption.value = INTERNAL_CUSTOM_OPTION_VALUE;
      customOption.textContent = "その他";
      customOption.dataset.isCustom = "true";
      select.append(customOption);
    }
    this.internalUnitLevelMap.set(select, level);
    select.addEventListener("change", (event) => {
      if (event.target instanceof HTMLSelectElement) {
        this.handleInternalAcademicLevelChange(event.target);
      }
    });
    this.dom.glInternalAcademicFields.append(field);
  }

  handleInternalAcademicLevelChange(select) {
    const depth = Number(select.dataset.depth ?? "0");
    this.removeInternalAcademicFieldsAfter(depth);
    const level = this.internalUnitLevelMap.get(select);
    const value = ensureString(select.value);
    if (!level || !value) {
      this.updateInternalAcademicCustomField();
      return;
    }
    if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
      this.internalAcademicState.unitSelections[depth] = { label: level.label, value: "", isCustom: true };
      this.updateInternalAcademicCustomField(level.label);
      return;
    }
    const selectedOption = select.selectedOptions[0];
    const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
    const option = optionIndex >= 0 ? level.options[optionIndex] : null;
    const displayLabel = ensureString(option?.label ?? selectedOption?.textContent ?? value);
    this.internalAcademicState.unitSelections[depth] = {
      label: level.label,
      value: option ? option.value : value,
      displayLabel,
      isCustom: false
    };
    this.updateInternalAcademicCustomField();
    if (option?.children) {
      this.renderInternalAcademicLevel(option.children, depth + 1);
    }
  }

  renderInternalAcademicTreeForFaculty(facultyName) {
    this.clearInternalAcademicFields();
    const name = ensureString(facultyName);
    if (!name || name === INTERNAL_CUSTOM_OPTION_VALUE) {
      return;
    }
    const entry = this.getInternalFaculties().find((item) => ensureString(item.faculty) === name);
    if (entry?.unitTree) {
      this.renderInternalAcademicLevel(entry.unitTree, 0);
    } else if (entry?.fallbackLabel) {
      this.updateInternalAcademicCustomField(entry.fallbackLabel);
    } else {
      this.updateInternalAcademicCustomField("所属");
    }
  }

  collectInternalAcademicState() {
    const selects = Array.from(this.dom.glInternalAcademicFields?.querySelectorAll(".gl-academic-select") ?? []);
    const path = [];
    let requiresCustom = false;
    let customLabel = "";
    let firstSelect = null;
    let pendingSelect = null;
    selects.forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) return;
      if (!firstSelect) {
        firstSelect = select;
      }
      const level = this.internalUnitLevelMap.get(select);
      const levelLabel = level?.label ?? "";
      const value = ensureString(select.value);
      if (!value && !pendingSelect) {
        pendingSelect = select;
      }
      if (!value) return;
      if (value === INTERNAL_CUSTOM_OPTION_VALUE) {
        requiresCustom = true;
        customLabel = levelLabel || customLabel;
        path.push({
          label: levelLabel,
          value: ensureString(this.dom.glInternalAcademicCustomInput?.value),
          isCustom: true,
          element: this.dom.glInternalAcademicCustomInput ?? null
        });
        return;
      }
      const selectedOption = select.selectedOptions[0];
      const optionIndex = selectedOption ? Number(selectedOption.dataset.optionIndex ?? "-1") : -1;
      const option = optionIndex >= 0 && level ? level.options[optionIndex] : null;
      const storedValue = option ? option.value : value;
      path.push({
        label: levelLabel,
        value: storedValue,
        displayLabel: option ? option.label : ensureString(selectedOption?.textContent ?? storedValue),
        isCustom: false,
        element: select
      });
    });
    if (!selects.length && this.internalAcademicState.currentCustomLabel) {
      requiresCustom = true;
      customLabel = this.internalAcademicState.currentCustomLabel;
      path.push({
        label: this.internalAcademicState.currentCustomLabel,
        value: ensureString(this.dom.glInternalAcademicCustomInput?.value),
        isCustom: true,
        element: this.dom.glInternalAcademicCustomInput ?? null
      });
    }
    const customValue = ensureString(this.dom.glInternalAcademicCustomInput?.value);
    return { path, requiresCustom, customLabel, customValue, firstSelect, pendingSelect };
  }

  syncInternalAcademicInputs() {
    this.renderInternalGradeOptions();
    this.renderInternalFaculties();
    this.renderInternalAcademicTreeForFaculty(this.dom.glInternalFacultyInput?.value || "");
  }

  bindDom() {
    if (this.dom.glConfigSaveButton) {
      this.dom.glConfigSaveButton.addEventListener("click", () => {
        this.saveConfig().catch((error) => {
          logError("Failed to save GL config", error);
          this.setStatus("募集設定の保存に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.addEventListener("click", () => {
        this.copyFormUrl().catch((error) => {
          logError("Failed to copy GL form URL", error);
          this.setStatus("応募URLのコピーに失敗しました。", "error");
        });
      });
    }
    if (this.dom.glTeamCountInput) {
      this.dom.glTeamCountInput.addEventListener("change", () => {
        this.handleDefaultTeamCountChange();
      });
    }
    if (this.dom.glScheduleTeamsList) {
      this.dom.glScheduleTeamsList.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.matches("[data-schedule-team-input]")) {
          return;
        }
        this.handleScheduleTeamInput(target);
      });
    }
    const tabOrder = ["config", "applications"];
    const getTabButton = (tab) =>
      tab === "applications" ? this.dom.glTabApplicationsButton : this.dom.glTabConfigButton;
    tabOrder.forEach((tab) => {
      const button = getTabButton(tab);
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.setActiveTab(tab);
        button.focus();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        let index = tabOrder.indexOf(tab);
        for (let step = 0; step < tabOrder.length; step += 1) {
          index = (index + direction + tabOrder.length) % tabOrder.length;
          const targetTab = tabOrder[index];
          const targetButton = getTabButton(targetTab);
          if (targetButton && !targetButton.disabled) {
            targetButton.focus();
            this.setActiveTab(targetTab);
            break;
          }
        }
      });
    });
    this.setActiveTab(this.activeTab);
    if (this.dom.glApplicantSourceFilter) {
      this.dom.glApplicantSourceFilter.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.applicantSourceFilter = value || "all";
        this.renderApplications();
      });
    }
    if (this.dom.glApplicantRoleFilter) {
      this.dom.glApplicantRoleFilter.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.applicantRoleFilter = value || "all";
        this.renderApplications();
      });
    }
    if (this.dom.glFilterSelect) {
      this.dom.glFilterSelect.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "all";
        this.filter = value || "all";
        this.renderApplications();
      });
    }
    const viewOrder = ["schedule", "applicant", "internal"];
    const getViewButton = (key) => {
      if (key === "applicant") return this.dom.glApplicationViewApplicantButton;
      if (key === "internal") return this.dom.glApplicationViewInternalButton;
      return this.dom.glApplicationViewScheduleButton;
    };
    viewOrder.forEach((key) => {
      const button = getViewButton(key);
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.setActiveApplicationView(key);
        button.focus();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        let index = viewOrder.indexOf(key);
        for (let step = 0; step < viewOrder.length; step += 1) {
          index = (index + direction + viewOrder.length) % viewOrder.length;
          const targetKey = viewOrder[index];
          const targetButton = getViewButton(targetKey);
          if (targetButton && !targetButton.disabled) {
            targetButton.focus();
            this.setActiveApplicationView(targetKey);
            break;
          }
        }
      });
    });
    this.setActiveApplicationView(this.applicationView);
    if (this.dom.glApplicationViews) {
      this.dom.glApplicationViews.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !target.matches("[data-gl-assignment]")) {
          return;
        }
        const item = target.closest("[data-gl-id][data-schedule-id]");
        const glId = ensureString(item?.dataset.glId);
        const scheduleId = ensureString(item?.dataset.scheduleId || target.dataset.scheduleId);
        if (!glId || !scheduleId) {
          return;
        }
        const value = target.value;
        this.applyAssignment(glId, scheduleId, value).catch((error) => {
          logError("Failed to update GL assignment", error);
          this.setStatus("班割当の更新に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalForm) {
      this.dom.glInternalForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleInternalSubmit().catch((error) => {
          logError("Failed to save internal staff", error);
          this.setInternalStatus("内部スタッフの保存に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalShiftList) {
      this.dom.glInternalShiftList.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.scheduleId) {
          return;
        }
        this.internalEditingShifts = this.collectInternalShifts();
      });
    }
    if (this.dom.glInternalResetButton) {
      this.dom.glInternalResetButton.addEventListener("click", () => {
        this.resetInternalForm();
      });
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.addEventListener("click", () => {
        this.handleInternalDelete().catch((error) => {
          logError("Failed to delete internal staff", error);
          this.setInternalStatus("内部スタッフの削除に失敗しました。", "error");
        });
      });
    }
    if (this.dom.glInternalList) {
      this.dom.glInternalList.addEventListener("click", (event) => {
        const button = event.target instanceof HTMLElement
          ? event.target.closest("[data-internal-id]")
          : null;
        if (!button) {
          return;
        }
        const id = ensureString(button.dataset.internalId);
        if (!id) {
          return;
        }
        const target = this.applications.find((entry) => ensureString(entry.id) === id);
        if (target) {
          this.populateInternalForm(target);
        }
      });
    }
    if (this.dom.glInternalFacultyInput) {
      this.dom.glInternalFacultyInput.addEventListener("change", (event) => {
        const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
        this.renderInternalAcademicTreeForFaculty(value);
      });
    }
  }

  setActiveTab(tab) {
    const normalized = tab === "applications" ? "applications" : "config";
    this.activeTab = normalized;
    const entries = [
      { tab: "config", button: this.dom.glTabConfigButton, panel: this.dom.glTabpanelConfig },
      { tab: "applications", button: this.dom.glTabApplicationsButton, panel: this.dom.glTabpanelApplications }
    ];
    entries.forEach(({ tab: key, button, panel }) => {
      const isActive = key === normalized;
      if (button) {
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
      }
      if (panel) {
        panel.hidden = !isActive;
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }
    });
  }

  setActiveApplicationView(view) {
    const normalized = view === "applicant" ? "applicant" : view === "internal" ? "internal" : "schedule";
    this.applicationView = normalized;
    const entries = [
      {
        key: "schedule",
        button: this.dom.glApplicationViewScheduleButton,
        panel: this.dom.glApplicationViewSchedulePanel
      },
      {
        key: "applicant",
        button: this.dom.glApplicationViewApplicantButton,
        panel: this.dom.glApplicationViewApplicantPanel
      },
      {
        key: "internal",
        button: this.dom.glApplicationViewInternalButton,
        panel: this.dom.glApplicationViewInternalPanel
      }
    ];
    entries.forEach(({ key, button, panel }) => {
      const isActive = key === normalized;
      if (button) {
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
      }
      if (panel) {
        panel.hidden = !isActive;
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }
    });
    this.renderApplications();
  }

  getDefaultTeamCountPreview() {
    const rawValue = ensureString(this.dom.glTeamCountInput?.value).trim();
    if (!rawValue) {
      return deriveTeamCountFromConfig(this.config?.defaultTeams || this.config?.teams || []);
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      return deriveTeamCountFromConfig(this.config?.defaultTeams || this.config?.teams || []);
    }
    return count;
  }

  handleDefaultTeamCountChange() {
    if (!this.dom.glTeamCountInput) {
      return;
    }
    const rawValue = ensureString(this.dom.glTeamCountInput.value).trim();
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    if (!rawValue) {
      this.config.defaultTeams = [];
      this.config.teams = [];
      this.renderScheduleTeamControls();
      this.renderApplications();
      return;
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      this.setStatus(error, "error");
      return;
    }
    const teams = buildSequentialTeams(count);
    this.config.defaultTeams = teams;
    this.config.teams = teams;
    this.renderScheduleTeamControls();
    this.renderApplications();
  }

  setScheduleTeamOverride(scheduleId, count) {
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    if (!this.config.scheduleTeams || typeof this.config.scheduleTeams !== "object") {
      this.config.scheduleTeams = {};
    }
    this.config.scheduleTeams[scheduleId] = {
      teams: buildSequentialTeams(count),
      teamCount: count
    };
  }

  handleScheduleTeamInput(input) {
    const wrapper = input.closest("[data-schedule-id]");
    const scheduleId = ensureString(wrapper?.dataset.scheduleId);
    if (!scheduleId) {
      return;
    }
    const rawValue = ensureString(input.value).trim();
    if (!rawValue) {
      if (this.config && this.config.scheduleTeams && typeof this.config.scheduleTeams === "object") {
        delete this.config.scheduleTeams[scheduleId];
      }
      input.value = "";
      input.dataset.previousValue = "";
      this.updateScheduleTeamNote(wrapper, scheduleId);
      this.renderApplications();
      return;
    }
    const { count, error } = parseTeamCount(rawValue);
    if (error) {
      input.setCustomValidity(error);
      input.reportValidity();
      this.setStatus(error, "error");
      const previous = ensureString(input.dataset.previousValue);
      if (previous) {
        input.value = previous;
      } else {
        input.value = "";
      }
      return;
    }
    input.setCustomValidity("");
    input.value = String(count);
    input.dataset.previousValue = String(count);
    this.setScheduleTeamOverride(scheduleId, count);
    this.updateScheduleTeamNote(wrapper, scheduleId);
    this.renderApplications();
  }

  updateScheduleTeamNote(element, scheduleId) {
    if (!element) {
      return;
    }
    const defaultCount = this.getDefaultTeamCountPreview();
    const note = element.querySelector('[data-role="schedule-note"]');
    const input = element.querySelector('[data-schedule-team-input]');
    if (input instanceof HTMLInputElement) {
      input.placeholder = defaultCount > 0 ? `${defaultCount}` : "";
    }
    const scheduleTeams = this.config?.scheduleTeams && typeof this.config.scheduleTeams === "object"
      ? this.config.scheduleTeams
      : {};
    const hasOverride = Object.prototype.hasOwnProperty.call(scheduleTeams, scheduleId);
    const entry = hasOverride ? scheduleTeams[scheduleId] : null;
    let overrideCount = null;
    if (entry) {
      if (Number.isFinite(entry?.teamCount)) {
        overrideCount = Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(Number(entry.teamCount))));
      } else if (Array.isArray(entry?.teams)) {
        overrideCount = deriveTeamCountFromConfig(entry.teams);
      }
    }
    let message = "";
    if (Number.isFinite(overrideCount)) {
      if (overrideCount > 0) {
        message = `${overrideCount}班を自動生成します。`;
      } else {
        message = "この日程では班を作成しません。";
      }
    } else if (defaultCount > 0) {
      message = `未入力の場合は${defaultCount}班で自動生成されます。`;
    } else {
      message = "未入力の場合は班を作成しません。";
    }
    if (note) {
      note.textContent = message;
    }
  }

  createScheduleTeamRowElement() {
    const template = this.dom.glScheduleTeamTemplate;
    if (template?.content?.firstElementChild) {
      return template.content.firstElementChild.cloneNode(true);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "gl-schedule-team";
    const header = document.createElement("div");
    header.className = "gl-schedule-team__header";
    const title = document.createElement("div");
    title.className = "gl-schedule-team__title";
    const label = document.createElement("span");
    label.className = "gl-schedule-team__label";
    label.dataset.role = "schedule-label";
    const date = document.createElement("span");
    date.className = "gl-schedule-team__date";
    date.dataset.role = "schedule-date";
    title.append(label, date);
    const field = document.createElement("label");
    field.className = "gl-schedule-team__field";
    const fieldLabel = document.createElement("span");
    fieldLabel.className = "gl-schedule-team__field-label";
    fieldLabel.textContent = "班の数";
    const input = document.createElement("input");
    input.className = "input input--dense gl-schedule-team__input";
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_TEAM_COUNT);
    input.step = "1";
    input.inputMode = "numeric";
    input.dataset.scheduleTeamInput = "true";
    field.append(fieldLabel, input);
    header.append(title, field);
    const note = document.createElement("p");
    note.className = "gl-schedule-team__note";
    note.dataset.role = "schedule-note";
    wrapper.append(header, note);
    return wrapper;
  }

  renderScheduleTeamControls() {
    const container = this.dom.glScheduleTeamsList;
    const empty = this.dom.glScheduleTeamsEmpty;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const schedules = buildRenderableSchedules(
      this.currentSchedules,
      this.config?.schedules || [],
      this.applications
    );
    if (!schedules.length) {
      container.hidden = true;
      if (empty) {
        empty.hidden = false;
      }
      return;
    }
    container.hidden = false;
    if (empty) {
      empty.hidden = true;
    }
    const fragment = document.createDocumentFragment();
    const scheduleTeams = this.config?.scheduleTeams && typeof this.config.scheduleTeams === "object"
      ? this.config.scheduleTeams
      : {};
    schedules.forEach((schedule) => {
      const element = this.createScheduleTeamRowElement();
      element.dataset.scheduleId = ensureString(schedule.id);
      const labelEl = element.querySelector('[data-role="schedule-label"]');
      if (labelEl) {
        labelEl.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
      }
      const dateEl = element.querySelector('[data-role="schedule-date"]');
      if (dateEl) {
        const dateText = ensureString(schedule.date);
        dateEl.textContent = dateText;
        dateEl.hidden = !dateText;
      }
      const input = element.querySelector('[data-schedule-team-input]');
      if (input instanceof HTMLInputElement) {
        input.value = "";
        input.dataset.previousValue = "";
        const hasOverride = Object.prototype.hasOwnProperty.call(scheduleTeams, schedule.id);
        const entry = hasOverride ? scheduleTeams[schedule.id] : null;
        let overrideCount = null;
        if (entry) {
          if (Number.isFinite(entry?.teamCount)) {
            overrideCount = Math.max(0, Math.min(MAX_TEAM_COUNT, Math.floor(Number(entry.teamCount))));
          } else if (Array.isArray(entry?.teams)) {
            overrideCount = deriveTeamCountFromConfig(entry.teams);
          }
        }
        if (Number.isFinite(overrideCount)) {
          input.value = String(overrideCount);
          input.dataset.previousValue = String(overrideCount);
        }
      }
      fragment.append(element);
      this.updateScheduleTeamNote(element, schedule.id);
    });
    container.append(fragment);
  }

  collectScheduleTeamSettings(defaultTeams = []) {
    const container = this.dom.glScheduleTeamsList;
    if (!container) {
      return {};
    }
    const inputs = Array.from(container.querySelectorAll("[data-schedule-team-input]"));
    const overrides = {};
    const seen = new Set();
    let firstInvalid = null;
    inputs.forEach((element) => {
      if (!(element instanceof HTMLInputElement)) {
        return;
      }
      const wrapper = element.closest("[data-schedule-id]");
      const scheduleId = ensureString(wrapper?.dataset.scheduleId);
      if (!scheduleId) {
        return;
      }
      seen.add(scheduleId);
      const rawValue = ensureString(element.value).trim();
      if (!rawValue) {
        element.setCustomValidity("");
        return;
      }
      const { count, error } = parseTeamCount(rawValue);
      if (error) {
        element.setCustomValidity(error);
        element.reportValidity();
        if (!firstInvalid) {
          firstInvalid = element;
        }
        return;
      }
      element.setCustomValidity("");
      overrides[scheduleId] = {
        teams: buildSequentialTeams(count),
        teamCount: count
      };
    });
    if (firstInvalid) {
      this.setStatus(firstInvalid.validationMessage || "班の数を確認してください。", "error");
      firstInvalid.focus();
      return null;
    }
    const existing = this.config?.scheduleTeams && typeof this.config.scheduleTeams === "object"
      ? this.config.scheduleTeams
      : {};
    Object.entries(existing).forEach(([scheduleId, value]) => {
      if (seen.has(scheduleId)) {
        return;
      }
      overrides[scheduleId] = value;
    });
    return normalizeScheduleTeamConfig(overrides, defaultTeams);
  }

  resetFlowState() {
    this.detachListeners();
    this.currentEventId = "";
    this.currentEventName = "";
    this.currentSchedules = [];
    this.config = null;
    this.applications = [];
    this.assignments = new Map();
    this.filter = "all";
    this.loading = false;
    this.updateConfigVisibility();
    this.setActiveTab("config");
    this.renderApplications();
    this.renderScheduleTeamControls();
    if (this.dom.glTeamCountInput) {
      this.dom.glTeamCountInput.value = "";
    }
  }

  resetContext(options = {}) {
    const reason = ensureString(options?.reason);
    const shouldPreserve = reason === "schedule-change" && !options?.clearDataset;
    if (shouldPreserve) {
      return;
    }
    this.applications = [];
    this.assignments = new Map();
    this.renderApplications();
    this.renderScheduleTeamControls();
  }

  handleEvents(events = []) {
    if (!Array.isArray(events)) {
      return;
    }
    const active = events.find((event) => ensureString(event.id) === this.currentEventId) || null;
    if (active) {
      this.currentEventName = ensureString(active.name) || this.currentEventId;
    }
    this.refreshSchedules();
    this.renderApplications();
    this.updateSlugPreview();
  }

  handleSelection(detail = {}) {
    const hasEventId = Object.prototype.hasOwnProperty.call(detail, "eventId");
    const eventId = hasEventId ? ensureString(detail.eventId) : this.currentEventId;
    const eventName = ensureString(detail.eventName);
    const changed = eventId !== this.currentEventId;
    this.currentEventId = eventId;
    this.currentEventName = eventName || this.currentEventName || eventId;
    this.refreshSchedules();
    this.updateConfigVisibility();
    this.updateSlugPreview();
    this.setStatus("", "info");
    if (changed) {
      this.filter = "all";
      if (this.dom.glFilterSelect) {
        this.dom.glFilterSelect.value = "all";
      }
      this.applicantSourceFilter = "all";
      this.applicantRoleFilter = "all";
      if (this.dom.glApplicantSourceFilter) {
        this.dom.glApplicantSourceFilter.value = "all";
      }
      if (this.dom.glApplicantRoleFilter) {
        this.dom.glApplicantRoleFilter.value = "all";
      }
      this.resetInternalForm();
      this.setActiveTab("config");
      this.attachListeners();
    }
  }

  detachListeners() {
    if (typeof this.configUnsubscribe === "function") {
      this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
    if (typeof this.applicationsUnsubscribe === "function") {
      this.applicationsUnsubscribe();
      this.applicationsUnsubscribe = null;
    }
    if (typeof this.assignmentsUnsubscribe === "function") {
      this.assignmentsUnsubscribe();
      this.assignmentsUnsubscribe = null;
    }
  }

  attachListeners() {
    this.detachListeners();
    if (!this.currentEventId) {
      this.config = null;
      this.applications = [];
      this.assignments = new Map();
      this.resetInternalForm();
      this.renderApplications();
      return;
    }
    this.loading = true;
    this.renderApplications();
    this.configUnsubscribe = onValue(getGlEventConfigRef(this.currentEventId), (snapshot) => {
      this.applyConfig(snapshot.val() || {});
    });
    this.applicationsUnsubscribe = onValue(getGlApplicationsRef(this.currentEventId), (snapshot) => {
      this.loading = false;
      this.applications = normalizeApplications(snapshot.val() || {});
      this.renderApplications();
    });
    this.assignmentsUnsubscribe = onValue(getGlAssignmentsRef(this.currentEventId), (snapshot) => {
      this.assignments = normalizeAssignmentSnapshot(snapshot.val() || {});
      this.renderApplications();
    });
  }

  applyConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const schedules = normalizeScheduleConfig(config.schedules);
    const defaultTeams = sanitizeTeamList(config.defaultTeams || config.teams || []);
    const scheduleTeams = normalizeScheduleTeamConfig(config.scheduleTeams || {}, defaultTeams);
    this.config = {
      slug: ensureString(config.slug),
      faculties: normalizeFacultyList(config.faculties || []),
      teams: defaultTeams,
      defaultTeams,
      scheduleTeams,
      schedules,
      startAt: config.startAt || "",
      endAt: config.endAt || "",
      guidance: ensureString(config.guidance),
      updatedAt: Number(config.updatedAt) || 0,
      createdAt: Number(config.createdAt) || 0
    };
    if (this.dom.glPeriodStartInput) {
      this.dom.glPeriodStartInput.value = toDateTimeLocalString(this.config.startAt);
    }
    if (this.dom.glPeriodEndInput) {
      this.dom.glPeriodEndInput.value = toDateTimeLocalString(this.config.endAt);
    }
    if (this.dom.glTeamCountInput) {
      const teamCount = deriveTeamCountFromConfig(this.config.defaultTeams);
      this.dom.glTeamCountInput.value = teamCount > 0 ? String(teamCount) : "";
    }
    this.updateSlugPreview();
    this.refreshSchedules();
    this.syncInternalAcademicInputs();
    this.renderApplications();
  }

  applySharedCatalog(raw) {
    const faculties = normalizeFacultyList(raw);
    const meta = raw && typeof raw === "object" ? raw : {};
    this.sharedFaculties = faculties;
    this.sharedSignature = createSignature(faculties);
    this.sharedMeta = {
      updatedAt: Number(meta.updatedAt) || 0,
      updatedByUid: ensureString(meta.updatedByUid),
      updatedByName: ensureString(meta.updatedByName)
    };
    this.syncInternalAcademicInputs();
    this.updateConfigVisibility();
  }

  getConfigFaculties() {
    return Array.isArray(this.config?.faculties) ? this.config.faculties : [];
  }

  useSharedFaculties() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    if (!this.sharedFaculties.length) {
      this.setStatus("共通設定が読み込まれていません。", "warning");
      return;
    }
    const faculties = normalizeFacultyList(this.sharedFaculties);
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    this.config.faculties = faculties;
    this.setStatus("共通設定を反映しました。必要に応じて保存してください。", "success");
  }

  async syncScheduleSummaryCache() {
    if (!this.currentEventId || !this.config || this.scheduleSyncPending) {
      return;
    }
    const primarySchedules = this.getAvailableSchedules({ includeConfigFallback: false });
    const summaryList = sanitizeScheduleEntries(primarySchedules);
    if (!summaryList.length) {
      return;
    }
    const nextMap = buildScheduleConfigMap(summaryList);
    const currentMap = buildScheduleConfigMap(this.config.schedules || []);
    if (scheduleSummaryMapsEqual(currentMap, nextMap)) {
      return;
    }
    this.scheduleSyncPending = true;
    try {
      await update(ref(database), {
        [`glIntake/events/${this.currentEventId}/schedules`]: nextMap
      });
    } catch (error) {
      logError("Failed to sync GL schedule summary", error);
    } finally {
      this.scheduleSyncPending = false;
    }
  }

  updateConfigVisibility() {
    if (!this.dom.glConfigEventNote || !this.dom.glConfigContent) {
      return;
    }
    const hasEvent = Boolean(this.currentEventId);
    this.dom.glConfigEventNote.hidden = hasEvent;
    this.dom.glConfigContent.hidden = !hasEvent;
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.disabled = !hasEvent;
    }
    if (this.dom.glConfigSaveButton) {
      this.dom.glConfigSaveButton.disabled = !hasEvent;
    }
    if (this.dom.glApplicantSourceFilter) {
      this.dom.glApplicantSourceFilter.disabled = !hasEvent;
    }
    if (this.dom.glApplicantRoleFilter) {
      this.dom.glApplicantRoleFilter.disabled = !hasEvent;
    }
    if (this.dom.glFilterSelect) {
      this.dom.glFilterSelect.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewScheduleButton) {
      this.dom.glApplicationViewScheduleButton.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewApplicantButton) {
      this.dom.glApplicationViewApplicantButton.disabled = !hasEvent;
    }
    if (this.dom.glApplicationViewInternalButton) {
      this.dom.glApplicationViewInternalButton.disabled = !hasEvent;
    }
    const internalControls = [
      this.dom.glInternalNameInput,
      this.dom.glInternalEmailInput,
      this.dom.glInternalPhoneticInput,
      this.dom.glInternalGradeInput,
      this.dom.glInternalFacultyInput,
      this.dom.glInternalAcademicCustomInput,
      this.dom.glInternalClubInput,
      this.dom.glInternalStudentIdInput,
      this.dom.glInternalNoteInput,
      this.dom.glInternalSubmitButton,
      this.dom.glInternalResetButton
    ];
    internalControls.forEach((element) => {
      if (!element) return;
      element.disabled = !hasEvent;
    });
    if (this.dom.glInternalAcademicFields) {
      this.dom.glInternalAcademicFields
        .querySelectorAll("select")
        .forEach((select) => {
          if (select instanceof HTMLSelectElement) {
            select.disabled = !hasEvent;
          }
        });
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = !hasEvent || !this.internalEditingId;
    }
  }

  getDefaultSlug() {
    return ensureString(this.currentEventId);
  }

  updateSlugPreview() {
    const slug = this.getDefaultSlug();
    if (this.dom.glConfigCopyButton) {
      this.dom.glConfigCopyButton.disabled = !slug || !this.currentEventId;
    }
  }

  async saveConfig() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = this.getDefaultSlug();
    const startAt = toTimestamp(this.dom.glPeriodStartInput?.value || "");
    const endAt = toTimestamp(this.dom.glPeriodEndInput?.value || "");
    const faculties = normalizeFacultyList(this.config?.faculties || []);
    const { count: teamCount, error: teamError } = parseTeamCount(this.dom.glTeamCountInput?.value);
    if (teamError) {
      this.setStatus(teamError, "error");
      if (this.dom.glTeamCountInput) {
        this.dom.glTeamCountInput.focus();
      }
      return;
    }
    const teams = buildSequentialTeams(teamCount);
    const previousSlug = ensureString(this.config?.slug);
    if (slug) {
      const slugSnapshot = await get(ref(database, `glIntake/slugIndex/${slug}`));
      const ownerEventId = ensureString(slugSnapshot.val());
      if (ownerEventId && ownerEventId !== this.currentEventId) {
        this.setStatus("同じイベントIDが別のGLフォームに割り当てられています。イベント設定を確認してください。", "error");
        return;
      }
    }
    const scheduleSummaryList = sanitizeScheduleEntries(
      this.getAvailableSchedules({ includeConfigFallback: true })
    );
    const scheduleSummary = buildScheduleConfigMap(scheduleSummaryList);
    if (!this.config || typeof this.config !== "object") {
      this.config = {};
    }
    this.config.faculties = faculties;
    this.config.defaultTeams = teams;
    this.config.teams = teams;
    const scheduleTeams = this.collectScheduleTeamSettings(teams);
    if (scheduleTeams === null) {
      return;
    }
    this.config.scheduleTeams = scheduleTeams;
    const configPayload = {
      slug,
      startAt,
      endAt,
      faculties,
      teams,
      defaultTeams: teams,
      scheduleTeams,
      schedules: scheduleSummary,
      guidance: ensureString(this.config?.guidance),
      updatedAt: serverTimestamp(),
      eventId: this.currentEventId,
      eventName: this.currentEventName
    };
    if (this.config?.createdAt) {
      configPayload.createdAt = this.config.createdAt;
    } else {
      configPayload.createdAt = serverTimestamp();
    }
    const updates = {};
    updates[`glIntake/events/${this.currentEventId}`] = configPayload;
    if (slug) {
      updates[`glIntake/slugIndex/${slug}`] = this.currentEventId;
    }
    if (previousSlug && previousSlug !== slug) {
      updates[`glIntake/slugIndex/${previousSlug}`] = null;
    }
    await update(ref(database), updates);
    this.setStatus("募集設定を保存しました。", "success");
  }

  async copyFormUrl() {
    if (!this.currentEventId) {
      this.setStatus("イベントを選択してください。", "warning");
      return;
    }
    const slug = this.getDefaultSlug();
    if (!slug) {
      this.setStatus("イベントIDを取得できませんでした。", "error");
      return;
    }
    let url = `${window.location.origin}${window.location.pathname}`;
    try {
      const currentUrl = new URL(window.location.href);
      const basePath = currentUrl.pathname.replace(/[^/]*$/, "");
      const formUrl = new URL("gl-form.html", `${currentUrl.origin}${basePath}`);
      formUrl.searchParams.set("evt", slug);
      url = formUrl.toString();
    } catch (error) {
      // fallback to relative path
      url = `gl-form.html?evt=${encodeURIComponent(slug)}`;
    }
    let success = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        success = true;
      } catch (error) {
        success = false;
      }
    }
    if (!success) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        success = document.execCommand("copy");
      } catch (error) {
        success = false;
      }
      document.body.removeChild(textarea);
    }
    this.setStatus(success ? "応募URLをコピーしました。" : "応募URLのコピーに失敗しました。", success ? "success" : "error");
    if (this.dom.glConfigCopyStatus) {
      this.dom.glConfigCopyStatus.textContent = success
        ? "GL応募フォームのURLをコピーしました。"
        : "GL応募フォームのURLをコピーできませんでした。";
    }
  }

  setStatus(message, variant = "info") {
    if (!this.dom.glConfigStatus) return;
    const text = ensureString(message);
    this.dom.glConfigStatus.textContent = text;
    this.dom.glConfigStatus.dataset.variant = variant;
    this.dom.glConfigStatus.hidden = !text;
  }

  setInternalStatus(message, variant = "info") {
    if (!this.dom.glInternalStatus) return;
    const text = ensureString(message);
    this.dom.glInternalStatus.textContent = text;
    this.dom.glInternalStatus.dataset.variant = variant;
    this.dom.glInternalStatus.hidden = !text;
  }

  buildInternalDefaultShifts() {
    const shifts = { __default__: true };
    this.currentSchedules.forEach((schedule) => {
      const id = ensureString(schedule?.id);
      if (id) {
        shifts[id] = true;
      }
    });
    return shifts;
  }

  renderInternalShiftList(shiftsOverride = null) {
    const container = this.dom.glInternalShiftList;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const schedules = Array.isArray(this.currentSchedules) ? this.currentSchedules : [];
    const shiftMap = shiftsOverride && typeof shiftsOverride === "object"
      ? { __default__: true, ...shiftsOverride }
      : this.internalEditingShifts && typeof this.internalEditingShifts === "object"
        ? { __default__: true, ...this.internalEditingShifts }
        : this.buildInternalDefaultShifts();
    if (!schedules.length) {
      const note = document.createElement("p");
      note.className = "gl-internal-shifts__empty";
      note.textContent = "日程がまだありません。募集設定から日程を追加してください。";
      container.append(note);
      return;
    }
    schedules.forEach((schedule) => {
      const wrapper = document.createElement("label");
      wrapper.className = "gl-internal-shifts__item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "gl-internal-shifts__checkbox";
      checkbox.dataset.scheduleId = ensureString(schedule.id);
      const key = ensureString(schedule.id);
      const fallback = Object.prototype.hasOwnProperty.call(shiftMap, "__default__")
        ? Boolean(shiftMap.__default__)
        : true;
      const value = Object.prototype.hasOwnProperty.call(shiftMap, key) ? Boolean(shiftMap[key]) : fallback;
      checkbox.checked = value;
      const label = document.createElement("span");
      label.className = "gl-internal-shifts__label";
      label.textContent = ensureString(schedule.label) || ensureString(schedule.date) || key || "日程";
      const date = ensureString(schedule.date);
      if (date) {
        const meta = document.createElement("span");
        meta.className = "gl-internal-shifts__meta";
        meta.textContent = date;
        label.append(document.createElement("br"), meta);
      }
      wrapper.append(checkbox, label);
      container.append(wrapper);
    });
  }

  collectInternalShifts() {
    const container = this.dom.glInternalShiftList;
    const shifts = { __default__: true };
    if (!container) {
      return this.buildInternalDefaultShifts();
    }
    const inputs = Array.from(container.querySelectorAll("input[type='checkbox'][data-schedule-id]"));
    if (!inputs.length) {
      return this.buildInternalDefaultShifts();
    }
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const id = ensureString(input.dataset.scheduleId);
      if (!id) {
        return;
      }
      shifts[id] = Boolean(input.checked);
    });
    return shifts;
  }

  collectInternalFormData() {
    const name = ensureString(this.dom.glInternalNameInput?.value);
    if (!name) {
      this.setInternalStatus("氏名を入力してください。", "error");
      this.dom.glInternalNameInput?.focus();
      return null;
    }
    const email = ensureString(this.dom.glInternalEmailInput?.value);
    if (!email) {
      this.setInternalStatus("メールアドレスを入力してください。", "error");
      this.dom.glInternalEmailInput?.focus();
      return null;
    }
    const faculty = ensureString(this.dom.glInternalFacultyInput?.value);
    if (!faculty || faculty === INTERNAL_CUSTOM_OPTION_VALUE) {
      this.setInternalStatus("学部を選択してください。", "error");
      this.dom.glInternalFacultyInput?.focus();
      return null;
    }
    const academic = this.collectInternalAcademicState();
    if (academic.pendingSelect instanceof HTMLSelectElement) {
      const label = ensureString(academic.pendingSelect.dataset.levelLabel) || "所属";
      this.setInternalStatus(`${label}を選択してください。`, "error");
      academic.pendingSelect.focus();
      return null;
    }
    if (!academic.path.length) {
      const label = this.internalAcademicState.currentCustomLabel || "所属情報";
      this.setInternalStatus(`${label}を選択してください。`, "error");
      if (academic.firstSelect instanceof HTMLSelectElement) {
        academic.firstSelect.focus();
      }
      return null;
    }
    if (academic.requiresCustom && !academic.customValue) {
      const label = academic.customLabel || this.internalAcademicState.currentCustomLabel || "所属";
      this.setInternalStatus(`${label}を入力してください。`, "error");
      this.dom.glInternalAcademicCustomInput?.focus();
      return null;
    }
    const departmentSegment = academic.path[academic.path.length - 1];
    const department = ensureString(departmentSegment?.value);
    if (!department) {
      const label = ensureString(departmentSegment?.label) || "所属";
      this.setInternalStatus(`${label}を入力してください。`, "error");
      if (departmentSegment?.element instanceof HTMLElement) {
        departmentSegment.element.focus();
      }
      return null;
    }
    const academicPath = academic.path
      .map((segment) => ({
        label: ensureString(segment.label),
        value: ensureString(segment.value),
        display: ensureString(segment.displayLabel ?? segment.value),
        isCustom: Boolean(segment.isCustom)
      }))
      .filter((segment) => segment.value);
    const shifts = this.collectInternalShifts();
    return {
      name,
      phonetic: ensureString(this.dom.glInternalPhoneticInput?.value),
      email,
      grade: ensureString(this.dom.glInternalGradeInput?.value),
      faculty,
      department,
      academicPath,
      club: ensureString(this.dom.glInternalClubInput?.value),
      studentId: ensureString(this.dom.glInternalStudentIdInput?.value),
      note: ensureString(this.dom.glInternalNoteInput?.value),
      shifts
    };
  }

  populateInternalForm(application) {
    if (!application) {
      return;
    }
    this.internalEditingId = ensureString(application.id);
    if (this.dom.glInternalIdInput) {
      this.dom.glInternalIdInput.value = this.internalEditingId;
    }
    if (this.dom.glInternalNameInput) {
      this.dom.glInternalNameInput.value = ensureString(application.name);
    }
    if (this.dom.glInternalPhoneticInput) {
      this.dom.glInternalPhoneticInput.value = ensureString(application.phonetic);
    }
    if (this.dom.glInternalEmailInput) {
      this.dom.glInternalEmailInput.value = ensureString(application.email);
    }
    if (this.dom.glInternalGradeInput) {
      this.dom.glInternalGradeInput.value = ensureString(application.grade);
    }
    const facultyValue = ensureString(application.faculty);
    if (this.dom.glInternalFacultyInput) {
      this.dom.glInternalFacultyInput.value = facultyValue;
    }
    this.renderInternalAcademicTreeForFaculty(facultyValue);
    this.applyInternalAcademicPath(application);
    if (this.dom.glInternalClubInput) {
      this.dom.glInternalClubInput.value = ensureString(application.club);
    }
    if (this.dom.glInternalStudentIdInput) {
      this.dom.glInternalStudentIdInput.value = ensureString(application.studentId);
    }
    if (this.dom.glInternalNoteInput) {
      this.dom.glInternalNoteInput.value = ensureString(application.note);
    }
    this.internalEditingShifts = application.shifts && typeof application.shifts === "object"
      ? { __default__: true, ...application.shifts }
      : this.buildInternalDefaultShifts();
    this.renderInternalShiftList(this.internalEditingShifts);
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = !this.currentEventId;
    }
    if (this.dom.glInternalSubmitButton) {
      this.dom.glInternalSubmitButton.textContent = "内部スタッフを更新";
    }
    this.setInternalStatus("編集モードです。変更後に保存してください。", "info");
  }

  applyInternalAcademicPath(application) {
    const path = Array.isArray(application?.academicPath) ? application.academicPath : [];
    const department = ensureString(application?.department);
    let depth = 0;
    path.forEach((segment) => {
      const value = ensureString(segment?.value ?? segment);
      const select = this.dom.glInternalAcademicFields?.querySelector(
        `.gl-academic-select[data-depth="${depth}"]`
      );
      if (!(select instanceof HTMLSelectElement)) {
        return;
      }
      if (segment?.isCustom) {
        select.value = INTERNAL_CUSTOM_OPTION_VALUE;
        if (this.dom.glInternalAcademicCustomInput) {
          this.dom.glInternalAcademicCustomInput.value = value;
        }
      } else {
        select.value = value;
      }
      this.handleInternalAcademicLevelChange(select);
      depth += 1;
    });
    if (!path.length && department) {
      const firstSelect = this.dom.glInternalAcademicFields?.querySelector(
        ".gl-academic-select[data-depth=\"0\"]"
      );
      if (firstSelect instanceof HTMLSelectElement && this.internalUnitLevelMap.has(firstSelect)) {
        firstSelect.value = INTERNAL_CUSTOM_OPTION_VALUE;
        this.handleInternalAcademicLevelChange(firstSelect);
      }
      if (this.dom.glInternalAcademicCustomInput) {
        this.dom.glInternalAcademicCustomInput.value = department;
      }
    }
  }

  resetInternalForm() {
    this.internalEditingId = "";
    this.internalEditingShifts = this.buildInternalDefaultShifts();
    if (this.dom.glInternalForm) {
      this.dom.glInternalForm.reset();
    }
    if (this.dom.glInternalIdInput) {
      this.dom.glInternalIdInput.value = "";
    }
    this.syncInternalAcademicInputs();
    if (this.dom.glInternalSubmitButton) {
      this.dom.glInternalSubmitButton.textContent = "内部スタッフを追加";
    }
    if (this.dom.glInternalDeleteButton) {
      this.dom.glInternalDeleteButton.disabled = true;
    }
    this.renderInternalShiftList(this.internalEditingShifts);
    this.setInternalStatus("", "info");
    this.updateConfigVisibility();
  }

  async handleInternalSubmit() {
    if (!this.currentEventId) {
      this.setInternalStatus("イベントを選択してください。", "warning");
      return;
    }
    const data = this.collectInternalFormData();
    if (!data) {
      return;
    }
    const existing = this.applications.find((entry) => ensureString(entry.id) === ensureString(this.internalEditingId));
    const slug = ensureString(this.config?.slug) || this.getDefaultSlug();
    const basePath = `glIntake/applications/${this.currentEventId}`;
    const targetRef = existing
      ? ref(database, `${basePath}/${existing.id}`)
      : push(ref(database, basePath));
    const payload = {
      name: data.name,
      phonetic: data.phonetic,
      email: data.email,
      grade: data.grade,
      faculty: data.faculty,
      department: data.department,
      academicPath: Array.isArray(data.academicPath) ? data.academicPath : [],
      club: data.club,
      studentId: data.studentId,
      note: data.note,
      shifts: data.shifts,
      sourceType: "internal",
      eventId: this.currentEventId,
      eventName: this.currentEventName,
      slug,
      createdAt: existing?.raw?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (!payload.note) {
      delete payload.note;
    }
    if (!payload.club) {
      delete payload.club;
    }
    if (!payload.studentId) {
      delete payload.studentId;
    }
    if (!payload.phonetic) {
      delete payload.phonetic;
    }
    if (!payload.grade) {
      delete payload.grade;
    }
    if (!payload.department) {
      delete payload.department;
    }
    if (!Array.isArray(payload.academicPath) || !payload.academicPath.length) {
      delete payload.academicPath;
    }
    await set(targetRef, payload);
    this.resetInternalForm();
    this.setInternalStatus(existing ? "内部スタッフを更新しました。" : "内部スタッフを追加しました。", "success");
    this.renderApplications();
  }

  async handleInternalDelete() {
    if (!this.currentEventId || !this.internalEditingId) {
      return;
    }
    const updates = {};
    updates[`glIntake/applications/${this.currentEventId}/${this.internalEditingId}`] = null;
    const assignmentEntry = this.assignments.get(this.internalEditingId);
    if (assignmentEntry) {
      if (assignmentEntry.schedules instanceof Map) {
        assignmentEntry.schedules.forEach((_, scheduleId) => {
          updates[`glAssignments/${this.currentEventId}/${scheduleId}/${this.internalEditingId}`] = null;
        });
      }
      if (assignmentEntry.fallback) {
        updates[`glAssignments/${this.currentEventId}/${this.internalEditingId}`] = null;
      }
    }
    await update(ref(database), updates);
    this.resetInternalForm();
    this.setInternalStatus("内部スタッフを削除しました。", "success");
    this.renderApplications();
  }

  renderInternalList() {
    const list = this.dom.glInternalList;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    if (!this.currentEventId) {
      const note = document.createElement("li");
      note.className = "gl-internal-list__empty";
      note.textContent = "イベントを選択してください。";
      list.append(note);
      return;
    }
    const entries = this.applications
      .filter((application) => application && application.sourceType === "internal")
      .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name, "ja", { numeric: true }));
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "gl-internal-list__empty";
      empty.textContent = "内部スタッフはまだ登録されていません。";
      list.append(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "gl-internal-list__item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gl-internal-list__button";
      button.dataset.internalId = ensureString(entry.id);
      const name = document.createElement("span");
      name.className = "gl-internal-list__name";
      name.textContent = ensureString(entry.name) || "名前未設定";
      button.append(name);
      item.append(button);
      list.append(item);
    });
  }

  renderApplications() {
    const board = this.dom.glApplicationBoard;
    const list = this.dom.glApplicationList;
    const viewsContainer = this.dom.glApplicationViews;
    if (board) {
      board.innerHTML = "";
    }
    if (list) {
      list.innerHTML = "";
    }
    this.renderInternalList();
    const hasEvent = Boolean(this.currentEventId);
    if (this.dom.glApplicationEventNote) {
      this.dom.glApplicationEventNote.hidden = hasEvent;
    }
    if (!hasEvent) {
      if (this.dom.glApplicationEmpty) {
        this.dom.glApplicationEmpty.hidden = true;
      }
      if (this.dom.glApplicationLoading) {
        this.dom.glApplicationLoading.hidden = true;
      }
      if (viewsContainer) {
        viewsContainer.hidden = true;
      }
      return;
    }
    if (this.dom.glApplicationLoading) {
      this.dom.glApplicationLoading.hidden = !this.loading;
    }
    if (viewsContainer) {
      viewsContainer.hidden = this.loading;
    }
    if (this.loading) {
      if (this.dom.glApplicationEmpty) {
        this.dom.glApplicationEmpty.hidden = true;
      }
      return;
    }
    const schedules = buildRenderableSchedules(
      this.currentSchedules,
      this.config?.schedules || [],
      this.applications
    );
    const matchesFilter = this.createBucketMatcher();
    const sourceFilter = ensureString(this.applicantSourceFilter) || "all";
    const roleFilter = ensureString(this.applicantRoleFilter) || "all";
    const filteredApplications = this.applications.filter((application) => {
      if (!application) {
        return false;
      }
      const sourceType = application.sourceType === "internal" ? "internal" : "external";
      if (sourceFilter === "internal" && sourceType !== "internal") {
        return false;
      }
      if (sourceFilter === "external" && sourceType !== "external") {
        return false;
      }
      const role = ensureString(application.role);
      if (roleFilter !== "all" && role !== roleFilter) {
        return false;
      }
      return schedules.some((schedule) => {
        const available = isApplicantAvailableForSchedule(application, schedule.id);
        const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
        const value = resolveEffectiveAssignmentValue(application, assignment);
        const bucketKey = this.resolveAssignmentBucket(value, available);
        return matchesFilter(bucketKey);
      });
    });
    const scheduleResult = this.renderScheduleBoard(schedules, filteredApplications, matchesFilter);
    const applicantResult = this.renderApplicantList(schedules, filteredApplications, matchesFilter);
    if (viewsContainer) {
      viewsContainer.hidden = false;
    }
    if (this.dom.glApplicationEmpty) {
      const activeView = this.applicationView;
      const shouldShowEmpty = activeView === "applicant"
        ? applicantResult.visibleCount === 0
        : activeView === "internal"
          ? false
          : scheduleResult.visibleCount === 0;
      this.dom.glApplicationEmpty.hidden = !shouldShowEmpty;
    }
  }

  renderScheduleBoard(schedules, applications, matchesFilter) {
    const board = this.dom.glApplicationBoard;
    if (!board) {
      return { visibleCount: 0 };
    }
    board.innerHTML = "";
    const fragment = document.createDocumentFragment();
    let totalVisibleEntries = 0;
    schedules.forEach((schedule) => {
      const section = this.buildScheduleSection(schedule, applications, matchesFilter);
      if (!section) {
        return;
      }
      fragment.append(section.element);
      totalVisibleEntries += section.visibleCount;
    });
    board.append(fragment);
    return { visibleCount: totalVisibleEntries };
  }

  renderApplicantList(schedules, applications, matchesFilter) {
    const list = this.dom.glApplicationList;
    if (!list) {
      return { visibleCount: 0 };
    }
    list.innerHTML = "";
    const scheduleEntries = Array.isArray(schedules) ? schedules : [];
    if (!scheduleEntries.length) {
      const empty = document.createElement("p");
      empty.className = "gl-applicant-matrix__empty";
      empty.textContent = "日程がまだ設定されていません。";
      list.append(empty);
      return { visibleCount: 0 };
    }

    const wrapper = document.createElement("div");
    wrapper.className = "gl-applicant-matrix-wrapper";
    const scroll = document.createElement("div");
    scroll.className = "gl-applicant-matrix-scroll";
    const table = document.createElement("table");
    table.className = "gl-applicant-matrix";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const applicantHeader = document.createElement("th");
    applicantHeader.className = "gl-applicant-matrix__header gl-applicant-matrix__header--applicant";
    applicantHeader.scope = "col";
    applicantHeader.textContent = "応募者";
    headerRow.append(applicantHeader);

    scheduleEntries.forEach((schedule) => {
      const th = document.createElement("th");
      th.className = "gl-applicant-matrix__header gl-applicant-matrix__header--schedule";
      th.scope = "col";
      th.dataset.scheduleId = ensureString(schedule.id);
      const title = document.createElement("div");
      title.className = "gl-applicant-matrix__schedule";
      const label = document.createElement("span");
      label.className = "gl-applicant-matrix__schedule-label";
      label.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
      title.append(label);
      if (schedule.date) {
        const date = document.createElement("span");
        date.className = "gl-applicant-matrix__schedule-date";
        date.textContent = schedule.date;
        title.append(date);
      }
      th.append(title);
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    let visibleRows = 0;
    applications.forEach((application) => {
      const row = this.createApplicantMatrixRow({ application, schedules: scheduleEntries, matchesFilter });
      if (!row) {
        return;
      }
      tbody.append(row);
      visibleRows += 1;
    });
    table.append(tbody);

    scroll.append(table);
    wrapper.append(scroll);
    list.append(wrapper);
    return { visibleCount: visibleRows };
  }

  createApplicantMatrixRow({ application, schedules, matchesFilter }) {
    if (!application) {
      return null;
    }
    const row = document.createElement("tr");
    row.className = "gl-applicant-matrix__row";
    row.dataset.glId = ensureString(application.id);

    const applicantCell = document.createElement("th");
    applicantCell.scope = "row";
    applicantCell.className = "gl-applicant-matrix__applicant";
    applicantCell.dataset.glId = ensureString(application.id);

    const badgeRow = document.createElement("div");
    badgeRow.className = "gl-applicant-matrix__badges";
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "gl-badge gl-badge--source";
    const sourceType = application.sourceType === "internal" ? "internal" : "external";
    sourceBadge.dataset.sourceType = sourceType;
    sourceBadge.textContent = sourceType === "internal" ? "内部" : "外部";
    badgeRow.append(sourceBadge);
    if (application.role) {
      const roleBadge = document.createElement("span");
      roleBadge.className = "gl-badge gl-badge--role";
      roleBadge.textContent = application.role;
      badgeRow.append(roleBadge);
    }

    const identity = document.createElement("div");
    identity.className = "gl-applicant-matrix__identity";
    const nameEl = document.createElement("span");
    nameEl.className = "gl-applicant-matrix__name";
    nameEl.textContent = ensureString(application.name) || "(無記入)";
    identity.append(nameEl);
    if (application.phonetic) {
      const phoneticEl = document.createElement("span");
      phoneticEl.className = "gl-applicant-matrix__phonetic";
      phoneticEl.textContent = application.phonetic;
      identity.append(phoneticEl);
    }
    const identityHeader = document.createElement("div");
    identityHeader.className = "gl-applicant-matrix__identity-header";
    identityHeader.append(identity);

    if (application.grade) {
      const gradeEl = document.createElement("span");
      gradeEl.className = "gl-applicant-matrix__grade";
      applyGradeBadge(gradeEl, application.grade);
      identityHeader.append(gradeEl);
    }

    applicantCell.append(badgeRow);
    applicantCell.append(identityHeader);

    const metaList = document.createElement("dl");
    metaList.className = "gl-applicant-matrix__meta";
    const addMeta = (label, value) => {
      if (!value) {
        return;
      }
      const dt = document.createElement("dt");
      dt.className = "gl-applicant-matrix__meta-label";
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.className = "gl-applicant-matrix__meta-value";
      dd.textContent = value;
      metaList.append(dt, dd);
    };

    const academicPathText = buildAcademicPathText(application);
    addMeta("所属", academicPathText);
    addMeta("役割", ensureString(application.role));
    addMeta("メール", ensureString(application.email));
    addMeta("サークル", ensureString(application.club));
    addMeta("学籍番号", ensureString(application.studentId));

    if (metaList.children.length) {
      applicantCell.append(metaList);
    }

    if (application.note) {
      const note = document.createElement("p");
      note.className = "gl-applicant-matrix__note";
      note.textContent = application.note;
      applicantCell.append(note);
    }

    row.append(applicantCell);

    schedules.forEach((schedule) => {
      const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
      const assignmentValue = resolveEffectiveAssignmentValue(application, assignment);
      const available = isApplicantAvailableForSchedule(application, schedule.id);
      const teams = getScheduleTeams(this.config, schedule.id);
      const cell = this.createApplicantMatrixCell({
        application,
        schedule,
        assignment,
        assignmentValue,
        available,
        teams,
        matchesFilter
      });
      row.append(cell);
    });

    return row;
  }

  createApplicantMatrixCell({
    application,
    schedule,
    assignment,
    assignmentValue,
    available,
    teams,
    matchesFilter
  }) {
    const cell = document.createElement("td");
    cell.className = "gl-applicant-matrix__cell";
    cell.dataset.glId = ensureString(application.id);
    cell.dataset.scheduleId = ensureString(schedule.id);
    cell.dataset.sourceType = application.sourceType === "internal" ? "internal" : "external";
    const bucketKey = this.resolveAssignmentBucket(assignmentValue, available);
    const matches = matchesFilter(bucketKey);
    cell.dataset.bucket = bucketKey;
    cell.dataset.matchesFilter = matches ? "true" : "false";
    if (assignmentValue === ASSIGNMENT_VALUE_ABSENT) {
      cell.dataset.assignmentStatus = "absent";
    } else if (assignmentValue === ASSIGNMENT_VALUE_STAFF) {
      cell.dataset.assignmentStatus = "staff";
    } else if (assignmentValue === ASSIGNMENT_VALUE_UNAVAILABLE) {
      cell.dataset.assignmentStatus = "unavailable";
    } else if (assignmentValue) {
      cell.dataset.assignmentStatus = "team";
      cell.dataset.teamId = assignmentValue;
    } else if (!available) {
      cell.dataset.assignmentStatus = "unavailable";
    } else {
      cell.dataset.assignmentStatus = "pending";
    }

    const content = document.createElement("div");
    content.className = "gl-applicant-matrix__cell-content";

    const statusRow = document.createElement("div");
    statusRow.className = "gl-applicant-matrix__cell-header";
    const responseDescriptor = resolveScheduleResponseValue(application, schedule.id);
    const responseBadge = document.createElement("span");
    responseBadge.className = "gl-applicant-matrix__response-badge";
    const responseVariant = determineScheduleResponseVariant(responseDescriptor.raw, responseDescriptor.text);
    if (responseVariant) {
      responseBadge.classList.add(`gl-applicant-matrix__response-badge--${responseVariant}`);
    }
    responseBadge.textContent = responseDescriptor.text || "未回答";
    statusRow.append(responseBadge);
    content.append(statusRow);

    const control = document.createElement("div");
    control.className = "gl-applicant-matrix__assignment";
    const select = document.createElement("select");
    select.className = "input input--dense gl-applicant-matrix__select";
    select.dataset.glAssignment = "true";
    select.dataset.scheduleId = ensureString(schedule.id);
    select.setAttribute(
      "aria-label",
      `${ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程"}の班割当`
    );
    const options = buildAssignmentOptionsForApplication(application, teams);
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === assignmentValue) {
        opt.selected = true;
      }
      select.append(opt);
    });
    control.append(select);

    const updatedLabel = formatAssignmentUpdatedLabel(assignment);
    if (updatedLabel) {
      const updated = document.createElement("span");
      updated.className = "gl-applicant-matrix__updated";
      updated.textContent = updatedLabel;
      control.append(updated);
    }

    content.append(control);
    cell.append(content);
    return cell;
  }

  createBucketMatcher() {
    const filter = this.filter || "all";
    if (filter === "unassigned") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_UNASSIGNED;
    }
    if (filter === "assigned") {
      return (bucket) => bucket.startsWith("team:");
    }
    if (filter === "absent") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_ABSENT;
    }
    if (filter === "staff") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_STAFF;
    }
    return () => true;
  }

  getAssignmentForSchedule(glId, scheduleId) {
    if (!glId) {
      return null;
    }
    const entry = this.assignments.get(glId) || null;
    if (!entry) {
      return null;
    }
    const scheduleKey = ensureString(scheduleId);
    if (scheduleKey && entry.schedules instanceof Map && entry.schedules.has(scheduleKey)) {
      return entry.schedules.get(scheduleKey) || null;
    }
    return entry.fallback || null;
  }

  resolveAssignmentBucket(value, available) {
    if (value === ASSIGNMENT_VALUE_ABSENT) {
      return ASSIGNMENT_BUCKET_ABSENT;
    }
    if (value === ASSIGNMENT_VALUE_STAFF) {
      return ASSIGNMENT_BUCKET_STAFF;
    }
    if (value === ASSIGNMENT_VALUE_UNAVAILABLE) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    if (value) {
      return `team:${value}`;
    }
    if (!available) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    return ASSIGNMENT_BUCKET_UNASSIGNED;
  }

  buildScheduleSection(schedule, applications, matchesFilter) {
    if (!schedule) {
      return null;
    }
    const section = document.createElement("section");
    section.className = "gl-shift-section";
    section.dataset.scheduleId = ensureString(schedule.id);

    const header = document.createElement("header");
    header.className = "gl-shift-section__header";
    const title = document.createElement("h4");
    title.className = "gl-shift-section__title";
    title.textContent = ensureString(schedule.label) || ensureString(schedule.date) || schedule.id || "日程";
    header.append(title);
    if (schedule.date) {
      const meta = document.createElement("p");
      meta.className = "gl-shift-section__meta";
      meta.textContent = schedule.date;
      header.append(meta);
    }
    const countEl = document.createElement("span");
    countEl.className = "gl-shift-section__count";
    countEl.textContent = "0名";
    header.append(countEl);
    section.append(header);

    const teams = getScheduleTeams(this.config, schedule.id);
    const columns = buildScheduleBuckets(teams);
    const columnOrder = [];
    const columnMap = new Map();
    columns.forEach((column) => {
      columnOrder.push(column.key);
      columnMap.set(column.key, { column, entries: [] });
    });
    const ensureTeamColumn = (key) => {
      if (!key.startsWith("team:")) {
        return null;
      }
      const teamId = key.replace(/^team:/, "");
      const column = { key, label: teamId || "班", type: "team", teamId };
      columnOrder.push(key);
      const data = { column, entries: [] };
      columnMap.set(key, data);
      return data;
    };

    let visibleCount = 0;
    applications.forEach((application) => {
      const assignment = this.getAssignmentForSchedule(application.id, schedule.id);
      const value = resolveEffectiveAssignmentValue(application, assignment);
      const available = isApplicantAvailableForSchedule(application, schedule.id);
      const bucketKey = this.resolveAssignmentBucket(value, available);
      if (!matchesFilter(bucketKey)) {
        return;
      }
      const columnData = columnMap.get(bucketKey) || ensureTeamColumn(bucketKey);
      if (!columnData) {
        return;
      }
      const entryEl = this.createShiftEntry({
        application,
        schedule,
        assignment,
        assignmentValue: value,
        available,
        teams,
        bucketKey
      });
      columnData.entries.push(entryEl);
      visibleCount += 1;
    });

    const orderedKeys = [
      ...columnOrder,
      ...Array.from(columnMap.keys()).filter((key) => !columnOrder.includes(key))
    ];
    const columnsContainer = document.createElement("div");
    columnsContainer.className = "gl-shift-columns";
    orderedKeys.forEach((key) => {
      const data = columnMap.get(key);
      if (!data) {
        return;
      }
      const columnEl = this.createShiftColumn(data.column, data.entries);
      columnsContainer.append(columnEl);
    });

    const table = document.createElement("div");
    table.className = "gl-shift-table";
    table.append(columnsContainer);
    section.append(table);

    countEl.textContent = `${visibleCount}名`;
    section.dataset.totalEntries = String(visibleCount);
    return { element: section, visibleCount };
  }

  createShiftColumn(column, entries) {
    const columnEl = document.createElement("section");
    columnEl.className = "gl-shift-column";
    columnEl.dataset.variant = column.type;
    if (column.type === "team" && column.teamId) {
      columnEl.dataset.teamId = column.teamId;
    }
    const header = document.createElement("header");
    header.className = "gl-shift-column__header";
    const title = document.createElement("h5");
    title.className = "gl-shift-column__title";
    title.textContent = column.type === "team" ? column.label : column.label;
    header.append(title);
    const count = document.createElement("span");
    count.className = "gl-shift-column__count";
    count.textContent = `${entries.length}名`;
    header.append(count);
    columnEl.append(header);

    const body = document.createElement("div");
    body.className = "gl-shift-column__body";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "gl-shift-column__empty";
      empty.textContent = "該当なし";
      body.append(empty);
    } else {
      entries.forEach((entry) => body.append(entry));
    }
    columnEl.append(body);
    return columnEl;
  }

  createShiftEntry({ application, schedule, assignment, assignmentValue, available, teams, bucketKey }) {
    const item = document.createElement("article");
    item.className = "gl-shift-entry";
    item.dataset.glId = ensureString(application.id);
    item.dataset.scheduleId = ensureString(schedule.id);
    item.dataset.bucket = bucketKey;
    item.dataset.sourceType = application.sourceType === "internal" ? "internal" : "external";
    if (assignmentValue === ASSIGNMENT_VALUE_ABSENT) {
      item.dataset.assignmentStatus = "absent";
    } else if (assignmentValue === ASSIGNMENT_VALUE_STAFF) {
      item.dataset.assignmentStatus = "staff";
    } else if (assignmentValue === ASSIGNMENT_VALUE_UNAVAILABLE) {
      item.dataset.assignmentStatus = "unavailable";
    } else if (assignmentValue) {
      item.dataset.assignmentStatus = "team";
      item.dataset.teamId = assignmentValue;
    } else if (!available) {
      item.dataset.assignmentStatus = "unavailable";
    } else {
      item.dataset.assignmentStatus = "pending";
    }

    const header = document.createElement("header");
    header.className = "gl-shift-entry__header";
    const identity = document.createElement("div");
    identity.className = "gl-shift-entry__identity";
    const nameEl = document.createElement("span");
    nameEl.className = "gl-shift-entry__name";
    nameEl.textContent = ensureString(application.name) || "(無記入)";
    identity.append(nameEl);
    if (application.phonetic) {
      const phoneticEl = document.createElement("span");
      phoneticEl.className = "gl-shift-entry__phonetic";
      phoneticEl.textContent = application.phonetic;
      identity.append(phoneticEl);
    }
    header.append(identity);
    if (application.grade) {
      const gradeEl = document.createElement("span");
      gradeEl.className = "gl-shift-entry__grade";
      applyGradeBadge(gradeEl, application.grade);
      header.append(gradeEl);
    }
    item.append(header);

    const infoList = document.createElement("ul");
    infoList.className = "gl-shift-entry__info";
    const addInfo = (label, value) => {
      if (!value) {
        return;
      }
      const li = document.createElement("li");
      li.className = "gl-shift-entry__info-item";
      const labelEl = document.createElement("span");
      labelEl.className = "gl-shift-entry__info-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "gl-shift-entry__info-value";
      valueEl.textContent = value;
      li.append(labelEl, valueEl);
      infoList.append(li);
    };
    const academicPathText = buildAcademicPathText(application);
    if (academicPathText) {
      addInfo("所属", academicPathText);
    }
    addInfo("役割", ensureString(application.role));
    addInfo("サークル", ensureString(application.club));
    if (infoList.children.length) {
      item.append(infoList);
    }

    if (application.note) {
      const note = document.createElement("p");
      note.className = "gl-shift-entry__note";
      note.textContent = application.note;
      item.append(note);
    }

    const controls = document.createElement("div");
    controls.className = "gl-shift-entry__controls";
    const assignmentLabel = document.createElement("label");
    assignmentLabel.className = "gl-shift-entry__assignment";
    const assignmentText = document.createElement("span");
    assignmentText.className = "gl-shift-entry__assignment-text";
    assignmentText.textContent = "班割当";
    const select = document.createElement("select");
    select.className = "input input--dense";
    select.dataset.glAssignment = "true";
    select.dataset.scheduleId = ensureString(schedule.id);
    const options = buildAssignmentOptionsForApplication(application, teams);
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === assignmentValue) {
        opt.selected = true;
      }
      select.append(opt);
    });
    assignmentLabel.append(assignmentText, select);
    controls.append(assignmentLabel);

    const updatedLabel = formatAssignmentUpdatedLabel(assignment);
    if (updatedLabel) {
      const updated = document.createElement("span");
      updated.className = "gl-shift-entry__updated";
      updated.textContent = updatedLabel;
      controls.append(updated);
    }
    item.append(controls);
    return item;
  }

  async applyAssignment(glId, scheduleId, value) {
    if (!this.currentEventId || !glId || !scheduleId) {
      return;
    }
    const { status, teamId } = resolveAssignmentStatus(value);
    const basePath = `glAssignments/${this.currentEventId}/${scheduleId}/${glId}`;
    if (!status && !teamId) {
      await update(ref(database), {
        [basePath]: null
      });
      return;
    }
    const user = this.app?.currentUser || null;
    const payload = {
      status,
      teamId,
      updatedAt: serverTimestamp(),
      updatedByUid: ensureString(user?.uid),
      updatedByName: ensureString(user?.displayName) || ensureString(user?.email)
    };
    await update(ref(database), {
      [basePath]: payload
    });
  }
}
