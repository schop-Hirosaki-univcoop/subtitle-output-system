// code.gs: Google Apps Script上でSpreadsheetやFirebase連携を行うサーバー側スクリプトのエントリーです。
/**
 * WebAppとしてアクセスされた際に応答を生成するエントリポイント。
 * このAPIではGETをサポートしないため常に405相当のレスポンスを返します。
 * @param {GoogleAppsScript.Events.DoGet} e - リクエストコンテキスト
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  const view = e && e.parameter ? String(e.parameter.view || '').trim() : '';
  if (view === 'participantMail') {
    return renderParticipantMailPage_(e);
  }
  return withCors_(
    ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'GET not allowed' }))
      .setMimeType(ContentService.MimeType.JSON),
    getRequestOrigin_(e)
  );
}

const DISPLAY_SESSION_TTL_MS = 60 * 1000;
const DEFAULT_SCHEDULE_KEY = '__default_schedule__';
const ALLOWED_ORIGINS = [
  'https://schop-hirosaki-univcoop.github.io',
  'https://schop-hirosaki-univcoop.github.io/'
];


function logMail_(message, details) {
  const prefix = `[Mail] ${message}`;
  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    if (details !== undefined) {
      console.log(prefix, details);
    } else {
      console.log(prefix);
    }
  } else {
    if (details !== undefined) {
      Logger.log(`${prefix}: ${JSON.stringify(details)}`);
    } else {
      Logger.log(prefix);
    }
  }
}

function logMailError_(message, error, details) {
  const prefix = `[Mail] ${message}`;
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    if (details !== undefined) {
      console.error(prefix, error, details);
    } else if (error !== undefined) {
      console.error(prefix, error);
    } else {
      console.error(prefix);
    }
  } else {
    Logger.log(`${prefix}: ${error}`);
    if (details !== undefined) {
      Logger.log(`${prefix} details: ${JSON.stringify(details)}`);
    }
  }
}


/**
 * Spreadsheetセル値をDateオブジェクトに変換します。
 * 数値シリアル値・UNIX秒・ISO文字列をサポートし、不正値はnullを返します。
 * @param {any} value
 * @returns {Date|null}
 */
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

function parseDateToMillis_(value, fallback) {
  const date = parseDateCell_(value);
  if (date) {
    return date.getTime();
  }
  return fallback == null ? 0 : fallback;
}

/**
 * セル値を人が読みやすいyyyy/MM/dd HH:mm形式に整形します。
 * 日付変換できない場合はトリムした文字列を返します。
 * @param {any} value
 * @returns {string}
 */
function formatDateLabel_(value) {
  const date = parseDateCell_(value);
  if (date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  }
  return String(value || '').trim();
}

/**
 * 値をISO 8601(JST)文字列に正規化するか、生値のトリム結果を返します。
 * @param {any} value
 * @returns {string}
 */
function toIsoStringOrValue_(value) {
  const date = parseDateCell_(value);
  if (date) {
    return toIsoJst_(date);
  }
  return String(value || '').trim();
}

/**
 * 開始・終了日時を結合したスケジュール表示ラベルを生成します。
 * @param {any} startValue
 * @param {any} endValue
 * @returns {string}
 */
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

function coalesceStrings_(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    const text = typeof value === 'string' ? value : String(value);
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function truncateString_(value, maxLength) {
  const text = typeof value === 'string' ? value : String(value || '');
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * セル値を真偽値に変換します。文字列や数値の一般的な truthy 記法にも対応します。
 * @param {any} value
 * @returns {boolean}
 */
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

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

const PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY = 'participantMailTemplate:v1';
const PARTICIPANT_MAIL_TEMPLATE_BODY_PLACEHOLDER = /<!--\s*@@INJECT:email-participant-body\.html@@\s*-->/;
const PARTICIPANT_MAIL_TEMPLATE_FALLBACK_BASE_URL = 'https://raw.githubusercontent.com/schop-hirosaki-univcoop/subtitle-output-system/main/';

function getParticipantMailTemplateBaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const value = String(properties.getProperty('PARTICIPANT_MAIL_TEMPLATE_BASE_URL') || '').trim();
  if (value) {
    return value.replace(/\/+$/, '') + '/';
  }
  return PARTICIPANT_MAIL_TEMPLATE_FALLBACK_BASE_URL;
}

function fetchParticipantMailTemplateFile_(filename) {
  const baseUrl = getParticipantMailTemplateBaseUrl_();
  const url = `${baseUrl}${filename}`;
  logMail_('メールテンプレートファイルの取得を開始します', { filename, url });
  let status = 0;
  try {
    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: true
    });
    status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      const content = response.getContentText();
      logMail_('メールテンプレートファイルの取得に成功しました', {
        filename,
        status,
        length: content.length
      });
      return content;
    }
    throw new Error(`HTTP ${status}`);
  } catch (error) {
    logMailError_('メールテンプレートファイルの取得に失敗しました', error, {
      filename,
      url,
      status
    });
    throw new Error(`メールテンプレート「${filename}」を取得できませんでした (${url}): ${error}`);
  }
}

function getParticipantMailTemplateMarkup_() {
  const cache = CacheService.getScriptCache();
  if (cache) {
    const cached = cache.get(PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY);
    if (cached) {
      logMail_('キャッシュされたメールテンプレートマークアップを使用します');
      return cached;
    }
    logMail_('メールテンプレートマークアップのキャッシュが見つからないため、取得を行います');
  }
  const shellHtml = fetchParticipantMailTemplateFile_('email-participant-shell.html');
  const bodyHtml = fetchParticipantMailTemplateFile_('email-participant-body.html');
  if (!PARTICIPANT_MAIL_TEMPLATE_BODY_PLACEHOLDER.test(shellHtml)) {
    logMailError_('メールテンプレートに差し込みプレースホルダーが見つかりません', null, {
      placeholder: PARTICIPANT_MAIL_TEMPLATE_BODY_PLACEHOLDER.source
    });
    throw new Error('メールテンプレートに参加者本文の差し込みプレースホルダーが見つかりません。');
  }
  const composed = shellHtml.replace(PARTICIPANT_MAIL_TEMPLATE_BODY_PLACEHOLDER, bodyHtml);
  logMail_('メールテンプレートマークアップの組み立てが完了しました', {
    shellLength: shellHtml.length,
    bodyLength: bodyHtml.length
  });
  if (cache) {
    cache.put(PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY, composed, 6 * 60 * 60);
    logMail_('メールテンプレートマークアップをキャッシュしました', {
      ttlSeconds: 6 * 60 * 60
    });
  }
  return composed;
}


function doPost(e) {
  let requestOrigin = getRequestOrigin_(e);
  try {
    const req = parseBody_(e);
    requestOrigin = getRequestOrigin_(e, req) || requestOrigin;
    const { action, idToken } = req;
    if (!action) throw new Error('Missing action');

    const displayActions = new Set(['beginDisplaySession', 'heartbeatDisplaySession', 'endDisplaySession']);
    const noAuthActions = new Set(['submitQuestion', 'processQuestionQueueForToken']);
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
      case 'processQuestionQueue':
        assertOperator_(principal);
        return ok(processQuestionSubmissionQueue_());
      case 'processQuestionQueueForToken':
        return ok(processQuestionQueueForToken_(req.token));
      case 'fetchSheet':
        assertOperator_(principal);
        if (String(req.sheet || '').trim().toLowerCase() !== 'users') {
          throw new Error('fetchSheet is only available for the users sheet.');
        }
        return ok({ data: getSheetData_(req.sheet) });
      case 'addTerm':
        assertOperator_(principal);
        return ok(addDictionaryTerm(req.term, req.ruby, req.uid));
      case 'updateTerm':
        assertOperator_(principal);
        return ok(updateDictionaryTerm(req.uid, req.term, req.ruby));
      case 'deleteTerm':
        assertOperator_(principal);
        return ok(deleteDictionaryTerm(req.uid, req.term));
      case 'toggleTerm':
        assertOperator_(principal);
        return ok(toggleDictionaryTerm(req.uid, req.enabled, req.term));
      case 'batchDeleteTerms':
        assertOperator_(principal);
        return ok(batchDeleteDictionaryTerms(req.uids));
      case 'batchToggleTerms':
        assertOperator_(principal);
        return ok(batchToggleDictionaryTerms(req.uids, req.enabled));
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
      case 'lockDisplaySchedule':
        assertOperator_(principal);
        return ok(lockDisplaySchedule_(principal, req.eventId, req.scheduleId, req.scheduleLabel, req.operatorName));
      case 'saveScheduleRotation':
        assertOperator_(principal);
        return ok(saveScheduleRotation_(
          principal,
          req.eventId,
          req.entries != null ? req.entries : (req.rotation && req.rotation.entries) || req.rotation,
          {
            operatorName: req.operatorName,
            defaultDwellMs: req.defaultDwellMs,
            defaultDurationMs: req.defaultDurationMs,
            entries: req.rotation && req.rotation.entries
          }
        ));
      case 'clearScheduleRotation':
        assertOperator_(principal);
        return ok(clearScheduleRotation_(principal, req.eventId));
      case 'sendParticipantMail':
        return ok(sendParticipantMail_(principal, req));
      case 'logAction':
        assertOperator_(principal);
        return ok(logAction_(principal, req.action_type, req.details));
      case 'backupRealtimeDatabase':
        assertOperator_(principal);
        return ok(backupRealtimeDatabase_());
      case 'restoreRealtimeDatabase':
        assertOperator_(principal);
        return ok(restoreRealtimeDatabase_());
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
function normalizeNameKey_(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC');
}

function normalizeNameForLookup_(value) {
  return normalizeNameKey_(value).replace(/[\u200B-\u200D\uFEFF]/g, '');
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
function logAction_(principal, actionType, details) {
  const now = new Date();
  const timestampMs = now.getTime();
  const userEmail = String((principal && principal.email) || '').trim() || 'unknown';
  const payload = {
    Timestamp: toIsoJst_(now),
    timestamp: timestampMs,
    User: userEmail,
    UserId: String((principal && principal.uid) || '').trim(),
    Action: String(actionType || ''),
    Details: String(details || ''),
    createdAt: timestampMs,
    updatedAt: timestampMs
  };
  const token = getFirebaseAccessToken_();
  let name = '';
  try {
    const res = postRtdb_('logs/history', payload, token);
    if (res && typeof res === 'object' && res.name) {
      name = String(res.name || '');
    }
  } finally {
    try {
      notifyUpdate('logs');
    } catch (error) {
      console.error('notifyUpdate failed', error);
    }
  }
  return { ok: true, id: name };
}

function ensureBackupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'backups';
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Data']);
  }
  return sheet;
}

function backupRealtimeDatabase_() {
  const token = getFirebaseAccessToken_();
  const snapshot = fetchRtdb_('', token) || {};
  const sheet = ensureBackupSheet_();
  const now = new Date();
  sheet.appendRow([now, JSON.stringify(snapshot)]);
  return {
    timestamp: toIsoJst_(now),
    rowCount: Math.max(0, sheet.getLastRow() - 1)
  };
}

function restoreRealtimeDatabase_() {
  const sheet = ensureBackupSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('バックアップが存在しません。');
  }
  const [[rawTimestamp, rawPayload]] = sheet.getRange(lastRow, 1, 1, 2).getValues();
  if (!rawPayload) {
    throw new Error('バックアップデータが空です。');
  }
  let data;
  try {
    data = JSON.parse(rawPayload);
  } catch (error) {
    throw new Error('バックアップデータの解析に失敗しました。');
  }
  const token = getFirebaseAccessToken_();
  putRtdb_('', data, token);
  const timestamp = rawTimestamp instanceof Date ? toIsoJst_(rawTimestamp) : String(rawTimestamp || '');
  return { timestamp };
}

function getWebAppBaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const propertyKeys = ['PUBLIC_WEB_APP_URL', 'WEB_APP_BASE_URL'];
  for (let i = 0; i < propertyKeys.length; i += 1) {
    const value = String(properties.getProperty(propertyKeys[i]) || '').trim();
    if (value) {
      return value;
    }
  }
  if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
    try {
      const service = ScriptApp.getService();
      if (service && typeof service.getUrl === 'function') {
        const url = service.getUrl();
        if (url) {
          return String(url).trim();
        }
      }
    } catch (error) {
      // ignore and fall back
    }
  }
  return '';
}

function getParticipantMailSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const settings = {
    contactEmail: String(properties.getProperty('PARTICIPANT_MAIL_CONTACT') || '').trim(),
    senderName: String(properties.getProperty('PARTICIPANT_MAIL_SENDER_NAME') || '').trim(),
    subjectTemplate: String(properties.getProperty('PARTICIPANT_MAIL_SUBJECT') || '').trim(),
    noteHtml: properties.getProperty('PARTICIPANT_MAIL_NOTE_HTML') || '',
    noteText: properties.getProperty('PARTICIPANT_MAIL_NOTE_TEXT') || '',
    location: String(properties.getProperty('PARTICIPANT_MAIL_LOCATION') || '').trim(),
    arrivalNote: String(properties.getProperty('PARTICIPANT_MAIL_ARRIVAL_NOTE') || '').trim(),
    tagline: String(properties.getProperty('PARTICIPANT_MAIL_TAGLINE') || '').trim(),
    contactLinkLabel: String(properties.getProperty('PARTICIPANT_MAIL_CONTACT_LINK_LABEL') || '').trim(),
    contactLinkUrl: String(properties.getProperty('PARTICIPANT_MAIL_CONTACT_LINK_URL') || '').trim(),
    footerNote: String(properties.getProperty('PARTICIPANT_MAIL_FOOTER_NOTE') || '').trim(),
    previewTextTemplate: String(properties.getProperty('PARTICIPANT_MAIL_PREVIEW_TEXT') || '').trim()
  };
  logMail_('参加者メール設定を読み込みました', {
    hasContactEmail: Boolean(settings.contactEmail),
    hasSenderName: Boolean(settings.senderName),
    hasSubjectTemplate: Boolean(settings.subjectTemplate),
    hasPreviewTextTemplate: Boolean(settings.previewTextTemplate)
  });
  return settings;
}

function buildParticipantMailViewUrl_(baseUrl, params) {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return '';
  }
  const segments = [
    'view=participantMail',
    `eventId=${encodeURIComponent(params.eventId)}`,
    `scheduleId=${encodeURIComponent(params.scheduleId)}`,
    `participantId=${encodeURIComponent(params.participantId)}`
  ];
  if (params.token) {
    segments.push(`token=${encodeURIComponent(params.token)}`);
  }
  let separator = '?';
  if (trimmed.includes('?')) {
    separator = trimmed.endsWith('?') || trimmed.endsWith('&') ? '' : '&';
  }
  return `${trimmed}${separator}${segments.join('&')}`;
}

function formatMailDateWithWeekday_(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return '';
  }
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()] || '';
  return `${date.getMonth() + 1}月${date.getDate()}日(${weekday})`;
}

function formatMailTimeLabel_(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return '';
  }
  return Utilities.formatDate(date, 'Asia/Tokyo', 'H:mm');
}

function buildParticipantMailContext_(eventId, scheduleId, participantRecord, eventRecord, scheduleRecord, settings, baseUrl) {
  const participantId = String((participantRecord && (participantRecord.participantId || participantRecord.uid)) || '').trim();
  const participantName = String(participantRecord && participantRecord.name || '').trim();
  const eventName = coalesceStrings_(eventRecord && eventRecord.name, eventId);
  const participantScheduleLabel = coalesceStrings_(
    participantRecord && participantRecord.scheduleLabel,
    participantRecord && participantRecord.schedule,
    participantRecord && participantRecord.scheduleName
  );
  const participantScheduleDate = coalesceStrings_(
    participantRecord && participantRecord.scheduleDate,
    participantRecord && participantRecord.date
  );
  const participantScheduleTime = coalesceStrings_(
    participantRecord && participantRecord.scheduleTime,
    participantRecord && participantRecord.time
  );
  const participantScheduleRange = coalesceStrings_(
    participantRecord && participantRecord.scheduleRange,
    participantRecord && participantRecord.timeRange
  );
  const scheduleLabel = coalesceStrings_(
    scheduleRecord && scheduleRecord.label,
    formatScheduleLabel_(scheduleRecord && scheduleRecord.startAt, scheduleRecord && scheduleRecord.endAt),
    participantScheduleLabel,
    participantScheduleDate,
    scheduleId
  );
  const startDate = parseDateCell_(scheduleRecord && (scheduleRecord.startAt || scheduleRecord.date));
  const endDate = parseDateCell_(scheduleRecord && scheduleRecord.endAt);
  const scheduleDateLabel = formatMailDateWithWeekday_(startDate);
  const startTimeLabel = formatMailTimeLabel_(startDate);
  const endTimeLabel = formatMailTimeLabel_(endDate);
  let scheduleTimeRange = '';
  if (startTimeLabel && endTimeLabel) {
    scheduleTimeRange = `${startTimeLabel}〜${endTimeLabel}`;
  } else if (startTimeLabel) {
    scheduleTimeRange = `${startTimeLabel}〜`;
  }
  const resolvedScheduleDateLabel = coalesceStrings_(scheduleDateLabel, participantScheduleDate, scheduleLabel);
  const resolvedScheduleTimeRange = coalesceStrings_(scheduleTimeRange, participantScheduleTime);
  const scheduleRangeLabel = coalesceStrings_(
    resolvedScheduleDateLabel && resolvedScheduleTimeRange
      ? `${resolvedScheduleDateLabel} ${resolvedScheduleTimeRange}`
      : '',
    participantScheduleRange,
    participantScheduleLabel && resolvedScheduleTimeRange
      ? `${participantScheduleLabel} ${resolvedScheduleTimeRange}`
      : '',
    resolvedScheduleDateLabel,
    scheduleLabel
  );
  const token = String(participantRecord && participantRecord.token || '').trim();
  const webViewUrl = buildParticipantMailViewUrl_(baseUrl, {
    eventId,
    scheduleId,
    participantId,
    token
  });
  const guidance = String(participantRecord && participantRecord.guidance || '').trim();
  const location = coalesceStrings_(
    participantRecord && (participantRecord.location || participantRecord.venue),
    scheduleRecord && (scheduleRecord.location || scheduleRecord.venue || scheduleRecord.place),
    eventRecord && (eventRecord.location || eventRecord.venue),
    settings.location
  );
  const contactEmail = coalesceStrings_(
    participantRecord && participantRecord.contactEmail,
    scheduleRecord && scheduleRecord.contactEmail,
    eventRecord && eventRecord.contactEmail
  );
  const arrivalNote = coalesceStrings_(
    participantRecord && (participantRecord.arrivalNote || participantRecord.arrivalWindow || participantRecord.checkinNote),
    scheduleRecord && (scheduleRecord.arrivalNote || scheduleRecord.arrivalWindow || scheduleRecord.checkinNote)
  );
  const tagline = coalesceStrings_(
    participantRecord && participantRecord.mailTagline,
    scheduleRecord && (scheduleRecord.mailTagline || scheduleRecord.tagline),
    eventRecord && (eventRecord.mailTagline || eventRecord.tagline),
    settings.tagline
  );
  const footerNote = coalesceStrings_(
    participantRecord && participantRecord.mailFooter,
    scheduleRecord && scheduleRecord.mailFooter,
    eventRecord && eventRecord.mailFooter,
    settings.footerNote
  );
  return {
    eventId,
    scheduleId,
    participantId,
    participantName,
    participantEmail: String(participantRecord && participantRecord.email || '').trim(),
    eventName,
    scheduleLabel,
    scheduleDateLabel: resolvedScheduleDateLabel,
    scheduleTimeRange: resolvedScheduleTimeRange,
    scheduleRangeLabel,
    contactEmail,
    senderName: String(settings.senderName || '').trim(),
    additionalHtml: settings.noteHtml || '',
    additionalText: settings.noteText || '',
    location,
    guidance,
    webViewUrl,
    token,
    arrivalNote,
    contactLinkLabel: settings.contactLinkLabel || '',
    contactLinkUrl: settings.contactLinkUrl || '',
    footerNote,
    tagline,
    previewText: '',
    scheduleDateDisplay: resolvedScheduleDateLabel,
    scheduleTimeDisplay: resolvedScheduleTimeRange
  };
}

