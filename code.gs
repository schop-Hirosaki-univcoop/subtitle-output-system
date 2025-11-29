// code.gs: Google Apps Script上でSpreadsheetやFirebase連携を行うサーバー側スクリプトのエントリーです。

// === WebアプリのGETリクエスト入口 ==========================
// 通常はこのWebアプリはGETアクセスを想定しておらず、
// 405相当のレスポンスを返すだけ。
// ただし、特定のviewパラメータが付いているときだけ、
// 参加者メールプレビューやQAアップロード状況といった
// 「確認用ページ」を返すための裏口として使っている。
/**
 * WebAppとしてアクセスされた際に応答を生成するエントリポイント。
 * 通常のGETリクエストには405相当のJSONレスポンスを返しますが、
 * 特定のviewパラメータが付与された場合のみ、
 * 参加者メールプレビューやQAアップロード状況などの確認用ページを返します。
 * @param {GoogleAppsScript.Events.DoGet} e - リクエストコンテキスト
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  const viewParam =
    e && e.parameter ? String(e.parameter.view || "").trim() : "";
  const pathInfo = e && typeof e.pathInfo === "string" ? e.pathInfo.trim() : "";
  const view = viewParam || pathInfo;
  const normalizedView = view
    ? view.replace(/[^a-z0-9]/gi, "").toLowerCase()
    : "";
  if (normalizedView === "participantmail") {
    return renderParticipantMailPage_(e);
  }
  if (normalizedView === "qauploadstatus") {
    return renderQaUploadStatusResponse_(e);
  }
  return withCors_(
    ContentService.createTextOutput(
      JSON.stringify({ success: false, error: "GET not allowed" })
    ).setMimeType(ContentService.MimeType.JSON),
    getRequestOrigin_(e)
  );
}

const DISPLAY_SESSION_TTL_MS = 60 * 1000;
const DEFAULT_SCHEDULE_KEY = "__default_schedule__";
const ALLOWED_ORIGINS = [
  "https://schop-hirosaki-univcoop.github.io",
  "https://schop-hirosaki-univcoop.github.io/",
];

// === ログ用の安全な文字列化ユーティリティ =================
// ログに出したい情報をJSON文字列に変換するが、
// 循環参照や巨大オブジェクトが混ざっていても、
// スクリプトが落ちないように安全側に倒しながら文字列化する。
// ログに「何が起きたか」を残すための裏方。
function stringifyLogPayload_(payload) {
  const seen = [];
  return JSON.stringify(payload, function (key, value) {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Error) {
      return {
        name: value.name || "Error",
        message: value.message || String(value),
        stack: value.stack || "",
      };
    }
    if (typeof value === "function") {
      return `<Function ${value.name || "anonymous"}>`;
    }
    if (typeof value === "symbol") {
      return value.toString();
    }
    if (value && typeof value === "object") {
      if (seen.indexOf(value) !== -1) {
        return "<Circular>";
      }
      seen.push(value);
    }
    return value;
  });
}

// stringifyLogPayload_が扱えない値が来たときのフォールバック。
// 「とりあえず中身をそれっぽく文字列にしてログに残す」ための関数。
function stringifyLogValueFallback_(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    const parts = [];
    if (value.name) parts.push(value.name);
    if (value.message) parts.push(value.message);
    if (value.stack) parts.push(value.stack);
    return parts.join(" | ") || String(value);
  }
  try {
    return stringifyLogPayload_(value);
  } catch (err) {
    return `${Object.prototype.toString.call(value)} (stringify failed: ${
      err && err.message ? err.message : err
    })`;
  }
}

// === メール送信ログの書き込み ==============================
// メール送信に関するイベントをスプレッドシートの
// ログシートに1行追記する。
// 後から「いつ誰に何を送ったか」「どんなエラーが出たか」を
// 追跡できるようにするための記録用関数。
function writeMailLog_(severity, message, error, details) {
  const prefix = `[Mail][${severity}] ${message}`;
  if (typeof console !== "undefined") {
    const method =
      severity === "ERROR" ? "error" : severity === "WARN" ? "warn" : "log";
    const consoleTarget =
      (typeof console[method] === "function" ? console[method] : console.log) ||
      null;
    if (consoleTarget) {
      const consoleArgs = [prefix];
      if (error !== undefined && error !== null) {
        consoleArgs.push(error);
      }
      if (details !== undefined) {
        consoleArgs.push(details);
      }
      try {
        consoleTarget.apply(console, consoleArgs);
      } catch (consoleError) {
        try {
          if (typeof console.log === "function") {
            console.log(
              `${prefix} (console logging failed: ${
                consoleError && consoleError.message
                  ? consoleError.message
                  : consoleError
              })`
            );
          }
        } catch (ignore) {
          // ignore logging failures
        }
      }
    }
  }

  if (typeof Logger !== "undefined" && typeof Logger.log === "function") {
    const payload = {
      severity,
      message,
      timestamp: toIsoJst_(new Date()),
    };
    if (error !== undefined && error !== null) {
      payload.error = error;
    }
    if (details !== undefined) {
      payload.details = details;
    }
    try {
      Logger.log(stringifyLogPayload_(payload));
    } catch (serializationError) {
      Logger.log(
        `${prefix}${
          error ? ` | error=${stringifyLogValueFallback_(error)}` : ""
        }${
          details !== undefined
            ? ` | details=${stringifyLogValueFallback_(details)}`
            : ""
        }`
      );
      Logger.log(
        `[Mail][WARN] ログ詳細のJSON化に失敗しました: ${
          serializationError && serializationError.message
            ? serializationError.message
            : serializationError
        }`
      );
    }
  }

  try {
    const sheet = ensureMailLogSheet_();
    const timestamp = new Date();
    const row = [
      timestamp,
      severity,
      message,
      error !== undefined && error !== null
        ? stringifyLogValueFallback_(error)
        : "",
      details !== undefined ? stringifyLogValueFallback_(details) : "",
    ];
    sheet.appendRow(row);
  } catch (sheetLoggingError) {
    try {
      if (
        typeof console !== "undefined" &&
        typeof console.error === "function"
      ) {
        console.error(
          "[Mail][WARN] メールログのシート書き込みに失敗しました",
          sheetLoggingError
        );
      }
    } catch (ignoreConsoleError) {
      // ignore logging failures
    }
  }
}

// メール関連の通常ログを書き込むためのヘルパー。
// 毎回severityなどを意識せず、logMail_だけ呼べばOKにするための薄いラッパー。
function logMail_(message, details) {
  //  writeMailLog_('INFO', message, null, details);
}

// メール関連のエラーログ専用ヘルパー。
// エラー内容と合わせて、ログシートとLoggerの両方に記録する。
function logMailError_(message, error, details) {
  //  writeMailLog_('ERROR', message, error, details);
}

// === スプレッドシートの日付セルをDate型に変換する =========
// シリアル値や文字列など、シート上に入っている日付っぽい値を
// Google Apps ScriptのDateオブジェクトに変換するための共通処理。
// 「どのセルにも同じルールで」日付変換したいときに使う。
/**
 * Spreadsheetセル値をDateオブジェクトに変換します。
 * 数値シリアル値・UNIX秒・ISO文字列をサポートし、不正値はnullを返します。
 * @param {any} value
 * @returns {Date|null}
 */
function parseDateCell_(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === "number" && !isNaN(value)) {
    if (value > 1e12) return new Date(value);
    if (value > 1e10) return new Date(value * 1000);
    if (value > 20000 && value < 70000) {
      return new Date(Math.round((value - 25569) * 86400 * 1000));
    }
    if (value > 1e6) return new Date(value * 1000);
    if (value > 0) return new Date(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed.replace(" ", "T"));
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

// Date型や日付っぽい値を「ミリ秒の数値」に変換する。
// DBに保存したり大小比較したりするときに扱いやすくするためのヘルパー。
function parseDateToMillis_(value, fallback) {
  const date = parseDateCell_(value);
  if (date) {
    return date.getTime();
  }
  return fallback == null ? 0 : fallback;
}

// 画面やメールに出すための「日付ラベル」を組み立てる。
// 例: 2025/11/20(木) のような表記に揃える。
/**
 * セル値を人が読みやすいyyyy/MM/dd HH:mm形式に整形します。
 * 日付変換できない場合はトリムした文字列を返します。
 * @param {any} value
 * @returns {string}
 */
function formatDateLabel_(value) {
  const date = parseDateCell_(value);
  if (date) {
    return Utilities.formatDate(date, "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  }
  return String(value || "").trim();
}

// 値がDateならISO形式の文字列(2025-11-20T...Z)に変換し、
// それ以外なら元の値をそのまま返す。
// ログやデバッグ用に「日付をそれなりに読みやすく」するための関数。
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
  return String(value || "").trim();
}

// スケジュールの開始時刻・終了時刻から、
// 画面表示用の「◯◯〜◯◯」といったラベル文字列を作る。
// 片方しかない場合にもそれなりに見えるように整形する。
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
  return startLabel || endLabel || "";
}

// 複数の候補の中から、最初に見つかった「空でない文字列」を返す。
// 例: coalesceStrings_('', null, 'fallback', 'zzz') → 'fallback'
// 設定値やラベルの「優先順位付きデフォルト値」を決めたいときに使う。
function coalesceStrings_(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    const text = typeof value === "string" ? value : String(value);
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function truncateString_(value, maxLength) {
  const text = typeof value === "string" ? value : String(value || "");
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
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "y"
    );
  }
  return false;
}

function formatQuestionTimestamp_(value) {
  const date = parseDateCell_(value) || new Date();
  return Utilities.formatDate(date, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

const PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY = "participantMailTemplate:v3";
const PARTICIPANT_MAIL_TEMPLATE_FALLBACK_BASE_URL =
  "https://raw.githubusercontent.com/schop-hirosaki-univcoop/subtitle-output-system/main/";
const PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL =
  "https://schop-hirosaki-univcoop.github.io/subtitle-output-system/participant-mail-view.html";
const PARTICIPANT_MAIL_CONTACT_EMAIL = "gakui.hirosaki@gmail.com";
const PUBLIC_WEB_APP_FALLBACK_BASE_URL =
  "https://schop-hirosaki-univcoop.github.io/subtitle-output-system/";
const QUESTION_FORM_PAGE_FILENAME = "question-form.html";

function namespaceParticipantMailTemplateMarkup_(markup, namespace) {
  if (!markup) {
    return "";
  }
  const ns = typeof namespace === "string" ? namespace.trim() : "";
  if (!ns) {
    return String(markup);
  }
  try {
    let result = String(markup);
    const identifierMap = [
      ["ctx", `${ns}Ctx`],
      ["subjectEventNameMatch", `${ns}SubjectEventNameMatch`],
      ["subjectEventName", `${ns}SubjectEventName`],
      ["highlightLabel", `${ns}HighlightLabel`],
      ["highlightDate", `${ns}HighlightDate`],
      ["highlightTime", `${ns}HighlightTime`],
      ["fallbackHighlight", `${ns}FallbackHighlight`],
      ["contactUrl", `${ns}ContactUrl`],
      ["contactLabel", `${ns}ContactLabel`],
    ];
    identifierMap.forEach(([from, to]) => {
      const declarationPattern = new RegExp(
        `\\b(var|let|const)\\s+${from}\\b`,
        "g"
      );
      const usagePattern = new RegExp(`\\b${from}\\b`, "g");
      result = result.replace(
        declarationPattern,
        (_, keyword) => `${keyword} ${to}`
      );
      result = result.replace(usagePattern, (match) => {
        if (match === "context" || match === "namespace") {
          return match;
        }
        return to;
      });
    });
    return result;
  } catch (error) {
    logMailError_(
      "メールテンプレートマークアップの名前空間化に失敗しました",
      error,
      { namespace: ns }
    );
    return String(markup);
  }
}

function getParticipantMailTemplateBaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const value = String(
    properties.getProperty("PARTICIPANT_MAIL_TEMPLATE_BASE_URL") || ""
  ).trim();
  if (value) {
    return value.replace(/\/+$/, "") + "/";
  }
  return PARTICIPANT_MAIL_TEMPLATE_FALLBACK_BASE_URL;
}

function fetchParticipantMailTemplateFile_(filename) {
  const baseUrl = getParticipantMailTemplateBaseUrl_();
  const url = `${baseUrl}${filename}`;
  logMail_("メールテンプレートファイルの取得を開始します", { filename, url });
  let status = 0;
  try {
    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
    });
    status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      const content = response.getContentText();
      logMail_("メールテンプレートファイルの取得に成功しました", {
        filename,
        status,
        length: content.length,
      });
      return content;
    }
    throw new Error(`HTTP ${status}`);
  } catch (error) {
    logMailError_("メールテンプレートファイルの取得に失敗しました", error, {
      filename,
      url,
      status,
    });
    throw new Error(
      `メールテンプレート「${filename}」を取得できませんでした (${url}): ${error}`
    );
  }
}

function getParticipantMailTemplateMarkup_(options) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const cache = CacheService.getScriptCache();
  if (cache && forceRefresh) {
    cache.remove(PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY);
  }
  if (cache && !forceRefresh) {
    const cached = cache.get(PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.shellHtml && parsed.bodyHtml) {
          logMail_(
            "キャッシュされたメールテンプレートマークアップを使用します"
          );
          return parsed;
        }
        logMailError_("メールテンプレートキャッシュの形式が無効です", null, {
          hasShell: Boolean(parsed && parsed.shellHtml),
          hasBody: Boolean(parsed && parsed.bodyHtml),
        });
      } catch (cacheParseError) {
        logMailError_(
          "メールテンプレートキャッシュの解析に失敗しました",
          cacheParseError
        );
      }
      cache.remove(PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY);
    }
    logMail_(
      "メールテンプレートマークアップのキャッシュが見つからないため、取得を行います"
    );
  }
  const shellHtml = fetchParticipantMailTemplateFile_(
    "email-participant-shell.html"
  );
  const bodyHtml = fetchParticipantMailTemplateFile_(
    "email-participant-body.html"
  );
  logMail_("メールテンプレートマークアップの組み立てが完了しました", {
    shellLength: shellHtml.length,
    bodyLength: bodyHtml.length,
  });
  const payload = { shellHtml, bodyHtml };
  if (cache) {
    try {
      cache.put(
        PARTICIPANT_MAIL_TEMPLATE_CACHE_KEY,
        JSON.stringify(payload),
        6 * 60 * 60
      );
      logMail_("メールテンプレートマークアップをキャッシュしました", {
        ttlSeconds: 6 * 60 * 60,
      });
    } catch (cacheWriteError) {
      logMailError_(
        "メールテンプレートマークアップのキャッシュ保存に失敗しました",
        cacheWriteError
      );
    }
  }
  return payload;
}

function shouldRefreshParticipantMailTemplateCache_(error) {
  if (!error) {
    return false;
  }
  const message = String(error && error.message ? error.message : error);
  const name = String(error && error.name ? error.name : "");
  if (
    name === "SyntaxError" ||
    name === "TemplateCompilationError" ||
    name === "TemplateRenderingError"
  ) {
    return true;
  }
  return /Identifier '\w+' has already been declared/.test(message);
}

// ================================
// Webアプリとしての入口（POST / JSON API）
// ================================
// GitHub Pages 側のフロントエンドから送られてくる
// すべてのAPIリクエストを1本で受ける「玄関」です。
// リクエストボディをparseBody_で解析し、
// req.action の内容に応じて個別の処理関数へ振り分けます。
// ここで認証チェックやCORS対応もまとめて行います。
function doPost(e) {
  try {
    // メール送信のログを書き込むシートがなければここで用意しておく。
    // ログが多少壊れていても、本体処理は止めたくないので、
    // 失敗しても握りつぶして後続処理を続ける。
    ensureMailLogSheet_();
  } catch (sheetInitError) {
    try {
      if (
        typeof console !== "undefined" &&
        typeof console.error === "function"
      ) {
        console.error(
          "[Mail][WARN] ensureMailLogSheet_ failed during doPost bootstrap",
          sheetInitError
        );
      }
    } catch (ignoreConsoleError) {
      // console自体がない環境もあり得るので、ここは完全に無視。
    }
  }

  let requestOrigin = getRequestOrigin_(e);
  try {
    // リクエストボディをJSONやフォームとして解析する。
    const req = parseBody_(e);
    // body側にorigin情報があればそちらを優先して、CORS用のOriginとして覚えておく。
    requestOrigin = getRequestOrigin_(e, req) || requestOrigin;
    const { action, idToken } = req;
    // どんなactionのリクエストが来たか簡単にログに残す。
    logMail_("Apps Script doPost リクエストを受信しました", {
      action: action || "",
      origin: requestOrigin || "",
      hasIdToken: !!idToken,
    });
    if (!action) throw new Error("Missing action");

    // 画面表示セッション系のアクション
    const displayActions = new Set([
      "beginDisplaySession",
      "heartbeatDisplaySession",
      "endDisplaySession",
    ]);

    // 認証なしで呼び出せる例外アクション
    // - submitQuestion: 視聴者からの質問投稿
    // - processQuestionQueueForToken: トークン単位のキュー処理
    // - resolveParticipantMail: メール閲覧用リンクなどの解決
    const noAuthActions = new Set([
      "submitQuestion",
      "processQuestionQueueForToken",
      "resolveParticipantMail",
    ]);
    let principal = null;

    // 認証が必要なアクションについては、idTokenを検証してユーザー情報を取得する。
    // display系のアクションだけは匿名許可オプション付き。
    if (!noAuthActions.has(action)) {
      principal = requireAuth_(
        idToken,
        displayActions.has(action) ? { allowAnonymous: true } : {}
      );
    }

    const ok = (payload) => jsonOk(payload, requestOrigin);

    // ここから下は action ごとの振り分け。
    // それぞれの case で、専用の処理関数を呼び出し、その結果を ok(...) でラップして返す。
    switch (action) {
      // 例: 質問投稿
      case "submitQuestion":
        return ok(submitQuestion_(req));

      // 例: 質問キューの処理
      case "processQuestionQueueForToken":
        return ok(processQuestionQueueForToken_(req.token));

      // 例: 表示用セッションの開始 / 心拍 / 終了
      // （display.html 側からの定期的な通信）
      case "beginDisplaySession":
        return ok(beginDisplaySession_(principal, req.eventId));
      case "heartbeatDisplaySession":
        return ok(
          heartbeatDisplaySession_(principal, req.sessionId, req.eventId)
        );
      case "endDisplaySession":
        return ok(
          endDisplaySession_(principal, req.sessionId, req.reason, req.eventId)
        );

      case "ensureAdmin":
        return ok(ensureAdmin_(principal));
      case "processQuestionQueue":
        assertOperator_(principal);
        return ok(processQuestionSubmissionQueue_());
      case "resolveParticipantMail":
        return ok(resolveParticipantMailForToken_(req));
      case "fetchSheet":
        assertOperator_(principal);
        if (
          String(req.sheet || "")
            .trim()
            .toLowerCase() !== "users"
        ) {
          throw new Error("fetchSheet is only available for the users sheet.");
        }
        return ok({ data: getSheetData_(req.sheet) });
      case "addTerm":
        assertOperator_(principal);
        return ok(addDictionaryTerm(req.term, req.ruby, req.uid));
      case "updateTerm":
        assertOperator_(principal);
        return ok(updateDictionaryTerm(req.uid, req.term, req.ruby));
      case "deleteTerm":
        assertOperator_(principal);
        return ok(deleteDictionaryTerm(req.uid, req.term));
      case "toggleTerm":
        assertOperator_(principal);
        return ok(toggleDictionaryTerm(req.uid, req.enabled, req.term));
      case "batchDeleteTerms":
        assertOperator_(principal);
        return ok(batchDeleteDictionaryTerms(req.uids));
      case "batchToggleTerms":
        assertOperator_(principal);
        return ok(batchToggleDictionaryTerms(req.uids, req.enabled));
      case "updateStatus":
        assertOperator_(principal);
        return ok(updateAnswerStatus(req.uid, req.status));
      case "editQuestion":
        assertOperator_(principal);
        return ok(editQuestionText(req.uid, req.text));
      case "batchUpdateStatus":
        assertOperator_(principal);
        return ok(batchUpdateStatus(req.uids, req.status, principal));
      case "updateSelectingStatus":
        assertOperator_(principal);
        return ok(updateSelectingStatus(req.uid, principal));
      case "clearSelectingStatus":
        assertOperator_(principal);
        return ok(clearSelectingStatus(principal));
      case "lockDisplaySchedule":
        assertOperator_(principal);
        return ok(
          lockDisplaySchedule_(
            principal,
            req.eventId,
            req.scheduleId,
            req.scheduleLabel,
            req.operatorName
          )
        );
      case "saveScheduleRotation":
        assertOperator_(principal);
        return ok(
          saveScheduleRotation_(
            principal,
            req.eventId,
            req.entries != null
              ? req.entries
              : (req.rotation && req.rotation.entries) || req.rotation,
            {
              operatorName: req.operatorName,
              defaultDwellMs: req.defaultDwellMs,
              defaultDurationMs: req.defaultDurationMs,
              entries: req.rotation && req.rotation.entries,
            }
          )
        );
      case "clearScheduleRotation":
        assertOperator_(principal);
        return ok(clearScheduleRotation_(principal, req.eventId));
      case "sendParticipantMail":
        // 参加者向けの一斉メール送信処理。
        return ok(sendParticipantMail_(principal, req));
      case "logAction":
        assertOperator_(principal);
        return ok(logAction_(principal, req.action_type, req.details));
      case "backupRealtimeDatabase":
        assertOperator_(principal);
        return ok(backupRealtimeDatabase_());
      case "restoreRealtimeDatabase":
        assertOperator_(principal);
        return ok(restoreRealtimeDatabase_());
      case "whoami":
        // デバッグ用途: 現在のprincipal情報（認証されたユーザー）を返す。
        return ok({ principal });
      default:
        // 未知のactionが来たらエラー扱いにする。
        throw new Error("Unknown action: " + action);
    }
  } catch (err) {
    // ここで例外をJSONエラーとして整形し、CORSヘッダ付きで返す。
    return jsonErr_(err, requestOrigin);
  }
}

