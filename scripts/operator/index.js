// index.js: オペレーター画面の初期化とルーティング入口を定義します。
import { OperatorApp } from "./app.js";

// 埋め込み環境でも動作する OperatorApp を生成し、画面初期化を実行します。
const app = new OperatorApp();
app.init();

if (typeof window !== "undefined") {
  // 埋め込み先から操作できるよう operatorEmbed API を提供します。
  window.operatorEmbed = {
    app,
    setContext(context) {
      return app.setExternalContext(context);
    },
    waitUntilReady() {
      return app.waitUntilReady();
    },
    reset() {
      // 埋め込み先が初期状態へ戻したい場合に備えて状態をクリアします。
      try {
        app.redirectingToIndex = false;
        app.embedReadyDeferred = null;
        app.showLoggedOutState();
      } catch (error) {
        console.error("operatorEmbed.reset failed", error);
      }
    }
  };
}