function buildParticipantMailSubject_(context, settings) {
  const template = String(settings.subjectTemplate || '').trim();
  const eventName = context.eventName || context.eventId || '';
  const scheduleLabel = context.scheduleLabel || context.scheduleRangeLabel || '';
  const participantName = context.participantName || '';
  if (template) {
    return template
      .replace(/\{\{\s*eventName\s*\}\}/g, eventName)
      .replace(/\{\{\s*scheduleLabel\s*\}\}/g, scheduleLabel)
      .replace(/\{\{\s*participantName\s*\}\}/g, participantName);
  }
  return `【${eventName || 'イベント'}】参加日時のご案内`;
}

function buildParticipantMailPreviewText_(context, settings) {
  const template = settings && settings.previewTextTemplate ? String(settings.previewTextTemplate).trim() : '';
  const eventName = coalesceStrings_(context && context.eventName, context && context.eventId);
  const scheduleLabel = coalesceStrings_(context && context.scheduleRangeLabel, context && context.scheduleLabel);
  const participantName = coalesceStrings_(context && context.participantName);
  const arrivalNote = coalesceStrings_(context && context.arrivalNote);
  const location = coalesceStrings_(context && context.location);
  if (template) {
    return truncateString_(
      template
        .replace(/\{\{\s*eventName\s*\}\}/g, eventName)
        .replace(/\{\{\s*scheduleLabel\s*\}\}/g, scheduleLabel)
        .replace(/\{\{\s*participantName\s*\}\}/g, participantName)
        .replace(/\{\{\s*arrivalNote\s*\}\}/g, arrivalNote)
        .replace(/\{\{\s*location\s*\}\}/g, location),
      160
    );
  }
  const fragments = [];
  if (eventName) {
    fragments.push(`${eventName}のご案内`);
  }
  if (scheduleLabel) {
    fragments.push(scheduleLabel);
  }
  if (arrivalNote) {
    fragments.push(arrivalNote);
  } else if (location) {
    fragments.push(location);
  }
  const joined = fragments.filter(Boolean).join('｜');
  if (joined) {
    return truncateString_(joined, 160);
  }
  return 'ご参加に関する大切なお知らせです。';
}

function enrichParticipantMailContext_(context, settings) {
  if (!context || typeof context !== 'object') {
    return context;
  }
  const effectiveArrival = coalesceStrings_(context.arrivalNote, settings && settings.arrivalNote);
  if (effectiveArrival) {
    context.arrivalNote = effectiveArrival;
  }
  const effectiveTagline = coalesceStrings_(context.tagline, settings && settings.tagline);
  if (effectiveTagline) {
    context.tagline = effectiveTagline;
  }
  const effectiveFooter = coalesceStrings_(context.footerNote, settings && settings.footerNote);
  if (effectiveFooter) {
    context.footerNote = effectiveFooter;
  }
  const contactLabel = coalesceStrings_(
    context.contactLinkLabel,
    settings && settings.contactLinkLabel,
    context.contactEmail ? 'お問い合わせする' : ''
  );
  if (contactLabel) {
    context.contactLinkLabel = contactLabel;
  }
  let contactLinkUrl = coalesceStrings_(context.contactLinkUrl, settings && settings.contactLinkUrl);
  if (!contactLinkUrl && context.contactEmail) {
    contactLinkUrl = `mailto:${context.contactEmail}`;
  }
  context.contactLinkUrl = contactLinkUrl;
  context.previewText = buildParticipantMailPreviewText_(context, settings);
  return context;
}

function createParticipantMailTemplateOutput_(context, mode) {
  const templateMarkup = getParticipantMailTemplateMarkup_();
  const template = HtmlService.createTemplate(templateMarkup);
  const safeContext = context && typeof context === 'object'
    ? Object.assign({}, context)
    : {};
  safeContext.mode = mode;
  template.context = safeContext;
  template.mode = mode;
  if (context && typeof context === 'object') {
    Object.keys(context).forEach(key => {
      try {
        template[key] = context[key];
      } catch (error) {
        logMailError_('テンプレートプロパティの設定に失敗しました', error, { key });
      }
    });
  }
  return template.evaluate();
}

function stripHtmlToPlainText_(input) {
  if (!input) {
    return '';
  }
  return String(input)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6])>/gi, '\n')
    .replace(/<\s*li\s*>/gi, '\n・')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderParticipantMailPlainText_(context) {
  const lines = [];
  if (context.participantName) {
    lines.push(`${context.participantName} 様`, '');
  }
  const eventName = coalesceStrings_(context.eventName, context.eventId, 'イベント');
  lines.push(`「${eventName}」にご参加いただきありがとうございます。`);
  if (context.tagline) {
    lines.push('', context.tagline);
  }
  if (context.scheduleRangeLabel) {
    lines.push('', `ご参加予定日時: ${context.scheduleRangeLabel}`);
  } else if (context.scheduleLabel) {
    lines.push('', `ご参加予定: ${context.scheduleLabel}`);
  }
  if (context.location) {
    lines.push('', `会場: ${context.location}`);
  }
  if (context.arrivalNote) {
    lines.push('', context.arrivalNote);
  }
  if (context.guidance) {
    lines.push('', context.guidance);
  }
  if (context.additionalText) {
    lines.push('', context.additionalText);
  }
  if (context.additionalHtml) {
    const htmlText = stripHtmlToPlainText_(context.additionalHtml);
    if (htmlText) {
      lines.push('', htmlText);
    }
  }
  if (context.webViewUrl) {
    lines.push('', `メールが正しく表示されない場合: ${context.webViewUrl}`);
  }
  if (context.contactLinkUrl && !/^mailto:/i.test(context.contactLinkUrl)) {
    lines.push('', `お問い合わせフォーム: ${context.contactLinkUrl}`);
  }
  if (context.contactEmail) {
    lines.push('', `お問い合わせ先: ${context.contactEmail}`);
  }
  if (context.footerNote) {
    lines.push('', context.footerNote);
  }
  lines.push('', context.senderName || 'イベント運営チーム');
  return lines.join('\n');
}

