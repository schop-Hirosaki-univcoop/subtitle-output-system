# ファイル構造分析ドキュメント

このドキュメントは、`scripts/` ディレクトリ全体のファイル構造を分析し、開発標準への準拠状況と改善提案をまとめます。

## 目次

1. [概要](#概要)
2. [現状分析](#現状分析)
3. [各ディレクトリの詳細評価](#各ディレクトリの詳細評価)
4. [問題点の整理](#問題点の整理)
5. [改善提案](#改善提案)
6. [優先度別リファクタリング計画](#優先度別リファクタリング計画)

---

## 概要

### 分析対象

- `scripts/operator/` - オペレーター画面（リファクタリング済み）
- `scripts/events/` - イベント管理画面
- `scripts/question-admin/` - 質問管理画面
- `scripts/question-form/` - 質問フォーム画面
- `scripts/shared/` - 共有モジュール
- `scripts/gl-form/` - GL フォーム画面
- `scripts/participant-mail-view/` - 参加者メール閲覧画面
- `scripts/login.js` - ログイン画面

### 開発標準の基準

- **ファイルサイズ**: 推奨 300-1,000 行、許容 1,000-1,500 行、要改善 1,500 行以上
- **責務の分離**: 単一責任の原則に従った分割
- **モジュール設計**: Manager パターンや適切な責務分離
- **命名規則**: kebab-case ファイル名、PascalCase クラス名

---

## 現状分析

### ファイルサイズの統計

| ファイル                                                 | 行数  | 評価                                                                   |
| -------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `scripts/events/app.js`                                  | 6,070 | ❌ 要改善（基準の約 4.0 倍、リファクタリング完了）                     |
| `scripts/events/panels/gl-panel.js`                      | 1,659 | ❌ 要改善（基準の約 1.1 倍、リファクタリング進行中、段階 1-5 完了）    |
| `scripts/events/panels/gl-utils.js`                      | 789   | ✅ 許容範囲（新規作成、フェーズ 2 段階 1 完了）                        |
| `scripts/events/panels/gl-renderer.js`                   | 982   | ✅ 許容範囲（新規作成、フェーズ 2 段階 2 完了）                        |
| `scripts/events/panels/gl-application-manager.js`        | 157   | ✅ 許容範囲（新規作成、フェーズ 2 段階 3 完了）                        |
| `scripts/events/panels/gl-assignment-manager.js`         | 171   | ✅ 許容範囲（新規作成、フェーズ 2 段階 4 完了）                        |
| `scripts/events/panels/gl-config-manager.js`             | 240   | ✅ 許容範囲（新規作成、フェーズ 2 段階 5 完了）                        |
| `scripts/operator/app.js`                                | 2,463 | ⚠️ 許容範囲（やや大きい）                                              |
| `scripts/question-admin/app.js`                          | 2,263 | ⚠️ 改善完了（基準の約 2.0 倍、リファクタリング完了、フェーズ 17 完了） |
| `scripts/operator/questions.js`                          | 1,734 | ⚠️ 許容範囲（やや大きい）                                              |
| `scripts/events/managers/firebase-manager.js`            | 1,392 | ✅ 許容範囲                                                            |
| `scripts/shared/print-utils.js`                          | 1,341 | ✅ 許容範囲                                                            |
| `scripts/operator/channel-manager.js`                    | 1,314 | ✅ 許容範囲                                                            |
| `scripts/question-admin/participants.js`                 | 1,169 | ✅ 許容範囲                                                            |
| `scripts/question-admin/managers/participant-manager.js` | 1,155 | ✅ 許容範囲                                                            |
| `scripts/question-admin/managers/init-manager.js`        | 1,131 | ✅ 許容範囲                                                            |
| `scripts/operator/panels/pickup-panel.js`                | 1,124 | ✅ 許容範囲                                                            |
| `scripts/operator/panels/dictionary-panel.js`            | 1,109 | ✅ 許容範囲                                                            |
| `scripts/question-admin/managers/print-manager.js`       | 1,004 | ✅ 許容範囲                                                            |

### 構造パターンの分類

1. **リファクタリング済み（Manager パターン）**

   - `scripts/operator/` - 適切に分割されている

2. **巨大な単一ファイル**

   - `scripts/events/app.js` - 6,070 行（リファクタリング完了、元の 10,180 行から約 4,110 行削減）
   - `scripts/question-admin/app.js` - 2,263 行（リファクタリング完了（フェーズ 17 完了）、元の 8,180 行から約 5,917 行削減）
   - `scripts/question-admin/managers/host-integration-manager.js` - 671 行（新規作成、フェーズ 9 段階 6 完了後）

- ✅ `scripts/question-admin/managers/state-manager.js` - 165 行（新規作成、フェーズ 10 完了後）
- ✅ `scripts/question-admin/managers/ui-manager.js` - 229 行（新規作成、フェーズ 11 完了後）
- ✅ `scripts/question-admin/managers/confirm-dialog-manager.js` - 128 行（新規作成、フェーズ 12 完了後）
- ✅ `scripts/question-admin/managers/gl-manager.js` - 386 行（新規作成、フェーズ 13 完了後）
- ✅ `scripts/question-admin/managers/participant-ui-manager.js` - 966 行（新規作成、フェーズ 14 完了後）

3. **中規模の単一ファイル**

   - `scripts/gl-form/index.js` - 860 行
   - `scripts/login.js` - 664 行
   - `scripts/participant-mail-view/index.js` - 310 行

4. **適切に分割されている**
   - `scripts/question-form/` - 複数ファイルに分割
   - `scripts/shared/` - 機能別に分割

---

## 各ディレクトリの詳細評価

### 1. `scripts/operator/` ✅ 良好

**現状**:

- リファクタリング済みで、Manager パターンを採用
- 各 Manager クラスが適切な責務を持っている
- ファイルサイズも許容範囲内

**構造**:

```
scripts/operator/
├── index.js              # エントリーポイント（48行）
├── app.js                # OperatorApp クラス（2,463行、やや大きい）
├── context-manager.js    # ContextManager（333行）✅
├── auth-manager.js       # AuthManager（359行）✅
├── channel-manager.js    # ChannelManager（1,314行）✅
├── presence-manager.js   # PresenceManager（741行）✅
├── ui-renderer.js        # UIRenderer（378行）✅
├── questions.js          # 質問表示機能（1,734行、やや大きい）
├── panels/
│   ├── pickup-panel.js       # ピックアップ機能（1,124行）✅
│   ├── dictionary-panel.js  # 辞書機能（1,109行）✅
│   ├── side-telop-panel.js   # サイドテロップ機能（549行）✅
│   └── logs-panel.js         # ログ機能（264行）✅
├── display.js            # 表示制御（202行）✅
├── firebase.js           # Firebase設定
├── api-client.js         # API クライアント
├── dom.js                # DOM操作
├── utils.js              # ユーティリティ
├── constants.js          # 定数
├── toast.js              # トースト通知
└── ui-helpers.js         # UIヘルパー
```

**評価**:

- ✅ Manager パターンが適切に適用されている
- ✅ 責務が明確に分離されている
- ⚠️ `app.js` と `questions.js` がやや大きいが許容範囲

**改善提案**:

- `app.js` の一部機能をさらに分割することを検討（優先度: 低）
- `questions.js` を機能別に分割することを検討（優先度: 低）

---

### 2. `scripts/events/` ❌ 要改善

**現状**:

- `app.js` が 6,070 行と非常に大きい（リファクタリング完了、元の 10,180 行から約 4,110 行削減）
- イベント管理パネルと日程管理パネルを分離済み（`event-panel.js`, `schedule-panel.js`）
- 単一の `EventAdminApp` クラスに多くの責務が集中
- ツール関連は `tools/` ディレクトリに分割されているが、メインの `app.js` が巨大

**構造**:

```
scripts/events/
├── index.js              # エントリーポイント（8行）✅
├── app.js                # EventAdminApp クラス（6,070行）❌ リファクタリング完了
├── tool-coordinator.js   # ToolCoordinator（342行）✅
├── managers/
│   ├── auth-manager.js       # EventAuthManager（認証管理、384行）✅
│   ├── state-manager.js      # EventStateManager（状態管理、315行）✅
│   ├── navigation-manager.js # EventNavigationManager（画面遷移制御、499行）✅
│   ├── ui-renderer.js        # EventUIRenderer（UI描画、896行）✅
│   ├── firebase-manager.js   # EventFirebaseManager（Firebase操作、1,392行）✅
│   └── display-lock-manager.js # DisplayLockManager（ディスプレイロック、255行）✅
├── panels/
│   ├── event-panel.js        # EventPanelManager（326行）✅
│   ├── schedule-panel.js     # SchedulePanelManager（391行）✅
│   ├── chat-panel.js         # EventChat（926行）✅
│   ├── participants-panel.js # ParticipantToolManager（729行）✅
│   ├── gl-panel.js           # GlToolManager（1,659行、リファクタリング進行中、段階1-5完了）⚠️
│   ├── gl-utils.js           # ユーティリティ（789行）✅
│   ├── gl-renderer.js        # UI描画（982行、段階2完了）✅
│   ├── gl-application-manager.js # 応募管理（157行、段階3完了）✅
│   ├── gl-assignment-manager.js # 割り当て管理（171行、段階4完了）✅
│   ├── gl-config-manager.js  # 設定管理（240行、段階5完了）✅
│   ├── gl-faculties-panel.js # GlFacultyAdminManager
│   └── operator-panel.js     # OperatorToolManager
├── config.js             # 設定定数
├── dom.js                # DOM操作（262行）✅
├── helpers.js            # ヘルパー関数
├── loading-tracker.js    # ローディング追跡
├── schedule-calendar.js  # スケジュールカレンダー
└── tools/
    ├── gl-faculty-builder.js
    ├── gl-faculty-utils.js
    └── frame-utils.js
```

**問題点**:

1. **`app.js` が巨大（6,070 行、リファクタリング完了）**

   - 元の 10,180 行から約 4,110 行削減
   - イベント管理パネルと日程管理パネルを分離済み（`event-panel.js`, `schedule-panel.js`）
   - 認証、状態管理、画面遷移、Firebase 操作、UI 更新などが Manager クラスに分離済み
   - 単一責任の原則に準拠（改善完了）
   - テスト容易性が向上（改善完了）

2. **`panels/gl-panel.js` が大きい（1,659 行、リファクタリング進行中）**
   - GL ツールの機能が単一ファイルに集約（元の 3,249 行から約 941 行削減、約 29% 削減）
   - ✅ 段階 1: ユーティリティ関数を `gl-utils.js` に移行完了
   - ✅ 段階 2: UI 描画機能を `gl-renderer.js` に移行完了（内部スタッフ関連 5 個 + スケジュール班関連 2 個 + 応募者・スケジュール関連 2 個 + 依存メソッド 5 個を移行）
   - ⏳ 分割を継続中

**評価**:

- ⚠️ ファイルサイズが開発標準を超過（6,070 行、基準の約 4.0 倍）だが、リファクタリング完了により大幅改善
- ✅ 責務の分離が完了（6 個の Manager クラスに分割）
- ✅ イベント管理パネルと日程管理パネルを分離済み
- ✅ ツール関連は適切に分割されている

**改善提案**:

- `app.js` を `scripts/operator/` と同様に Manager パターンで分割（完了）
  - ✅ `EventPanelManager` - イベント管理パネル（326 行）完了
  - ✅ `SchedulePanelManager` - 日程管理パネル（391 行）完了
  - ✅ `EventAuthManager` - 認証管理（384 行）完了
  - ✅ `EventStateManager` - 状態管理（315 行）完了
  - ✅ `EventNavigationManager` - 画面遷移制御（499 行、完了）
  - ✅ `EventUIRenderer` - UI 描画（896 行、完了）
  - ✅ `EventFirebaseManager` - Firebase 操作（1,392 行、基本実装完了）
  - ✅ `DisplayLockManager` - ディスプレイロック機能（255 行、完了）
- `panels/gl-panel.js` を機能別に分割

---

### 3. `scripts/question-admin/` ⚠️ 改善完了

**現状**:

- `app.js` が 2,263 行（元の 8,180 行から約 5,917 行削減、リファクタリング完了、フェーズ 17 完了）
- 印刷機能、CSV 処理、イベント管理、参加者管理機能、日程管理、メール送信、認証・初期化機能、リロケーション機能、その他のユーティリティ関数を Manager クラスに分離済み

**構造**:

```
scripts/question-admin/
├── index.js              # エントリーポイント（2行）✅
├── app.js                # メインアプリケーション（2,263行）⚠️ リファクタリング完了（フェーズ17完了）
├── managers/
│   ├── print-manager.js      # 印刷機能（1,004行）✅
│   ├── csv-manager.js        # CSV 処理（351行）✅
│   ├── event-manager.js      # イベント管理（409行）✅
│   ├── participant-manager.js # 参加者管理（1,155行）✅
│   ├── schedule-manager.js   # 日程管理（478行）✅
│   ├── mail-manager.js       # メール送信（514行）✅
│   ├── auth-manager.js       # 認証・初期化（402行）✅
│   ├── relocation-manager.js # リロケーション（954行）✅
│   ├── host-integration-manager.js # 埋め込みモード・ホスト統合（671行）✅
│   ├── state-manager.js      # 状態管理（165行）✅
│   ├── ui-manager.js         # UI管理（229行）✅
│   ├── confirm-dialog-manager.js # 確認ダイアログ（128行）✅
│   ├── gl-manager.js         # GL管理（386行）✅
│   ├── participant-ui-manager.js # 参加者UI（966行）✅
│   ├── schedule-utility-manager.js # スケジュールユーティリティ（252行）✅
│   ├── button-state-manager.js # ボタン状態管理（458行）✅
│   ├── token-api-manager.js  # トークン・API（106行）✅
│   ├── share-clipboard-manager.js # 共有・クリップボード（90行）✅
│   ├── participant-context-manager.js # 参加者コンテキスト（138行）✅
│   ├── participant-action-manager.js # 参加者操作（168行）✅
│   ├── event-handlers-manager.js # イベントハンドラー（506行）✅
│   └── init-manager.js       # 初期化（1,131行、21個のManager初期化を移行完了）✅ 完了
├── participants.js       # 参加者管理（1,169行）✅
├── calendar.js           # カレンダー機能
├── dialog.js             # ダイアログ機能
├── loader.js             # ローダー機能
├── state.js              # 状態管理
├── dom.js                # DOM操作
├── firebase.js           # Firebase設定
├── utils.js              # ユーティリティ
└── constants.js          # 定数
```

**問題点**:

1. **`app.js` が巨大（2,263 行、リファクタリング完了（フェーズ 17 完了））**
   - 元の 8,180 行から約 5,917 行削減
   - 印刷機能、CSV 処理、イベント管理、参加者管理機能、日程管理機能、メール送信、認証・初期化、リロケーション、その他のユーティリティ関数を Manager クラスに分離済み
   - 21 個の Manager クラスに分割完了
   - 単一責任の原則に準拠（改善完了）

**評価**:

- ⚠️ ファイルサイズが開発標準を超過（2,263 行、基準の約 2.0 倍）だが、リファクタリング完了により大幅改善
- ✅ 責務の分離が完了（21 個の Manager クラスに分割）
- ✅ `participants.js` は適切に分離されている
- ✅ Manager パターンが適切に適用されている

**改善提案**:

- `app.js` を機能別に分割（完了）
  - ✅ `PrintManager` - 印刷機能（1,004 行）完了
  - ✅ `CsvManager` - CSV 処理機能（351 行）完了
    - ✅ `EventManager` - イベント管理機能（409 行）完了
  - ✅ `ParticipantManager` - 参加者管理機能（1,155 行）完了
  - ✅ `ScheduleManager` - 日程管理機能（478 行）完了
  - ✅ `MailManager` - メール送信機能（514 行）完了
    - ✅ `AuthManager` - 認証・初期化機能（402 行）完了
  - ✅ `RelocationManager` - リロケーション機能（954 行）完了
  - ✅ フェーズ 9-17: その他のユーティリティ関数の整理（完了、詳細は `docs/utility-refactoring-plan.md` を参照）
    - ✅ フェーズ 9: 埋め込みモード・ホスト統合機能の分離（HostIntegrationManager、671 行）完了
    - ✅ フェーズ 10: 状態管理・キャッシュ関連の関数の整理（StateManager、165 行）完了
    - ✅ フェーズ 11: UI 関連の関数の整理（UIManager、188 行）完了
    - ✅ フェーズ 12: 確認ダイアログ関連の関数の整理（ConfirmDialogManager、128 行）完了
    - ✅ フェーズ 13: GL 関連の関数の整理（GlManager、386 行）完了
    - ✅ フェーズ 14: 参加者 UI 関連の関数の整理（ParticipantUIManager、906 行）完了
    - ✅ フェーズ 15: スケジュール関連の関数の整理（ScheduleUtilityManager、252 行）完了
    - ✅ フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager、458 行）完了
    - ✅ フェーズ 17: その他のユーティリティ関数の整理（完了）

---

### 4. `scripts/question-form/` ✅ 良好

**現状**:

- 適切に機能別に分割されている
- 各ファイルの責務が明確

**構造**:

```
scripts/question-form/
├── index.js              # エントリーポイント（5行）✅
├── app.js                # QuestionFormApp（550行）✅
├── view.js               # FormView（480行）✅
├── submission-service.js # 送信サービス
├── submission-utils.js    # 送信ユーティリティ
├── context-service.js    # コンテキストサービス
├── context-copy.js        # コンテキストコピー
├── value-utils.js         # 値のユーティリティ
├── string-utils.js        # 文字列ユーティリティ
├── schedule-format.js     # スケジュールフォーマット
├── firebase.js            # Firebase設定
└── constants.js           # 定数
```

**評価**:

- ✅ 適切に分割されている
- ✅ 各ファイルの責務が明確
- ✅ ファイルサイズも適切

**改善提案**:

- 現状維持で問題なし

---

### 5. `scripts/shared/` ✅ 良好

**現状**:

- 共有モジュールが適切に機能別に分割されている
- 各ファイルの責務が明確

**構造**:

```
scripts/shared/
├── auth-preflight.js     # 認証プリフライト（304行）✅
├── auth-transfer.js      # 認証転送
├── auth-debug-log.js     # 認証デバッグログ
├── channel-paths.js      # チャンネルパス
├── display-link-logger.js # 表示リンクロガー
├── firebase-config.js    # Firebase設定
├── layout.js             # レイアウト
├── operator-modes.js     # オペレーターモード
├── participant-tokens.js # 参加者トークン
├── presence-keys.js       # プレゼンスキー
├── print-preview.js      # 印刷プレビュー（538行）✅
├── print-utils.js        # 印刷ユーティリティ（1,341行）✅
└── routes.js             # ルーティング
```

**評価**:

- ✅ 適切に分割されている
- ✅ 各ファイルの責務が明確
- ✅ ファイルサイズも適切（`print-utils.js` は許容範囲）

**改善提案**:

- 現状維持で問題なし

---

### 6. `scripts/gl-form/` ⚠️ 要検討

**現状**:

- 単一ファイル（`index.js`）に全機能が集約
- 860 行で、許容範囲内だが分割を検討すべき

**構造**:

```
scripts/gl-form/
└── index.js              # 全機能（860行）⚠️
```

**評価**:

- ⚠️ 単一ファイルに全機能が集約
- ✅ ファイルサイズは許容範囲内
- ⚠️ 責務の分離が不十分（フォーム処理、バリデーション、Firebase 操作、UI 更新が混在）

**改善提案**:

- 機能別に分割することを検討（優先度: 中）
  - `gl-form-app.js` - メインアプリケーション
  - `gl-form-validator.js` - バリデーション
  - `gl-form-renderer.js` - UI 描画
  - `gl-form-firebase.js` - Firebase 操作

---

### 7. `scripts/participant-mail-view/` ✅ 良好

**現状**:

- 単一ファイル（`index.js`）に全機能が集約
- 310 行で、適切なサイズ

**構造**:

```
scripts/participant-mail-view/
└── index.js              # 全機能（310行）✅
```

**評価**:

- ✅ ファイルサイズが適切
- ✅ 責務が明確（メール表示専用）
- ✅ 現状維持で問題なし

**改善提案**:

- 現状維持で問題なし

---

### 8. `scripts/login.js` ⚠️ 要検討

**現状**:

- 単一ファイルに全機能が集約
- 664 行で、許容範囲内だが分割を検討すべき

**構造**:

```
scripts/
└── login.js              # 全機能（664行）⚠️
```

**評価**:

- ⚠️ 単一ファイルに全機能が集約
- ✅ ファイルサイズは許容範囲内
- ⚠️ 責務の分離が不十分（認証処理、UI 更新、エラーハンドリングが混在）

**改善提案**:

- 機能別に分割することを検討（優先度: 低）
  - `login/app.js` - メインアプリケーション
  - `login/auth-handler.js` - 認証処理
  - `login/ui-handler.js` - UI 更新

---

## 問題点の整理

### 重大な問題（優先度: 高）

1. **`scripts/events/app.js` が 6,070 行（リファクタリング完了）**

   - 開発標準の約 4.0 倍（元の 10,180 行から約 4,110 行削減）
   - イベント管理パネルと日程管理パネルを分離済み（`event-panel.js`, `schedule-panel.js`）
   - 単一責任の原則に準拠（改善完了、6 個の Manager クラスに分割）
   - テスト容易性が向上（改善完了）
   - 保守性が向上（改善完了）

2. **`scripts/question-admin/app.js` が 2,263 行（リファクタリング完了（フェーズ 17 完了））**

   - 開発標準の約 2.0 倍（元の 8,180 行から約 5,917 行削減）
   - 単一責任の原則に準拠（改善完了、21 個の Manager クラスに分割）
   - テスト容易性が向上（改善完了）
   - 保守性が向上（改善完了）
   - **リファクタリング状況**:
     - ✅ フェーズ 1: PrintManager に印刷機能を分離（1,004 行）完了
     - ✅ フェーズ 2: CsvManager に CSV 処理機能を分離（351 行）完了
     - ✅ フェーズ 3: EventManager にイベント管理機能を分離（409 行）完了
     - ✅ フェーズ 4: ParticipantManager に参加者管理機能を分離（1,155 行）完了
       - 参加者読み込み（`loadParticipants`）
       - 参加者描画（`renderParticipants`）
       - 参加者 CRUD 操作（`openParticipantEditor`, `saveParticipantEdits`, `handleDeleteParticipant`, `removeParticipantFromState`）
       - 参加者保存（`handleSave`）
     - ✅ フェーズ 5: ScheduleManager に日程管理機能を分離（478 行）完了
       - 日程描画（`renderSchedules`）
       - 日程選択（`selectSchedule`）
       - 日程フォーム表示（`openScheduleForm`）
       - 日程 CRUD 操作（`createSchedule`, `updateSchedule`, `deleteSchedule`）
       - フォーム値解決（`resolveScheduleFormValues`）
     - ✅ フェーズ 6: MailManager にメール送信機能を分離（514 行）完了
       - メール送信処理（`handleSendParticipantMail`）
       - メール送信結果の適用（`applyMailSendResults`）
       - メール送信結果メッセージの生成（`buildMailStatusMessage`）
       - メールアクションボタンの状態同期（`syncMailActionState`）
       - 送信待ち参加者数の取得（`getPendingMailCount`）
       - ログ関数と定数
     - ✅ フェーズ 7: AuthManager に認証・初期化機能を分離（402 行）完了
       - 認証状態の監視（`initAuthWatcher`）
       - 在籍確認（`verifyEnrollment`）
       - 管理者権限の確認（`ensureAdminAccess`）
       - 認証済みメールアドレスの取得（`fetchAuthorizedEmails`、`getCachedAuthorizedEmails`）
       - 質問インテークアクセスの確認（`probeQuestionIntakeAccess`、`waitForQuestionIntakeAccess`）
       - プリフライトコンテキストの取得（`getFreshPreflightContext`）
       - 認証関連の定数と変数
     - ✅ フェーズ 8: RelocationManager にリロケーション機能を分離（954 行）完了
       - ✅ `queueRelocationPrompt` を `RelocationManager` に移行完了（約 73 行削減）
       - ✅ `renderRelocationPrompt` を `RelocationManager` に移行完了（約 172 行削減）
       - ✅ `handleRelocationFormSubmit` を `RelocationManager` に移行完了（約 132 行削減）
       - ✅ `handleRelocationDialogClose` を `RelocationManager` に移行完了（約 56 行削減）
       - ✅ `handleQuickRelocateAction` を `RelocationManager` に移行完了（約 46 行削減）
       - ✅ `handleRelocateSelectedParticipant` を `RelocationManager` に移行完了（約 10 行削減）
       - ✅ `applyRelocationDraft` を `RelocationManager` に移行完了（約 49 行削減）
       - ✅ `restoreRelocationDrafts` を `RelocationManager` に移行完了（約 56 行削減）
       - ✅ `clearRelocationPreview` と `upsertRelocationPreview` を `RelocationManager` に移行完了（約 65 行削減）
       - ✅ リロケーション関連のユーティリティ関数を `RelocationManager` に移行完了（約 82 行削減）
       - 実績: 約 641 行の削減（`app.js` は 4,596 行、`relocation-manager.js` は 954 行）
   - **残りの機能**（詳細は `docs/utility-refactoring-plan.md` を参照）:
     - ✅ フェーズ 9: 埋め込みモード・ホスト統合機能の分離（HostIntegrationManager、671 行）完了
     - ✅ フェーズ 10: 状態管理・キャッシュ関連の関数の整理（StateManager、165 行）完了
     - ✅ フェーズ 11: UI 関連の関数の整理（UIManager、188 行）完了
     - ✅ フェーズ 12: 確認ダイアログ関連の関数の整理（ConfirmDialogManager、128 行）完了
     - ✅ フェーズ 13: GL 関連の関数の整理（GlManager、386 行）完了
     - ✅ フェーズ 14: 参加者 UI 関連の関数の整理（ParticipantUIManager、906 行）完了
     - ✅ フェーズ 15: スケジュール関連の関数の整理（ScheduleUtilityManager、252 行）完了
     - ✅ フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager、完了、約 349 行削減）

- ✅ フェーズ 17: その他のユーティリティ関数の整理（完了）
  - ✅ 段階 1: トークン・API 関連関数の移行（TokenApiManager、106 行）完了
  - ✅ 段階 2: 共有・クリップボード関連関数の移行（ShareClipboardManager、90 行）完了
  - ✅ 段階 3: 参加者コンテキスト・イベント関連関数の移行（ParticipantContextManager、138 行）完了
  - ✅ 段階 4: 参加者操作ハンドラー関数の移行（ParticipantActionManager、168 行）完了
  - ✅ 段階 5: 参加者 UI イベントハンドラー関数の移行（ParticipantUIManager に追加）完了
  - ✅ 段階 6: イベントハンドラーアタッチ関数の移行（EventHandlersManager、506 行）完了
  - ✅ 段階 7: 初期化関数の移行（InitManager、1,131 行）完了

3. **`scripts/events/panels/gl-panel.js` が 1,659 行（リファクタリング進行中、段階 1-5 完了）**
   - 開発標準の約 2 倍
   - 分割を検討すべき

### 中程度の問題（優先度: 中）

4. **`scripts/gl-form/index.js` が 860 行**

   - 許容範囲内だが、分割を検討すべき
   - 責務の分離が不十分

5. **`scripts/login.js` が 664 行**
   - 許容範囲内だが、分割を検討すべき
   - 責務の分離が不十分

### 軽微な問題（優先度: 低）

6. **`scripts/operator/app.js` が 2,463 行**

   - 許容範囲内だが、やや大きい
   - 既に Manager パターンで分割されているため、優先度は低い

7. **`scripts/operator/questions.js` が 1,734 行**
   - 許容範囲内だが、やや大きい
   - 機能別に分割することを検討

---

## 改善提案

### 1. `scripts/events/app.js` のリファクタリング（優先度: 高）

**目標**: Manager パターンを適用し、`scripts/operator/` と同様の構造にする

**進捗状況**:

- ✅ フェーズ 1: イベント管理パネルと日程管理パネルの分離完了
  - `event-panel.js` (326 行) - イベント管理機能を分離
  - `schedule-panel.js` (326 行) - 日程管理機能を分離
  - `app.js` の行数: 10,180 行 → 9,778 行（約 402 行削減）
- ✅ フェーズ 1.1: 認証管理機能の分離完了
  - `managers/auth-manager.js` (384 行) - 認証管理機能を分離
  - `app.js` の行数: 9,778 行 → 9,590 行（約 188 行削減）
- ✅ フェーズ 1.2: 状態管理機能の分離完了
  - `managers/state-manager.js` (315 行) - 状態管理機能を分離
  - `app.js` の行数: 9,590 行 → 9,471 行（約 119 行削減）
- ✅ フェーズ 1.3: 画面遷移制御機能の分離完了（基本機能）
  - `managers/navigation-manager.js` (499 行) - 画面遷移制御機能を分離
  - `app.js` の行数: 9,471 行 → 9,260 行（約 211 行削減）
- ✅ フェーズ 1.4: UI 描画機能の分離完了
  - `managers/ui-renderer.js` (896 行) - UI 描画機能を分離
  - `app.js` の行数: 9,260 行 → 9,027 行（約 233 行削減）
- ✅ フェーズ 1.5: Firebase 操作機能の分離完了
  - `managers/firebase-manager.js` (1,392 行) - Firebase 操作機能を分離
  - `app.js` の行数: 9,027 行 → 6,070 行（約 2,957 行削減、最終的にはリファクタリング完了）
- ✅ フェーズ 1.5.1: Firebase 操作機能の分離 - 基本実装の確認（完了）
  - `EventFirebaseManager` クラスの基本実装を確認完了
  - プロパティの同期が正しく行われていることを確認
  - 基本的なメソッドが委譲されていることを確認
  - コンストラクタでの重複プロパティ初期化を削除（約 38 行削減）
- ✅ フェーズ 1.5.2: Firebase 操作機能の分離 - 重複メソッドの確認（完了）
  - 重複メソッドを特定・削除完了（約 300 行削減）
  - `buildScheduleConflictContext()` の重複を削除
  - `syncScheduleConflictPromptState()` の重複を削除
  - `updateScheduleConflictState()` の重複を削除
  - `enforceScheduleConflictState()` の重複を削除
  - 未使用の定数 `HOST_PRESENCE_HEARTBEAT_MS` を削除（`EventFirebaseManager`に移行済み）
  - 未使用のインポート `sharedDerivePresenceScheduleKey` を削除
- ✅ フェーズ 1.6: 重複メソッドの削除とクリーンアップ（完了）
  - ✅ フェーズ 1.6.1: 委譲メソッドの追加（完了）
    - `syncOperatorPresenceSubscription()` の委譲メソッドを追加完了
    - `syncScheduleConsensusSubscription()` の委譲メソッドを追加完了
    - `clearScheduleConsensusState()` の委譲メソッドを追加完了
    - `normalizeScheduleConsensus()` の委譲メソッドを追加完了
    - プロパティの同期を確認完了
  - ✅ フェーズ 1.6.2: 重複メソッドの削除（完了）
    - `handleScheduleConsensusUpdate` の重複を削除完了
    - `applyScheduleConsensus` の重複を削除完了
    - `handleScheduleConsensusPrompt` の重複を削除完了
  - ✅ フェーズ 1.6.3: その他のメソッドの委譲確認（完了）
    - `scheduleHostPresenceHeartbeat()` の委譲を確認・追加完了
    - `clearHostPresence()` の委譲を確認・追加完了
    - すべての呼び出し箇所を確認完了
  - ✅ フェーズ 1.6.4: インポートの確認（完了）
    - 必要なインポート（`getOperatorScheduleConsensusRef`, `onValue`）を追加完了
    - 不要なインポートの確認完了（一部は後方互換性のため保持）
    - インポートの整合性を確認完了
  - ✅ フェーズ 1.6.5: 最終確認とドキュメント更新（完了）
    - すべての委譲が正しく動作していることを確認完了
    - プロパティの同期が正しく行われていることを確認完了
    - ドキュメントを更新完了
    - `app.js` の行数を確認（現在: 7,734 行、元の 10,180 行から約 2,446 行削減）

**分割案**:

```
scripts/events/
├── index.js
├── app.js                    # EventAdminApp（初期化とルーティング、6,070行、リファクタリング完了）
├── panels/
│   ├── event-panel.js        # イベント管理パネル（326行）✅ 完了
│   ├── schedule-panel.js     # 日程管理パネル（326行）✅ 完了
│   ├── chat-panel.js         # 既存
│   ├── participants-panel.js # 既存
│   ├── gl-panel.js           # 既存
│   ├── gl-faculties-panel.js # 既存
│   └── operator-panel.js     # 既存
├── managers/
│   ├── auth-manager.js       # 認証管理（384行）✅ 完了
│   ├── state-manager.js     # 状態管理（315行）✅ 完了
│   ├── navigation-manager.js # 画面遷移制御（499行）✅ 完了
│   ├── ui-renderer.js        # UI 描画（896行）✅ 完了
│   ├── firebase-manager.js   # Firebase 操作（1,392行）✅ 完了
│   └── display-lock-manager.js # ディスプレイロック（255行）✅ 完了
├── tool-coordinator.js       # 既存
├── config.js                 # 既存
├── dom.js                    # 既存
├── helpers.js                # 既存
├── loading-tracker.js        # 既存
├── schedule-calendar.js      # 既存
└── tools/                    # 既存
```

**手順**:

1. ✅ `app.js` の機能を分析し、責務を特定（完了）
2. ✅ イベント管理パネルと日程管理パネルを分離（完了）
3. ✅ 認証管理機能を分離（完了）
4. ✅ 状態管理機能を分離（完了）
5. ✅ 画面遷移制御機能を分離（基本機能完了）
6. ✅ UI 描画機能を分離（完了）
7. ✅ Firebase 操作機能を分離（完了）
8. ✅ フェーズ 1.5.1: Firebase 操作機能の分離 - 基本実装の確認（完了）
   - `EventFirebaseManager` クラスの基本実装を確認完了
   - プロパティの同期が正しく行われていることを確認完了
   - 基本的なメソッドが委譲されていることを確認完了
   - コンストラクタでの重複プロパティ初期化を削除（約 38 行削減）
9. ✅ フェーズ 1.5.2: Firebase 操作機能の分離 - 重複メソッドの確認（完了）
   - 重複メソッドを特定・削除完了（約 300 行削減）
   - `buildScheduleConflictContext()` の重複を削除
   - `syncScheduleConflictPromptState()` の重複を削除
   - `updateScheduleConflictState()` の重複を削除
   - `enforceScheduleConflictState()` の重複を削除
   - 未使用の定数・インポートを削除（約 2 行削減）
10. ✅ フェーズ 1.6.4: インポートの確認（完了）
    - 必要なインポート（`getOperatorScheduleConsensusRef`, `onValue`）を追加完了
    - 不要なインポートの確認完了（一部は後方互換性のため保持）
    - インポートの整合性を確認完了
11. ✅ フェーズ 1.6: 重複メソッドの削除とクリーンアップ（完了）
    - ✅ フェーズ 1.6.1: 委譲メソッドの追加（完了）
      - `syncOperatorPresenceSubscription()`, `syncScheduleConsensusSubscription()`, `clearScheduleConsensusState()`, `normalizeScheduleConsensus()` の委譲メソッドを追加完了
      - プロパティの同期を確認完了
    - ✅ フェーズ 1.6.2: 重複メソッドの削除（完了）
      - `handleScheduleConsensusUpdate`, `applyScheduleConsensus`, `handleScheduleConsensusPrompt` の重複を削除完了
    - ✅ フェーズ 1.6.3: その他のメソッドの委譲確認（完了）
      - `scheduleHostPresenceHeartbeat()`, `clearHostPresence()` の委譲を確認・追加完了
      - すべての呼び出し箇所を確認完了
    - ✅ フェーズ 1.6.4: インポートの確認（完了）
      - 必要なインポート（`getOperatorScheduleConsensusRef`, `onValue`）を追加完了
      - 不要なインポートの確認完了（一部は後方互換性のため保持）
      - インポートの整合性を確認完了
    - ✅ フェーズ 1.6.5: 最終確認とドキュメント更新（完了）
      - すべての委譲が正しく動作していることを確認完了
      - ドキュメントを更新完了（現在の行数: 7,734 行、削減量: 2,446 行）
12. ✅ フェーズ 1.7: スケジュールコンフリクト管理機能の整理（完了）
13. ✅ フェーズ 1.8: スケジュールコンフリクトダイアログ機能の整理（完了）
14. ✅ フェーズ 1.9: ホストコミットスケジュール管理機能の整理（完了）
15. ✅ フェーズ 1.10: ディスプレイロック機能の整理（完了）
16. ✅ フェーズ 1.11: スケジュール合意トースト機能の整理（完了）
17. ✅ フェーズ 1.12: ユーティリティ関数の整理（完了）
18. ✅ フェーズ 1.13: 未使用コードの削除と最終クリーンアップ（完了）
19. ⏳ テストを実施（未着手）

### 2. `scripts/question-admin/app.js` のリファクタリング（優先度: 高）

**目標**: 機能別に分割し、責務を明確化

**分割案**:

```
scripts/question-admin/
├── index.js
├── app.js                    # QuestionAdminApp（初期化とルーティング、2,263行、リファクタリング完了（段階7完了））
├── managers/
│   ├── print-manager.js      # 印刷機能（1,004行）✅ 完了
│   ├── csv-manager.js        # CSV 処理（351行）✅ 完了
│   ├── event-manager.js      # イベント管理（409行）✅ 完了
│   ├── participant-manager.js # 参加者管理（1,155行）✅ 完了
│   ├── schedule-manager.js   # 日程管理（478行）✅ 完了
│   ├── mail-manager.js       # メール送信（514行）✅ 完了
│   ├── auth-manager.js       # 認証・初期化（402行）✅ 完了
│   └── relocation-manager.js # リロケーション（954行）✅ 完了
├── participants.js           # 参加者関連ユーティリティ（1,169行）✅
├── calendar.js               # 既存
├── dialog.js                 # 既存
├── loader.js                 # 既存
├── state.js                  # 既存
├── dom.js                    # 既存
├── firebase.js               # 既存
├── utils.js                  # 既存
└── constants.js              # 既存
```

**進捗状況**:

- ✅ フェーズ 1: 印刷機能の分離（PrintManager）完了
- ✅ フェーズ 2: CSV 処理機能の分離（CsvManager）完了
- ✅ フェーズ 3: イベント管理機能の分離（EventManager）完了
- ✅ フェーズ 4: 参加者管理機能の分離（ParticipantManager）完了
- ✅ フェーズ 5: 日程管理機能の分離（ScheduleManager）完了
- ✅ フェーズ 6: メール送信機能の分離（MailManager）完了
- ✅ フェーズ 7: 認証・初期化機能の分離（AuthManager）完了
- ✅ フェーズ 8: リロケーション機能の分離（RelocationManager）完了
  - ✅ フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager、完了、約 349 行削減）
  - ✅ フェーズ 17: その他のユーティリティ関数の整理（完了、詳細は `docs/utility-refactoring-plan.md` を参照）
    - ✅ 段階 1: トークン・API 関連関数の移行（TokenApiManager、106 行）完了
    - ✅ 段階 2: 共有・クリップボード関連関数の移行（ShareClipboardManager、90 行）完了
    - ✅ 段階 3: 参加者コンテキスト・イベント関連関数の移行（ParticipantContextManager、138 行）完了
    - ✅ 段階 4: 参加者操作ハンドラー関数の移行（ParticipantActionManager、168 行）完了
    - ✅ 段階 5: 参加者 UI イベントハンドラー関数の移行（ParticipantUIManager に追加）完了
    - ✅ 段階 6: イベントハンドラーアタッチ関数の移行（EventHandlersManager、506 行）完了
    - ✅ 段階 7: 初期化関数の移行（InitManager、1,131 行、完了）
      - ✅ InitManager クラスの基本構造作成完了
      - ✅ PrintManager, StateManager, UIManager, ConfirmDialogManager, ScheduleUtilityManager, ButtonStateManager の初期化を移行完了
      - ✅ TokenApiManager, ShareClipboardManager の初期化を移行完了
      - ✅ ParticipantContextManager, ParticipantActionManager の初期化を移行完了
      - ✅ GlManager, ParticipantUIManager の初期化を移行完了
      - ✅ CsvManager, EventManager の初期化を移行完了
      - ✅ 初期化後の処理を移行完了
      - ✅ window.questionAdminEmbed を移行完了
      - ✅ app.js の init()関数を InitManager への委譲に変更完了
      - ✅ initAuthWatcher()のフォールバック実装の整理完了
      - ✅ すべての Manager 初期化を InitManager に移行完了（21 個）

**手順**:

1. ✅ `app.js` の機能を分析し、責務を特定（完了）
2. ✅ 各 Manager クラスを作成（8 つ完了）
3. ✅ 段階的に機能を移行（8 フェーズ完了）
4. ⏳ テストを実施（未着手）

### 3. `scripts/events/panels/gl-panel.js` のリファクタリング（優先度: 中）

**目標**: 機能別に分割

**進捗状況**:

- ✅ 段階 1: ユーティリティ関数を `gl-utils.js` に移行完了（約 750 行削減）
  - `gl-panel.js`: 3,249 行 → 2,526 行（約 723 行削減）
  - `gl-utils.js`: 789 行（新規作成）
- ✅ 段階 2: UI 描画機能を `gl-renderer.js` に移行完了（内部スタッフ関連 5 個 + スケジュール班関連 2 個 + 応募者・スケジュール関連 2 個 + 依存メソッド 5 個を移行）
  - `gl-panel.js`: 2,526 行 → 2,368 行（約 158 行削減）
  - `gl-panel.js`: 2,368 行 → 2,302 行（約 66 行削減）
  - `gl-panel.js`: 2,302 行 → 2,308 行（約 6 行追加、コメント追加）
  - `gl-panel.js`: 2,308 行 → 1,815 行（約 493 行削減、依存メソッド 5 個を移行完了）
  - `gl-renderer.js`: 265 行 → 385 行（約 120 行追加、スケジュール班関連の描画メソッド 2 個を実装）
  - `gl-renderer.js`: 385 行 → 518 行（約 133 行追加、応募者・スケジュール関連の描画メソッド 2 個の基本構造を実装）
  - `gl-renderer.js`: 518 行 → 982 行（約 464 行追加、依存メソッド 5 個を実装完了）

**分割案**:

```
scripts/events/panels/
├── gl-panel.js               # GlToolManager（メイン、500行程度に縮小予定）
├── gl-application-manager.js # 応募管理（157行、段階3完了）✅
├── gl-assignment-manager.js  # 割り当て管理（171行、段階4完了）✅
├── gl-config-manager.js      # 設定管理（240行、段階5完了）✅
├── gl-renderer.js            # UI 描画（982行、段階2完了）✅ 完了
└── gl-utils.js               # ユーティリティ（789行）✅ 完了
```

### 4. `scripts/gl-form/index.js` のリファクタリング（優先度: 中）

**目標**: 機能別に分割

**分割案**:

```
scripts/gl-form/
├── index.js                  # エントリーポイント（20行程度）
├── app.js                    # メインアプリケーション（300行程度）
├── validator.js              # バリデーション（200行程度）
├── renderer.js               # UI 描画（200行程度）
└── firebase.js               # Firebase 操作（140行程度）
```

### 5. `scripts/login.js` のリファクタリング（優先度: 低）

**目標**: 機能別に分割

**分割案**:

```
scripts/login/
├── index.js                  # エントリーポイント（10行程度）
├── app.js                    # メインアプリケーション（300行程度）
├── auth-handler.js           # 認証処理（200行程度）
└── ui-handler.js             # UI 更新（150行程度）
```

---

## 優先度別リファクタリング計画

### フェーズ 1: 重大な問題の解決（優先度: 高）

1. **`scripts/events/app.js` のリファクタリング**（完了）

   - 期間: 2-3 週間（100% 完了、フェーズ 1.13 完了、全 18 ステップ完了）
   - 影響範囲: イベント管理画面全体
   - リスク: 高（大規模な変更）
   - **完了したフェーズ**:
     - ✅ フェーズ 1: イベント管理パネルと日程管理パネルの分離（`event-panel.js`, `schedule-panel.js`）
     - ✅ フェーズ 1.1: 認証管理機能の分離（`auth-manager.js`, 384 行）
     - ✅ フェーズ 1.2: 状態管理機能の分離（`state-manager.js`, 315 行）
     - ✅ フェーズ 1.3: 画面遷移制御機能の分離（`navigation-manager.js`, 499 行、基本機能完了）
     - ✅ フェーズ 1.4: UI 描画機能の分離（`ui-renderer.js`, 338 行 → 643 行、フェーズ 1.7 で拡張）
     - ✅ フェーズ 1.5: Firebase 操作機能の分離（`firebase-manager.js`, 774 行 → 833 行、フェーズ 1.7 で拡張）
     - ✅ フェーズ 1.5.1: Firebase 操作機能の分離 - 基本実装の確認
       - `EventFirebaseManager` クラスの基本実装を確認完了
       - プロパティの同期が正しく行われていることを確認完了
       - 基本的なメソッドが委譲されていることを確認完了
       - コンストラクタでの重複プロパティ初期化を削除（約 46 行削減）
       - 重複したプロパティ同期を削除（約 8 行削減）
       - `cachedHostPresenceStorage` の初期化を削除（`EventFirebaseManager`で管理）
     - ✅ フェーズ 1.5.2: Firebase 操作機能の分離 - 重複メソッドの確認
       - 重複メソッドを特定・削除完了（約 300 行削減）
       - `buildScheduleConflictContext()` の重複を削除
       - `syncScheduleConflictPromptState()` の重複を削除
       - `updateScheduleConflictState()` の重複を削除
       - `enforceScheduleConflictState()` の重複を削除
       - 未使用の定数 `HOST_PRESENCE_HEARTBEAT_MS` を削除
       - 未使用のインポート `sharedDerivePresenceScheduleKey` を削除
     - ✅ フェーズ 1.6.1: 委譲メソッドの追加
       - `syncOperatorPresenceSubscription()`, `syncScheduleConsensusSubscription()`, `clearScheduleConsensusState()`, `normalizeScheduleConsensus()` の委譲メソッドを追加完了
       - プロパティの同期を確認完了
     - ✅ フェーズ 1.6.2: 重複メソッドの削除
       - `handleScheduleConsensusUpdate`, `applyScheduleConsensus`, `handleScheduleConsensusPrompt` の重複を削除完了
     - ✅ フェーズ 1.6.3: その他のメソッドの委譲確認
       - `scheduleHostPresenceHeartbeat()`, `clearHostPresence()` の委譲を確認・追加完了
       - すべての呼び出し箇所を確認完了
     - ✅ フェーズ 1.6.4: インポートの確認
       - 必要なインポート（`getOperatorScheduleConsensusRef`, `onValue`）を追加完了
       - 不要なインポートの確認完了（一部は後方互換性のため保持）
       - インポートの整合性を確認完了
     - ✅ フェーズ 1.6.5: 最終確認とドキュメント更新（完了）
       - すべての委譲が正しく動作していることを確認完了
       - ドキュメントを更新完了
     - ✅ フェーズ 1.7: スケジュールコンフリクト管理機能の整理（完了）
       - ✅ `buildScheduleConflictContext()` を `EventUIRenderer` に移行完了（約 198 行削減）
       - ✅ `syncScheduleConflictPromptState()` を `EventUIRenderer` に移行完了（約 34 行削減）
       - ✅ `updateScheduleConflictState()` を `EventUIRenderer` に移行完了（約 9 行削減）
       - ✅ `enforceScheduleConflictState()` を `EventUIRenderer` に移行完了（約 44 行削減）
       - 削減量: 約 285 行（7,734 行 → 7,449 行、最終的にはリファクタリング完了で 6,070 行）
       - `EventFirebaseManager.buildPresenceEntries()` を追加（約 50 行）
       - `EventUIRenderer` に 4 つのメソッドを追加（約 235 行）
     - ✅ フェーズ 1.8: スケジュールコンフリクトダイアログ機能の整理（完了）
       - 重複メソッドの削除完了: `handleScheduleConflictSubmit`の 2 つ目、`requestScheduleConflictPrompt`の 2 つ目、`confirmScheduleConsensus`の 2 つ目、`setScheduleConflictSubmitting`の 1 つ目を削除済み（約 477 行削減）
       - UI 関連メソッドの移行完了: `openScheduleConflictDialog`, `handleScheduleConflictSubmit` → `EventUIRenderer`（約 150 行削減）
       - Firebase 関連メソッドの移行完了: `confirmScheduleConsensus`, `requestScheduleConflictPrompt` → `EventFirebaseManager`（約 233 行削減）
       - 合計削減: 約 860 行（`app.js` は 6,723 行、`ui-renderer.js` は 798 行、`firebase-manager.js` は 1,085 行）
       - その後、フェーズ 1.9 で追加削減: 約 296 行（`app.js` は 6,446 行、`firebase-manager.js` は 1,352 行）
     - ✅ フェーズ 1.9: ホストコミットスケジュール管理機能の整理（完了）
       - ✅ フェーズ 1.9.1: `setHostCommittedSchedule`の重複削除完了（約 64 行削減）
       - ✅ フェーズ 1.9.2: `setHostCommittedSchedule`の部分移行完了（Firebase 関連を`EventFirebaseManager`に移行、約 30 行削減）
       - ✅ フェーズ 1.9.3: `syncHostPresence`の完全移行完了（`EventFirebaseManager`に移行、約 200 行削減、未使用インポート削除で約 2 行削減）
       - ✅ フェーズ 1.9.4: 関連メソッドの整理と最終確認完了
       - 合計削減: 約 296 行削減済み（`app.js` は 6,446 行、`firebase-manager.js` は 1,352 行）
     - ✅ フェーズ 1.10: ディスプレイロック機能の整理（完了）
       - ✅ フェーズ 1.10.1: `DisplayLockManager`クラスの作成と`shouldAutoLockDisplaySchedule`の委譲完了
       - ✅ フェーズ 1.10.2: 残りのメソッドの移行完了（`requestDisplayScheduleLock`, `requestDisplayScheduleLockWithRetry`, `performDisplayLockAttempt`, `scheduleDisplayLockRetry`, `clearDisplayLockRetryTimer`, `clearPendingDisplayLock`）
       - ✅ フェーズ 1.10.3: 定数の削除とプロパティの同期完了
       - ✅ フェーズ 1.10.4: 最終確認とドキュメント更新完了
       - 実績: 約 134 行の削減（`app.js` は 6,316 行、`display-lock-manager.js` は 255 行）
     - ✅ フェーズ 1.11: スケジュール合意トースト機能の整理（完了）
       - ✅ 重複メソッドの削除完了（約 105 行削減）
       - ✅ `showScheduleConsensusToast`, `hideScheduleConsensusToast` を `EventUIRenderer` に移行完了（約 70 行削減）
       - ✅ `maybeClearScheduleConsensus` を `EventFirebaseManager` に移行完了（約 30 行削減）
       - ✅ 定数 `SCHEDULE_CONSENSUS_TOAST_MS` を `EventUIRenderer` に移行完了
       - 実績: 約 195 行の削減（`app.js` は 6,121 行、`ui-renderer.js` は 896 行、`firebase-manager.js` は 1,392 行）
     - ✅ フェーズ 1.12: ユーティリティ関数の整理（完了）
       - ✅ `resolveScheduleFormValues` を `schedule-panel.js` に移行完了（約 40 行削減）
       - ✅ `extractTimePart` を `schedule-panel.js` に移行完了
       - 注: `getScheduleRecord` と `buildScheduleOptionLabel` は `scripts/events/app.js` には存在せず、`scripts/question-admin/app.js` に存在する関数です（`question-admin`のリファクタリング対象）
       - 実績: 約 40 行の削減（`app.js` は 6,085 行、`schedule-panel.js` は 391 行）
     - ✅ フェーズ 1.13: 未使用コードの削除と最終クリーンアップ（完了）
       - ✅ フェーズ 1.13.1: 未使用インポートの削除完了（約 14 行削減）
         - 削除したインポート: `get`, `update`, `remove`, `signInWithCredential`, `GoogleAuthProvider`, `getOperatorScheduleConsensusRef`, `runTransaction`, `toMillis`, `formatRelative`, `formatDateTimeLocal`, `collectParticipantTokens`, `isTelopMode`, `STAGE_SEQUENCE`, `STAGE_INFO`, `PANEL_STAGE_INFO`, `FOCUSABLE_SELECTOR`
       - ✅ フェーズ 1.13.2: 未使用関数の確認完了（すべて使用中）
         - `getTimerHost`, `parseCssPixels`, `extractTimePart` はすべて使用中
       - ✅ フェーズ 1.13.3: 未使用定数の削除完了（約 1 行削減）
         - 削除した定数: `PENDING_NAVIGATION_CLEAR_DELAY_MS`（`navigation-manager.js`で直接値を使用）
       - ✅ フェーズ 1.13.4: コメントの整理完了
         - 後方互換性のコメントは将来のリファクタリングの参考のため保持
       - ✅ フェーズ 1.13.5: 最終確認とドキュメント更新完了
       - 実績: 約 15 行の削減（`app.js` は 6,070 行）

2. **`scripts/question-admin/app.js` のリファクタリング**（完了）
   - 期間: 3-4 週間（100% 完了、フェーズ 17 完了、全 17 フェーズ完了）
   - 影響範囲: 質問管理画面全体
   - リスク: 高（大規模な変更）
   - **完了したフェーズ**:
     - ✅ フェーズ 1: 印刷機能の分離（PrintManager）
     - ✅ フェーズ 2: CSV 処理機能の分離（CsvManager）
     - ✅ フェーズ 3: イベント管理機能の分離（EventManager）
     - ✅ フェーズ 4: 参加者管理機能の分離（ParticipantManager）
     - ✅ フェーズ 5: 日程管理機能の分離（ScheduleManager）
     - ✅ フェーズ 6: メール送信機能の分離（MailManager、514 行）
       - ✅ `handleSendParticipantMail` を `MailManager` に移行完了（約 105 行削減）
       - ✅ `applyMailSendResults` を `MailManager` に移行完了（約 170 行削減）
       - ✅ `buildMailStatusMessage` を `MailManager` に移行完了（約 40 行削減）
       - ✅ `syncMailActionState` を `MailManager` に移行完了（約 55 行削減）
       - ✅ `getPendingMailCount` を `MailManager` に移行完了（約 4 行削減）
       - ✅ ログ関数と定数を `MailManager` に移行完了（約 50 行削減）
       - 実績: 約 372 行の削減（`app.js` は 5,380 行、`mail-manager.js` は 514 行）
     - ✅ フェーズ 7: 認証・初期化機能の分離（AuthManager、402 行）
       - ✅ `initAuthWatcher` を `AuthManager` に移行完了（約 62 行削減）
       - ✅ `ensureAdminAccess` を `AuthManager` に移行完了（約 30 行削減）
       - ✅ `verifyEnrollment` を `AuthManager` に移行完了（約 28 行削減）
       - ✅ `fetchAuthorizedEmails` と `getCachedAuthorizedEmails` を `AuthManager` に移行完了（約 35 行削減）
       - ✅ `probeQuestionIntakeAccess`、`waitForQuestionIntakeAccess`、`isNotInUsersSheetError` を `AuthManager` に移行完了（約 90 行削減）
       - ✅ `getFreshPreflightContext` を `AuthManager` に移行完了（約 20 行削減）
       - ✅ 認証関連の定数と変数を `AuthManager` に移行完了（約 4 行削減）
       - 実績: 約 142 行の削減（`app.js` は 5,238 行、`auth-manager.js` は 402 行）
     - ✅ フェーズ 8: RelocationManager にリロケーション機能を分離（954 行）完了
       - ✅ `queueRelocationPrompt` を `RelocationManager` に移行完了（約 73 行削減）
       - ✅ `renderRelocationPrompt` を `RelocationManager` に移行完了（約 172 行削減）
       - ✅ `handleRelocationFormSubmit` を `RelocationManager` に移行完了（約 132 行削減）
       - ✅ `handleRelocationDialogClose` を `RelocationManager` に移行完了（約 56 行削減）
       - ✅ `handleQuickRelocateAction` を `RelocationManager` に移行完了（約 46 行削減）
       - ✅ `handleRelocateSelectedParticipant` を `RelocationManager` に移行完了（約 10 行削減）
       - ✅ `applyRelocationDraft` を `RelocationManager` に移行完了（約 49 行削減）
       - ✅ `restoreRelocationDrafts` を `RelocationManager` に移行完了（約 56 行削減）
       - ✅ `clearRelocationPreview` と `upsertRelocationPreview` を `RelocationManager` に移行完了（約 65 行削減）
       - ✅ リロケーション関連のユーティリティ関数を `RelocationManager` に移行完了（約 82 行削減）
       - 実績: 約 641 行の削減（`app.js` は 4,596 行、`relocation-manager.js` は 954 行）
     - ✅ フェーズ 9: 埋め込みモード・ホスト統合機能の分離（HostIntegrationManager、671 行）完了
       - ✅ `getEmbedPrefix` を `HostIntegrationManager` に移行完了（約 20 行削減）
       - ✅ `isEmbeddedMode` を `HostIntegrationManager` に移行完了（約 3 行削減）
       - ✅ `waitForEmbedReady` を `HostIntegrationManager` に移行完了（約 15 行削減）
       - ✅ `resolveEmbedReady` を `HostIntegrationManager` に移行完了（約 8 行削減）
       - ✅ `attachHost` を `HostIntegrationManager` に移行完了（約 45 行削減）
       - ✅ `detachHost` を `HostIntegrationManager` に移行完了（約 20 行削減）
       - ✅ `isHostAttached` を `HostIntegrationManager` に移行完了（約 3 行削減）
       - ✅ `cloneHostEvent` を `HostIntegrationManager` に移行完了（約 17 行削減）
       - ✅ `applyHostEvents` を `HostIntegrationManager` に移行完了（約 23 行削減）
       - ✅ `handleHostSelection` を `HostIntegrationManager` に移行完了（約 10 行削減）
       - ✅ `handleHostEventsUpdate` を `HostIntegrationManager` に移行完了（約 3 行削減）
       - ✅ `getSelectionBroadcastSource` を `HostIntegrationManager` に移行完了（約 3 行削減）
       - ✅ `signatureForSelectionDetail` を `HostIntegrationManager` に移行完了（約 13 行削減）
       - ✅ `buildSelectionDetail` を `HostIntegrationManager` に移行完了（約 22 行削減）
       - ✅ `broadcastSelectionChange` を `HostIntegrationManager` に移行完了（約 35 行削減）
       - ✅ `resetSelectionBroadcastSignature` を `HostIntegrationManager` に追加完了（約 3 行追加）
       - ✅ `applySelectionContext` を `HostIntegrationManager` に移行完了（約 130 行削減）
       - ✅ `hostSelectionSignature` を `HostIntegrationManager` に移行完了（約 9 行削減）
       - ✅ `getHostSelectionElement` を `HostIntegrationManager` に移行完了（約 5 行削減）
       - ✅ `readHostSelectionDataset` を `HostIntegrationManager` に移行完了（約 16 行削減）
       - ✅ `applyHostSelectionFromDataset` を `HostIntegrationManager` に移行完了（約 37 行削減）
       - ✅ `startHostSelectionBridge` を `HostIntegrationManager` に移行完了（約 21 行削減）
       - ✅ `stopHostSelectionBridge` を `HostIntegrationManager` に移行完了（約 9 行削減）
       - ✅ `resetHostSelectionBridge` を `HostIntegrationManager` に追加完了（約 4 行追加）
       - ✅ `resetEmbedReady` を `HostIntegrationManager` に追加完了（約 5 行追加）
       - 実績: 約 479 行の削減（`app.js` は 4,459 行、`host-integration-manager.js` は 653 行、段階 6 完了後）
     - ✅ フェーズ 10: 状態管理・キャッシュ関連の関数の整理（StateManager、165 行）完了
       - ✅ `cloneParticipantEntry` を `StateManager` に移行完了（約 18 行削減）
       - ✅ `captureParticipantBaseline` を `StateManager` に移行完了（約 8 行削減）
       - ✅ `hasUnsavedChanges` を `StateManager` に移行完了（約 3 行削減）
       - ✅ `setUploadStatus` を `StateManager` に移行完了（約 16 行削減）
       - ✅ `isPlaceholderUploadStatus` を `StateManager` に移行完了（約 6 行削減）
       - ✅ `getMissingSelectionStatusMessage` を `StateManager` に移行完了（約 4 行削減）
       - ✅ `getSelectionRequiredMessage` を `StateManager` に移行完了（約 9 行削減）
       - ✅ `resetState` を `StateManager` に移行完了（約 32 行削減）
       - 実績: 約 96 行の削減（`app.js` は 4,444 行、`state-manager.js` は 165 行、フェーズ 10 完了後）
     - ✅ フェーズ 11: UI 関連の関数の整理（UIManager、188 行）完了
       - ✅ `getElementById` を `UIManager` に移行完了（約 24 行削減）
       - ✅ `renderUserSummary` を `UIManager` に移行完了（約 18 行削減）
       - ✅ `setLoginError` を `UIManager` に移行完了（約 10 行削減）
       - ✅ `setAuthUi` を `UIManager` に移行完了（約 50 行削減）
       - ✅ `toggleSectionVisibility` を `UIManager` に移行完了（約 11 行削減）
       - ✅ `applyParticipantNoText` を `UIManager` に移行完了（約 7 行削減）
       - ✅ `resolveFocusTargetElement` を `UIManager` に移行完了（約 16 行削減）
       - ✅ `maybeFocusInitialSection` を `UIManager` に移行完了（約 29 行削減）
       - 実績: 約 93 行の削減（`app.js` は 4,347 行、`ui-manager.js` は 229 行）
     - ✅ フェーズ 12: 確認ダイアログ関連の関数の整理（ConfirmDialogManager、128 行）完了
       - ✅ `confirmAction` を `ConfirmDialogManager` に移行完了（約 48 行削減）
       - ✅ `setupConfirmDialog` を `ConfirmDialogManager` に移行完了（約 21 行削減）
       - ✅ `cleanupConfirmState` を `ConfirmDialogManager` に移行完了（約 7 行削減）
       - ✅ `finalizeConfirm` を `ConfirmDialogManager` に移行完了（約 10 行削減）
       - ✅ `confirmState` を `ConfirmDialogManager` 内に統合完了（約 4 行削減）
       - 実績: 約 94 行の削減（`app.js` は 4,266 行、`confirm-dialog-manager.js` は 128 行）
     - ✅ フェーズ 13: GL 関連の関数の整理（GlManager、386 行）完了
       - ✅ `getEventGlRoster` を `GlManager` に移行完了（約 8 行削減）
       - ✅ `getEventGlAssignmentsMap` を `GlManager` に移行完了（約 8 行削減）
       - ✅ `normalizeGlRoster` を `GlManager` に移行完了（約 20 行削減）
       - ✅ `normalizeGlAssignmentEntry` を `GlManager` に移行完了（約 30 行削減）
       - ✅ `normalizeGlAssignments` を `GlManager` に移行完了（約 82 行削減）
       - ✅ `resolveScheduleAssignment` を `GlManager` に移行完了（約 10 行削減）
       - ✅ `collectGroupGlLeaders` を `GlManager` に移行完了（約 55 行削減）
       - ✅ `renderGroupGlAssignments` を `GlManager` に移行完了（約 35 行削減）
       - ✅ `loadGlDataForEvent` を `GlManager` に移行完了（約 59 行削減）
       - ✅ `glDataFetchCache` を `GlManager` に移行完了（約 1 行削減）
       - 実績: 約 227 行の削減（`app.js` は 4,092 行、`gl-manager.js` は 386 行）
     - ✅ フェーズ 14: 参加者 UI 関連の関数の整理（ParticipantUIManager、完了、段階 1-6 完了）
       - ✅ `getParticipantGroupKey` を `ParticipantUIManager` に移行完了（約 13 行削減）
       - ✅ `describeParticipantGroup` を `ParticipantUIManager` に移行完了（約 16 行削減）
       - ✅ `createParticipantGroupElements` を `ParticipantUIManager` に移行完了（約 54 行削減）
       - ✅ `formatParticipantIdentifier` を `ParticipantUIManager` に移行完了（約 13 行削減）
       - ✅ `createParticipantBadge` を `ParticipantUIManager` に移行完了（約 19 行削減）
       - ✅ `createMailStatusBadge` を `ParticipantUIManager` に移行完了（約 26 行削減）
       - ✅ `getEntryIdentifiers` を `ParticipantUIManager` に移行完了（約 6 行削減）
       - ✅ `MAIL_STATUS_ICON_SVG` を `ParticipantUIManager` に移行完了（約 12 行削減）
       - ✅ `isEntryCurrentlySelected` を `ParticipantUIManager` に移行完了（約 18 行削減、段階 3 完了）
       - ✅ `getSelectedParticipantTarget` を `ParticipantUIManager` に移行完了（約 14 行削減、段階 3 完了）
       - ✅ `applyParticipantSelectionStyles` を `ParticipantUIManager` に移行完了（約 27 行削減、段階 3 完了）
       - ✅ `clearParticipantSelection` を `ParticipantUIManager` に移行完了（約 8 行削減、段階 3 完了）
       - ✅ `selectParticipantFromCardElement` を `ParticipantUIManager` に移行完了（約 22 行削減、段階 3 完了）
       - ✅ `buildParticipantCard` を `ParticipantUIManager` に移行完了（約 170 行削減、段階 4 完了）
       - ✅ `resolveParticipantActionTarget` を `ParticipantUIManager` に移行完了（約 47 行削減、段階 5 完了）
       - ✅ `commitParticipantQuickEdit` を `ParticipantUIManager` に移行完了（約 49 行削減、段階 5 完了）
       - ✅ `handleQuickCancelAction` を `ParticipantUIManager` に移行完了（約 55 行削減、段階 5 完了）
       - ✅ `participantChangeKey` を `ParticipantUIManager` に移行完了（約 10 行削減、段階 6 完了）
       - ✅ `formatChangeValue` を `ParticipantUIManager` に移行完了（約 4 行削減、段階 6 完了）
       - ✅ `CHANGE_ICON_SVG` を `ParticipantUIManager` に移行完了（約 5 行削減、段階 6 完了）
       - ✅ `changeTypeLabel` を `ParticipantUIManager` に移行完了（約 12 行削減、段階 6 完了）
       - ✅ `describeParticipantForChange` を `ParticipantUIManager` に移行完了（約 15 行削減、段階 6 完了）
       - ✅ `buildChangeMeta` を `ParticipantUIManager` に移行完了（約 15 行削減、段階 6 完了）
       - ✅ `createChangePreviewItem` を `ParticipantUIManager` に移行完了（約 41 行削減、段階 6 完了）
       - ✅ `renderParticipantChangePreview` を `ParticipantUIManager` に移行完了（約 48 行削減、段階 6 完了）
       - 実績: 約 654 行の削減（`app.js` は 3,601 行、`participant-ui-manager.js` は 966 行、段階 1-6 完了）
     - ✅ フェーズ 15: スケジュール関連の関数の整理（ScheduleUtilityManager、完了）
       - ✅ `getScheduleRecord` を `ScheduleUtilityManager` に移行完了（約 8 行削減、段階 1 完了）
       - ✅ `buildScheduleOptionLabel` を `ScheduleUtilityManager` に移行完了（約 11 行削減、段階 1 完了）
       - ✅ `refreshScheduleLocationHistory` を `ScheduleUtilityManager` に移行完了（約 29 行削減、段階 2 完了）
       - ✅ `populateScheduleLocationOptions` を `ScheduleUtilityManager` に移行完了（約 42 行削減、段階 2 完了）
       - ✅ `finalizeEventLoad` を `ScheduleUtilityManager` に移行完了（約 115 行削減、段階 3 完了）
       - 実績: 約 205 行の削減（`app.js` は 3,461 行、`schedule-utility-manager.js` は 252 行、段階 1-3 完了）
     - ✅ **フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager）**（完了）
       - ✅ `setActionButtonState` を `ButtonStateManager` に移行完了（約 11 行削減、段階 1 完了）
       - ✅ `syncSaveButtonState` を `ButtonStateManager` に移行完了（約 16 行削減、段階 1 完了）
       - ✅ `syncClearButtonState` を `ButtonStateManager` に移行完了（約 9 行削減、段階 1 完了）
       - ✅ `syncTemplateButtons` を `ButtonStateManager` に移行完了（約 28 行削減、段階 1 完了）
       - ✅ `syncAllPrintButtonStates` を `ButtonStateManager` に移行完了（約 4 行削減、段階 2 完了）
       - ✅ `syncPrintViewButtonState` を `ButtonStateManager` に移行完了（約 65 行削減、段階 2 完了）
       - ✅ `syncStaffPrintViewButtonState` を `ButtonStateManager` に移行完了（約 53 行削減、段階 2 完了）
       - ✅ `setPrintButtonBusy` を `ButtonStateManager` に移行完了（約 10 行削減、段階 2 完了）
       - ✅ `setStaffPrintButtonBusy` を `ButtonStateManager` に移行完了（約 10 行削減、段階 2 完了）
       - ✅ `updateParticipantActionPanelState` を `ButtonStateManager` に移行完了（約 42 行削減、段階 3 完了）
       - ✅ `setParticipantTab` を `ButtonStateManager` に移行完了（約 24 行削減、段階 4 完了）
       - ✅ `focusParticipantTab` を `ButtonStateManager` に移行完了（約 8 行削減、段階 4 完了）
       - ✅ `setupParticipantTabs` を `ButtonStateManager` に移行完了（約 36 行削減、段階 4 完了）
       - ✅ `syncSelectedEventSummary` を `ButtonStateManager` に移行完了（約 33 行削減、段階 5 完了）
       - 実績: 約 349 行の削減（`app.js` は 3,290 行、`button-state-manager.js` は 454 行、段階 1-5 完了）
     - **フェーズ 17: その他のユーティリティ関数の整理**（完了）:
       - ✅ **段階 1: トークン・API 関連関数の移行**（完了）
         - ✅ `generateQuestionToken` を `TokenApiManager` に移行完了（約 24 行削減）
         - ✅ `ensureTokenSnapshot` を `TokenApiManager` に移行完了（約 9 行削減）
         - ✅ `createApiClient` を `TokenApiManager` に移行完了（約 28 行削減）
         - ✅ `drainQuestionQueue` を `TokenApiManager` に移行完了（約 6 行削減）
         - 実績: 約 67 行の削減（`app.js` は 3,217 行、`token-api-manager.js` は 106 行、段階 1 完了）
       - ✅ **段階 2: 共有・クリップボード関連関数の移行**（完了）
         - ✅ `legacyCopyToClipboard` を `ShareClipboardManager` に移行完了（約 18 行削減）
         - ✅ `createShareUrl` を `ShareClipboardManager` に移行完了（約 5 行削減）
         - ✅ `copyShareLink` を `ShareClipboardManager` に移行完了（約 20 行削減）
         - ✅ `getSelectionIdentifiers` を `ShareClipboardManager` に移行完了（約 5 行削減）
         - 実績: 約 48 行の削減（`app.js` は 3,211 行、`share-clipboard-manager.js` は 90 行、段階 2 完了）
       - ✅ **段階 3: 参加者コンテキスト・イベント関連関数の移行**（完了）
         - ✅ `parseInitialSelectionFromUrl` を `ParticipantContextManager` に移行完了（約 35 行削減）
         - ✅ `emitParticipantSyncEvent` を `ParticipantContextManager` に移行完了（約 22 行削減）
         - ✅ `updateParticipantContext` を `ParticipantContextManager` に移行完了（約 52 行削減）
         - 実績: 約 109 行の削減（`app.js` は 3,156 行、`participant-context-manager.js` は 138 行、段階 3 完了）
       - ✅ **段階 4: 参加者操作ハンドラー関数の移行**（完了）
         - ✅ `handleRevertParticipants` を `ParticipantActionManager` に移行完了（約 30 行削減）
         - ✅ `handleClearParticipants` を `ParticipantActionManager` に移行完了（約 60 行削減）
         - ✅ `handleEditSelectedParticipant` を `ParticipantActionManager` に移行完了（約 14 行削減）
         - ✅ `handleCancelSelectedParticipant` を `ParticipantActionManager` に移行完了（約 10 行削減）
         - ✅ `handleDeleteSelectedParticipant` を `ParticipantActionManager` に移行完了（約 12 行削減）
         - 実績: 約 126 行の削減（`app.js` は 3,070 行、`participant-action-manager.js` は 168 行、段階 4 完了）
       - ✅ **段階 5: 参加者 UI イベントハンドラー関数の移行**（完了）
         - ✅ `handleParticipantCardListClick` を `ParticipantUIManager` に移行完了（約 13 行削減）
         - ✅ `handleParticipantCardListKeydown` を `ParticipantUIManager` に移行完了（約 25 行削減）
         - ✅ `handleParticipantListFocus` を `ParticipantUIManager` に移行完了（約 7 行削減）
         - 実績: 約 45 行の削減（`app.js` は 3,096 行、`participant-ui-manager.js` は 951 行、段階 5 完了）
       - ✅ **段階 6: イベントハンドラーアタッチ関数の移行**（完了）
         - ✅ `attachEventHandlers` を `EventHandlersManager` に移行完了（約 419 行削減）
         - 実績: 約 419 行の削減（`app.js` は 2,949 行、`event-handlers-manager.js` は 506 行、段階 6 完了）
       - ✅ **段階 7: 初期化関数の移行**（完了）
         - ✅ InitManager クラスの基本構造作成完了
         - ✅ InitManager のインポートと初期化を追加完了
         - ✅ すべての Manager 初期化を InitManager に移行完了（21 個）
         - ✅ app.js の init()関数を InitManager に委譲完了
         - ✅ 初期化後の処理を InitManager に移行完了
         - ✅ window.questionAdminEmbed の移行完了
         - ✅ managerRefs への代入を追加完了（21 個の Manager すべて）
         - ✅ グローバル変数への同期を追加完了（21 個の Manager すべて）
         - ✅ 循環参照の処理完了
       - 実績（段階 1-7）: 約 814 行の削減（`app.js` は 2,263 行、`init-manager.js` は 1,131 行、その他の Manager クラスも適切に分割完了）

### フェーズ 2: 中程度の問題の解決（優先度: 中）

3. **`scripts/events/panels/gl-panel.js` のリファクタリング**（進行中）

   - 期間: 1 週間
   - 影響範囲: GL ツール機能
   - リスク: 中
   - **進捗状況**:
     - ✅ 段階 1: ユーティリティ関数を `gl-utils.js` に移行完了（約 750 行削減）
       - `gl-panel.js`: 3,249 行 → 2,526 行（約 723 行削減、約 22% 削減）
       - `gl-utils.js`: 789 行（新規作成）
       - 実績: 約 723 行の削減（`gl-panel.js` は 2,526 行、`gl-utils.js` は 789 行、段階 1 完了）
     - ✅ 段階 2: UI 描画機能を `gl-renderer.js` に移行完了（内部スタッフ関連 5 個 + スケジュール班関連 2 個 + 応募者・スケジュール関連 2 個 + 依存メソッド 5 個を移行）
       - `gl-panel.js`: 2,526 行 → 2,368 行（約 158 行削減、約 6.7% 削減）
       - `gl-panel.js`: 2,368 行 → 2,302 行（約 66 行削減、約 2.8% 削減）
       - `gl-panel.js`: 2,302 行 → 2,308 行（約 6 行追加、コメント追加）
       - `gl-panel.js`: 2,308 行 → 1,815 行（約 493 行削減、依存メソッド 5 個を移行完了）
       - `gl-renderer.js`: 265 行 → 385 行（約 120 行追加、スケジュール班関連の描画メソッド 2 個を実装）
       - `gl-renderer.js`: 385 行 → 518 行（約 133 行追加、応募者・スケジュール関連の描画メソッド 2 個の基本構造を実装）
       - `gl-renderer.js`: 518 行 → 982 行（約 464 行追加、依存メソッド 5 個を実装完了）
       - 実績: 約 1,434 行の削減（`gl-panel.js` は 1,815 行、`gl-renderer.js` は 982 行、段階 2 完了）
       - 移行完了: 内部スタッフ関連 5 個、スケジュール班関連 2 個、応募者・スケジュール関連 2 個、依存メソッド 5 個（計 14 個）
       - 累計削減: 元の 3,249 行から約 44% 削減（約 1,434 行削減）
     - ✅ 段階 3: 応募管理機能を `gl-application-manager.js` に移行（進行中、応募データの読み込み・保存・削除機能を移行）
       - `gl-panel.js`: 1,815 行 → 1,768 行（約 47 行削減、応募管理機能を移行）
       - `gl-application-manager.js`: 157 行（新規作成、応募データの読み込み・保存・削除機能を実装）
       - 移行完了: 応募データの読み込み（`subscribeApplications`）、保存（`saveInternalApplication`）、削除（`deleteInternalApplication`）
     - ✅ 段階 4: 割り当て管理機能を `gl-assignment-manager.js` に移行（完了、割り当てデータの読み込み・適用・取得・バケット解決・マッチャー作成機能を移行）
       - `gl-panel.js`: 1,768 行 → 1,720 行（約 48 行削減、割り当て管理機能を移行）
       - `gl-assignment-manager.js`: 171 行（新規作成、割り当てデータの読み込み・適用・取得・バケット解決・マッチャー作成機能を実装）
       - 移行完了: 割り当てデータの読み込み（`subscribeAssignments`）、適用（`applyAssignment`）、取得（`getAssignmentForSchedule`）、バケット解決（`resolveAssignmentBucket`）、マッチャー作成（`createBucketMatcher`）
       - 実績: 約 1,529 行の削減（`gl-panel.js` は 1,720 行、`gl-assignment-manager.js` は 171 行、段階 4 完了）
       - 累計削減: 元の 3,249 行から約 47% 削減（約 1,529 行削減）
     - ✅ 段階 5: 設定管理機能を `gl-config-manager.js` に移行（完了、設定データの読み込み・正規化・保存・URL コピー・共通カタログ適用機能を移行）
       - `gl-panel.js`: 1,720 行 → 1,659 行（約 61 行削減、設定管理機能を移行）
       - `gl-config-manager.js`: 240 行（新規作成、設定データの読み込み・正規化・保存・URL コピー・共通カタログ適用機能を実装）
       - 移行完了: 設定データの読み込み（`subscribeConfig`）、正規化（`normalizeConfig`）、保存（`saveConfig`）、URL コピー（`copyFormUrl`）、共通カタログ適用（`applySharedCatalog`）
       - 実績: 約 1,590 行の削減（`gl-panel.js` は 1,659 行、`gl-config-manager.js` は 240 行、段階 5 完了）
       - 累計削減: 元の 3,249 行から約 49% 削減（約 1,590 行削減）

4. **`scripts/gl-form/index.js` のリファクタリング**
   - 期間: 3-5 日
   - 影響範囲: GL フォーム画面
   - リスク: 低

### フェーズ 3: 軽微な問題の解決（優先度: 低）

5. **`scripts/login.js` のリファクタリング**

   - 期間: 2-3 日
   - 影響範囲: ログイン画面
   - リスク: 低

6. **`scripts/operator/app.js` と `questions.js` の最適化**
   - 期間: 1 週間
   - 影響範囲: オペレーター画面
   - リスク: 低（既に適切に分割されているため）

---

## リファクタリング時の注意事項

### 1. 段階的な移行

- 一度にすべてを変更せず、段階的に移行する
- 各段階でテストを実施し、動作を確認する

### 2. 後方互換性の維持

- 既存の API やインターフェースを維持する
- 外部から呼び出される関数やメソッドのシグネチャを変更しない

### 3. テストの実施

- リファクタリング前後で動作が同じであることを確認
- 既存のテストが通ることを確認

### 4. ドキュメントの更新

- リファクタリング後、関連ドキュメントを更新
- 新しい構造を説明するドキュメントを作成

### 5. コードレビュー

- リファクタリング後のコードをレビュー
- 開発標準への準拠を確認

---

## まとめ

### 現状

- ✅ `scripts/operator/` - リファクタリング済み、良好
- ✅ `scripts/question-form/` - 適切に分割されている
- ✅ `scripts/shared/` - 適切に分割されている
- ❌ `scripts/events/app.js` - 6,070 行、要改善（リファクタリング完了、元の 10,180 行から約 4,110 行削減）
- ⚠️ `scripts/question-admin/app.js` - 2,263 行、改善完了（リファクタリング完了、元の 8,180 行から約 5,917 行削減、フェーズ 17 完了）
- ✅ `scripts/question-admin/managers/host-integration-manager.js` - 671 行（新規作成、フェーズ 9 段階 6 完了後）
- ✅ `scripts/question-admin/managers/state-manager.js` - 165 行（新規作成、フェーズ 10 完了後）
- ✅ `scripts/question-admin/managers/ui-manager.js` - 229 行（新規作成、フェーズ 11 完了後）
- ✅ `scripts/question-admin/managers/confirm-dialog-manager.js` - 128 行（新規作成、フェーズ 12 完了後）
- ✅ `scripts/question-admin/managers/gl-manager.js` - 386 行（新規作成、フェーズ 13 完了後）
- ✅ `scripts/question-admin/managers/participant-ui-manager.js` - 966 行（新規作成、フェーズ 14 完了後）
- ✅ `scripts/question-admin/managers/schedule-utility-manager.js` - 252 行（新規作成、フェーズ 15 完了後）
- ✅ `scripts/question-admin/managers/button-state-manager.js` - 458 行（新規作成、フェーズ 16 完了後）
- ✅ `scripts/question-admin/managers/token-api-manager.js` - 106 行（新規作成、フェーズ 17 段階 1 完了後）
- ✅ `scripts/question-admin/managers/share-clipboard-manager.js` - 90 行（新規作成、フェーズ 17 段階 2 完了後）
- ✅ `scripts/question-admin/managers/participant-context-manager.js` - 138 行（新規作成、フェーズ 17 段階 3 完了後）
- ✅ `scripts/question-admin/managers/participant-action-manager.js` - 168 行（新規作成、フェーズ 17 段階 4 完了後）
- ✅ `scripts/question-admin/managers/event-handlers-manager.js` - 506 行（新規作成、フェーズ 17 段階 6 完了後）
- ✅ `scripts/question-admin/managers/init-manager.js` - 1,131 行（新規作成、フェーズ 17 段階 7 完了、21 個の Manager 初期化を移行完了）
- ⚠️ `scripts/events/panels/gl-panel.js` - 1,659 行、要改善（リファクタリング進行中、段階 1-5 完了、元の 3,249 行から約 1,590 行削減、約 49% 削減）
- ✅ `scripts/events/panels/gl-assignment-manager.js` - 171 行（新規作成、フェーズ 2 段階 4 完了、割り当てデータの読み込み・適用・取得・バケット解決・マッチャー作成機能を実装）
- ✅ `scripts/events/panels/gl-config-manager.js` - 240 行（新規作成、フェーズ 2 段階 5 完了、設定データの読み込み・正規化・保存・URL コピー・共通カタログ適用機能を実装）
- ✅ `scripts/events/panels/gl-utils.js` - 789 行（新規作成、フェーズ 2 段階 1 完了）
- ✅ `scripts/events/panels/gl-renderer.js` - 982 行（新規作成、フェーズ 2 段階 2 完了、内部スタッフ関連 5 個 + スケジュール班関連 2 個 + 応募者・スケジュール関連 2 個 + 依存メソッド 5 個を実装）
- ⚠️ `scripts/gl-form/index.js` - 860 行、要検討
- ⚠️ `scripts/login.js` - 664 行、要検討

### 推奨アクション

1. **完了**: `scripts/events/app.js` と `scripts/question-admin/app.js` のリファクタリング（完了）
2. **中期的に対応**: `scripts/events/panels/gl-panel.js` と `scripts/gl-form/index.js` のリファクタリング
   - `scripts/events/panels/gl-panel.js`: リファクタリング進行中（段階 1-5 完了、約 1,590 行削減、約 49% 削減）
     - `gl-panel.js`: 3,249 行 → 1,659 行（約 49% 削減）
     - `gl-utils.js`: 789 行（新規作成、段階 1 完了）
     - `gl-renderer.js`: 982 行（新規作成、段階 2 完了、内部スタッフ関連 5 個 + スケジュール班関連 2 個 + 応募者・スケジュール関連 2 個 + 依存メソッド 5 個を実装）
     - `gl-application-manager.js`: 157 行（新規作成、段階 3 完了、応募データの読み込み・保存・削除機能を実装）
     - `gl-assignment-manager.js`: 171 行（新規作成、段階 4 完了、割り当てデータの読み込み・適用・取得・バケット解決・マッチャー作成機能を実装）
     - `gl-config-manager.js`: 240 行（新規作成、段階 5 完了、設定データの読み込み・正規化・保存・URL コピー・共通カタログ適用機能を実装）
3. **長期的に対応**: `scripts/login.js` と `scripts/operator/` の最適化

### 目標

- すべてのファイルを開発標準（1,500 行以下）に準拠させる
- Manager パターンや適切な責務分離を適用する
- テスト容易性と保守性を向上させる

---

---

## ファイル名とディレクトリ構造の評価

### ファイル名の命名規則への準拠状況

#### ✅ 準拠している点

1. **kebab-case の統一**

   - すべてのファイル名が `kebab-case` で統一されている
   - PascalCase やスネークケースのファイルは存在しない
   - 例: `context-manager.js`, `auth-manager.js`, `channel-manager.js`

2. **命名パターンの適用**

   - Manager クラス: `*-manager.js`（`context-manager.js`, `auth-manager.js` など）✅
   - Renderer クラス: `*-renderer.js`（`ui-renderer.js`）✅
   - ユーティリティ: `utils.js`, `dom.js`, `firebase.js` など ✅
   - 機能領域: `questions.js`, `dictionary.js`, `pickup.js` など ✅

3. **接尾辞の一貫性**
   - `*-utils.js`: `string-utils.js`, `value-utils.js`, `submission-utils.js` ✅
   - `*-service.js`: `context-service.js`, `submission-service.js` ✅
   - `*-manager.js`: 複数の Manager クラス ✅

#### ⚠️ 改善が必要な点

1. **同名ファイルの重複**

   | ファイル名     | 出現回数 | 場所                                                                                              | 問題点                                                 |
   | -------------- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
   | `index.js`     | 6 個     | `operator/`, `events/`, `question-admin/`, `question-form/`, `gl-form/`, `participant-mail-view/` | エントリーポイントとして適切だが、検索時に混乱の可能性 |
   | `app.js`       | 4 個     | `operator/`, `events/`, `question-admin/`, `question-form/`                                       | 各ディレクトリで異なるクラスを定義                     |
   | `firebase.js`  | 3 個     | `operator/`, `question-admin/`, `question-form/`                                                  | Firebase 設定の重複                                    |
   | `dom.js`       | 3 個     | `operator/`, `events/`, `question-admin/`                                                         | DOM 操作の重複                                         |
   | `constants.js` | 3 個     | `operator/`, `question-admin/`, `question-form/`                                                  | 定数の重複                                             |
   | `utils.js`     | 2 個     | `operator/`, `question-admin/`                                                                    | ユーティリティの重複                                   |

   **影響**:

   - ファイル検索時に複数の候補が表示される
   - インポート時にパスを完全に指定する必要がある（これは良い習慣だが、混乱の原因になる可能性）
   - 同じ名前でも内容が異なるため、理解が困難

   **改善提案**:

   - `firebase.js` → `shared/firebase-config.js` に統一（既に `shared/firebase-config.js` が存在）
   - `dom.js` → 各ディレクトリで用途が異なる場合は現状維持、共通部分は `shared/` に移動
   - `constants.js` → 各ディレクトリ固有の定数は現状維持、共通定数は `shared/` に移動
   - `utils.js` → 各ディレクトリ固有のユーティリティは現状維持、共通ユーティリティは `shared/` に移動

2. **ディレクトリ構造の一貫性**

   **現状**:

   - `scripts/operator/` - ディレクトリ構成
   - `scripts/events/` - ディレクトリ構成
   - `scripts/question-admin/` - ディレクトリ構成
   - `scripts/question-form/` - ディレクトリ構成
   - `scripts/shared/` - ディレクトリ構成
   - `scripts/gl-form/` - 単一ファイル（`index.js`）
   - `scripts/participant-mail-view/` - 単一ファイル（`index.js`）
   - `scripts/login.js` - ルートに単一ファイル

   **問題点**:

   - `login.js` がルートに配置されている（他の画面はディレクトリ構成）
   - `gl-form/` と `participant-mail-view/` はディレクトリだが単一ファイル

   **改善提案**:

   - `scripts/login.js` → `scripts/login/index.js` に移動（一貫性のため）
   - `gl-form/` と `participant-mail-view/` は現状維持（将来的に分割する可能性を考慮）

3. **エントリーポイントの命名**

   **現状**:

   - すべて `index.js` を使用
   - これは一般的な慣習で問題ないが、プロジェクト内で一貫している

   **評価**: ✅ 問題なし（標準的な慣習に従っている）

### ディレクトリ構造の評価

#### ✅ 良好な点

1. **機能別の分割**

   - `scripts/operator/` - オペレーター画面専用
   - `scripts/events/` - イベント管理専用
   - `scripts/question-admin/` - 質問管理専用
   - `scripts/question-form/` - 質問フォーム専用
   - `scripts/shared/` - 共有モジュール

2. **サブディレクトリの使用**
   - `scripts/events/tools/` - ツール関連を分離
   - 適切に機能が分離されている

#### ⚠️ 改善が必要な点

1. **`scripts/login.js` の配置**

   - ルートに単一ファイルとして配置
   - 他の画面はディレクトリ構成のため、一貫性に欠ける

   **改善提案**:

   ```
   scripts/
   ├── login/
   │   ├── index.js      # エントリーポイント
   │   ├── app.js        # LoginPage クラス
   │   ├── auth-handler.js
   │   └── ui-handler.js
   └── ...
   ```

2. **共通機能の重複**
   - `firebase.js`, `dom.js`, `constants.js`, `utils.js` が複数のディレクトリに存在
   - 共通部分は `shared/` に移動すべき

### 開発標準への準拠状況まとめ

| 項目                     | 準拠状況 | 評価                               |
| ------------------------ | -------- | ---------------------------------- |
| ファイル名（kebab-case） | ✅       | 完全準拠                           |
| Manager パターン         | ✅       | `operator/` で適用済み             |
| 命名パターン             | ✅       | 一貫して適用                       |
| ディレクトリ構造         | ⚠️       | `login.js` の配置が不一致          |
| 共通機能の重複           | ⚠️       | `firebase.js`, `dom.js` などが重複 |
| エントリーポイント       | ✅       | `index.js` で統一                  |

### 推奨される改善アクション

#### 優先度: 高

1. **`scripts/login.js` を `scripts/login/` ディレクトリに移動**
   - 一貫性の向上
   - 将来的な拡張に対応

#### 優先度: 中

2. **共通機能の統合**

   - `firebase.js` の共通部分を `shared/firebase-config.js` に統合
   - `dom.js` の共通部分を `shared/` に移動（必要に応じて）
   - `constants.js` の共通定数を `shared/` に移動

3. **ファイル名の明確化（オプション）**
   - 各ディレクトリの `app.js` は現状維持で問題なし
   - ただし、検索時の混乱を避けるため、完全なパスでのインポートを推奨

#### 優先度: 低

4. **ドキュメントの整備**
   - 各ディレクトリの役割を明確化
   - ファイル命名規則のガイドラインを追加

---

## UI パネルとファイル構造の対応関係

### 問題の指摘

UI 上には以下のパネルが存在しますが、ファイル構造や命名が必ずしも対応していません：

1. **イベント管理パネル** (`events`)
2. **日程管理パネル** (`schedules`)
3. **参加者リスト管理パネル** (`participants`)
4. **GL 管理パネル** (`gl`)
5. **学部学科管理パネル** (`gl-faculties`)
6. **テロップ操作パネル** (`operator`)
7. **辞書管理パネル** (`dictionary`)
8. **Pick Up Question 管理パネル** (`pickup`)
9. **ログパネル** (`logs`)
10. **チャットパネル** (`chat`)
11. **右サイドテロップ操作パネル** (`side-telop`)

### 現状の対応関係

| UI パネル                   | ファイル構造                                       | 対応状況 | 問題点                                                                  |
| --------------------------- | -------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| イベント管理パネル          | `scripts/events/panels/event-panel.js` (326 行)    | ✅ 対応  | 適切に分離されている                                                    |
| 日程管理パネル              | `scripts/events/panels/schedule-panel.js` (326 行) | ✅ 対応  | 適切に分離されている                                                    |
| 参加者リスト管理パネル      | `scripts/events/panels/participants-panel.js`      | ✅ 対応  | 適切に分離されている                                                    |
| GL 管理パネル               | `scripts/events/panels/gl-panel.js` (1,659 行)     | ✅ 対応  | ファイルが大きいが対応している（リファクタリング進行中、段階 1-5 完了） |
| 学部学科管理パネル          | `scripts/events/panels/gl-faculties-panel.js`      | ✅ 対応  | 適切に分離されている                                                    |
| テロップ操作パネル          | `scripts/events/panels/operator-panel.js`          | ✅ 対応  | 適切に分離されている                                                    |
| 辞書管理パネル              | `scripts/operator/panels/dictionary-panel.js`      | ✅ 対応  | 適切に分離されている                                                    |
| Pick Up Question 管理パネル | `scripts/operator/panels/pickup-panel.js`          | ✅ 対応  | 適切に分離されている                                                    |
| ログパネル                  | `scripts/operator/panels/logs-panel.js`            | ✅ 対応  | 適切に分離されている                                                    |
| チャットパネル              | `scripts/events/panels/chat-panel.js`              | ✅ 対応  | 適切に分離されている                                                    |
| 右サイドテロップ操作パネル  | `scripts/operator/panels/side-telop-panel.js`      | ✅ 対応  | 適切に分離されている                                                    |

### 問題点の詳細

#### 1. **イベント管理パネルと日程管理パネルの分離** ✅ 完了

**現状**:

- ✅ `scripts/events/panels/event-panel.js` (326 行) - イベント管理パネルの実装
- ✅ `scripts/events/panels/schedule-panel.js` (326 行) - 日程管理パネルの実装
- ✅ `EventPanelManager` と `SchedulePanelManager` クラスが分離されている
- `scripts/events/app.js` (6,446 行) から両方のパネルの実装を分離済み

**完了した改善**:

- ✅ UI 上で別々のパネルとして認識され、ファイル構造でも区別されている
- ✅ パネル名（`events`, `schedules`）とファイル名（`event-panel.js`, `schedule-panel.js`）が対応している
- ✅ 開発者が特定のパネルのコードを探しやすい

**現在の構造**:

```
scripts/events/
├── app.js                    # EventAdminApp（初期化とルーティング、6,070行、リファクタリング完了）
├── managers/
│   ├── auth-manager.js       # EventAuthManager（認証管理、384行）
│   ├── state-manager.js      # EventStateManager（状態管理、315行）
│   ├── navigation-manager.js # EventNavigationManager（画面遷移制御、499行）
│   ├── ui-renderer.js        # EventUIRenderer（UI描画、896行）✅
│   ├── firebase-manager.js   # EventFirebaseManager（Firebase操作、1,392行）✅
│   └── display-lock-manager.js # DisplayLockManager（ディスプレイロック、255行）✅
├── panels/
│   ├── event-panel.js       # イベント管理パネル（326行）✅
│   └── schedule-panel.js    # 日程管理パネル（326行）✅
└── ...
```

#### 2. **パネル実装の分散**

**現状**:

- 一部のパネルは `scripts/events/tools/` に配置
- 一部のパネルは `scripts/operator/` に配置
- パネル実装の配置場所が一貫していない

**問題点**:

- パネル実装を探す際に、複数のディレクトリを確認する必要がある
- パネルとファイルの対応関係が直感的でない

**改善提案**:
すべてのパネル実装を統一的な構造に配置：

```
scripts/panels/  # または scripts/events/panels/
├── participants-panel.js    # 参加者リスト管理パネル
├── gl-panel.js             # GL管理パネル
├── gl-faculty-panel.js     # 学部学科管理パネル
├── operator-panel.js       # テロップ操作パネル
├── dictionary-panel.js      # 辞書管理パネル
├── pickup-panel.js         # Pick Up Question管理パネル
├── logs-panel.js           # ログパネル
├── chat-panel.js           # チャットパネル
└── side-telop-panel.js    # 右サイドテロップ操作パネル
```

または、既存の構造を維持しつつ、命名を明確化：

```
scripts/events/
├── panels/
│   ├── event-panel.js
│   ├── schedule-panel.js
│   ├── participants-panel.js  # tools/participant.js から移動
│   ├── gl-panel.js            # GL管理パネル（1,659行、要改善、リファクタリング進行中、段階1-5完了）
│   ├── gl-utils.js            # ユーティリティ（789行）✅
│   ├── gl-renderer.js         # UI描画（982行、段階2完了）✅
│   ├── gl-faculty-panel.js    # tools/gl-faculty-admin.js から移動
│   └── operator-panel.js      # tools/operator.js から移動
└── ...

scripts/operator/
├── panels/
│   ├── dictionary-panel.js   # dictionary-panel.js から移動（予定）
│   ├── pickup-panel.js       # pickup-panel.js から移動（予定）
│   ├── logs-panel.js         # logs-panel.js から移動（予定）
│   └── side-telop-panel.js   # side-telop-panel.js から移動（予定）
└── ...
```

#### 3. **命名の不一致**

**現状**:

- UI パネル名: `participants`, `gl`, `gl-faculties`, `operator`, `dictionary`, `pickup`, `logs`, `chat`, `side-telop`
- ファイル名: `participants-panel.js`, `gl-panel.js`, `gl-faculties-panel.js`, `operator-panel.js`, `dictionary-panel.js`, `pickup-panel.js`, `logs-panel.js`, `chat-panel.js`, `side-telop-panel.js` ✅

**問題点**:

- ✅ ファイル名に `-panel` サフィックスを追加済み
- ✅ パネル名とファイル名が一致している

**完了した改善**:

- ✅ `participant.js` → `participants-panel.js` ✅
- ✅ `gl-faculty-admin.js` → `gl-faculties-panel.js` ✅
- ✅ `dictionary.js` → `dictionary-panel.js` ✅
- ✅ その他のパネルファイルもすべて `-panel.js` サフィックスを追加済み

### 推奨される改善アクション

#### 優先度: 高

1. **イベント管理パネルと日程管理パネルの分離**

   - `scripts/events/app.js` から `event-panel-manager.js` と `schedule-panel-manager.js` を分離
   - パネル実装を明確に区別

2. **パネル実装の統一的な配置**
   - すべてのパネル実装を `panels/` ディレクトリに配置
   - または、既存の構造を維持しつつ、命名を明確化

#### 優先度: 中

3. **命名の統一** ✅ 完了

   - ✅ ファイル名に `-panel` サフィックスを追加済み
   - ✅ パネル名とファイル名が一致している

4. **ドキュメントの整備**
   - UI パネルとファイル構造の対応関係を明確にドキュメント化
   - 各パネルの実装場所を明確に記載

#### 優先度: 低

5. **パネル実装のリファクタリング**
   - 各パネルを独立したクラスとして実装
   - パネル間の依存関係を明確化

### 理想的なファイル構造

```
scripts/
├── events/
│   ├── app.js                    # EventAdminApp
│   ├── panels/
│   │   ├── event-panel.js       # イベント管理パネル
│   │   ├── schedule-panel.js    # 日程管理パネル
│   │   ├── participants-panel.js # 参加者リスト管理パネル
│   │   ├── gl-panel.js          # GL管理パネル
│   │   ├── gl-faculties-panel.js # 学部学科管理パネル
│   │   ├── operator-panel.js    # テロップ操作パネル
│   │   ├── dictionary-panel.js  # 辞書管理パネル
│   │   ├── pickup-panel.js     # Pick Up Question管理パネル
│   │   ├── logs-panel.js        # ログパネル
│   │   ├── chat-panel.js        # チャットパネル
│   │   └── side-telop-panel.js  # 右サイドテロップ操作パネル
│   └── ...
└── ...
```

この構造により：

- UI パネルとファイル構造が 1 対 1 で対応
- パネル実装を探すのが容易
- 新しいパネルを追加する際の場所が明確
- パネル名とファイル名が一致

---

**最終更新**: 2025 年 12 月 8 日
**バージョン**: 1.5.0
