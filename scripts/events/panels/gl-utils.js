// gl-utils.js: GLツール用のユーティリティ関数
// gl-panel.js から分離（フェーズ2 段階1）

import { ensureString, formatDateTimeLocal } from "../helpers.js";

// 定数
export const ASSIGNMENT_VALUE_ABSENT = "__absent";
export const ASSIGNMENT_VALUE_STAFF = "__staff";
export const ASSIGNMENT_VALUE_UNAVAILABLE = "__unavailable";
export const MAX_TEAM_COUNT = 50;
export const ASSIGNMENT_BUCKET_UNASSIGNED = "__unassigned";
export const ASSIGNMENT_BUCKET_ABSENT = "__bucket_absent";
export const ASSIGNMENT_BUCKET_STAFF = "__bucket_staff";
export const ASSIGNMENT_BUCKET_UNAVAILABLE = "__bucket_unavailable";
export const SCHEDULE_RESPONSE_POSITIVE_KEYWORDS = ["yes", "true", "1", "available", "参加", "参加可", "ok", "可能", "出席", "参加する"];
export const SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS = ["no", "false", "0", "unavailable", "不可", "欠席", "参加不可", "不参加", "参加できない"];
export const SCHEDULE_RESPONSE_STAFF_KEYWORDS = ["staff", "運営", "待機", "サポート"];
export const INTERNAL_ROLE_OPTIONS = ["司会", "受付", "ラジオ", "機材", "GL", "撮影", "その他"];
export const INTERNAL_GRADE_OPTIONS = [
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
export const INTERNAL_CUSTOM_OPTION_VALUE = "__custom";

// 日時変換関数
export function toDateTimeLocalString(value) {
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

export function toTimestamp(value) {
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

// 班関連の関数
export function parseTeamCount(value) {
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

export function buildSequentialTeams(count = 0) {
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

export function deriveTeamCountFromConfig(teams = []) {
  if (!Array.isArray(teams)) {
    return 0;
  }
  return teams.map((team) => ensureString(team)).filter(Boolean).length;
}

export function sanitizeTeamList(source) {
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

export function normalizeScheduleTeamConfig(raw, fallback = []) {
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

export function getScheduleTeams(config, scheduleId) {
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

export function buildScheduleBuckets(teams = []) {
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

// 学年関連の関数
export function determineGradeBadgeVariant(grade) {
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

export function applyGradeBadge(element, grade) {
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

export function getGradeSortWeight(grade) {
  const variant = determineGradeBadgeVariant(grade);
  const order = {
    year1: 1,
    year2: 2,
    year3: 3,
    year4: 4,
    year5: 5,
    year6: 6,
    other: 9
  };
  if (!variant) {
    return 99;
  }
  return order[variant] ?? 98;
}

// 割り当て関連の関数
export function formatAssignmentLabelForPrint(value) {
  if (value === ASSIGNMENT_VALUE_ABSENT) {
    return "欠席";
  }
  if (value === ASSIGNMENT_VALUE_STAFF) {
    return "運営待機";
  }
  if (value === ASSIGNMENT_VALUE_UNAVAILABLE) {
    return "参加不可";
  }
  const normalized = ensureString(value).trim();
  if (!normalized) {
    return normalized;
  }
  const withSuffix = normalized.match(/^([0-9０-９]+)班$/);
  if (withSuffix) {
    return withSuffix[1];
  }
  const withPrefix = normalized.match(/^班[:：]?\s*([0-9０-９]+)$/);
  if (withPrefix) {
    return withPrefix[1];
  }
  return normalized;
}

export function resolveScheduleResponseValue(application, scheduleId) {
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

export function formatScheduleResponseText(value) {
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

export function determineScheduleResponseVariant(raw, text) {
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

// スケジュール関連の関数
export function buildRenderableSchedules(primary = [], fallbackSchedules = [], applications = []) {
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

export function isApplicantAvailableForSchedule(application, scheduleId) {
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

export function normalizeScheduleConfig(raw) {
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

export function sanitizeScheduleEntries(schedules = []) {
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

export function buildScheduleConfigMap(schedules = []) {
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

export function scheduleSummaryMapsEqual(first = {}, second = {}) {
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

export function createSignature(list) {
  try {
    return JSON.stringify(list);
  } catch (error) {
    return "";
  }
}

// 割り当て正規化関数
export function normalizeAssignmentEntry(raw) {
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

export function normalizeAssignmentSnapshot(snapshot = {}) {
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

// 応募正規化関数
export function normalizeApplications(snapshot = {}) {
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
        gender: ensureString(value.gender),
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

// 割り当てオプション関連の関数
export function formatTeamOptionLabel(team) {
  const text = ensureString(team).trim();
  if (!text) {
    return text;
  }
  const prefixed = text.match(/^班[:：]?\s*([0-9０-９]+)$/);
  if (prefixed) {
    return prefixed[1];
  }
  const withSuffix = text.match(/^([0-9０-９]+)班$/);
  if (withSuffix) {
    return withSuffix[1];
  }
  const numericOnly = text.match(/^[0-9０-９]+$/);
  if (numericOnly) {
    return text;
  }
  return `班: ${text}`;
}

export function buildAssignmentOptions(teams = []) {
  const normalizedTeams = Array.isArray(teams) ? teams.map((team) => ensureString(team)).filter(Boolean) : [];
  const options = [
    { value: "", label: "未割当" },
    ...normalizedTeams.map((team) => ({ value: team, label: formatTeamOptionLabel(team) })),
    { value: ASSIGNMENT_VALUE_UNAVAILABLE, label: "参加不可" },
    { value: ASSIGNMENT_VALUE_ABSENT, label: "欠席" },
    { value: ASSIGNMENT_VALUE_STAFF, label: "運営待機" }
  ];
  return options;
}

export function buildInternalAssignmentOptions(teams = [], role = "") {
  const normalizedTeams = Array.isArray(teams) ? teams.map((team) => ensureString(team)).filter(Boolean) : [];
  const baseRoles = INTERNAL_ROLE_OPTIONS.map((entry) => ensureString(entry)).filter(Boolean);
  const normalizedRole = ensureString(role);
  if (normalizedRole && !baseRoles.includes(normalizedRole)) {
    baseRoles.push(normalizedRole);
  }
  const uniqueRoles = Array.from(new Set(baseRoles));
  const options = [
    { value: "", label: "未割当" },
    ...normalizedTeams.map((team) => ({ value: team, label: formatTeamOptionLabel(team) })),
    ...uniqueRoles.map((entry) => ({ value: entry, label: entry })),
    { value: ASSIGNMENT_VALUE_UNAVAILABLE, label: "参加不可" },
    { value: ASSIGNMENT_VALUE_ABSENT, label: "欠席" }
  ];
  return options;
}

export function buildAssignmentOptionsForApplication(application, teams = []) {
  if (application?.sourceType === "internal") {
    return buildInternalAssignmentOptions(teams, application?.role);
  }
  return buildAssignmentOptions(teams);
}

export function resolveAssignmentValue(assignment) {
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

export function resolveEffectiveAssignmentValue(application, assignment) {
  const value = resolveAssignmentValue(assignment);
  if (application?.sourceType === "internal" && !value) {
    const role = ensureString(application.role);
    if (role && role !== "GL") {
      return role;
    }
  }
  return value;
}

export function resolveAssignmentStatus(value) {
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

export function formatAssignmentTimestamp(assignment) {
  if (!assignment || !assignment.updatedAt) {
    return "";
  }
  const date = new Date(Number(assignment.updatedAt));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ja-JP");
}

export function formatAssignmentUpdatedLabel(assignment) {
  const updatedText = formatAssignmentTimestamp(assignment);
  if (!updatedText) {
    return "";
  }
  const updatedBy = ensureString(assignment?.updatedByName) || ensureString(assignment?.updatedByUid);
  return updatedBy ? `更新: ${updatedText} (${updatedBy})` : `更新: ${updatedText}`;
}

export function buildAcademicPathText(application) {
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

