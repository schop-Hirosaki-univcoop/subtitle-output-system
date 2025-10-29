// index.js: イベント管理ページの初期化を実行し、必要なモジュールを束ねて起動します。
import { EventAdminApp } from "./app.js";

const app = new EventAdminApp();
app.init();
