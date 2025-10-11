// WebAppとしてアクセスされたときに実行されるメイン関数
function doGet(e) {
  return withCors_(
    ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'GET not allowed' }))
      .setMimeType(ContentService.MimeType.JSON),
    getRequestOrigin_(e)
  );
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
const ALLOWED_ORIGINS = [
  'https://schop-hirosaki-univcoop.github.io',
  'https://schop-hirosaki-univcoop.github.io/'
];

const QUESTION_SHEET_NAME = 'question';
const PICKUP_QUESTION_SHEET_NAME = 'pick_up_question';
const QUESTION_SHEET_NAMES = [QUESTION_SHEET_NAME, PICKUP_QUESTION_SHEET_NAME];

function normalizeHeaderKey_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function getHeaderIndex_(headerMap, keys) {
  if (!headerMap) return null;
  const list = Array.isArray(keys) ? keys : [keys];
  for (let i = 0; i < list.length; i++) {
    const key = normalizeHeaderKey_(list[i]);
    if (headerMap.has(key)) {
      return headerMap.get(key);
    }
  }
  return null;
}

function readSheetWithHeaders_(sheet) {
  if (!sheet) {
    return { sheet: null, headers: [], headerMap: new Map(), rows: [] };
  }
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return { sheet, headers: [], headerMap: new Map(), rows: [] };
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = (values.shift() || []).map(value => value);
  const headerMap = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeaderKey_(header);
    if (!key) return;
    if (!headerMap.has(key)) {
      headerMap.set(key, index);
    }
  });
  return { sheet, headers, headerMap, rows: values };
}

function parseSpreadsheetTimestamp_(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.getTime();
  }
  if (typeof value === 'number' && !isNaN(value)) {
    if (value > 1e12) return value;
    if (value > 1e10) return value * 1000;
    if (value > 20000 && value < 70000) {
      return Math.round((value - 25569) * 86400 * 1000);
    }
    if (value > 1e6) return value * 1000;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      const parsed = new Date(trimmed.replace(' ', 'T'));
      if (!isNaN(parsed)) {
        return parsed.getTime();
      }
    }
  }
  return 0;
}

function parseDateCell_(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number' && !isNaN(value)) {
    if (value > 1e12) return new Date(value);
    if (value > 1e10) return new Date(value * 1000);
    if (value > 20000 && value < 70000) {
      return new Date(Math.round((value - 25569) * 86400 * 1000));
    }
    if (value > 1e6) return new Date(value * 1000);
    if (value > 0) return new Date(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed.replace(' ', 'T'));
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function formatDateLabel_(value) {
  const date = parseDateCell_(value);
  if (date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  }
  return String(value || '').trim();
}

function toIsoStringOrValue_(value) {
  const date = parseDateCell_(value);
  if (date) {
    return toIsoJst_(date);
  }
  return String(value || '').trim();
}

function formatScheduleLabel_(startValue, endValue) {
  const startLabel = formatDateLabel_(startValue);
  const endLabel = formatDateLabel_(endValue);
  if (startLabel && endLabel) {
    if (startLabel === endLabel) {
      return startLabel;
    }
    return `${startLabel}〜${endLabel}`;
  }
  return startLabel || endLabel || '';
}

function toBooleanCell_(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
  }
  return false;
}

function formatQuestionTimestamp_(value) {
  const date = parseDateCell_(value) || new Date();
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}

function findQuestionRowByUid_(uid) {
  const targetUid = String(uid || '').trim();
  if (!targetUid) {
    return null;
  }
  ensureQuestionUids_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (let i = 0; i < QUESTION_SHEET_NAMES.length; i++) {
    const sheetName = QUESTION_SHEET_NAMES[i];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const info = readSheetWithHeaders_(sheet);
    const uidIdx = getHeaderIndex_(info.headerMap, 'UID');
    if (uidIdx == null) continue;
    for (let rowIndex = 0; rowIndex < info.rows.length; rowIndex++) {
      const row = info.rows[rowIndex];
      if (String(row[uidIdx] || '').trim() === targetUid) {
        return {
          sheet,
          rowNumber: rowIndex + 2,
          headerMap: info.headerMap,
          headers: info.headers
        };
      }
    }
  }
  return null;
}

function ensureQuestionSheetUids_(sheet) {
  if (!sheet) {
    return 0;
  }
  const info = readSheetWithHeaders_(sheet);
  if (!info.sheet || !info.rows.length) {
    return 0;
  }
  const uidIdx = getHeaderIndex_(info.headerMap, 'UID');
  if (uidIdx == null) {
    return 0;
  }

  const seen = new Set();
  const updates = [];
  info.rows.forEach((row, rowIndex) => {
    const current = String(row[uidIdx] || '').trim();
    if (current && !seen.has(current)) {
      seen.add(current);
      return;
    }
    let nextUid = '';
    do {
      nextUid = Utilities.getUuid();
    } while (seen.has(nextUid));
    seen.add(nextUid);
    updates.push({ rowIndex, value: nextUid });
  });

  if (!updates.length) {
    return 0;
  }

  updates.forEach(update => {
    sheet.getRange(update.rowIndex + 2, uidIdx + 1).setValue(update.value);
  });

  return updates.length;
}

function ensureQuestionUids_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let updated = 0;
  QUESTION_SHEET_NAMES.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    updated += ensureQuestionSheetUids_(sheet);
  });
  return updated;
}

function mirrorQuestionsFromRtdbToSheet_(providedAccessToken) {
  const accessToken = providedAccessToken || getFirebaseAccessToken_();
  const questionsBranch = fetchRtdb_('questions', accessToken) || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const ensureString = value => {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    return String(value).trim();
  };

  const sheetDataMap = new Map();
  const initSheetData = (type) => {
    if (sheetDataMap.has(type)) {
      return sheetDataMap.get(type);
    }
    const sheetName = type === 'pickup' ? PICKUP_QUESTION_SHEET_NAME : QUESTION_SHEET_NAME;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheetDataMap.set(type, null);
      return null;
    }
    const info = readSheetWithHeaders_(sheet);
    if (!info.sheet || !info.headers || !info.headers.length) {
      sheetDataMap.set(type, null);
      return null;
    }
    const uidIdx = getHeaderIndex_(info.headerMap, ['uid', 'UID']);
    if (uidIdx == null) {
      sheetDataMap.set(type, null);
      return null;
    }
    const existingByUid = new Map();
    info.rows.forEach((row, index) => {
      const uid = String(row[uidIdx] || '').trim();
      if (uid && !existingByUid.has(uid)) {
        existingByUid.set(uid, { rowNumber: index + 2, values: row });
      }
    });
    const data = {
      sheet,
      info,
      uidIdx,
      existingByUid,
      updates: [],
      appends: []
    };
    sheetDataMap.set(type, data);
    return data;
  };

  const valuesEqual = (a, b) => {
    if (a === b) return true;
    const aDate = a instanceof Date ? a : null;
    const bDate = b instanceof Date ? b : null;
    if (aDate || bDate) {
      const aTime = aDate ? aDate.getTime() : parseDateToMillis_(a, NaN);
      const bTime = bDate ? bDate.getTime() : parseDateToMillis_(b, NaN);
      if (!isNaN(aTime) && !isNaN(bTime)) {
        return aTime === bTime;
      }
    }
    if (typeof a === 'number' || typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return Number(a) === Number(b);
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return Boolean(a) === Boolean(b);
    }
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
  };

  const results = {
    total: 0,
    updated: 0,
    appended: 0,
    pickupUpdated: 0,
    pickupAppended: 0
  };

  Object.keys(questionsBranch || {}).forEach(uidKey => {
    const record = questionsBranch[uidKey];
    if (!record || typeof record !== 'object') {
      return;
    }
    const resolvedUid = ensureString(record.uid || uidKey);
    if (!resolvedUid) {
      return;
    }
    const isPickup = record.type === 'pickup' || record.pickup === true;
    const data = initSheetData(isPickup ? 'pickup' : 'normal');
    if (!data) {
      return;
    }

    const existing = data.existingByUid.get(resolvedUid);
    const currentRow = existing ? existing.values : null;
    const columnCount = data.info.headers.length;
    const nextRow = currentRow ? currentRow.slice() : Array(columnCount).fill('');
    const touched = new Set();

    const setValue = (headerKeys, value) => {
      const list = Array.isArray(headerKeys) ? headerKeys : [headerKeys];
      list.forEach(headerKey => {
        const idx = getHeaderIndex_(data.info.headerMap, headerKey);
        if (idx == null) return;
        nextRow[idx] = value;
        touched.add(idx);
      });
    };

    const tsValue = Number(record.ts || record.timestamp || 0);
    const tsDate = Number.isFinite(tsValue) && tsValue > 0 ? new Date(tsValue) : null;
    const timestampLabel = formatQuestionTimestamp_(tsDate || new Date());
    setValue(['タイムスタンプ', 'Timestamp'], timestampLabel);
    if (tsValue) {
      setValue('__ts', tsValue);
    }

    setValue('ラジオネーム', ensureString(record.name));
    setValue('質問・お悩み', ensureString(record.question));

    const groupValue = ensureString(record.group);
    setValue('班番号', groupValue);

    const genreValue = ensureString(record.genre) || 'その他';
    setValue('ジャンル', genreValue);
    if (record.genre != null) {
      setValue('ジャンル(送信時)', ensureString(record.genre));
    }

    const scheduleStartMs = parseDateToMillis_(record.scheduleStart, 0);
    const scheduleEndMs = parseDateToMillis_(record.scheduleEnd, 0);
    const scheduleStartValue = scheduleStartMs ? new Date(scheduleStartMs) : ensureString(record.scheduleStart);
    const scheduleEndValue = scheduleEndMs ? new Date(scheduleEndMs) : ensureString(record.scheduleEnd);
    setValue(['日程開始', '開始日時'], scheduleStartValue || '');
    setValue(['日程終了', '終了日時'], scheduleEndValue || '');

    const scheduleLabel = ensureString(record.schedule) || formatScheduleLabel_(scheduleStartValue, scheduleEndValue);
    setValue(['日程', '日程表示'], scheduleLabel);
    setValue('日程日付', ensureString(record.scheduleDate));

    setValue('イベントID', ensureString(record.eventId));
    setValue('日程ID', ensureString(record.scheduleId));
    setValue('参加者ID', ensureString(record.participantId));
    if (record.participantName != null) {
      const participantName = ensureString(record.participantName);
      setValue(['参加者名', '氏名'], participantName);
    }
    if (record.eventName != null) {
      setValue('イベント名', ensureString(record.eventName));
    }

    const tokenValue = ensureString(record.token);
    setValue(['リンクトークン', 'Token'], tokenValue);

    if (record.guidance != null) {
      setValue(['ガイダンス', '案内文'], ensureString(record.guidance));
    }

    const questionLength = Number(record.questionLength);
    setValue('質問文字数', Number.isFinite(questionLength) && questionLength > 0 ? questionLength : '');

    setValue(['uid', 'UID'], resolvedUid);
    setValue('回答済', record.answered === true);
    setValue('選択中', record.selecting === true);

    if (record.language != null) {
      setValue('言語', ensureString(record.language));
    }
    if (record.origin != null) {
      setValue('起点', ensureString(record.origin));
    }
    if (record.formVersion != null) {
      setValue('フォームバージョン', ensureString(record.formVersion));
    }
    const updatedAtMs = Number(record.updatedAt);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
      setValue('更新日時', new Date(updatedAtMs));
    }
    setValue('タイプ', ensureString(record.type));
    if (isPickup) {
      setValue('ピックアップ', true);
    } else {
      setValue('ピックアップ', false);
    }

    const touchedIndexes = Array.from(touched);
    let rowChanged = !currentRow;
    if (currentRow) {
      rowChanged = touchedIndexes.some(idx => !valuesEqual(currentRow[idx], nextRow[idx]));
    }

    results.total += 1;
    if (!rowChanged) {
      return;
    }

    if (currentRow) {
      data.updates.push({ rowNumber: existing.rowNumber, values: nextRow });
      if (isPickup) {
        results.pickupUpdated += 1;
      } else {
        results.updated += 1;
      }
    } else {
      data.appends.push(nextRow);
      if (isPickup) {
        results.pickupAppended += 1;
      } else {
        results.appended += 1;
      }
    }
  });

  sheetDataMap.forEach(data => {
    if (!data) return;
    const columnCount = data.info.headers.length;
    data.updates.forEach(entry => {
      data.sheet.getRange(entry.rowNumber, 1, 1, columnCount).setValues([entry.values]);
    });
    if (data.appends.length) {
      const startRow = data.sheet.getLastRow() + 1;
      const requiredRows = startRow + data.appends.length - 1;
      if (data.sheet.getMaxRows() < requiredRows) {
        data.sheet.insertRowsAfter(data.sheet.getMaxRows(), requiredRows - data.sheet.getMaxRows());
      }
      data.sheet.getRange(startRow, 1, data.appends.length, columnCount).setValues(data.appends);
    }
  });

  return results;
}