// ================================
// CORSプレフライト(OPTIONS)リクエストへの応答
// ================================
// ブラウザがクロスオリジンのPOSTを送る前に投げてくる
// OPTIONSリクエストに対して、空のレスポンス＋CORSヘッダを返す。
// 実際の処理はwithCors_でAccess-Control-Allow-*ヘッダを付けるだけ。
// 注意: OPTIONSリクエストではOriginヘッダーを直接取得できない場合があるため、
// 許可されたOriginリストから適切なOriginを返すようにする。
function doOptions(e) {
  // OPTIONSリクエストではOriginをパラメータから取得できない場合があるため、
  // getRequestOrigin_で取得を試み、取得できない場合は許可されたOriginを返す
  let origin = getRequestOrigin_(e);
  // Originが取得できない、または許可されていない場合は、許可リストから最初のOriginを使用
  if (!origin || ALLOWED_ORIGINS.indexOf(origin) === -1) {
    origin = ALLOWED_ORIGINS[0] || "";
  }
  const empty = ContentService.createTextOutput("").setMimeType(
    ContentService.MimeType.TEXT
  );
  return withCors_(empty, origin);
}

// ================================
// 視聴者からの質問投稿を受け付ける
// ================================
// 質問フォーム(question-form.htmlなど)から送られてくるデータを受け取り、
// 1. ラジオネーム・質問本文などをバリデーションする
// 2. token(一時リンク)をRTDB上で検証する
// 3. イベント・日程・参加者情報と整合しているかチェックする
// 4. 「質問受付キュー(questionIntake/submissions/...)」に1件分として積む
//
// ここではあくまで「キューに積むだけ」で、本番の質問一覧への反映は
// processQuestionSubmissionQueue_ 側でまとめて行う。
function submitQuestion_(payload) {
  const radioName = String(payload.radioName || payload.name || "").trim();
  const questionText = String(payload.question || payload.text || "").trim();
  const payloadGroupNumber = String(
    payload.groupNumber || payload.group || ""
  ).trim();
  const payloadTeamNumber = String(
    payload.teamNumber || payload.team || ""
  ).trim();
  const rawGenre = String(payload.genre || "").trim();
  const payloadScheduleLabel = String(
    payload.schedule || payload.date || ""
  ).trim();
  const payloadScheduleLocation = String(payload.scheduleLocation || "").trim();
  const payloadScheduleStart = String(payload.scheduleStart || "").trim();
  const payloadScheduleEnd = String(payload.scheduleEnd || "").trim();
  const payloadEventId = String(payload.eventId || "").trim();
  const payloadEventName = String(payload.eventName || "").trim();
  const payloadScheduleId = String(payload.scheduleId || "").trim();
  const payloadParticipantId = String(payload.participantId || "").trim();
  const payloadScheduleDate = String(payload.scheduleDate || "").trim();
  const rawToken = String(payload.token || "").trim();
  const payloadQuestionLength = Number(payload.questionLength || 0);

  // --- 基本的なバリデーション --------------------
  if (!radioName) throw new Error("ラジオネームを入力してください。");
  if (!questionText) throw new Error("質問・お悩みを入力してください。");
  if (!rawToken) {
    throw new Error(
      "アクセス情報を確認できませんでした。配布されたリンクから再度アクセスしてください。"
    );
  }
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(rawToken)) {
    throw new Error(
      "アクセスリンクが無効です。最新のURLからアクセスしてください。"
    );
  }

  // --- tokenを使ってRTDBからリンク情報を取得 --------------------
  let accessToken;
  try {
    // Firebase RTDB にアクセスするためのアクセストークンを取得
    accessToken = getFirebaseAccessToken_();
  } catch (error) {
    throw new Error(
      "アクセスリンクの検証に失敗しました。時間をおいて再試行してください。"
    );
  }

  let tokenRecord = null;
  try {
    // questionIntake/tokens/{token} から、イベントや参加者に紐づく情報を取得
    tokenRecord = fetchRtdb_("questionIntake/tokens/" + rawToken, accessToken);
  } catch (error) {
    throw new Error(
      "アクセスリンクの検証に失敗しました。時間をおいて再試行してください。"
    );
  }

  if (!tokenRecord) {
    throw new Error(
      "このリンクは無効化されています。運営までお問い合わせください。"
    );
  }
  if (tokenRecord.revoked) {
    throw new Error(
      "このリンクは無効化されています。運営までお問い合わせください。"
    );
  }
  const expiresAt = Number(tokenRecord.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    throw new Error(
      "このリンクの有効期限が切れています。運営までお問い合わせください。"
    );
  }

  // --- token に紐づくイベント/日程/参加者情報との整合性チェック ----
  const tokenEventId = String(tokenRecord.eventId || "").trim();
  const tokenScheduleId = String(tokenRecord.scheduleId || "").trim();
  const tokenParticipantId = String(tokenRecord.participantId || "").trim();
  if (!tokenEventId || !tokenScheduleId || !tokenParticipantId) {
    throw new Error(
      "リンクに紐づくイベント情報が確認できません。運営までお問い合わせください。"
    );
  }

  // フォーム側から渡されてきた eventId / scheduleId / participantId が
  // トークンに紐づいているものと矛盾していないか確認する。
  if (payloadEventId && payloadEventId !== tokenEventId) {
    throw new Error(
      "送信されたイベント情報が一致しません。リンクを再度開き直してください。"
    );
  }
  if (payloadScheduleId && payloadScheduleId !== tokenScheduleId) {
    throw new Error(
      "送信された日程情報が一致しません。リンクを再度開き直してください。"
    );
  }
  if (payloadParticipantId && payloadParticipantId !== tokenParticipantId) {
    throw new Error(
      "送信された参加者情報が一致しません。リンクを再度開き直してください。"
    );
  }

  // --- token とフォームからの値をマージして、質問キュー用の1レコードを作る ----
  const eventId = tokenEventId;
  const scheduleId = tokenScheduleId;
  const participantId = tokenParticipantId;
  const eventName = String(
    tokenRecord.eventName || payloadEventName || ""
  ).trim();
  const scheduleLabel = String(
    tokenRecord.scheduleLabel || payloadScheduleLabel || ""
  ).trim();
  const scheduleLocation = String(
    tokenRecord.scheduleLocation || payloadScheduleLocation || ""
  ).trim();
  const scheduleDate = String(
    tokenRecord.scheduleDate || payloadScheduleDate || ""
  ).trim();
  const scheduleStartRaw = String(
    tokenRecord.scheduleStart || payloadScheduleStart || ""
  ).trim();
  const scheduleEndRaw = String(
    tokenRecord.scheduleEnd || payloadScheduleEnd || ""
  ).trim();
  const participantName = String(tokenRecord.displayName || "").trim();
  const guidance = String(
    tokenRecord.guidance || payload.guidance || ""
  ).trim();
  const groupNumber = String(
    tokenRecord.teamNumber ||
      tokenRecord.groupNumber ||
      payloadTeamNumber ||
      payloadGroupNumber ||
      ""
  ).trim();

  const now = Date.now();
  const questionLength =
    Number.isFinite(payloadQuestionLength) && payloadQuestionLength > 0
      ? Math.floor(payloadQuestionLength)
      : String(questionText).length;
  const clientTimestampRaw = Number(payload.clientTimestamp || 0);
  const clientTimestamp =
    Number.isFinite(clientTimestampRaw) && clientTimestampRaw > 0
      ? clientTimestampRaw
      : now;

  // ベースとなる送信データ（nullや空文字はあとで削る）
  const submissionBase = {
    token: rawToken,
    radioName,
    question: questionText,
    questionLength,
    genre: rawGenre || "その他",
    groupNumber,
    teamNumber: groupNumber,
    scheduleLabel,
    scheduleLocation,
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
    language: String(payload.language || "").trim(),
    userAgent: String(payload.userAgent || "").trim(),
    referrer: String(payload.referrer || "").trim(),
    formVersion: String(payload.formVersion || "").trim(),
    origin: sanitizeOrigin_(payload.origin || payload.requestOrigin || ""),
    status: "pending",
  };

  // ベースとなる送信データ（nullや空文字はあとで削る）
  const submission = {};
  Object.keys(submissionBase).forEach((key) => {
    const value = submissionBase[key];
    if (value == null || value === "") {
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        submission[key] = trimmed;
      }
      return;
    }
    submission[key] = value;
  });

  submission.submittedAt = now;

  // --- RTDBのキュー(questionIntake/submissions/{token}/{entryId})に積む ----
  const entryId = Utilities.getUuid().replace(/-/g, "");
  const updates = {};
  updates[`questionIntake/submissions/${rawToken}/${entryId}`] = submission;

  try {
    patchRtdb_(updates, accessToken);
  } catch (error) {
    console.warn("Failed to queue question submission", error);
    throw new Error(
      "質問の登録に失敗しました。時間をおいて再試行してください。"
    );
  }

  // フロント側用の簡単な結果（キューに入ったかどうか）
  return { queued: true, entryId, submittedAt: toIsoJst_(new Date(now)) };
}

// ================================
// 特定トークンに紐づく質問キューを処理する
// ================================
// submitQuestion_ によって questionIntake/submissions/{token}/... に
// 積まれている質問を、そのtoken分だけまとめて本番の質問一覧に反映する。
// 1. tokenの形式チェックとRTDB上での有効性チェック
// 2. processQuestionSubmissionQueue_ を tokenFilter 付きで呼び出す
// 3. 処理件数などのサマリを呼び出し元に返す
function processQuestionQueueForToken_(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    throw new Error(
      "アクセスリンクが無効です。最新のURLからアクセスしてください。"
    );
  }
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(token)) {
    throw new Error(
      "アクセスリンクが無効です。最新のURLからアクセスしてください。"
    );
  }

  const accessToken = getFirebaseAccessToken_();
  let tokenRecord = null;
  try {
    tokenRecord = fetchRtdb_("questionIntake/tokens/" + token, accessToken);
  } catch (error) {
    throw new Error(
      "アクセスリンクの検証に失敗しました。時間をおいて再試行してください。"
    );
  }

  if (!tokenRecord || tokenRecord.revoked) {
    throw new Error(
      "このリンクは無効化されています。運営までお問い合わせください。"
    );
  }
  const expiresAt = Number(tokenRecord.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    throw new Error(
      "このリンクの有効期限が切れています。運営までお問い合わせください。"
    );
  }

  // 実際のキュー処理は processQuestionSubmissionQueue_ に任せ、
  // ここでは「このtokenに紐づく分だけ」を対象にする。
  const result =
    processQuestionSubmissionQueue_(accessToken, { tokenFilter: [token] }) ||
    {};
  return {
    processed: Number(result.processed || 0),
    discarded: Number(result.discarded || 0),
  };
}

// ================================
// 使われていない質問用トークンをRTDBから掃除する
// ================================
// participantsBranch(参加者情報)とtokensBranch(発行済みトークン)を突き合わせて、
// どの参加者からも参照されていない「余っているtoken」を削除する。
// - 参加者に紐づくtokenはactiveTokensとして記録
// - tokensBranch側を走査し、activeTokensに含まれないtokenをnullで上書き
// することで RTDB(questionIntake/tokens/...) から物理削除する。
function cleanupUnusedQuestionTokens_(
  participantsBranch,
  tokensBranch,
  accessToken
) {
  const participantKeys = new Set();
  const activeTokens = new Set();

  // まず participantsBranch を走査して、
  // 「イベントID::スケジュールID::参加者ID」の組をセットに集める。
  // ここで token が埋まっている場合は activeTokens にも追加する。
  Object.keys(participantsBranch || {}).forEach((eventId) => {
    const schedules = participantsBranch[eventId] || {};
    Object.keys(schedules).forEach((scheduleId) => {
      const entries = schedules[scheduleId] || {};
      Object.keys(entries).forEach((participantId) => {
        const entry = entries[participantId] || {};
        const token = String(entry.token || "").trim();
        if (token) {
          activeTokens.add(token);
        }
        const key = `${eventId || ""}::${scheduleId || ""}::${
          participantId || ""
        }`;
        participantKeys.add(key);
      });
    });
  });

  // 次に tokensBranch 側を走査し、
  // (eventId, scheduleId, participantId) が実在する参加者に紐づくtokenは
  // activeTokensとしてマークし直す。
  Object.keys(tokensBranch || {}).forEach((token) => {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      return;
    }
    const record = tokensBranch[token] || {};
    const key = `${record.eventId || ""}::${record.scheduleId || ""}::${
      record.participantId || ""
    }`;
    if (participantKeys.has(key)) {
      activeTokens.add(trimmed);
    }
  });

  // activeTokens に含まれていない token を削除対象として updates に積む
  const updates = {};
  let removed = 0;
  Object.keys(tokensBranch || {}).forEach((token) => {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      return;
    }
    if (activeTokens.has(trimmed)) {
      return;
    }
    updates[`questionIntake/tokens/${trimmed}`] = null;
    removed += 1;
  });

  // 実際に RTDB を更新する（必要な場合のみ）
  if (removed > 0 && accessToken) {
    try {
      patchRtdb_(updates, accessToken);
    } catch (error) {
      console.warn("cleanupUnusedQuestionTokens_ failed to patch RTDB", error);
      throw error;
    }
  }

  return { removed };
}

// === 名前の検索用にキーを正規化する =====================
// ユーザー名・ラジオネームなどを検索や突き合わせに使うとき、
// そのままだと全角/半角や見えない文字の違いで一致判定が難しい。
// ここでは:
//  - 前後の空白を除去
//  - Unicode正規化(NFKC)で全角/半角などを揃える
// を行い、「名前のキー」として扱いやすい形に整える。
function normalizeNameKey_(value) {
  return String(value || "")
    .trim()
    .normalize("NFKC");
}

// normalizeNameKey_で正規化した上で、
// ゼロ幅スペースなどの見えない制御文字を取り除く。
// シートやフォーム由来の微妙な差異を吸収して検索しやすくする目的。
function normalizeNameForLookup_(value) {
  return normalizeNameKey_(value).replace(/[\u200B-\u200D\uFEFF]/g, "");
}

// === 管理者ユーザーとしてRTDBに登録する =================
// principal(認証済みユーザー情報)を元に、
// 1. usersシートにメールアドレスが載っているか確認し、
//    「この人は管理者候補かどうか」を判定する。
// 2. 問題なければ Firebase RTDB の admins/{uid} に
//    email や grantedAt(付与時刻)を書き込み、
//    以後「管理画面にアクセスしてよいユーザー」として扱えるようにする。
// usersシートの内容を元に管理者権限を配るための仕組み。
function ensureAdmin_(principal) {
  const uid = principal && principal.uid;
  const email = String((principal && principal.email) || "")
    .trim()
    .toLowerCase();
  if (!uid || !email) throw new Error("No uid/email");

  const users = getSheetData_("users");
  const ok = users.some((row) => {
    const m = String(row["メールアドレス"] || row["email"] || "")
      .trim()
      .toLowerCase();
    return m && m === email;
  });
  if (!ok) throw new Error("Not in users sheet");

  const token = getFirebaseAccessToken_();
  const res = UrlFetchApp.fetch(rtdbUrl_("admins/" + uid), {
    method: "put",
    contentType: "application/json",
    payload: "true",
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode() };
}

// === Firebase Realtime Database 用のフルURLを作る ========
// スクリプトプロパティに設定してある FIREBASE_DB_URL を元に、
// 与えられた path を結合して「◯◯.firebaseio.com/... .json」形式の
// REST API 向けURLを生成する。
// 前後の / をいい感じに調整してくれるヘルパー。
function rtdbUrl_(path) {
  const FIREBASE_DB_URL =
    PropertiesService.getScriptProperties().getProperty("FIREBASE_DB_URL");
  return (
    FIREBASE_DB_URL.replace(/\/$/, "") +
    "/" +
    String(path || "").replace(/^\//, "") +
    ".json"
  );
}

// === 管理者の操作履歴をRTDBに記録する ====================
// principal(操作ユーザー), actionType(操作の種類), details(詳細文字列)
// を受け取り、logs/history コレクションに1件として追加する。
// これにより、後から「誰がいつどんな操作をしたか」を追跡できる。
// 追加後は notifyUpdate('logs') を呼び、必要に応じて通知を飛ばす。
function logAction_(principal, actionType, details) {
  const now = new Date();
  const timestampMs = now.getTime();
  const userEmail =
    String((principal && principal.email) || "").trim() || "unknown";
  const payload = {
    Timestamp: toIsoJst_(now),
    timestamp: timestampMs,
    User: userEmail,
    UserId: String((principal && principal.uid) || "").trim(),
    Action: String(actionType || ""),
    Details: String(details || ""),
    createdAt: timestampMs,
    updatedAt: timestampMs,
  };
  const token = getFirebaseAccessToken_();
  let name = "";
  try {
    const res = postRtdb_("logs/history", payload, token);
    if (res && typeof res === "object" && res.name) {
      name = String(res.name || "");
    }
  } finally {
    try {
      notifyUpdate("logs");
    } catch (error) {
      console.error("notifyUpdate failed", error);
    }
  }
  return { ok: true, id: name };
}

// === RTDBバックアップ用シート(backups)を用意する =========
// アクティブなスプレッドシート内に "backups" という名前のシートを確保し、
// 存在しなければ新規作成する。
// 1行目には [Timestamp, Data] というヘッダを自動で挿入する。
// RTDB全体スナップショットをJSON文字列で保存するための置き場。
function ensureBackupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "backups";
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Data"]);
  }
  return sheet;
}

// === メール送信ログ用シート(mail_logs)を用意する =========
// アクティブなスプレッドシート内に "mail_logs" シートを確保し、
// なければ作成する。1行目にログのヘッダを自動挿入する。
// writeMailLog_ などがここに1件ずつ追記していく。
function ensureMailLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "mail_logs";
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Severity", "Message", "Error", "Details"]);
  }
  return sheet;
}

