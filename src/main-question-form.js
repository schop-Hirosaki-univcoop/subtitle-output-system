// main-question-form.js: 質問フォームのVueアプリケーションエントリーポイント
import "../style.css";
import "../question-form.css";

import { createApp } from "vue";
import QuestionForm from "./components/QuestionForm.vue";

// Vueアプリが有効な場合は既存のスクリプトをスキップ
if (typeof window !== "undefined") {
  window.__vueQuestionFormEnabled = true;
}

// Vueアプリをマウントするコンテナを取得
const container = document.querySelector("main.single-main");
if (!container) {
  console.warn("[Vue QuestionForm] main.single-main コンテナが見つかりません");
} else {
  // 既存のフォームセクションを置き換える
  const existingSection = container.querySelector("section.module--primary");
  if (existingSection) {
    // 既存のセクションを置き換えるために、親要素にマウント
    const parent = existingSection.parentElement;
    if (parent) {
      // 既存のセクションを削除
      existingSection.remove();
      // Vueアプリを作成してマウント
      const vueApp = createApp(QuestionForm);
      vueApp.mount(parent);
    } else {
      console.warn("[Vue QuestionForm] section.module--primary の親要素が見つかりません");
    }
  } else {
    // セクションが見つからない場合は直接コンテナにマウント
    const vueApp = createApp(QuestionForm);
    vueApp.mount(container);
  }
}

