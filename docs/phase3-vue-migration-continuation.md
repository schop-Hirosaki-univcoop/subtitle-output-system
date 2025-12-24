# フェーズ 3: Vue.js 移行の続き（MVC モデル準拠）

## 概要

Phase 2 では、オペレーター画面の質問カード部分のみを Vue.js に移行しました。Phase 3 では、残りの部分を段階的に Vue.js に移行し、MVC モデルに準拠させます。

## 現在の状態

### Phase 2 で完了した部分

- ✅ オペレーター画面の質問カード表示（`QuestionCard.vue`, `QuestionList.vue`）
- ✅ Vite と Vue.js 3 のセットアップ
- ✅ GitHub Actions でのビルドとデプロイ

### 残っている主要なアプリケーションクラス

1. **`EventAdminApp`** (`scripts/events/app.js`)

   - 約 6,700 行
   - イベント管理画面（`operator.html`に実装）
   - イベント・日程の管理、参加者リスト、GL 管理など
   - **9 つのパネル**（ショートカットキー 1-9）+ **オペレーターチャットパネル** + **右サイドテロップ操作パネル**

2. **`OperatorApp`** (`scripts/operator/app.js`)

   - 約 2,600 行
   - テロップ操作パネル（`operator.html`内の埋め込みツールとして使用）
   - 質問カード表示、辞書、ピックアップ、ログ、サイドテロップなどの管理
   - 埋め込み環境でも動作する設計（`operatorEmbed` API を提供）

   **構造**: Manager パターンが採用されている

   - `AuthManager`: 認証管理
   - `PresenceManager`: プレゼンス管理
   - `ContextManager`: コンテキスト管理
   - `ChannelManager`: チャンネル管理
   - `UIRenderer`: UI 描画

3. **`QuestionAdminApp`** (`scripts/question-admin/app.js`)

   - 約 2,200 行
   - 質問管理機能（`operator.html`に埋め込まれている）
   - 参加者管理、印刷機能、GL 管理など

   **構造**: Manager パターンが広く採用されている（22 個の Manager）

   - `AuthManager`: 認証管理
   - `ParticipantManager`: 参加者管理
   - `ScheduleManager`: 日程管理
   - `EventManager`: イベント管理
   - `PrintManager`: 印刷機能
   - `CsvManager`: CSV インポート・エクスポート
   - `MailManager`: メール送信
   - `GlManager`: GL 管理
   - `RelocationManager`: 参加者の移動管理
   - `HostIntegrationManager`: ホスト統合管理
   - `StateManager`: 状態管理
   - `UIManager`: UI 管理
   - `ButtonStateManager`: ボタン状態管理
   - `ConfirmDialogManager`: 確認ダイアログ管理
   - `ParticipantUIManager`: 参加者UI管理
   - `ParticipantContextManager`: 参加者コンテキスト管理
   - `ParticipantActionManager`: 参加者アクション管理
   - `TokenApiManager`: トークンAPI管理
   - `ShareClipboardManager`: クリップボード共有管理
   - `ScheduleUtilityManager`: 日程ユーティリティ管理
   - `EventHandlersManager`: イベントハンドラー管理
   - `InitManager`: 初期化管理

4. **`QuestionFormApp`** (`scripts/question-form/app.js`)
   - 約 540 行
   - 質問フォーム（`question-form.html`）
   - 既に`FormView`クラスで View 層が分離されている（MVC モデルに準拠）

## Phase 3 の移行計画

### 優先度: 高

#### 1. テロップ操作パネル（`OperatorApp`）の残りの部分

**対象**: `OperatorApp`の他の機能（`operator.html`内の埋め込みツールとして使用）

- **辞書パネル** (`operator/panels/dictionary-panel.js`)

  - ルビ辞書の管理
  - 追加・編集・削除・一括操作

- **ピックアップパネル** (`operator/panels/pickup-panel.js`)

  - Pick Up Question の管理
  - 追加・編集・削除・フィルター

- **ログパネル** (`operator/panels/logs-panel.js`)

  - 操作ログの表示
  - フィルター・更新監視

- **サイドテロップパネル** (`operator/panels/side-telop-panel.js`)
  - サイドテロップの管理
  - 追加・編集・削除・同期

**移行方法**:

- 各パネルを Vue コンポーネントに移行
- `QuestionCard`と同様に、既存のロジックと統合
- `EventAdminApp`の埋め込みツールとしての統合を維持

#### 2. イベント管理画面（`operator.html`）の主要部分

**対象**: `EventAdminApp`の主要機能（`operator.html`に実装）

**構造**: Manager パターンが採用されている