// === RTDB全体のスナップショットをbackupsシートに保存する ===
// Firebase Realtime Database のルート("/")を丸ごと取得し、
// スプレッドシート "backups" の末尾に
//   [取得時刻, JSON文字列化したスナップショット]
// の形式で1行追記する。
// rowCountは、ヘッダ行を除いたバックアップ件数。
function backupRealtimeDatabase_() {
  const token = getFirebaseAccessToken_();
  const snapshot = fetchRtdb_("", token) || {};
  const sheet = ensureBackupSheet_();
  const now = new Date();
  sheet.appendRow([now, JSON.stringify(snapshot)]);
  return {
    timestamp: toIsoJst_(now),
    rowCount: Math.max(0, sheet.getLastRow() - 1),
  };
}

// === backupsシートの最新バックアップからRTDBを復元する ===
// backupsシートの一番下の行(最新のバックアップ)を取得し、
// JSONをパースしてRTDBのルート("/")にそのままputする。
// 誤操作などでデータが壊れたときに、直近の状態に巻き戻す用途。
// バックアップが無い・壊れている場合はエラーを投げる。
function restoreRealtimeDatabase_() {
  const sheet = ensureBackupSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error("バックアップが存在しません。");
  }
  const [[rawTimestamp, rawPayload]] = sheet
    .getRange(lastRow, 1, 1, 2)
    .getValues();
  if (!rawPayload) {
    throw new Error("バックアップデータが空です。");
  }
  let data;
  try {
    data = JSON.parse(rawPayload);
  } catch (error) {
    throw new Error("バックアップデータの解析に失敗しました。");
  }
  const token = getFirebaseAccessToken_();
  putRtdb_("", data, token);
  const timestamp =
    rawTimestamp instanceof Date
      ? toIsoJst_(rawTimestamp)
      : String(rawTimestamp || "");
  return { timestamp };
}

// === backupsシートの最新バックアップからRTDBを復元する ===
// backupsシートの一番下の行(最新のバックアップ)を取得し、
// JSONをパースしてRTDBのルート("/")にそのままputする。
// 誤操作などでデータが壊れたときに、直近の状態に巻き戻す用途。
// バックアップが無い・壊れている場合はエラーを投げる。
function normalizeParticipantMailViewBaseUrl_(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const queryIndex = trimmed.indexOf("?");
  const basePart = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex);
  const queryPart = queryIndex === -1 ? "" : trimmed.slice(queryIndex);
  let normalizedBase = basePart.replace(/\s+$/, "");
  if (!normalizedBase) {
    normalizedBase = "email-participant-shell.html";
  }
  const isAppsScriptEndpoint =
    /script\.google(?:usercontent)?\.com\/macros\//i.test(normalizedBase);
  const isExecEndpoint = /\/(exec|dev)(?:\/)?$/i.test(normalizedBase);
  if (isAppsScriptEndpoint && isExecEndpoint) {
    return normalizedBase + queryPart;
  }
  if (/email-participant-(shell|body)\.html?$/i.test(normalizedBase)) {
    normalizedBase = normalizedBase.replace(
      /email-participant-body\.html?$/i,
      "email-participant-shell.html"
    );
  } else if (/\/index(?:\.html?)?$/i.test(normalizedBase)) {
    normalizedBase = normalizedBase.replace(
      /\/index(?:\.html?)?$/i,
      "/email-participant-shell.html"
    );
  } else if (/\/$/.test(normalizedBase)) {
    normalizedBase =
      normalizedBase.replace(/\/+$/, "") + "/email-participant-shell.html";
  } else if (!/\.html?$/i.test(normalizedBase)) {
    normalizedBase =
      normalizedBase.replace(/\/+$/, "") + "/email-participant-shell.html";
  }
  return normalizedBase + queryPart;
}

function normalizeQuestionFormBaseUrl_(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const hashIndex = trimmed.indexOf("#");
  let hashPart = "";
  let withoutHash = trimmed;
  if (hashIndex !== -1) {
    hashPart = trimmed.slice(hashIndex);
    withoutHash = trimmed.slice(0, hashIndex);
  }
  const queryIndex = withoutHash.indexOf("?");
  const basePart =
    queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const queryPart = queryIndex === -1 ? "" : withoutHash.slice(queryIndex);
  let normalizedBase = basePart.replace(/\s+$/, "");
  if (!normalizedBase) {
    return "";
  }
  if (/\.html?$/i.test(normalizedBase)) {
    return normalizedBase + queryPart + hashPart;
  }
  normalizedBase =
    normalizedBase.replace(/\/+$/, "") + "/" + QUESTION_FORM_PAGE_FILENAME;
  return normalizedBase + queryPart + hashPart;
}

function getWebAppBaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const propertyKeys = [
    "PARTICIPANT_MAIL_WEB_VIEW_BASE_URL",
    "WEB_APP_BASE_URL",
  ];
  let appsScriptCandidate = "";
  for (let i = 0; i < propertyKeys.length; i += 1) {
    const value = String(properties.getProperty(propertyKeys[i]) || "").trim();
    if (value) {
      const normalized = normalizeParticipantMailViewBaseUrl_(value);
      if (!normalized) {
        continue;
      }
      const isAppsScriptEndpoint =
        /script\.google(?:usercontent)?\.com\/macros\//i.test(normalized);
      const isExecEndpoint = /\/(exec|dev)(?:\/)?$/i.test(normalized);
      if (!isAppsScriptEndpoint || !isExecEndpoint) {
        return normalized;
      }
      if (!appsScriptCandidate) {
        appsScriptCandidate = normalized;
      }
    }
  }
  if (PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL) {
    const fallback = normalizeParticipantMailViewBaseUrl_(
      PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL
    );
    if (fallback) {
      return fallback;
    }
  }
  if (appsScriptCandidate) {
    return appsScriptCandidate;
  }
  if (typeof ScriptApp !== "undefined" && ScriptApp.getService) {
    try {
      const service = ScriptApp.getService();
      if (service && typeof service.getUrl === "function") {
        const url = service.getUrl();
        if (url) {
          return normalizeParticipantMailViewBaseUrl_(url);
        }
      }
    } catch (error) {
      // ignore and fall back
    }
  }
  if (PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL) {
    return normalizeParticipantMailViewBaseUrl_(
      PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL
    );
  }
  return "";
}

// === 質問フォームのベースURLを決定する ===============================
// 「視聴者向け質問フォーム」をどのURLでホストするかを決める。
// スクリプトプロパティなどから順番に候補を探し、
//  1. QUESTION_FORM_BASE_URL
//  2. PUBLIC_WEB_APP_URL
//  3. PUBLIC_WEB_APP_FALLBACK_BASE_URL
//  4. 参加者メールWeb表示URLから email-participant-shell.html を差し替えたURL
// を試す。
// 決まったURLは normalizeQuestionFormBaseUrl_ で整形してから返す。
function getQuestionFormBaseUrl_() {
  const properties = PropertiesService.getScriptProperties();
  const propertyKeys = ["QUESTION_FORM_BASE_URL", "PUBLIC_WEB_APP_URL"];
  for (let i = 0; i < propertyKeys.length; i += 1) {
    const value = String(properties.getProperty(propertyKeys[i]) || "").trim();
    if (value) {
      return normalizeQuestionFormBaseUrl_(value);
    }
  }
  if (PUBLIC_WEB_APP_FALLBACK_BASE_URL) {
    return normalizeQuestionFormBaseUrl_(PUBLIC_WEB_APP_FALLBACK_BASE_URL);
  }
  if (PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL) {
    const derived = PARTICIPANT_MAIL_WEB_VIEW_FALLBACK_URL.replace(
      /email-participant-shell\.html?.*$/i,
      QUESTION_FORM_PAGE_FILENAME
    );
    if (derived) {
      return normalizeQuestionFormBaseUrl_(derived);
    }
  }
  return "";
}

// === 質問フォームの完成URLを組み立てる ================================
// getQuestionFormBaseUrl_ で決まったベースURLに対して、
// token などのクエリパラメータを付与して完成URLを返す。
// - 既に ? が含まれているかどうかで ? / & を切り替える
// - #hash が付いている場合は、クエリを hash より前に挿入する
// 例: baseUrl=https://example.com/form, token=abc
//   → https://example.com/form?token=abc
function buildQuestionFormUrl_(baseUrl, params) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) {
    return "";
  }
  const token = params && params.token ? String(params.token).trim() : "";
  const segments = [];
  if (token) {
    segments.push(`token=${encodeURIComponent(token)}`);
  }
  if (!segments.length) {
    return trimmed;
  }
  const hashIndex = trimmed.indexOf("#");
  let hashPart = "";
  let baseWithoutHash = trimmed;
  if (hashIndex !== -1) {
    hashPart = trimmed.slice(hashIndex);
    baseWithoutHash = trimmed.slice(0, hashIndex);
  }
  let separator = "?";
  if (baseWithoutHash.includes("?")) {
    separator =
      baseWithoutHash.endsWith("?") || baseWithoutHash.endsWith("&") ? "" : "&";
  }
  return `${baseWithoutHash}${separator}${segments.join("&")}${hashPart}`;
}

// === 参加者メール全体の設定値を読み込む ===============================
// スクリプトプロパティから、参加者メールに関する設定をまとめて取得する。
// 具体的には：
//  - 件名テンプレート(PARTICIPANT_MAIL_SUBJECT)
//  - 追記事項のHTML/テキスト(PARTICIPANT_MAIL_NOTE_HTML / _TEXT)
//  - 会場の場所や集合時刻に関する説明
//  - フッターメッセージ、タグライン
//  - 問い合わせ先リンク・質問フォームリンク用のラベルとURL
// 等を一つのsettingsオブジェクトにして返す。
// あとで buildParticipantMailContext_ などから参照する前提。
function getParticipantMailSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const settings = {
    contactEmail: PARTICIPANT_MAIL_CONTACT_EMAIL,
    subjectTemplate: String(
      properties.getProperty("PARTICIPANT_MAIL_SUBJECT") || ""
    ).trim(),
    noteHtml: properties.getProperty("PARTICIPANT_MAIL_NOTE_HTML") || "",
    noteText: properties.getProperty("PARTICIPANT_MAIL_NOTE_TEXT") || "",
    location: String(
      properties.getProperty("PARTICIPANT_MAIL_LOCATION") || ""
    ).trim(),
    arrivalNote: String(
      properties.getProperty("PARTICIPANT_MAIL_ARRIVAL_NOTE") || ""
    ).trim(),
    tagline: String(
      properties.getProperty("PARTICIPANT_MAIL_TAGLINE") || ""
    ).trim(),
    contactLinkLabel: String(
      properties.getProperty("PARTICIPANT_MAIL_CONTACT_LINK_LABEL") || ""
    ).trim(),
    contactLinkUrl: String(
      properties.getProperty("PARTICIPANT_MAIL_CONTACT_LINK_URL") || ""
    ).trim(),
    questionFormLinkLabel: String(
      properties.getProperty("PARTICIPANT_MAIL_QUESTION_FORM_LINK_LABEL") || ""
    ).trim(),
    questionFormPrompt: String(
      properties.getProperty("PARTICIPANT_MAIL_QUESTION_FORM_PROMPT") || ""
    ).trim(),
    footerNote: String(
      properties.getProperty("PARTICIPANT_MAIL_FOOTER_NOTE") || ""
    ).trim(),
    previewTextTemplate: String(
      properties.getProperty("PARTICIPANT_MAIL_PREVIEW_TEXT") || ""
    ).trim(),
  };
  logMail_("参加者メール設定を読み込みました", {
    hasContactEmail: Boolean(settings.contactEmail),
    hasSubjectTemplate: Boolean(settings.subjectTemplate),
    hasPreviewTextTemplate: Boolean(settings.previewTextTemplate),
  });
  return settings;
}

function buildParticipantMailViewUrl_(baseUrl, params) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) {
    return "";
  }
  const token = params && params.token ? String(params.token).trim() : "";
  const eventId = params && params.eventId ? String(params.eventId).trim() : "";
  const scheduleId =
    params && params.scheduleId ? String(params.scheduleId).trim() : "";
  const participantId =
    params && params.participantId ? String(params.participantId).trim() : "";
  const isAppsScriptEndpoint =
    /script\.google(?:usercontent)?\.com\/macros\//i.test(trimmed);
  const segments = [];
  if (isAppsScriptEndpoint) {
    segments.push("view=participantMail");
    if (eventId) {
      segments.push(`eventId=${encodeURIComponent(eventId)}`);
    }
    if (scheduleId) {
      segments.push(`scheduleId=${encodeURIComponent(scheduleId)}`);
    }
    if (participantId) {
      segments.push(`participantId=${encodeURIComponent(participantId)}`);
    }
    if (token) {
      segments.push(`token=${encodeURIComponent(token)}`);
    }
  } else {
    if (token) {
      segments.push(`token=${encodeURIComponent(token)}`);
    }
    if (eventId) {
      segments.push(`eventId=${encodeURIComponent(eventId)}`);
    }
    if (scheduleId) {
      segments.push(`scheduleId=${encodeURIComponent(scheduleId)}`);
    }
    if (participantId) {
      segments.push(`participantId=${encodeURIComponent(participantId)}`);
    }
  }
  if (!segments.length) {
    return trimmed;
  }
  let separator = "?";
  if (trimmed.includes("?")) {
    separator = trimmed.endsWith("?") || trimmed.endsWith("&") ? "" : "&";
  }
  return `${trimmed}${separator}${segments.join("&")}`;
}

function formatMailDateWithWeekday_(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return "";
  }
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[date.getDay()] || "";
  return `${date.getMonth() + 1}月${date.getDate()}日(${weekday})`;
}

function formatMailTimeLabel_(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return "";
  }
  return Utilities.formatDate(date, "Asia/Tokyo", "H:mm");
}

function buildArrivalWindowMessage_(windowLabel) {
  const label = coalesceStrings_(windowLabel);
  return label ? `${label}までの間にお越しください！` : "";
}

function buildParticipantMailSenderName_(eventName) {
  const trimmedEventName = String(eventName || "").trim();
  if (trimmedEventName) {
    return `弘前大学生協学生委員会 ${trimmedEventName} 運営チーム`;
  }
  return "弘前大学生協学生委員会 運営チーム";
}

// === 参加者1人分の「メール差し込みデータ」を組み立てる =================
// eventId, scheduleId と、イベント/日程/参加者の行データ、
// そして getParticipantMailSettings_ で取得した共通設定を元に、
// テンプレートエンジンに渡すためのコンテキストオブジェクトを構築する。
// ここで最終的に決めるデータの例：
//  - participantName / participantEmail
//  - eventName / scheduleLabel / scheduleDateLabel / scheduleTimeLabel
//  - 集合場所や集合時間帯(location, arrivalNote, arrivalWindow)
//  - メールのWeb表示用URL(webViewUrl)と、そのためのtoken
//  - 質問フォームURL(questionFormUrl)と誘導文
//  - フッターメッセージや問い合わせ先リンクなど
// 各値は「参加者行 → 日程行 → イベント行 → 設定値」の順に
// coalesceStrings_ でフォールバックしながら決定する。
function buildParticipantMailContext_(
  eventId,
  scheduleId,
  participantRecord,
  eventRecord,
  scheduleRecord,
  settings,
  baseUrl,
  questionFormBaseUrl
) {
  const participantId = String(
    (participantRecord &&
      (participantRecord.participantId || participantRecord.uid)) ||
      ""
  ).trim();
  const participantName = String(
    (participantRecord && participantRecord.name) || ""
  ).trim();
  const eventName = coalesceStrings_(
    participantRecord &&
      (participantRecord.eventName ||
        participantRecord.eventLabel ||
        participantRecord.eventTitle),
    scheduleRecord && (scheduleRecord.eventName || scheduleRecord.eventLabel),
    eventRecord && (eventRecord.name || eventRecord.title),
    eventId
  );
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
    formatScheduleLabel_(
      scheduleRecord && scheduleRecord.startAt,
      scheduleRecord && scheduleRecord.endAt
    ),
    participantScheduleLabel,
    participantScheduleDate,
    scheduleId
  );
  const startDate = parseDateCell_(
    scheduleRecord && (scheduleRecord.startAt || scheduleRecord.date)
  );
  const endDate = parseDateCell_(scheduleRecord && scheduleRecord.endAt);
  const scheduleDateLabel = formatMailDateWithWeekday_(startDate);
  const startTimeLabel = formatMailTimeLabel_(startDate);
  const endTimeLabel = formatMailTimeLabel_(endDate);
  let defaultArrivalWindow = "";
  if (startDate instanceof Date && !isNaN(startDate) && startTimeLabel) {
    const arrivalStartDate = new Date(startDate.getTime() - 30 * 60 * 1000);
    const arrivalStartTimeLabel = formatMailTimeLabel_(arrivalStartDate);
    if (arrivalStartTimeLabel) {
      defaultArrivalWindow = `${arrivalStartTimeLabel}-${startTimeLabel}`;
    }
  }
  let scheduleTimeRange = "";
  if (startTimeLabel && endTimeLabel) {
    scheduleTimeRange = `${startTimeLabel}〜${endTimeLabel}`;
  } else if (startTimeLabel) {
    scheduleTimeRange = `${startTimeLabel}〜`;
  }
  const resolvedScheduleDateLabel = coalesceStrings_(
    scheduleDateLabel,
    participantScheduleDate,
    scheduleLabel
  );
  const resolvedScheduleTimeRange = coalesceStrings_(
    scheduleTimeRange,
    participantScheduleTime
  );
  const scheduleRangeLabel = coalesceStrings_(
    resolvedScheduleDateLabel && resolvedScheduleTimeRange
      ? `${resolvedScheduleDateLabel} ${resolvedScheduleTimeRange}`
      : "",
    participantScheduleRange,
    participantScheduleLabel && resolvedScheduleTimeRange
      ? `${participantScheduleLabel} ${resolvedScheduleTimeRange}`
      : "",
    resolvedScheduleDateLabel,
    scheduleLabel
  );
  const token = String(
    (participantRecord && participantRecord.token) || ""
  ).trim();
  const webViewUrl = buildParticipantMailViewUrl_(baseUrl, {
    eventId,
    scheduleId,
    participantId,
    token,
  });
  const questionFormUrl =
    token && questionFormBaseUrl
      ? buildQuestionFormUrl_(questionFormBaseUrl, {
          token,
          eventId,
          scheduleId,
          participantId,
        })
      : "";
  const guidance = String(
    (participantRecord && participantRecord.guidance) || ""
  ).trim();
  const scheduleLocation = coalesceStrings_(
    participantRecord &&
      (participantRecord.scheduleLocation ||
        participantRecord.location ||
        participantRecord.venue),
    scheduleRecord &&
      (scheduleRecord.scheduleLocation ||
        scheduleRecord.location ||
        scheduleRecord.venue ||
        scheduleRecord.place),
    eventRecord &&
      (eventRecord.scheduleLocation ||
        eventRecord.location ||
        eventRecord.venue)
  );
  const location = coalesceStrings_(
    participantRecord &&
      (participantRecord.location || participantRecord.venue),
    scheduleLocation,
    settings.location
  );
  const contactEmail = PARTICIPANT_MAIL_CONTACT_EMAIL;
  const arrivalWindow = coalesceStrings_(
    participantRecord &&
      (participantRecord.arrivalWindow || participantRecord.checkinWindow),
    scheduleRecord &&
      (scheduleRecord.arrivalWindow || scheduleRecord.checkinWindow),
    defaultArrivalWindow
  );
  const arrivalNote = coalesceStrings_(
    participantRecord &&
      (participantRecord.arrivalNote || participantRecord.checkinNote),
    scheduleRecord &&
      (scheduleRecord.arrivalNote || scheduleRecord.checkinNote),
    buildArrivalWindowMessage_(arrivalWindow)
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
  const questionFormLabel = coalesceStrings_(
    participantRecord &&
      (participantRecord.questionFormLabel ||
        participantRecord.questionFormButtonLabel),
    scheduleRecord &&
      (scheduleRecord.questionFormLabel ||
        scheduleRecord.questionFormButtonLabel),
    eventRecord &&
      (eventRecord.questionFormLabel || eventRecord.questionFormButtonLabel),
    settings.questionFormLinkLabel
  );
  const questionFormPrompt = coalesceStrings_(
    participantRecord &&
      (participantRecord.questionFormPrompt ||
        participantRecord.questionPrompt),
    scheduleRecord &&
      (scheduleRecord.questionFormPrompt || scheduleRecord.questionPrompt),
    eventRecord &&
      (eventRecord.questionFormPrompt || eventRecord.questionPrompt),
    settings.questionFormPrompt
  );
  const senderName = buildParticipantMailSenderName_(eventName);
  return {
    eventId,
    scheduleId,
    participantId,
    participantName,
    participantEmail: String(
      (participantRecord && participantRecord.email) || ""
    ).trim(),
    eventName,
    scheduleLabel,
    scheduleDateLabel: resolvedScheduleDateLabel,
    scheduleTimeRange: resolvedScheduleTimeRange,
    scheduleRangeLabel,
    contactEmail,
    senderName,
    additionalHtml: settings.noteHtml || "",
    additionalText: settings.noteText || "",
    location,
    scheduleLocation,
    guidance,
    webViewUrl,
    token,
    questionFormUrl,
    questionFormLabel,
    questionFormPrompt,
    arrivalNote,
    arrivalWindow,
    contactLinkLabel: settings.contactLinkLabel || "",
    contactLinkUrl: settings.contactLinkUrl || "",
    footerNote,
    tagline,
    previewText: "",
    scheduleDateDisplay: resolvedScheduleDateLabel,
    scheduleTimeDisplay: resolvedScheduleTimeRange,
  };
}