// WebAppにPOSTリクエストが送られたときに実行される関数
function doPost(e) {
  let requestOrigin = getRequestOrigin_(e);
  try {
    const req = parseBody_(e);
    requestOrigin = getRequestOrigin_(e, req) || requestOrigin;
    const { action, idToken } = req;
    if (!action) throw new Error('Missing action');

    const displayActions = new Set(['beginDisplaySession', 'heartbeatDisplaySession', 'endDisplaySession']);
    const noAuthActions = new Set(['submitQuestion', 'fetchNameMappings', 'fetchQuestionContext', 'processQuestionQueueForToken']);
    let principal = null;
    if (!noAuthActions.has(action)) {
      principal = requireAuth_(idToken, displayActions.has(action) ? { allowAnonymous: true } : {});
    }

    const ok = (payload) => jsonOk(payload, requestOrigin);

    switch (action) {
      case 'beginDisplaySession':
        return ok(beginDisplaySession_(principal));
      case 'heartbeatDisplaySession':
        return ok(heartbeatDisplaySession_(principal, req.sessionId));
      case 'endDisplaySession':
        return ok(endDisplaySession_(principal, req.sessionId, req.reason));
      case 'ensureAdmin':
        return ok(ensureAdmin_(principal));
      case 'submitQuestion':
        return ok(submitQuestion_(req));
      case 'fetchNameMappings':
        return ok({ mappings: fetchNameMappings_() });
      case 'fetchQuestionContext':
        return ok({ context: fetchQuestionContext_(req) });
      case 'saveNameMappings':
        assertOperator_(principal);
        return ok(saveNameMappings_(req.entries));
      case 'mirrorSheet':
        assertOperator_(principal);
        return ok(mirrorSheetToRtdb_());
      case 'mirrorQuestionIntake':
        assertOperator_(principal);
        return ok(mirrorQuestionIntake_());
      case 'syncQuestionIntakeToSheet':
        assertOperator_(principal);
        return ok(syncQuestionIntakeToSheet_());
      case 'processQuestionQueue':
        assertOperator_(principal);
        return ok(processQuestionSubmissionQueue_());
      case 'processQuestionQueueForToken':
        return ok(processQuestionQueueForToken_(req.token));
      case 'fetchSheet':
        assertOperator_(principal);
        return ok({ data: getSheetData_(req.sheet) });
      case 'listQuestionEvents':
        assertOperator_(principal);
        return ok({ events: listQuestionEvents_() });
      case 'createQuestionEvent':
        assertOperator_(principal);
        return ok({ event: createQuestionEvent_(req.name) });
      case 'deleteQuestionEvent':
        assertOperator_(principal);
        return ok(deleteQuestionEvent_(req.eventId));
      case 'createQuestionSchedule':
        assertOperator_(principal);
        return ok({
          schedule: createQuestionSchedule_(req.eventId, req.label, req.date, req.startAt, req.endAt)
        });
      case 'deleteQuestionSchedule':
        assertOperator_(principal);
        return ok(deleteQuestionSchedule_(req.eventId, req.scheduleId));
      case 'fetchQuestionParticipants':
        assertOperator_(principal);
        return ok({ participants: fetchQuestionParticipants_(req.eventId, req.scheduleId) });
      case 'saveQuestionParticipants':
        assertOperator_(principal);
        return ok(saveQuestionParticipants_(req.eventId, req.scheduleId, req.entries));
      case 'addTerm':
        assertOperator_(principal);
        return ok(addDictionaryTerm(req.term, req.ruby));
      case 'deleteTerm':
        assertOperator_(principal);
        return ok(deleteDictionaryTerm(req.term));
      case 'toggleTerm':
        assertOperator_(principal);
        return ok(toggleDictionaryTerm(req.term, req.enabled));
      case 'updateStatus':
        assertOperator_(principal);
        return ok(updateAnswerStatus(req.uid, req.status));
      case 'editQuestion':
        assertOperator_(principal);
        return ok(editQuestionText(req.uid, req.text));
      case 'batchUpdateStatus':
        assertOperator_(principal);
        return ok(batchUpdateStatus(req.uids, req.status, principal));
      case 'updateSelectingStatus':
        assertOperator_(principal);
        return ok(updateSelectingStatus(req.uid, principal));
      case 'clearSelectingStatus':
        assertOperator_(principal);
        return ok(clearSelectingStatus(principal));
      case 'logAction':
        assertOperator_(principal);
        return ok(logAction_(principal, req.action_type, req.details));
      case 'whoami':
        return ok({ principal });
      default:
        throw new Error('Unknown action: ' + action);
    }
  } catch (err) {
    return jsonErr_(err, requestOrigin);
  }
}

function doOptions(e) {
  const origin = getRequestOrigin_(e);
  const empty = ContentService.createTextOutput('');
  return withCors_(empty, origin);
}

