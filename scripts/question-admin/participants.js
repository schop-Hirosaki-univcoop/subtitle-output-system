import { state } from "./state.js";
import { normalizeKey } from "./utils.js";

const STRING_COLLATOR = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function normalizeText(value) {
  return String(value ?? "").trim();
}

let rowKeyCounter = 0;

function generateRowKey(prefix = "row") {
  rowKeyCounter = (rowKeyCounter + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}-${rowKeyCounter}`;
}

function ensureRowKey(entry, prefix = "row") {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  if (!entry.rowKey) {
    entry.rowKey = generateRowKey(prefix);
  }
  return entry;
}

function sanitizePrefixComponent(value) {
  return normalizeKey(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function resolveParticipantUid(entry, fallback = "") {
  if (!entry || typeof entry !== "object") return normalizeText(fallback);
  const candidates = [
    entry.uid,
    entry.UID,
    entry.participantUid,
    entry.participantuid,
    entry.participant_id,
    entry.participantId,
    entry.id,
    fallback
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeGroupNumberValue(value) {
  const normalized = normalizeText(value);
  return normalized;
}

function isCancellationValue(value) {
  if (!value) return false;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("キャンセル") || normalized === "cancel" || normalized === "cancelled";
}

function resolveParticipantStatus(entry, normalizedGroupValue) {
  const normalizedStatus = normalizeText(
    entry?.status || entry?.participantStatus || entry?.cancellationStatus || entry?.relocationStatus
  ).toLowerCase();

  if (normalizedStatus === "relocated" || normalizedStatus === "destination" || normalizedStatus === "relocation-destination") {
    return "relocated";
  }
  if (normalizedStatus === "cancelled" || normalizedStatus === "cancel" || normalizedStatus === "cancelled-origin") {
    return "cancelled";
  }
  if (normalizedStatus === "cancelled-destination") {
    return "relocated";
  }

  if (entry?.relocated === true || entry?.relocationDestination === true || entry?.destinationScheduleId) {
    return "relocated";
  }

  if (entry?.cancelled === true || entry?.cancellation === true) {
    return "cancelled";
  }

  if (isCancellationValue(normalizedGroupValue)) {
    return "cancelled";
  }

  return "active";
}

function createParticipantIdPrefix(eventId, scheduleId) {
  const eventPart = sanitizePrefixComponent(eventId);
  const schedulePart = sanitizePrefixComponent(scheduleId);
  const prefix = [eventPart, schedulePart].filter(Boolean).join("-");
  return prefix || "participant";
}

function formatParticipantIdDisplay(participantId) {
  const raw = String(participantId || "").trim();
  if (!raw) {
    return "";
  }
  const trailingDigits = raw.match(/(\d+)\s*$/);
  if (trailingDigits && trailingDigits[1]) {
    return trailingDigits[1];
  }
  const segments = raw.split(/[-_]/);
  if (segments.length > 1) {
    const tail = segments[segments.length - 1];
    if (/^\d+$/.test(tail)) {
      return tail;
    }
  }
  return raw;
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
    const normalized = Object.entries(scheduleBranch).map(([participantKey, entry]) => {
      const uid = resolveParticipantUid(entry, participantKey);
      const groupNumber = normalizeGroupNumberValue(entry?.groupNumber ?? entry?.teamNumber ?? "");
      const status = resolveParticipantStatus(entry, groupNumber);
      return ensureRowKey({
        key: uid || String(entry?.participantId || entry?.id || participantKey || ""),
        uid,
        participantId: uid || String(entry?.participantId || entry?.id || participantKey || ""),
        legacyParticipantId: uid && entry?.participantId && uid !== entry.participantId ? String(entry.participantId) : "",
        name: String(entry?.name || ""),
        department: String(entry?.department || entry?.groupNumber || ""),
        groupNumber,
        teamNumber: groupNumber,
        scheduleId: String(scheduleId),
        status,
        isCancelled: status === "cancelled",
        isRelocated: status === "relocated",
        rowKey: String(entry?.rowKey || "")
      }, "cache");
    });
    cache[String(scheduleId)] = normalized;
  });
  return cache;
}

function describeDuplicateMatch(match, eventId, currentScheduleId) {
  if (!match) return "";
  const name = String(match.name || "").trim();
  const displayId = formatParticipantIdDisplay(match.participantId);
  const idLabel = match.participantId
    ? `ID:${displayId || match.participantId}`
    : "ID未登録";
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
    list.forEach((entry, entryIndex) => {
      const record = {
        key: String(entry?.key || entry?.participantId || ""),
        participantId: String(entry?.participantId || ""),
        name: String(entry?.name || ""),
        department: String(entry?.department || ""),
        scheduleId: String(entry?.scheduleId || cacheScheduleId),
        isCurrent: Boolean(entry?.isCurrent),
        rowKey: String(entry?.rowKey || entry?.key || `${cacheScheduleId}#${entryIndex}`)
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
      isCurrent: true,
      rowKey: String(entry?.rowKey || `current-${index}-${entry?.participantId || ""}`)
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
        if (candidate.isCurrent && candidate.rowKey && record.rowKey && candidate.rowKey === record.rowKey) {
          return false;
        }
        return candidate !== record;
      });
      if (!others.length) return;
      const recordKey = record.rowKey || record.key || `${record.participantId || "__row"}`;
      duplicates.set(String(recordKey), {
        groupKey,
        totalCount: records.length,
        others: others.map(candidate => ({
          participantId: candidate.participantId,
          name: candidate.name,
          department: candidate.department,
          scheduleId: candidate.scheduleId,
          isCurrent: candidate.isCurrent,
          rowKey: candidate.rowKey || candidate.key || `${candidate.participantId || "__row"}`
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
  cache[scheduleId] = state.participants.map(entry => ensureRowKey({
    key: resolveParticipantUid(entry) || String(entry?.participantId || ""),
    uid: resolveParticipantUid(entry),
    participantId: resolveParticipantUid(entry) || String(entry?.participantId || ""),
    legacyParticipantId: entry?.legacyParticipantId || "",
    name: String(entry?.name || ""),
    department: String(entry?.department || entry?.groupNumber || ""),
    groupNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    teamNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    scheduleId: String(scheduleId),
    status: entry?.status || "active",
    isCancelled: Boolean(entry?.isCancelled),
    isRelocated: Boolean(entry?.isRelocated),
    isCurrent: true,
    rowKey: String(entry?.rowKey || "")
  }, "current-cache"));
  state.eventParticipantCache.set(eventId, cache);
}

function parseParticipantRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => normalizeKey(cell).toLowerCase());
  const hasNameHeader = headerCandidate.some(cell => /name|氏名|名前|ラジオ|radio/.test(cell));
  if (!hasNameHeader) {
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
    uid: findIndex(["uid"], -1),
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

  dataRows.forEach(cols => {
    const uid = normalizeColumn(cols, indexMap.uid);
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

    const resolvedId = uid || participantId;
    entries.push(ensureRowKey({
      uid: resolvedId,
      participantId: resolvedId,
      name,
      phonetic,
      furigana: phonetic,
      gender,
      department,
      teamNumber,
      groupNumber: teamNumber,
      phone,
      email
    }, "import"));
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

  const headerRaw = rows[0].map(cell => normalizeText(cell));
  const headerCandidate = headerRaw.map(cell => normalizeKey(cell).toLowerCase());

  const findIndex = (keywords, fallback = -1) => {
    for (const keyword of keywords) {
      const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
      if (idx !== -1) return idx;
    }
    return fallback;
  };

  const uidIndex = findIndex(["uid"], -1);
  const teamIndex = findIndex(["班", "group", "team"], -1);

  const dataRows = rows.slice(1);

  if (uidIndex >= 0 && teamIndex >= 0) {
    const assignments = new Map();
    dataRows.forEach(cols => {
      const uid = normalizeText(cols[uidIndex]);
      if (!uid) return;
      const teamNumber = normalizeGroupNumberValue(cols[teamIndex]);
      assignments.set(uid, teamNumber);
    });
    if (!assignments.size) {
      throw new Error("有効なuidが含まれていません。");
    }
    return assignments;
  }

  const legacyIdIndex = findIndex(["id", "参加", "member"], -1);

  if (legacyIdIndex < 0 || teamIndex < 0) {
    throw new Error("ヘッダー行が見つかりません。テンプレート（学部学科,性別,名前,班番号,uid）を利用してください。");
  }

  const assignments = new Map();
  dataRows.forEach(cols => {
    const key = normalizeText(cols[legacyIdIndex]);
    const teamNumber = normalizeGroupNumberValue(cols[teamIndex]);
    if (!key) return;
    assignments.set(key, teamNumber);
  });

  if (!assignments.size) {
    throw new Error("有効なIDが含まれていません。");
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
    const uid = resolveParticipantUid(entry);
    const fallbackId = String(entry?.participantId || "");
    const key = uid || fallbackId;
    if (!key) {
      return entry;
    }
    const hasAssignment = assignmentMap.has(key) || (fallbackId && assignmentMap.has(fallbackId));
    if (!hasAssignment) {
      return entry;
    }
    const assignmentKey = assignmentMap.has(key) ? key : fallbackId;
    matchedIds.add(assignmentKey);
    const teamNumber = String(assignmentMap.get(assignmentKey) || "");
    const currentTeam = String(entry?.teamNumber || entry?.groupNumber || "");
    if (currentTeam === teamNumber) {
      return entry;
    }
    updatedIds.add(assignmentKey);
    const nextStatus = resolveParticipantStatus({ ...entry, teamNumber }, teamNumber);
    return {
      ...entry,
      teamNumber,
      groupNumber: teamNumber,
      status: nextStatus,
      isCancelled: nextStatus === "cancelled",
      isRelocated: nextStatus === "relocated"
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
      const uid = resolveParticipantUid(record);
      const fallbackId = String(record?.participantId || "");
      const key = uid || fallbackId;
      if (!key) {
        return record;
      }
      const hasAssignment = assignmentMap.has(key) || (fallbackId && assignmentMap.has(fallbackId));
      if (!hasAssignment) {
        return record;
      }
      const assignmentKey = assignmentMap.has(key) ? key : fallbackId;
      matchedIds.add(assignmentKey);
      const teamNumber = String(assignmentMap.get(assignmentKey) || "");
      const nextStatus = resolveParticipantStatus({ ...record, teamNumber }, teamNumber);
      return {
        ...record,
        groupNumber: teamNumber,
        teamNumber,
        status: nextStatus,
        isCancelled: nextStatus === "cancelled",
        isRelocated: nextStatus === "relocated",
        rowKey: String(record?.rowKey || "")
      };
    });
  });
  state.eventParticipantCache.set(eventId, cache);
  return matchedIds;
}

function normalizeParticipantRecord(entry, fallbackId = "") {
  const uid = resolveParticipantUid(entry, fallbackId);
  const legacyParticipantId = normalizeText(entry?.participantId || entry?.id || "");
  const participantId = uid || legacyParticipantId;
  const name = normalizeText(entry?.name || entry?.displayName);
  const phonetic = normalizeText(entry?.phonetic || entry?.furigana);
  const gender = normalizeText(entry?.gender);
  const department = normalizeText(entry?.department || entry?.faculty || entry?.groupNumber);
  const rawGroup = entry?.teamNumber ?? entry?.groupNumber ?? "";
  const teamNumber = normalizeGroupNumberValue(rawGroup);
  const phone = normalizeText(entry?.phone);
  const email = normalizeText(entry?.email);
  const token = normalizeText(entry?.token);
  const guidance = normalizeText(entry?.guidance);
  const status = resolveParticipantStatus(entry, teamNumber);
  const isCancelled = status === "cancelled";
  const isRelocated = status === "relocated";
  return ensureRowKey({
    uid,
    participantId,
    legacyParticipantId: uid && legacyParticipantId && uid !== legacyParticipantId ? legacyParticipantId : "",
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
    guidance,
    status,
    isCancelled,
    isRelocated,
    rowKey: String(entry?.rowKey || "")
  }, "record");
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

const STATUS_PRIORITY = new Map([
  ["active", 0],
  ["relocated", 0],
  ["cancelled", 1]
]);

function compareStrings(a, b) {
  const textA = normalizeText(a);
  const textB = normalizeText(b);
  if (!textA && !textB) return 0;
  if (!textA) return 1;
  if (!textB) return -1;
  return STRING_COLLATOR.compare(textA, textB);
}

function getGroupSortInfo(entry) {
  const groupValue = normalizeGroupNumberValue(entry?.teamNumber ?? entry?.groupNumber ?? "");
  if (!groupValue) {
    return { bucket: 2, number: Number.POSITIVE_INFINITY, text: "" };
  }
  const numeric = Number(groupValue);
  if (!Number.isNaN(numeric)) {
    return { bucket: 0, number: numeric, text: groupValue };
  }
  return { bucket: 1, number: Number.POSITIVE_INFINITY, text: groupValue };
}

function compareParticipants(a, b) {
  const statusA = a?.status || "active";
  const statusB = b?.status || "active";
  const statusRankA = STATUS_PRIORITY.has(statusA) ? STATUS_PRIORITY.get(statusA) : STATUS_PRIORITY.get("active");
  const statusRankB = STATUS_PRIORITY.has(statusB) ? STATUS_PRIORITY.get(statusB) : STATUS_PRIORITY.get("active");
  if (statusRankA !== statusRankB) {
    return statusRankA - statusRankB;
  }

  const groupInfoA = getGroupSortInfo(a);
  const groupInfoB = getGroupSortInfo(b);
  if (groupInfoA.bucket !== groupInfoB.bucket) {
    return groupInfoA.bucket - groupInfoB.bucket;
  }
  if (groupInfoA.bucket === 0) {
    if (groupInfoA.number !== groupInfoB.number) {
      return groupInfoA.number - groupInfoB.number;
    }
  } else if (groupInfoA.bucket === 1) {
    const groupCompare = compareStrings(groupInfoA.text, groupInfoB.text);
    if (groupCompare !== 0) {
      return groupCompare;
    }
  }

  const departmentCompare = compareStrings(a?.department, b?.department);
  if (departmentCompare !== 0) {
    return departmentCompare;
  }

  const phoneticCompare = compareStrings(a?.phonetic || a?.furigana, b?.phonetic || b?.furigana);
  if (phoneticCompare !== 0) {
    return phoneticCompare;
  }

  const nameCompare = compareStrings(a?.name, b?.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  const uidA = resolveParticipantUid(a);
  const uidB = resolveParticipantUid(b);
  return compareStrings(uidA, uidB);
}

function sortParticipants(entries = []) {
  return entries.slice().sort(compareParticipants);
}

const PARTICIPANT_DIFF_FIELDS = [
  { key: "name", label: "氏名" },
  { key: "phonetic", label: "フリガナ" },
  { key: "gender", label: "性別" },
  { key: "department", label: "学部学科" },
  { key: "teamNumber", label: "班番号" },
  { key: "phone", label: "携帯電話" },
  { key: "email", label: "メールアドレス" }
];

function snapshotParticipant(entry) {
  if (!entry || typeof entry !== "object") {
    return {
      participantId: "",
      name: "",
      phonetic: "",
      gender: "",
      department: "",
      teamNumber: "",
      phone: "",
      email: "",
      rowKey: ""
    };
  }
  return {
    participantId: String(entry.participantId || entry.id || ""),
    name: String(entry.name || ""),
    phonetic: String(entry.phonetic || entry.furigana || ""),
    gender: String(entry.gender || ""),
    department: String(entry.department || entry.groupNumber || ""),
    teamNumber: String(entry.teamNumber || entry.groupNumber || ""),
    phone: String(entry.phone || ""),
    email: String(entry.email || ""),
    rowKey: String(entry.rowKey || "")
  };
}

function snapshotParticipantList(entries = []) {
  return entries.map(snapshotParticipant);
}

function diffParticipantFields(previous, current) {
  const changes = [];
  PARTICIPANT_DIFF_FIELDS.forEach(field => {
    const previousValue = String(previous?.[field.key] || "");
    const currentValue = String(current?.[field.key] || "");
    if (previousValue !== currentValue) {
      changes.push({
        field: field.key,
        label: field.label,
        previous: previousValue,
        current: currentValue
      });
    }
  });
  return changes;
}

function diffParticipantLists(currentEntries = [], baselineEntries = []) {
  const currentSnapshots = snapshotParticipantList(currentEntries);
  const baselineSnapshots = snapshotParticipantList(baselineEntries);

  const baselineMap = new Map();
  baselineSnapshots.forEach(entry => {
    const key = entry.participantId || entry.rowKey;
    if (!key) return;
    if (!baselineMap.has(key)) {
      baselineMap.set(key, entry);
    }
  });

  const matchedKeys = new Set();
  const added = [];
  const updated = [];

  currentSnapshots.forEach(entry => {
    const key = entry.participantId || entry.rowKey;
    if (!key) {
      added.push(entry);
      return;
    }
    const baselineEntry = baselineMap.get(key);
    if (!baselineEntry) {
      added.push(entry);
      return;
    }
    matchedKeys.add(key);
    const changes = diffParticipantFields(baselineEntry, entry);
    if (changes.length) {
      updated.push({ previous: baselineEntry, current: entry, changes });
    }
  });

  const removed = [];
  baselineSnapshots.forEach(entry => {
    const key = entry.participantId || entry.rowKey;
    if (!key) return;
    if (!matchedKeys.has(key)) {
      removed.push(entry);
    }
  });

  return { added, updated, removed };
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
  resolveParticipantUid,
  resolveParticipantStatus,
  sortParticipants,
  signatureForEntries,
  formatParticipantIdDisplay,
  snapshotParticipantList,
  diffParticipantLists,
  diffParticipantFields
};

