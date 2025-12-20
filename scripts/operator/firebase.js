// firebase.js: オペレーター向けのFirebase初期化と参照ユーティリティをまとめています。
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  update,
  remove,
  set,
  get,
  onValue,
  serverTimestamp,
  push,
  query,
  limitToLast,
  orderByChild,
  child,
  onDisconnect,
  runTransaction,
  enableLogging
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  initializeAuth,
  getAuth,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  getIdToken
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./constants.js";
import { getRenderStatePath, getNowShowingPath, getSideTelopPath, getQuestionStatusPath } from "../shared/channel-paths.js";

const apps = getApps();
export const app = apps.length ? getApp() : initializeApp(firebaseConfig);
export const database = getDatabase(app);

export const auth = apps.length
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    });
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export const displayPresenceRootRef = ref(database, "render/displayPresence");
export const questionsRef = ref(database, "questions");
export const pickupQuestionsRef = ref(database, "questions/pickup");
export const questionIntakeEventsRef = ref(database, "questionIntake/events");
export const questionIntakeSchedulesRef = ref(database, "questionIntake/schedules");
export const questionIntakeTokensRef = ref(database, "questionIntake/tokens");
export const updateTriggerRef = ref(database, "signals/logs");
export const dictionaryRef = ref(database, "dictionary");
export const operatorChatMessagesRef = ref(database, "operatorChat/messages");
export const operatorChatReadsRef = ref(database, "operatorChat/reads");
export const glIntakeEventsRef = ref(database, "glIntake/events");
export const glIntakeSlugIndexRef = ref(database, "glIntake/slugIndex");
const glIntakeApplicationsRootRef = ref(database, "glIntake/applications");
const glAssignmentsRootRef = ref(database, "glAssignments");
export const glIntakeFacultyCatalogRef = ref(database, "glIntake/facultyCatalog");
const operatorPresenceRootRef = ref(database, "operatorPresence");
const operatorScheduleConsensusRootRef = ref(database, "operatorPresenceConsensus");

/**
 * レンダリング状態の参照を返します。
 * eventIdとscheduleIdが必須です。
 * @param {string} eventId イベントID（必須）
 * @param {string} scheduleId スケジュールID
 * @returns {import("firebase/database").DatabaseReference}
 * @throws {Error} eventIdが空の場合
 */
export function getRenderRef(eventId = "", scheduleId = "") {
  const path = getRenderStatePath(eventId, scheduleId);
  return ref(database, path);
}

/**
 * 現在表示中の字幕データの参照を返します。
 * eventIdとscheduleIdが必須です。
 * @param {string} eventId イベントID（必須）
 * @param {string} scheduleId スケジュールID
 * @returns {import("firebase/database").DatabaseReference}
 * @throws {Error} eventIdが空の場合
 */
export function getNowShowingRef(eventId = "", scheduleId = "") {
  const path = getNowShowingPath(eventId, scheduleId);
  return ref(database, path);
}

/**
 * サイドテロップのプリセットの参照を返します。
 * eventIdとscheduleIdが必須です。
 * @param {string} eventId イベントID（必須）
 * @param {string} scheduleId スケジュールID
 * @returns {import("firebase/database").DatabaseReference}
 * @throws {Error} eventIdが空の場合
 */
export function getSideTelopsRef(eventId = "", scheduleId = "") {
  const path = getSideTelopPath(eventId, scheduleId);
  return ref(database, path);
}

/**
 * 質問ステータスの参照を返します。
 * 通常質問: questionStatus/${eventId}
 * Pick Up Question: questionStatus/${eventId}/${scheduleId}
 * @param {string} eventId イベントID
 * @param {boolean} isPickup Pick Up Questionかどうか
 * @param {string} scheduleId スケジュールID（Pick Up Questionの場合に使用）
 * @returns {import("firebase/database").DatabaseReference}
 */
export function getQuestionStatusRef(eventId = "", isPickup = false, scheduleId = "") {
  const path = getQuestionStatusPath(eventId, isPickup, scheduleId);
  return ref(database, path);
}

export function getOperatorPresenceEventRef(eventId = "") {
  const key = String(eventId || "").trim();
  return key ? ref(database, `operatorPresence/${key}`) : operatorPresenceRootRef;
}

export function getDisplayPresenceEntryRef(uid = "") {
  const key = String(uid || "").trim();
  if (!key) {
    return displayPresenceRootRef;
  }
  return ref(database, `render/displayPresence/${key}`);
}

export function getOperatorPresenceEntryRef(eventId = "", operatorId = "") {
  const eventKey = String(eventId || "").trim();
  const userKey = String(operatorId || "").trim();
  if (!eventKey || !userKey) {
    return operatorPresenceRootRef;
  }
  return ref(database, `operatorPresence/${eventKey}/${userKey}`);
}

export function getOperatorScheduleConsensusRef(eventId = "") {
  const eventKey = String(eventId || "").trim();
  return eventKey ? ref(database, `operatorPresenceConsensus/${eventKey}`) : operatorScheduleConsensusRootRef;
}

export function getGlEventConfigRef(eventId = "") {
  const key = String(eventId || "").trim();
  if (!key) {
    return glIntakeEventsRef;
  }
  return ref(database, `glIntake/events/${key}`);
}

export function getGlApplicationsRef(eventId = "") {
  const key = String(eventId || "").trim();
  if (!key) {
    return glIntakeApplicationsRootRef;
  }
  return ref(database, `glIntake/applications/${key}`);
}

export function getGlApplicationRef(eventId = "", applicationId = "") {
  const eventKey = String(eventId || "").trim();
  const appKey = String(applicationId || "").trim();
  if (!eventKey) {
    return glIntakeApplicationsRootRef;
  }
  if (!appKey) {
    return ref(database, `glIntake/applications/${eventKey}`);
  }
  return ref(database, `glIntake/applications/${eventKey}/${appKey}`);
}

export function getGlAssignmentsRef(eventId = "") {
  const key = String(eventId || "").trim();
  if (!key) {
    return glAssignmentsRootRef;
  }
  return ref(database, `glAssignments/${key}`);
}

export function getGlAssignmentRef(eventId = "", scheduleId = "", glId = "") {
  const eventKey = String(eventId || "").trim();
  const scheduleKey = String(scheduleId || "").trim();
  const glKey = String(glId || "").trim();

  if (!eventKey) {
    return glAssignmentsRootRef;
  }
  if (!scheduleKey) {
    return ref(database, `glAssignments/${eventKey}`);
  }
  if (!glKey) {
    return ref(database, `glAssignments/${eventKey}/${scheduleKey}`);
  }
  return ref(database, `glAssignments/${eventKey}/${scheduleKey}/${glKey}`);
}

export {
  ref,
  update,
  remove,
  set,
  get,
  onValue,
  serverTimestamp,
  push,
  query,
  limitToLast,
  orderByChild,
  child,
  onDisconnect,
  runTransaction,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  getIdToken,
  enableLogging
};

// Console helper for operators: expose auth/database handles so `firebase.auth()` style
// snippets from the docs keep working in DevTools.
if (typeof window !== "undefined") {
  const compatFirebase = (window.firebase ||= {});
  compatFirebase.auth = () => auth;
  compatFirebase.database ||= {};
  compatFirebase.database.enableLogging = enableLogging;

  // Direct handles for debugging (e.g. window.__opFirebase.auth.currentUser)
  window.__opFirebase = {
    app,
    auth,
    database,
    getIdToken,
    enableLogging
  };
}