// === 参加者メールの件名を組み立てる ===============================
// buildParticipantMailContext_ で作った context と、
// getParticipantMailSettings_ で取得した settings を元に、
// 実際にメールで使う件名文字列を生成する。
// - settings.subjectTemplate が設定されている場合は、
//   {{eventName}}, {{scheduleLabel}}, {{participantName}} などの
//   プレースホルダを置き換えて件名を作る。
// - 設定が無い場合は「【◯◯】参加日時のご案内」というデフォルト形式にする。
function buildParticipantMailSubject_(context, settings) {
  const template = String(settings.subjectTemplate || "").trim();
  const eventName = context.eventName || context.eventId || "";
  const scheduleLabel =
    context.scheduleLabel || context.scheduleRangeLabel || "";
  const participantName = context.participantName || "";
  if (template) {
    return template
      .replace(/\{\{\s*eventName\s*\}\}/g, eventName)
      .replace(/\{\{\s*scheduleLabel\s*\}\}/g, scheduleLabel)
      .replace(/\{\{\s*participantName\s*\}\}/g, participantName);
  }
  return `【${eventName || "イベント"}】参加日時のご案内`;
}

// === メールクライアント用のプレビュー文を生成する ===================
// Gmailなどの受信一覧で表示される「冒頭の一行(プレビュー)」用の文字列を作る。
// - 設定側に previewTextTemplate があれば、
//   {{eventName}}, {{scheduleLabel}}, {{participantName}},
//   {{arrivalNote}}, {{location}} などを埋め込んで作成。
// - 設定が無ければ、eventName / scheduleLabel / arrivalNote / location などを
//   「｜」区切りでつないで、160文字程度に丸めた簡易プレビューを返す。
// 何も情報が無い場合の最後のfallbackは
// 「ご参加に関する大切なお知らせです。」とする。
function buildParticipantMailPreviewText_(context, settings) {
  const template =
    settings && settings.previewTextTemplate
      ? String(settings.previewTextTemplate).trim()
      : "";
  const eventName = coalesceStrings_(
    context && context.eventName,
    context && context.eventId
  );
  const scheduleLabel = coalesceStrings_(
    context && context.scheduleRangeLabel,
    context && context.scheduleLabel
  );
  const participantName = coalesceStrings_(context && context.participantName);
  const arrivalNote = coalesceStrings_(context && context.arrivalNote);
  const location = coalesceStrings_(
    context && context.location,
    context && context.scheduleLocation
  );
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
  const joined = fragments.filter(Boolean).join("｜");
  if (joined) {
    return truncateString_(joined, 160);
  }
  return "ご参加に関する大切なお知らせです。";
}

// === 件名から「【◯◯】」内のイベント名だけ抜き出す ================
// 件名文字列のうち、「【イベント名】」という形式が含まれていれば
// そのカッコの中身だけを返す。
// buildParticipantMailSubject_ で組み立てた件名から、
// context.eventName の補完などに使うためのユーティリティ。
function extractSubjectEventName_(subject) {
  if (!subject) {
    return "";
  }
  const text = String(subject);
  const match = text.match(/【([^】]+)】/);
  return match ? match[1].trim() : "";
}

// === メール差し込みコンテキストを後から整える =======================
// buildParticipantMailContext_ で作った context に対して、
// 抜けている値を「候補からよしなに補完」したり、
// settings側で決めたデフォルト値を上書きしたりする仕上げ処理。
// 例：
//  - eventName が空なら eventLabel / eventId / 件名の【◯◯】部分から補完
//  - tagline や footerNote が空なら settings の値で補う
//  - questionFormLabel が空なら「質問フォームを開く」などのデフォルトをセット
// ログに補完元を出しつつ、最終的にテンプレに渡す context を整える役割。
function enrichParticipantMailContext_(context, settings) {
  if (!context || typeof context !== "object") {
    return context;
  }
  if (!context.eventName) {
    const fallbackSources = [
      ["eventLabel", context.eventLabel],
      ["eventId", context.eventId],
      ["subject", extractSubjectEventName_(context.subject)],
    ];
    let fallbackEventName = "";
    let fallbackSource = "";
    for (let i = 0; i < fallbackSources.length; i += 1) {
      const [source, value] = fallbackSources[i];
      const candidate = coalesceStrings_(value);
      if (candidate) {
        fallbackEventName = candidate;
        fallbackSource = source;
        break;
      }
    }
    if (fallbackEventName) {
      context.eventName = fallbackEventName;
      logMail_("イベント名をフォールバックから補完しました", {
        fallbackSource,
        fallbackEventName,
      });
    } else {
      logMailError_("イベント名を特定できませんでした", null, {
        eventId: context.eventId || "",
        eventLabel: context.eventLabel || "",
        subject: context.subject || "",
      });
    }
  }
  const effectiveLocation = coalesceStrings_(
    context.location,
    context.scheduleLocation,
    settings && settings.location
  );
  if (effectiveLocation) {
    context.location = effectiveLocation;
  }
  const effectiveArrivalWindow = coalesceStrings_(
    context.arrivalWindow,
    settings && settings.arrivalWindow
  );
  if (effectiveArrivalWindow) {
    context.arrivalWindow = effectiveArrivalWindow;
  }
  const effectiveArrival = coalesceStrings_(
    context.arrivalNote,
    settings && settings.arrivalNote
  );
  if (effectiveArrival) {
    context.arrivalNote = effectiveArrival;
  } else if (context.arrivalWindow) {
    context.arrivalNote = buildArrivalWindowMessage_(context.arrivalWindow);
  }
  const effectiveTagline = coalesceStrings_(
    context.tagline,
    settings && settings.tagline
  );
  if (effectiveTagline) {
    context.tagline = effectiveTagline;
  }
  const effectiveFooter = coalesceStrings_(
    context.footerNote,
    settings && settings.footerNote
  );
  if (effectiveFooter) {
    context.footerNote = effectiveFooter;
  }
  if (context.questionFormUrl) {
    const questionFormLabel = coalesceStrings_(
      context.questionFormLabel,
      settings && settings.questionFormLinkLabel,
      "質問フォームを開く"
    );
    if (questionFormLabel) {
      context.questionFormLabel = questionFormLabel;
    }
    const questionFormPrompt = coalesceStrings_(
      context.questionFormPrompt,
      settings && settings.questionFormPrompt,
      "事前のご質問や相談はこちらのフォームからお送りください。"
    );
    if (questionFormPrompt) {
      context.questionFormPrompt = questionFormPrompt;
    }
  }
  const contactLabel = coalesceStrings_(
    context.contactLinkLabel,
    settings && settings.contactLinkLabel,
    context.contactEmail ? "お問い合わせする" : ""
  );
  if (contactLabel) {
    context.contactLinkLabel = contactLabel;
  }
  let contactLinkUrl = coalesceStrings_(
    context.contactLinkUrl,
    settings && settings.contactLinkUrl
  );
  if (!contactLinkUrl && context.contactEmail) {
    contactLinkUrl = `mailto:${context.contactEmail}`;
  }
  context.contactLinkUrl = contactLinkUrl;
  context.previewText = buildParticipantMailPreviewText_(context, settings);
  return context;
}

// === HTMLテンプレート全体で共有して使う値を算出する =================
// context に入っている eventName / scheduleLabel などから、
// 「テンプレートの中で何度も使う基本的なラベル」をまとめて計算する。
// 例：
//  - resolvedEventName: eventName / eventLabel / 件名から抽出した名前 など
//  - resolvedScheduleLabel: scheduleLabel / scheduleRangeLabel など
// また、テンプレート内で安全に使うために、
// 一部の値はHTMLエスケープ済み (& → &amp; など) にして返す。
function deriveParticipantMailTemplateSharedValues_(context) {
  const ctx = context && typeof context === "object" ? context : {};
  const subjectText = ctx.subject ? String(ctx.subject) : "";
  const subjectEventNameMatch = subjectText.match(/【([^】]+)】/);
  const subjectEventName = subjectEventNameMatch
    ? subjectEventNameMatch[1].trim()
    : "";
  const resolvedEventName = coalesceStrings_(
    ctx.resolvedEventName,
    ctx.eventName,
    ctx.eventLabel,
    ctx.eventId,
    subjectEventName,
    "イベント"
  );
  const resolvedScheduleLabel = coalesceStrings_(
    ctx.resolvedScheduleLabel,
    ctx.scheduleLabel,
    ctx.scheduleRangeLabel,
    ""
  );
  const fallbackSubjectBase = resolvedEventName || "ご案内";
  let resolvedSubject = ctx.subject ? String(ctx.subject) : "";
  if (!resolvedSubject) {
    resolvedSubject = resolvedScheduleLabel
      ? fallbackSubjectBase + " - " + resolvedScheduleLabel
      : fallbackSubjectBase;
  }
  return {
    resolvedEventName,
    resolvedScheduleLabel,
    resolvedSubject,
  };
}

function escapeHtmlForTemplate_(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (!stringValue) {
    return stringValue;
  }
  return stringValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtmlTemplateMarkup_(markup, state) {
  const templateSource =
    typeof markup === "string" ? markup : String(markup || "");
  const evaluationState = Object.assign(
    Object.create(null),
    state && typeof state === "object" ? state : {}
  );
  const scriptletPattern = /<\?([\s\S]*?)\?>/g;
  let cursor = 0;
  const fnBody = ["const __output = [];", "let __temp;"];

  let match;
  while ((match = scriptletPattern.exec(templateSource)) !== null) {
    const preceding = templateSource.slice(cursor, match.index);
    if (preceding) {
      fnBody.push(`__output.push(${JSON.stringify(preceding)});`);
    }
    const rawScriptlet = match[1] || "";
    const trimmedStart = rawScriptlet.replace(/^\s+/, "");
    if (!trimmedStart) {
      cursor = match.index + match[0].length;
      continue;
    }
    if (trimmedStart.startsWith("!=")) {
      const expression = trimmedStart.slice(2).trim();
      if (expression) {
        fnBody.push(`__temp = (${expression});`);
        fnBody.push("if (__temp !== undefined && __temp !== null) {");
        fnBody.push("  __output.push(String(__temp));");
        fnBody.push("}");
      }
    } else if (trimmedStart.startsWith("=")) {
      const expression = trimmedStart.slice(1).trim();
      if (expression) {
        fnBody.push(`__temp = (${expression});`);
        fnBody.push("if (__temp !== undefined && __temp !== null) {");
        fnBody.push("  __output.push(__escape(String(__temp)));");
        fnBody.push("}");
      }
    } else {
      fnBody.push(rawScriptlet);
    }
    cursor = match.index + match[0].length;
  }

  const remainder = templateSource.slice(cursor);
  if (remainder) {
    fnBody.push(`__output.push(${JSON.stringify(remainder)});`);
  }
  fnBody.push('return __output.join("");');

  const body = `with (__state) {\n${fnBody.join("\n")}\n}`;
  let renderer;
  try {
    renderer = new Function("__state", "__escape", body);
  } catch (compilationError) {
    const error = new Error(
      `テンプレートのコンパイルに失敗しました: ${
        compilationError && compilationError.message
          ? compilationError.message
          : compilationError
      }`
    );
    error.name = "TemplateCompilationError";
    error.cause = compilationError;
    throw error;
  }

  try {
    return renderer(evaluationState, escapeHtmlForTemplate_);
  } catch (runtimeError) {
    const error =
      runtimeError instanceof Error
        ? runtimeError
        : new Error(String(runtimeError));
    if (!error.name || error.name === "Error") {
      error.name = "TemplateRenderingError";
    }
    error.message = `テンプレートのレンダリングに失敗しました: ${error.message}`;
    throw error;
  }
}

// === メール用HTMLテンプレートにコンテキストを差し込む本体 ==========
// getParticipantMailTemplateMarkup_ で取得した
//  - shellHtml (外枠テンプレ)
//  - bodyHtml  (本文テンプレ)
// に対して、contextや共有値(sharedValues)を埋め込んで
// 最終的な HtmlOutput を返す。
// mode には 'email' や 'preview' などが入り、
// テンプレート側で表示切り替えに使えるように safeContext.mode にセットする。
// {{key}} 形式のプレースホルダを走査し、escapeHtmlForTemplate_ を通した値で置換する。
function createParticipantMailTemplateOutput_(context, mode) {
  const safeContext =
    context && typeof context === "object" ? Object.assign({}, context) : {};
  safeContext.mode = mode;

  function evaluateTemplate(markup, injectedVars) {
    const vars =
      injectedVars && typeof injectedVars === "object" ? injectedVars : {};
    Object.keys(vars).forEach((key) => {
      safeContext[key] = vars[key];
    });
    const evaluationState = Object.assign(Object.create(null), vars, {
      context: safeContext,
      mode,
    });
    return renderHtmlTemplateMarkup_(markup, evaluationState);
  }

  try {
    const { shellHtml, bodyHtml } = getParticipantMailTemplateMarkup_();
    const sharedValues = deriveParticipantMailTemplateSharedValues_(context);
    const bodyMarkup = evaluateTemplate(
      bodyHtml,
      Object.assign({}, sharedValues)
    );
    safeContext.bodyMarkup = bodyMarkup;
    const shellInjectedVars = Object.assign({}, sharedValues, {
      bodyMarkup,
    });
    const shellMarkup = evaluateTemplate(shellHtml, shellInjectedVars);
    return HtmlService.createHtmlOutput(shellMarkup);
  } catch (error) {
    if (!shouldRefreshParticipantMailTemplateCache_(error)) {
      throw error;
    }
    logMailError_(
      "メールテンプレートの評価に失敗したため、キャッシュを更新します",
      error
    );
    try {
      const { shellHtml, bodyHtml } = getParticipantMailTemplateMarkup_({
        forceRefresh: true,
      });
      const sharedValues = deriveParticipantMailTemplateSharedValues_(context);
      const bodyMarkup = evaluateTemplate(
        bodyHtml,
        Object.assign({}, sharedValues)
      );
      safeContext.bodyMarkup = bodyMarkup;
      const shellInjectedVars = Object.assign({}, sharedValues, {
        bodyMarkup,
      });
      const shellMarkup = evaluateTemplate(shellHtml, shellInjectedVars);
      return HtmlService.createHtmlOutput(shellMarkup);
    } catch (retryError) {
      logMailError_("メールテンプレートの再評価に失敗しました", retryError);
      throw retryError;
    }
  }
}

function stripHtmlToPlainText_(input) {
  if (!input) {
    return "";
  }
  return String(input)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|h[1-6])>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "\n・")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// === 参加者メールのプレーンテキスト版本文を組み立てる ==============
// HTMLメールだけでなく、text/plain 部分にもそれなりに読める文章を入れるため、
// context からテキスト専用の本文を行単位で構築する。
// 「◯◯ 様」「「イベント名」にご参加いただきありがとうございます。」
// といった挨拶から始まり、
// 日程・場所・持ち物・注意事項・質問フォームURL などを
// 人間が読んで分かりやすい順番でならべて1本のテキストにする。
function renderParticipantMailPlainText_(context) {
  const lines = [];
  if (context.participantName) {
    lines.push(`${context.participantName} 様`, "");
  }
  const eventName = coalesceStrings_(
    context.eventName,
    context.eventLabel,
    context.eventId,
    extractSubjectEventName_(context.subject),
    "イベント"
  );
  lines.push(`「${eventName}」にご参加いただきありがとうございます。`);
  if (context.tagline) {
    lines.push("", context.tagline);
  }
  if (context.scheduleRangeLabel) {
    lines.push("", `ご参加予定日時: ${context.scheduleRangeLabel}`);
  } else if (context.scheduleLabel) {
    lines.push("", `ご参加予定: ${context.scheduleLabel}`);
  }
  const locationText = coalesceStrings_(
    context.location,
    context.scheduleLocation
  );
  if (locationText) {
    lines.push("", `会場: ${locationText}`);
  }
  if (context.arrivalNote) {
    lines.push("", context.arrivalNote);
  }
  const screenshotNote = coalesceStrings_(
    context.screenshotNote,
    "受付の際に本人確認のため、本メール画面をご提示いただく場合がございます。あらかじめスクリーンショットのご用意をお願いします。"
  );
  lines.push("", screenshotNote);
  if (context.guidance) {
    lines.push("", context.guidance);
  }
  if (context.additionalText) {
    lines.push("", context.additionalText);
  }
  if (context.additionalHtml) {
    const htmlText = stripHtmlToPlainText_(context.additionalHtml);
    if (htmlText) {
      lines.push("", htmlText);
    }
  }
  if (context.webViewUrl) {
    lines.push("", `メールが正しく表示されない場合: ${context.webViewUrl}`);
  }
  if (context.questionFormUrl) {
    const questionPrompt = coalesceStrings_(
      context.questionFormPrompt,
      "質問フォームはこちらからご投稿いただけます。"
    );
    if (questionPrompt) {
      lines.push("", questionPrompt);
    }
    const questionLabel = coalesceStrings_(
      context.questionFormLabel,
      "質問フォーム"
    );
    lines.push("", `${questionLabel}: ${context.questionFormUrl}`);
  }
  const hasContactLink =
    context.contactLinkUrl && !/^mailto:/i.test(context.contactLinkUrl);
  const hasContactEmail = !!context.contactEmail;
  if (hasContactLink || hasContactEmail) {
    const contactPrompt = coalesceStrings_(
      context.contactPrompt,
      "事情があって会に参加できなくなった場合や、質問がある場合はお問い合わせください。"
    );
    lines.push("", contactPrompt);
    if (hasContactLink) {
      lines.push("", `お問い合わせフォーム: ${context.contactLinkUrl}`);
    }
    if (hasContactEmail) {
      lines.push("", `お問い合わせ先: ${context.contactEmail}`);
    }
  }
  if (context.footerNote) {
    lines.push("", context.footerNote);
  }
  const closingMessage = coalesceStrings_(
    context.closingMessage,
    "それでは、みなさんに会えるのをお待ちしています！"
  );
  lines.push("", closingMessage);
  const signaturePrimary = coalesceStrings_(
    context.signaturePrimary,
    context.senderName,
    "弘前大学生協学生委員会"
  );
  if (signaturePrimary) {
    lines.push("", signaturePrimary);
  }
  const signatureSecondary = coalesceStrings_(
    context.signatureSecondary,
    context.senderTeam,
    context.eventName ? `${context.eventName}運営チーム` : ""
  );
  if (signatureSecondary) {
    lines.push(signatureSecondary);
  }
  return lines.join("\n");
}

