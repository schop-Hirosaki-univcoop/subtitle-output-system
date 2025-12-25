# フェーズ 3: Vue.js 移行の続き（MVC モデル準拠）

## 概要

Phase 2 では、オペレーター画面の質問カード部分のみを Vue.js に移行しました。Phase 3 では、残りの部分を段階的に Vue.js に移行し、MVC モデルに準拠させます。

## 現在の状態

### Phase 2 で完了した部分

- ✅ オペレーター画面の質問カード表示（`QuestionCard.vue`, `QuestionList.vue`）
- ✅ Vite と Vue.js 3 のセットアップ
- ✅ GitHub Actions でのビルドとデプロイ
- ✅ `useOperatorApp.js` Composable の作成（`OperatorApp`へのアクセスを提供）

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
   - `ParticipantUIManager`: 参加者 UI 管理
   - `ParticipantContextManager`: 参加者コンテキスト管理
   - `ParticipantActionManager`: 参加者アクション管理
   - `TokenApiManager`: トークン API 管理
   - `ShareClipboardManager`: クリップボード共有管理
   - `ScheduleUtilityManager`: 日程ユーティリティ管理
   - `EventHandlersManager`: イベントハンドラー管理
   - `InitManager`: 初期化管理

4. **`QuestionFormApp`** (`scripts/question-form/app.js`)

   - 約 550 行
   - 質問フォーム（`question-form.html`）
   - 既に`FormView`クラス（`view.js`）で View 層が分離されている（MVC モデルに準拠）

5. **`LoginPage`** (`scripts/login.js`)

   - 約 655 行
   - ログイン画面（`login.html`）
   - Firebase 認証のログイン UI を提供
   - Google OAuth によるサインイン操作

6. **GL 応募フォーム** (`scripts/gl-form/`)

   - GL 応募フォーム（`gl-form.html`）
   - `GlFormManager`と`GlFormDataManager`を使用
   - フォーム入力・送信機能

7. **テロップ表示画面** (`display.html`)
   - イベントで表示するテロップ画面
   - インラインスクリプトで実装されている
   - リアルタイム表示用で、パフォーマンスが重要

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
- `GlToolManager`: GL リスト管理パネル管理（`ToolCoordinator`内）
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
   - `QuestionAdminApp`を埋め込みツールとして使用（`ParticipantToolManager`が管理）

4. **GL リスト管理パネル** (`events/panels/gl-panel.js`) - ショートカットキー: `4`

   - GL 応募フォームの設定
   - 応募者の学部学科・シフト可否の確認
   - 班割りステータスの更新
   - `GlToolManager`が管理（関連 Manager: `GlApplicationManager`, `GlConfigManager`, `GlRenderer`, `GlAssignmentManager`）

5. **学部・学科管理パネル** (`events/panels/gl-faculties-panel.js`) - ショートカットキー: `5`

   - GL 応募フォームで共通利用する学部・学科の階層構造の編集

6. **テロップ操作パネル** (`events/panels/operator-panel.js`) - ショートカットキー: `6`

   - 質問の選択・送出（埋め込みツール）
   - 質問カード表示部分は既に Phase 2 で Vue に移行済み（`QuestionCard.vue`, `QuestionList.vue`）
   - `OperatorToolManager`が管理（`OperatorApp`を埋め込みツールとして使用）

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
  - `EventChat`クラスが管理

- **右サイドテロップ操作パネル** (`operator/panels/side-telop-panel.js`)

  - サイドテロップの管理（追加・編集・削除・同期）
  - `operator.html`内に実装されている（`OperatorApp`が管理）

- **バックアップ・復元機能**（ヘッダーボタン）

  - バックアップボタン（`handleBackupClick`）
  - 復元ボタン（`handleRestoreClick`）
  - データのエクスポート・インポート

- **フルスクリーン機能**（ヘッダーボタン）

  - フルスクリーンボタン（`toggleFullscreen`）
  - フルスクリーンプロンプトダイアログ

- **印刷機能**（イベント管理パネル、GL 管理パネル）

  - イベント一覧の印刷（`handleEventPrint`）
  - GL リストの印刷（`handleGlPrint`）
  - 印刷プレビュー・印刷設定ダイアログ

- **再読み込み機能**（ヘッダーボタン）
  - イベント情報の再読み込み（`refreshButton`）

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
- 既存の Manager パターンとの統合（22 個の Manager が存在）

### 優先度: 低

#### 4. 質問フォーム

**対象**: `QuestionFormApp` (`question-form.html`)