- `EventAuthManager`: 認証管理
- `EventStateManager`: 状態管理
- `EventNavigationManager`: 画面遷移制御
- `EventUIRenderer`: UI 描画
- `EventFirebaseManager`: Firebase 操作
- `DisplayLockManager`: ディスプレイロック機能
- `ToolCoordinator`: 埋め込みツールの同期管理
- `EventPanelManager`: イベント管理パネル管理
- `SchedulePanelManager`: 日程管理パネル管理
- `OperatorToolManager`: テロップ操作パネル管理（`ToolCoordinator`内）
- `ParticipantToolManager`: 参加者リストパネル管理（`ToolCoordinator`内）
- `GlToolManager`: GLリスト管理パネル管理（`ToolCoordinator`内）
- `GlFacultyAdminManager`: 学部・学科設定パネル管理（`ToolCoordinator`内）

**パネル一覧**（ショートカットキー 1-9 で切り替え可能）:

1. **イベント管理パネル** (`events/panels/event-panel.js`) - ショートカットキー: `1`

   - イベントの追加・編集・削除
   - イベント選択・一括操作

2. **日程管理パネル** (`events/panels/schedule-panel.js`) - ショートカットキー: `2`

   - 日程の追加・編集・削除
   - 日程選択・一括操作

3. **参加者リスト管理パネル** (`events/panels/participants-panel.js`) - ショートカットキー: `3`

   - 参加者情報の表示
   - 埋め込みツールとの連携

4. **GL リスト管理パネル** (`events/panels/gl-panel.js`) - ショートカットキー: `4`

   - GL 応募フォームの設定
   - 応募者の学部学科・シフト可否の確認
   - 班割りステータスの更新

5. **学部・学科管理パネル** (`events/panels/gl-faculties-panel.js`) - ショートカットキー: `5`

   - GL 応募フォームで共通利用する学部・学科の階層構造の編集

6. **テロップ操作パネル** (`events/panels/operator-panel.js`) - ショートカットキー: `6`

   - 質問の選択・送出（埋め込みツール）

7. **ルビ辞書管理パネル** (`operator/panels/dictionary-panel.js` - 埋め込みツール) - ショートカットキー: `7`

   - 登録語句の追加・更新
   - `OperatorApp`が管理（`EventAdminApp`の埋め込みツールとして使用）

8. **Pick Up Question 管理パネル** (`operator/panels/pickup-panel.js` - 埋め込みツール) - ショートカットキー: `8`

   - Pick Up Question の候補を追加・編集
   - `OperatorApp`が管理（`EventAdminApp`の埋め込みツールとして使用）

9. **操作ログパネル** (`operator/panels/logs-panel.js` - 埋め込みツール) - ショートカットキー: `9`

   - 直近の操作履歴の確認
   - `OperatorApp`が管理（`EventAdminApp`の埋め込みツールとして使用）

**その他の機能**（パネル切り替えの対象外）:

- **オペレーターチャットパネル** (`events/panels/chat-panel.js`)

  - 管理チャットの送受信（常時表示される独立した機能）

- **右サイドテロップ操作パネル** (`operator/panels/side-telop-panel.js`)
  - サイドテロップの管理（追加・編集・削除・同期）
  - `operator.html`内に実装されている（`OperatorApp`が管理）

**移行方法**:

- 各パネルを Vue コンポーネントに移行
- Manager パターンとの統合を維持
- `ToolCoordinator`との連携を維持

### 優先度: 中

#### 3. 質問管理画面

**対象**: `QuestionAdminApp`の主要機能

- **参加者管理**

  - 参加者リストの表示・編集
  - CSV インポート・エクスポート
  - 班番号の割り当て
  - 参加者の移動（日程間の移動）

- **印刷機能**

  - 印刷プレビュー
  - 印刷設定
  - 参加者リスト・スタッフリストの印刷

- **GL 管理**

  - GL 応募者の管理
  - GL リストの表示・編集

- **イベント・日程管理**

  - イベントの追加・編集・削除
  - 日程の追加・編集・削除

- **メール送信**
  - 参加者へのメール送信

**移行方法**:

- 各機能を Vue コンポーネントに移行
- 既存の Manager パターンとの統合（20 個以上の Manager が存在）

### 優先度: 低

#### 4. 質問フォーム

**対象**: `QuestionFormApp`

- 既に`FormView`クラスで View 層が分離されている
- MVC モデルに準拠しているため、Vue への移行は優先度が低い
- 必要に応じて、将来的に Vue コンポーネントに移行

## 移行の原則

### 1. 段階的な移行

- 一度にすべてを移行せず、小さな機能から始める
- 各機能を移行した後、動作確認を実施

### 2. 既存コードとの統合

- `window.__vueExperimentEnabled`フラグを使用して段階的に移行
- 既存のイベントデリゲーションを維持
- Manager パターンとの統合を維持

