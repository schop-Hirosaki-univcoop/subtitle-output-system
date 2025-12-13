# 基本設計書

## 1. システム構成

### 1.1 アーキテクチャ概要

本システムは、Firebase Realtime Database をバックエンドとして使用する、クライアントサイドレンダリング型の Web アプリケーションです。

```
┌─────────────────┐
│   参加者        │
│ (質問投稿)      │
└────────┬────────┘
         │
┌────────▼────────────────────────────────────────┐
│         Firebase Realtime Database              │
│  ┌──────────────────────────────────────────┐  │
│  │  questions/normal, questions/pickup      │  │
│  │  questionIntake/events, schedules        │  │
│  │  questionIntake/participants, tokens     │  │
│  │  render/events/{eventId}/{scheduleId}    │  │
│  │  glIntake/events, applications           │  │
│  └──────────────────────────────────────────┘  │
└────────┬────────────────────────────────────────┘
         │
    ┌────┴────┬──────────────┬────────────┐
    │         │              │            │
┌───▼───┐ ┌──▼──────┐  ┌───▼────┐  ┌───▼─────┐
│参加者 │ │オペレ   │  │ディス  │  │Google   │
│フォーム│ │ーター   │  │プレイ  │  │Apps     │
│       │ │画面     │  │        │  │Script   │
└───────┘ └─────────┘  └────────┘  └─────────┘
```

### 1.2 技術スタック

#### フロントエンド

- **言語**: JavaScript (ES6+)
- **フレームワーク**: バニラ JavaScript（モジュール化）
- **スタイリング**: CSS3
- **ビルドツール**: なし（ネイティブ ES Modules）

#### バックエンド

- **データベース**: Firebase Realtime Database
- **認証**: Firebase Authentication (OAuth, Anonymous)
- **メール送信**: Google Apps Script (GAS)

#### ホスティング

- **静的ホスティング**: Firebase Hosting（推測）
- **カスタムドメイン対応**: 可能

### 1.3 ディレクトリ構造

```
/
├── index.html              # トップページ（アクセス案内）
├── login.html              # ログインページ
├── operator.html           # オペレーター管理画面
├── question-form.html      # 質問投稿フォーム
├── display.html            # テロップ表示画面
├── gl-form.html            # GL応募フォーム
├── participant-mail-view.html # メール閲覧ページ
├── scripts/                # JavaScriptモジュール
│   ├── shared/            # 共通モジュール
│   │   ├── firebase-config.js
│   │   ├── layout.js
│   │   ├── auth-transfer.js
│   │   └── ...
│   ├── login.js
│   ├── operator/          # オペレーター機能
│   ├── question-form/     # 質問フォーム機能
│   ├── question-admin/    # 質問管理機能
│   └── events/            # イベント管理機能
├── style.css              # 共通スタイル
├── question-form.css      # 質問フォーム専用スタイル
├── assets/                # 静的リソース
│   ├── fonts/            # フォントファイル
│   └── favicon.svg
├── firebase.rules.json    # Firebase Security Rules
└── code.gs                # Google Apps Script（メール送信など）
```

## 2. データベース設計

### 2.1 Firebase Realtime Database 構造

#### 2.1.1 質問関連データ

```
questions/
├── normal/
│   └── {uid}/
│       ├── uid: string
│       ├── token: string
│       ├── name: string          # ラジオネーム
│       ├── question: string      # 質問本文
│       ├── genre: string         # ジャンル
│       ├── ts: number            # タイムスタンプ
│       ├── updatedAt: number
│       ├── type: "normal"
│       └── questionLength: number
└── pickup/
    └── {uid}/
        ├── uid: string
        ├── name: string
        ├── question: string
        ├── genre: string
        ├── pickup: boolean
        ├── type: "pickup"
        ├── ts: number
        └── updatedAt: number
```

#### 2.1.2 質問受付関連データ

```
questionIntake/
├── events/
│   └── {eventId}/
│       ├── name: string
│       ├── createdAt: number
│       └── updatedAt: number
├── schedules/
│   └── {eventId}/
│       └── {scheduleId}/
│           ├── label: string
│           ├── date: string
│           ├── location: string
│           ├── startAt: string
│           ├── endAt: string
│           ├── participantCount: number
│           ├── createdAt: number
│           └── updatedAt: number
├── participants/
│   └── {eventId}/
│       └── {scheduleId}/
│           └── {participantId}/
│               ├── participantId: string
│               ├── name: string
│               ├── email: string
│               ├── phone: string
│               ├── groupNumber: string
│               ├── token: string
│               ├── guidance: string
│               └── ...
├── tokens/
│   └── {token}/
│       ├── eventId: string
│       ├── scheduleId: string
│       ├── participantId: string
│       ├── groupNumber: string
│       ├── expiresAt: number
│       ├── revoked: boolean
│       └── ...
├── submissions/
│   └── {token}/
│       └── {submissionId}/
│           ├── token: string
│           ├── radioName: string
│           ├── question: string
│           ├── questionLength: number
│           ├── genre: string
│           ├── submittedAt: number
│           └── ...
└── submissionErrors/
    └── [任意のデータ構造]
```

