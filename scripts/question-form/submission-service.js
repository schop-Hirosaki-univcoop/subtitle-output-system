// submission-service.js: 質問送信フローの非UIロジックを集約し、アプリ本体から切り離します。
import { FORM_VERSION } from "./constants.js";
import { sanitizeSubmissionPayload, collectClientMetadata, generateQuestionUid, buildQuestionRecord } from "./submission-utils.js";

/**
 * AbortError 相当の例外インスタンスを生成します。
 * DOMException が利用できない環境でも同様の例外を提供します。
 * @returns {Error}
 */
function createAbortError() {
  if (typeof DOMException === "function") {
    return new DOMException("Aborted", "AbortError");
  }
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

/**
 * 送信処理で利用する AbortController を生成します。
 * 対応していない環境では簡易的なモックを返します。
 * @returns {AbortController & { signal: AbortSignal, abort(): void }}
 */
export function createSubmissionController() {
  if (typeof AbortController === "function") {
    return new AbortController();
  }
  const signal = { aborted: false };
  return {
    signal,
    abort() {
      signal.aborted = true;
    }
  };
}

/**
 * AbortController が既に中断済みでないか検証します。
 * 中断済みであれば AbortError を投げて処理を打ち切ります。
 * @param {AbortController|null|undefined} controller
 */
export function ensureControllerActive(controller) {
  if (controller?.signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * 渡された例外が送信中断に起因するかを判定します。
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSubmissionAbortError(error) {
  return error?.name === "AbortError";
}

/**
 * クライアントメタデータとフォーム入力を合成し、Realtime Database 向けに整形します。
 * @param {{
 *   token: string|null|undefined,
 *   formData: { radioName: string, question: string, questionLength: number, genre: string },
 *   snapshot: Record<string, string>,
 *   metadataCollector?: typeof collectClientMetadata,
 *   formVersion?: string
 * }} options
 * @returns {{ token: string, submission: Record<string, unknown> }}
 */
export function buildSubmissionPayload({
  token,
  formData,
  snapshot,
  metadataCollector = collectClientMetadata,
  formVersion = FORM_VERSION
}) {
  if (!token) {
    throw new Error("アクセス情報が無効です。配布されたリンクからアクセスし直してください。");
  }

  const metadata = metadataCollector();
  const timestamp = Number(metadata?.timestamp);
  const clientTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const normalizedToken = String(token).trim();

  const submissionBase = {
    token: normalizedToken,
    radioName: formData.radioName,
    question: formData.question,
    questionLength: formData.questionLength,
    genre: formData.genre,
    groupNumber: snapshot.groupNumber,
    teamNumber: snapshot.teamNumber,
    scheduleLabel: snapshot.scheduleLabel,
    scheduleDate: snapshot.scheduleDate,
    scheduleLocation: snapshot.scheduleLocation,
    scheduleStart: snapshot.scheduleStart,
    scheduleEnd: snapshot.scheduleEnd,
    eventId: snapshot.eventId,
    eventName: snapshot.eventName,
    scheduleId: snapshot.scheduleId,
    participantId: snapshot.participantId,
    participantName: snapshot.participantName,
    clientTimestamp,
    language: metadata.language,
    userAgent: metadata.userAgent,
    referrer: metadata.referrer,
    formVersion,
    guidance: snapshot.guidance,
    origin: metadata.origin,
    status: "pending"
  };

  const submission = sanitizeSubmissionPayload(submissionBase);
  return { token: normalizedToken, submission };
}

/**
 * Firebase Realtime Database へ質問レコードを保存します。
 * トランザクション失敗時には適切に巻き戻し、ユーザー向けエラーへ変換します。
 * @param {{
 *   database: import("firebase/database").Database,
 *   controller: AbortController,
 *   token: string,
 *   submission: Record<string, unknown>,
 *   context: Record<string, unknown>|null,
 *   uidGenerator?: typeof generateQuestionUid,
 *   now?: () => number,
 *   ensureActive?: typeof ensureControllerActive
 * }} params
 * @returns {Promise<{ queueProcessed: boolean, questionUid: string }>}
 */
function resolveDatabaseOps(ops) {
  if (ops && typeof ops.ref === "function" && typeof ops.set === "function" && typeof ops.remove === "function") {
    return ops;
  }
  throw new Error("Database operations are not available. Provide ref/set/remove functions.");
}

export async function submitQuestionRecord({
  database,
  controller,
  token,
  submission,
  context,
  uidGenerator = generateQuestionUid,
  now = Date.now,
  ensureActive = ensureControllerActive,
  databaseOps
}) {
  ensureActive(controller);

  const { ref, set, remove } = resolveDatabaseOps(databaseOps);

  const questionUid = uidGenerator();
  submission.uid = questionUid;

  const timestampCandidate = Number(now());
  const timestamp = Number.isFinite(timestampCandidate) ? timestampCandidate : Date.now();
  const questionRecord = buildQuestionRecord({
    uid: questionUid,
    token,
    submission,
    context,
    timestamp
  });
  const statusRecord = { answered: false, selecting: false, updatedAt: timestamp };

  ensureActive(controller);

  const intakeRef = ref(database, `questionIntake/submissions/${token}/${questionUid}`);
  const intakePayload = { ...submission, uid: questionUid, submittedAt: timestamp };
  let intakeCreated = false;
  let questionCreated = false;

  try {
    await set(intakeRef, intakePayload);
    intakeCreated = true;
    await set(ref(database, `questions/normal/${questionUid}`), questionRecord);
    questionCreated = true;
    await set(ref(database, `questionStatus/${questionUid}`), statusRecord);
  } catch (error) {
    try {
      if (questionCreated) {
        await remove(ref(database, `questions/normal/${questionUid}`));
      }
      if (intakeCreated) {
        await remove(intakeRef);
      }
    } catch (cleanupError) {
      console.warn("Failed to roll back question record after status write error", cleanupError);
    }
    const isPermissionError = error?.code === "PERMISSION_DENIED";
    const message = isPermissionError
      ? "フォームを送信できませんでした。リンクの有効期限が切れていないかご確認ください。"
      : "フォームを送信できませんでした。通信状況を確認して再度お試しください。";
    const clientError = new Error(message);
    clientError.cause = error;
    throw clientError;
  }

  return { queueProcessed: true, questionUid };
}