function submitQuestion_(payload) {
  const radioName = String(payload.radioName || payload.name || '').trim();
  const questionText = String(payload.question || payload.text || '').trim();
  const payloadGroupNumber = String(payload.groupNumber || payload.group || '').trim();
  const payloadTeamNumber = String(payload.teamNumber || payload.team || '').trim();
  const rawGenre = String(payload.genre || '').trim();
  const payloadScheduleLabel = String(payload.schedule || payload.date || '').trim();
  const payloadScheduleStart = String(payload.scheduleStart || '').trim();
  const payloadScheduleEnd = String(payload.scheduleEnd || '').trim();
  const payloadEventId = String(payload.eventId || '').trim();
  const payloadEventName = String(payload.eventName || '').trim();
  const payloadScheduleId = String(payload.scheduleId || '').trim();
  const payloadParticipantId = String(payload.participantId || '').trim();
  const payloadScheduleDate = String(payload.scheduleDate || '').trim();
  const rawToken = String(payload.token || '').trim();
  const payloadQuestionLength = Number(payload.questionLength || 0);

  if (!radioName) throw new Error('ラジオネームを入力してください。');
  if (!questionText) throw new Error('質問・お悩みを入力してください。');
  if (!rawToken) {
    throw new Error('アクセス情報を確認できませんでした。配布されたリンクから再度アクセスしてください。');
  }
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(rawToken)) {
    throw new Error('アクセスリンクが無効です。最新のURLからアクセスしてください。');
  }

  let accessToken;
  try {
    accessToken = getFirebaseAccessToken_();
  } catch (error) {
    throw new Error('アクセスリンクの検証に失敗しました。時間をおいて再試行してください。');
  }

  let tokenRecord = null;
  try {
    tokenRecord = fetchRtdb_('questionIntake/tokens/' + rawToken, accessToken);
  } catch (error) {
    throw new Error('アクセスリンクの検証に失敗しました。時間をおいて再試行してください。');
  }

  if (!tokenRecord) {
    throw new Error('このリンクは無効化されています。運営までお問い合わせください。');
  }
  if (tokenRecord.revoked) {
    throw new Error('このリンクは無効化されています。運営までお問い合わせください。');
  }
  const expiresAt = Number(tokenRecord.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    throw new Error('このリンクの有効期限が切れています。運営までお問い合わせください。');
  }

  const tokenEventId = String(tokenRecord.eventId || '').trim();
  const tokenScheduleId = String(tokenRecord.scheduleId || '').trim();
  const tokenParticipantId = String(tokenRecord.participantId || '').trim();
  if (!tokenEventId || !tokenScheduleId || !tokenParticipantId) {
    throw new Error('リンクに紐づくイベント情報が確認できません。運営までお問い合わせください。');
  }

  if (payloadEventId && payloadEventId !== tokenEventId) {
    throw new Error('送信されたイベント情報が一致しません。リンクを再度開き直してください。');
  }
  if (payloadScheduleId && payloadScheduleId !== tokenScheduleId) {
    throw new Error('送信された日程情報が一致しません。リンクを再度開き直してください。');
  }
  if (payloadParticipantId && payloadParticipantId !== tokenParticipantId) {
    throw new Error('送信された参加者情報が一致しません。リンクを再度開き直してください。');
  }

  const eventId = tokenEventId;
  const scheduleId = tokenScheduleId;
  const participantId = tokenParticipantId;
  const eventName = String(tokenRecord.eventName || payloadEventName || '').trim();
  const scheduleLabel = String(tokenRecord.scheduleLabel || payloadScheduleLabel || '').trim();
  const scheduleDate = String(tokenRecord.scheduleDate || payloadScheduleDate || '').trim();
  const scheduleStartRaw = String(tokenRecord.scheduleStart || payloadScheduleStart || '').trim();
  const scheduleEndRaw = String(tokenRecord.scheduleEnd || payloadScheduleEnd || '').trim();
  const participantName = String(tokenRecord.displayName || '').trim();
  const guidance = String(tokenRecord.guidance || payload.guidance || '').trim();
  const groupNumber = String(tokenRecord.teamNumber || tokenRecord.groupNumber || payloadTeamNumber || payloadGroupNumber || '').trim();

  const now = Date.now();
  const questionLength = Number.isFinite(payloadQuestionLength) && payloadQuestionLength > 0
    ? Math.floor(payloadQuestionLength)
    : String(questionText).length;
  const clientTimestampRaw = Number(payload.clientTimestamp || 0);
  const clientTimestamp = Number.isFinite(clientTimestampRaw) && clientTimestampRaw > 0
    ? clientTimestampRaw
    : now;
  const submissionBase = {
    token: rawToken,
    radioName,
    question: questionText,
    questionLength,
    genre: rawGenre || 'その他',
    groupNumber,
    teamNumber: groupNumber,
    scheduleLabel,
    scheduleDate,
    scheduleStart: scheduleStartRaw,
    scheduleEnd: scheduleEndRaw,
    eventId,
    eventName,
    scheduleId,
    participantId,
    participantName,
    guidance,
    clientTimestamp,
    language: String(payload.language || '').trim(),
    userAgent: String(payload.userAgent || '').trim(),
    referrer: String(payload.referrer || '').trim(),
    formVersion: String(payload.formVersion || '').trim(),
    origin: sanitizeOrigin_(payload.origin || payload.requestOrigin || ''),
    status: 'pending'
  };

  const submission = {};
  Object.keys(submissionBase).forEach(key => {
    const value = submissionBase[key];
    if (value == null || value === '') {
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        submission[key] = trimmed;
      }
      return;
    }
    submission[key] = value;
  });

  submission.submittedAt = now;

  const entryId = Utilities.getUuid().replace(/-/g, '');
  const updates = {};
  updates[`questionIntake/submissions/${rawToken}/${entryId}`] = submission;

  try {
    patchRtdb_(updates, accessToken);
  } catch (error) {
    console.warn('Failed to queue question submission', error);
    throw new Error('質問の登録に失敗しました。時間をおいて再試行してください。');
  }

  return { queued: true, entryId, submittedAt: toIsoJst_(new Date(now)) };
}

function processQuestionQueueForToken_(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new Error('アクセスリンクが無効です。最新のURLからアクセスしてください。');
  }
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(token)) {
    throw new Error('アクセスリンクが無効です。最新のURLからアクセスしてください。');
  }

  const accessToken = getFirebaseAccessToken_();
  let tokenRecord = null;
  try {
    tokenRecord = fetchRtdb_('questionIntake/tokens/' + token, accessToken);
  } catch (error) {
    throw new Error('アクセスリンクの検証に失敗しました。時間をおいて再試行してください。');
  }

  if (!tokenRecord || tokenRecord.revoked) {
    throw new Error('このリンクは無効化されています。運営までお問い合わせください。');
  }
  const expiresAt = Number(tokenRecord.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    throw new Error('このリンクの有効期限が切れています。運営までお問い合わせください。');
  }

  const result = processQuestionSubmissionQueue_(accessToken, { tokenFilter: [token] }) || {};
  return {
    processed: Number(result.processed || 0),
    discarded: Number(result.discarded || 0)
  };
}

