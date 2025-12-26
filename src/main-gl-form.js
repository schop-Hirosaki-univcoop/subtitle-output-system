// main-gl-form.js: GL応募フォームのVueアプリケーションエントリーポイント
import "../style.css";
import "../question-form.css";

import { createApp } from "vue";
import GlForm from "./components/GlForm.vue";

// Vueアプリが有効な場合は既存のスクリプトをスキップ
if (typeof window !== "undefined") {
  window.__vueGlFormEnabled = true;
}

// Vueアプリをマウントするコンテナを取得
const container = document.querySelector("main.single-main");
if (!container) {
  console.warn("[Vue GlForm] main.single-main コンテナが見つかりません");
} else {
  // 既存のフォームセクションを置き換える
  const existingSection = container.querySelector("section.module--primary");
  if (existingSection) {
    existingSection.remove();
  }
  // Vueアプリを作成してマウント
  const vueApp = createApp(GlForm);
  vueApp.mount(container);
}

