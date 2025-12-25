// main-login.js: ログイン画面のVueアプリケーションエントリーポイント
import "../style.css";

import { createApp } from "vue";
import LoginPage from "./components/LoginPage.vue";

// Vueアプリをマウントするコンテナを取得
const container = document.querySelector("main.single-main");
if (!container) {
  console.warn("[Vue Login] main.single-main コンテナが見つかりません");
} else {
  // 既存のログインカードセクションを置き換える
  const existingSection = container.querySelector("section.module--primary");
  if (existingSection) {
    // 既存のセクションを置き換えるために、親要素にマウント
    const parent = existingSection.parentElement;
    if (parent) {
      // 既存のセクションを削除
      existingSection.remove();
      // Vueアプリを作成してマウント
      const vueApp = createApp(LoginPage);
      vueApp.mount(parent);
    } else {
      console.warn("[Vue Login] section.module--primary の親要素が見つかりません");
    }
  } else {
    console.warn("[Vue Login] section.module--primary が見つかりません");
  }
}

