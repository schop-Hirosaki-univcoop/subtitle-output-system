// main-login.js: ログイン画面のVueアプリケーションエントリーポイント
import "../style.css";

import { createApp } from "vue";
import LoginPage from "./components/LoginPage.vue";

// Vueアプリをマウントするコンテナを取得
const container = document.querySelector("main.single-main");
if (!container) {
  console.warn("[Vue Login] main.single-main コンテナが見つかりません");
} else {
  // Vueアプリを作成してマウント
  const vueApp = createApp(LoginPage);
  vueApp.mount(container);
}

