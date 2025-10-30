// submission-utils.js: 質問送信レコードの生成や端末メタデータ収集を担うユーティリティ群です。
import { coalesceTrimmed, ensureTrimmedString } from "./value-utils.js";

export const ZERO_WIDTH_SPACE_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;

// fallback counter used when a deterministic suffix is required
let fallbackRandomSequence = 0;
let lastRandomBase = "";
let randomCollisionCounter = 0;

/**
 * 送信ペイロードに含まれる空白やゼロ幅文字を除去し、型に応じた正規化を行います。
 * @param {Record<string, unknown>} values
 * @returns {Record<string, string | number | boolean>}
 */
export function sanitizeSubmissionPayload(values) {
  return Object.entries(values).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }

    if (typeof value === "number") {
      acc[key] = Number.isFinite(value) ? value : "";
      return acc;
    }

    if (typeof value === "boolean") {
      acc[key] = value;
      return acc;
    }

    const normalized = ensureTrimmedString(value).replace(ZERO_WIDTH_SPACE_PATTERN, "");
    acc[key] = normalized;
    return acc;
  }, /** @type {Record<string, string | number | boolean>} */ ({}));
}

/**
 * 実行環境から利用言語やUAなどの端末メタデータを収集します。
 * テスト容易性のためにnavigator/document/locationをオプションで注入できます。
 * @param {{ navigator?: Navigator, document?: Document, location?: Location, now?: () => number }} [options]
 * @returns {{ language: string, userAgent: string, referrer: string, origin: string, timestamp: number }}
 */
export function collectClientMetadata({ navigator: navInput, document: docInput, location: locInput, now } = {}) {
  const nav = navInput ?? (typeof navigator === "object" && navigator ? navigator : null);
  const doc = docInput ?? (typeof document === "object" && document ? document : null);
  const loc = locInput ?? (typeof window === "object" && window && window.location ? window.location : null);

  const languages = Array.isArray(nav?.languages) ? nav.languages : [];
  const language = coalesceTrimmed(...languages, nav?.language);
  const userAgent = ensureTrimmedString(nav?.userAgent);
  const referrer = ensureTrimmedString(doc?.referrer);

  let origin = "";
  if (loc) {
    origin = ensureTrimmedString(loc.origin);
    if (!origin) {
      const protocol = ensureTrimmedString(loc.protocol);
      const host = ensureTrimmedString(loc.host);
      if (protocol && host) {
        origin = `${protocol}//${host}`;
      }
    }
  }

  const timeSource = typeof now === "function" ? now : Date.now;
  const timestampCandidate = Number(timeSource());
  const timestamp = Number.isFinite(timestampCandidate) ? timestampCandidate : Date.now();

  return { language, userAgent, referrer, origin, timestamp };
}

/**
 * 質問用UUID生成に利用する暗号APIを解決します。
 * @param {Array<any>} scopes
 * @returns {Crypto|null}
 */
function resolveCrypto(scopes) {
  for (const scope of scopes) {
    if (scope?.crypto) {
      return scope.crypto;
    }
  }
  return null;
}

/**
 * 16バイト配列をUUID v4形式へ整形します。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function formatUuidFromBytes(bytes) {
  const toHex = (segment) => Array.from(segment, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    toHex(bytes.subarray(0, 4)),
    toHex(bytes.subarray(4, 6)),
    toHex(bytes.subarray(6, 8)),
    toHex(bytes.subarray(8, 10)),
    toHex(bytes.subarray(10))
  ].join("-");
}

/**
 * 生成したIDに質問レコード用のプレフィックスを付与します。
 * @param {string} rawValue
 * @returns {string}
 */
function prefixQuestionUid(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return `q_${Date.now().toString(36)}`;
  }
  return value.startsWith("q_") ? value : `q_${value}`;
}

/**
 * Math.randomベースのフォールバックで利用する疑似乱数サフィックスを生成します。
 * 渡されたrandom関数が不正値を返した場合も安定した長さの文字列を返します。
 * @param {() => number} randomFn
 * @returns {string}
 */
