import { state } from "./state.js";
import { normalizeKey } from "./utils.js";

function sanitizePrefixComponent(value) {
  return normalizeKey(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function createParticipantIdPrefix(eventId, scheduleId) {
  const eventPart = sanitizePrefixComponent(eventId);
  const schedulePart = sanitizePrefixComponent(scheduleId);
  const prefix = [eventPart, schedulePart].filter(Boolean).join("-");
  return prefix || "participant";
}

function participantIdentityKey(entry) {
  if (!entry) return "";
  const phonetic = entry.phonetic ?? entry.furigana ?? "";
  const department = entry.department ?? entry.groupNumber ?? "";
  return [
    normalizeKey(entry.name),
    normalizeKey(phonetic),
    normalizeKey(department)
  ].join("::");
}

function normalizeDuplicateField(value) {
  return normalizeKey(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function duplicateKeyFromValues(name, department) {
  const nameKey = normalizeDuplicateField(name);
  const deptKey = normalizeDuplicateField(department);
  if (!nameKey || !deptKey) return "";
  return `${nameKey}::${deptKey}`;
}

function duplicateKeyFor(entry) {
  if (!entry) return "";
  const department = entry.department ?? entry.groupNumber ?? "";
  return duplicateKeyFromValues(entry.name, department);
}

function getScheduleLabel(eventId, scheduleId) {
  if (!eventId || !scheduleId) return "";
  const event = state.events.find(evt => evt.id === eventId);
  if (!event) return "";
  const schedule = event.schedules?.find(s => s.id === scheduleId);
  if (!schedule) return "";
  return schedule.label || schedule.date || schedule.id || "";
}

function normalizeEventParticipantCache(eventBranch) {
  const cache = {};
  if (!eventBranch || typeof eventBranch !== "object") {
    return cache;
  }
  Object.entries(eventBranch).forEach(([scheduleId, scheduleBranch]) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") {
      cache[String(scheduleId)] = [];
      return;
    }
    const normalized = Object.values(scheduleBranch).map(entry => ({
      key: String(entry?.participantId || entry?.id || ""),
      participantId: String(entry?.participantId || entry?.id || ""),
      name: String(entry?.name || ""),
      department: String(entry?.department || entry?.groupNumber || ""),
      groupNumber: String(entry?.groupNumber || entry?.teamNumber || ""),
      teamNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
      scheduleId: String(scheduleId)
    }));
    cache[String(scheduleId)] = normalized;
  });
  return cache;
}

function describeDuplicateMatch(match, eventId, currentScheduleId) {
  if (!match) return "";
  const name = String(match.name || "").trim();
  const idLabel = match.participantId ? `ID:${match.participantId}` : "ID未登録";
  const scheduleId = String(match.scheduleId || "").trim();
  if (scheduleId === String(currentScheduleId || "")) {
    const label = name || "同日程";
    return `${label}（同日程・${idLabel}）`;
  }
  const scheduleLabel = getScheduleLabel(eventId, scheduleId) || (scheduleId ? `日程ID:${scheduleId}` : "");
  if (name && scheduleLabel) {
    return `${name}（${scheduleLabel}・${idLabel}）`;
  }
  if (scheduleLabel) {
    return `${scheduleLabel}（${idLabel}）`;
  }
  if (name) {
    return `${name}（${idLabel}）`;
  }
  return idLabel;
}

function updateDuplicateMatches() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    return;
  }

  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }

  const eventCache = state.eventParticipantCache.get(eventId);
  const scheduleCache = eventCache && typeof eventCache === "object" ? eventCache : {};
  const keyMap = new Map();
  const addRecord = (key, record) => {
    if (!key) return;
    if (!keyMap.has(key)) {
      keyMap.set(key, []);
    }
    keyMap.get(key).push(record);
  };

  Object.entries(scheduleCache).forEach(([cacheScheduleId, entries]) => {
    const list = Array.isArray(entries) ? entries : [];
    list.forEach(entry => {
      const record = {
        key: String(entry?.key || entry?.participantId || ""),
        participantId: String(entry?.participantId || ""),
        name: String(entry?.name || ""),
        department: String(entry?.department || ""),
        scheduleId: String(entry?.scheduleId || cacheScheduleId),
        isCurrent: Boolean(entry?.isCurrent)
      };
      const isCurrentSchedule = record.scheduleId === String(scheduleId);
      if (isCurrentSchedule && record.isCurrent) {
        return;
      }
      const key = duplicateKeyFromValues(record.name, record.department);
      addRecord(key, record);
    });
  });

  state.participants.forEach((entry, index) => {
    const record = {
      key: String(entry?.participantId || `__row${index}`),
      participantId: String(entry?.participantId || ""),
      name: String(entry?.name || ""),
      department: String(entry?.department || entry?.groupNumber || ""),
      scheduleId: String(scheduleId),
      isCurrent: true
    };
    const key = duplicateKeyFromValues(record.name, record.department);
    addRecord(key, record);
  });

  const duplicates = new Map();
  const groups = new Map();
  keyMap.forEach((records, groupKey) => {
    const current = records.filter(record => record.isCurrent);
    if (!current.length) return;
    if (records.length <= 1) return;
    const normalizedRecords = records.map(record => ({ ...record }));
    groups.set(groupKey, {
      key: groupKey,
      totalCount: records.length,
      records: normalizedRecords
    });
    current.forEach(record => {
      const others = records.filter(candidate => {
        if (!candidate) return false;
        if (candidate.isCurrent && candidate.key && record.key && candidate.key === record.key) {
          return false;
        }
        return candidate !== record;
      });
      if (!others.length) return;
      duplicates.set(record.key, {
        groupKey,
        totalCount: records.length,
        others: others.map(candidate => ({
          participantId: candidate.participantId,
          name: candidate.name,
          department: candidate.department,
          scheduleId: candidate.scheduleId,
          isCurrent: candidate.isCurrent
        }))
      });
    });
  });

  state.duplicateMatches = duplicates;
  state.duplicateGroups = groups;
}

