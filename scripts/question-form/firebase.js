// firebase.js: 質問フォーム用のFirebase接続と参照生成を司ります。
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export function getDatabaseInstance(config) {
  const apps = getApps();
  const app = apps.length ? getApp() : initializeApp(config);
  return getDatabase(app);
}