function processQuestionSubmissionQueue_(providedAccessToken, options) {
  const accessToken = providedAccessToken || getFirebaseAccessToken_();
  const queueBranch = fetchRtdb_('questionIntake/submissions', accessToken) || {};
  const opts = options || {};
  let tokenFilter = null;
  if (opts && opts.tokenFilter != null) {
    const list = Array.isArray(opts.tokenFilter) ? opts.tokenFilter : [opts.tokenFilter];
    tokenFilter = new Set(
      list
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );
  }

  let queueTokens = Object.keys(queueBranch || {});
  queueTokens = queueTokens
    .map(token => String(token || '').trim())
    .filter(token => {
      if (!token) return false;
      if (tokenFilter && !tokenFilter.has(token)) {
        return false;
      }
      return true;
    });

  if (!queueTokens.length) {
    return { processed: 0, discarded: 0 };
  }

  const tokenRecords = fetchRtdb_('questionIntake/tokens', accessToken) || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(QUESTION_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${QUESTION_SHEET_NAME}" not found.`);

  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('question sheet has no headers.');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const headerMap = new Map();
  headers.forEach((header, index) => {
    if (header == null) return;
    headerMap.set(norm(header), index);
  });

  const rowsToAppend = [];
  const updates = {};
  const processedAt = Date.now();
  const questionUpdates = {};
  let processed = 0;
  let discarded = 0;

  const ensureString = value => String(value || '').trim();
  const nowIso = () => new Date().toISOString();

  queueTokens.forEach(token => {
    const submissions = queueBranch[token] && typeof queueBranch[token] === 'object'
      ? queueBranch[token]
      : {};
    const tokenRecord = tokenRecords[token] || {};
    const revoked = tokenRecord && tokenRecord.revoked === true;
    const expiresAt = Number(tokenRecord && tokenRecord.expiresAt || 0);
    const eventId = ensureString(tokenRecord && tokenRecord.eventId);
    const scheduleId = ensureString(tokenRecord && tokenRecord.scheduleId);
    const participantId = ensureString(tokenRecord && tokenRecord.participantId);

    Object.keys(submissions).forEach(entryId => {
      const submissionPath = `questionIntake/submissions/${token}/${entryId}`;
      const entry = submissions[entryId] && typeof submissions[entryId] === 'object'
        ? submissions[entryId]
        : null;

      if (!entry) {
        updates[submissionPath] = null;
        discarded += 1;
        return;
      }

      if (!tokenRecord || !eventId || !scheduleId || !participantId || revoked || (expiresAt && Date.now() > expiresAt)) {
        updates[submissionPath] = null;
        discarded += 1;
        return;
      }

      try {
        const radioName = ensureString(entry.radioName);
        const questionText = ensureString(entry.question);
        if (!radioName) throw new Error('ラジオネームが空です。');
        if (!questionText) throw new Error('質問内容が空です。');

        const questionLength = Number(entry.questionLength);
        if (!Number.isFinite(questionLength) || questionLength <= 0) {
          throw new Error('質問文字数が不正です。');
        }

        const genreValue = ensureString(entry.genre) || 'その他';
        const groupNumber = ensureString(entry.groupNumber || tokenRecord.teamNumber || tokenRecord.groupNumber);
        const scheduleLabel = ensureString(entry.scheduleLabel || tokenRecord.scheduleLabel);
        const scheduleDate = ensureString(entry.scheduleDate || tokenRecord.scheduleDate);
        const scheduleStart = ensureString(entry.scheduleStart || tokenRecord.scheduleStart);
        const scheduleEnd = ensureString(entry.scheduleEnd || tokenRecord.scheduleEnd);
        const eventName = ensureString(entry.eventName || tokenRecord.eventName);
        const participantName = ensureString(entry.participantName || tokenRecord.displayName);
        const guidance = ensureString(entry.guidance || tokenRecord.guidance);

        const timestampMs = Number(entry.submittedAt || entry.clientTimestamp || Date.now());
        const timestamp = Number.isFinite(timestampMs) && timestampMs > 0 ? new Date(timestampMs) : new Date();
        const timestampLabel = formatQuestionTimestamp_(timestamp);
        const providedUid = ensureString(entry.uid) || ensureString(entryId);
        const uid = providedUid || Utilities.getUuid();

        const newRow = Array.from({ length: headers.length }, () => '');
        const setValue = (headerKey, value) => {
          const idx = headerMap.get(norm(headerKey));
          if (idx == null || idx < 0) return;
          newRow[idx] = value;
        };

        setValue('タイムスタンプ', timestampLabel);
        setValue('Timestamp', timestampLabel);
        setValue('ラジオネーム', radioName);
        setValue('質問・お悩み', questionText);
        if (groupNumber) setValue('班番号', groupNumber);
        setValue('ジャンル', genreValue);
        if (scheduleLabel) {
          setValue('日程', scheduleLabel);
          setValue('日程表示', scheduleLabel);
        }
        if (scheduleDate) setValue('日程日付', scheduleDate);
        const scheduleStartMs = parseDateToMillis_(scheduleStart, 0);
        const scheduleEndMs = parseDateToMillis_(scheduleEnd, 0);
        const scheduleStartValue = scheduleStartMs ? new Date(scheduleStartMs) : (scheduleStart || '');
        const scheduleEndValue = scheduleEndMs ? new Date(scheduleEndMs) : (scheduleEnd || '');
        const scheduleStartIso = scheduleStartValue ? toIsoStringOrValue_(scheduleStartValue) : '';
        const scheduleEndIso = scheduleEndValue ? toIsoStringOrValue_(scheduleEndValue) : '';
        if (scheduleStartValue) {
          setValue('日程開始', scheduleStartValue);
          setValue('開始日時', scheduleStartValue);
        }
        if (scheduleEndValue) {
          setValue('日程終了', scheduleEndValue);
          setValue('終了日時', scheduleEndValue);
        }
        setValue('イベントID', eventId);
        if (eventName) setValue('イベント名', eventName);
        setValue('日程ID', scheduleId);
        setValue('参加者ID', participantId);
        if (participantName) {
          setValue('参加者名', participantName);
          setValue('氏名', participantName);
        }
        setValue('リンクトークン', token);
        setValue('Token', token);
        if (guidance) {
          setValue('ガイダンス', guidance);
          setValue('案内文', guidance);
        }
        setValue('uid', uid);
        setValue('UID', uid);
        setValue('回答済', false);
        setValue('選択中', false);
        if (ensureString(entry.genre)) {
          setValue('ジャンル(送信時)', ensureString(entry.genre));
        }
        setValue('質問文字数', questionLength);

        rowsToAppend.push(newRow);
        const questionPayload = {
          uid,
          token,
          name: radioName,
          question: questionText,
          group: groupNumber,
          genre: genreValue,
          schedule: scheduleLabel,
          scheduleStart: scheduleStartIso,
          scheduleEnd: scheduleEndIso,
          participantId,
          eventId,
          scheduleId,
          ts: timestamp.getTime(),
          answered: false,
          selecting: false,
          updatedAt: processedAt,
          type: 'normal'
        };
        if (Number.isFinite(questionLength) && questionLength > 0) {
          questionPayload.questionLength = questionLength;
        }
        questionUpdates[`questions/${uid}`] = questionPayload;
        updates[submissionPath] = null;
        processed += 1;
      } catch (err) {
        console.warn('Failed to process queued submission', token, entryId, err);
        updates[submissionPath] = null;
        const errorPath = `questionIntake/submissionErrors/${token}/${entryId}`;
        updates[errorPath] = {
          error: String(err && err.message || err),
          failedAt: nowIso(),
          payload: entry
        };
        discarded += 1;
      }
    });
  });

  if (Object.keys(questionUpdates).length) {
    try {
      patchRtdb_(questionUpdates, accessToken);
    } catch (err) {
      console.warn('Failed to patch RTDB questions during queue processing', err);
    }
  }

  if (rowsToAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
  }

  if (Object.keys(updates).length) {
    patchRtdb_(updates, accessToken);
  }

  if (rowsToAppend.length) {
    try {
      notifyUpdate('question');
    } catch (e) {
      console.warn('notifyUpdate failed after processQuestionSubmissionQueue_', e);
    }
  }

  return { processed, discarded };
}

function cleanupUnusedQuestionTokens_(participantsBranch, tokensBranch, accessToken) {
  const participantKeys = new Set();
  const activeTokens = new Set();

  Object.keys(participantsBranch || {}).forEach(eventId => {
    const schedules = participantsBranch[eventId] || {};
    Object.keys(schedules).forEach(scheduleId => {
      const entries = schedules[scheduleId] || {};
      Object.keys(entries).forEach(participantId => {
        const entry = entries[participantId] || {};
        const token = String(entry.token || '').trim();
        if (token) {
          activeTokens.add(token);
        }
        const key = `${eventId || ''}::${scheduleId || ''}::${participantId || ''}`;
        participantKeys.add(key);
      });
    });
  });

  Object.keys(tokensBranch || {}).forEach(token => {
    const trimmed = String(token || '').trim();
    if (!trimmed) {
      return;
    }
    const record = tokensBranch[token] || {};
    const key = `${record.eventId || ''}::${record.scheduleId || ''}::${record.participantId || ''}`;
    if (participantKeys.has(key)) {
      activeTokens.add(trimmed);
    }
  });

  const updates = {};
  let removed = 0;
  Object.keys(tokensBranch || {}).forEach(token => {
    const trimmed = String(token || '').trim();
    if (!trimmed) {
      return;
    }
    if (activeTokens.has(trimmed)) {
      return;
    }
    updates[`questionIntake/tokens/${trimmed}`] = null;
    removed += 1;
  });

  if (removed > 0 && accessToken) {
    try {
      patchRtdb_(updates, accessToken);
    } catch (error) {
      console.warn('cleanupUnusedQuestionTokens_ failed to patch RTDB', error);
      throw error;
    }
  }

  return { removed };
}

function applyParticipantGroupsToQuestionSheet_(participantsBranch, questionsBranch) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = QUESTION_SHEET_NAMES
    .map(name => ss.getSheetByName(name))
    .filter(Boolean);

  if (!sheets.length) {
    return { updated: 0, questionUpdates: 0 };
  }

  const groupByParticipant = new Map();
  const groupByToken = new Map();
  Object.keys(participantsBranch || {}).forEach(eventId => {
    const schedules = participantsBranch[eventId] || {};
    Object.keys(schedules).forEach(scheduleId => {
      const entries = schedules[scheduleId] || {};
      Object.keys(entries).forEach(participantId => {
        const entry = entries[participantId] || {};
        const groupNumber = String(entry.teamNumber || entry.groupNumber || '').trim();
        const participantKey = String(participantId || '').trim();
        const token = String(entry.token || '').trim();
        if (participantKey) {
          groupByParticipant.set(participantKey, groupNumber);
        }
        if (token) {
          groupByToken.set(token, groupNumber);
        }
      });
    });
  });

  if (!groupByParticipant.size && !groupByToken.size) {
    return { updated: 0, questionUpdates: 0 };
  }

  const sheetUpdates = [];
  const uidUpdateMap = new Map();

  sheets.forEach(sheet => {
    const info = readSheetWithHeaders_(sheet);
    if (!info.sheet || !info.headers || !info.headers.length || !info.rows) {
      return;
    }

    const groupIdx = getHeaderIndex_(info.headerMap, ['班番号']);
    if (groupIdx == null) {
      return;
    }

    const participantIdx = getHeaderIndex_(info.headerMap, ['参加者ID', 'participantid', 'participant_id']);
    const tokenIdx = getHeaderIndex_(info.headerMap, ['リンクトークン', 'token']);
    const uidIdx = getHeaderIndex_(info.headerMap, ['uid', 'UID']);
    if ((participantIdx == null && tokenIdx == null) || uidIdx == null) {
      return;
    }

    info.rows.forEach((row, index) => {
      let desired = null;
      if (participantIdx != null) {
        const participantId = String(row[participantIdx] || '').trim();
        if (participantId && groupByParticipant.has(participantId)) {
          desired = groupByParticipant.get(participantId) || '';
        }
      }
      if (desired === null && tokenIdx != null) {
        const token = String(row[tokenIdx] || '').trim();
        if (token && groupByToken.has(token)) {
          desired = groupByToken.get(token) || '';
        }
      }
      if (desired === null) {
        return;
      }

      const current = String(row[groupIdx] || '').trim();
      const normalizedDesired = String(desired || '').trim();
      if (current === normalizedDesired) {
        return;
      }

      const uid = String(row[uidIdx] || '').trim();
      if (!uid) {
        return;
      }

      sheetUpdates.push({ sheet, rowNumber: index + 2, column: groupIdx + 1, value: normalizedDesired, uid });
      uidUpdateMap.set(uid, normalizedDesired);
    });
  });

  const pendingQuestionUpdates = new Map();
  if (questionsBranch && typeof questionsBranch === 'object') {
    Object.keys(questionsBranch).forEach(uid => {
      const question = questionsBranch[uid] || {};
      const participantId = String(question.participantId || '').trim();
      const token = String(question.token || '').trim();
      let desired = null;
      if (participantId && groupByParticipant.has(participantId)) {
        desired = groupByParticipant.get(participantId) || '';
      }
      if (desired === null && token && groupByToken.has(token)) {
        desired = groupByToken.get(token) || '';
      }
      if (desired === null) {
        return;
      }

      const current = String(question.group || '').trim();
      const normalizedDesired = String(desired || '').trim();
      if (current === normalizedDesired) {
        return;
      }

      pendingQuestionUpdates.set(uid, normalizedDesired);
    });
  }

  pendingQuestionUpdates.forEach((value, uid) => {
    uidUpdateMap.set(uid, value);
  });

  let patchedCount = 0;
  if (uidUpdateMap.size) {
    const now = Date.now();
    const questionUpdates = {};
    uidUpdateMap.forEach((value, uid) => {
      questionUpdates[`questions/${uid}/group`] = value || '';
      questionUpdates[`questions/${uid}/updatedAt`] = now;
    });
    try {
      patchRtdb_(questionUpdates, getFirebaseAccessToken_());
      patchedCount = uidUpdateMap.size;
    } catch (error) {
      console.warn('applyParticipantGroupsToQuestionSheet_ failed to update RTDB questions', error);
    }
  }

  sheetUpdates.forEach(update => {
    update.sheet.getRange(update.rowNumber, update.column).setValue(update.value || '');
  });

  return { updated: sheetUpdates.length, questionUpdates: patchedCount };
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
  const sheet = ensureSheetWithHeaders_(QUESTION_EVENT_SHEET, ['イベントID', 'イベント名', '作成日時']);
  sheet.getRange('C2:C').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  return sheet;
}