- 既に`FormView`クラスで View 層が分離されている
- MVC モデルに準拠しているため、Vue への移行は優先度が低い
- 必要に応じて、将来的に Vue コンポーネントに移行

#### 5. ログイン画面

**対象**: `LoginPage` (`login.html`)

- `scripts/login.js`に実装されている`LoginPage`クラス（約 655 行）
- Firebase 認証のログイン UI を提供
- Google OAuth によるサインイン操作
- 認証状態の監視とリダイレクト処理
- 比較的シンプルな UI のため、Vue への移行は優先度が低い
- 必要に応じて、将来的に Vue コンポーネントに移行

#### 6. GL 応募フォーム

**対象**: `GlFormManager` / `GlFormDataManager` (`gl-form.html`)

- `scripts/gl-form/`に実装されている GL 応募フォーム
- `GlFormManager`と`GlFormDataManager`を使用
- フォーム入力・送信機能
- 質問フォームと同様に、フォーム管理が分離されている可能性がある
- Vue への移行は優先度が低い
- 必要に応じて、将来的に Vue コンポーネントに移行

#### 7. テロップ表示画面

**対象**: `display.html`

- イベントで表示するテロップ画面
- インラインスクリプトで実装されている
- リアルタイム表示用で、パフォーマンスが重要
- 表示専用のため、Vue への移行は優先度が非常に低い
- 必要に応じて、将来的に Vue コンポーネントに移行

#### 8. その他の静的ページ

以下のページは静的コンテンツまたはメールテンプレートのため、Vue への移行は不要：

- **`index.html`**: アクセス案内ページ（静的ページ）
- **`participant-mail-view.html`**: 参加者メール閲覧ページ（静的ページ）
- **`email-participant-shell.html`** / **`email-participant-body.html`**: メールテンプレート（静的ページ）
- **`404.html`**: エラーページ（静的ページ）

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

**方針**: 軽い機能から順に移行し、経験を積んでから重い機能に取り組む。これにより、小さな成功を積み重ね、Vue 移行のパターンを確立してから複雑な機能に集中できる。

### Phase 3.1: 軽量な独立画面（優先度: 高 - 早期完了を目指す）

軽量で独立した画面から移行を開始し、Vue 移行のパターンを確立する。

1. **ログイン画面** ✅ **完了**

   - `LoginPage.vue`コンポーネントを作成（621 行）
   - `src/main-login.js`エントリーポイントを作成（16 行）
   - 既存の`LoginPage`クラス（`scripts/login.js`、664 行）を削除
   - Firebase 認証フローの維持
   - **移行結果**: 760 行 → 667 行（-93 行、-12.2%）
   - **改善点**: DOM 操作の削減（8 箇所 → 1 箇所）、リアクティブな状態管理、宣言的なテンプレート（103 箇所のディレクティブ）
   - **理由**: 比較的シンプルで独立した画面。Vue 移行の基礎パターンを確立できる

2. **質問フォーム** ✅ **完了**

   - `QuestionForm.vue`コンポーネントを作成
   - `src/main-question-form.js`エントリーポイントを作成
   - 既存の`QuestionFormApp`（約 550 行）と`FormView`（約 480 行）の機能を統合
   - リアクティブな状態管理、バリデーション、フォーム送信処理を実装
   - **移行時の修正内容**:
     - 入力値のバインディングを`:value`から`v-model`に変更（双方向バインディングを実現）
     - コンテキスト取得時のエラーハンドリングを改善
     - Firebase セキュリティルールを更新：参加者情報の`name`フィールドのみ公開読み取り可能に変更
       - `questionIntake/participants/{eventId}/{scheduleId}/{participantId}/name`を誰でも読み取り可能に
       - 他の機密フィールド（email, phone, token 等）は管理者のみ読み取り可能のまま
   - **移行結果**: `QuestionFormApp`と`FormView`の DOM 操作を Vue のテンプレートとリアクティビティに置き換え
   - **理由**: 既に`FormView`で View 層が分離されており、移行が比較的容易

3. **GL 応募フォーム**

   - `GlForm.vue`コンポーネントを作成
   - 既存の`GlFormManager`と`GlFormDataManager`と統合
   - **理由**: 質問フォームと同様の構造で、フォーム管理が分離されている

**期待される効果**:

- Vue 移行の基本的なパターンを確立
- 小さな成功を積み重ね、チームのモチベーションを維持
- フォーム系の移行ノウハウを蓄積

### Phase 3.2: テロップ操作パネル（`OperatorApp`）の残りの部分（優先度: 高）

