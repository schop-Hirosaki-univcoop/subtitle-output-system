// WebAppとしてアクセスされたときに実行されるメイン関数
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'GET not allowed' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 指定されたシートのデータを読み込んでオブジェクトの配列に変換するヘルパー関数
function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found.`);
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const headers = values.shift();

  return values.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

const DISPLAY_SESSION_TTL_MS = 60 * 1000;

// WebAppにPOSTリクエストが送られたときに実行される関数
function doPost(e) {
  try {
    const req = parseBody_(e);
    const { action, idToken } = req;
    if (!action) throw new Error('Missing action');

    const displayActions = new Set(['beginDisplaySession', 'heartbeatDisplaySession', 'endDisplaySession']);
    const noAuthActions = new Set(['submitQuestion', 'fetchNameMappings', 'fetchQuestionContext']);
    let principal = null;
    if (!noAuthActions.has(action)) {
      principal = requireAuth_(idToken, displayActions.has(action) ? { allowAnonymous: true } : {});
    }

    switch (action) {
      case 'beginDisplaySession':
        return jsonOk(beginDisplaySession_(principal));
      case 'heartbeatDisplaySession':
        return jsonOk(heartbeatDisplaySession_(principal, req.sessionId));
      case 'endDisplaySession':
        return jsonOk(endDisplaySession_(principal, req.sessionId, req.reason));
      case 'ensureAdmin':
        return jsonOk(ensureAdmin_(principal));
      case 'submitQuestion':
        return jsonOk(submitQuestion_(req));
      case 'fetchNameMappings':
        return jsonOk({ mappings: fetchNameMappings_() });
      case 'fetchQuestionContext':
        return jsonOk({ context: fetchQuestionContext_(req) });
      case 'saveNameMappings':
        assertOperator_(principal);
        return jsonOk(saveNameMappings_(req.entries));
      case 'mirrorSheet':
        assertOperator_(principal);
        return jsonOk(mirrorSheetToRtdb_());
      case 'fetchSheet':
        assertOperator_(principal);
        return jsonOk({ data: getSheetData_(req.sheet) });
      case 'listQuestionEvents':
        assertOperator_(principal);
        return jsonOk({ events: listQuestionEvents_() });
      case 'createQuestionEvent':
        assertOperator_(principal);
        return jsonOk({ event: createQuestionEvent_(req.name) });
      case 'deleteQuestionEvent':
        assertOperator_(principal);
        return jsonOk(deleteQuestionEvent_(req.eventId));
      case 'createQuestionSchedule':
        assertOperator_(principal);
        return jsonOk({ schedule: createQuestionSchedule_(req.eventId, req.label, req.date) });
      case 'deleteQuestionSchedule':
        assertOperator_(principal);
        return jsonOk(deleteQuestionSchedule_(req.eventId, req.scheduleId));
      case 'fetchQuestionParticipants':
        assertOperator_(principal);
        return jsonOk({ participants: fetchQuestionParticipants_(req.eventId, req.scheduleId) });
      case 'saveQuestionParticipants':
        assertOperator_(principal);
        return jsonOk(saveQuestionParticipants_(req.eventId, req.scheduleId, req.entries));
      case 'addTerm':
        assertOperator_(principal);
        return jsonOk(addDictionaryTerm(req.term, req.ruby));
      case 'deleteTerm':
        assertOperator_(principal);
        return jsonOk(deleteDictionaryTerm(req.term));
      case 'toggleTerm':
        assertOperator_(principal);
        return jsonOk(toggleDictionaryTerm(req.term, req.enabled));
      case 'updateStatus':
        assertOperator_(principal);
        return jsonOk(updateAnswerStatus(req.uid, req.status));
      case 'editQuestion':
        assertOperator_(principal);
        return jsonOk(editQuestionText(req.uid, req.text));
      case 'batchUpdateStatus':
        assertOperator_(principal);
        return jsonOk(batchUpdateStatus(req.uids, req.status, principal));
      case 'updateSelectingStatus':
        assertOperator_(principal);
        return jsonOk(updateSelectingStatus(req.uid, principal));
      case 'clearSelectingStatus':
        assertOperator_(principal);
        return jsonOk(clearSelectingStatus(principal));
      case 'logAction':
        assertOperator_(principal);
        return jsonOk(logAction_(principal, req.action_type, req.details));
      case 'whoami':
        return jsonOk({ principal });
      default:
        throw new Error('Unknown action: ' + action);
    }
  } catch (err) {
    return jsonErr_(err);
  }
}

function submitQuestion_(payload) {
  const radioName = String(payload.radioName || payload.name || '').trim();
  const questionText = String(payload.question || payload.text || '').trim();
  const groupNumber = String(payload.groupNumber || payload.group || '').trim();
  const rawGenre = String(payload.genre || '').trim();
  const rawSchedule = String(payload.schedule || payload.date || '').trim();
  const eventId = String(payload.eventId || '').trim();
  const eventName = String(payload.eventName || '').trim();
  const scheduleId = String(payload.scheduleId || '').trim();
  const participantId = String(payload.participantId || '').trim();
  const scheduleDate = String(payload.scheduleDate || '').trim();

  if (!radioName) throw new Error('ラジオネームを入力してください。');
  if (!questionText) throw new Error('質問・お悩みを入力してください。');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
  if (!sheet) throw new Error('Sheet "answer" not found.');

  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('answer sheet has no headers.');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const headerMap = new Map();
  headers.forEach((header, index) => {
    if (header == null) return;
    headerMap.set(norm(header), index);
  });

  const requiredHeaders = ['ラジオネーム', '質問・お悩み', 'uid'];
  requiredHeaders.forEach(key => {
    if (!headerMap.has(norm(key))) {
      throw new Error(`Column "${key}" not found in answer sheet.`);
    }
  });

  const newRow = Array.from({ length: headers.length }, () => '');
  const setValue = (headerKey, value) => {
    const idx = headerMap.get(norm(headerKey));
    if (idx == null || idx < 0) return;
    newRow[idx] = value;
  };

  const timestamp = new Date();
  const uid = Utilities.getUuid();

  setValue('タイムスタンプ', timestamp);
  setValue('Timestamp', timestamp);
  setValue('ラジオネーム', radioName);
  setValue('質問・お悩み', questionText);
  if (groupNumber) {
    setValue('班番号', groupNumber);
  }
  const genreValue = rawGenre || 'その他';
  setValue('ジャンル', genreValue);
  setValue('日程', rawSchedule);
  if (rawSchedule) {
    setValue('日程表示', rawSchedule);
  }
  if (scheduleDate) {
    setValue('日程日付', scheduleDate);
  }
  if (eventId) {
    setValue('イベントID', eventId);
  }
  if (eventName) {
    setValue('イベント名', eventName);
  }
  if (scheduleId) {
    setValue('日程ID', scheduleId);
  }
  if (participantId) {
    setValue('参加者ID', participantId);
  }
  setValue('uid', uid);
  setValue('回答済', false);
  setValue('選択中', false);
  setValue('UID', uid);

  sheet.appendRow(newRow);
  try {
    notifyUpdate('answer');
  } catch (e) {
    console.warn('notifyUpdate failed after submitQuestion_', e);
  }

  return { uid, timestamp: toIsoJst_(timestamp) };
}

const NAME_MAP_SHEET_NAME = 'name_mappings';

function ensureNameMapSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NAME_MAP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(NAME_MAP_SHEET_NAME);
  }

  const headerRange = sheet.getRange(1, 1, 1, 2);
  const headers = headerRange.getValues()[0];
  const expected = ['ラジオネーム', '班番号'];
  if (headers[0] !== expected[0] || headers[1] !== expected[1]) {
    headerRange.setValues([expected]);
  }

  return sheet;
}

function normalizeNameKey_(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC');
}

function normalizeNameForLookup_(value) {
  return normalizeNameKey_(value).replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function readNameMappings_() {
  const sheet = ensureNameMapSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return values
    .map(row => ({
      name: normalizeNameKey_(row[0]),
      groupNumber: String(row[1] || '').trim()
    }))
    .filter(entry => entry.name && entry.groupNumber);
}

function fetchNameMappings_() {
  return readNameMappings_();
}

function saveNameMappings_(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Invalid payload: entries');
  }

  const deduped = [];
  const seen = new Set();
  entries.forEach(entry => {
    if (!entry) return;
    const name = normalizeNameKey_(entry.name || entry.radioName || '');
    const groupNumber = String(entry.groupNumber || entry.group || '').trim();
    if (!name || !groupNumber) return;
    const lookup = normalizeNameForLookup_(name);
    if (seen.has(lookup)) return;
    seen.add(lookup);
    deduped.push({ name, groupNumber });
  });

  const sheet = ensureNameMapSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  }

  if (deduped.length) {
    const values = deduped.map(entry => [entry.name, entry.groupNumber]);
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }

  return { count: deduped.length };
}

const QUESTION_EVENT_SHEET = 'question_events';
const QUESTION_SCHEDULE_SHEET = 'question_schedules';
const QUESTION_PARTICIPANT_SHEET = 'question_participants';

function ensureSheetWithHeaders_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const existing = headerRange.getValues()[0];
  let needsUpdate = false;
  headers.forEach((header, idx) => {
    if (existing[idx] !== header) {
      needsUpdate = true;
    }
  });
  if (needsUpdate) {
    headerRange.setValues([headers]);
  }

  return sheet;
}

function ensureQuestionEventSheet_() {
  return ensureSheetWithHeaders_(QUESTION_EVENT_SHEET, ['イベントID', 'イベント名', '作成日時']);
}

function ensureQuestionScheduleSheet_() {
  return ensureSheetWithHeaders_(QUESTION_SCHEDULE_SHEET, ['イベントID', '日程ID', '表示名', '日付', '作成日時']);
}

function ensureQuestionParticipantSheet_() {
  return ensureSheetWithHeaders_(QUESTION_PARTICIPANT_SHEET, ['イベントID', '日程ID', '参加者ID', '氏名', '班番号', '更新日時']);
}

function generateShortId_(prefix) {
  const raw = Utilities.getUuid().replace(/-/g, '');
  return (prefix || '') + raw.slice(0, 8);
}

function readEvents_() {
  const sheet = ensureQuestionEventSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return values
    .map(row => {
      const id = String(row[0] || '').trim();
      if (!id) return null;
      return {
        id,
        name: String(row[1] || '').trim(),
        createdAt: row[2] instanceof Date ? toIsoJst_(row[2]) : ''
      };
    })
    .filter(Boolean);
}

function readSchedules_() {
  const sheet = ensureQuestionScheduleSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values
    .map(row => {
      const eventId = String(row[0] || '').trim();
      const scheduleId = String(row[1] || '').trim();
      if (!eventId || !scheduleId) return null;
      return {
        eventId,
        id: scheduleId,
        label: String(row[2] || '').trim(),
        date: String(row[3] || '').trim(),
        createdAt: row[4] instanceof Date ? toIsoJst_(row[4]) : ''
      };
    })
    .filter(Boolean);
}

function readParticipantEntries_() {
  const sheet = ensureQuestionParticipantSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  return values
    .map(row => {
      const eventId = String(row[0] || '').trim();
      const scheduleId = String(row[1] || '').trim();
      const participantId = String(row[2] || '').trim();
      if (!eventId || !scheduleId || !participantId) return null;
      return {
        eventId,
        scheduleId,
        participantId,
        name: normalizeNameKey_(row[3] || ''),
        groupNumber: String(row[4] || '').trim(),
        updatedAt: row[5] instanceof Date ? toIsoJst_(row[5]) : ''
      };
    })
    .filter(Boolean);
}

function listQuestionEvents_() {
  const events = readEvents_();
  const schedules = readSchedules_();
  const participants = readParticipantEntries_();

  const scheduleMap = new Map();
  schedules.forEach(schedule => {
    const list = scheduleMap.get(schedule.eventId) || [];
    list.push(schedule);
    scheduleMap.set(schedule.eventId, list);
  });

  const participantCounts = new Map();
  participants.forEach(entry => {
    const key = `${entry.eventId}::${entry.scheduleId}`;
    participantCounts.set(key, (participantCounts.get(key) || 0) + 1);
  });

  return events.map(event => {
    const scheduleList = scheduleMap.get(event.id) || [];
    const enrichedSchedules = scheduleList.map(schedule => ({
      id: schedule.id,
      label: schedule.label,
      date: schedule.date,
      createdAt: schedule.createdAt,
      participantCount: participantCounts.get(`${event.id}::${schedule.id}`) || 0
    }));
    return { ...event, schedules: enrichedSchedules };
  });
}

function createQuestionEvent_(name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('イベント名を入力してください。');
  }

  const sheet = ensureQuestionEventSheet_();
  const id = generateShortId_('evt_');
  const now = new Date();
  sheet.appendRow([id, trimmedName, now]);
  return { id, name: trimmedName, createdAt: toIsoJst_(now), schedules: [] };
}

function deleteQuestionEvent_(eventId) {
  const id = String(eventId || '').trim();
  if (!id) {
    throw new Error('eventId is required');
  }

  const eventSheet = ensureQuestionEventSheet_();
  const lastRow = eventSheet.getLastRow();
  for (let row = lastRow; row >= 2; row--) {
    const value = String(eventSheet.getRange(row, 1).getValue() || '').trim();
    if (value === id) {
      eventSheet.deleteRow(row);
    }
  }

  const scheduleSheet = ensureQuestionScheduleSheet_();
  const scheduleLast = scheduleSheet.getLastRow();
  for (let row = scheduleLast; row >= 2; row--) {
    const value = String(scheduleSheet.getRange(row, 1).getValue() || '').trim();
    if (value === id) {
      scheduleSheet.deleteRow(row);
    }
  }

  const participantSheet = ensureQuestionParticipantSheet_();
  const participantLast = participantSheet.getLastRow();
  for (let row = participantLast; row >= 2; row--) {
    const value = String(participantSheet.getRange(row, 1).getValue() || '').trim();
    if (value === id) {
      participantSheet.deleteRow(row);
    }
  }

  return { deleted: true };
}

function assertEventExists_(eventId) {
  const events = readEvents_();
  const found = events.find(event => event.id === eventId);
  if (!found) {
    throw new Error('指定されたイベントが見つかりません。');
  }
  return found;
}

function createQuestionSchedule_(eventId, label, date) {
  const trimmedEventId = String(eventId || '').trim();
  if (!trimmedEventId) {
    throw new Error('eventId is required');
  }
  assertEventExists_(trimmedEventId);

  const trimmedLabel = String(label || '').trim();
  const trimmedDate = String(date || '').trim();
  if (!trimmedLabel) {
    throw new Error('日程の表示名を入力してください。');
  }

  const sheet = ensureQuestionScheduleSheet_();
  const id = generateShortId_('sch_');
  const now = new Date();
  sheet.appendRow([trimmedEventId, id, trimmedLabel, trimmedDate, now]);
  return { id, label: trimmedLabel, date: trimmedDate, createdAt: toIsoJst_(now), participantCount: 0 };
}

function deleteQuestionSchedule_(eventId, scheduleId) {
  const trimmedEventId = String(eventId || '').trim();
  const trimmedScheduleId = String(scheduleId || '').trim();
  if (!trimmedEventId || !trimmedScheduleId) {
    throw new Error('eventId and scheduleId are required');
  }

  const scheduleSheet = ensureQuestionScheduleSheet_();
  const lastRow = scheduleSheet.getLastRow();
  for (let row = lastRow; row >= 2; row--) {
    const eventValue = String(scheduleSheet.getRange(row, 1).getValue() || '').trim();
    const scheduleValue = String(scheduleSheet.getRange(row, 2).getValue() || '').trim();
    if (eventValue === trimmedEventId && scheduleValue === trimmedScheduleId) {
      scheduleSheet.deleteRow(row);
    }
  }

  const participantSheet = ensureQuestionParticipantSheet_();
  const participantLast = participantSheet.getLastRow();
  for (let row = participantLast; row >= 2; row--) {
    const eventValue = String(participantSheet.getRange(row, 1).getValue() || '').trim();
    const scheduleValue = String(participantSheet.getRange(row, 2).getValue() || '').trim();
    if (eventValue === trimmedEventId && scheduleValue === trimmedScheduleId) {
      participantSheet.deleteRow(row);
    }
  }

  return { deleted: true };
}

function fetchQuestionParticipants_(eventId, scheduleId) {
  const trimmedEventId = String(eventId || '').trim();
  const trimmedScheduleId = String(scheduleId || '').trim();
  if (!trimmedEventId || !trimmedScheduleId) {
    throw new Error('eventId and scheduleId are required');
  }

  return readParticipantEntries_().filter(entry => entry.eventId === trimmedEventId && entry.scheduleId === trimmedScheduleId)
    .map(entry => ({
      participantId: entry.participantId,
      name: entry.name,
      groupNumber: entry.groupNumber
    }));
}

function saveQuestionParticipants_(eventId, scheduleId, entries) {
  const trimmedEventId = String(eventId || '').trim();
  const trimmedScheduleId = String(scheduleId || '').trim();
  if (!trimmedEventId || !trimmedScheduleId) {
    throw new Error('eventId and scheduleId are required');
  }
  assertEventExists_(trimmedEventId);
  const schedules = readSchedules_();
  const scheduleFound = schedules.find(schedule => schedule.eventId === trimmedEventId && schedule.id === trimmedScheduleId);
  if (!scheduleFound) {
    throw new Error('指定された日程が見つかりません。');
  }

  if (!Array.isArray(entries)) {
    throw new Error('entries must be an array');
  }

  const deduped = [];
  const seen = new Set();
  entries.forEach(entry => {
    if (!entry) return;
    const participantId = String(entry.participantId || entry.id || '').trim();
    if (!participantId) return;
    if (seen.has(participantId)) return;
    seen.add(participantId);
    const name = normalizeNameKey_(entry.name || entry.displayName || '');
    const groupNumber = String(entry.groupNumber || entry.group || '').trim();
    deduped.push({ participantId, name, groupNumber });
  });

  const sheet = ensureQuestionParticipantSheet_();
  const lastRow = sheet.getLastRow();
  let existing = [];
  if (lastRow >= 2) {
    existing = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  }

  const nextRows = [];
  existing.forEach(row => {
    const eventValue = String(row[0] || '').trim();
    const scheduleValue = String(row[1] || '').trim();
    if (!eventValue || !scheduleValue) {
      return;
    }
    if (eventValue === trimmedEventId && scheduleValue === trimmedScheduleId) {
      return;
    }
    nextRows.push([eventValue, scheduleValue, String(row[2] || '').trim(), normalizeNameKey_(row[3] || ''), String(row[4] || '').trim(), row[5]]);
  });

  const now = new Date();
  deduped.forEach(entry => {
    nextRows.push([
      trimmedEventId,
      trimmedScheduleId,
      entry.participantId,
      entry.name,
      entry.groupNumber,
      now
    ]);
  });

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  }
  if (nextRows.length) {
    const requiredRows = nextRows.length + 1;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    sheet.getRange(2, 1, nextRows.length, 6).setValues(nextRows);
  }

  return { count: deduped.length };
}

function fetchQuestionContext_(payload) {
  const eventId = String(payload.eventId || payload.event || '').trim();
  const scheduleId = String(payload.scheduleId || payload.schedule || '').trim();
  const participantId = String(payload.participantId || payload.participant || payload.id || '').trim();

  if (!eventId || !scheduleId || !participantId) {
    throw new Error('アクセスに必要な情報が不足しています。');
  }

  const events = listQuestionEvents_();
  const event = events.find(evt => evt.id === eventId);
  if (!event) {
    throw new Error('イベント情報が見つかりません。担当者にお問い合わせください。');
  }
  const schedule = (event.schedules || []).find(s => s.id === scheduleId);
  if (!schedule) {
    throw new Error('日程情報が見つかりません。担当者にお問い合わせください。');
  }

  const participants = fetchQuestionParticipants_(eventId, scheduleId);
  const participant = participants.find(entry => entry.participantId === participantId);
  if (!participant) {
    throw new Error('参加者情報が確認できません。担当者にお問い合わせください。');
  }

  return {
    eventId,
    eventName: event.name,
    scheduleId,
    scheduleLabel: schedule.label || schedule.date || '',
    scheduleDate: schedule.date || '',
    participantId,
    participantName: participant.name,
    groupNumber: participant.groupNumber || ''
  };
}

function ensureAdmin_(principal){
  const uid   = principal && principal.uid;
  const email = String(principal && principal.email || '').trim().toLowerCase();
  if (!uid || !email) throw new Error('No uid/email');

  const users = getSheetData_('users');
  const ok = users.some(row => {
    const m = String(row['メールアドレス'] || row['email'] || '').trim().toLowerCase();
    return m && m === email;
  });
  if (!ok) throw new Error('Not in users sheet');

  const token = getFirebaseAccessToken_();
  const res = UrlFetchApp.fetch(rtdbUrl_('admins/' + uid), {
    method: 'put',
    contentType: 'application/json',
    payload: 'true',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  return { status: res.getResponseCode() };
}

function rtdbUrl_(path){
  const FIREBASE_DB_URL = PropertiesService.getScriptProperties().getProperty('FIREBASE_DB_URL');
  return FIREBASE_DB_URL.replace(/\/$/, '') + '/' + String(path || '').replace(/^\//,'') + '.json';
}

function mirrorSheetToRtdb_(){
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
  if (!sh) throw new Error('Sheet "answer" not found.');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return {count:0};
  const headers = values[0].map(h => String(h||'').trim());
  const norm = s => String(s||'').normalize('NFKC').replace(/\s+/g,'');
  const idxOf = key => headers.findIndex(h => norm(h) === norm(key));
  const tsIdx  = idxOf('タイムスタンプ');
  const nameIdx= idxOf('ラジオネーム');
  const qIdx   = idxOf('質問・お悩み');
  const grpIdx = idxOf('班番号');
  const genreIdx = idxOf('ジャンル');
  const dateIdx = idxOf('日程');
  const selIdx = idxOf('選択中');
  const ansIdx = idxOf('回答済');
  const uidIdx = idxOf('UID');
  if (uidIdx<0 || nameIdx<0 || qIdx<0) {
    throw new Error('必要な列(UID/ラジオネーム/質問・お悩み)が見つかりません');
  }

  const map = {};
  for (let r=1; r<values.length; r++){
    const row = values[r];
    const uid = String(row[uidIdx]).trim();
    if (!uid) continue;
    let tsMs = 0;
    const v = tsIdx>=0 ? row[tsIdx] : null;
    if (v instanceof Date) tsMs = v.getTime();
    else if (typeof v === 'number') {
      if (v > 20000 && v < 70000) tsMs = Math.round((v - 25569) * 86400 * 1000);
      else if (v > 1e10) tsMs = v;
      else if (v > 1e6) tsMs = v * 1000;
    } else if (typeof v === 'string' && v.trim()) {
      const s = v.replace(' ', 'T');
      const d = new Date(s);
      if (!isNaN(d)) tsMs = d.getTime();
    }
    const groupVal = grpIdx>=0 ? row[grpIdx] : '';
    const genreVal = genreIdx>=0 ? row[genreIdx] : '';
    const dateVal = dateIdx>=0 ? row[dateIdx] : '';
    map[uid] = {
      uid,
      name: String(row[nameIdx] ?? ''),
      question: String(row[qIdx] ?? ''),
      group: String(groupVal ?? ''),
      genre: String(genreVal ?? ''),
      schedule: String(dateVal ?? ''),
      ts: tsMs || 0,
      answered: Boolean(row[ansIdx] === true),
      selecting: Boolean(row[selIdx] === true),
      updatedAt: new Date().getTime()
    };
  }
  const token = getFirebaseAccessToken_();
  const res = UrlFetchApp.fetch(rtdbUrl_('questions'), {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(map),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  return { count: Object.keys(map).length, status: res.getResponseCode() };
}

function logAction_(principal, actionType, details) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('logs') 
            || SpreadsheetApp.getActiveSpreadsheet().insertSheet('logs');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp','User','Action','Details']);
  }
  const userEmail = (principal && principal.email) || 'unknown';
  const row = [new Date(), userEmail, actionType || '', details || ''];
  sh.appendRow(row);
  try { notifyUpdate('logs'); } catch (e) { console.error('notifyUpdate failed', e); }
  return { ok: true };
}

function parseBody_(e) {
  if (!e || !e.postData) throw new Error('No body');
  const text = e.postData.contents || '';
  try { return JSON.parse(text); }
  catch (e2) { throw new Error('Invalid JSON'); }
}

function requireAuth_(idToken, options){
  options = options || {};
  if (!idToken) throw new Error('Missing idToken');

  const KEY = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY');
  if (!KEY) throw new Error('Missing FIREBASE_WEB_API_KEY');

  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + KEY;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Auth HTTP ' + code);

  const obj = JSON.parse(res.getContentText());
  const user = obj.users && obj.users[0];
  if (!user) throw new Error('Auth failed: user not found');

  const providerInfo = Array.isArray(user.providerUserInfo) ? user.providerUserInfo : [];
  let tokenPayload = null;
  try {
    tokenPayload = parseJwt_(idToken);
  } catch (e) {
    tokenPayload = null;
  }

  const providerIds = providerInfo.map(info => String(info && info.providerId || '')).filter(Boolean);
  const normalizedProviderIds = providerIds.map(id => id.toLowerCase());
  const signInProvider = tokenPayload && tokenPayload.firebase && tokenPayload.firebase['sign_in_provider'];
  const allowAnonymous = options.allowAnonymous === true;

  const resolvedEmail = user.email ||
    (providerInfo.find(p => p.email) || {}).email ||
    (tokenPayload && tokenPayload.email ? tokenPayload.email : '') || '';

  const providersLookAnonymous = normalizedProviderIds.length === 0 || normalizedProviderIds.every(id => id === 'anonymous' || id === 'firebase');
  let isAnonymous = signInProvider === 'anonymous';
  if (!isAnonymous) {
    if (!resolvedEmail && providersLookAnonymous) {
      isAnonymous = true;
    } else if (!resolvedEmail && allowAnonymous) {
      isAnonymous = true;
    }
  }

  if (isAnonymous && !allowAnonymous) throw new Error('Anonymous auth not allowed');

  let email = '';
  if (!isAnonymous) {
    email = String(resolvedEmail || '').trim();

    const allowed = getAllowedDomains_().map(d => String(d).toLowerCase());
    if (allowed.length && email) {
      const domain = String(email).split('@')[1] || '';
      if (!allowed.includes(domain.toLowerCase())) throw new Error('Unauthorized domain');
    }
    if (user.emailVerified !== true) throw new Error('Email not verified');
  }

  if (user.disabled === true) throw new Error('User disabled');

  return {
    uid: user.localId,
    email: String(email || '').trim(),
    emailVerified: user.emailVerified === true,
    isAnonymous: isAnonymous
  };
}

function parseJwt_(t){
  const p = t.split('.')[1];
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p)).getDataAsString());
}

function getAllowedDomains_(){
  const raw = PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAIL_DOMAINS') || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function assertOperator_(principal){
  const email = String(principal && principal.email || '').trim().toLowerCase();
  if (!email) throw new Error('Forbidden: missing email');
  const users = getSheetData_('users');
  const ok = users.some(row =>
    String(row['メールアドレス'] || row['email'] || '')
      .trim().toLowerCase() === email
  );
  if (!ok) throw new Error('Forbidden: not in users sheet');
}

function jsonOk(payload){
  const body = Object.assign({ success: true }, payload || {});
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr_(err){
  const id = Utilities.getUuid().slice(0, 8);
  console.error('[' + id + ']', err && err.stack || err);
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    error: String(err && err.message || err),
    errorId: id
  })).setMimeType(ContentService.MimeType.JSON);
}

function requireSessionId_(raw) {
  const sessionId = String(raw || '').trim();
  if (!sessionId) throw new Error('Missing sessionId');
  return sessionId;
}

function fetchRtdb_(path, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: 'get',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 200) {
    const text = res.getContentText();
    if (!text || text === 'null') return null;
    return JSON.parse(text);
  }
  if (code === 404) return null;
  throw new Error('RTDB fetch failed: HTTP ' + code);
}

function patchRtdb_(updates, token) {
  if (!updates || typeof updates !== 'object') return;
  const res = UrlFetchApp.fetch(rtdbUrl_(''), {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(updates),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('RTDB patch failed: HTTP ' + code + ' ' + res.getContentText());
  }
}

function isDisplayPrincipal_(principal) {
  if (!principal) return false;
  if (principal.isAnonymous === true) return true;
  const email = String(principal.email || '').trim();
  return email === '';
}

function ensureDisplayPrincipal_(principal, message) {
  if (!isDisplayPrincipal_(principal)) {
    throw new Error(message || 'Only anonymous display accounts can perform this action');
  }
  return principal;
}

function beginDisplaySession_(principal) {
  ensureDisplayPrincipal_(principal, 'Only anonymous display accounts can begin sessions');
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const current = fetchRtdb_('render_control/session', token);
  const updates = {};

  if (current && current.sessionId) {
    const currentExpires = Number(current.expiresAt || 0);
    if (current.uid && current.uid !== principal.uid) {
      updates[`screens/approved/${current.uid}`] = null;
      updates[`screens/sessions/${current.uid}`] = Object.assign({}, current, {
        status: currentExpires && currentExpires <= now ? 'expired' : 'superseded',
        endedAt: now,
        expiresAt: now,
        lastSeenAt: Number(current.lastSeenAt || now)
      });
    } else if (current.uid === principal.uid && currentExpires && currentExpires <= now) {
      updates[`screens/sessions/${current.uid}`] = Object.assign({}, current, {
        status: 'expired',
        endedAt: now,
        expiresAt: now,
        lastSeenAt: Number(current.lastSeenAt || now)
      });
    }
  }

  const sessionId = Utilities.getUuid();
  const expiresAt = now + DISPLAY_SESSION_TTL_MS;
  const session = {
    uid: principal.uid,
    sessionId,
    status: 'active',
    startedAt: now,
    lastSeenAt: now,
    expiresAt,
    grantedBy: 'gas'
  };

  updates[`screens/approved/${principal.uid}`] = true;
  updates[`screens/sessions/${principal.uid}`] = session;
  updates['render_control/session'] = session;
  patchRtdb_(updates, token);
  return { session };
}

function heartbeatDisplaySession_(principal, rawSessionId) {
  ensureDisplayPrincipal_(principal, 'Only anonymous display accounts can send heartbeats');
  const sessionId = requireSessionId_(rawSessionId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const current = fetchRtdb_('render_control/session', token);
  if (!current || current.uid !== principal.uid || current.sessionId !== sessionId) {
    if (current && Number(current.expiresAt || 0) <= now) {
      const updates = {};
      updates['render_control/session'] = null;
      if (current.uid) {
        updates[`screens/approved/${current.uid}`] = null;
        updates[`screens/sessions/${current.uid}`] = Object.assign({}, current, {
          status: 'expired',
          endedAt: now,
          expiresAt: now,
          lastSeenAt: Number(current.lastSeenAt || now)
        });
      }
      patchRtdb_(updates, token);
    }
    return { active: false };
  }

  if (Number(current.expiresAt || 0) <= now) {
    const updates = {};
    updates['render_control/session'] = null;
    updates[`screens/approved/${current.uid}`] = null;
    updates[`screens/sessions/${current.uid}`] = Object.assign({}, current, {
      status: 'expired',
      endedAt: now,
      expiresAt: now,
      lastSeenAt: Number(current.lastSeenAt || now)
    });
    patchRtdb_(updates, token);
    return { active: false };
  }

  const session = Object.assign({}, current, {
    status: 'active',
    lastSeenAt: now,
    expiresAt: now + DISPLAY_SESSION_TTL_MS
  });
  const updates = {};
  updates[`screens/approved/${principal.uid}`] = true;
  updates[`screens/sessions/${principal.uid}`] = session;
  updates['render_control/session'] = session;
  patchRtdb_(updates, token);
  return { active: true, session };
}

function endDisplaySession_(principal, rawSessionId, reason) {
  ensureDisplayPrincipal_(principal, 'Only anonymous display accounts can end sessions');
  const sessionId = requireSessionId_(rawSessionId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const current = fetchRtdb_('render_control/session', token);
  if (!current || current.uid !== principal.uid || current.sessionId !== sessionId) {
    return { ended: false };
  }

  const session = Object.assign({}, current, {
    status: 'ended',
    endedAt: now,
    expiresAt: now,
    lastSeenAt: now,
    endedReason: reason || null
  });
  const updates = {};
  updates[`screens/approved/${principal.uid}`] = null;
  updates[`screens/sessions/${principal.uid}`] = session;
  updates['render_control/session'] = null;
  patchRtdb_(updates, token);
  return { ended: true };
}

function updateSelectingStatus(uid) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidColIndex = headers.indexOf('UID');
  const selectingColIndex = headers.indexOf('選択中');

  if (uidColIndex === -1 || selectingColIndex === -1) {
    throw new Error('Column "UID" or "選択中" not found.');
  }

  const numRows = data.length - 1;
  if (numRows > 0) {
    const selectingRange = sheet.getRange(2, selectingColIndex + 1, numRows, 1);
    const cleared = Array.from({ length: numRows }, () => [false]);
    selectingRange.setValues(cleared);
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][uidColIndex] == uid) {
      sheet.getRange(i + 1, selectingColIndex + 1).setValue(true);
      return { success: true, message: `UID: ${uid} is now selecting.` };
    }
  }

  throw new Error(`UID: ${uid} not found.`);
}

function editQuestionText(uid, newText) {
  if (!uid || typeof newText === 'undefined') {
    throw new Error('UID and new text are required.');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidColIndex = headers.indexOf('UID');
  const questionColIndex = headers.indexOf('質問・お悩み');

  if (uidColIndex === -1 || questionColIndex === -1) {
    throw new Error('Column "UID" or "質問・お悩み" not found.');
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][uidColIndex] == uid) {
      sheet.getRange(i + 1, questionColIndex + 1).setValue(newText);
      return { success: true, message: `UID: ${uid} question updated.` };
    }
  }

  throw new Error(`UID: ${uid} not found.`);
}

function updateAnswerStatus(uid, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidColIndex = headers.indexOf('UID');
  const answeredColIndex = headers.indexOf('回答済');

  if (uidColIndex === -1 || answeredColIndex === -1) {
    throw new Error('Column "UID" or "回答済" not found.');
  }

  for (let i = 1; i < data.length; i++) {
    if (data[i][uidColIndex] == uid) {
      const isAnswered = status === true || status === 'true' || status === 1;
      sheet.getRange(i + 1, answeredColIndex + 1).setValue(isAnswered);
      return { success: true, message: `UID: ${uid} updated.` };
    }
  }

  throw new Error(`UID: ${uid} not found.`);
}

function addDictionaryTerm(term, ruby) {
  if (!term || !ruby) {
    throw new Error('Term and ruby are required.');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('dictionary');
  sheet.appendRow([term, ruby, 'default', true]);
  return { success: true, message: `Term "${term}" added.` };
}

function deleteDictionaryTerm(term) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('dictionary');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const lower = headers.map(h => String(h||'').toLowerCase());
  const termColIndex = lower.indexOf('term');

  for (let i = data.length - 1; i > 0; i--) {
    if (data[i][termColIndex] === term) {
      sheet.deleteRow(i + 1);
      return { success: true, message: `Term "${term}" deleted.` };
    }
  }
  throw new Error(`Term "${term}" not found.`);
}

function toggleDictionaryTerm(term, enabled) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('dictionary');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const lower = headers.map(h => String(h||'').toLowerCase());
  const termColIndex = lower.indexOf('term');
  const enabledColIndex = lower.indexOf('enabled');

  for (let i = 1; i < data.length; i++) {
    if (data[i][termColIndex] === term) {
      sheet.getRange(i + 1, enabledColIndex + 1).setValue(enabled);
      return { success: true, message: `Term "${term}" status updated.` };
    }
  }
  throw new Error(`Term "${term}" not found.`);
}

function dailyCheckAndResetUserForm() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    if (month === 5 && day === 1) {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const formUrl = ss.getFormUrl(); 
        
        if (formUrl) {
            const form = FormApp.openByUrl(formUrl);
            form.deleteAllResponses();
            Logger.log("User registration form has been reset.");
        } else {
            const userSheet = ss.getSheetByName('users');
            if(userSheet && userSheet.getLastRow() > 1) {
               userSheet.getRange(2, 1, userSheet.getLastRow() - 1, userSheet.getLastColumn()).clearContent();
               Logger.log("User sheet has been cleared.");
            }
        }
    }
}

function getFirebaseAccessToken_() {
  const properties = PropertiesService.getScriptProperties();
  const CLIENT_EMAIL = properties.getProperty('CLIENT_EMAIL');
  const privateKeyFromProperties = properties.getProperty('PRIVATE_KEY');
  const PRIVATE_KEY = privateKeyFromProperties.replace(/\\n/g, '\n');

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: CLIENT_EMAIL,
    sub: CLIENT_EMAIL,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database"
  };

  const jwtHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const jwtClaimSet = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  const signatureInput = `${jwtHeader}.${jwtClaimSet}`;

  const signature = Utilities.computeRsaSha256Signature(signatureInput, PRIVATE_KEY);
  const encodedSignature = Utilities.base64EncodeWebSafe(signature);

  const signedJwt = `${signatureInput}.${encodedSignature}`;

  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt
    }
  });

  const responseData = JSON.parse(response.getContentText());
  return responseData.access_token;
}

function notifyUpdate(kind) {
  const lock = LockService.getScriptLock();
  if (lock.tryLock(10000)) {
    try {
      const properties = PropertiesService.getScriptProperties();
      const FIREBASE_DB_URL = properties.getProperty('FIREBASE_DB_URL');
      const accessToken = getFirebaseAccessToken_();

      if (kind !== 'logs') {
        mirrorSheetToRtdb_();
      }
      const url = `${FIREBASE_DB_URL}/update_trigger.json`;
      const payload = new Date().getTime();

      const options = {
        method: 'put',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        headers: {
          Authorization: 'Bearer ' + accessToken
        },
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      Logger.log('Firebase notified via OAuth2. Response: ' + response.getContentText());

    } finally {
      lock.releaseLock();
    }
  }
}

function diagnoseSheetConnection() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log(`診断開始：スクリプトは "${ss.getName()}" という名前のスプレッドシートに接続されています。`);
    
    const sheet = ss.getSheetByName('logs');
    if (sheet) {
      Logger.log('成功： "logs" という名前のシートが見つかりました。');
      sheet.getRange("E1").setValue("テスト書き込み成功：" + new Date());
      Browser.msgBox('成功！', '"logs" という名前のシートが見つかり、テスト書き込みを行いました。E1セルを確認してください。', Browser.Buttons.OK);
    } else {
      Logger.log('失敗： "logs" という名前のシートがこのスプレッドシートには見つかりません。');
      const allSheetNames = ss.getSheets().map(s => s.getName());
      Logger.log(`現在認識されているシート名の一覧: [${allSheetNames.join(", ")}]`);
      Browser.msgBox('失敗！', '"logs" という名前のシートが見つかりませんでした。詳細は実行ログを確認してください。', Browser.Buttons.OK);
    }
  } catch (e) {
    Logger.log('致命的なエラーが発生しました: ' + e.toString());
    Browser.msgBox('エラー', '診断中に致命的なエラーが発生しました。実行ログを確認してください。', Browser.Buttons.OK);
  }
}

function batchUpdateStatus(uids, status) {
  if (!uids || !Array.isArray(uids)) {
    throw new Error('UIDs array is required.');
  }
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidColIndex = headers.indexOf('UID');
    const answeredColIndex = headers.indexOf('回答済');

    if (uidColIndex === -1 || answeredColIndex === -1) {
      throw new Error('Column "UID" or "回答済" not found.');
    }

    const uidSet = new Set((uids || []).map(String));
    const isAnswered = status === true || status === 'true' || status === 1;
    for (let i = 1; i < data.length; i++) {
      if (uidSet.has(String(data[i][uidColIndex]))) {
        sheet.getRange(i + 1, answeredColIndex + 1).setValue(isAnswered);
      }
    }

    return { success: true, message: `${uids.length} items updated.` };

  } catch (error) {
    return { success: false, error: error.message };

  }
}

function clearSelectingStatus() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const selectingColIndex = headers.indexOf('選択中');
    if (selectingColIndex === -1) throw new Error('Column "選択中" not found.');

    const numRows = data.length - 1;
    if (numRows <= 0) {
      return { success: true };
    }
    const range = sheet.getRange(2, selectingColIndex + 1, numRows, 1);
    const values = range.getValues();
    let changed = false;
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === true) { values[i][0] = false; changed = true; }
    }
    if (changed) range.setValues(values);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function toIsoJst_(d){ return Utilities.formatDate(d,'Asia/Tokyo',"yyyy-MM-dd'T'HH:mm:ssXXX"); }

function getSheetData_(sheetKey) {
  if (!sheetKey) throw new Error('Missing sheet');

  const ALLOW = {
    answer:     'answer',
    dictionary: 'dictionary',
    users:      'users',
    logs:       'logs',
  };
  const sheetName = ALLOW[String(sheetKey)];
  if (!sheetName) throw new Error('Invalid sheet: ' + sheetKey);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);

  const range = sh.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return [];

  if (sheetKey === 'logs') {
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (!row || row.length === 0 || row.every(v => v === '' || v == null)) continue;
      let ts = row[0];
      if (ts instanceof Date) ts = toIsoJst_(ts);
      out.push({
        Timestamp: ts || '',
        User:      String(row[1] ?? ''),
        Action:    String(row[2] ?? ''),
        Details:   String(row[3] ?? '')
      });
    }
    return out;
  }

  const headers = values[0].map(h =>
    String(h || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
  );
  const out = [];
  for (let r=1; r<values.length; r++){
    const obj = {};
    for (let c=0; c<headers.length; c++){
      const key = headers[c] || ('COL'+(c+1));
      let v = values[r][c];
      if (key.toLowerCase()==='timestamp' && v instanceof Date) v = toIsoJst_(v);
      obj[key] = v;
    }
    out.push(obj);
  }
  return out;
}
