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
    const checkInterval = setInterval(() => {
      if (window.operatorEmbed?.app) {
        clearInterval(checkInterval);
        resolve(window.operatorEmbed.app);
      }
    }, 100);
    // タイムアウト（10秒）
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(null);
    }, 10000);
  });
}

// DOMContentLoaded後に初期化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  const container = document.getElementById("vue-questions-container");
  if (!container) {
    console.warn("Vue questions container not found");
    return;
  }

  const app = await waitForOperatorApp();
  if (!app) {
    console.warn("OperatorApp not found");
    return;
  }

  const vueApp = createApp(QuestionList);
  vueApp.mount(container);
}