function syncCurrentScheduleCache() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) return;
  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }
  const cache = state.eventParticipantCache.get(eventId) || {};
  cache[scheduleId] = state.participants.map(entry => ({
    key: String(entry?.participantId || ""),
    participantId: String(entry?.participantId || ""),
    name: String(entry?.name || ""),
    department: String(entry?.department || entry?.groupNumber || ""),
    groupNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    teamNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    scheduleId: String(scheduleId),
    isCurrent: true
  }));
  state.eventParticipantCache.set(eventId, cache);
}

function parseParticipantRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => normalizeKey(cell).toLowerCase());
  const hasHeader =
    headerCandidate.some(cell => /id|参加|member/.test(cell)) &&
    headerCandidate.some(cell => /name|氏名|名前|ラジオ|radio/.test(cell));

  if (!hasHeader) {
    throw new Error("ヘッダー行が見つかりません。テンプレートを利用してヘッダーを追加してください。");
  }

  const findIndex = (keywords, fallback = -1) => {
    for (const keyword of keywords) {
      const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
      if (idx !== -1) return idx;
    }
    return fallback;
  };

  const indexMap = {
    id: findIndex(["id", "参加", "member"], -1),
    name: findIndex(["name", "氏名", "名前", "ラジオ", "radio"], 1),
    phonetic: findIndex(["フリ", "ふり", "furigana", "yomi", "reading"], 2),
    gender: findIndex(["性別", "gender"], 3),
    department: findIndex(["学部", "department", "学科", "faculty"], 4),
    phone: findIndex(["電話", "tel", "phone"], 5),
    email: findIndex(["mail", "メール", "email"], 6),
    team: findIndex(["班", "group", "team"], -1)
  };

  const dataRows = rows.slice(1);

  const normalizeColumn = (cols, index) => {
    if (index == null || index < 0 || index >= cols.length) return "";
    return normalizeKey(cols[index]);
  };

  const entries = [];
  const seenIds = new Set();
  const seenKeys = new Set();

  dataRows.forEach(cols => {
    const participantId = normalizeColumn(cols, indexMap.id);
    const name = normalizeColumn(cols, indexMap.name);
    const phonetic = normalizeColumn(cols, indexMap.phonetic);
    const gender = normalizeColumn(cols, indexMap.gender);
    const department = normalizeColumn(cols, indexMap.department);
    const phone = normalizeColumn(cols, indexMap.phone);
    const email = normalizeColumn(cols, indexMap.email);
    const teamNumber = normalizeColumn(cols, indexMap.team);

    if (!participantId && !name && !phonetic && !gender && !department && !phone && !email) {
      return;
    }

    if (!name) {
      throw new Error("氏名のない行があります。CSVを確認してください。");
    }

    if (participantId) {
      if (seenIds.has(participantId)) {
        return;
      }
      seenIds.add(participantId);
    } else {
      const key = participantIdentityKey({ name, phonetic, department });
      if (key) {
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
      }
    }

    entries.push({
      participantId,
      name,
      phonetic,
      furigana: phonetic,
      gender,
      department,
      teamNumber,
      groupNumber: teamNumber,
      phone,
      email
    });
  });

  if (!entries.length) {
    throw new Error("有効な参加者データがありません。");
  }

  return entries;
}

function parseTeamAssignmentRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => normalizeKey(cell).toLowerCase());
  const hasHeader =
    headerCandidate.some(cell => /id|参加|member/.test(cell)) &&
    headerCandidate.some(cell => /班|group|team/.test(cell));

  if (!hasHeader) {
    throw new Error("ヘッダー行が見つかりません。テンプレートを利用して参加者IDと班番号の列を用意してください。");
  }

  const findIndex = (keywords, fallback) => {
    for (const keyword of keywords) {
      const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
      if (idx !== -1) return idx;
    }
    return fallback;
  };

  const idIndex = findIndex(["id", "参加", "member"], -1);
  const teamIndex = findIndex(["班", "group", "team"], -1);

  if (idIndex < 0 || teamIndex < 0) {
    throw new Error("CSVの列が認識できません。参加者IDと班番号の列をヘッダーに含めてください。");
  }

  const dataRows = rows.slice(1);

  const assignments = new Map();
  dataRows.forEach(cols => {
    const participantId = normalizeKey(cols[idIndex] ?? "");
    const teamNumber = normalizeKey(cols[teamIndex] ?? "");
    if (!participantId) {
      return;
    }
    assignments.set(participantId, teamNumber);
  });

  if (!assignments.size) {
    throw new Error("有効な参加者IDが含まれていません。");
  }

  return assignments;
}

function ensureTeamAssignmentMap(eventId) {
  if (!eventId) return null;
  if (!(state.teamAssignments instanceof Map)) {
    state.teamAssignments = new Map();
  }
  if (!state.teamAssignments.has(eventId)) {
    state.teamAssignments.set(eventId, new Map());
  }
  const map = state.teamAssignments.get(eventId);
  return map instanceof Map ? map : null;
}

function getTeamAssignmentMap(eventId) {
  if (!eventId) return null;
  if (!(state.teamAssignments instanceof Map)) return null;
  const map = state.teamAssignments.get(eventId);
  return map instanceof Map ? map : null;
}

function applyAssignmentsToEntries(entries, assignmentMap) {
  if (!Array.isArray(entries) || !(assignmentMap instanceof Map) || !assignmentMap.size) {
    return { entries, matchedIds: new Set(), updatedIds: new Set() };
  }
  const matchedIds = new Set();
  const updatedIds = new Set();
  const updatedEntries = entries.map(entry => {
    const participantId = String(entry?.participantId || "");
    if (!participantId || !assignmentMap.has(participantId)) {
      return entry;
    }
    matchedIds.add(participantId);
    const teamNumber = String(assignmentMap.get(participantId) || "");
    const currentTeam = String(entry?.teamNumber || entry?.groupNumber || "");
    if (currentTeam === teamNumber) {
      return entry;
    }
    updatedIds.add(participantId);
    return {
      ...entry,
      teamNumber,
      groupNumber: teamNumber
    };
  });

  return { entries: updatedEntries, matchedIds, updatedIds };
}

function applyAssignmentsToEventCache(eventId, assignmentMap) {
  if (!eventId || !(assignmentMap instanceof Map) || !assignmentMap.size) {
    return new Set();
  }
  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }
  const cache = state.eventParticipantCache.get(eventId);
  if (!cache || typeof cache !== "object") {
    return new Set();
  }
  const matchedIds = new Set();
  Object.keys(cache).forEach(scheduleId => {
    const list = Array.isArray(cache[scheduleId]) ? cache[scheduleId] : [];
    cache[scheduleId] = list.map(record => {
      const participantId = String(record?.participantId || "");
      if (!participantId || !assignmentMap.has(participantId)) {
        return record;
      }
      matchedIds.add(participantId);
      const teamNumber = String(assignmentMap.get(participantId) || "");
      return {
        ...record,
        groupNumber: teamNumber,
        teamNumber
      };
    });
  });
  state.eventParticipantCache.set(eventId, cache);
  return matchedIds;
}