function createRandomSuffix(randomFn) {
  let buffer = "";
  for (let index = 0; index < 6 && buffer.length < 18; index += 1) {
    let candidate;
    try {
      candidate = Number(randomFn());
    } catch (error) {
      candidate = Number.NaN;
    }
    if (!Number.isFinite(candidate)) {
      continue;
    }
    const safeValue = Math.abs(candidate);
    const chunk = safeValue.toString(36).replace(/^0\./, "");
    buffer += (chunk || "0").slice(0, 6);
  }

  if (!buffer) {
    fallbackRandomSequence = (fallbackRandomSequence + 1) % 2176782336; // 36^8
    buffer = fallbackRandomSequence.toString(36).padStart(8, "0");
  }

  return buffer.slice(0, 18);
}

/**
 * 同一タイムスタンプかつ同一乱数サフィックスが生成された場合に、
 * 衝突を避けるための連番を付与します。
 * @param {string} base
 * @returns {string}
 */
function disambiguateRandomBase(base) {
  if (!base) {
    return "";
  }
  if (base === lastRandomBase) {
    randomCollisionCounter = (randomCollisionCounter + 1) % 2176782336; // 36^8
  } else {
    lastRandomBase = base;
    randomCollisionCounter = 0;
  }
  if (randomCollisionCounter === 0) {
    return base;
  }
  const suffix = randomCollisionCounter.toString(36).padStart(2, "0");
  return `${base}_${suffix}`;
}

/**
 * 暗号APIまたは擬似乱数を利用して質問レコードのUIDを生成します。
 * @param {{ crypto?: Crypto|null, random?: () => number, now?: () => number, scopes?: any[] }} [options]
 * @returns {string}
 */
export function generateQuestionUid({ crypto: cryptoOverride, random = Math.random, now = Date.now, scopes } = {}) {
  const defaultScopes = scopes ?? [
    typeof globalThis === "object" ? globalThis : null,
    typeof window === "object" ? window : null,
    typeof self === "object" ? self : null
  ];
  const cryptoObj = cryptoOverride ?? resolveCrypto(defaultScopes);

  if (cryptoObj) {
    if (typeof cryptoObj.randomUUID === "function") {
      return prefixQuestionUid(cryptoObj.randomUUID());
    }
    if (typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return prefixQuestionUid(formatUuidFromBytes(bytes));
    }
  }

  const timestampCandidate = Number(now());
  const timestamp = Number.isFinite(timestampCandidate) ? timestampCandidate : Date.now();
  const timestampPart = timestamp.toString(36);
  const randomSuffix = createRandomSuffix(random);
  const randomBase = randomSuffix ? `${timestampPart}_${randomSuffix}` : timestampPart;
  const combined = disambiguateRandomBase(randomBase);

  return prefixQuestionUid(combined);
}

/**
 * Firebase Databaseへ保存する質問レコードを構築します。
 * @param {{ uid: string, token: string, submission: Record<string, any>, context: Record<string, any>|null, timestamp: number }} params
 * @returns {Record<string, unknown>}
 */
export function buildQuestionRecord({ uid, token, submission, context, timestamp }) {
  const coalescedGroup = coalesceTrimmed(submission.groupNumber, context?.groupNumber);
  const scheduleLabel = coalesceTrimmed(submission.scheduleLabel, context?.scheduleLabel);
  const scheduleStart = coalesceTrimmed(submission.scheduleStart, context?.scheduleStart);
  const scheduleEnd = coalesceTrimmed(submission.scheduleEnd, context?.scheduleEnd);
  const participantId = coalesceTrimmed(submission.participantId, context?.participantId);
  const eventId = coalesceTrimmed(submission.eventId, context?.eventId);
  const scheduleId = coalesceTrimmed(submission.scheduleId, context?.scheduleId);
  const questionLength = Number(submission.questionLength);

  const record = {
    uid,
    token: ensureTrimmedString(token),
    name: ensureTrimmedString(submission.radioName),
    question: ensureTrimmedString(submission.question),
    group: coalescedGroup,
    genre: coalesceTrimmed(submission.genre) || "その他",
    schedule: scheduleLabel,
    scheduleStart,
    scheduleEnd,
    scheduleDate: coalesceTrimmed(submission.scheduleDate, context?.scheduleDate),
    participantId,
    participantName: coalesceTrimmed(submission.participantName, context?.participantName),
    guidance: coalesceTrimmed(submission.guidance, context?.guidance),
    eventId,
    eventName: coalesceTrimmed(submission.eventName, context?.eventName),
    scheduleId,
    ts: timestamp,
    updatedAt: timestamp,
    type: "normal"
  };

  if (Number.isFinite(questionLength) && questionLength > 0) {
    record.questionLength = questionLength;
  }

  return record;
}
