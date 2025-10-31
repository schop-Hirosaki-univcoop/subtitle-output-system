# ログインからローダー起動までのフロー

## 処理シーケンス概要
1. **LoginPage.init** がログイン画面のイベント登録と認証状態監視を開始します。【F:scripts/login.js†L47-L72】
2. 利用者がログインボタンを押すと **handleLoginClick → performLogin** がポップアップ認証を実行し、資格情報を `sessionStorage` に移送します。【F:scripts/login.js†L77-L119】
3. `onAuthStateChanged` のコールバック **handleAuthStateChanged** がサインイン済みを検知するとプリフライト完了を待ってからイベント一覧ページへ遷移させます。資格情報の転送データはイベント画面で消費されるまで保持されます。【F:scripts/login.js†L68-L242】
4. イベント一覧の **EventAdminApp.init** が UI 初期化後に再び `onAuthStateChanged` を購読します。【F:scripts/events/app.js†L390-L414】
5. サインインコールバック **handleAuthState** は未ログイン時に `consumeAuthTransfer` で資格情報を復元し、欠落していればプリフライトキャッシュ (`runAuthPreflight` の `credential`) から再構成して Firebase 認証を再開します。【F:scripts/events/app.js†L883-L930】【F:scripts/events/app.js†L1000-L1024】
6. 認証済みの場合、同メソッドがローディングインジケーターを開始し、`ensureAdminAccess` → `loadEvents` を通じて権限とイベント情報を同期します。【F:scripts/events/app.js†L1036-L1059】【F:scripts/events/app.js†L1068-L1079】
7. イベント管理アプリは権限確認とイベント読み込み完了後に **tools.preloadOperatorGlobals** を呼び、埋め込みオペレーターのモジュールを事前読み込みします。内部で `OperatorToolManager.ensureReady` が `scripts/operator/index.js` を動的 import し、`OperatorApp.init` を起動して認証監視を始めます。【F:scripts/events/app.js†L1036-L1045】【F:scripts/events/tools/operator.js†L69-L96】【F:scripts/operator/index.js†L1-L27】
8. ログインダイアログまたは転送済み認証で **OperatorApp.handleAuthState** が呼ばれ、ローダーを段階的に更新しながらユーザー表確認、権限同期、Realtime Database の初期読み込みを順に実行します。【F:scripts/operator/app.js†L2382-L2448】
9. 必要な購読が揃うとローダーを完了表示に切り替え、辞書・ログの初期取得と UI の最終調整を行います。【F:scripts/operator/app.js†L2449-L2460】

## 主要関数の責務と呼び出し元
| フェーズ | 呼び出し元 | 関数 | 主な責務 |
| --- | --- | --- | --- |
| ログイン画面 | `page.init()` | `LoginPage.bindEvents` / `observeAuthState` | ボタンイベント登録と Firebase 認証状態の監視を開始する。【F:scripts/login.js†L47-L83】 |
| ログイン画面 | `loginButton.click` | `LoginPage.performLogin` | Google ポップアップで認証し、資格情報を `storeAuthTransfer` に渡す。【F:scripts/login.js†L77-L119】 |
| ログイン画面 | `onAuthStateChanged` | `LoginPage.handleAuthStateChanged` | サインイン済みを検出し、プリフライト完了後にイベント一覧へ遷移する。【F:scripts/login.js†L68-L242】 |
| イベント一覧 | `app.init()` | `EventAdminApp.observeAuthState` | 認証コールバックをセットし、状態変化ごとに `handleAuthState` を実行する。【F:scripts/events/app.js†L390-L414】【F:scripts/events/app.js†L788-L799】 |
| イベント一覧 | `onAuthStateChanged` | `EventAdminApp.handleAuthState` | 資格情報の復元（プリフライトキャッシュを含む）、権限チェック、イベント読み込み、Presence 同期を逐次処理する。【F:scripts/events/app.js†L992-L1059】 |
| イベント一覧 | `handleAuthState` | `EventAdminApp.ensureAdminAccess` / `loadEvents` | Sheets 経由の権限保証と Realtime Database からのイベント一覧取得を行う。【F:scripts/events/app.js†L1036-L1059】【F:scripts/events/app.js†L1068-L1079】 |
| オペレーター画面 | `app.init()` | `OperatorApp.setupEventListeners` / `onAuthStateChanged` | 画面イベントとモジュール初期化、認証監視を整える。【F:scripts/operator/app.js†L2087-L2140】 |
| オペレーター画面 | `login()` or `onAuthStateChanged` | `OperatorApp.handleAuthState` | ローダーの各ステップを更新しながらユーザー表検証、権限同期、初期データ購読を完了させる。【F:scripts/operator/app.js†L2372-L2448】 |

## 後続タスク向け共有前提条件
- Google 認証資格情報は `storeAuthTransfer` / `consumeAuthTransfer` を介して `sessionStorage` に保存・復元され、欠落時はプリフライトキャッシュの `credential` から補完されて `signInWithCredential` へ供給される。【F:scripts/login.js†L109-L119】【F:scripts/events/app.js†L883-L930】
- API 呼び出しには各画面の `createApiClient(auth, onAuthStateChanged)` で生成したクライアントを使用し、Sheets 操作や権限付与を担う（`fetchSheet`, `ensureAdmin` など）。【F:scripts/events/app.js†L23-L26】【F:scripts/operator/app.js†L274-L280】【F:scripts/operator/app.js†L2382-L2448】
- オペレーター画面のローダーは `Loader` モジュールのステップ管理 API（`initLoaderSteps`, `setLoaderStep`, `finishLoaderSteps`）を前提とし、UI DOM が利用可能であることが必要。【F:scripts/operator/app.js†L38-L188】【F:scripts/operator/app.js†L2382-L2448】
- Firebase Realtime Database 参照（`questionsRef`, `questionStatusRef` など）と Presence 用参照ユーティリティが初期同期の必須依存であり、`get`/`onValue` が利用可能な環境であること。【F:scripts/operator/app.js†L4-L21】【F:scripts/operator/app.js†L2420-L2448】
- 画面間遷移は `routes.goToEvents` / `routes.goToLogin` の `window.location.replace` に依存するため、ブラウザ環境で `window` が利用可能であること。【F:scripts/shared/routes.js†L6-L38】【F:scripts/login.js†L180-L187】【F:scripts/events/app.js†L671-L681】
