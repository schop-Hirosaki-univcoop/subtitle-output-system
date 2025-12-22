// main.js: Vueアプリケーションのエントリーポイント
// style.cssをインポートして、グローバルスタイルを適用
import "../style.css";

import { createApp } from "vue";
import QuestionList from "./components/QuestionList.vue";

// OperatorAppが初期化されるまで待機
function waitForOperatorApp() {
  return new Promise((resolve) => {
    if (window.operatorEmbed?.app) {
      resolve(window.operatorEmbed.app);
      return;
    }

    // 最大10秒待機
    let attempts = 0;
    const maxAttempts = 100;
    const interval = setInterval(() => {
      attempts++;
      if (window.operatorEmbed?.app) {
        clearInterval(interval);
        resolve(window.operatorEmbed.app);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn("[Vue] OperatorApp の初期化を待機中にタイムアウトしました");
        resolve(null);
      }
    }, 100);
  });
}

// OperatorAppが初期化されたらVueアプリをマウント
waitForOperatorApp().then((app) => {
  if (!app) {
    console.warn("[Vue] OperatorApp が見つかりません。Vueアプリをマウントできません。");
    return;
  }

  const container = document.getElementById("op-questions-cards");
  if (!container) {
    console.warn("[Vue] op-questions-cards コンテナが見つかりません");
    return;
  }

  // 既存のrenderQuestionsを一時的に無効化（Vueコンポーネントを使用するため）
  if (typeof window !== "undefined") {
    window.__vueExperimentEnabled = true;
  }

  // 既存のrenderQuestionsをラップ
  if (app && typeof app.renderQuestions === "function") {
    const originalRenderQuestions = app.renderQuestions.bind(app);
    app.renderQuestions = function () {
      if (window.__vueExperimentEnabled) {
        console.log("[Vue] 既存のrenderQuestionsをスキップ（Vueコンポーネントを使用）");
        return;
      }
      return originalRenderQuestions();
    };
  }

  // Vueアプリを作成してマウント
  const vueApp = createApp(QuestionList);
  vueApp.mount(container);
  console.log("[Vue] QuestionList アプリをマウントしました");
});

