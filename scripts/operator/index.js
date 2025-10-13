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
    }
  };
}
