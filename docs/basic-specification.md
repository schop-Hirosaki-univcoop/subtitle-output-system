# 基本仕様書

## 目次

1. [システム概要](#1-システム概要)
2. [システム構成](#2-システム構成)
   - [技術スタック](#21-技術スタック)
   - [主要ページ構成](#22-主要ページ構成)
   - [命名規則](#23-命名規則)
   - [ストレージキー](#24-ストレージキー)
   - [ディレクトリ構造](#25-ディレクトリ構造)
3. [主要機能詳細](#3-主要機能詳細)
4. [データ構造](#4-データ構造)
5. [画面遷移フロー](#5-画面遷移フロー)
6. [セキュリティ](#6-セキュリティ)
7. [制約事項](#7-制約事項)
8. [運用フロー](#8-運用フロー)
9. [拡張機能](#9-拡張機能)
10. [モジュール設計原則](#10-モジュール設計原則)
11. [アクセシビリティ](#11-アクセシビリティ)
12. [パフォーマンス](#12-パフォーマンス)
13. [参考ドキュメント](#13-参考ドキュメント)

---

## 1. システム概要

### 1.1 システム名

字幕出力システム（Subtitle Output System）

### 1.2 目的

イベント運営における参加者からの質問受付、オペレーターによる質問管理・テロップ操作、およびリアルタイムでのテロップ表示を統合的に提供するシステムです。

### 1.3 主要機能

1. **質問受付機能**: 参加者が専用 URL から質問を投稿
2. **オペレーター管理機能**: 質問の選択・承認・テロップ表示制御
3. **テロップ表示機能**: リアルタイムでの質問テロップ表示
4. **イベント管理機能**: イベント・スケジュール・参加者管理
5. **GL 応募機能**: グループリーダーの応募受付
6. **認証・権限管理**: Google アカウントによる管理画面アクセス制御

---

## 2. システム構成

### 2.1 技術スタック

- **フロントエンド**: HTML5, CSS3, JavaScript (ES Modules)
- **Web Components**: Custom Elements API を使用した共通コンポーネント（`telop-header`, `telop-footer`）
- **バックエンド**: Firebase Realtime Database
- **認証**: Firebase Authentication (Google OAuth, 匿名認証)
- **補助サービス**: Google Apps Script (`code.gs` - メール送信、権限管理など)
- **テスト**: Node.js (ES Modules, `*.test.mjs`)

### 2.2 主要ページ構成

| ページ                 | ファイル                     | 用途                                                           |
| ---------------------- | ---------------------------- | -------------------------------------------------------------- |
| トップページ           | `index.html`                 | アクセス案内                                                   |
| ログイン               | `login.html`                 | 管理画面へのログイン                                           |
| イベント管理           | `events/app.js` 経由         | イベント・スケジュール・参加者管理                             |
| 質問管理               | `question-admin/app.js` 経由 | イベント・スケジュール・参加者の詳細管理、メール送信、CSV 処理 |
| オペレーター画面       | `operator.html`              | 質問管理・テロップ操作                                         |
| 質問受付フォーム       | `question-form.html`         | 参加者による質問投稿                                           |
| テロップ表示           | `display.html`               | 質問テロップのリアルタイム表示                                 |
| GL 応募フォーム        | `gl-form.html`               | グループリーダー応募                                           |
| 参加者メール閲覧ページ | `participant-mail-view.html` | 参加者向けメールの閲覧（メール表示不具合時の代替）             |
| 404 エラーページ       | `404.html`                   | ページが見つからない場合のエラー表示                           |

### 2.3 命名規則

開発標準に基づく命名規則：

#### ファイル名・ディレクトリ名

- **形式**: `kebab-case`（小文字とハイフン）
- **例**:
  - `question-form.html`
  - `auth-manager.js`
  - `question-admin/`

#### JavaScript 命名規則

- **クラス名**: `PascalCase`（例: `OperatorApp`, `EventAuthManager`）
- **関数・メソッド名**: `camelCase`（例: `getActiveChannel`, `lockDisplayToSchedule`）
- **変数名**: `camelCase`（例: `eventId`, `scheduleId`）
- **定数名**: `UPPER_SNAKE_CASE`（例: `OPERATOR_PRESENCE_HEARTBEAT_MS`）

#### CSS 命名規則

- **クラス名**: `kebab-case`（例: `flow-page`, `question-form-page`）
- **CSS 変数**: `kebab-case`、`--` プレフィックス（例: `--ui-bg`, `--flow-stage-panel-width`）

#### HTML 属性

- **ID 属性**: `kebab-case`（例: `events-backup-button`）
- **data 属性**: `kebab-case`、`data-` プレフィックス（例: `data-event-id`）

### 2.4 ストレージキー

システムで使用される主要なストレージキー：

#### sessionStorage

- **`sos:operatorAuthTransfer`**: 画面間での認証資格情報の引き継ぎ
- **`sos:authPreflightContext`**: 認証プリフライト結果のキャッシュ（プライマリ）

#### localStorage

- **`sos:authPreflightContext`**: 認証プリフライト結果のキャッシュ（フォールバック）
- **`telop-ops-dictionary-open`**: ルビ辞書のドロワー状態
- **`telop-ops-logs-open`**: オペレーター活動ログのドロワー状態
- **`telop-ops-questions-subtab`**: 質問リストのサブタブ設定
- **`qa.printSettings.v1`**: 印刷設定

詳細については `docs/operator-shared-storage-and-fallback.md` を参照してください。

### 2.5 ディレクトリ構造

```
subtitle-output-system-1/
├── scripts/
│   ├── events/              # イベント管理機能
│   ├── operator/            # オペレーター画面機能
│   ├── question-form/       # 質問フォーム機能
│   ├── question-admin/      # 質問管理機能（イベント・スケジュール・参加者詳細管理）
│   ├── gl-form/             # GL 応募フォーム機能
│   ├── participant-mail-view/ # 参加者メール閲覧機能
│   └── shared/              # 共有ユーティリティ
├── docs/                    # ドキュメント
├── assets/                  # 静的リソース（フォント等）
├── tests/                   # テストファイル（*.test.mjs）
├── 参考資料/                # 参考資料
├── *.html                   # 各ページの HTML
├── email-*.html             # メールテンプレート
├── code.gs                  # Google Apps Script
└── firebase.rules.json      # Firebase Security Rules
```

---

## 3. 主要機能詳細

### 3.1 認証機能

#### 3.1.1 管理画面認証

- **認証方式**: Google OAuth
- **権限管理**: Firebase Realtime Database の`admins`ノードで管理
- **ログインフロー**:
  1. `login.html`で Google アカウント認証
  2. プリフライトチェック（管理者権限確認）
  3. 資格情報を`sessionStorage`に保存（`auth-transfer.js`を使用）
  4. イベント管理画面へ遷移

##### 認証プリフライト機能

- **定義場所**: `scripts/shared/auth-preflight.js`
- **用途**: ログイン前に管理者権限を確認し、認証失敗を早期に検出
- **キャッシュ**: `localStorage`にプリフライト結果をキャッシュ（デフォルト 5 分間）

##### 認証転送機能

- **定義場所**: `scripts/shared/auth-transfer.js`
- **用途**: 画面間での認証資格情報の引き継ぎ
- **保存先**: `sessionStorage`
- **主要関数**:
  - `storeAuthTransfer`: 資格情報を保存
  - `consumeAuthTransfer`: 資格情報を取得・削除
  - `clearAuthTransfer`: 資格情報をクリア

#### 3.1.2 テロップ表示認証

- **認証方式**: Firebase 匿名認証
- **承認管理**: `screens/approved/{uid}`ノードで管理
- **用途**: テロップ表示画面(`display.html`)のアクセス制御

#### 3.1.3 質問フォーム認証

- **認証方式**: トークンベース認証
- **トークン管理**: `questionIntake/tokens/{token}`
- **トークン検証**:
  - 存在確認
  - 有効期限確認
  - 取り消し状態確認

---

### 3.2 質問受付機能

#### 3.2.1 質問投稿フォーム (`question-form.html`)

- **入力項目**:

  - ラジオネーム（必須、20 文字以内）
  - 質問・お悩み（必須、60 文字以内）
  - ジャンル（必須、選択式）
    - 学び、活動、暮らし、食・スポット、移動・季節、その他

- **データ保存先**:

  - `questions/normal/{uid}`: 通常質問
  - `questionIntake/submissions/{token}/{submissionId}`: 提出情報

- **トークンから取得できる情報**:
  - `eventId`, `scheduleId`, `participantId`
  - `groupNumber`, `guidance`

#### 3.2.2 質問データ構造

```javascript
{
  uid: string,           // 質問の一意ID
  token: string,         // アクセストークン
  name: string,          // ラジオネーム
  question: string,      // 質問内容（60文字以内）
  genre: string,         // ジャンル
  ts: number,            // タイムスタンプ
  type: "normal",        // 質問タイプ
  questionLength: number // 質問の文字数
}
```

---

### 3.3 オペレーター管理機能

#### 3.3.1 主要機能

- **質問一覧表示**: 通常質問・ピックアップ質問の表示
- **質問選択**: 表示する質問の選択・承認
- **テロップ表示制御**: 選択した質問をテロップ画面へ送信
- **辞書管理**: ルビ振り用の辞書登録・編集
- **サイドテロップ管理**: 左・右サイドテロップの設定
- **チャット機能**: オペレーター間のコミュニケーション
- **ログ管理**: 操作ログの表示

#### 3.3.2 質問ステータス管理

- **データ保存先**: `questionStatus/{eventId}/{uid}`
- **ステータス**:
  - `answered`: 回答済みフラグ
  - `selecting`: 選択中フラグ
  - `updatedAt`: 更新時刻

#### 3.3.3 テロップ表示制御

- **データ保存先**: `render/events/{eventId}/{scheduleId}/nowShowing`
- **表示データ**:
  - `uid`: 表示する質問の UID（完全正規化により、他の情報は参照先から取得）

---

### 3.4 テロップ表示機能 (`display.html`)

#### 3.4.1 表示要素

- **メインテロップ**:

  - ラジオネーム（タブ形式）
  - ジャンル（左側パネル）
  - 質問本文（60 文字以内、1 行 23 文字想定）

- **サイドテロップ**:
  - 左サイド: イベント名・日程情報
  - 右サイド: 補足情報

#### 3.4.2 アニメーション

- 入場アニメーション（`telopIn`）
- 退場アニメーション（`telopOut`）
- テキスト入れ替えアニメーション（`textOut`/`textIn`）
- FLIP アニメーション（高さ・幅の補間）

#### 3.4.3 リアルタイム同期

- Firebase Realtime Database の`nowShowing`ノードを監視
- 変更時に自動的にテロップを更新
- レースコンディション対策としてトークン管理を実装

#### 3.4.4 ルビ振り機能

- `dictionary`ノードから辞書データを取得
- 質問本文に対して自動的にルビを適用
- `<ruby>`タグで表示

---

### 3.5 イベント管理機能

イベント管理機能は 2 つの画面で提供されます：

- **イベント管理画面** (`events/app.js`): パネル形式でのイベント・スケジュール・参加者管理
- **質問管理画面** (`question-admin/app.js`): 詳細なイベント・スケジュール・参加者管理、メール送信、CSV 処理

#### イベント管理画面のパネル構成

イベント管理画面では以下のパネルが提供されます：

- **イベントパネル**: イベント一覧・作成・編集
- **スケジュールパネル**: スケジュール一覧・作成・編集
- **参加者リストパネル**: 参加者情報の管理・質問フォーム URL 発行
- **GL リストパネル**: GL 応募フォーム設定・応募者管理・班割り管理
- **学部・学科設定パネル**: GL 応募フォーム用の学部・学科階層構造の編集
- **テロップ操作パネル**: オペレーター画面への埋め込み
- **チャットパネル**: オペレーター間のコミュニケーション

#### 3.5.1 イベント管理

- **データ保存先**: `questionIntake/events/{eventId}`
- **主要情報**:
  - `name`: イベント名
  - `createdAt`, `updatedAt`: 作成・更新時刻
- **主要機能**:
  - イベントの作成・編集・削除
  - イベント一覧の表示

#### 3.5.2 スケジュール管理

- **データ保存先**: `questionIntake/schedules/{eventId}/{scheduleId}`
- **主要情報**:
  - `label`: スケジュールラベル
  - `location`: 場所
  - `date`: 日付
  - `startAt`, `endAt`: 開始・終了時刻
  - `participantCount`: 参加者数
  - `glTeamCount`: GL チーム数
  - `teams`: チーム情報

#### 3.5.3 参加者管理

- **データ保存先**: `questionIntake/participants/{eventId}/{scheduleId}/{participantId}`
- **主要情報**:
  - `participantId`: 参加者 ID
  - `name`: 名前
  - `groupNumber`: グループ番号
  - `token`: アクセストークン
  - `email`: メールアドレス
  - `mailStatus`: メール送信ステータス

#### 3.5.4 トークン管理

- **データ保存先**: `questionIntake/tokens/{token}`
- **主要情報**:
  - `eventId`, `scheduleId`, `participantId`: 関連 ID
  - `groupNumber`: グループ番号
  - `expiresAt`: 有効期限
  - `revoked`: 取り消しフラグ
- **主要機能**:
  - トークンの自動生成
  - トークン付き URL の生成
  - トークンの取り消し

#### 3.5.5 質問管理画面の追加機能

質問管理画面 (`question-admin`) では、以下の追加機能を提供します：

- **CSV インポート/エクスポート**:

  - 参加者データの CSV インポート
  - 参加者リストの CSV エクスポート
  - チーム割り当てデータの CSV 処理

- **メール送信機能**:

  - 参加者への質問フォーム URL 送信
  - Google Apps Script (`code.gs`) を利用したメール送信
  - メール送信ステータス管理
  - メールテンプレート（`email-participant-body.html`, `email-participant-shell.html`）

- **印刷機能**:

  - 参加者リストの印刷プレビュー
  - スタッフ用リストの印刷
  - 印刷設定のカスタマイズ

- **参加者管理の詳細機能**:

  - 参加者の編集・削除
  - 重複参加者の検出
  - 参加者の移動（スケジュール間）
  - メール送信ステータスの確認

- **参加者メール閲覧ページ** (`participant-mail-view.html`):
  - メールが正しく表示されない場合の代替閲覧手段
  - トークン付き URL による認証
  - iframe を使用したメール本文の表示

---

### 3.6 GL 応募機能

#### 3.6.1 GL 応募フォーム (`gl-form.html`)

- **入力項目**:
  - 氏名、フリガナ、メールアドレス
  - 学年、学部、学科（階層選択）
  - 学籍番号、所属部活・サークル
  - 参加可能な日程（複数選択）
  - 備考・連絡事項

#### 3.6.2 データ構造

- **イベント設定**: `glIntake/events/{eventId}`

  - `slug`: URL スラッグ
  - `faculties`: 学部情報（階層構造）
  - `schedules`: スケジュール情報
  - `teams`: チーム情報

- **応募データ**: `glIntake/applications/{eventId}/{applicationId}`
  - `name`, `email`, `faculty`, `department`
  - `academicPath`: 進路情報（階層構造）
  - `shifts`: 参加可能日程

#### 3.6.3 GL 割り当て管理

- **データ保存先**: `glAssignments/{eventId}/{scheduleId}/{glId}`
- **主要情報**:
  - `status`: ステータス
  - `teamId`: チーム ID
  - `updatedAt`: 更新時刻

---

### 3.7 API Client 機能

#### 3.7.1 API Client 概要

- **定義場所**: `scripts/operator/api-client.js`
- **用途**: Firebase 認証トークンの取得と API 呼び出しの統合管理
- **主要メソッド**:
  - `apiPost`: POST リクエストの送信
  - `fireAndForgetApi`: 非同期 API 呼び出し
  - `logAction`: 操作ログの記録

#### 3.7.2 使用箇所

- `OperatorApp`: オペレーター画面で API Client を初期化
- `EventAdminApp`: イベント管理画面で API Client を初期化
- 権限チェック、スケジュールロック、辞書 CRUD、ピックアップ管理などで使用

### 3.8 Google Apps Script 機能

#### 3.8.1 主要機能

- **ファイル**: `code.gs`
- **用途**: サーバーサイド処理の補助
- **主要機能**:
  - メール送信（参加者への質問フォーム URL 送信）
  - 権限管理（管理者権限の確認）
  - Google Sheets との連携（必要に応じて）

### 3.9 Web Components

#### 3.9.1 共通コンポーネント

- **定義場所**: `scripts/shared/layout.js`
- **主要コンポーネント**:
  - `<telop-header>`: 共通ヘッダーコンポーネント
    - `tagline`: タグライン（副題）
    - `context-label`: コンテキストラベル
    - `slot="actions"`: アクション要素のスロット
    - `slot="meta"`: メタ情報のスロット
  - `<telop-footer>`: 共通フッターコンポーネント
    - `year`: 年号表示

### 3.10 プレゼンス管理

#### 3.10.1 オペレータープレゼンス

- **データ保存先**: `operatorPresence/{eventId}/{sessionId}`
- **主要情報**:
  - `uid`: ユーザー ID
  - `eventId`, `scheduleId`: 現在のイベント・スケジュール
  - `selectedScheduleId`: 選択中のスケジュール
  - `displayName`, `email`: 表示名・メール

#### 3.10.2 ディスプレイプレゼンス

- **データ保存先**: `render/displayPresence/{uid}`
- **用途**: テロップ表示画面の接続状態管理
- **主要情報**:
  - `sessionId`: セッション ID
  - `status`: ステータス（`active`, `pending`）
  - `eventId`, `scheduleId`: 関連イベント・スケジュール

### 3.11 モジュール設計

#### 3.11.1 設計原則

- **単一責任の原則**: 1 つのモジュールは 1 つの責務のみを持つ
- **依存関係の明確化**: 依存関係は明示的にインポート
- **循環依存の回避**: モジュール間の循環依存を避ける
- **再利用性**: 共有機能は `scripts/shared/` に配置
- **テスト容易性**: 純粋関数を可能な限り使用

#### 3.11.2 モジュール配置規則

- **共有モジュール**: `scripts/shared/` に配置（複数の機能で使用される共通機能）
- **機能固有モジュール**: 各機能ディレクトリに配置（例: `scripts/operator/`, `scripts/events/`）
- **ユーティリティ関数**: 汎用的な関数は独立したモジュールに（例: `utils.js`, `helpers.js`）
- **定数と設定**: 各機能ディレクトリの `constants.js`, `config.js` に配置

### 3.12 共有モジュール

#### 3.12.1 主要な共有モジュール一覧

| モジュール               | ファイル名               | 用途                                      |
| ------------------------ | ------------------------ | ----------------------------------------- |
| Firebase 設定            | `firebase-config.js`     | Firebase 接続設定の共通定義               |
| 認証プリフライト         | `auth-preflight.js`      | 認証前の権限確認とキャッシュ管理          |
| 認証転送                 | `auth-transfer.js`       | 画面間での認証資格情報の引き継ぎ          |
| 認証デバッグログ         | `auth-debug-log.js`      | 認証フローのデバッグログ記録              |
| チャンネルパス           | `channel-paths.js`       | Firebase データパスの生成・正規化         |
| ディスプレイリンクロガー | `display-link-logger.js` | ディスプレイ画面のログ記録                |
| レイアウト               | `layout.js`              | Web Components の定義（`telop-header`等） |
| オペレーターモード       | `operator-modes.js`      | オペレーターモードの定数定義              |
| 参加者トークン           | `participant-tokens.js`  | 参加者トークンの収集・処理                |
| プレゼンスキー           | `presence-keys.js`       | プレゼンス用のキー生成                    |
| 印刷プレビュー           | `print-preview.js`       | 印刷プレビューの UI 制御                  |
| 印刷ユーティリティ       | `print-utils.js`         | 印刷用 HTML の生成・設定管理              |
| ルーティング             | `routes.js`              | ページ遷移の制御                          |

---

## 4. データ構造

### 4.1 データ正規化

システムは**完全正規化**を採用しており、ID のみを保存し、情報は参照時に取得します。

#### 正規化の原則

- **ID のみを保存**: `eventId`, `scheduleId`, `participantId`などの ID のみ
- **参照時に取得**: イベント名、スケジュールラベルなどの情報は正規化された場所から取得
- **単一の情報源**: 各情報は 1 箇所にのみ保存

#### 正規化された場所

- **イベント名**: `questionIntake/events/{eventId}/name`
- **スケジュール情報**: `questionIntake/schedules/{eventId}/{scheduleId}/`
- **参加者名**: `questionIntake/participants/{eventId}/{scheduleId}/{participantId}/name`

### 4.2 主要データノード一覧

| ノードパス                                                           | 用途                   | 読み取り権限           | 書き込み権限                   |
| -------------------------------------------------------------------- | ---------------------- | ---------------------- | ------------------------------ |
| `render/events/{eventId}/sessions/{uid}`                             | ディスプレイセッション | 管理者・本人           | 管理者・本人                   |
| `render/events/{eventId}/{scheduleId}/state`                         | レンダリング状態       | 全員                   | 管理者・承認済みディスプレイ   |
| `render/events/{eventId}/{scheduleId}/nowShowing`                    | 現在表示中の質問       | 全員                   | 管理者・承認済みディスプレイ   |
| `render/events/{eventId}/{scheduleId}/sideTelops`                    | サイドテロップ         | 全員                   | 管理者・承認済みディスプレイ   |
| `operatorChat/messages`                                              | オペレーターチャット   | 管理者                 | 管理者                         |
| `questions/normal/{uid}`                                             | 通常質問               | 認証済み               | 管理者・有効トークン所有者     |
| `questions/pickup/{uid}`                                             | ピックアップ質問       | 認証済み               | 管理者                         |
| `questionStatus/{eventId}/{uid}`                                     | 質問ステータス         | 認証済み               | 管理者・承認済みディスプレイ   |
| `questionIntake/events/{eventId}`                                    | イベント情報           | 全員                   | 管理者                         |
| `questionIntake/schedules/{eventId}/{scheduleId}`                    | スケジュール情報       | 全員                   | 管理者                         |
| `questionIntake/participants/{eventId}/{scheduleId}/{participantId}` | 参加者情報             | 管理者                 | 管理者                         |
| `questionIntake/tokens/{token}`                                      | トークン情報           | 全員                   | 管理者                         |
| `questionIntake/submissions/{token}/{submissionId}`                  | 質問提出情報           | なし                   | 有効トークン所有者・管理者     |
| `glIntake/events/{eventId}`                                          | GL イベント設定        | 管理者・スラッグ所有者 | 管理者                         |
| `glIntake/applications/{eventId}/{applicationId}`                    | GL 応募データ          | 管理者                 | 管理者・認証なし（新規作成時） |
| `glAssignments/{eventId}/{scheduleId}/{glId}`                        | GL 割り当て            | 管理者                 | 管理者                         |
| `operatorPresence/{eventId}/{sessionId}`                             | オペレータープレゼンス | 管理者                 | 本人・管理者                   |
| `dictionary`                                                         | ルビ辞書               | 全員                   | 管理者                         |
| `logs/history`                                                       | ログ履歴               | 管理者                 | 管理者                         |
| `admins/{uid}`                                                       | 管理者情報             | なし                   | 管理者                         |

詳細なデータ構造については `docs/firebase-data-structure.md` を参照してください。

---

## 5. 画面遷移フロー

### 5.1 ログインからイベント管理画面

```
login.html
  ↓ (Google認証)
  ↓ (プリフライトチェック)
  ↓ (資格情報をsessionStorageに保存)
events/app.js (イベント管理画面)
  ↓ (認証状態確認・復元)
  ↓ (権限確認)
  ↓ (イベント一覧取得)
```

### 5.2 質問投稿フロー

```
参加者
  ↓ (メール等でトークン付きURL受領)
question-form.html
  ↓ (トークン検証)
  ↓ (フォーム表示)
  ↓ (質問入力・送信)
questions/normal/{uid} (保存)
  ↓
オペレーター画面で表示・選択可能に
```

### 5.3 テロップ表示フロー

```
オペレーター画面
  ↓ (質問選択)
render/events/{eventId}/{scheduleId}/nowShowing (更新)
  ↓
display.html
  ↓ (リアルタイム監視)
  ↓ (テロップ表示)
```

---

## 6. セキュリティ

### 6.1 認証・認可

- **管理者**: Firebase Realtime Database の`admins`ノードで管理
- **トークンベース認証**: 質問フォーム用トークンは有効期限・取り消し状態を管理
- **匿名認証**: テロップ表示画面は匿名認証 + 承認リストで制御

### 6.2 データアクセス制御

- Firebase Realtime Database Security Rules で厳密なアクセス制御
- 読み取り・書き込み権限をノードごとに定義
- 正規化されたデータの参照を前提とした権限設計

### 6.3 入力検証

- クライアント側での入力検証
- Firebase Security Rules でのサーバー側バリデーション
- 文字数制限（ラジオネーム 20 文字、質問 60 文字等）

### 6.4 エラーハンドリング

- **エラーチェーン**: `error.cause` プロパティを使用したエラーの原因追跡
- **カスタムエラー**: アプリケーション固有のエラークラス（例: `AuthPreflightError`）
- **ロールバック処理**: 複数操作のエラー時における適切なロールバック
- **リトライ処理**: 認証エラー時の 1 回限りのリトライ（API Client）

---

## 7. 制約事項

### 7.1 質問に関する制約

- **ラジオネーム**: 20 文字以内
- **質問本文**: 60 文字以内（句読点・改行含む）
- **表示想定**: 1 行 23 文字

### 7.2 ブラウザ要件

- JavaScript 必須（ES Modules 対応）
- Firebase SDK 10.12.2 使用

### 7.3 データベース

- Firebase Realtime Database 使用
- リアルタイム同期を前提とした設計

### 7.4 テスト

- **テストフレームワーク**: Node.js ES Modules
- **テストファイル形式**: `*.test.mjs`
- **テスト場所**: `tests/` ディレクトリ
- **現在のテスト対象**:
  - `participant-tokens.test.mjs`: 参加者トークン処理
  - `question-form-utils.test.mjs`: 質問フォームユーティリティ

---

## 8. 運用フロー

### 8.1 イベント準備

1. イベント作成（イベント名登録）
2. スケジュール作成（日程・場所・時間設定）
3. 参加者登録（CSV インポートまたは手動入力）
4. トークン生成（自動または手動）
5. メール送信（質問フォーム URL を含むメールを参加者へ送信）

### 8.2 イベント開催中

1. 参加者による質問投稿
2. オペレーターによる質問確認・選択
3. テロップ表示（リアルタイム同期）
4. 質問ステータス管理（回答済み等）

### 8.3 イベント終了後

1. ログ確認
2. データエクスポート（必要に応じて）

---

## 9. 拡張機能

### 9.1 ピックアップ質問機能

- 管理者が手動で質問を作成・編集
- `questions/pickup/{uid}`に保存
- 通常質問と同様にテロップ表示可能

### 9.2 サイドテロップ機能

- 左サイド: イベント名・日程情報
- 右サイド: 補足情報（プリセット機能あり）

### 9.3 辞書機能

- ルビ振り用の辞書登録・編集
- 質問本文に対して自動的にルビを適用

### 9.4 チャット機能

- オペレーター間のコミュニケーション
- 返信機能あり
- 既読管理

### 9.5 メールテンプレート機能

- **ファイル**: `email-participant-body.html`, `email-participant-shell.html`
- **用途**: 参加者へのメール送信用テンプレート
- **Google Apps Script 構文**: テンプレート内で Google Apps Script 構文を使用可能
- **メール内容**: 質問フォームへのアクセス URL、イベント情報、ガイダンスなど

### 9.6 CSV 処理機能

- **CSV インポート**: 参加者データの一括登録
- **CSV エクスポート**: 参加者リストのエクスポート
- **チーム割り当て**: CSV からのチーム割り当てデータの読み込み

### 9.7 印刷機能

- **参加者リスト印刷**: 参加者情報の印刷プレビュー
- **スタッフ用リスト印刷**: スタッフ向けの情報表示
- **印刷設定**: 用紙サイズ、余白、表示項目のカスタマイズ

---

## 10. モジュール設計原則

### 10.1 責務の分離

- 各モジュールは明確な責務を持つ
- 関連する機能は適切にグループ化
- Manager パターンを使用した機能の管理（例: `EventAuthManager`, `EventStateManager`）

### 10.2 依存関係管理

- 共有モジュールは他のモジュールに依存しない
- 機能固有モジュールは共有モジュールに依存可能
- 依存関係は一方向に保つ

### 10.3 Manager パターン

主要な機能は Manager クラスとして実装されます：

- **認証管理**: `EventAuthManager`, `OperatorAuthManager`
- **状態管理**: `EventStateManager`
- **UI 描画**: `EventUIRenderer`, `UIRenderer`
- **Firebase 操作**: `EventFirebaseManager`
- **ナビゲーション**: `EventNavigationManager`
- **ディスプレイロック**: `DisplayLockManager`

---

## 11. アクセシビリティ

### 11.1 基本的なアクセシビリティ対応

- **ARIA 属性**: 必要に応じて `aria-label`, `aria-labelledby`, `aria-hidden`, `aria-live` などを使用
- **キーボード操作**: 主要な操作はキーボードでアクセス可能
- **フォーカス管理**: 適切なフォーカス管理を実装
- **スクリーンリーダー対応**: 意味のあるテキストラベルと説明を提供

### 11.2 実装例

- アイコンのみのボタンには `aria-label` を設定
- フォーム要素には適切な `label` 要素を関連付け
- 動的に更新されるコンテンツには `aria-live` を設定
- モーダルダイアログでは適切な `role` 属性を設定

---

## 12. パフォーマンス

### 12.1 最適化方針

- **フォント読み込み**: `font-display: swap` を使用してフォント読み込みを最適化
- **モジュール分割**: ES Modules によるモジュール分割と必要な部分のみの読み込み
- **Firebase 最適化**: 必要なデータのみを購読し、不要な購読は適切に解除
- **アニメーション**: `prefers-reduced-motion` メディアクエリに対応

### 12.2 パフォーマンス対策

- **リアルタイム同期**: Firebase Realtime Database の購読を最適化
- **デバウンス/スロットル**: 頻繁な更新が必要な操作に適切に適用
- **レイジーローディング**: 必要に応じてデータの遅延読み込みを実装

---

## 13. 参考ドキュメント

### 主要ドキュメント

- `docs/development-standards.md`: 開発標準（命名規則、コーディングスタイル、モジュール設計など）
- `docs/firebase-data-structure.md`: Firebase データ構造の詳細
- `docs/firebase.rules.json`: Firebase Security Rules 定義

### 認証・認可関連

- `docs/login-to-loader-flow.md`: ログインからローダー起動までのフロー
- `docs/operator-shared-storage-and-fallback.md`: 共有ストレージとフォールバック処理の説明
- `docs/auth-preflight-testing.md`: 認証プリフライト機能のテスト計画
- `docs/api-client.md`: API Client の実装概要

### その他の技術ドキュメント

- `docs/submission-permission-cause.md`: 質問フォーム送信権限の問題と原因
- `docs/print-preview-notes.md`: 印刷プレビュー機能のメモ

---

## 改訂履歴

| 日付       | バージョン | 変更内容 | 作成者 |
| ---------- | ---------- | -------- | ------ |
| 2025-12-13 | 1.0        | 初版作成 | -      |
