# Operator API Client 概要

このドキュメントは、オペレーター画面およびイベント管理画面で使用される API クライアントの実装と使用方法を説明します。

## 定義と責務

- API クライアントは `scripts/operator/api-client.js` で定義されています。
- Firebase 認証トークンの取得を調整し、以下の 3 つのヘルパー関数を提供します：
  - `apiPost`: Apps Script API への POST リクエスト送信
  - `fireAndForgetApi`: レスポンスを待たない API 呼び出し
  - `logAction`: オペレーター操作のログ記録

## インスタンス化

- `OperatorApp` はコンストラクタ内でインスタンスを作成し、`this.api` に割り当てます。
- `EventAdminApp` も同様に DOM 初期化時にインスタンスを作成し、`this.api` に保存します。
- 下流のモジュールは、所有するアプリの `api` プロパティを通じてのみクライアントと対話します。

主な使用箇所：

- 権限チェック、初期同期、スケジュールロック処理
- 辞書の CRUD 操作
- ピックアップ機能
- ダイアログと質問ワークフロー、ログ送信ユーティリティ
- ログ取得ユーティリティ
- イベント管理機能（管理者検出、スケジュールロック、シート同期など）

## 初期化戦略

### 現在の実装（画面ごとの初期化）

各画面が `OperatorApp` / `EventAdminApp` を通じて独自のクライアントを所有します。

**メリット**:

- 各クラスが `this.api` を通じて依存関係をカプセル化
- `handleAuthState` スタイルのフローと互換性がある
- 画面ごとにエラーハンドリングとトーストを実装可能

**実装箇所**:

```400:400:scripts/operator/app.js
    this.api = createApiClient(auth, onAuthStateChanged);
```

### プリフライト統合

`runAuthPreflight` はログイン直後に実行され、API クライアントを一度ウォームアップし、結果の認証情報、管理者情報、ミラー情報を後続の画面で使用できるように保存します。イベント画面とオペレーター画面は、まずこのコンテキストを読み取り、キャッシュされたデータが存在しない場合のみローカルコンストラクタにフォールバックします。

## 認証情報の保存と取得

### 保存形式

- `sessionStorage` のキー `sos:operatorAuthTransfer` を使用
- Google 認証成功直後に、`providerId`, `signInMethod`, `idToken`, `accessToken`, `timestamp` を含む JSON ペイロードを保存

### 保存タイミング

- ログイン成功後、ログイン画面から遷移する前に資格情報をキャプチャ
- 無効な資格情報は即座に削除

### 取得タイミング

- イベント管理画面で `onAuthStateChanged` がサインアウト状態を報告した場合、`tryResumeAuth` を一度呼び出します
- `consumeAuthTransfer` を呼び出し、復元した資格情報でサインインを試み、成功・失敗に関わらずストレージエントリをクリア

### API リクエストの動作

- 画面ごとの `this.api` インスタンスは、各リクエストで Firebase Auth から新しい ID トークンを取得します
- 401 形式のレスポンスの場合、1 回だけ強制リフレッシュを試みてから諦めるため、追加のローカル永続化は不要です

### 失敗処理

- `sessionStorage` が利用できない場合、または期待されるペイロードが欠落している場合、認証転送の復元を放棄し、標準のログインパスにフォールバックします

## API 関数の詳細

### `apiPost(payload, retryOnAuthError = true)`

Apps Script API に POST リクエストを送信し、共通のエラーハンドリングを行います。

**パラメータ**:

- `payload`: GAS 側に送信するリクエストボディ（`Record<string, unknown>`）
- `retryOnAuthError`: 認証エラー時にリトライを試みるか（デフォルト: `true`）

**戻り値**: `Promise<any>`

**動作**:

1. Firebase Auth から ID トークンを取得
2. `GAS_API_URL` に POST リクエストを送信
3. レスポンスが成功でない場合、エラーメッセージを確認
4. 認証エラーの場合、トークンを強制リフレッシュして 1 回だけ再試行
5. それでも失敗する場合、エラーをスロー

### `fireAndForgetApi(payload)`

レスポンスを待たずに API を呼び出し、失敗はコンソールに記録します。即時性を重視するログ送信などで利用します。

**パラメータ**:

- `payload`: GAS 側に送信するリクエストボディ（`Record<string, unknown>`）

**戻り値**: `void`

### `logAction(actionName, details = "")`

オペレーター操作を GAS バックエンドへ記録します。失敗しても UI には影響させず、コンソールロギングのみに留めます。

**パラメータ**:

- `actionName`: 操作の種類（`string`）
- `details`: 追加情報（`string`、デフォルト: `""`）

**戻り値**: `Promise<void>`

## 使用例

```javascript
// OperatorApp 内での使用例
const result = await this.api.apiPost({
  action: "ensureAdmin",
  eventId: this.state.activeEventId
});

// ログ送信（非同期、エラーを無視）
this.api.fireAndForgetApi({
  action: "logAction",
  action_type: "question_sent",
  details: `Question UID: ${uid}`
});

// 操作ログの記録
await this.api.logAction("schedule_locked", `Schedule: ${scheduleId}`);
```

## 関連ドキュメント

- `scripts/operator/api-client.js`: API クライアントの実装
- `scripts/shared/auth-preflight.js`: 認証プリフライトの実装
- `docs/login-to-loader-flow.md`: ログインからローダー起動までのフロー