#### 2.1.3 表示制御関連データ

```
render/
├── events/
│   └── {eventId}/
│       ├── sessions/
│       │   └── {uid}/
│       │       ├── uid: string
│       │       ├── sessionId: string
│       │       ├── status: "active" | "expired" | "ended"
│       │       ├── eventId: string
│       │       ├── scheduleId: string
│       │       ├── assignment: {
│       │       │     eventId: string
│       │       │     scheduleId: string
│       │       │   }
│       │       └── ...
│       └── {scheduleId}/
│           ├── state/
│           │   ├── phase: "visible" | "hidden" | "showing" | "hiding" | "error"
│           │   ├── nowShowing: {
│           │   │     uid: string
│           │   │   }
│           │   └── updatedAt: number
│           ├── nowShowing/
│           │   ├── uid: string
│           │   └── ...
│           └── sideTelops/
│               └── right/
│                   ├── items: string[]
│                   └── activeIndex: number
└── displayPresence/
    └── {uid}/
        ├── uid: string
        ├── sessionId: string
        ├── eventId: string
        ├── scheduleId: string
        ├── status: "active" | "pending"
        └── ...
```

#### 2.1.4 GL 応募関連データ

```
glIntake/
├── events/
│   └── {eventId}/
│       ├── eventId: string
│       ├── slug: string
│       ├── faculties: [...]
│       ├── teams: string[]
│       ├── schedules: {...}
│       └── ...
└── applications/
    └── {eventId}/
        └── {applicationId}/
            ├── name: string
            ├── email: string
            ├── faculty: string
            ├── department: string
            ├── shifts: { [scheduleId]: boolean }
            ├── eventId: string
            ├── slug: string
            └── ...
```

#### 2.1.5 その他のデータ

```
questionStatus/
└── {eventId}/
    └── {uid}/
        ├── answered: boolean
        ├── selecting: boolean
        └── updatedAt: number

dictionary/
└── {index}/
    ├── term: string
    ├── ruby: string
    └── enabled: boolean

logs/
└── history/
    └── {logId}/
        ├── timestamp: number
        ├── User: string
        ├── Action: string
        ├── Details: string
        └── ...

admins/
└── {uid}: true

operatorPresence/
└── {eventId}/
    └── {sessionId}/
        ├── uid: string
        ├── eventId: string
        ├── scheduleId: string
        └── ...

operatorPresenceConsensus/
└── {eventId}/
    ├── conflictSignature: string
    ├── scheduleKey: string
    ├── scheduleId: string
    ├── scheduleLabel: string
    ├── scheduleRange: string
    ├── status: "pending" | "resolved"
    ├── requestedByUid: string
    ├── requestedByDisplayName: string
    ├── requestedBySessionId: string
    ├── requestedAt: number
    ├── resolvedByUid: string
    ├── resolvedByDisplayName: string
    ├── resolvedBySessionId: string
    ├── resolvedAt: number
    └── updatedAt: number

signals/
└── {signal}/
    └── [任意のデータ構造]

operatorChat/
├── messages/
│   └── {messageId}/
│       ├── uid: string
│       ├── displayName: string
│       ├── email: string
│       ├── message: string
│       ├── timestamp: number
│       └── replyTo: {
│             id: string
│             message: string
│             author: string
│           }
└── reads/
    └── {uid}/
        ├── lastReadMessageId: string
        ├── lastReadMessageTimestamp: number
        └── updatedAt: number
```

### 2.2 データ正規化

- **質問データ**: `questions/normal/{uid}` と `questions/pickup/{uid}` で分離
- **表示データ**: `render/events/{eventId}/{scheduleId}/nowShowing` には `uid` のみ保存し、実際の質問内容は `questions` から参照
- **参加者データ**: `questionIntake/participants/{eventId}/{scheduleId}/{participantId}` で階層管理
- **トークン**: `questionIntake/tokens/{token}` で一元管理

## 3. 認証・認可設計

### 3.1 認証方式

#### 3.1.1 オペレーター認証