function isGmailAdvancedServiceAvailable_() {
  return (
    typeof Gmail !== "undefined" &&
    Gmail &&
    Gmail.Users &&
    Gmail.Users.Messages &&
    typeof Gmail.Users.Messages.send === "function"
  );
}

function encodeMailHeaderTextBase64_(value) {
  const stringValue = String(value || "");
  if (!stringValue) {
    return "";
  }
  const encoded = Utilities.base64Encode(
    Utilities.newBlob(stringValue, "text/plain").getBytes()
  );
  return `=?UTF-8?B?${encoded}?=`;
}

function buildParticipantMailRawMessage_(options) {
  const boundary = "=_ParticipantMail_" + Utilities.getUuid().replace(/-/g, "");
  const headers = [];
  headers.push(`To: ${options.to}`);
  if (options.fromHeader) {
    headers.push(`From: ${options.fromHeader}`);
  }
  if (options.replyTo) {
    headers.push(`Reply-To: ${options.replyTo}`);
  }
  headers.push(`Subject: ${options.subjectHeader}`);
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  headers.push("");

  headers.push(`--${boundary}`);
  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: base64");
  headers.push("");
  headers.push(
    Utilities.base64Encode(
      Utilities.newBlob(
        String(options.plainBody || ""),
        "text/plain"
      ).getBytes()
    )
  );
  headers.push("");

  headers.push(`--${boundary}`);
  headers.push("Content-Type: text/html; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: base64");
  headers.push("");
  headers.push(
    Utilities.base64Encode(
      Utilities.newBlob(String(options.htmlBody || ""), "text/html").getBytes()
    )
  );
  headers.push("");

  headers.push(`--${boundary}--`);
  headers.push("");

  return headers.join("\r\n");
}

// === 参加者メールを1通送信する(低レベル送信処理) ====================
// optionsとして、宛先(to)、件名(subject)、HTML本文(htmlBody)、
// テキスト本文(textBody)、差出人名(senderName)、Reply-Toアドレス(replyTo),
// Fromアドレス(fromEmail)などを受け取り、
// 1. 高度なGmailサービス(Gmail.Users.Messages.send)が使える場合:
//    MIMEメッセージを手動で組み立てて raw として送信
// 2. 使えない場合:
//    MailApp.sendEmail(...) を使ってHTML+テキストメールを送信
// という二段構えで送信する。
// stripHtmlToPlainText_ でHTMLからテキストを生成するfallbackもここで行う。
function sendParticipantMailMessage_(options) {
  const to = String(options.to || "").trim();
  if (!to) {
    throw new Error("宛先メールアドレスが指定されていません。");
  }
  const subject = String(options.subject || "");
  const htmlBody = String(options.htmlBody || "");
  const plainBody =
    options.textBody !== undefined && options.textBody !== null
      ? String(options.textBody)
      : stripHtmlToPlainText_(htmlBody);
  const senderName = String(options.senderName || "").trim();
  const replyTo = String(options.replyTo || "").trim();
  const fromEmail = String(options.fromEmail || "").trim();

  if (isGmailAdvancedServiceAvailable_()) {
    const subjectHeader = encodeMailHeaderTextBase64_(subject);
    let fromHeader = "";
    if (fromEmail) {
      fromHeader = senderName
        ? `${encodeMailHeaderTextBase64_(senderName)} <${fromEmail}>`
        : fromEmail;
    }
    const rawMessage = buildParticipantMailRawMessage_({
      to,
      fromHeader,
      replyTo,
      subjectHeader,
      plainBody,
      htmlBody,
    });
    const encodedRaw = Utilities.base64EncodeWebSafe(
      Utilities.newBlob(rawMessage).getBytes()
    ).replace(/=+$/, "");
    Gmail.Users.Messages.send({ raw: encodedRaw }, "me");
    return;
  }

  MailApp.sendEmail({
    to,
    subject,
    htmlBody,
    body: plainBody,
    name: senderName || undefined,
    replyTo: replyTo || undefined,
  });
}

// === 参加者一覧に対して一斉メール送信を行うメイン処理 ===============
// doPost(action: 'sendParticipantMail') から呼ばれるエントリポイント。
// 1. eventId / scheduleId を正規化し、principal がそのイベントの
//    オペレーター権限を持っているか assertOperatorForEvent_ で確認する。
// 2. RTDBから eventRecord / scheduleRecord / participant 一覧を取得し、
//    送信対象の参加者(未送信 or force=true の場合は再送対象)を絞り込む。
// 3. 各参加者ごとに：
//    - buildParticipantMailContext_ で差し込み用contextを構築
//    - enrichParticipantMailContext_ で不足情報を補完
//    - buildParticipantMailSubject_ で件名を作成
//    - buildParticipantMailPreviewText_ でプレビュー文を作成
//    - createParticipantMailTemplateOutput_ でHTML本文を生成
//    - renderParticipantMailPlainText_ でテキスト本文を生成
//    - sendParticipantMailMessage_ で1通ずつ送信
// 4. 送信結果をRTDBやスプレッドシートに記録し、ログも残す。
// 5. MailApp.getRemainingDailyQuota() で日次送信枠をチェックし、
//    足りない場合はエラーとして中断する。
function sendParticipantMail_(principal, req) {
  const eventId = normalizeEventId_(req && req.eventId);
  const scheduleId = normalizeKey_(req && req.scheduleId);
  if (!eventId) {
    throw new Error("eventId is required.");
  }
  if (!scheduleId) {
    throw new Error("scheduleId is required.");
  }
  assertOperatorForEvent_(principal, eventId);

  const force = req && req.force === true;
  logMail_("参加者メール送信処理を開始します", {
    eventId,
    scheduleId,
    force,
  });
  const accessToken = getFirebaseAccessToken_();
  const eventRecord =
    fetchRtdb_(`questionIntake/events/${eventId}`, accessToken) || {};
  const scheduleRecord =
    fetchRtdb_(
      `questionIntake/schedules/${eventId}/${scheduleId}`,
      accessToken
    ) || {};
  if (!scheduleRecord || typeof scheduleRecord !== "object") {
    throw new Error("指定された日程が見つかりません。");
  }
  const eventRecordName = coalesceStrings_(
    eventRecord &&
      (eventRecord.name ||
        eventRecord.title ||
        eventRecord.eventName ||
        eventRecord.eventLabel),
    ""
  );
  const scheduleRecordLabel = coalesceStrings_(
    scheduleRecord && (scheduleRecord.label || scheduleRecord.scheduleLabel),
    formatScheduleLabel_(
      scheduleRecord && scheduleRecord.startAt,
      scheduleRecord && scheduleRecord.endAt
    ),
    ""
  );
  logMail_("イベント・日程情報の取得結果を確認しました", {
    eventId,
    scheduleId,
    eventRecordName,
    scheduleRecordLabel,
  });
  const participantsBranch =
    fetchRtdb_(
      `questionIntake/participants/${eventId}/${scheduleId}`,
      accessToken
    ) || {};
  logMail_("参加者情報を取得しました", {
    eventId,
    scheduleId,
    participantCount: Object.keys(participantsBranch || {}).length,
  });
  const settings = getParticipantMailSettings_();
  const baseUrl = getWebAppBaseUrl_();
  const questionFormBaseUrl = getQuestionFormBaseUrl_();
  const normalizedPrincipalEmail = normalizeEmail_(
    principal && principal.email
  );
  const fallbackContactEmail = coalesceStrings_(
    settings.contactEmail,
    normalizedPrincipalEmail
  );
  const senderName = buildParticipantMailSenderName_(eventRecordName);

  const recipients = [];
  let skippedMissingEmail = 0;
  let skippedAlreadySent = 0;

  Object.keys(participantsBranch || {}).forEach((participantKey) => {
    const value = participantsBranch[participantKey];
    if (!value || typeof value !== "object") {
      return;
    }
    const email = String(value.email || "").trim();
    if (!email) {
      skippedMissingEmail += 1;
      return;
    }
    const status = String(value.mailStatus || "")
      .trim()
      .toLowerCase();
    const mailSentAt = Number(value.mailSentAt || 0);
    const mailError = String(value.mailError || "").trim();
    if (!force && status === "sent" && !mailError && mailSentAt > 0) {
      skippedAlreadySent += 1;
      return;
    }
    recipients.push({ id: participantKey, record: value, email });
  });

  logMail_("メール送信対象の参加者を抽出しました", {
    eventId,
    scheduleId,
    totalParticipants: Object.keys(participantsBranch || {}).length,
    recipients: recipients.length,
    skippedMissingEmail,
    skippedAlreadySent,
  });

  if (!recipients.length) {
    logMail_("送信対象が存在しないためメール送信を終了します", {
      eventId,
      scheduleId,
      skippedMissingEmail,
      skippedAlreadySent,
    });
    return {
      summary: {
        total: 0,
        sent: 0,
        failed: 0,
        skippedMissingEmail,
        skippedAlreadySent,
      },
      results: [],
      message: "送信対象の参加者が見つかりませんでした。",
    };
  }

  const remainingQuota = MailApp.getRemainingDailyQuota();
  logMail_("残りのメール送信枠を確認しました", {
    remainingQuota,
    required: recipients.length,
  });
  if (remainingQuota < recipients.length) {
    logMailError_("メール送信枠が不足しています", null, {
      remainingQuota,
      required: recipients.length,
    });
    throw new Error(
      `本日の残り送信可能数（${remainingQuota}件）を超えるため送信できません。`
    );
  }

  const updates = {};
  const results = [];
  let sentCount = 0;
  let failedCount = 0;

  recipients.forEach(({ id, record, email }) => {
    const participantRecord = Object.assign({}, record, { participantId: id });
    logMail_("参加者へのメール送信を試行します", {
      participantId: id,
      email,
    });
    const context = buildParticipantMailContext_(
      eventId,
      scheduleId,
      participantRecord,
      eventRecord,
      scheduleRecord,
      settings,
      baseUrl,
      questionFormBaseUrl
    );
    context.contactEmail = coalesceStrings_(
      context.contactEmail,
      fallbackContactEmail
    );
    context.senderName = senderName;
    const eventNameBeforeSubject = context.eventName || "";
    const subject = buildParticipantMailSubject_(context, settings);
    context.subject = subject;
    const subjectEventName = extractSubjectEventName_(subject);
    enrichParticipantMailContext_(context, settings);
    logMail_("参加者メール用コンテキストを検証しました", {
      participantId: id,
      email,
      eventNameBeforeSubject,
      eventNameAfterEnrich: context.eventName || "",
      eventLabel: context.eventLabel || "",
      eventId: context.eventId || "",
      subject,
      subjectEventName,
      scheduleLabel: context.scheduleLabel || "",
      scheduleRangeLabel: context.scheduleRangeLabel || "",
    });
    const htmlBody = createParticipantMailTemplateOutput_(
      context,
      "email"
    ).getContent();
    const textBody = renderParticipantMailPlainText_(context);
    const contactEmail = String(context.contactEmail || "").trim();
    const attemptAt = Date.now();
    try {
      sendParticipantMailMessage_({
        to: email,
        subject,
        htmlBody,
        textBody,
        senderName: senderName || context.eventName || "",
        replyTo: contactEmail,
        fromEmail: normalizedPrincipalEmail || contactEmail || "",
      });
      sentCount += 1;
      logMail_("参加者へのメール送信に成功しました", {
        participantId: id,
        email,
        attemptAt,
        subject,
      });
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailStatus`
      ] = "sent";
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailSentAt`
      ] = attemptAt;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastSubject`
      ] = subject;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastMessageId`
      ] = "";
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailError`
      ] = null;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailSentBy`
      ] = normalizedPrincipalEmail || contactEmail || "";
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptAt`
      ] = attemptAt;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptBy`
      ] = normalizedPrincipalEmail || contactEmail || "";
      results.push({
        participantId: id,
        mailStatus: "sent",
        mailSentAt: attemptAt,
        mailLastSubject: subject,
        mailLastMessageId: "",
        mailError: "",
        mailSentBy: normalizedPrincipalEmail || contactEmail || "",
        mailLastAttemptAt: attemptAt,
        mailLastAttemptBy: normalizedPrincipalEmail || contactEmail || "",
      });
    } catch (error) {
      failedCount += 1;
      const message = String(
        (error && error.message) || error || "送信に失敗しました。"
      );
      logMailError_("参加者へのメール送信でエラーが発生しました", error, {
        participantId: id,
        email,
        attemptAt,
        subject,
        message,
      });
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailStatus`
      ] = "error";
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailError`
      ] = message;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastSubject`
      ] = subject;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptAt`
      ] = attemptAt;
      updates[
        `questionIntake/participants/${eventId}/${scheduleId}/${id}/mailLastAttemptBy`
      ] = normalizedPrincipalEmail || contactEmail || "";
      results.push({
        participantId: id,
        mailStatus: "error",
        mailError: message,
        mailLastSubject: subject,
        mailLastAttemptAt: attemptAt,
        mailLastAttemptBy: normalizedPrincipalEmail || contactEmail || "",
      });
    }
  });

  if (Object.keys(updates).length) {
    const timestamp = Date.now();
    updates[`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`] =
      timestamp;
    updates[`questionIntake/events/${eventId}/updatedAt`] = timestamp;
    patchRtdb_(updates, accessToken);
    logMail_("メール送信結果をRealtime Databaseへ反映しました", {
      eventId,
      scheduleId,
      updatedPaths: Object.keys(updates).length,
    });
  } else {
    logMail_("Realtime Databaseへの更新はありませんでした", {
      eventId,
      scheduleId,
    });
  }

  const summary = {
    total: recipients.length,
    sent: sentCount,
    failed: failedCount,
    skippedMissingEmail,
    skippedAlreadySent,
  };

  const messageParts = [];
  if (sentCount > 0) {
    messageParts.push(`${sentCount}件のメールを送信しました。`);
  }
  if (failedCount > 0) {
    messageParts.push(`${failedCount}件でエラーが発生しました。`);
  }
  if (!messageParts.length) {
    messageParts.push("送信対象の参加者が見つかりませんでした。");
  }

  const logDetails = [
    `event=${eventId}`,
    `schedule=${scheduleId}`,
    `sent=${sentCount}`,
    `failed=${failedCount}`,
    `skipped_missing_email=${skippedMissingEmail}`,
    `skipped_sent=${skippedAlreadySent}`,
  ].join(", ");
  logAction_(principal, "sendParticipantMail", logDetails);

  const message = messageParts.join(" ");
  logMail_("参加者メール送信処理が完了しました", {
    eventId,
    scheduleId,
    sent: sentCount,
    failed: failedCount,
    skippedMissingEmail,
    skippedAlreadySent,
    message,
  });

  return {
    summary,
    results,
    message,
  };
}

function renderQaUploadStatusResponse_(e) {
  const payload = {
    success: true,
    status: "ok",
    timestamp: toIsoJst_(new Date()),
  };
  return withCors_(
    ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
      ContentService.MimeType.JSON
    ),
    getRequestOrigin_(e)
  );
}

function renderParticipantMailErrorPage_() {
  const output = HtmlService.createHtmlOutput(
    "<!DOCTYPE html><html lang='ja'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>リンクが無効です</title></head><body><main style=\"font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;max-width:560px;margin:0 auto;\"><h1>リンクが無効です</h1><p>アクセスされたリンクは無効、または期限が切れています。</p></main></body></html>"
  );
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function resolveParticipantMailForToken_(req) {
  const rawToken = normalizeKey_(req && (req.token || req.accessToken));
  if (!rawToken) {
    throw new Error(
      "メールの表示に必要なアクセスキーが見つかりませんでした。配布された最新のリンクからアクセスしてください。"
    );
  }
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(rawToken)) {
    throw new Error(
      "アクセスリンクが無効です。最新のURLからアクセスしてください。"
    );
  }
  const logContext = {
    tokenSuffix: rawToken.slice(-6),
  };
  logMail_("参加者メールのWeb表示リクエストを受信しました", logContext);

  try {
    let accessToken;
    try {
      accessToken = getFirebaseAccessToken_();
    } catch (error) {
      throw new Error(
        "アクセス情報の確認に失敗しました。時間をおいて再度お試しください。"
      );
    }

    let tokenRecord;
    try {
      tokenRecord = fetchRtdb_(
        "questionIntake/tokens/" + rawToken,
        accessToken
      );
    } catch (error) {
      throw new Error(
        "アクセス情報の確認に失敗しました。時間をおいて再度お試しください。"
      );
    }

    if (!tokenRecord || typeof tokenRecord !== "object") {
      throw new Error(
        "このリンクは無効化されています。運営までお問い合わせください。"
      );
    }
    if (tokenRecord.revoked) {
      throw new Error(
        "このリンクは無効化されています。運営までお問い合わせください。"
      );
    }
    const expiresAt = Number(tokenRecord.expiresAt || 0);
    if (expiresAt && Date.now() > expiresAt) {
      throw new Error(
        "このリンクの有効期限が切れています。運営までお問い合わせください。"
      );
    }

    const eventId = normalizeEventId_(tokenRecord.eventId);
    const scheduleId = normalizeScheduleId_(tokenRecord.scheduleId);
    const participantId = normalizeKey_(
      tokenRecord.participantId || tokenRecord.participantUid
    );
    if (!eventId || !scheduleId || !participantId) {
      throw new Error(
        "アクセスに必要な情報が不足しています。運営までお問い合わせください。"
      );
    }

    logContext.eventId = eventId;
    logContext.scheduleId = scheduleId;
    logContext.participantId = participantId;

    let participantRecord;
    try {
      participantRecord = fetchRtdb_(
        `questionIntake/participants/${eventId}/${scheduleId}/${participantId}`,
        accessToken
      );
    } catch (error) {
      participantRecord = null;
    }

    if (!participantRecord || typeof participantRecord !== "object") {
      logMail_(
        "参加者レコードが見つからなかったためトークン情報を利用して補完します",
        logContext
      );
      participantRecord = {
        participantId,
        token: rawToken,
        name: String(tokenRecord.displayName || "").trim(),
        displayName: String(tokenRecord.displayName || "").trim(),
        scheduleLabel: String(tokenRecord.scheduleLabel || "").trim(),
        scheduleLocation: String(tokenRecord.scheduleLocation || "").trim(),
        scheduleDate: String(tokenRecord.scheduleDate || "").trim(),
        scheduleStart: String(tokenRecord.scheduleStart || "").trim(),
        scheduleEnd: String(tokenRecord.scheduleEnd || "").trim(),
        guidance: String(tokenRecord.guidance || "").trim(),
        eventName: String(tokenRecord.eventName || "").trim(),
        eventLabel: String(tokenRecord.eventName || "").trim(),
        groupNumber: String(
          tokenRecord.groupNumber || tokenRecord.teamNumber || ""
        ).trim(),
        teamNumber: String(tokenRecord.teamNumber || "").trim(),
      };
    }

    let eventRecord = {};
    let scheduleRecord = {};
    try {
      eventRecord =
        fetchRtdb_(`questionIntake/events/${eventId}`, accessToken) || {};
    } catch (ignoreEventError) {
      eventRecord = {};
    }
    try {
      scheduleRecord =
        fetchRtdb_(
          `questionIntake/schedules/${eventId}/${scheduleId}`,
          accessToken
        ) || {};
    } catch (ignoreScheduleError) {
      scheduleRecord = {};
    }

    const participantContextRecord = Object.assign(
      {
        participantId,
        token: rawToken,
        name: String(tokenRecord.displayName || "").trim(),
        displayName: String(tokenRecord.displayName || "").trim(),
        eventName: String(tokenRecord.eventName || "").trim(),
        eventLabel: String(tokenRecord.eventName || "").trim(),
        scheduleLabel: String(tokenRecord.scheduleLabel || "").trim(),
        scheduleLocation: String(tokenRecord.scheduleLocation || "").trim(),
        scheduleDate: String(tokenRecord.scheduleDate || "").trim(),
        scheduleTime: String(tokenRecord.scheduleTime || "").trim(),
        scheduleRange: String(tokenRecord.scheduleRange || "").trim(),
        guidance: String(tokenRecord.guidance || "").trim(),
        groupNumber: String(
          tokenRecord.groupNumber || tokenRecord.teamNumber || ""
        ).trim(),
        teamNumber: String(tokenRecord.teamNumber || "").trim(),
      },
      participantRecord || {}
    );
    participantContextRecord.participantId = participantId;
    participantContextRecord.token = coalesceStrings_(
      participantContextRecord.token,
      rawToken
    );
    if (
      !participantContextRecord.name &&
      tokenRecord &&
      tokenRecord.displayName
    ) {
      participantContextRecord.name = String(
        tokenRecord.displayName || ""
      ).trim();
    }
    if (
      !participantContextRecord.eventName &&
      tokenRecord &&
      tokenRecord.eventName
    ) {
      participantContextRecord.eventName = String(
        tokenRecord.eventName || ""
      ).trim();
    }
    if (
      !participantContextRecord.scheduleLabel &&
      tokenRecord &&
      tokenRecord.scheduleLabel
    ) {
      participantContextRecord.scheduleLabel = String(
        tokenRecord.scheduleLabel || ""
      ).trim();
    }
    if (
      !participantContextRecord.scheduleLocation &&
      tokenRecord &&
      tokenRecord.scheduleLocation
    ) {
      participantContextRecord.scheduleLocation = String(
        tokenRecord.scheduleLocation || ""
      ).trim();
    }
    if (
      !participantContextRecord.scheduleDate &&
      tokenRecord &&
      tokenRecord.scheduleDate
    ) {
      participantContextRecord.scheduleDate = String(
        tokenRecord.scheduleDate || ""
      ).trim();
    }
    if (!participantContextRecord.scheduleTime) {
      const start = String(tokenRecord.scheduleStart || "").trim();
      const end = String(tokenRecord.scheduleEnd || "").trim();
      if (start || end) {
        participantContextRecord.scheduleTime =
          start && end ? `${start}〜${end}` : start || end;
      }
    }
    if (
      !participantContextRecord.scheduleRange &&
      tokenRecord &&
      tokenRecord.scheduleRange
    ) {
      participantContextRecord.scheduleRange = String(
        tokenRecord.scheduleRange || ""
      ).trim();
    }
    if (
      !participantContextRecord.guidance &&
      tokenRecord &&
      tokenRecord.guidance
    ) {
      participantContextRecord.guidance = String(
        tokenRecord.guidance || ""
      ).trim();
    }

    const settings = getParticipantMailSettings_();
    const baseUrl = getWebAppBaseUrl_();
    const questionFormBaseUrl = getQuestionFormBaseUrl_();

    const context = buildParticipantMailContext_(
      eventId,
      scheduleId,
      participantContextRecord,
      eventRecord,
      scheduleRecord,
      settings,
      baseUrl,
      questionFormBaseUrl
    );
    const subject = buildParticipantMailSubject_(context, settings);
    context.subject = subject;
    context.contactEmail = coalesceStrings_(
      context.contactEmail,
      settings.contactEmail
    );
    context.senderName = coalesceStrings_(
      context.senderName,
      buildParticipantMailSenderName_(context.eventName || "")
    );
    enrichParticipantMailContext_(context, settings);

    const htmlOutput = createParticipantMailTemplateOutput_(context, "web");
    const html = htmlOutput.getContent();
    const plainText = renderParticipantMailPlainText_(context);

    logMail_("参加者メールのWeb表示用HTMLを生成しました", logContext);

    return {
      subject,
      html,
      plainText,
      context: {
        eventName: context.eventName || "",
        scheduleLabel:
          context.scheduleLabel || context.scheduleRangeLabel || "",
        scheduleDateLabel: context.scheduleDateLabel || "",
        scheduleTimeRange: context.scheduleTimeRange || "",
        participantName: context.participantName || "",
        questionFormUrl: context.questionFormUrl || "",
        contactLinkUrl: context.contactLinkUrl || "",
        contactEmail: context.contactEmail || "",
        footerNote: context.footerNote || "",
      },
    };
  } catch (error) {
    logMailError_("参加者メールのWeb表示生成に失敗しました", error, logContext);
    throw error;
  }
}