function sendParticipantMail_(principal, req) {
  const eventId = normalizeEventId_(req && req.eventId);
  const scheduleId = normalizeKey_(req && req.scheduleId);
  if (!eventId) {
    throw new Error('eventId is required.');
  }
  if (!scheduleId) {
    throw new Error('scheduleId is required.');
  }
  assertOperatorForEvent_(principal, eventId);

  const force = req && req.force === true;
  logMail_('参加者メール送信処理を開始します', {
    eventId,
    scheduleId,
    force
  });
  const accessToken = getFirebaseAccessToken_();
  const eventRecord = fetchRtdb_(`questionIntake/events/${eventId}`, accessToken) || {};
  const scheduleRecord = fetchRtdb_(`questionIntake/schedules/${eventId}/${scheduleId}`, accessToken) || {};
  if (!scheduleRecord || typeof scheduleRecord !== 'object') {
    throw new Error('指定された日程が見つかりません。');
  }
  const participantsBranch = fetchRtdb_(`questionIntake/participants/${eventId}/${scheduleId}`, accessToken) || {};
  logMail_('参加者情報を取得しました', {
    eventId,
    scheduleId,
    participantCount: Object.keys(participantsBranch || {}).length
  });
  const settings = getParticipantMailSettings_();
  const baseUrl = getWebAppBaseUrl_();
  const normalizedPrincipalEmail = normalizeEmail_(principal && principal.email);
  const fallbackContactEmail = coalesceStrings_(settings.contactEmail, normalizedPrincipalEmail);
  const senderName = settings.senderName || String(eventRecord && eventRecord.name || '').trim() || 'イベント運営チーム';

  const recipients = [];
  let skippedMissingEmail = 0;
  let skippedAlreadySent = 0;

  Object.keys(participantsBranch || {}).forEach(participantKey => {
    const value = participantsBranch[participantKey];
    if (!value || typeof value !== 'object') {
      return;
    }
    const email = String(value.email || '').trim();
    if (!email) {
      skippedMissingEmail += 1;
      return;
    }
    const status = String(value.mailStatus || '').trim().toLowerCase();
    const mailSentAt = Number(value.mailSentAt || 0);
    const mailError = String(value.mailError || '').trim();
    if (!force && status === 'sent' && !mailError && mailSentAt > 0) {
      skippedAlreadySent += 1;
      return;
    }
    recipients.push({ id: participantKey, record: value, email });
  });

  logMail_('メール送信対象の参加者を抽出しました', {
    eventId,
    scheduleId,
    totalParticipants: Object.keys(participantsBranch || {}).length,
    recipients: recipients.length,
    skippedMissingEmail,
    skippedAlreadySent
  });

  if (!recipients.length) {
    logMail_('送信対象が存在しないためメール送信を終了します', {
      eventId,
      scheduleId,
      skippedMissingEmail,
      skippedAlreadySent
    });
    return {
      summary: {
        total: 0,
        sent: 0,
        failed: 0,
        skippedMissingEmail,
        skippedAlreadySent
      },
      results: [],
      message: '送信対象の参加者が見つかりませんでした。'
    };
  }

  const remainingQuota = MailApp.getRemainingDailyQuota();
  logMail_('残りのメール送信枠を確認しました', {
    remainingQuota,
    required: recipients.length
  });
  if (remainingQuota < recipients.length) {
    logMailError_('メール送信枠が不足しています', null, {
      remainingQuota,
      required: recipients.length
    });
    throw new Error(`本日の残り送信可能数（${remainingQuota}件）を超えるため送信できません。`);
  }

  const updates = {};
  const results = [];
  let sentCount = 0;
  let failedCount = 0;

  recipients.forEach(({ id, record, email }) => {
    const participantRecord = Object.assign({}, record, { participantId: id });
    logMail_('参加者へのメール送信を試行します', {
      participantId: id,
      email
    });
    const context = buildParticipantMailContext_(
      eventId,
      scheduleId,
      participantRecord,
      eventRecord,
      scheduleRecord,
      settings,
      baseUrl
    );
    context.contactEmail = coalesceStrings_(context.contactEmail, fallbackContactEmail);
    context.senderName = senderName;
    enrichParticipantMailContext_(context, settings);
    const subject = buildParticipantMailSubject_(context, settings);
    context.subject = subject;
    const htmlBody = createParticipantMailTemplateOutput_(context, 'email').getContent();
    const textBody = renderParticipantMailPlainText_(context);
    const contactEmail = String(context.contactEmail || '').trim();
    const attemptAt = Date.now();
    try {
      MailApp.sendEmail({
        to: email,
        subject,
        htmlBody,
        body: textBody,
        name: senderName || context.eventName || '',
        replyTo: contactEmail || undefined
      });
      sentCount += 1;
      logMail_('参加者へのメール送信に成功しました', {
        participantId: id,
        email,
        attemptAt,
        subject
      });
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailStatus`] = 'sent';
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailSentAt`] = attemptAt;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastSubject`] = subject;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastMessageId`] = '';
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailError`] = null;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailSentBy`] =
        normalizedPrincipalEmail || contactEmail || '';
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptAt`] = attemptAt;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptBy`] =
        normalizedPrincipalEmail || contactEmail || '';
      results.push({
        participantId: id,
        mailStatus: 'sent',
        mailSentAt: attemptAt,
        mailLastSubject: subject,
        mailLastMessageId: '',
        mailError: '',
        mailSentBy: normalizedPrincipalEmail || contactEmail || '',
        mailLastAttemptAt: attemptAt,
        mailLastAttemptBy: normalizedPrincipalEmail || contactEmail || ''
      });
    } catch (error) {
      failedCount += 1;
      const message = String(error && error.message || error || '送信に失敗しました。');
      logMailError_('参加者へのメール送信でエラーが発生しました', error, {
        participantId: id,
        email,
        attemptAt,
        subject,
        message
      });
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailStatus`] = 'error';
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailError`] = message;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastSubject`] = subject;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptAt`] = attemptAt;
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptBy`] =
        normalizedPrincipalEmail || contactEmail || '';
      results.push({
        participantId: id,
        mailStatus: 'error',
        mailError: message,
        mailLastSubject: subject,
        mailLastAttemptAt: attemptAt,
        mailLastAttemptBy: normalizedPrincipalEmail || contactEmail || ''
      });
    }
  });

  if (Object.keys(updates).length) {
    const timestamp = Date.now();
    updates[`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`] = timestamp;
    updates[`questionIntake/events/${eventId}/updatedAt`] = timestamp;
    patchRtdb_(updates, accessToken);
    logMail_('メール送信結果をRealtime Databaseへ反映しました', {
      eventId,
      scheduleId,
      updatedPaths: Object.keys(updates).length
    });
  } else {
    logMail_('Realtime Databaseへの更新はありませんでした', {
      eventId,
      scheduleId
    });
  }

  const summary = {
    total: recipients.length,
    sent: sentCount,
    failed: failedCount,
    skippedMissingEmail,
    skippedAlreadySent
  };

  const messageParts = [];
  if (sentCount > 0) {
    messageParts.push(`${sentCount}件のメールを送信しました。`);
  }
  if (failedCount > 0) {
    messageParts.push(`${failedCount}件でエラーが発生しました。`);
  }
  if (!messageParts.length) {
    messageParts.push('送信対象の参加者が見つかりませんでした。');
  }

  const logDetails = [
    `event=${eventId}`,
    `schedule=${scheduleId}`,
    `sent=${sentCount}`,
    `failed=${failedCount}`,
    `skipped_missing_email=${skippedMissingEmail}`,
    `skipped_sent=${skippedAlreadySent}`
  ].join(', ');
  logAction_(principal, 'sendParticipantMail', logDetails);

  const message = messageParts.join(' ');
  logMail_('参加者メール送信処理が完了しました', {
    eventId,
    scheduleId,
    sent: sentCount,
    failed: failedCount,
    skippedMissingEmail,
    skippedAlreadySent,
    message
  });

  return {
    summary,
    results,
    message
  };
}

function renderParticipantMailErrorPage_() {
  const output = HtmlService.createHtmlOutput(
    "<!DOCTYPE html><html lang='ja'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>リンクが無効です</title></head><body><main style=\"font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;max-width:560px;margin:0 auto;\"><h1>リンクが無効です</h1><p>アクセスされたリンクは無効、または期限が切れています。</p></main></body></html>"
  );
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function renderParticipantMailPage_(e) {
  const eventId = normalizeEventId_(e && e.parameter && e.parameter.eventId);
  const scheduleId = normalizeKey_(e && e.parameter && e.parameter.scheduleId);
  const participantId = normalizeKey_(e && e.parameter && (e.parameter.participantId || e.parameter.uid));
  const tokenParam = normalizeKey_(e && e.parameter && e.parameter.token);
  if (!eventId || !scheduleId || !participantId) {
    return renderParticipantMailErrorPage_();
  }
  logMail_('参加者メールプレビューページのレンダリングを開始します', {
    eventId,
    scheduleId,
    participantId
  });
  try {
    const accessToken = getFirebaseAccessToken_();
    const participant = fetchRtdb_(`questionIntake/participants/${eventId}/${scheduleId}/${participantId}`, accessToken);
    if (!participant || typeof participant !== 'object') {
      return renderParticipantMailErrorPage_();
    }
    const storedToken = String(participant.token || '').trim();
    if (storedToken) {
      const normalizedParam = String(tokenParam || '').trim();
      if (!normalizedParam || normalizedParam !== storedToken) {
        return renderParticipantMailErrorPage_();
      }
    }
    const eventRecord = fetchRtdb_(`questionIntake/events/${eventId}`, accessToken) || {};
    const scheduleRecord = fetchRtdb_(`questionIntake/schedules/${eventId}/${scheduleId}`, accessToken) || {};
    const settings = getParticipantMailSettings_();
    const baseUrl = getWebAppBaseUrl_();
    const context = buildParticipantMailContext_(
      eventId,
      scheduleId,
      Object.assign({}, participant, { participantId }),
      eventRecord,
      scheduleRecord,
      settings,
      baseUrl
    );
    const subject = buildParticipantMailSubject_(context, settings);
    context.subject = subject;
    context.contactEmail = coalesceStrings_(context.contactEmail, settings.contactEmail);
    context.senderName = coalesceStrings_(context.senderName, settings.senderName);
    enrichParticipantMailContext_(context, settings);
    const output = createParticipantMailTemplateOutput_(context, 'web');
    output.setTitle(`${context.eventName || 'ご案内'} - ${context.scheduleLabel || ''}`);
    output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    output.addMetaTag('referrer', 'no-referrer');
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    logMail_('参加者メールプレビューページのレンダリングが完了しました', {
      eventId,
      scheduleId,
      participantId
    });
    return output;
  } catch (error) {
    logMailError_('参加者メールプレビューページのレンダリングに失敗しました', error, {
      eventId,
      scheduleId,
      participantId
    });
    console.error('renderParticipantMailPage_ failed', error);
    return renderParticipantMailErrorPage_();
  }
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

function normalizeKey_(value) {
  return String(value || '').trim();
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEventId_(eventId) {
  return normalizeKey_(eventId);
}

function normalizeScheduleId_(scheduleId) {
  const normalized = normalizeKey_(scheduleId);
  return normalized || DEFAULT_SCHEDULE_KEY;
}

function toPositiveInteger_(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  if (!isFinite(number) || number <= 0) {
    return null;
  }
  return Math.round(number);
}

function buildScheduleKey_(eventId, scheduleId) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return '';
  }
  return eventKey + '::' + normalizeScheduleId_(scheduleId);
}

function buildRenderEventBasePath_(eventId, scheduleId) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return '';
  }
  const scheduleKey = normalizeScheduleId_(scheduleId);
  return `render/events/${eventKey}/${scheduleKey}`;
}

function getRenderStatePath_(eventId, scheduleId) {
  const basePath = buildRenderEventBasePath_(eventId, scheduleId);
  return basePath ? `${basePath}/state` : 'render/state';
}

function getNowShowingPath_(eventId, scheduleId) {
  const basePath = buildRenderEventBasePath_(eventId, scheduleId);
  return basePath ? `${basePath}/nowShowing` : 'render/state/nowShowing';
}

function getEventActiveSchedulePath_(eventId) {
  const eventKey = normalizeEventId_(eventId);
  return eventKey ? `render/events/${eventKey}/activeSchedule` : '';
}

function getEventRotationPath_(eventId) {
  const eventKey = normalizeEventId_(eventId);
  return eventKey ? `render/events/${eventKey}/rotationAssignments` : '';
}

function getActiveSchedulePathForSession_(session) {
  if (!session || typeof session !== 'object') {
    return '';
  }
  const assignment = session.assignment && typeof session.assignment === 'object' ? session.assignment : null;
  if (assignment && normalizeEventId_(assignment.eventId)) {
    return getEventActiveSchedulePath_(assignment.eventId);
  }
  if (normalizeEventId_(session.eventId)) {
    return getEventActiveSchedulePath_(session.eventId);
  }
  return '';
}

function buildActiveScheduleRecord_(assignment, session, operatorUid) {
  if (!assignment || typeof assignment !== 'object') {
    return null;
  }
  const eventId = normalizeEventId_(assignment.eventId);
  if (!eventId) {
    return null;
  }
  const scheduleId = normalizeScheduleId_(assignment.scheduleId);
  const scheduleKey = buildScheduleKey_(eventId, scheduleId);
  const sessionUid = normalizeKey_(session && session.uid);
  const sessionId = normalizeKey_(session && session.sessionId);
  const lockedAt = Number(assignment.lockedAt || Date.now());
  return {
    eventId,
    scheduleId,
    scheduleKey,
    scheduleLabel: String(assignment.scheduleLabel || '').trim(),
    mode: 'locked',
    lockedAt,
    updatedAt: lockedAt,
    lockedByUid: normalizeKey_(assignment.lockedByUid || operatorUid),
    lockedByEmail: String(assignment.lockedByEmail || '').trim(),
    lockedByName: String(assignment.lockedByName || '').trim(),
    sessionUid,
    sessionId,
    expiresAt: Number(session && session.expiresAt || 0) || null
  };
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

function putRtdb_(path, data, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(data),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('RTDB put failed: HTTP ' + code + ' ' + res.getContentText());
  }
}

function postRtdb_(path, data, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(data),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('RTDB post failed: HTTP ' + code + ' ' + res.getContentText());
  }
  const textBody = res.getContentText();
  return textBody ? JSON.parse(textBody) : null;
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
  const current = fetchRtdb_('render/session', token);
  const updates = {};
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error('Missing display uid for session start');
  }

  const previousUid = normalizeKey_(current && current.uid);
  if (current && current.sessionId) {
    const normalizedCurrentUid = normalizeKey_(current.uid);
    const currentExpires = Number(current.expiresAt || 0);
    const currentExpired = currentExpires && currentExpires <= now;
    if (normalizedCurrentUid && normalizedCurrentUid !== principalUid) {
      updates[`screens/approved/${normalizedCurrentUid}`] = null;
      updates[`screens/sessions/${normalizedCurrentUid}`] = Object.assign({}, current, {
        status: currentExpired ? 'expired' : 'superseded',
        endedAt: now,
        expiresAt: now,
        lastSeenAt: Number(current.lastSeenAt || now)
      });
      updates[`render/displayPresence/${normalizedCurrentUid}`] = null;
    } else if (normalizedCurrentUid && normalizedCurrentUid === principalUid && currentExpired) {
      updates[`screens/sessions/${normalizedCurrentUid}`] = Object.assign({}, current, {
        status: 'expired',
        endedAt: now,
        expiresAt: now,
        lastSeenAt: Number(current.lastSeenAt || now)
      });
      updates[`render/displayPresence/${normalizedCurrentUid}`] = null;
    }
    const previousActivePath = getActiveSchedulePathForSession_(current);
    if (previousActivePath) {
      updates[previousActivePath] = null;
    }
  }
  if (previousUid && previousUid !== principalUid) {
    updates[`render/displayPresence/${previousUid}`] = null;
  }

  const sessionId = Utilities.getUuid();
  const expiresAt = now + DISPLAY_SESSION_TTL_MS;
  let preservedAssignment = null;
  if (current && current.assignment && typeof current.assignment === 'object') {
    const preservedEvent = normalizeKey_(current.assignment.eventId);
    const preservedSchedule = normalizeScheduleId_(current.assignment.scheduleId);
    preservedAssignment = Object.assign({}, current.assignment, {
      eventId: preservedEvent,
      scheduleId: preservedSchedule,
      scheduleLabel: String(current.assignment.scheduleLabel || '').trim(),
      scheduleKey: buildScheduleKey_(preservedEvent, preservedSchedule)
    });
    if (!preservedAssignment.scheduleLabel) {
      preservedAssignment.scheduleLabel = preservedSchedule === DEFAULT_SCHEDULE_KEY
        ? '未選択'
        : (preservedSchedule || preservedEvent);
    }
  }
  const session = {
    uid: principalUid,
    sessionId,
    status: 'active',
    startedAt: now,
    lastSeenAt: now,
    expiresAt,
    grantedBy: 'gas'
  };
  if (preservedAssignment) {
    session.assignment = preservedAssignment;
    session.eventId = preservedAssignment.eventId;
    session.scheduleId = preservedAssignment.scheduleId;
    session.scheduleLabel = preservedAssignment.scheduleLabel;
  } else if (current) {
    if (current.eventId) session.eventId = normalizeKey_(current.eventId);
    if (current.scheduleId) session.scheduleId = normalizeScheduleId_(current.scheduleId);
    if (current.scheduleLabel) session.scheduleLabel = String(current.scheduleLabel || '').trim();
  }

  updates[`screens/approved/${principalUid}`] = true;
  updates[`screens/sessions/${principalUid}`] = session;
  updates['render/session'] = session;
  updates[`render/displayPresence/${principalUid}`] = null;
  const activeSchedulePath = getActiveSchedulePathForSession_(session);
  const activeRecord = buildActiveScheduleRecord_(session.assignment, session, principalUid);
  if (activeSchedulePath && activeRecord) {
    updates[activeSchedulePath] = activeRecord;
  }
  patchRtdb_(updates, token);
  return { session };
}

function heartbeatDisplaySession_(principal, rawSessionId) {
  ensureDisplayPrincipal_(principal, 'Only anonymous display accounts can send heartbeats');
  const sessionId = requireSessionId_(rawSessionId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const current = fetchRtdb_('render/session', token);
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error('Missing display uid for heartbeat');
  }
  const currentUid = normalizeKey_(current && current.uid);
  if (!current || currentUid !== principalUid || current.sessionId !== sessionId) {
    const updates = {};
    if (current && Number(current.expiresAt || 0) <= now) {
      updates['render/session'] = null;
      if (currentUid) {
        updates[`screens/approved/${currentUid}`] = null;
        updates[`screens/sessions/${currentUid}`] = Object.assign({}, current, {
          status: 'expired',
          endedAt: now,
          expiresAt: now,
          lastSeenAt: Number(current.lastSeenAt || now)
        });
        updates[`render/displayPresence/${currentUid}`] = null;
      }
      const activePath = getActiveSchedulePathForSession_(current);
      if (activePath) {
        updates[activePath] = null;
      }
    }
    updates[`render/displayPresence/${principalUid}`] = null;
    patchRtdb_(updates, token);
    return { active: false };
  }

  if (Number(current.expiresAt || 0) <= now) {
    const updates = {};
    updates['render/session'] = null;
    updates[`screens/approved/${currentUid}`] = null;
    updates[`screens/sessions/${currentUid}`] = Object.assign({}, current, {
      status: 'expired',
      endedAt: now,
      expiresAt: now,
      lastSeenAt: Number(current.lastSeenAt || now)
    });
    const activePath = getActiveSchedulePathForSession_(current);
    if (activePath) {
      updates[activePath] = null;
    }
    updates[`render/displayPresence/${currentUid}`] = null;
    patchRtdb_(updates, token);
    return { active: false };
  }

  const session = Object.assign({}, current, {
    status: 'active',
    lastSeenAt: now,
    expiresAt: now + DISPLAY_SESSION_TTL_MS,
    uid: principalUid
  });
  const updates = {};
  updates[`screens/approved/${principalUid}`] = true;
  updates[`screens/sessions/${principalUid}`] = session;
  updates['render/session'] = session;
  updates[`render/displayPresence/${principalUid}`] = null;
  patchRtdb_(updates, token);
  return { active: true, session };
}

function endDisplaySession_(principal, rawSessionId, reason) {
  ensureDisplayPrincipal_(principal, 'Only anonymous display accounts can end sessions');
  const sessionId = requireSessionId_(rawSessionId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const current = fetchRtdb_('render/session', token);
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error('Missing display uid for session end');
  }
  const currentUid = normalizeKey_(current && current.uid);
  if (!current || currentUid !== principalUid || current.sessionId !== sessionId) {
    return { ended: false };
  }

  const session = Object.assign({}, current, {
    status: 'ended',
    endedAt: now,
    expiresAt: now,
    lastSeenAt: now,
    endedReason: reason || null,
    uid: principalUid
  });
  const updates = {};
  updates[`screens/approved/${principalUid}`] = null;
  updates[`screens/sessions/${principalUid}`] = session;
  updates['render/session'] = null;
  updates[`render/displayPresence/${principalUid}`] = null;
  const activePath = getActiveSchedulePathForSession_(current);
  if (activePath) {
    updates[activePath] = null;
  }
  patchRtdb_(updates, token);
  return { ended: true };
}

function lockDisplaySchedule_(principal, rawEventId, rawScheduleId, rawScheduleLabel, rawOperatorName) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error('eventId is required.');
  }
  const scheduleId = normalizeKey_(rawScheduleId);
  const scheduleLabel = String(rawScheduleLabel || '').trim();
  const operatorName = String(rawOperatorName || '').trim();
  const operatorUid = normalizeKey_(principal && principal.uid);
  if (!operatorUid) {
    throw new Error('操作アカウントを特定できませんでした。');
  }
  assertOperatorForEvent_(principal, eventId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const session = fetchRtdb_('render/session', token);
  if (!session || session.status !== 'active') {
    throw new Error('ディスプレイのセッションが有効ではありません。');
  }
  if (Number(session.expiresAt || 0) <= now) {
    throw new Error('ディスプレイのセッションが期限切れです。');
  }
  const sessionUid = normalizeKey_(session.uid);
  if (!sessionUid) {
    throw new Error('ディスプレイのセッション情報が不完全です。');
  }
  const normalizedScheduleId = normalizeScheduleId_(scheduleId);
  const scheduleKey = buildScheduleKey_(eventId, normalizedScheduleId);
  const existingAssignment = session.assignment && typeof session.assignment === 'object' ? session.assignment : null;
  if (existingAssignment) {
    const existingKey = buildScheduleKey_(existingAssignment.eventId, existingAssignment.scheduleId);
    const lockedByUid = normalizeKey_(existingAssignment.lockedByUid);
    if (existingKey === scheduleKey) {
      return {
        assignment: Object.assign({}, existingAssignment, { scheduleKey: existingKey })
      };
    }
    if (lockedByUid && lockedByUid !== operatorUid) {
      throw new Error('他のオペレーターがディスプレイを固定しています。');
    }
  }
  const fallbackLabel = normalizedScheduleId === DEFAULT_SCHEDULE_KEY ? '未選択' : normalizedScheduleId || eventId;
  const assignment = {
    eventId,
    scheduleId: normalizedScheduleId,
    scheduleLabel: scheduleLabel || fallbackLabel,
    scheduleKey,
    lockedAt: now,
    lockedByUid: operatorUid,
    lockedByEmail: String(principal.email || '').trim(),
    lockedByName: operatorName || String(principal.email || '').trim()
  };
  const nextSession = Object.assign({}, session, {
    eventId,
    scheduleId: normalizedScheduleId,
    scheduleLabel: assignment.scheduleLabel,
    assignment
  });
  const updates = {};
  if (existingAssignment) {
    const previousActivePath = getEventActiveSchedulePath_(existingAssignment.eventId);
    const nextActivePath = getEventActiveSchedulePath_(eventId);
    if (previousActivePath && previousActivePath !== nextActivePath) {
      updates[previousActivePath] = null;
    }
  }
  updates[`screens/approved/${sessionUid}`] = true;
  updates[`screens/sessions/${sessionUid}`] = nextSession;
  updates['render/session'] = nextSession;
  const activeSchedulePath = getEventActiveSchedulePath_(eventId);
  const activeRecord = buildActiveScheduleRecord_(assignment, nextSession, operatorUid);
  if (activeSchedulePath && activeRecord) {
    updates[activeSchedulePath] = activeRecord;
  }
  const rotationPath = getEventRotationPath_(eventId);
  if (rotationPath) {
    updates[rotationPath] = null;
  }
  patchRtdb_(updates, token);
  return { assignment };
}

function normalizeRotationEntries_(eventId, rawEntries) {
  const list = Array.isArray(rawEntries) ? rawEntries : [];
  const seenKeys = new Set();
  const normalized = [];
  list.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const scheduleId = normalizeScheduleId_(entry.scheduleId);
    const scheduleKey = buildScheduleKey_(eventId, scheduleId);
    if (!scheduleKey) {
      return;
    }
    if (seenKeys.has(scheduleKey)) {
      return;
    }
    seenKeys.add(scheduleKey);
    const label = String(entry.scheduleLabel || entry.label || '').trim();
    const dwellMs = toPositiveInteger_(entry.dwellMs)
      || toPositiveInteger_(entry.durationMs)
      || (toPositiveInteger_(entry.dwellSeconds) ? toPositiveInteger_(entry.dwellSeconds) * 1000 : null)
      || (toPositiveInteger_(entry.durationSeconds) ? toPositiveInteger_(entry.durationSeconds) * 1000 : null);
    const record = {
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel: label,
      dwellMs: dwellMs || null,
      order: normalized.length
    };
    if (record.dwellMs != null) {
      record.dwellSeconds = Math.round(record.dwellMs / 100) / 10;
    }
    normalized.push(record);
  });
  return normalized;
}

function buildRotationActiveScheduleRecord_(eventId, rotationRecord, timestamp) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return null;
  }
  const now = Number(timestamp || (rotationRecord && rotationRecord.updatedAt)) || Date.now();
  const updatedByUid = normalizeKey_(rotationRecord && rotationRecord.updatedByUid);
  const updatedByEmail = String(rotationRecord && rotationRecord.updatedByEmail || '').trim();
  let updatedByName = String(rotationRecord && rotationRecord.updatedByName || '').trim();
  if (!updatedByName) {
    updatedByName = updatedByEmail || updatedByUid || '';
  }
  const dwellDefault = toPositiveInteger_(rotationRecord && rotationRecord.dwellMsDefault) || null;
  const entries = Array.isArray(rotationRecord && rotationRecord.entries) ? rotationRecord.entries : [];
  return {
    eventId: eventKey,
    mode: 'rotation',
    type: 'rotation',
    scheduleId: null,
    scheduleKey: null,
    scheduleLabel: 'rotation',
    lockedAt: now,
    lockedByUid: updatedByUid,
    lockedByEmail: updatedByEmail,
    lockedByName: updatedByName,
    sessionUid: null,
    sessionId: null,
    expiresAt: null,
    rotation: {
      entries,
      dwellMsDefault: dwellDefault
    },
    updatedAt: now
  };
}

function saveScheduleRotation_(principal, rawEventId, rawRotationEntries, rawOptions) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error('eventId is required.');
  }
  assertOperatorForEvent_(principal, eventId);

  let entriesSource = rawRotationEntries;
  if (entriesSource && typeof entriesSource === 'object' && !Array.isArray(entriesSource)) {
    entriesSource = entriesSource.entries;
  }
  if (!Array.isArray(entriesSource) && rawOptions && Array.isArray(rawOptions.entries)) {
    entriesSource = rawOptions.entries;
  }

  const entries = normalizeRotationEntries_(eventId, entriesSource);
  if (!entries.length) {
    throw new Error('ローテーションに設定する日程を1件以上指定してください。');
  }

  const operatorUid = normalizeKey_(principal && principal.uid);
  const operatorEmail = String(principal && principal.email || '').trim();
  const operatorName = String(rawOptions && rawOptions.operatorName || '').trim();
  const defaultDwell = toPositiveInteger_(rawOptions && (rawOptions.defaultDwellMs || rawOptions.defaultDurationMs)) || null;
  const now = Date.now();
  const rotationRecord = {
    eventId,
    entries,
    dwellMsDefault: defaultDwell,
    updatedAt: now,
    updatedByUid: operatorUid,
    updatedByEmail: operatorEmail,
    updatedByName: operatorName || operatorEmail || operatorUid || ''
  };

  const token = getFirebaseAccessToken_();
  const updates = {};
  const rotationPath = getEventRotationPath_(eventId);
  if (rotationPath) {
    updates[rotationPath] = rotationRecord;
  }
  const activePath = getEventActiveSchedulePath_(eventId);
  const activeRecord = buildRotationActiveScheduleRecord_(eventId, rotationRecord, now);
  if (activePath && activeRecord) {
    updates[activePath] = activeRecord;
  }
  patchRtdb_(updates, token);
  return { rotation: rotationRecord, active: activeRecord };
}

function clearScheduleRotation_(principal, rawEventId) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error('eventId is required.');
  }
  assertOperatorForEvent_(principal, eventId);
  const token = getFirebaseAccessToken_();
  const updates = {};
  const rotationPath = getEventRotationPath_(eventId);
  if (rotationPath) {
    updates[rotationPath] = null;
  }
  const activePath = getEventActiveSchedulePath_(eventId);
  if (activePath) {
    let currentActive = null;
    try {
      currentActive = fetchRtdb_(activePath, token);
    } catch (error) {
      currentActive = null;
    }
    const mode = String(currentActive && (currentActive.mode || currentActive.type) || '').toLowerCase();
    if (!currentActive || mode === 'rotation') {
      updates[activePath] = null;
    }
  }
  if (!Object.keys(updates).length) {
    return { cleared: false };
  }
  patchRtdb_(updates, token);
  return { cleared: true };
}

let eventOperatorAclCache_ = null;

function parseEventOperatorAclRaw_(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw !== 'string') {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed[0] === '{') {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (error) {
      // fall through to line parsing
    }
  }
  const map = {};
  const segments = trimmed.split(/[\n;]+/);
  segments.forEach(segment => {
    const value = String(segment || '').trim();
    if (!value) {
      return;
    }
    let separatorIndex = value.indexOf(':');
    const equalsIndex = value.indexOf('=');
    if (separatorIndex === -1 || (equalsIndex !== -1 && equalsIndex < separatorIndex)) {
      separatorIndex = equalsIndex;
    }
    if (separatorIndex === -1) {
      return;
    }
    const key = value.slice(0, separatorIndex).trim();
    const rest = value.slice(separatorIndex + 1).trim();
    if (!key || !rest) {
      return;
    }
    map[key] = rest.split(',').map(item => String(item || '').trim()).filter(Boolean);
  });
  return map;
}

function getEventOperatorAcl_() {
  if (eventOperatorAclCache_) {
    return eventOperatorAclCache_;
  }
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty('EVENT_OPERATOR_ACL') || '';
  const parsed = parseEventOperatorAclRaw_(raw);
  const normalized = {};
  Object.keys(parsed || {}).forEach(key => {
    const trimmedKey = String(key || '').trim();
    if (!trimmedKey) {
      return;
    }
    const entries = Array.isArray(parsed[key]) ? parsed[key] : [];
    const normalizedEntries = entries
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (!normalizedEntries.length) {
      normalized[trimmedKey === '*' ? '_default' : normalizeEventId_(trimmedKey) || trimmedKey] = [];
      return;
    }
    if (trimmedKey === '*' || trimmedKey === '_default') {
      normalized['_default'] = normalizedEntries;
    } else {
      const eventKey = normalizeEventId_(trimmedKey);
      if (eventKey) {
        normalized[eventKey] = normalizedEntries;
      }
    }
  });
  eventOperatorAclCache_ = normalized;
  return normalized;
}

function isOperatorAllowedForEvent_(principal, eventId) {
  const acl = getEventOperatorAcl_();
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return false;
  }
  const email = normalizeEmail_(principal && principal.email);
  if (!email) {
    return false;
  }
  let list = [];
  let explicit = false;
  if (acl && Object.prototype.hasOwnProperty.call(acl, eventKey)) {
    list = acl[eventKey];
    explicit = true;
  } else if (acl && Object.prototype.hasOwnProperty.call(acl, '_default')) {
    list = acl['_default'];
  }
  if (!Array.isArray(list) || !list.length) {
    return !explicit;
  }
  return list.some(entry => {
    const raw = String(entry || '').trim();
    if (!raw) {
      return false;
    }
    if (raw === '*' || raw.toLowerCase() === 'all') {
      return true;
    }
    if (raw[0] === '@') {
      return email.endsWith(raw.toLowerCase());
    }
    return normalizeEmail_(raw) === email;
  });
}

function assertOperatorForEvent_(principal, eventId) {
  assertOperator_(principal);
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    throw new Error('eventId is required.');
  }
  if (!isOperatorAllowedForEvent_(principal, eventKey)) {
    throw new Error('このイベントに対する操作権限がありません。');
  }
}
function normalizeDictionaryEnabled_(value) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['', '0', 'false', 'off', 'no'].includes(normalized)) {
      return false;
    }
    if (['1', 'true', 'on', 'yes'].includes(normalized)) {
      return true;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return Boolean(value);
}

function normalizeDictionaryTermKey_(value) {
  return normalizeNameForLookup_(value).toLowerCase();
}

function loadDictionaryBranch_() {
  const token = getFirebaseAccessToken_();
  const branch = fetchRtdb_('dictionary', token) || {};
  return { token, branch };
}

function resolveDictionaryEntry_(branch, uid) {
  if (!branch || typeof branch !== 'object') {
    return null;
  }
  const key = String(uid || '').trim();
  if (!key) {
    return null;
  }
  const entry = branch[key];
  if (!entry) {
    return null;
  }
  return {
    uid: key,
    term: String(entry.term || '').trim(),
    ruby: String(entry.ruby || '').trim(),
    enabled: normalizeDictionaryEnabled_(entry.enabled),
    createdAt: parseDateToMillis_(entry.createdAt, 0),
    updatedAt: parseDateToMillis_(entry.updatedAt, 0)
  };
}

function findDictionaryUidByTerm_(branch, termKey) {
  if (!branch || typeof branch !== 'object') {
    return '';
  }
  const normalizedKey = String(termKey || '').trim();
  if (!normalizedKey) {
    return '';
  }
  const entries = Object.entries(branch);
  for (let i = 0; i < entries.length; i++) {
    const [uid, entry] = entries[i];
    const candidateKey = normalizeDictionaryTermKey_(entry && entry.term);
    if (candidateKey === normalizedKey) {
      return uid;
    }
  }
  return '';
}

function addDictionaryTerm(term, ruby, providedUid) {
  const normalizedTerm = String(term || '').trim();
  const normalizedRuby = String(ruby || '').trim();
  if (!normalizedTerm || !normalizedRuby) {
    throw new Error('Term and ruby are required.');
  }
  const { token, branch } = loadDictionaryBranch_();
  const termKey = normalizeDictionaryTermKey_(normalizedTerm);
  const now = Date.now();
  const existingUid = findDictionaryUidByTerm_(branch, termKey);
  const updates = {};
  if (existingUid) {
    const existing = resolveDictionaryEntry_(branch, existingUid) || {};
    updates[`dictionary/${existingUid}`] = {
      uid: existingUid,
      term: normalizedTerm,
      ruby: normalizedRuby,
      enabled: true,
      termKey,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    patchRtdb_(updates, token);
    return { success: true, message: `Term "${normalizedTerm}" updated.`, uid: existingUid };
  }
  const uid = String(providedUid || '').trim() || Utilities.getUuid();
  updates[`dictionary/${uid}`] = {
    uid,
    term: normalizedTerm,
    ruby: normalizedRuby,
    enabled: true,
    termKey,
    createdAt: now,
    updatedAt: now
  };
  patchRtdb_(updates, token);
  return { success: true, message: `Term "${normalizedTerm}" added.`, uid };
}

function updateDictionaryTerm(uid, term, ruby) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('uid is required.');
  }
  const normalizedTerm = String(term || '').trim();
  const normalizedRuby = String(ruby || '').trim();
  if (!normalizedTerm || !normalizedRuby) {
    throw new Error('Term and ruby are required.');
  }
  const { token, branch } = loadDictionaryBranch_();
  const current = resolveDictionaryEntry_(branch, normalizedUid);
  if (!current) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }
  const termKey = normalizeDictionaryTermKey_(normalizedTerm);
  const now = Date.now();
  const updates = {};
  updates[`dictionary/${normalizedUid}`] = {
    uid: normalizedUid,
    term: normalizedTerm,
    ruby: normalizedRuby,
    enabled: true,
    termKey,
    createdAt: current.createdAt || now,
    updatedAt: now
  };
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} updated.` };
}

