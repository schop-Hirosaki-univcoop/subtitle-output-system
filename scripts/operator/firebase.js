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
  onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  initializeAuth,
  getAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./constants.js";
import { getRenderStatePath, getNowShowingPath } from "../shared/channel-paths.js";

const apps = getApps();
export const app = apps.length ? getApp() : initializeApp(firebaseConfig);
export const database = getDatabase(app);

export const auth = apps.length
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    });
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const LEGACY_RENDER_REF = ref(database, "render/state");
const LEGACY_NOW_SHOWING_REF = ref(database, "render/state/nowShowing");
export const displaySessionRef = ref(database, "render/session");
export const questionsRef = ref(database, "questions");
export const pickupQuestionsRef = ref(database, "questions/pickup");
export const questionStatusRef = ref(database, "questionStatus");
export const questionIntakeEventsRef = ref(database, "questionIntake/events");
export const questionIntakeSchedulesRef = ref(database, "questionIntake/schedules");
export const updateTriggerRef = ref(database, "signals/logs");
export const dictionaryRef = ref(database, "dictionary");
export const operatorChatMessagesRef = ref(database, "operatorChat/messages");
export const operatorChatReadsRef = ref(database, "operatorChat/reads");
const operatorPresenceRootRef = ref(database, "operatorPresence");

export function getRenderRef(eventId = "", scheduleId = "") {
  const path = getRenderStatePath(eventId, scheduleId);
  return path === "render/state" ? LEGACY_RENDER_REF : ref(database, path);
}

export function getNowShowingRef(eventId = "", scheduleId = "") {
  const path = getNowShowingPath(eventId, scheduleId);
  return path === "render/state/nowShowing" ? LEGACY_NOW_SHOWING_REF : ref(database, path);
}

export function getOperatorPresenceEventRef(eventId = "") {
  const key = String(eventId || "").trim();
  return key ? ref(database, `operatorPresence/${key}`) : operatorPresenceRootRef;
}

export function getOperatorPresenceEntryRef(eventId = "", operatorId = "") {
  const eventKey = String(eventId || "").trim();
  const userKey = String(operatorId || "").trim();
  if (!eventKey || !userKey) {
    return operatorPresenceRootRef;
  }
  return ref(database, `operatorPresence/${eventKey}/${userKey}`);
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
  signInWithPopup,
  signOut,
  onAuthStateChanged
};