function renderParticipantMailPage_(e) {
  const eventId = normalizeEventId_(e && e.parameter && e.parameter.eventId);
  const scheduleId = normalizeKey_(e && e.parameter && e.parameter.scheduleId);
  const participantId = normalizeKey_(
    e && e.parameter && (e.parameter.participantId || e.parameter.uid)
  );
  const tokenParam = normalizeKey_(e && e.parameter && e.parameter.token);
  if (!eventId || !scheduleId || !participantId) {
    return renderParticipantMailErrorPage_();
  }
  logMail_("参加者メールプレビューページのレンダリングを開始します", {
    eventId,
    scheduleId,
    participantId,
  });
  try {
    const accessToken = getFirebaseAccessToken_();
    const participant = fetchRtdb_(
      `questionIntake/participants/${eventId}/${scheduleId}/${participantId}`,
      accessToken
    );
    if (!participant || typeof participant !== "object") {
      return renderParticipantMailErrorPage_();
    }
    const storedToken = String(participant.token || "").trim();
    if (storedToken) {
      const normalizedParam = String(tokenParam || "").trim();
      if (!normalizedParam || normalizedParam !== storedToken) {
        return renderParticipantMailErrorPage_();
      }
    }
    const eventRecord =
      fetchRtdb_(`questionIntake/events/${eventId}`, accessToken) || {};
    const scheduleRecord =
      fetchRtdb_(
        `questionIntake/schedules/${eventId}/${scheduleId}`,
        accessToken
      ) || {};
    const settings = getParticipantMailSettings_();
    const baseUrl = getWebAppBaseUrl_();
    const questionFormBaseUrl = getQuestionFormBaseUrl_();
    const context = buildParticipantMailContext_(
      eventId,
      scheduleId,
      Object.assign({}, participant, { participantId }),
      eventRecord,
      scheduleRecord,
      settings,
      baseUrl,
      questionFormBaseUrl
    );
    const subject = buildParticipantMailSubject_(context, settings);
    context.subject = subject;
    context.contactEmail = coalesceStrings_(
      context.contactEmail,
      settings.contactEmail
    );
    context.senderName = coalesceStrings_(
      context.senderName,
      buildParticipantMailSenderName_(context.eventName || "")
    );
    enrichParticipantMailContext_(context, settings);
    const output = createParticipantMailTemplateOutput_(context, "web");
    output.setTitle(
      `${context.eventName || "ご案内"} - ${context.scheduleLabel || ""}`
    );
    output.addMetaTag("viewport", "width=device-width, initial-scale=1");
    output.addMetaTag("referrer", "no-referrer");
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    logMail_("参加者メールプレビューページのレンダリングが完了しました", {
      eventId,
      scheduleId,
      participantId,
    });
    return output;
  } catch (error) {
    logMailError_(
      "参加者メールプレビューページのレンダリングに失敗しました",
      error,
      {
        eventId,
        scheduleId,
        participantId,
      }
    );
    console.error("renderParticipantMailPage_ failed", error);
    return renderParticipantMailErrorPage_();
  }
}

// ================================
// リクエストボディの共通パーサ
// ================================
// フロントエンドから送られてくるPOSTリクエストを、
// - JSON (application/json)
// - フォーム (x-www-form-urlencoded / multipart/form-data)
// のどちらでも受け取れるようにして、
// 最終的に「普通のオブジェクト」に統一して返す役割。
// doPostから最初に呼び出される。
function parseBody_(e) {
  if (!e) throw new Error("No body");

  const postData = e.postData;
  const parameter = e && typeof e.parameter === "object" ? e.parameter : null;
  const parameters =
    e && typeof e.parameters === "object" ? e.parameters : null;

  if (postData) {
    const type = String(postData.type || "").toLowerCase();
    const contents = postData.contents || "";

    // application/x-www-form-urlencoded または multipart/form-data
    // → e.parameter / e.parameters から組み立て直す
    if (type.indexOf("application/json") !== -1) {
      try {
        return contents ? JSON.parse(contents) : {};
      } catch (error) {
        throw new Error("Invalid JSON");
      }
    }

    if (
      type.indexOf("application/x-www-form-urlencoded") !== -1 ||
      type.indexOf("multipart/form-data") !== -1
    ) {
      return parseParameterObject_(parameter, parameters);
    }

    // それ以外で中身があればJSONとして解釈を試みる
    if (contents) {
      try {
        return JSON.parse(contents);
      } catch (error) {
        if (!parameter || !Object.keys(parameter).length) {
          throw new Error("Invalid JSON");
        }
      }
    }
  }

  // POSTにbodyが無いか、JSONが壊れていた場合はパラメータから組み立てる
  if (parameter && Object.keys(parameter).length) {
    return parseParameterObject_(parameter, parameters);
  }

  throw new Error("No body");
}

function parseParameterObject_(parameter, parameters) {
  const single = parameter && typeof parameter === "object" ? parameter : {};
  const multi = parameters && typeof parameters === "object" ? parameters : {};
  const result = {};

  Object.keys(single).forEach((key) => {
    result[key] = single[key];
  });

  Object.keys(multi).forEach((key) => {
    const values = multi[key];
    if (Array.isArray(values) && values.length > 1) {
      result[key] = values.slice();
    }
  });

  return result;
}

function requireAuth_(idToken, options) {
  options = options || {};
  if (!idToken) throw new Error("Missing idToken");

  const KEY = PropertiesService.getScriptProperties().getProperty(
    "FIREBASE_WEB_API_KEY"
  );
  if (!KEY) throw new Error("Missing FIREBASE_WEB_API_KEY");

  const url =
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + KEY;
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ idToken }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error("Auth HTTP " + code);

  const obj = JSON.parse(res.getContentText());
  const user = obj.users && obj.users[0];
  if (!user) throw new Error("Auth failed: user not found");

  const providerInfo = Array.isArray(user.providerUserInfo)
    ? user.providerUserInfo
    : [];
  let tokenPayload = null;
  try {
    tokenPayload = parseJwt_(idToken);
  } catch (e) {
    tokenPayload = null;
  }

  const providerIds = providerInfo
    .map((info) => String((info && info.providerId) || ""))
    .filter(Boolean);
  const normalizedProviderIds = providerIds.map((id) => id.toLowerCase());
  const signInProvider =
    tokenPayload &&
    tokenPayload.firebase &&
    tokenPayload.firebase["sign_in_provider"];
  const allowAnonymous = options.allowAnonymous === true;

  const resolvedEmail =
    user.email ||
    (providerInfo.find((p) => p.email) || {}).email ||
    (tokenPayload && tokenPayload.email ? tokenPayload.email : "") ||
    "";

  const providersLookAnonymous =
    normalizedProviderIds.length === 0 ||
    normalizedProviderIds.every(
      (id) => id === "anonymous" || id === "firebase"
    );
  let isAnonymous = signInProvider === "anonymous";
  if (!isAnonymous) {
    if (!resolvedEmail && providersLookAnonymous) {
      isAnonymous = true;
    } else if (!resolvedEmail && allowAnonymous) {
      isAnonymous = true;
    }
  }

  if (isAnonymous && !allowAnonymous)
    throw new Error("Anonymous auth not allowed");

  let email = "";
  if (!isAnonymous) {
    email = String(resolvedEmail || "").trim();

    const allowed = getAllowedDomains_().map((d) => String(d).toLowerCase());
    if (allowed.length && email) {
      const domain = String(email).split("@")[1] || "";
      if (!allowed.includes(domain.toLowerCase()))
        throw new Error("Unauthorized domain");
    }
    if (user.emailVerified !== true) throw new Error("Email not verified");
  }

  if (user.disabled === true) throw new Error("User disabled");

  return {
    uid: user.localId,
    email: String(email || "").trim(),
    emailVerified: user.emailVerified === true,
    isAnonymous: isAnonymous,
  };
}

function parseJwt_(t) {
  const p = t.split(".")[1];
  return JSON.parse(
    Utilities.newBlob(Utilities.base64DecodeWebSafe(p)).getDataAsString()
  );
}

function getAllowedDomains_() {
  const raw =
    PropertiesService.getScriptProperties().getProperty(
      "ALLOWED_EMAIL_DOMAINS"
    ) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertOperator_(principal) {
  const email = String((principal && principal.email) || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("Forbidden: missing email");
  const users = getSheetData_("users");
  const ok = users.some(
    (row) =>
      String(row["メールアドレス"] || row["email"] || "")
        .trim()
        .toLowerCase() === email
  );
  if (!ok) throw new Error("Forbidden: not in users sheet");
}

function jsonOk(payload, requestOrigin) {
  const body = Object.assign({ success: true }, payload || {});
  return withCors_(
    ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
      ContentService.MimeType.JSON
    ),
    requestOrigin
  );
}

// ================================
// エラー応答(JSON)の共通フォーマット
// ================================
// 例外が発生したときに、サーバ側ログとクライアント側の両方に
// 分かりやすい情報を残すための共通関数。
// - ログには短いID付きでスタックトレースを出力
// - クライアントには success:false, error, errorId をJSONで返却
// CORSヘッダ付与は withCors_ に任せる。
function jsonErr_(err, requestOrigin) {
  const id = Utilities.getUuid().slice(0, 8);
  console.error("[" + id + "]", (err && err.stack) || err);
  return withCors_(
    ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: String((err && err.message) || err),
        errorId: id,
      })
    ).setMimeType(ContentService.MimeType.JSON),
    requestOrigin
  );
}

// ================================
// CORSヘッダ付与の共通ラッパー
// ================================
// ContentServiceのレスポンスに対して、
// Access-Control-Allow-* 系のヘッダをまとめて付与する。
// 実際に許可するOriginは normalizeAllowedOrigin_ で
// 設定済みのホワイトリストに基づいて決定する。
function withCors_(output, requestOrigin) {
  if (!output || typeof output.setHeader !== "function") {
    return output;
  }
  const origin = normalizeAllowedOrigin_(requestOrigin);
  return output
    .setHeader("Access-Control-Allow-Origin", origin)
    .setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    .setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, X-Requested-With, Origin"
    )
    .setHeader("Access-Control-Max-Age", "600")
    .setHeader("Vary", "Origin");
}

function normalizeAllowedOrigin_(requestOrigin) {
  const origin = String(requestOrigin || "").trim();
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    return origin;
  }
  if (ALLOWED_ORIGINS.indexOf("*") !== -1) {
    return "*";
  }
  return ALLOWED_ORIGINS[0] || "*";
}

function normalizeKey_(value) {
  return String(value || "").trim();
}

function normalizeEmail_(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeEventId_(eventId) {
  return normalizeKey_(eventId);
}

function normalizeScheduleId_(scheduleId) {
  const normalized = normalizeKey_(scheduleId);
  return normalized || DEFAULT_SCHEDULE_KEY;
}

function toPositiveInteger_(value) {
  if (value == null || value === "") {
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
    return "";
  }
  return eventKey + "::" + normalizeScheduleId_(scheduleId);
}

function buildRenderEventBasePath_(eventId, scheduleId) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return "";
  }
  const scheduleKey = normalizeScheduleId_(scheduleId);
  return `render/events/${eventKey}/${scheduleKey}`;
}

function getRenderStatePath_(eventId, scheduleId) {
  const basePath = buildRenderEventBasePath_(eventId, scheduleId);
  return basePath ? `${basePath}/state` : "render/state";
}

function getNowShowingPath_(eventId, scheduleId) {
  const basePath = buildRenderEventBasePath_(eventId, scheduleId);
  return basePath ? `${basePath}/nowShowing` : "render/state/nowShowing";
}

function getEventActiveSchedulePath_(eventId) {
  const eventKey = normalizeEventId_(eventId);
  return eventKey ? `render/events/${eventKey}/activeSchedule` : "";
}

function getEventRotationPath_(eventId) {
  const eventKey = normalizeEventId_(eventId);
  return eventKey ? `render/events/${eventKey}/rotationAssignments` : "";
}

function getEventSessionPath_(eventId, uid = null) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) return "";
  const uidKey = uid ? normalizeKey_(uid) : "";
  // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、uidごとにセッションを分ける
  return uidKey
    ? `render/events/${eventKey}/sessions/${uidKey}`
    : `render/events/${eventKey}/sessions`;
}

function getEventSessionsPath_(eventId) {
  const eventKey = normalizeEventId_(eventId);
  return eventKey ? `render/events/${eventKey}/sessions` : "";
}

function getActiveSchedulePathForSession_(session) {
  if (!session || typeof session !== "object") {
    return "";
  }
  const assignment =
    session.assignment && typeof session.assignment === "object"
      ? session.assignment
      : null;
  if (assignment && normalizeEventId_(assignment.eventId)) {
    return getEventActiveSchedulePath_(assignment.eventId);
  }
  if (normalizeEventId_(session.eventId)) {
    return getEventActiveSchedulePath_(session.eventId);
  }
  return "";
}

function buildActiveScheduleRecord_(assignment, session, operatorUid) {
  if (!assignment || typeof assignment !== "object") {
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
    scheduleLabel: String(assignment.scheduleLabel || "").trim(),
    mode: "locked",
    lockedAt,
    updatedAt: lockedAt,
    lockedByUid: normalizeKey_(assignment.lockedByUid || operatorUid),
    lockedByEmail: String(assignment.lockedByEmail || "").trim(),
    lockedByName: String(assignment.lockedByName || "").trim(),
    sessionUid,
    sessionId,
    expiresAt: Number((session && session.expiresAt) || 0) || null,
  };
}

// ================================
// リクエスト元Originの推定
// ================================
// フロントエンドから送られてきたリクエストの中から、
// 「どのOrigin(https://example.com)から呼ばれたか」を推定する。
// - JSONボディ内の origin / requestOrigin
// - URLパラメータの origin など
// を見て、URLとして妥当なものだけを取り出し、origin部分だけに正規化する。
function getRequestOrigin_(event, body) {
  const fallback =
    extractOriginFromBody_(body) || extractOriginFromParams_(event);
  if (fallback) {
    return fallback;
  }
  return "";
}

function extractOriginFromBody_(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  return sanitizeOrigin_(body.origin || body.requestOrigin || "");
}

function extractOriginFromParams_(event) {
  if (!event) return "";
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
  return "";
}

function sanitizeOrigin_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.origin;
  } catch (error) {
    return "";
  }
}

function requireSessionId_(raw) {
  const sessionId = String(raw || "").trim();
  if (!sessionId) throw new Error("Missing sessionId");
  return sessionId;
}

// === Firebase RTDB REST APIラッパー =========================
// fetchRtdb_: 指定パスのノードをGETしてJSONとして返す。
// patchRtdb_: 複数パスに対する部分更新(PATCH)をまとめて行う。
// postRtdb_: 指定パスにpush形式で新しい子ノードを追加する。
// すべてBearerトークン認証付きでUrlFetchAppを通して叩く。
function fetchRtdb_(path, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: "get",
    headers: token ? { Authorization: "Bearer " + token } : {},
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 200) {
    const text = res.getContentText();
    if (!text || text === "null") return null;
    return JSON.parse(text);
  }
  if (code === 404) return null;
  throw new Error("RTDB fetch failed: HTTP " + code);
}

function patchRtdb_(updates, token) {
  if (!updates || typeof updates !== "object") return;
  const res = UrlFetchApp.fetch(rtdbUrl_(""), {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(updates),
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error(
      "RTDB patch failed: HTTP " + code + " " + res.getContentText()
    );
  }
}

function putRtdb_(path, data, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(data),
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error(
      "RTDB put failed: HTTP " + code + " " + res.getContentText()
    );
  }
}