function deleteDictionaryTerm(uid, term) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('uid is required.');
  }
  const { token, branch } = loadDictionaryBranch_();
  const current = resolveDictionaryEntry_(branch, normalizedUid);
  if (!current) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }
  const updates = {};
  updates[`dictionary/${normalizedUid}`] = null;
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} deleted.` };
}

function toggleDictionaryTerm(uid, enabled, term) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('uid is required.');
  }
  const normalizedEnabled = normalizeDictionaryEnabled_(enabled);
  const { token, branch } = loadDictionaryBranch_();
  const current = resolveDictionaryEntry_(branch, normalizedUid);
  if (!current) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }
  const now = Date.now();
  const termKey = normalizeDictionaryTermKey_(current.term || term || '');
  const updates = {};
  updates[`dictionary/${normalizedUid}`] = {
    uid: normalizedUid,
    term: current.term || String(term || '').trim(),
    ruby: current.ruby,
    enabled: normalizedEnabled,
    termKey,
    createdAt: current.createdAt || now,
    updatedAt: now
  };
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} toggled.` };
}

function batchDeleteDictionaryTerms(uids) {
  if (!Array.isArray(uids) || !uids.length) {
    return { success: true, message: 'No entries specified.' };
  }
  const normalized = uids.map(uid => String(uid || '').trim()).filter(Boolean);
  if (!normalized.length) {
    return { success: true, message: 'No entries specified.' };
  }
  const { token, branch } = loadDictionaryBranch_();
  const updates = {};
  let deleted = 0;
  normalized.forEach(uid => {
    if (resolveDictionaryEntry_(branch, uid)) {
      updates[`dictionary/${uid}`] = null;
      deleted++;
    }
  });
  if (deleted) {
    patchRtdb_(updates, token);
  }
  return { success: true, message: `${deleted} entries deleted.` };
}