function ensureQuestionScheduleSheet_() {
  const sheet = ensureSheetWithHeaders_(
    QUESTION_SCHEDULE_SHEET,
    ['イベントID', '日程ID', '表示名', '日付', '開始日時', '終了日時', '作成日時']
  );
  sheet.getRange('E2:E').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  sheet.getRange('F2:F').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  sheet.getRange('G2:G').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  return sheet;
}

function ensureQuestionParticipantSheet_() {
  const sheet = ensureSheetWithHeaders_(
    QUESTION_PARTICIPANT_SHEET,
    ['イベントID', '日程ID', '参加者ID', '氏名', 'フリガナ', '性別', '学部学科', '携帯電話', 'メールアドレス', '班番号', '更新日時']
  );
  sheet.getRange('K2:K').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  return sheet;
}

function replaceSheetRows_(sheet, rows, columnCount) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, columnCount).clearContent();
  }
  if (!rows.length) {
    return;
  }
  const requiredRows = rows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  sheet.getRange(2, 1, rows.length, columnCount).setValues(rows);
}

function replaceSheetRows_(sheet, rows, columnCount) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, columnCount).clearContent();
  }
  if (!rows.length) {
    return;
  }
  const requiredRows = rows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  sheet.getRange(2, 1, rows.length, columnCount).setValues(rows);
}

function generateShortId_(prefix) {
  const raw = Utilities.getUuid().replace(/-/g, '');
  return (prefix || '') + raw.slice(0, 8);
}