- **方式**: Firebase Authentication + Google OAuth
- **フロー**:
  1. `login.html` で Google アカウントでログイン
  2. 管理者権限の確認（プリフライト認証）
  3. 認証情報を `sessionStorage` に保存（画面間引き継ぎ）
  4. `operator.html` で認証情報を復元

#### 3.1.2 ディスプレイ認証

- **方式**: Firebase Authentication Anonymous
- **フロー**:
  1. `display.html` で匿名認証
  2. セッションを作成（`render/events/{eventId}/sessions/{uid}`）
  3. ハートビートでセッション維持（20 秒間隔）

#### 3.1.3 参加者アクセス

- **方式**: トークンベース認証
- **フロー**:
  1. オペレーターが参加者にトークンを発行
  2. トークンを含む URL をメール送信
  3. 参加者が URL からアクセス
  4. トークンの有効性をチェックしてフォーム表示

### 3.2 認可設計

#### 3.2.1 Firebase Security Rules

- **質問投稿**: トークンが有効な場合のみ書き込み可能
- **オペレーター操作**: `admins/{uid}` が `true` の場合のみ書き込み可能
- **ディスプレイ操作**: 匿名認証 + `screens/approved/{uid}` が `true` の場合のみ書き込み可能
- **質問データ読み取り**: 認証済みユーザーは読み取り可能

## 4. モジュール設計

### 4.1 共通モジュール（scripts/shared/）

#### 4.1.1 firebase-config.js

- Firebase 設定の一元管理

#### 4.1.2 layout.js

- 共通レイアウトコンポーネント（header, footer）の管理

#### 4.1.3 auth-transfer.js

- 認証情報の画面間引き継ぎ（sessionStorage 使用）

#### 4.1.4 channel-paths.js

- Firebase パスの生成・解析

### 4.2 質問フォームモジュール（scripts/question-form/）

#### 4.2.1 app.js

- アプリケーション初期化

#### 4.2.2 submission-service.js

- 質問投稿処理

#### 4.2.3 context-service.js

- コンテキスト情報（イベント・日程情報）の管理

### 4.3 オペレーターモジュール（scripts/operator/）

#### 4.3.1 app.js

- オペレーター画面の初期化

#### 4.3.2 panels/

- 各パネル（質問管理、参加者管理など）の実装

#### 4.3.3 display.js

- テロップ操作機能

### 4.4 イベント管理モジュール（scripts/events/）

#### 4.4.1 app.js

- イベント管理画面の初期化

#### 4.4.2 managers/

- 各種マネージャー（認証、Firebase、状態管理など）

#### 4.4.3 panels/

- 各パネル（イベント、日程、参加者、GL など）の実装

### 4.5 テロップ表示モジュール（display.html 内）

- Firebase Realtime Database の `render/events/{eventId}/{scheduleId}/nowShowing` を監視
- 質問データを `questions/normal/{uid}` または `questions/pickup/{uid}` から取得
- ルビ辞書（`dictionary`）を適用して表示
- FLIP アニメーションによるスムーズな切り替え

## 5. ユーザーインターフェース設計

### 5.1 デザイン原則

- **ダークテーマ**: オペレーター画面・テロップ表示はダークテーマ
- **レスポンシブデザイン**: モバイル・デスクトップ対応
- **アクセシビリティ**: ARIA 属性の適切な使用
- **アニメーション**: CSS transitions/animations による滑らかな動作

### 5.2 コンポーネント設計

#### 5.2.1 共通コンポーネント

- `<telop-header>`: ヘッダー
- `<telop-footer>`: フッター
- `<module>`: モジュールコンテナ
- `<btn>`: ボタン

#### 5.2.2 フォームコンポーネント

- `<input>`: 入力フィールド
- `<textarea>`: テキストエリア
- `<select>`: セレクトボックス
- バリデーションメッセージ表示

## 6. 通信設計

### 6.1 Firebase Realtime Database

- **リアルタイム同期**: `onValue()` によるリアルタイムデータ監視
- **書き込み**: `set()`, `update()`, `remove()` によるデータ操作
- **トランザクション**: 必要な場合のみ使用

### 6.2 Google Apps Script (GAS)

- **エンドポイント**: HTTPS POST
- **認証**: ID Token による認証
- **CORS 対応**: 適切な CORS ヘッダー設定
- **アクション**: `doPost()` で `action` パラメータにより振り分け
- **スプレッドシート連携**: Google スプレッドシートへの読み書き機能
  - `users` シート: 許可ユーザーリストの管理
  - `backups` シート: データバックアップの記録
  - `mail_logs` シート: メール送信ログの記録

#### 主要アクション