function batchToggleDictionaryTerms(uids, enabled) {
  if (!Array.isArray(uids) || !uids.length) {
    return { success: true, message: 'No entries specified.' };
  }
  const normalized = uids.map(uid => String(uid || '').trim()).filter(Boolean);
  if (!normalized.length) {
    return { success: true, message: 'No entries specified.' };
  }
  const { token, branch } = loadDictionaryBranch_();
  const normalizedEnabled = normalizeDictionaryEnabled_(enabled);
  const now = Date.now();
  const updates = {};
  let updated = 0;
  normalized.forEach(uid => {
    const current = resolveDictionaryEntry_(branch, uid);
    if (!current) {
      return;
    }
    updates[`dictionary/${uid}`] = {
      uid,
      term: current.term,
      ruby: current.ruby,
      enabled: normalizedEnabled,
      termKey: normalizeDictionaryTermKey_(current.term),
      createdAt: current.createdAt || now,
      updatedAt: now
    };
    updated++;
  });
  if (updated) {
    patchRtdb_(updates, token);
  }
  return { success: true, message: `${updated} entries updated.` };
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

      const signalKey = kind ? `signals/${kind}` : 'signals/misc';
      const url = `${FIREBASE_DB_URL}/${signalKey}.json`;
      const payload = { triggeredAt: new Date().getTime() };

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
function toIsoJst_(d){ return Utilities.formatDate(d,'Asia/Tokyo',"yyyy-MM-dd'T'HH:mm:ssXXX"); }

function getSheetData_(sheetKey) {
  const normalized = String(sheetKey || '').trim().toLowerCase();
  if (normalized !== 'users') {
    throw new Error('Invalid sheet: ' + sheetKey);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('users');
  if (!sheet) {
    throw new Error('Sheet not found: users');
  }

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return [];
  }

  const headers = values[0].map((header, index) => {
    const label = String(header || '').trim();
    return label || `column_${index}`;
  });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.length === 0 || row.every(value => value === '' || value == null)) {
      continue;
    }
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = row[index];
    });
    rows.push(entry);
  }

  return rows;
}
function processQuestionSubmissionQueue_(providedAccessToken, options) {
  const accessToken = providedAccessToken || getFirebaseAccessToken_();
  const queueBranch = fetchRtdb_('questionIntake/submissions', accessToken) || {};
  const opts = options || {};
  let tokenFilter = null;
  if (opts && opts.tokenFilter != null) {
    const list = Array.isArray(opts.tokenFilter) ? opts.tokenFilter : [opts.tokenFilter];
    tokenFilter = new Set(list.map((value) => String(value || '').trim()).filter(Boolean));
  }

  const ensureString = (value) => String(value || '').trim();

  const queueTokens = Object.keys(queueBranch || {})
    .map((token) => ensureString(token))
    .filter((token) => {
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
  const updates = {};
  let processed = 0;
  let discarded = 0;

  queueTokens.forEach((token) => {
    const submissions = queueBranch[token] && typeof queueBranch[token] === 'object' ? queueBranch[token] : {};
    const tokenRecord = tokenRecords[token] || {};
    const revoked = tokenRecord && tokenRecord.revoked === true;
    const expiresAt = Number(tokenRecord && tokenRecord.expiresAt || 0);
    const eventId = ensureString(tokenRecord && tokenRecord.eventId);
    const scheduleId = ensureString(tokenRecord && tokenRecord.scheduleId);
    const participantId = ensureString(tokenRecord && tokenRecord.participantId);

    Object.keys(submissions).forEach((entryId) => {
      const submissionPath = `questionIntake/submissions/${token}/${entryId}`;
      const entry = submissions[entryId] && typeof submissions[entryId] === 'object' ? submissions[entryId] : null;

      updates[submissionPath] = null;

      if (!entry) {
        discarded += 1;
        return;
      }

      if (!tokenRecord || !eventId || !scheduleId || !participantId || revoked || (expiresAt && Date.now() > expiresAt)) {
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

        const now = Date.now();
        const timestampCandidate = Number(entry.submittedAt || entry.clientTimestamp || now);
        const ts = Number.isFinite(timestampCandidate) && timestampCandidate > 0 ? timestampCandidate : now;
        const scheduleLabel = ensureString(entry.scheduleLabel || tokenRecord.scheduleLabel);
        const scheduleDate = ensureString(entry.scheduleDate || tokenRecord.scheduleDate);
        const scheduleStart = ensureString(entry.scheduleStart || tokenRecord.scheduleStart);
        const scheduleEnd = ensureString(entry.scheduleEnd || tokenRecord.scheduleEnd);
        const eventName = ensureString(entry.eventName || tokenRecord.eventName);
        const participantName = ensureString(entry.participantName || tokenRecord.displayName);
        const guidance = ensureString(entry.guidance || tokenRecord.guidance);
        const genreValue = ensureString(entry.genre) || 'その他';
        const groupNumber = ensureString(entry.groupNumber || tokenRecord.teamNumber || tokenRecord.groupNumber);
        const providedUid = ensureString(entry.uid) || ensureString(entryId);
        const uid = providedUid || Utilities.getUuid();

        const record = {
          uid,
          name: radioName,
          question: questionText,
          genre: genreValue,
          group: groupNumber,
          teamNumber: groupNumber,
          schedule: scheduleLabel,
          scheduleDate,
          scheduleStart,
          scheduleEnd,
          eventId,
          eventName,
          scheduleId,
          participantId,
          participantName,
          guidance,
          token,
          ts,
          updatedAt: ts,
          type: 'normal'
        };

        if (Number.isFinite(questionLength) && questionLength > 0) {
          record.questionLength = Math.round(questionLength);
        }

        updates[`questions/normal/${uid}`] = record;
        updates[`questionStatus/${uid}`] = {
          answered: false,
          selecting: false,
          pickup: false,
          updatedAt: ts
        };
        processed += 1;
      } catch (error) {
        console.warn('Failed to process queued submission', error);
        discarded += 1;
      }
    });
  });

  if (Object.keys(updates).length) {
    patchRtdb_(updates, accessToken);
  }

  return { processed, discarded };
}

function resolveQuestionRecordForUid_(uid, token) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    return { branch: '', record: null };
  }
  const accessToken = token || getFirebaseAccessToken_();
  const branches = ['normal', 'pickup'];
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const path = `questions/${branch}/${normalizedUid}`;
    try {
      const record = fetchRtdb_(path, accessToken);
      if (record && typeof record === 'object') {
        return { branch, record, token: accessToken };
      }
    } catch (error) {
      // Ignore missing branch errors and continue searching other branches.
    }
  }
  return { branch: '', record: null, token: accessToken };
}