function parseDateToMillis_(value, fallback) {
  const fb = fallback == null ? Date.now() : fallback;
  if (!value) return fb;
  if (value instanceof Date && !isNaN(value)) return value.getTime();
  if (typeof value === 'number' && !isNaN(value)) {
    if (value > 1e12) return value;
    if (value > 1e10) return value * 1000;
    if (value > 20000 && value < 70000) {
      return Math.round((value - 25569) * 86400 * 1000);
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fb;
    const isoLike = trimmed.replace(' ', 'T');
    const parsed = new Date(isoLike);
    if (!isNaN(parsed)) return parsed.getTime();
  }
  return fb;
}

function generateQuestionToken_(existingTokens) {
  const used = existingTokens || new Set();
  while (true) {
    const seed = Utilities.getUuid() + ':' + Math.random() + ':' + Date.now();
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
    const token = Utilities.base64EncodeWebSafe(digest).replace(/=+/g, '').slice(0, 32);
    if (!used.has(token)) {
      used.add(token);
      return token;
    }
  }
}

function mirrorQuestionIntake_() {
  const events = readEvents_();
  const schedules = readSchedules_();
  const participants = readParticipantEntries_();
  const now = Date.now();
  const accessToken = getFirebaseAccessToken_();

  const existingEvents = fetchRtdb_('questionIntake/events', accessToken) || {};
  const existingSchedules = fetchRtdb_('questionIntake/schedules', accessToken) || {};
  const existingParticipants = fetchRtdb_('questionIntake/participants', accessToken) || {};
  const existingTokens = fetchRtdb_('questionIntake/tokens', accessToken) || {};

  const usedTokens = new Set(Object.keys(existingTokens));
  const tokenByKey = new Map();
  Object.keys(existingTokens).forEach(key => {
    const record = existingTokens[key];
    if (!record) return;
    const mapKey = `${record.eventId || ''}::${record.scheduleId || ''}::${record.participantId || ''}`;
    tokenByKey.set(mapKey, { token: key, record });
  });

  const eventMap = {};
  const scheduleTree = {};
  const participantsTree = {};
  const tokensMap = {};
  const scheduleUpdateMap = {};
  const eventUpdateMap = {};

  const eventLookup = new Map();
  events.forEach(event => {
    if (!event || !event.id) return;
    eventLookup.set(event.id, event);
    const existing = existingEvents[event.id] || {};
    const createdAt = existing.createdAt || parseDateToMillis_(event.createdAt, now);
    eventMap[event.id] = {
      name: event.name || '',
      createdAt,
      updatedAt: Math.max(existing.updatedAt || 0, createdAt)
    };
  });

  const scheduleLookup = new Map();
  schedules.forEach(schedule => {
    if (!schedule || !schedule.eventId || !schedule.id) return;
    const key = `${schedule.eventId}::${schedule.id}`;
    scheduleLookup.set(key, schedule);
    if (!scheduleTree[schedule.eventId]) {
      scheduleTree[schedule.eventId] = {};
    }
    const existing = (existingSchedules[schedule.eventId] || {})[schedule.id] || {};
    const createdAt = existing.createdAt || parseDateToMillis_(schedule.createdAt, now);
    const startAt = schedule.startAt || existing.startAt || '';
    const endAt = schedule.endAt || existing.endAt || '';
    scheduleTree[schedule.eventId][schedule.id] = {
      label: schedule.label || '',
      date: schedule.date || '',
      startAt,
      endAt,
      participantCount: 0,
      createdAt,
      updatedAt: Math.max(existing.updatedAt || 0, createdAt)
    };
  });

  participants.forEach(entry => {
    if (!entry || !entry.eventId || !entry.scheduleId || !entry.participantId) return;
    if (!participantsTree[entry.eventId]) {
      participantsTree[entry.eventId] = {};
    }
    if (!participantsTree[entry.eventId][entry.scheduleId]) {
      participantsTree[entry.eventId][entry.scheduleId] = {};
    }

    const existingParticipant = (((existingParticipants[entry.eventId] || {})[entry.scheduleId] || {})[entry.participantId]) || {};
    const key = `${entry.eventId}::${entry.scheduleId}::${entry.participantId}`;
    const tokenInfo = tokenByKey.get(key) || {};
    let tokenValue = tokenInfo.token;
    let tokenRecord = tokenInfo.record || {};
    if (!tokenValue) {
      tokenValue = generateQuestionToken_(usedTokens);
      tokenRecord = {};
    }

    const participantUpdatedAt = parseDateToMillis_(entry.updatedAt, now);
    const guidance = existingParticipant.guidance || tokenRecord.guidance || '';

    const teamValue = String(entry.teamNumber || entry.groupNumber || '');

    participantsTree[entry.eventId][entry.scheduleId][entry.participantId] = {
      participantId: entry.participantId,
      name: entry.name || '',
      phonetic: entry.phonetic || entry.furigana || '',
      furigana: entry.furigana || entry.phonetic || '',
      gender: entry.gender || '',
      department: entry.department || '',
      phone: entry.phone || '',
      email: entry.email || '',
      groupNumber: teamValue,
      teamNumber: teamValue,
      token: tokenValue,
      guidance,
      updatedAt: participantUpdatedAt
    };

    scheduleUpdateMap[key] = Math.max(scheduleUpdateMap[key] || 0, participantUpdatedAt);
    eventUpdateMap[entry.eventId] = Math.max(eventUpdateMap[entry.eventId] || 0, participantUpdatedAt);

    const event = eventLookup.get(entry.eventId) || { id: entry.eventId, name: '' };
    const schedule = scheduleLookup.get(`${entry.eventId}::${entry.scheduleId}`) || { id: entry.scheduleId, label: entry.scheduleId, date: '' };
    const tokenCreatedAt = tokenRecord.createdAt || participantUpdatedAt;
    const tokenUpdatedAt = Math.max(tokenRecord.updatedAt || 0, participantUpdatedAt);

    tokensMap[tokenValue] = {
      eventId: entry.eventId,
      eventName: event.name || tokenRecord.eventName || '',
      scheduleId: entry.scheduleId,
      scheduleLabel: schedule.label || tokenRecord.scheduleLabel || schedule.id || '',
      scheduleDate: schedule.date || tokenRecord.scheduleDate || '',
      scheduleStart: schedule.startAt || tokenRecord.scheduleStart || '',
      scheduleEnd: schedule.endAt || tokenRecord.scheduleEnd || '',
      participantId: entry.participantId,
      displayName: entry.name || '',
      groupNumber: teamValue,
      teamNumber: teamValue,
      guidance,
      revoked: false,
      createdAt: tokenCreatedAt,
      updatedAt: tokenUpdatedAt
    };
  });

  Object.keys(scheduleTree).forEach(eventId => {
    const schedulesForEvent = scheduleTree[eventId];
    Object.keys(schedulesForEvent).forEach(scheduleId => {
      const branch = (participantsTree[eventId] || {})[scheduleId] || {};
      const count = Object.keys(branch).length;
      const scheduleKey = `${eventId}::${scheduleId}`;
      const existing = (existingSchedules[eventId] || {})[scheduleId] || {};
      schedulesForEvent[scheduleId].participantCount = count;
      const candidateUpdated = Math.max(
        schedulesForEvent[scheduleId].updatedAt || 0,
        scheduleUpdateMap[scheduleKey] || 0,
        existing.updatedAt || 0
      );
      schedulesForEvent[scheduleId].updatedAt = candidateUpdated;
    });
  });

  Object.keys(eventMap).forEach(eventId => {
    const existing = existingEvents[eventId] || {};
    const candidate = Math.max(
      eventMap[eventId].updatedAt || 0,
      eventUpdateMap[eventId] || 0,
      existing.updatedAt || 0
    );
    eventMap[eventId].updatedAt = candidate;
  });

  const updates = {
    'questionIntake/events': eventMap,
    'questionIntake/schedules': scheduleTree,
    'questionIntake/participants': participantsTree,
    'questionIntake/tokens': tokensMap
  };

  patchRtdb_(updates, accessToken);

  return {
    eventCount: Object.keys(eventMap).length,
    scheduleCount: schedules.length,
    participantCount: participants.length,
    tokenCount: Object.keys(tokensMap).length
  };
}

function syncQuestionIntakeToSheet_() {
  const accessToken = getFirebaseAccessToken_();
  let queueResult = null;
  try {
    queueResult = processQuestionSubmissionQueue_(accessToken);
  } catch (error) {
    console.warn('processQuestionSubmissionQueue_ failed during syncQuestionIntakeToSheet_', error);
  }

  const eventsBranch = fetchRtdb_('questionIntake/events', accessToken) || {};
  const schedulesBranch = fetchRtdb_('questionIntake/schedules', accessToken) || {};
  const participantsBranch = fetchRtdb_('questionIntake/participants', accessToken) || {};
  let tokensBranch = {};
  try {
    tokensBranch = fetchRtdb_('questionIntake/tokens', accessToken) || {};
  } catch (error) {
    console.warn('Failed to fetch questionIntake/tokens during sync', error);
    tokensBranch = {};
  }
  let questionsBranch = {};
  try {
    questionsBranch = fetchRtdb_('questions', accessToken) || {};
  } catch (error) {
    console.warn('Failed to fetch questions during sync', error);
    questionsBranch = {};
  }

  let cleanupResult = { removed: 0 };
  try {
    cleanupResult = cleanupUnusedQuestionTokens_(participantsBranch, tokensBranch, accessToken);
  } catch (error) {
    console.warn('cleanupUnusedQuestionTokens_ failed during syncQuestionIntakeToSheet_', error);
    cleanupResult = { removed: 0 };
  }

  const toSheetDate = (value) => {
    const ms = parseDateToMillis_(value, 0);
    return ms ? new Date(ms) : '';
  };

  const eventRows = Object.keys(eventsBranch).map(eventId => {
    const event = eventsBranch[eventId] || {};
    const createdAt = parseDateToMillis_(event.createdAt, 0);
    return {
      id: eventId,
      name: String(event.name || ''),
      createdAt
    };
  });

  eventRows.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });

  const eventSheetRows = eventRows.map(row => [row.id, row.name, toSheetDate(row.createdAt)]);
  replaceSheetRows_(ensureQuestionEventSheet_(), eventSheetRows, 3);

  const scheduleRows = [];
  Object.keys(schedulesBranch).forEach(eventId => {
    const branch = schedulesBranch[eventId] || {};
    Object.keys(branch).forEach(scheduleId => {
      const schedule = branch[scheduleId] || {};
      const createdAt = parseDateToMillis_(schedule.createdAt, 0);
      scheduleRows.push({
        eventId,
        scheduleId,
        label: String(schedule.label || ''),
        date: String(schedule.date || ''),
        startAt: String(schedule.startAt || ''),
        endAt: String(schedule.endAt || ''),
        createdAt
      });
    });
  });

  scheduleRows.sort((a, b) => {
    if (a.eventId !== b.eventId) {
      return a.eventId.localeCompare(b.eventId);
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.scheduleId.localeCompare(b.scheduleId);
  });

  const toSheetDateTime = value => {
    const ms = parseDateToMillis_(value, 0);
    return ms ? new Date(ms) : '';
  };

  const scheduleSheetRows = scheduleRows.map(row => [
    row.eventId,
    row.scheduleId,
    row.label,
    row.date,
    toSheetDateTime(row.startAt),
    toSheetDateTime(row.endAt),
    toSheetDate(row.createdAt)
  ]);
  replaceSheetRows_(ensureQuestionScheduleSheet_(), scheduleSheetRows, 7);

  const participantRows = [];
  Object.keys(participantsBranch).forEach(eventId => {
    const schedules = participantsBranch[eventId] || {};
    Object.keys(schedules).forEach(scheduleId => {
      const entries = schedules[scheduleId] || {};
      Object.keys(entries).forEach(participantId => {
        const participant = entries[participantId] || {};
        const updatedAt = parseDateToMillis_(participant.updatedAt, 0);
        participantRows.push({
          eventId,
          scheduleId,
          participantId,
          name: String(participant.name || ''),
          phonetic: String(participant.phonetic || participant.furigana || ''),
          gender: String(participant.gender || ''),
          department: String(participant.department || ''),
          phone: String(participant.phone || ''),
          email: String(participant.email || ''),
          groupNumber: String(participant.teamNumber || participant.groupNumber || ''),
          updatedAt
        });
      });
    });
  });

  participantRows.sort((a, b) => {
    if (a.eventId !== b.eventId) {
      return a.eventId.localeCompare(b.eventId);
    }
    if (a.scheduleId !== b.scheduleId) {
      return a.scheduleId.localeCompare(b.scheduleId);
    }
    if (a.participantId !== b.participantId) {
      return a.participantId.localeCompare(b.participantId);
    }
    return a.updatedAt - b.updatedAt;
  });

  const participantSheetRows = participantRows.map(row => [
    row.eventId,
    row.scheduleId,
    row.participantId,
    row.name,
    row.phonetic,
    row.gender,
    row.department,
    row.phone,
    row.email,
    row.groupNumber,
    toSheetDate(row.updatedAt)
  ]);
  replaceSheetRows_(ensureQuestionParticipantSheet_(), participantSheetRows, 11);

  let groupUpdateResult = { updated: 0 };
  try {
    groupUpdateResult = applyParticipantGroupsToQuestionSheet_(participantsBranch, questionsBranch);
  } catch (error) {
    console.warn('applyParticipantGroupsToQuestionSheet_ failed during syncQuestionIntakeToSheet_', error);
    groupUpdateResult = { updated: 0 };
  }

  let questionMirrorResult = {
    total: 0,
    updated: 0,
    appended: 0,
    pickupUpdated: 0,
    pickupAppended: 0
  };
  try {
    questionMirrorResult = mirrorQuestionsFromRtdbToSheet_(accessToken);
  } catch (error) {
    console.warn('mirrorQuestionsFromRtdbToSheet_ failed during syncQuestionIntakeToSheet_', error);
    questionMirrorResult = {
      total: 0,
      updated: 0,
      appended: 0,
      pickupUpdated: 0,
      pickupAppended: 0
    };
  }

  let mirrorResult = null;
  const shouldMirrorQuestions = (groupUpdateResult && groupUpdateResult.updated > 0);
  if (shouldMirrorQuestions) {
    try {
      mirrorResult = mirrorSheetToRtdb_();
    } catch (error) {
      console.warn('mirrorSheetToRtdb_ failed during syncQuestionIntakeToSheet_', error);
      mirrorResult = null;
    }
  }

  return {
    events: eventRows.length,
    schedules: scheduleRows.length,
    participants: participantRows.length,
    queueProcessed: queueResult ? queueResult.processed || 0 : 0,
    queueDiscarded: queueResult ? queueResult.discarded || 0 : 0,
    tokensRemoved: cleanupResult ? cleanupResult.removed || 0 : 0,
    questionGroupUpdates: groupUpdateResult ? groupUpdateResult.updated || 0 : 0,
    questionFeedUpdates: groupUpdateResult ? groupUpdateResult.questionUpdates || 0 : 0,
    questionsMirrored: mirrorResult ? mirrorResult.count || 0 : 0,
    questionSheetAppended: questionMirrorResult.appended || 0,
    questionSheetUpdated: questionMirrorResult.updated || 0,
    pickupSheetAppended: questionMirrorResult.pickupAppended || 0,
    pickupSheetUpdated: questionMirrorResult.pickupUpdated || 0
  };
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
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
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
        startAt: row[4] instanceof Date ? toIsoJst_(row[4]) : String(row[4] || '').trim(),
        endAt: row[5] instanceof Date ? toIsoJst_(row[5]) : String(row[5] || '').trim(),
        createdAt: row[6] instanceof Date ? toIsoJst_(row[6]) : ''
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
  const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  return values
    .map(row => {
      const eventId = String(row[0] || '').trim();
      const scheduleId = String(row[1] || '').trim();
      const participantId = String(row[2] || '').trim();
      if (!eventId || !scheduleId || !participantId) return null;
      const phonetic = normalizeNameKey_(row[4] || '');
      const gender = String(row[5] || '').trim();
      const department = String(row[6] || '').trim();
      const phone = String(row[7] || '').trim();
      const email = String(row[8] || '').trim();
      const teamNumber = String(row[9] || '').trim();
      return {
        eventId,
        scheduleId,
        participantId,
        name: normalizeNameKey_(row[3] || ''),
        phonetic,
        furigana: phonetic,
        gender,
        department,
        phone,
        email,
        groupNumber: teamNumber,
        teamNumber,
        updatedAt: row[10] instanceof Date ? toIsoJst_(row[10]) : ''
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
      startAt: schedule.startAt,
      endAt: schedule.endAt,
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
  mirrorQuestionIntake_();
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

  mirrorQuestionIntake_();
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

function createQuestionSchedule_(eventId, label, date, startAt, endAt) {
  const trimmedEventId = String(eventId || '').trim();
  if (!trimmedEventId) {
    throw new Error('eventId is required');
  }
  assertEventExists_(trimmedEventId);

  const trimmedLabel = String(label || '').trim();
  const trimmedDate = String(date || '').trim();
  const trimmedStartAt = String(startAt || '').trim();
  const trimmedEndAt = String(endAt || '').trim();
  if (!trimmedLabel) {
    throw new Error('日程の表示名を入力してください。');
  }

  const sheet = ensureQuestionScheduleSheet_();
  const id = generateShortId_('sch_');
  const now = new Date();
  const toSheetDate = value => {
    const ms = parseDateToMillis_(value, 0);
    return ms ? new Date(ms) : '';
  };

  sheet.appendRow([
    trimmedEventId,
    id,
    trimmedLabel,
    trimmedDate,
    toSheetDate(trimmedStartAt),
    toSheetDate(trimmedEndAt),
    now
  ]);
  mirrorQuestionIntake_();
  return {
    id,
    label: trimmedLabel,
    date: trimmedDate,
    startAt: trimmedStartAt,
    endAt: trimmedEndAt,
    createdAt: toIsoJst_(now),
    participantCount: 0
  };
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

  mirrorQuestionIntake_();
  return { deleted: true };
}

function fetchQuestionParticipants_(eventId, scheduleId) {
  const trimmedEventId = String(eventId || '').trim();
  const trimmedScheduleId = String(scheduleId || '').trim();
  if (!trimmedEventId || !trimmedScheduleId) {
    throw new Error('eventId and scheduleId are required');
  }

  const entries = readParticipantEntries_().filter(entry => entry.eventId === trimmedEventId && entry.scheduleId === trimmedScheduleId);
  if (!entries.length) {
    return [];
  }

  const accessToken = getFirebaseAccessToken_();
  const participantBranch = fetchRtdb_(`questionIntake/participants/${trimmedEventId}/${trimmedScheduleId}`, accessToken) || {};

  return entries.map(entry => {
    const current = participantBranch[entry.participantId] || {};
    return {
      participantId: entry.participantId,
      name: entry.name,
      phonetic: entry.phonetic || entry.furigana || '',
      furigana: entry.furigana || entry.phonetic || '',
      gender: entry.gender || '',
      department: entry.department || '',
      phone: entry.phone || '',
      email: entry.email || '',
      groupNumber: entry.teamNumber || entry.groupNumber,
      teamNumber: entry.teamNumber || entry.groupNumber,
      token: current.token || '',
      guidance: current.guidance || ''
    };
  });
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
    const phonetic = normalizeNameKey_(entry.phonetic || entry.furigana || '');
    const gender = String(entry.gender || '').trim();
    const department = String(entry.department || entry.faculty || '').trim();
    const phone = String(entry.phone || '').trim();
    const email = String(entry.email || '').trim();
    const groupNumber = String(entry.groupNumber || entry.group || entry.teamNumber || '').trim();
    deduped.push({
      participantId,
      name,
      phonetic,
      gender,
      department,
      phone,
      email,
      groupNumber
    });
  });

  const sheet = ensureQuestionParticipantSheet_();
  const lastRow = sheet.getLastRow();
  let existing = [];
  if (lastRow >= 2) {
    existing = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
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
    nextRows.push([
      eventValue,
      scheduleValue,
      String(row[2] || '').trim(),
      normalizeNameKey_(row[3] || ''),
      normalizeNameKey_(row[4] || ''),
      String(row[5] || '').trim(),
      String(row[6] || '').trim(),
      String(row[7] || '').trim(),
      String(row[8] || '').trim(),
      String(row[9] || '').trim(),
      row[10]
    ]);
  });

  const now = new Date();
  deduped.forEach(entry => {
    nextRows.push([
      trimmedEventId,
      trimmedScheduleId,
      entry.participantId,
      entry.name,
      entry.phonetic,
      entry.gender,
      entry.department,
      entry.phone,
      entry.email,
      entry.groupNumber,
      now
    ]);
  });

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 11).clearContent();
  }
  if (nextRows.length) {
    const requiredRows = nextRows.length + 1;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    sheet.getRange(2, 1, nextRows.length, 11).setValues(nextRows);
  }

  mirrorQuestionIntake_();
  return {
    count: deduped.length,
    participants: fetchQuestionParticipants_(trimmedEventId, trimmedScheduleId)
  };
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
    scheduleStart: schedule.startAt || '',
    scheduleEnd: schedule.endAt || '',
    participantId,
    participantName: participant.name,
    groupNumber: participant.teamNumber || participant.groupNumber || '',
    teamNumber: participant.teamNumber || participant.groupNumber || ''
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureQuestionUids_();
  const questionSheet = ss.getSheetByName(QUESTION_SHEET_NAME);
  if (!questionSheet) throw new Error(`Sheet "${QUESTION_SHEET_NAME}" not found.`);
  const pickupSheet = ss.getSheetByName(PICKUP_QUESTION_SHEET_NAME);

  const sources = [
    { info: readSheetWithHeaders_(questionSheet), type: 'normal' }
  ];
  if (pickupSheet) {
    sources.push({ info: readSheetWithHeaders_(pickupSheet), type: 'pickup' });
  }
  const now = Date.now();
  const map = {};

  sources.forEach(source => {
    const info = source.info;
    if (!info || !info.sheet || !info.rows.length) {
      return;
    }

    const uidIdx = getHeaderIndex_(info.headerMap, 'UID');
    const questionIdx = getHeaderIndex_(info.headerMap, '質問・お悩み');
    if (uidIdx == null || questionIdx == null) {
      throw new Error(`Sheet "${info.sheet.getName()}" is missing required columns (UID/質問・お悩み)`);
    }

    const answeredIdx = getHeaderIndex_(info.headerMap, '回答済');
    const selectingIdx = getHeaderIndex_(info.headerMap, '選択中');
    const genreIdx = getHeaderIndex_(info.headerMap, 'ジャンル');
    const groupIdx = getHeaderIndex_(info.headerMap, '班番号');
    const participantIdx = getHeaderIndex_(info.headerMap, '参加者ID');
    const tsIdx = getHeaderIndex_(info.headerMap, ['タイムスタンプ', 'timestamp']);
    const startIdx = getHeaderIndex_(info.headerMap, ['開始日時', '日程開始']);
    const endIdx = getHeaderIndex_(info.headerMap, ['終了日時', '日程終了']);
    const nameIdx = getHeaderIndex_(info.headerMap, 'ラジオネーム');

    info.rows.forEach(row => {
      const uid = String(row[uidIdx] || '').trim();
      if (!uid) {
        return;
      }

      const tsValue = tsIdx != null ? row[tsIdx] : null;
      const tsMs = parseSpreadsheetTimestamp_(tsValue);

      const rawName = nameIdx != null ? String(row[nameIdx] || '') : '';
      const name = rawName || (source.type === 'pickup' ? 'Pick Up Question' : '');

      const startValue = startIdx != null ? row[startIdx] : '';
      const endValue = endIdx != null ? row[endIdx] : '';
      const scheduleStart = startIdx != null ? toIsoStringOrValue_(startValue) : '';
      const scheduleEnd = endIdx != null ? toIsoStringOrValue_(endValue) : '';
      const scheduleLabel = formatScheduleLabel_(startValue, endValue);

      const participantId = participantIdx != null ? String(row[participantIdx] || '').trim() : '';
      const groupValue = groupIdx != null ? String(row[groupIdx] || '').trim() : '';
      const genreValue = genreIdx != null ? String(row[genreIdx] || '').trim() : '';

      map[uid] = {
        uid,
        name,
        question: String(row[questionIdx] || ''),
        group: groupValue,
        genre: genreValue,
        schedule: scheduleLabel,
        scheduleStart,
        scheduleEnd,
        participantId,
        ts: tsMs || 0,
        answered: answeredIdx != null ? toBooleanCell_(row[answeredIdx]) : false,
        selecting: selectingIdx != null ? toBooleanCell_(row[selectingIdx]) : false,
        updatedAt: now,
        type: source.type
      };

      if (source.type === 'pickup') {
        map[uid].pickup = true;
      }
    });
  });

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
  if (!e) throw new Error('No body');

  const postData = e.postData;
  const parameter = e && typeof e.parameter === 'object' ? e.parameter : null;
  const parameters = e && typeof e.parameters === 'object' ? e.parameters : null;

  if (postData) {
    const type = String(postData.type || '').toLowerCase();
    const contents = postData.contents || '';

    if (type.indexOf('application/json') !== -1) {
      try {
        return contents ? JSON.parse(contents) : {};
      } catch (error) {
        throw new Error('Invalid JSON');
      }
    }

    if (type.indexOf('application/x-www-form-urlencoded') !== -1 || type.indexOf('multipart/form-data') !== -1) {
      return parseParameterObject_(parameter, parameters);
    }

    if (contents) {
      try {
        return JSON.parse(contents);
      } catch (error) {
        if (!parameter || !Object.keys(parameter).length) {
          throw new Error('Invalid JSON');
        }
      }
    }
  }

  if (parameter && Object.keys(parameter).length) {
    return parseParameterObject_(parameter, parameters);
  }

  throw new Error('No body');
}

