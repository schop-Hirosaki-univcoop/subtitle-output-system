import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  update,
  remove,
  set,
  get,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./constants.js";

export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = initializeAuth(app, {
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export const renderRef = ref(database, "render_state");
export const displaySessionRef = ref(database, "render_control/session");
export const questionsRef = ref(database, "questions");
export const telopRef = ref(database, "currentTelop");
export const updateTriggerRef = ref(database, "update_trigger");
export const dictionaryRef = ref(database, "dictionary");

export {
  ref,
  update,
  remove,
  set,
  get,
  onValue,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};