function updateAnswerStatus(uid, status) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('UID is required.');
  }

  const token = getFirebaseAccessToken_();
  const statusPath = `questionStatus/${normalizedUid}`;
  const currentStatus = fetchRtdb_(statusPath, token);
  if (!currentStatus || typeof currentStatus !== 'object') {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }

  const isAnswered = status === true || status === 'true' || status === 1 || status === '1';
  const now = Date.now();
  const updates = {};
  updates[`${statusPath}/answered`] = isAnswered;
  updates[`${statusPath}/updatedAt`] = now;

  const { branch } = resolveQuestionRecordForUid_(normalizedUid, token);
  if (branch) {
    updates[`questions/${branch}/${normalizedUid}/answered`] = isAnswered;
    updates[`questions/${branch}/${normalizedUid}/updatedAt`] = now;
  }

  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} updated.` };
}

function batchUpdateStatus(uids, status) {
  if (!Array.isArray(uids)) {
    throw new Error('UIDs array is required.');
  }
  const normalized = Array.from(new Set(
    uids
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  if (!normalized.length) {
    return { success: true, message: '0 items updated.' };
  }

  const token = getFirebaseAccessToken_();
  const statusBranch = fetchRtdb_('questionStatus', token) || {};
  const isAnswered = status === true || status === 'true' || status === 1 || status === '1';
  const now = Date.now();
  const updates = {};
  let updatedCount = 0;

  normalized.forEach((uid) => {
    if (!statusBranch || typeof statusBranch !== 'object' || !statusBranch[uid]) {
      return;
    }
    updatedCount += 1;
    updates[`questionStatus/${uid}/answered`] = isAnswered;
    updates[`questionStatus/${uid}/updatedAt`] = now;
    const { branch } = resolveQuestionRecordForUid_(uid, token);
    if (branch) {
      updates[`questions/${branch}/${uid}/answered`] = isAnswered;
      updates[`questions/${branch}/${uid}/updatedAt`] = now;
    }
  });

  if (!updatedCount) {
    return { success: true, message: '0 items updated.' };
  }

  patchRtdb_(updates, token);
  return { success: true, message: `${updatedCount} items updated.` };
}

function updateSelectingStatus(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('UID is required.');
  }
  const token = getFirebaseAccessToken_();
  const statusBranch = fetchRtdb_('questionStatus', token) || {};
  if (!statusBranch || typeof statusBranch !== 'object' || !statusBranch[normalizedUid]) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }

  const now = Date.now();
  const updates = {};
  Object.keys(statusBranch).forEach((key) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      return;
    }
    const selecting = normalizedKey === normalizedUid;
    updates[`questionStatus/${normalizedKey}/selecting`] = selecting;
    updates[`questionStatus/${normalizedKey}/updatedAt`] = now;
    const { branch } = resolveQuestionRecordForUid_(normalizedKey, token);
    if (branch) {
      updates[`questions/${branch}/${normalizedKey}/selecting`] = selecting;
      updates[`questions/${branch}/${normalizedKey}/updatedAt`] = now;
    }
  });

  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} is now selecting.` };
}