### 3. パフォーマンスの考慮

- 100ms ごとの更新を、Firebase リスナーやイベントベースの更新に変更
- 不要な再レンダリングを削減

## 推奨される移行順序

### Phase 3.1: テロップ操作パネル（`OperatorApp`）の残りの部分（優先度: 高）

1. **辞書パネル**

   - `DictionaryPanel.vue`コンポーネントを作成
   - 既存の`operator/panels/dictionary-panel.js`と統合
   - `EventAdminApp`の埋め込みツールとしての統合を維持

2. **ピックアップパネル**

   - `PickupPanel.vue`コンポーネントを作成
   - 既存の`operator/panels/pickup-panel.js`と統合
   - `EventAdminApp`の埋め込みツールとしての統合を維持

3. **ログパネル**

   - `LogsPanel.vue`コンポーネントを作成
   - 既存の`operator/panels/logs-panel.js`と統合
   - `EventAdminApp`の埋め込みツールとしての統合を維持

4. **サイドテロップパネル**
   - `SideTelopPanel.vue`コンポーネントを作成
   - 既存の`operator/panels/side-telop-panel.js`と統合
   - `EventAdminApp`の埋め込みツールとしての統合を維持

### Phase 3.2: イベント管理画面（優先度: 高）

1. **イベント一覧**

   - `EventList.vue`コンポーネントを作成
   - 既存の`event-panel.js`（`EventPanelManager`）と統合

2. **日程一覧**

   - `ScheduleList.vue`コンポーネントを作成
   - 既存の`schedule-panel.js`（`SchedulePanelManager`）と統合

3. **参加者リスト**

   - `ParticipantList.vue`コンポーネントを作成
   - 既存の`participants-panel.js`（`ParticipantToolManager`）と統合

4. **GL リスト管理**（優先度: 中）

   - `GlList.vue`コンポーネントを作成
   - 既存の`gl-panel.js`（`GlToolManager`）と統合

5. **学部・学科設定**（優先度: 中）

   - `GlFaculties.vue`コンポーネントを作成
   - 既存の`gl-faculties-panel.js`（`GlFacultyAdminManager`）と統合

6. **チャット機能**（優先度: 低）

   - `EventChat.vue`コンポーネントを作成
   - 既存の`chat-panel.js`（`EventChat`）と統合

**注意**: テロップ操作パネル（`OperatorApp`）、ルビ辞書管理、Pick Up Question 管理、操作ログは`EventAdminApp`の埋め込みツールとして`operator.html`に統合されているため、`OperatorApp`の移行（Phase 3.1）と同時に検討する

### Phase 3.3: 質問管理画面（優先度: 中）

1. **参加者管理**

   - `ParticipantManagement.vue`コンポーネントを作成
   - 既存の`ParticipantManager`と統合

2. **印刷機能**

   - `PrintPreview.vue`コンポーネントを作成
   - 既存の`PrintManager`と統合

3. **GL 管理**（優先度: 中）

   - `GlManagement.vue`コンポーネントを作成
   - 既存の`GlManager`と統合

4. **イベント・日程管理**（優先度: 低）

   - `EventScheduleManagement.vue`コンポーネントを作成
   - 既存の`EventManager`、`ScheduleManager`と統合

5. **メール送信**（優先度: 低）

   - `MailSender.vue`コンポーネントを作成
   - 既存の`MailManager`と統合

## 技術的な考慮事項

### 1. コンポーネント設計

- **単一責任の原則**: 各コンポーネントは 1 つの責務を持つ
- **再利用性**: 共通の UI 要素は再利用可能なコンポーネントとして作成
- **プロップスとイベント**: 親子コンポーネント間の通信はプロップスとイベントで行う

### 2. 状態管理

- **Composables**: 共通の状態管理ロジックは Composable として作成
- **既存の Manager パターン**: Manager パターンとの統合を維持
- **Firebase リスナー**: Firebase のリアルタイム更新を Vue のリアクティブシステムと統合

### 3. パフォーマンス

- **遅延読み込み**: 大きなコンポーネントは動的インポートで遅延読み込み
- **メモ化**: 計算コストの高い処理は`computed`でメモ化
- **仮想スクロール**: 大量のリスト表示には仮想スクロールを検討

## 次のステップ

1. **Phase 3.1 の開始**

   - オペレーター画面の辞書パネルから移行を開始
   - 動作確認を実施

2. **段階的な移行**

   - 各機能を移行した後、動作確認を実施
   - 問題がなければ次の機能に進む

3. **パフォーマンスの最適化**
   - 移行完了後、パフォーマンスの最適化を実施
   - Firebase リスナーやイベントベースの更新に変更

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