`OperatorApp`の埋め込みツールとして使用されるパネルを移行する。

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

**注意**: テロップ操作パネル（`OperatorApp`）、ルビ辞書管理、Pick Up Question 管理、操作ログは`EventAdminApp`の埋め込みツールとして`operator.html`に統合されているため、`EventAdminApp`の移行（Phase 3.4）と連携が必要

### Phase 3.3: 質問管理画面（優先度: 中）

`QuestionAdminApp`（約 2,200 行）の主要機能を移行する。

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

### Phase 3.4: イベント管理画面（優先度: 高 - 最も重い機能）

`EventAdminApp`（約 6,700 行）の主要機能を移行する。最も複雑で大規模な機能のため、Phase 3.1-3.3 で経験を積んでから取り組む。

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

7. **その他の機能**（優先度: 低）

   - **バックアップ・復元機能**: ヘッダーボタンの機能として実装（Vue 移行の優先度は低い）
   - **フルスクリーン機能**: ヘッダーボタンの機能として実装（Vue 移行の優先度は低い）
   - **印刷機能**: イベント一覧・GL リストの印刷機能（Vue 移行の優先度は低い）
   - **再読み込み機能**: ヘッダーボタンの機能として実装（Vue 移行の優先度は低い）

### Phase 3.5: テロップ表示画面（優先度: 非常に低い）

1. **テロップ表示画面**

   - `DisplayView.vue`コンポーネントを作成
   - 既存のインラインスクリプトと統合
   - パフォーマンスを最優先に考慮
   - **理由**: 表示専用で、リアルタイム表示のパフォーマンスが最重要。Vue 移行の優先度は非常に低い

**注意**: 静的ページ（`index.html`、`participant-mail-view.html`、`email-*.html`、`404.html`）は Vue への移行対象外

## 技術的な考慮事項

### 1. コンポーネント設計

- **単一責任の原則**: 各コンポーネントは 1 つの責務を持つ
- **再利用性**: 共通の UI 要素は再利用可能なコンポーネントとして作成
- **プロップスとイベント**: 親子コンポーネント間の通信はプロップスとイベントで行う

### 2. 状態管理

- **Composables**: 共通の状態管理ロジックは Composable として作成
  - 既存の`useOperatorApp.js`を参考に、必要に応じて追加の Composable を作成
  - `EventAdminApp`や`QuestionAdminApp`へのアクセスを提供する Composable の作成を検討
- **既存の Manager パターン**: Manager パターンとの統合を維持
- **Firebase リスナー**: Firebase のリアルタイム更新を Vue のリアクティブシステムと統合

### 4. 移行時の注意点

#### フォーム入力のバインディング

- **`:value`ではなく`v-model`を使用**: 双方向バインディングを実現するため、フォーム入力には`v-model`を使用する
  - `:value`だけでは入力値が更新されない
  - 例: `<input v-model="radioName" />` ではなく `<input :value="radioName" />` は動作しない

#### Firebase セキュリティルール

- **親ノードの制限が優先される**: Firebase Realtime Database のセキュリティルールでは、親ノードが`.read: false`の場合、子ノードで`.read: true`を設定しても読み取れない
  - 子ノードを読み取り可能にするには、親ノードも読み取り可能にする必要がある
  - 例: `questionIntake/participants/{eventId}/{scheduleId}/{participantId}/name`を読み取り可能にするには、`$scheduleId`の`.read`も`true`にする必要がある
- **参加者情報の公開**: 質問フォームで参加者名を表示するため、`name`フィールドのみ公開読み取り可能に変更
  - 他の機密フィールド（email, phone, token 等）は管理者のみ読み取り可能のまま

### 3. パフォーマンス

- **遅延読み込み**: 大きなコンポーネントは動的インポートで遅延読み込み
- **メモ化**: 計算コストの高い処理は`computed`でメモ化
- **仮想スクロール**: 大量のリスト表示には仮想スクロールを検討

## 次のステップ

1. **Phase 3.1 の開始（軽量な独立画面）**

   - ログイン画面から移行を開始
   - 動作確認を実施
   - Vue 移行の基本的なパターンを確立

2. **段階的な移行**

   - 各機能を移行した後、動作確認を実施
   - 問題がなければ次の機能に進む
   - 軽い機能から順に進め、経験を積んでから重い機能に取り組む

3. **パフォーマンスの最適化**
   - 移行完了後、パフォーマンスの最適化を実施
   - Firebase リスナーやイベントベースの更新に変更

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