function parseParameterObject_(parameter, parameters) {
  const single = parameter && typeof parameter === 'object' ? parameter : {};
  const multi = parameters && typeof parameters === 'object' ? parameters : {};
  const result = {};

  Object.keys(single).forEach(key => {
    result[key] = single[key];
  });

  Object.keys(multi).forEach(key => {
    const values = multi[key];
    if (Array.isArray(values) && values.length > 1) {
      result[key] = values.slice();
    }
  });

  return result;
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

function jsonOk(payload, requestOrigin){
  const body = Object.assign({ success: true }, payload || {});
  return withCors_(
    ContentService.createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON),
    requestOrigin
  );
}

function jsonErr_(err, requestOrigin){
  const id = Utilities.getUuid().slice(0, 8);
  console.error('[' + id + ']', err && err.stack || err);
  return withCors_(
    ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: String(err && err.message || err),
      errorId: id
    })).setMimeType(ContentService.MimeType.JSON),
    requestOrigin
  );
}

function withCors_(output, requestOrigin) {
  if (!output || typeof output.setHeader !== 'function') {
    return output;
  }
  const origin = normalizeAllowedOrigin_(requestOrigin);
  return output
    .setHeader('Access-Control-Allow-Origin', origin)
    .setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With, Origin')
    .setHeader('Access-Control-Max-Age', '600')
    .setHeader('Vary', 'Origin');
}