function normalizeParticipantRecord(entry) {
  const participantId = String(entry?.participantId || entry?.id || "");
  const name = String(entry?.name || "");
  const phonetic = String(entry?.phonetic || entry?.furigana || "");
  const gender = String(entry?.gender || "");
  const department = String(entry?.department || entry?.faculty || entry?.groupNumber || "");
  const rawGroup = entry?.teamNumber ?? entry?.groupNumber ?? "";
  const teamNumber = String(rawGroup || "");
  const phone = String(entry?.phone || "");
  const email = String(entry?.email || "");
  const token = String(entry?.token || "");
  const guidance = String(entry?.guidance || "");
  return {
    participantId,
    name,
    phonetic,
    furigana: phonetic,
    gender,
    department,
    groupNumber: teamNumber,
    teamNumber,
    phone,
    email,
    token,
    guidance
  };
}

function assignParticipantIds(entries, existingParticipants = [], options = {}) {
  const resolved = entries.map(entry => ({ ...entry }));

  const usedIds = new Set();
  const existingByKey = new Map();

  existingParticipants.forEach(participant => {
    const participantId = normalizeKey(participant.participantId || participant.id || "");
    if (participantId) {
      usedIds.add(participantId);
    }
    const key = participantIdentityKey(participant);
    if (key && participantId && !existingByKey.has(key)) {
      existingByKey.set(key, participantId);
    }
  });

  resolved.forEach(entry => {
    if (entry.participantId) {
      usedIds.add(entry.participantId);
    }
  });

  const assignedExistingIds = new Set();
  resolved.forEach(entry => {
    if (entry.participantId) return;
    const key = participantIdentityKey(entry);
    if (!key) return;
    const existingId = existingByKey.get(key);
    if (existingId && !assignedExistingIds.has(existingId)) {
      entry.participantId = existingId;
      usedIds.add(existingId);
      assignedExistingIds.add(existingId);
    }
  });

  const { eventId = "", scheduleId = "" } = options || {};
  const prefix = createParticipantIdPrefix(eventId, scheduleId);
  const prefixPattern = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}_(\\d+)$`);
  let prefixMax = 0;
  let prefixPad = 3;

  usedIds.forEach(id => {
    const match = id.match(prefixPattern);
    if (!match) return;
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      prefixMax = Math.max(prefixMax, value);
      prefixPad = Math.max(prefixPad, match[1].length);
    }
  });

  let nextNumber = prefixMax ? prefixMax + 1 : 1;

  resolved.forEach(entry => {
    if (entry.participantId) return;
    let candidateNumber = nextNumber;
    let candidateId = "";
    while (!candidateId || usedIds.has(candidateId)) {
      const suffix = String(candidateNumber).padStart(prefixPad, "0");
      candidateId = `${prefix}_${suffix}`;
      candidateNumber += 1;
    }
    nextNumber = candidateNumber;
    entry.participantId = candidateId;
    usedIds.add(candidateId);
  });

  return resolved;
}

function signatureForEntries(entries) {
  return JSON.stringify(entries.map(entry => [
    entry.participantId,
    entry.name,
    entry.phonetic || entry.furigana || "",
    entry.gender || "",
    entry.teamNumber || entry.groupNumber || "",
    entry.department || entry.groupNumber || "",
    entry.phone || "",
    entry.email || ""
  ]));
}

export {
  participantIdentityKey,
  duplicateKeyFor,
  getScheduleLabel,
  normalizeEventParticipantCache,
  describeDuplicateMatch,
  updateDuplicateMatches,
  syncCurrentScheduleCache,
  parseParticipantRows,
  parseTeamAssignmentRows,
  ensureTeamAssignmentMap,
  getTeamAssignmentMap,
  applyAssignmentsToEntries,
  applyAssignmentsToEventCache,
  normalizeParticipantRecord,
  assignParticipantIds,
  signatureForEntries
};