- `submitQuestion`: 質問投稿（非認証）
- `processQuestionQueue`: 質問キュー処理
- `processQuestionQueueForToken`: トークン単位のキュー処理（非認証）
- `sendParticipantMail`: 参加者向けメール送信
- `beginDisplaySession`, `heartbeatDisplaySession`, `endDisplaySession`: ディスプレイセッション管理（匿名認証可）
- `ensureAdmin`: 管理者権限の確認
- `resolveParticipantMail`: 参加者メール閲覧用リンクの解決（非認証）
- `fetchSheet`: スプレッドシートデータの取得
- `lockDisplaySchedule`: ディスプレイの日程ロック
- `saveScheduleRotation`, `clearScheduleRotation`: スケジュールローテーション管理
- `clearSelectingStatus`: 選択中ステータスの一括クリア
- `logAction`: 操作ログの記録
- `backupRealtimeDatabase`, `restoreRealtimeDatabase`: データバックアップ・復元
- `migrateLegacyPaths`: レガシーパスの移行
- `whoami`: デバッグ用（現在の認証情報を返す）

## 7. エラーハンドリング

### 7.1 クライアント側エラーハンドリング

- ネットワークエラー: リトライロジック
- 認証エラー: ログイン画面へのリダイレクト
- バリデーションエラー: ユーザーフレンドリーなメッセージ表示

### 7.2 サーバー側エラーハンドリング

- GAS 側: JSON 形式のエラーレスポンス
- Firebase Rules: 適切なエラーメッセージ

## 8. セキュリティ設計

### 8.1 認証・認可

- Firebase Authentication による厳格な認証
- Firebase Security Rules によるデータアクセス制御
- トークンベースの一時アクセス制御

### 8.2 データ保護

- 機密情報（メールアドレス、電話番号）の適切な管理
- トークンの有効期限管理
- トークンの取り消し機能

### 8.3 XSS 対策

- ユーザー入力の適切なエスケープ
- HTML サニタイゼーション

## 9. パフォーマンス最適化

### 9.1 データ取得最適化

- 必要なデータのみを取得（パス指定）
- インデックスの適切な設定（`.indexOn`）

### 9.2 表示最適化

- FLIP アニメーションによる効率的な DOM 操作
- フォントのプリロード
- 低負荷モード（`?lowgpu=1`）の提供

### 9.3 ネットワーク最適化

- 不要なデータ監視の解除
- ハートビート間隔の最適化（20 秒）

## 10. ログ・監視

### 10.1 ログ機能

- オペレーター操作の記録（`logs/history`）
- エラーログの記録
- メール送信ログ（GAS 側）

### 10.2 監視

- ディスプレイセッションの監視（`displayPresence`）
- オペレーターセッションの監視（`operatorPresence`）
- オペレーターチャットの既読状態の監視（`operatorChat/reads`）

## 11. その他の機能設計

### 11.1 印刷機能

- **印刷プレビュー**: DOM/CSS ベースの印刷プレビュー表示
- **印刷設定**: 用紙サイズ、向き、余白の設定
- **印刷データ生成**: 参加者リスト、スタッフリストの HTML 生成
- **印刷実行**: ブラウザの印刷機能を使用

### 11.2 バックアップ・復元

- **バックアップ**: Firebase Realtime Database 全体の JSON 形式でのバックアップ
- **復元**: バックアップデータからの復元処理
- **実行場所**: Google Apps Script から実行

### 11.3 スケジュールローテーション

- **ローテーション設定**: 複数日程の表示順序と表示時間の設定
- **自動ローテーション**: 設定に基づいた自動的な日程切り替え
- **データ保存**: `render/events/{eventId}/rotation` に保存

### 11.4 メールテンプレート設計

- **テンプレートファイル**: `email-participant-body.html`（本文）、`email-participant-shell.html`（外枠）
- **テンプレート構文**: Google Apps Script の HTML サービス構文を使用（`<?= variable ?>`、`<? if (condition) { ?> ... <? } ?>`）
- **モード**: `email`（メール送信用）と `web`（Web 表示プレビュー用）をサポート
- **キャッシュ**: テンプレートマークアップは Google Apps Script の ScriptCache にキャッシュ
- **変数展開**: コンテキストオブジェクトから動的に値を展開
- **プレースホルダー**: `{{key}}` 形式のプレースホルダーを走査して置換
- **エスケープ**: HTML エスケープを適切に実施

### 11.5 Google スプレッドシート連携

- **users シート**: 許可ユーザーリスト（管理者権限の確認に使用）
- **backups シート**: Firebase Realtime Database のバックアップデータの記録
- **mail_logs シート**: メール送信ログの記録
- **取得方法**: `fetchSheet` API アクションを通じて取得