function normalizeAllowedOrigin_(requestOrigin) {
  const origin = String(requestOrigin || '').trim();
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    return origin;
  }
  if (ALLOWED_ORIGINS.indexOf('*') !== -1) {
    return '*';
  }
  return ALLOWED_ORIGINS[0] || '*';
}

function getRequestOrigin_(event, body) {
  const fallback = extractOriginFromBody_(body) || extractOriginFromParams_(event);
  if (fallback) {
    return fallback;
  }
  return '';
}

function extractOriginFromBody_(body) {
  if (!body || typeof body !== 'object') {
    return '';
  }
  return sanitizeOrigin_(body.origin || body.requestOrigin || '');
}

function extractOriginFromParams_(event) {
  if (!event) return '';
  const single = event.parameter && event.parameter.origin;
  if (single) {
    const value = Array.isArray(single) ? single[0] : single;
    const normalized = sanitizeOrigin_(value);
    if (normalized) {
      return normalized;
    }
  }
  const multi = event.parameters && event.parameters.origin;
  if (Array.isArray(multi) && multi.length) {
    for (let i = 0; i < multi.length; i++) {
      const normalized = sanitizeOrigin_(multi[i]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}

function sanitizeOrigin_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.origin;
  } catch (error) {
    return '';
  }
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureQuestionUids_();
  const infos = QUESTION_SHEET_NAMES.map(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return null;
    return readSheetWithHeaders_(sheet);
  }).filter(info => info && info.sheet);

  if (!infos.length) {
    throw new Error('Question sheets are not available.');
  }

  const targetUid = String(uid || '').trim();
  if (!targetUid) {
    throw new Error('UID is required.');
  }

  let target = null;
  infos.forEach(info => {
    if (target) return;
    const uidIdx = getHeaderIndex_(info.headerMap, 'UID');
    if (uidIdx == null) return;
    for (let i = 0; i < info.rows.length; i++) {
      if (String(info.rows[i][uidIdx] || '').trim() === targetUid) {
        target = {
          sheet: info.sheet,
          rowNumber: i + 2,
          selectingIdx: getHeaderIndex_(info.headerMap, '選択中')
        };
        break;
      }
    }
  });

  if (!target) {
    throw new Error(`UID: ${uid} not found.`);
  }
  if (target.selectingIdx == null) {
    throw new Error('Column "選択中" not found.');
  }

  infos.forEach(info => {
    const selectingIdx = getHeaderIndex_(info.headerMap, '選択中');
    if (selectingIdx == null) return;
    if (!info.rows.length) return;
    const range = info.sheet.getRange(2, selectingIdx + 1, info.rows.length, 1);
    const cleared = info.rows.map(() => [false]);
    range.setValues(cleared);
  });

  target.sheet.getRange(target.rowNumber, target.selectingIdx + 1).setValue(true);
  return { success: true, message: `UID: ${uid} is now selecting.` };
}

function editQuestionText(uid, newText) {
  if (!uid || typeof newText === 'undefined') {
    throw new Error('UID and new text are required.');
  }
  const match = findQuestionRowByUid_(uid);
  if (!match) {
    throw new Error(`UID: ${uid} not found.`);
  }
  const questionIdx = getHeaderIndex_(match.headerMap, '質問・お悩み');
  if (questionIdx == null) {
    throw new Error('Column "質問・お悩み" not found.');
  }
  match.sheet.getRange(match.rowNumber, questionIdx + 1).setValue(newText);
  return { success: true, message: `UID: ${uid} question updated.` };
}

function updateAnswerStatus(uid, status) {
  const match = findQuestionRowByUid_(uid);
  if (!match) {
    throw new Error(`UID: ${uid} not found.`);
  }
  const answeredIdx = getHeaderIndex_(match.headerMap, '回答済');
  if (answeredIdx == null) {
    throw new Error('Column "回答済" not found.');
  }
  const isAnswered = status === true || status === 'true' || status === 1;
  match.sheet.getRange(match.rowNumber, answeredIdx + 1).setValue(isAnswered);
  return { success: true, message: `UID: ${uid} updated.` };
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureQuestionUids_();
    const uidSet = new Set((uids || []).map(value => String(value || '').trim()).filter(Boolean));
    if (!uidSet.size) {
      return { success: true, message: '0 items updated.' };
    }

    const isAnswered = status === true || status === 'true' || status === 1;
    let updatedCount = 0;

    QUESTION_SHEET_NAMES.forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const info = readSheetWithHeaders_(sheet);
      if (!info.rows.length) return;
      const uidIdx = getHeaderIndex_(info.headerMap, 'UID');
      const answeredIdx = getHeaderIndex_(info.headerMap, '回答済');
      if (uidIdx == null || answeredIdx == null) return;

      const range = sheet.getRange(2, answeredIdx + 1, info.rows.length, 1);
      const values = range.getValues();
      let changed = false;

      for (let i = 0; i < info.rows.length; i++) {
        const rowUid = String(info.rows[i][uidIdx] || '').trim();
        if (!uidSet.has(rowUid)) continue;
        updatedCount += 1;
        if (values[i][0] !== isAnswered) {
          values[i][0] = isAnswered;
          changed = true;
        }
      }

      if (changed) {
        range.setValues(values);
      }
    });

    return { success: true, message: `${updatedCount} items updated.` };

  } catch (error) {
    return { success: false, error: error.message };

  }
}

function clearSelectingStatus() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let changedAny = false;
    QUESTION_SHEET_NAMES.forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const info = readSheetWithHeaders_(sheet);
      const selectingIdx = getHeaderIndex_(info.headerMap, '選択中');
      if (selectingIdx == null || !info.rows.length) return;
      const range = sheet.getRange(2, selectingIdx + 1, info.rows.length, 1);
      const values = range.getValues();
      let changed = false;
      for (let i = 0; i < values.length; i++) {
        if (values[i][0] === true) {
          values[i][0] = false;
          changed = true;
        }
      }
      if (changed) {
        range.setValues(values);
        changedAny = true;
      }
    });
    return { success: true, changed: changedAny };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function toIsoJst_(d){ return Utilities.formatDate(d,'Asia/Tokyo',"yyyy-MM-dd'T'HH:mm:ssXXX"); }

function getSheetData_(sheetKey) {
  if (!sheetKey) throw new Error('Missing sheet');

  const ALLOW = {
    question:          QUESTION_SHEET_NAME,
    pick_up_question:  PICKUP_QUESTION_SHEET_NAME,
    dictionary:        'dictionary',
    users:             'users',
    logs:              'logs',
  };
  const sheetName = ALLOW[String(sheetKey)];
  if (!sheetName) throw new Error('Invalid sheet: ' + sheetKey);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);

  if (sheetKey === 'question' || sheetKey === 'pick_up_question') {
    ensureQuestionUids_();
  }

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
