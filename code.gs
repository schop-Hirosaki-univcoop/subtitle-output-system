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
    const principal = requireAuth_(idToken, displayActions.has(action) ? { allowAnonymous: true } : {});

    switch (action) {
      case 'beginDisplaySession':
        return jsonOk(beginDisplaySession_(principal));
      case 'heartbeatDisplaySession':
        return jsonOk(heartbeatDisplaySession_(principal, req.sessionId));
      case 'endDisplaySession':
        return jsonOk(endDisplaySession_(principal, req.sessionId, req.reason));
      case 'ensureAdmin':
        return jsonOk(ensureAdmin_(principal));
      case 'mirrorSheet':
        assertOperator_(principal);
        return jsonOk(mirrorSheetToRtdb_());
      case 'fetchSheet':
        assertOperator_(principal);
        return jsonOk({ data: getSheetData_(req.sheet) });
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
    map[uid] = {
      uid,
      name: String(row[nameIdx] ?? ''),
      question: String(row[qIdx] ?? ''),
      group: String(groupVal ?? ''),
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
