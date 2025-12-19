// index.js: イベント管理ページの初期化を実行し、必要なモジュールを束ねて起動します。
import { EventAdminApp } from "./app.js";

// 実際の画面表示を担う EventAdminApp を初期化します。
const app = new EventAdminApp();

// グローバル変数に設定（operator画面のAuthManagerからアクセス可能にするため）
if (typeof window !== "undefined") {
  window.eventAdminApp = app;
}

// Firebase連携やDOMバインドをまとめて起動し、運用モードへ遷移させます。
app.init();
