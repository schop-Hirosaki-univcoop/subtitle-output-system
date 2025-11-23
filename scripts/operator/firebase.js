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
  runTransaction
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
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./constants.js";
import { getRenderStatePath, getNowShowingPath, getSideTelopPath } from "../shared/channel-paths.js";

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

const LEGACY_RENDER_REF = ref(database, "render/state");
const LEGACY_NOW_SHOWING_REF = ref(database, "render/state/nowShowing");
const LEGACY_SIDE_TELOP_REF = ref(database, "render/state/sideTelops");
export const displaySessionRef = ref(database, "render/session");
export const displayPresenceRootRef = ref(database, "render/displayPresence");
export const questionsRef = ref(database, "questions");
export const pickupQuestionsRef = ref(database, "questions/pickup");
export const questionStatusRef = ref(database, "questionStatus");
export const questionIntakeEventsRef = ref(database, "questionIntake/events");
export const questionIntakeSchedulesRef = ref(database, "questionIntake/schedules");
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

export function getRenderRef(eventId = "", scheduleId = "") {
  const path = getRenderStatePath(eventId, scheduleId);
  return path === "render/state" ? LEGACY_RENDER_REF : ref(database, path);
}

export function getNowShowingRef(eventId = "", scheduleId = "") {
  const path = getNowShowingPath(eventId, scheduleId);
  return path === "render/state/nowShowing" ? LEGACY_NOW_SHOWING_REF : ref(database, path);
}

export function getSideTelopsRef(eventId = "", scheduleId = "") {
  const path = getSideTelopPath(eventId, scheduleId);
  return path === "render/state/sideTelops" ? LEGACY_SIDE_TELOP_REF : ref(database, path);
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
  onAuthStateChanged
};
