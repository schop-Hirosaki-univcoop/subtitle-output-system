// index.js: オペレーター画面の初期化とルーティング入口を定義します。
import { OperatorApp } from "./app.js";

const app = new OperatorApp();
app.init();

if (typeof window !== "undefined") {
  window.operatorEmbed = {
    app,
    setContext(context) {
      return app.setExternalContext(context);
    },
    waitUntilReady() {
      return app.waitUntilReady();
    },
    reset() {
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
