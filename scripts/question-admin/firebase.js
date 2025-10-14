import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { firebaseConfig } from "./constants.js";

const apps = getApps();
const app = apps.length ? getApp() : initializeApp(firebaseConfig);
const database = getDatabase(app);

const authProvider = app._getProvider("auth");
const auth = authProvider.isInitialized()
  ? authProvider.getImmediate()
  : initializeAuth(app, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    });
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

async function getAuthIdToken(forceRefresh = false) {
  const currentUser = auth.currentUser;
  if (currentUser) {
    return await currentUser.getIdToken(forceRefresh);
  }

  return await new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      user => {
        unsubscribe();
        if (!user) {
          reject(new Error("認証情報が確認できません。再度ログインしてください。"));
          return;
        }
        user.getIdToken(forceRefresh).then(resolve).catch(reject);
      },
      error => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

function rootDbRef(path = "") {
  return path ? ref(database, path) : ref(database);
}

async function fetchDbValue(path) {
  const snapshot = await get(rootDbRef(path));
  return snapshot.exists() ? snapshot.val() : null;
}

export {
  app,
  auth,
  provider,
  database,
  getAuthIdToken,
  rootDbRef,
  fetchDbValue,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  set,
  update
};