function clearSelectingStatus() {
  const token = getFirebaseAccessToken_();
  const statusBranch = fetchRtdb_('questionStatus', token) || {};
  if (!statusBranch || typeof statusBranch !== 'object') {
    return { success: true, changed: false };
  }

  const updates = {};
  let changed = false;
  const now = Date.now();
  Object.entries(statusBranch).forEach(([uid, record]) => {
    if (!uid) {
      return;
    }
    if (record && record.selecting === true) {
      changed = true;
      updates[`questionStatus/${uid}/selecting`] = false;
      updates[`questionStatus/${uid}/updatedAt`] = now;
      const { branch } = resolveQuestionRecordForUid_(uid, token);
      if (branch) {
        updates[`questions/${branch}/${uid}/selecting`] = false;
        updates[`questions/${branch}/${uid}/updatedAt`] = now;
      }
    }
  });

  if (changed) {
    patchRtdb_(updates, token);
  }

  return { success: true, changed };
}

function editQuestionText(uid, newText) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    throw new Error('UID is required.');
  }
  if (typeof newText === 'undefined') {
    throw new Error('New text is required.');
  }
  const trimmed = String(newText || '').trim();
  if (!trimmed) {
    throw new Error('質問内容を入力してください。');
  }

  const token = getFirebaseAccessToken_();
  const { branch, record } = resolveQuestionRecordForUid_(normalizedUid, token);
  if (!branch || !record) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }

  const now = Date.now();
  const updates = {};
  updates[`questions/${branch}/${normalizedUid}/question`] = trimmed;
  updates[`questions/${branch}/${normalizedUid}/updatedAt`] = now;
  updates[`questionStatus/${normalizedUid}/updatedAt`] = now;
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} question updated.` };
}