function postRtdb_(path, data, token) {
  const res = UrlFetchApp.fetch(rtdbUrl_(path), {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(data),
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error(
      "RTDB post failed: HTTP " + code + " " + res.getContentText()
    );
  }
  const textBody = res.getContentText();
  return textBody ? JSON.parse(textBody) : null;
}

function isDisplayPrincipal_(principal) {
  if (!principal) return false;
  if (principal.isAnonymous === true) return true;
  const email = String(principal.email || "").trim();
  return email === "";
}

function ensureDisplayPrincipal_(principal, message) {
  if (!isDisplayPrincipal_(principal)) {
    throw new Error(
      message || "Only anonymous display accounts can perform this action"
    );
  }
  return principal;
}

// === display用セッションの開始(begin) ======================
// display.html 側が立ち上がったときに最初に呼ばれるエンドポイント。
// 1. principal(uid)とeventIdを元にセッションIDを決める
// 2. screens/sessions/{uid} にセッション情報(status, startedAt など)を書き込む
// 3. screens/approved/{uid} が存在している場合のみ「承認済みスクリーン」として扱う
// 4. render/displayPresence/{uid} にプレゼンス情報をセットし、
//    管理画面側から「どのスクリーンがオンラインか」を把握できるようにする。
// 5. 複数イベントの同時操作に対応するため、render/events/{eventId}/session にセッションを保存する
function beginDisplaySession_(principal, rawEventId) {
  ensureDisplayPrincipal_(
    principal,
    "Only anonymous display accounts can begin sessions"
  );
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required for display session");
  }
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error("Missing display uid for session start");
  }
  // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、uidごとにセッションを分ける
  const eventSessionPath = getEventSessionPath_(eventId, principalUid);
  const current = fetchRtdb_(eventSessionPath, token);
  const updates = {};

  // 既存のセッションがある場合、期限切れチェックとクリーンアップ
  if (current && current.sessionId) {
    const normalizedCurrentUid = normalizeKey_(current.uid);
    const currentExpires = Number(current.expiresAt || 0);
    const currentExpired = currentExpires && currentExpires <= now;
    // 同じuidのセッションが期限切れの場合のみクリーンアップ
    if (normalizedCurrentUid === principalUid && currentExpired) {
      updates[`screens/sessions/${principalUid}`] = Object.assign({}, current, {
        status: "expired",
        endedAt: now,
        expiresAt: now,
        lastSeenAt: Number(current.lastSeenAt || now),
      });
      updates[`render/displayPresence/${principalUid}`] = null;
    }
    const previousActivePath = getActiveSchedulePathForSession_(current);
    if (previousActivePath) {
      updates[previousActivePath] = null;
    }
  }

  const sessionId = Utilities.getUuid();
  const expiresAt = now + DISPLAY_SESSION_TTL_MS;
  // assignmentは保持しない
  // 理由：
  // 1. ディスプレイは複数のイベントで同時に使われる可能性がある
  // 2. assignmentは「最後に固定したオペレーターのイベント」を表すが、これは他のオペレーターにとっては無関係な情報
  // 3. オペレーターがイベントを選んでいない状態で、ディスプレイのassignmentが表示されるのは設計上の問題
  // 4. オペレーターがイベントを選択した際に、必要に応じてlockDisplaySchedule_でassignmentを設定する
  let preservedAssignment = null;
  const session = {
    uid: principalUid,
    sessionId,
    status: "active",
    startedAt: now,
    lastSeenAt: now,
    expiresAt,
    grantedBy: "gas",
  };
  if (preservedAssignment) {
    session.assignment = preservedAssignment;
    session.eventId = preservedAssignment.eventId;
    session.scheduleId = preservedAssignment.scheduleId;
    session.scheduleLabel = preservedAssignment.scheduleLabel;
  } else if (current) {
    if (current.eventId) session.eventId = normalizeKey_(current.eventId);
    if (current.scheduleId)
      session.scheduleId = normalizeScheduleId_(current.scheduleId);
    if (current.scheduleLabel)
      session.scheduleLabel = String(current.scheduleLabel || "").trim();
  }

  updates[`screens/approved/${principalUid}`] = true;
  updates[`screens/sessions/${principalUid}`] = session;
  // イベントごとのセッションに保存（複数display.htmlの同時表示に対応、uidごとに分ける）
  updates[eventSessionPath] = session;
  updates[`render/displayPresence/${principalUid}`] = null;
  const activeSchedulePath = getActiveSchedulePathForSession_(session);
  const activeRecord = buildActiveScheduleRecord_(
    session.assignment,
    session,
    principalUid
  );
  if (activeSchedulePath && activeRecord) {
    updates[activeSchedulePath] = activeRecord;
  }
  patchRtdb_(updates, token);
  return { session };
}

// === displayセッションのハートビート(heartbeat) ===========
// 一定間隔で呼ばれ、現在のセッションがまだ生きていることを通知する。
// screens/sessions/{uid} の lastSeenAt / expiresAt を更新し、
// render/displayPresence/{uid} も更新することで、
// 管理画面側から「いまも接続中かどうか」を判別できるようにする。
function heartbeatDisplaySession_(principal, rawSessionId, rawEventId) {
  ensureDisplayPrincipal_(
    principal,
    "Only anonymous display accounts can send heartbeats"
  );
  const sessionId = requireSessionId_(rawSessionId);
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required for display session heartbeat");
  }
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error("Missing display uid for heartbeat");
  }
  // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、uidごとにセッションを分ける
  const eventSessionPath = getEventSessionPath_(eventId, principalUid);
  const current = fetchRtdb_(eventSessionPath, token);
  const currentUid = normalizeKey_(current && current.uid);
  if (
    !current ||
    currentUid !== principalUid ||
    current.sessionId !== sessionId
  ) {
    const updates = {};
    if (current && Number(current.expiresAt || 0) <= now) {
      updates[eventSessionPath] = null;
      if (currentUid) {
        updates[`screens/approved/${currentUid}`] = null;
        updates[`screens/sessions/${currentUid}`] = Object.assign({}, current, {
          status: "expired",
          endedAt: now,
          expiresAt: now,
          lastSeenAt: Number(current.lastSeenAt || now),
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
    updates[eventSessionPath] = null;
    updates[`screens/approved/${currentUid}`] = null;
    updates[`screens/sessions/${currentUid}`] = Object.assign({}, current, {
      status: "expired",
      endedAt: now,
      expiresAt: now,
      lastSeenAt: Number(current.lastSeenAt || now),
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
    status: "active",
    lastSeenAt: now,
    expiresAt: now + DISPLAY_SESSION_TTL_MS,
    uid: principalUid,
  });
  const updates = {};
  updates[`screens/approved/${principalUid}`] = true;
  updates[`screens/sessions/${principalUid}`] = session;
  // イベントごとのセッションに保存（複数display.htmlの同時表示に対応、uidごとに分ける）
  updates[eventSessionPath] = session;
  updates[`render/displayPresence/${principalUid}`] = null;
  patchRtdb_(updates, token);
  return { active: true, session };
}

// === displayセッションの終了処理(end) ======================
// display.html を閉じる／切断する際に呼ばれる想定のエンドポイント。
// 1. screens/sessions/{uid} に status: 'ended' / endedAt などを書き込む
// 2. screens/approved/{uid}, render/displayPresence/{uid} を削除
// 3. そのセッションに紐づいていた「アクティブなスケジュール」情報もクリア
// といった後片付けを一括で行う。
function endDisplaySession_(principal, rawSessionId, reason, rawEventId) {
  ensureDisplayPrincipal_(
    principal,
    "Only anonymous display accounts can end sessions"
  );
  const sessionId = requireSessionId_(rawSessionId);
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required for display session end");
  }
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  const principalUid = normalizeKey_(principal && principal.uid);
  if (!principalUid) {
    throw new Error("Missing display uid for session end");
  }
  // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、uidごとにセッションを分ける
  const eventSessionPath = getEventSessionPath_(eventId, principalUid);
  const current = fetchRtdb_(eventSessionPath, token);
  const currentUid = normalizeKey_(current && current.uid);
  if (
    !current ||
    currentUid !== principalUid ||
    current.sessionId !== sessionId
  ) {
    return { ended: false };
  }

  const session = Object.assign({}, current, {
    status: "ended",
    endedAt: now,
    expiresAt: now,
    lastSeenAt: now,
    endedReason: reason || null,
    uid: principalUid,
  });
  const updates = {};
  updates[`screens/approved/${principalUid}`] = null;
  updates[`screens/sessions/${principalUid}`] = session;
  // イベントごとのセッションを終了（複数display.htmlの同時表示に対応、uidごとに分ける）
  updates[eventSessionPath] = null;
  updates[`render/displayPresence/${principalUid}`] = null;
  const activePath = getActiveSchedulePathForSession_(current);
  if (activePath) {
    updates[activePath] = null;
  }
  patchRtdb_(updates, token);
  return { ended: true };
}

// === 表示スケジュールの操作権をロックする ===================
// オペレーターが「このイベントの画面表示を自分が操作する」ことを宣言する。
// screens/locks/{eventId} に ownerUid/ownerName を書き込むことで、
// 同時に複数のオペレーターが同じイベントを操作してしまうことを防ぐ。
// すでに他のユーザーがロックしている場合はエラーで弾く。
function lockDisplaySchedule_(
  principal,
  rawEventId,
  rawScheduleId,
  rawScheduleLabel,
  rawOperatorName
) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required.");
  }
  const scheduleId = normalizeKey_(rawScheduleId);
  const scheduleLabel = String(rawScheduleLabel || "").trim();
  const operatorName = String(rawOperatorName || "").trim();
  const operatorUid = normalizeKey_(principal && principal.uid);
  if (!operatorUid) {
    throw new Error("操作アカウントを特定できませんでした。");
  }
  assertOperatorForEvent_(principal, eventId);
  const token = getFirebaseAccessToken_();
  const now = Date.now();
  // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、全てのセッションを取得
  const eventSessionsPath = getEventSessionsPath_(eventId);
  const sessions = fetchRtdb_(eventSessionsPath, token) || {};
  // 有効なセッションを抽出（status: "active" かつ期限切れでないもの）
  const activeSessions = [];
  Object.entries(sessions).forEach(([uid, session]) => {
    if (!session || typeof session !== "object") return;
    const sessionStatus = String(session.status || "").trim();
    const expiresAt = Number(session.expiresAt || 0);
    if (sessionStatus === "active" && expiresAt > now) {
      activeSessions.push({ uid: normalizeKey_(uid), session });
    }
  });
  if (activeSessions.length === 0) {
    throw new Error("ディスプレイのセッションが有効ではありません。");
  }
  // 最初の有効なセッションを基準にassignmentを決定（全てのセッションに同じassignmentを設定する）
  const firstSession = activeSessions[0].session;
  const sessionUid = normalizeKey_(firstSession.uid);
  if (!sessionUid) {
    throw new Error("ディスプレイのセッション情報が不完全です。");
  }
  const normalizedScheduleId = normalizeScheduleId_(scheduleId);
  const scheduleKey = buildScheduleKey_(eventId, normalizedScheduleId);
  // 既存のassignmentを最初のセッションから取得
  const existingAssignment =
    firstSession.assignment && typeof firstSession.assignment === "object"
      ? firstSession.assignment
      : null;
  if (existingAssignment) {
    const existingKey = buildScheduleKey_(
      existingAssignment.eventId,
      existingAssignment.scheduleId
    );
    const lockedByUid = normalizeKey_(existingAssignment.lockedByUid);
    if (existingKey === scheduleKey) {
      return {
        assignment: Object.assign({}, existingAssignment, {
          scheduleKey: existingKey,
        }),
      };
    }
    if (lockedByUid && lockedByUid !== operatorUid) {
      throw new Error("他のオペレーターがディスプレイを固定しています。");
    }
  }
  const fallbackLabel =
    normalizedScheduleId === DEFAULT_SCHEDULE_KEY
      ? "未選択"
      : normalizedScheduleId || eventId;
  const assignment = {
    eventId,
    scheduleId: normalizedScheduleId,
    scheduleLabel: scheduleLabel || fallbackLabel,
    scheduleKey,
    lockedAt: now,
    lockedByUid: operatorUid,
    lockedByEmail: String(principal.email || "").trim(),
    lockedByName: operatorName || String(principal.email || "").trim(),
  };
  const nextSession = Object.assign({}, firstSession, {
    eventId,
    scheduleId: normalizedScheduleId,
    scheduleLabel: assignment.scheduleLabel,
    assignment,
  });
  const updates = {};
  if (existingAssignment) {
    const previousActivePath = getEventActiveSchedulePath_(
      existingAssignment.eventId
    );
    const nextActivePath = getEventActiveSchedulePath_(eventId);
    if (previousActivePath && previousActivePath !== nextActivePath) {
      updates[previousActivePath] = null;
    }
  }
  // 全ての有効なセッションに対してassignmentを設定（複数display.htmlの同時表示に対応）
  activeSessions.forEach(({ uid, session }) => {
    const nextSessionForUid = Object.assign({}, session, {
      eventId,
      scheduleId: normalizedScheduleId,
      scheduleLabel: assignment.scheduleLabel,
      assignment,
    });
    updates[`screens/approved/${uid}`] = true;
    updates[`screens/sessions/${uid}`] = nextSessionForUid;
    // 各uidごとのセッションパスに保存
    const sessionPath = getEventSessionPath_(eventId, uid);
    updates[sessionPath] = nextSessionForUid;
  });
  const activeSchedulePath = getEventActiveSchedulePath_(eventId);
  const activeRecord = buildActiveScheduleRecord_(
    assignment,
    nextSession,
    operatorUid
  );
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

// === ローテーション設定(entries)を正規化する ================
// saveScheduleRotation_ に渡される entries 配列をチェックし、
// 1. scheduleId を正規化して無効なエントリを除外
// 2. 同じscheduleIdが重複している場合は最初の1件だけ残す
// 3. 表示時間(dwellMs)やdurationMsなどが未指定の場合はデフォルト値を補う
// といった正規化を行い、「サーバー側で扱いやすい形」に整えて返す。
function normalizeRotationEntries_(eventId, rawEntries) {
  const list = Array.isArray(rawEntries) ? rawEntries : [];
  const seenKeys = new Set();
  const normalized = [];
  list.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
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
    const label = String(entry.scheduleLabel || entry.label || "").trim();
    const dwellMs =
      toPositiveInteger_(entry.dwellMs) ||
      toPositiveInteger_(entry.durationMs) ||
      (toPositiveInteger_(entry.dwellSeconds)
        ? toPositiveInteger_(entry.dwellSeconds) * 1000
        : null) ||
      (toPositiveInteger_(entry.durationSeconds)
        ? toPositiveInteger_(entry.durationSeconds) * 1000
        : null);
    const record = {
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel: label,
      dwellMs: dwellMs || null,
      order: normalized.length,
    };
    if (record.dwellMs != null) {
      record.dwellSeconds = Math.round(record.dwellMs / 100) / 10;
    }
    normalized.push(record);
  });
  return normalized;
}

function buildRotationActiveScheduleRecord_(
  eventId,
  rotationRecord,
  timestamp
) {
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    return null;
  }
  const now =
    Number(timestamp || (rotationRecord && rotationRecord.updatedAt)) ||
    Date.now();
  const updatedByUid = normalizeKey_(
    rotationRecord && rotationRecord.updatedByUid
  );
  const updatedByEmail = String(
    (rotationRecord && rotationRecord.updatedByEmail) || ""
  ).trim();
  let updatedByName = String(
    (rotationRecord && rotationRecord.updatedByName) || ""
  ).trim();
  if (!updatedByName) {
    updatedByName = updatedByEmail || updatedByUid || "";
  }
  const dwellDefault =
    toPositiveInteger_(rotationRecord && rotationRecord.dwellMsDefault) || null;
  const entries = Array.isArray(rotationRecord && rotationRecord.entries)
    ? rotationRecord.entries
    : [];
  return {
    eventId: eventKey,
    mode: "rotation",
    type: "rotation",
    scheduleId: null,
    scheduleKey: null,
    scheduleLabel: "rotation",
    lockedAt: now,
    lockedByUid: updatedByUid,
    lockedByEmail: updatedByEmail,
    lockedByName: updatedByName,
    sessionUid: null,
    sessionId: null,
    expiresAt: null,
    rotation: {
      entries,
      dwellMsDefault: dwellDefault,
    },
    updatedAt: now,
  };
}

// === スケジュールのローテーション設定を保存する ===================
// オペレーターが設定した「◯◯→△△→□□ と自動で切り替える」ルールを、
// screens/rotations/{eventId} に保存し、
// さらに現在の時刻を元に「今どのスケジュールを表示すべきか」を
// buildRotationActiveScheduleRecord_ で計算して render/activeSchedules に反映する。
function saveScheduleRotation_(
  principal,
  rawEventId,
  rawRotationEntries,
  rawOptions
) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required.");
  }
  assertOperatorForEvent_(principal, eventId);

  let entriesSource = rawRotationEntries;
  if (
    entriesSource &&
    typeof entriesSource === "object" &&
    !Array.isArray(entriesSource)
  ) {
    entriesSource = entriesSource.entries;
  }
  if (
    !Array.isArray(entriesSource) &&
    rawOptions &&
    Array.isArray(rawOptions.entries)
  ) {
    entriesSource = rawOptions.entries;
  }

  const entries = normalizeRotationEntries_(eventId, entriesSource);
  if (!entries.length) {
    throw new Error("ローテーションに設定する日程を1件以上指定してください。");
  }

  const operatorUid = normalizeKey_(principal && principal.uid);
  const operatorEmail = String((principal && principal.email) || "").trim();
  const operatorName = String(
    (rawOptions && rawOptions.operatorName) || ""
  ).trim();
  const defaultDwell =
    toPositiveInteger_(
      rawOptions && (rawOptions.defaultDwellMs || rawOptions.defaultDurationMs)
    ) || null;
  const now = Date.now();
  const rotationRecord = {
    eventId,
    entries,
    dwellMsDefault: defaultDwell,
    updatedAt: now,
    updatedByUid: operatorUid,
    updatedByEmail: operatorEmail,
    updatedByName: operatorName || operatorEmail || operatorUid || "",
  };

  const token = getFirebaseAccessToken_();
  const updates = {};
  const rotationPath = getEventRotationPath_(eventId);
  if (rotationPath) {
    updates[rotationPath] = rotationRecord;
  }
  const activePath = getEventActiveSchedulePath_(eventId);
  const activeRecord = buildRotationActiveScheduleRecord_(
    eventId,
    rotationRecord,
    now
  );
  if (activePath && activeRecord) {
    updates[activePath] = activeRecord;
  }
  patchRtdb_(updates, token);
  return { rotation: rotationRecord, active: activeRecord };
}

