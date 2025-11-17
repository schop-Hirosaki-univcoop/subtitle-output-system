// groups.js: 質問管理画面で利用する参加者グループ・GL割り当て関連の共通処理をまとめます。
import { state } from "./state.js";
import { normalizeKey } from "./utils.js";
import { normalizeGroupNumberValue } from "./participants.js";
import {
  CANCEL_LABEL,
  GL_STAFF_GROUP_KEY,
  GL_STAFF_LABEL,
  NO_TEAM_GROUP_KEY,
  RELOCATE_LABEL
} from "./constants.js";

function getEventGlRoster(eventId) {
  if (!(state.glRoster instanceof Map)) {
    state.glRoster = new Map();
  }
  const roster = state.glRoster.get(eventId);
  return roster instanceof Map ? roster : null;
}

function getEventGlAssignmentsMap(eventId) {
  if (!(state.glAssignments instanceof Map)) {
    state.glAssignments = new Map();
  }
  const assignments = state.glAssignments.get(eventId);
  return assignments instanceof Map ? assignments : null;
}

function normalizeGlRoster(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") {
    return map;
  }
  Object.entries(raw).forEach(([glId, value]) => {
    if (!glId || !value || typeof value !== "object") return;
    map.set(String(glId), {
      id: String(glId),
      name: normalizeKey(value.name || value.fullName || ""),
      phonetic: normalizeKey(value.phonetic || value.furigana || ""),
      grade: normalizeKey(value.grade || ""),
      faculty: normalizeKey(value.faculty || ""),
      department: normalizeKey(value.department || ""),
      email: normalizeKey(value.email || ""),
      club: normalizeKey(value.club || "")
    });
  });
  return map;
}

function normalizeGlAssignmentEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const statusRaw = String(raw.status || "").trim().toLowerCase();
  let status = "";
  if (statusRaw === "absent" || statusRaw === "欠席") {
    status = "absent";
  } else if (statusRaw === "staff" || statusRaw === "運営" || statusRaw === "運営待機") {
    status = "staff";
  } else if (statusRaw === "team") {
    status = "team";
  }
  const teamId = normalizeKey(raw.teamId || "");
  if (!status && teamId) {
    status = "team";
  }
  if (!status && !teamId) {
    return null;
  }
  return {
    status,
    teamId,
    updatedAt: Number(raw.updatedAt || 0) || 0,
    updatedByName: normalizeKey(raw.updatedByName || ""),
    updatedByUid: normalizeKey(raw.updatedByUid || "")
  };
}

