# ログインからローダー起動までのフロー

このドキュメントは、ログイン画面からオペレーター画面のローダー起動までの処理フローを説明します。

## 処理シーケンス概要

1. **LoginPage.init** がログイン画面のイベント登録と認証状態監視を開始します。
2. 利用者がログインボタンを押すと **handleLoginClick → performLogin** がポップアップ認証を実行し、資格情報を `sessionStorage` に移送します。
3. `onAuthStateChanged` のコールバック **handleAuthStateChanged** がサインイン済みを検知するとプリフライト完了を待ってからイベント一覧ページへ遷移させます。資格情報の転送データはイベント画面で消費されるまで保持されます。
4. イベント一覧の **EventAdminApp.init** が UI 初期化後に再び `onAuthStateChanged` を購読します。
5. サインインコールバック **handleAuthState** は未ログイン時に `consumeAuthTransfer` で資格情報を復元し、欠落していればプリフライトキャッシュ（`runAuthPreflight` の `credential`）から再構成して Firebase 認証を再開します。
6. 認証済みの場合、同メソッドがローディングインジケーターを開始し、`ensureAdminAccess` → `loadEvents` を通じて権限とイベント情報を同期します。
7. イベント管理アプリは権限確認とイベント読み込み完了後に **tools.preloadOperatorGlobals** を呼び、埋め込みオペレーターのモジュールを事前読み込みします。内部で `OperatorToolManager.ensureReady` が `scripts/operator/index.js` を動的 import し、`OperatorApp.init` を起動して認証監視を始めます。
8. ログインダイアログまたは転送済み認証で **OperatorApp.handleAuthState**（`AuthManager.handleAuthState`）が呼ばれ、ローダーを段階的に更新しながらユーザー表確認、権限同期、Realtime Database の初期読み込みを順に実行します。
9. 必要な購読が揃うとローダーを完了表示に切り替え、辞書・ログの初期取得と UI の最終調整を行います。

## 主要関数の責務と呼び出し元

| フェーズ         | 呼び出し元                        | 関数                                                           | 主な責務                                                                                                    |
| ---------------- | --------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ログイン画面     | `page.init()`                     | `LoginPage.bindEvents` / `observeAuthState`                    | ボタンイベント登録と Firebase 認証状態の監視を開始する                                                      |
| ログイン画面     | `loginButton.click`               | `LoginPage.performLogin`                                       | Google ポップアップで認証し、資格情報を `storeAuthTransfer` に渡す                                          |
| ログイン画面     | `onAuthStateChanged`              | `LoginPage.handleAuthStateChanged`                             | サインイン済みを検出し、プリフライト完了後にイベント一覧へ遷移する                                          |
| イベント一覧     | `app.init()`                      | `EventAdminApp.observeAuthState`                               | 認証コールバックをセットし、状態変化ごとに `handleAuthState` を実行する                                     |
| イベント一覧     | `onAuthStateChanged`              | `EventAdminApp.handleAuthState`                                | 資格情報の復元（プリフライトキャッシュを含む）、権限チェック、イベント読み込み、Presence 同期を逐次処理する |
| イベント一覧     | `handleAuthState`                 | `EventAdminApp.ensureAdminAccess` / `loadEvents`               | Sheets 経由の権限保証と Realtime Database からのイベント一覧取得を行う                                      |
| オペレーター画面 | `app.init()`                      | `OperatorApp.setupEventListeners` / `onAuthStateChanged`       | 画面イベントとモジュール初期化、認証監視を整える                                                            |
| オペレーター画面 | `login()` or `onAuthStateChanged` | `OperatorApp.handleAuthState`（`AuthManager.handleAuthState`） | ローダーの各ステップを更新しながらユーザー表検証、権限同期、初期データ購読を完了させる                      |

## 後続タスク向け共有前提条件

- Google 認証資格情報は `storeAuthTransfer` / `consumeAuthTransfer` を介して `sessionStorage` に保存・復元され、欠落時はプリフライトキャッシュの `credential` から補完されて `signInWithCredential` へ供給される。
- API 呼び出しには各画面の `createApiClient(auth, onAuthStateChanged)` で生成したクライアントを使用し、Sheets 操作や権限付与を担う（`fetchSheet`, `ensureAdmin` など）。
- オペレーター画面のローダーは `UIHelpers` モジュールのステップ管理 API（`initLoaderSteps`, `setLoaderStep`, `finishLoaderSteps`）を前提とし、UI DOM が利用可能であることが必要。
- Firebase Realtime Database 参照（`questionsRef`, `getQuestionStatusRef` など）と Presence 用参照ユーティリティが初期同期の必須依存であり、`get`/`onValue` が利用可能な環境であること。
- 画面間遷移は `routes.goToEvents` / `routes.goToLogin` の `window.location.replace` に依存するため、ブラウザ環境で `window` が利用可能であること。

## 関連ドキュメント

- `scripts/login.js`: ログイン画面の実装
- `scripts/events/app.js`: イベント管理画面の実装
- `scripts/operator/app.js`: オペレーター画面の実装
- `scripts/operator/auth-manager.js`: 認証管理の実装
- `scripts/operator/ui-helpers.js`: ローダー機能の実装
- `scripts/shared/auth-preflight.js`: 認証プリフライトの実装
- `docs/operator-shared-storage-and-fallback.md`: 共有ストレージとフォールバックの説明