// === スケジュールローテーション設定を解除する ======================
// 指定イベントの screens/rotations/{eventId} を削除し、
// activeSchedules 側にもローテーション由来のレコードがあればクリアする。
// 手動操作に戻したいときに使う。
function clearScheduleRotation_(principal, rawEventId) {
  const eventId = normalizeEventId_(rawEventId);
  if (!eventId) {
    throw new Error("eventId is required.");
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
    const mode = String(
      (currentActive && (currentActive.mode || currentActive.type)) || ""
    ).toLowerCase();
    if (!currentActive || mode === "rotation") {
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
  if (typeof raw !== "string") {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed[0] === "{") {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      // fall through to line parsing
    }
  }
  const map = {};
  const segments = trimmed.split(/[\n;]+/);
  segments.forEach((segment) => {
    const value = String(segment || "").trim();
    if (!value) {
      return;
    }
    let separatorIndex = value.indexOf(":");
    const equalsIndex = value.indexOf("=");
    if (
      separatorIndex === -1 ||
      (equalsIndex !== -1 && equalsIndex < separatorIndex)
    ) {
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
    map[key] = rest
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  });
  return map;
}

function getEventOperatorAcl_() {
  if (eventOperatorAclCache_) {
    return eventOperatorAclCache_;
  }
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty("EVENT_OPERATOR_ACL") || "";
  const parsed = parseEventOperatorAclRaw_(raw);
  const normalized = {};
  Object.keys(parsed || {}).forEach((key) => {
    const trimmedKey = String(key || "").trim();
    if (!trimmedKey) {
      return;
    }
    const entries = Array.isArray(parsed[key]) ? parsed[key] : [];
    const normalizedEntries = entries
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!normalizedEntries.length) {
      normalized[
        trimmedKey === "*"
          ? "_default"
          : normalizeEventId_(trimmedKey) || trimmedKey
      ] = [];
      return;
    }
    if (trimmedKey === "*" || trimmedKey === "_default") {
      normalized["_default"] = normalizedEntries;
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
  } else if (acl && Object.prototype.hasOwnProperty.call(acl, "_default")) {
    list = acl["_default"];
  }
  if (!Array.isArray(list) || !list.length) {
    return !explicit;
  }
  return list.some((entry) => {
    const raw = String(entry || "").trim();
    if (!raw) {
      return false;
    }
    if (raw === "*" || raw.toLowerCase() === "all") {
      return true;
    }
    if (raw[0] === "@") {
      return email.endsWith(raw.toLowerCase());
    }
    return normalizeEmail_(raw) === email;
  });
}

// === principalがイベントのオペレーターかどうかを検証する ==========
// principal(uid/email) と eventId を元に、
// イベントごとのオペレーターACLを参照し、
// 「このユーザーが指定イベントの操作をしてよいか」をチェックする。
// 許可されていない場合はErrorを投げて処理を止める。
// sendParticipantMail_ や lockDisplaySchedule_ など、
// イベント単位で権限が必要な処理の入り口で呼び出す。
function assertOperatorForEvent_(principal, eventId) {
  assertOperator_(principal);
  const eventKey = normalizeEventId_(eventId);
  if (!eventKey) {
    throw new Error("eventId is required.");
  }
  if (!isOperatorAllowedForEvent_(principal, eventKey)) {
    throw new Error("このイベントに対する操作権限がありません。");
  }
}
function normalizeDictionaryEnabled_(value) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["", "0", "false", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return Boolean(value);
}

function normalizeDictionaryTermKey_(value) {
  return normalizeNameForLookup_(value).toLowerCase();
}

function loadDictionaryBranch_() {
  const token = getFirebaseAccessToken_();
  const branch = fetchRtdb_("dictionary", token) || {};
  return { token, branch };
}

function resolveDictionaryEntry_(branch, uid) {
  if (!branch || typeof branch !== "object") {
    return null;
  }
  const key = String(uid || "").trim();
  if (!key) {
    return null;
  }
  const entry = branch[key];
  if (!entry) {
    return null;
  }
  return {
    uid: key,
    term: String(entry.term || "").trim(),
    ruby: String(entry.ruby || "").trim(),
    enabled: normalizeDictionaryEnabled_(entry.enabled),
    createdAt: parseDateToMillis_(entry.createdAt, 0),
    updatedAt: parseDateToMillis_(entry.updatedAt, 0),
  };
}

function findDictionaryUidByTerm_(branch, termKey) {
  if (!branch || typeof branch !== "object") {
    return "";
  }
  const normalizedKey = String(termKey || "").trim();
  if (!normalizedKey) {
    return "";
  }
  const entries = Object.entries(branch);
  for (let i = 0; i < entries.length; i++) {
    const [uid, entry] = entries[i];
    const candidateKey = normalizeDictionaryTermKey_(entry && entry.term);
    if (candidateKey === normalizedKey) {
      return uid;
    }
  }
  return "";
}

// === 辞書(よみがな)エントリを追加する ===============================
// 指定イベントに対して、新しい「表記→よみがな」辞書エントリを追加する。
// term, reading, enabled などを受け取り、normalizeDictionaryTermKey_ で
// キーを正規化した上で RTDB(dictionary/...) に保存する。
function addDictionaryTerm(term, ruby, providedUid) {
  const normalizedTerm = String(term || "").trim();
  const normalizedRuby = String(ruby || "").trim();
  if (!normalizedTerm || !normalizedRuby) {
    throw new Error("Term and ruby are required.");
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
      updatedAt: now,
    };
    patchRtdb_(updates, token);
    return {
      success: true,
      message: `Term "${normalizedTerm}" updated.`,
      uid: existingUid,
    };
  }
  const uid = String(providedUid || "").trim() || Utilities.getUuid();
  updates[`dictionary/${uid}`] = {
    uid,
    term: normalizedTerm,
    ruby: normalizedRuby,
    enabled: true,
    termKey,
    createdAt: now,
    updatedAt: now,
  };
  patchRtdb_(updates, token);
  return { success: true, message: `Term "${normalizedTerm}" added.`, uid };
}

// === 既存の辞書エントリを更新する ================================
// 辞書エントリのよみや有効/無効フラグを更新する。
// term自体を変えたい場合はキーの再計算が必要になるため、
// その扱いも考慮した上で RTDB をpatchする。
function updateDictionaryTerm(uid, term, ruby) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("uid is required.");
  }
  const normalizedTerm = String(term || "").trim();
  const normalizedRuby = String(ruby || "").trim();
  if (!normalizedTerm || !normalizedRuby) {
    throw new Error("Term and ruby are required.");
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
    updatedAt: now,
  };
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} updated.` };
}

// === 辞書エントリを削除する =====================================
// 指定uidの辞書エントリを RTDB から削除する。
// 一括削除(batchDeleteDictionaryTerms)では、複数uidをまとめてnullにする。
function deleteDictionaryTerm(uid, term) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("uid is required.");
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
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("uid is required.");
  }
  const normalizedEnabled = normalizeDictionaryEnabled_(enabled);
  const { token, branch } = loadDictionaryBranch_();
  const current = resolveDictionaryEntry_(branch, normalizedUid);
  if (!current) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }
  const now = Date.now();
  const termKey = normalizeDictionaryTermKey_(current.term || term || "");
  const updates = {};
  updates[`dictionary/${normalizedUid}`] = {
    uid: normalizedUid,
    term: current.term || String(term || "").trim(),
    ruby: current.ruby,
    enabled: normalizedEnabled,
    termKey,
    createdAt: current.createdAt || now,
    updatedAt: now,
  };
  patchRtdb_(updates, token);
  return { success: true, message: `UID: ${normalizedUid} toggled.` };
}

function batchDeleteDictionaryTerms(uids) {
  if (!Array.isArray(uids) || !uids.length) {
    return { success: true, message: "No entries specified." };
  }
  const normalized = uids
    .map((uid) => String(uid || "").trim())
    .filter(Boolean);
  if (!normalized.length) {
    return { success: true, message: "No entries specified." };
  }
  const { token, branch } = loadDictionaryBranch_();
  const updates = {};
  let deleted = 0;
  normalized.forEach((uid) => {
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
    return { success: true, message: "No entries specified." };
  }
  const normalized = uids
    .map((uid) => String(uid || "").trim())
    .filter(Boolean);
  if (!normalized.length) {
    return { success: true, message: "No entries specified." };
  }
  const { token, branch } = loadDictionaryBranch_();
  const normalizedEnabled = normalizeDictionaryEnabled_(enabled);
  const now = Date.now();
  const updates = {};
  let updated = 0;
  normalized.forEach((uid) => {
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
      updatedAt: now,
    };
    updated++;
  });
  if (updated) {
    patchRtdb_(updates, token);
  }
  return { success: true, message: `${updated} entries updated.` };
}

// === 日次バッチでフォームや状態をリセットする =====================
// Apps Scriptの時間主導トリガーから1日1回呼び出す想定の処理。
// ユーザーフォームの状態や期限付きのフラグなどをチェックし、
// 期限切れのものをOFFにする・リセットするなどのメンテナンスを行う。
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
      const userSheet = ss.getSheetByName("users");
      if (userSheet && userSheet.getLastRow() > 1) {
        userSheet
          .getRange(2, 1, userSheet.getLastRow() - 1, userSheet.getLastColumn())
          .clearContent();
        Logger.log("User sheet has been cleared.");
      }
    }
  }
}

// === Firebase RTDB用のアクセストークンを取得する ==================
// サービスアカウント情報(スクリプトプロパティなど)からJWTを組み立て、
// Googleのトークンエンドポイントに対してOAuthトークンを発行してもらう。
// fetchRtdb_ / patchRtdb_ / postRtdb_ でAuthorization: Bearer に
// セットするための短命アクセストークンを返す。
function getFirebaseAccessToken_() {
  const properties = PropertiesService.getScriptProperties();
  const CLIENT_EMAIL = properties.getProperty("CLIENT_EMAIL");
  const privateKeyFromProperties = properties.getProperty("PRIVATE_KEY");
  const PRIVATE_KEY = privateKeyFromProperties.replace(/\\n/g, "\n");

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: CLIENT_EMAIL,
    sub: CLIENT_EMAIL,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope:
      "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database",
  };

  const jwtHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const jwtClaimSet = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  const signatureInput = `${jwtHeader}.${jwtClaimSet}`;

  const signature = Utilities.computeRsaSha256Signature(
    signatureInput,
    PRIVATE_KEY
  );
  const encodedSignature = Utilities.base64EncodeWebSafe(signature);

  const signedJwt = `${signatureInput}.${encodedSignature}`;

  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    },
  });

  const responseData = JSON.parse(response.getContentText());
  return responseData.access_token;
}

function notifyUpdate(kind, maybeKind) {
  function coerceKind(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || "";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  }

  let resolvedKind = coerceKind(kind);
  if (!resolvedKind) {
    resolvedKind = coerceKind(maybeKind);
  }
  if (!resolvedKind && kind && typeof kind === "object") {
    resolvedKind =
      coerceKind(kind.kind) ||
      coerceKind(kind.parameter && kind.parameter.kind) ||
      coerceKind(kind.namedValues && kind.namedValues.kind);
  }
  if (!resolvedKind) {
    resolvedKind = "misc";
  }

  const sanitizedKind = resolvedKind
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safeKind = sanitizedKind || "misc";

  const lock = LockService.getScriptLock();
  if (lock.tryLock(10000)) {
    try {
      const properties = PropertiesService.getScriptProperties();
      const FIREBASE_DB_URL = properties.getProperty("FIREBASE_DB_URL");
      if (!FIREBASE_DB_URL) {
        throw new Error("FIREBASE_DB_URL script property is not configured.");
      }
      const accessToken = getFirebaseAccessToken_();

      const baseUrl = FIREBASE_DB_URL.replace(/\/+$/, "");
      const url = `${baseUrl}/signals/${encodeURIComponent(safeKind)}.json`;
      const payload = {
        triggeredAt: new Date().getTime(),
        resolvedKind: safeKind,
      };

      const options = {
        method: "put",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        headers: {
          Authorization: "Bearer " + accessToken,
        },
        muteHttpExceptions: true,
      };

      const response = UrlFetchApp.fetch(url, options);
      Logger.log(
        "Firebase notified via OAuth2. Response: " + response.getContentText()
      );
    } finally {
      lock.releaseLock();
    }
  }
}
function toIsoJst_(d) {
  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// === シートの内容を「ヘッダ行付きの配列」に変換して取得する =========
// 指定したシート名の1行目をキーとして扱い、2行目以降のデータを
// [{ヘッダ1: 値, ヘッダ2: 値, ...}, ...] という形の配列にして返す。
// usersシートやconfigシートなど、ヘッダ付きテーブルを扱うときの共通入り口。
function getSheetData_(sheetKey) {
  const normalized = String(sheetKey || "")
    .trim()
    .toLowerCase();
  if (normalized !== "users") {
    throw new Error("Invalid sheet: " + sheetKey);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("users");
  if (!sheet) {
    throw new Error("Sheet not found: users");
  }

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return [];
  }

  const headers = values[0].map((header, index) => {
    const label = String(header || "").trim();
    return label || `column_${index}`;
  });

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (
      !row ||
      row.length === 0 ||
      row.every((value) => value === "" || value == null)
    ) {
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
// === 質問受付キュー(questionIntake)を本番リストに反映する ==========
// submitQuestion_ によって RTDB上の questionIntake/submissions/... に
// 積まれている質問キューを走査し、
// 1. 有効なトークン・期限内のエントリだけを対象にする
// 2. 本番の質問リスト(questions/...)に書き込み
// 3. 正常に移行できたキューは削除する
// といった処理をまとめて行う。
// options.tokenFilter に配列を渡すと、特定のtokenに紐づくキューだけを
// 処理対象に絞り込める。
function processQuestionSubmissionQueue_(providedAccessToken, options) {
  const accessToken = providedAccessToken || getFirebaseAccessToken_();
  const queueBranch =
    fetchRtdb_("questionIntake/submissions", accessToken) || {};
  const opts = options || {};
  let tokenFilter = null;
  if (opts && opts.tokenFilter != null) {
    const list = Array.isArray(opts.tokenFilter)
      ? opts.tokenFilter
      : [opts.tokenFilter];
    tokenFilter = new Set(
      list.map((value) => String(value || "").trim()).filter(Boolean)
    );
  }

  const ensureString = (value) => String(value || "").trim();

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

  const tokenRecords = fetchRtdb_("questionIntake/tokens", accessToken) || {};
  const updates = {};
  let processed = 0;
  let discarded = 0;

  queueTokens.forEach((token) => {
    const submissions =
      queueBranch[token] && typeof queueBranch[token] === "object"
        ? queueBranch[token]
        : {};
    const tokenRecord = tokenRecords[token] || {};
    const revoked = tokenRecord && tokenRecord.revoked === true;
    const expiresAt = Number((tokenRecord && tokenRecord.expiresAt) || 0);
    const eventId = ensureString(tokenRecord && tokenRecord.eventId);
    const scheduleId = ensureString(tokenRecord && tokenRecord.scheduleId);
    const participantId = ensureString(
      tokenRecord && tokenRecord.participantId
    );

    Object.keys(submissions).forEach((entryId) => {
      const submissionPath = `questionIntake/submissions/${token}/${entryId}`;
      const entry =
        submissions[entryId] && typeof submissions[entryId] === "object"
          ? submissions[entryId]
          : null;

      updates[submissionPath] = null;

      if (!entry) {
        discarded += 1;
        return;
      }

      if (
        !tokenRecord ||
        !eventId ||
        !scheduleId ||
        !participantId ||
        revoked ||
        (expiresAt && Date.now() > expiresAt)
      ) {
        discarded += 1;
        return;
      }

      try {
        const radioName = ensureString(entry.radioName);
        const questionText = ensureString(entry.question);
        if (!radioName) throw new Error("ラジオネームが空です。");
        if (!questionText) throw new Error("質問内容が空です。");

        const questionLength = Number(entry.questionLength);
        if (!Number.isFinite(questionLength) || questionLength <= 0) {
          throw new Error("質問文字数が不正です。");
        }

        const now = Date.now();
        const timestampCandidate = Number(
          entry.submittedAt || entry.clientTimestamp || now
        );
        const ts =
          Number.isFinite(timestampCandidate) && timestampCandidate > 0
            ? timestampCandidate
            : now;
        const scheduleLabel = ensureString(
          entry.scheduleLabel || tokenRecord.scheduleLabel
        );
        const scheduleDate = ensureString(
          entry.scheduleDate || tokenRecord.scheduleDate
        );
        const scheduleStart = ensureString(
          entry.scheduleStart || tokenRecord.scheduleStart
        );
        const scheduleEnd = ensureString(
          entry.scheduleEnd || tokenRecord.scheduleEnd
        );
        const eventName = ensureString(
          entry.eventName || tokenRecord.eventName
        );
        const participantName = ensureString(
          entry.participantName || tokenRecord.displayName
        );
        const guidance = ensureString(entry.guidance || tokenRecord.guidance);
        const genreValue = ensureString(entry.genre) || "その他";
        const groupNumber = ensureString(
          entry.groupNumber || tokenRecord.teamNumber || tokenRecord.groupNumber
        );
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
          type: "normal",
        };

        if (Number.isFinite(questionLength) && questionLength > 0) {
          record.questionLength = Math.round(questionLength);
        }

        updates[`questions/normal/${uid}`] = record;
        updates[`questionStatus/${uid}`] = {
          answered: false,
          selecting: false,
          pickup: false,
          updatedAt: ts,
        };
        processed += 1;
      } catch (error) {
        console.warn("Failed to process queued submission", error);
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
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    return { branch: "", record: null };
  }
  const accessToken = token || getFirebaseAccessToken_();
  const branches = ["normal", "pickup"];
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const path = `questions/${branch}/${normalizedUid}`;
    try {
      const record = fetchRtdb_(path, accessToken);
      if (record && typeof record === "object") {
        return { branch, record, token: accessToken };
      }
    } catch (error) {
      // Ignore missing branch errors and continue searching other branches.
    }
  }
  return { branch: "", record: null, token: accessToken };
}

function updateAnswerStatus(uid, status) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("UID is required.");
  }

  const token = getFirebaseAccessToken_();
  const statusPath = `questionStatus/${normalizedUid}`;
  const currentStatus = fetchRtdb_(statusPath, token);
  if (!currentStatus || typeof currentStatus !== "object") {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }

  const isAnswered =
    status === true || status === "true" || status === 1 || status === "1";
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

// === 複数の質問のステータスを一括更新する ========================
// 質問一覧の中から、指定されたuidsに対応するレコードを探し、
// それぞれの status フィールドを requestedStatus に更新する。
// まとめてPATCHすることでRTDBへの書き込み回数を削減する。
// 司会用に「この質問群を一括で採用済みにする」といった操作で使う。
function batchUpdateStatus(uids, status) {
  if (!Array.isArray(uids)) {
    throw new Error("UIDs array is required.");
  }
  const normalized = Array.from(
    new Set(uids.map((value) => String(value || "").trim()).filter(Boolean))
  );
  if (!normalized.length) {
    return { success: true, message: "0 items updated." };
  }

  const token = getFirebaseAccessToken_();
  const statusBranch = fetchRtdb_("questionStatus", token) || {};
  const isAnswered =
    status === true || status === "true" || status === 1 || status === "1";
  const now = Date.now();
  const updates = {};
  let updatedCount = 0;

  normalized.forEach((uid) => {
    if (
      !statusBranch ||
      typeof statusBranch !== "object" ||
      !statusBranch[uid]
    ) {
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
    return { success: true, message: "0 items updated." };
  }

  patchRtdb_(updates, token);
  return { success: true, message: `${updatedCount} items updated.` };
}

function updateSelectingStatus(uid) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("UID is required.");
  }
  const token = getFirebaseAccessToken_();
  const statusBranch = fetchRtdb_("questionStatus", token) || {};
  if (
    !statusBranch ||
    typeof statusBranch !== "object" ||
    !statusBranch[normalizedUid]
  ) {
    throw new Error(`UID: ${normalizedUid} not found.`);
  }

  const now = Date.now();
  const updates = {};
  Object.keys(statusBranch).forEach((key) => {
    const normalizedKey = String(key || "").trim();
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
  const statusBranch = fetchRtdb_("questionStatus", token) || {};
  if (!statusBranch || typeof statusBranch !== "object") {
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
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("UID is required.");
  }
  if (typeof newText === "undefined") {
    throw new Error("New text is required.");
  }
  const trimmed = String(newText || "").trim();
  if (!trimmed) {
    throw new Error("質問内容を入力してください。");
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

// === 参加者メールテンプレートのキャッシュを一度だけクリアする =====
// CacheService に保存されている email-participant-shell.html / body.html の
// キャッシュエントリを削除し、次回のメール生成時に最新テンプレートを
// DriveやGitHubから再読込させるためのメンテナンス用関数。
function clearParticipantMailTemplateCacheOnce() {
  // 推奨されていた呼び出し
  getParticipantMailTemplateMarkup_({ forceRefresh: true });
}