function normalizeGlAssignments(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") {
    return map;
  }

  const ensureEntry = (glId) => {
    const id = String(glId || "").trim();
    if (!id) {
      return null;
    }
    if (!map.has(id)) {
      map.set(id, { fallback: null, schedules: new Map() });
    }
    return map.get(id) || null;
  };

  Object.entries(raw).forEach(([outerKey, outerValue]) => {
    if (!outerValue || typeof outerValue !== "object") {
      return;
    }

    const legacyAssignment = normalizeGlAssignmentEntry(outerValue);
    if (legacyAssignment) {
      const entry = ensureEntry(outerKey);
      if (!entry) {
        return;
      }
      entry.fallback = legacyAssignment;
      const excludedKeys = new Set(["status", "teamId", "updatedAt", "updatedByUid", "updatedByName", "schedules"]);
      Object.entries(outerValue).forEach(([scheduleId, scheduleValue]) => {
        if (excludedKeys.has(scheduleId)) {
          return;
        }
        const normalized = normalizeGlAssignmentEntry(scheduleValue);
        if (!normalized) {
          return;
        }
        const key = String(scheduleId || "").trim();
        if (!key) {
          return;
        }
        entry.schedules.set(key, normalized);
      });
      return;
    }

    const scheduleId = String(outerKey || "").trim();
    if (!scheduleId) {
      return;
    }
    Object.entries(outerValue).forEach(([glId, value]) => {
      const normalized = normalizeGlAssignmentEntry(value);
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

function resolveScheduleAssignment(entry, scheduleId) {
  if (!entry) {
    return null;
  }
  const key = String(scheduleId || "").trim();
  if (key && entry.schedules instanceof Map && entry.schedules.has(key)) {
    return entry.schedules.get(key) || null;
  }
  return entry.fallback || null;
}

function collectGroupGlLeaders(groupKey, { eventId, rosterMap, assignmentsMap, scheduleId }) {
  const assignments = assignmentsMap instanceof Map ? assignmentsMap : getEventGlAssignmentsMap(eventId);
  const roster = rosterMap instanceof Map ? rosterMap : getEventGlRoster(eventId);
  if (!(assignments instanceof Map) || !(roster instanceof Map)) {
    return [];
  }

  const rawGroupKey = String(groupKey || "").trim();
  const normalizedGroupKey = normalizeKey(rawGroupKey);
  const normalizedCancelLabel = normalizeKey(CANCEL_LABEL);
  const normalizedStaffLabel = normalizeKey(GL_STAFF_LABEL);
  const isCancelGroup = normalizedGroupKey === normalizedCancelLabel;
  const isStaffGroup = rawGroupKey === GL_STAFF_GROUP_KEY || normalizedGroupKey === normalizedStaffLabel;

  const leaders = [];
  assignments.forEach((entry, glId) => {
    const assignment = resolveScheduleAssignment(entry, scheduleId);
    if (!assignment) return;
    const status = assignment.status || "";
    const teamId = normalizeKey(assignment.teamId || "");
    if (status === "team") {
      if (!teamId || isCancelGroup || isStaffGroup || teamId !== normalizedGroupKey) {
        return;
      }
    } else if (status === "absent") {
      if (!isCancelGroup) return;
    } else if (status === "staff") {
      if (!isStaffGroup) return;
    } else {
      return;
    }

    const profile = roster.get(String(glId)) || {};
    const name = profile.name || String(glId);
    const metaParts = [];
    if (status === "absent") {
      metaParts.push("欠席");
    } else if (status === "staff") {
      metaParts.push(GL_STAFF_LABEL);
    }
    if (profile.faculty) {
      metaParts.push(profile.faculty);
    }
    if (profile.department && profile.department !== profile.faculty) {
      metaParts.push(profile.department);
    }
    leaders.push({
      name,
      meta: metaParts.join(" / ")
    });
  });

  leaders.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  return leaders;
}

function getParticipantGroupKey(entry) {
  const raw = entry && (entry.teamNumber ?? entry.groupNumber);
  const value = raw != null ? String(raw).trim() : "";
  if (!value) {
    return NO_TEAM_GROUP_KEY;
  }
  if (value === CANCEL_LABEL || value === RELOCATE_LABEL || value === GL_STAFF_GROUP_KEY) {
    return value;
  }
  const normalized = normalizeGroupNumberValue(value);
  return normalized || NO_TEAM_GROUP_KEY;
}

function describeParticipantGroup(groupKey) {
  const raw = String(groupKey || "").trim();
  if (!raw || raw === NO_TEAM_GROUP_KEY) {
    return { label: "班番号", value: "未設定" };
  }
  if (raw === CANCEL_LABEL) {
    return { label: "ステータス", value: CANCEL_LABEL };
  }
  if (raw === RELOCATE_LABEL) {
    return { label: "ステータス", value: RELOCATE_LABEL };
  }
  if (raw === GL_STAFF_GROUP_KEY) {
    return { label: "ステータス", value: GL_STAFF_LABEL };
  }
  const normalized = normalizeGroupNumberValue(raw) || raw;
  return { label: "班番号", value: normalized };
}

export {
  collectGroupGlLeaders,
  describeParticipantGroup,
  getEventGlAssignmentsMap,
  getEventGlRoster,
  getParticipantGroupKey,
  normalizeGlAssignments,
  normalizeGlRoster,
  resolveScheduleAssignment
};
