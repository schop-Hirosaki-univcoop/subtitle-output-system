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
   - イベント管理画面（`index.html`）
   - イベント・日程の管理、参加者リスト、GL 管理など

2. **`OperatorApp`** (`scripts/operator/app.js`)

   - 約 2,600 行
   - オペレーター画面（`operator.html`）
   - 質問カード以外の部分（辞書、ピックアップ、ログ、サイドテロップなど）

3. **`QuestionAdminApp`** (`scripts/question-admin/app.js`)

   - 約 2,200 行
   - 質問管理機能（`operator.html`に埋め込まれている）
   - 参加者管理、質問管理、印刷機能など

4. **`QuestionFormApp`** (`scripts/question-form/app.js`)
   - 約 540 行
   - 質問フォーム（`question-form.html`）
   - 既に`FormView`クラスで View 層が分離されている（MVC モデルに準拠）

## Phase 3 の移行計画

### 優先度: 高

#### 1. オペレーター画面の残りの部分

**対象**: `OperatorApp`の他の機能

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

#### 2. イベント管理画面の主要部分

**対象**: `EventAdminApp`の主要機能

- **イベント一覧** (`events/panels/event-panel.js`)

  - イベントの追加・編集・削除
  - イベント選択・一括操作

- **日程一覧** (`events/panels/schedule-panel.js`)

  - 日程の追加・編集・削除
  - 日程選択・一括操作

- **参加者リスト** (`events/panels/participants-panel.js`)
  - 参加者情報の表示
  - 埋め込みツールとの連携

**移行方法**:

- 各パネルを Vue コンポーネントに移行
- Manager パターンとの統合を維持

### 優先度: 中

#### 3. 質問管理画面

**対象**: `QuestionAdminApp`の主要機能

- **参加者管理**

  - 参加者リストの表示・編集
  - CSV インポート・エクスポート
  - 班番号の割り当て

- **質問管理**

  - 質問リストの表示
  - 質問の編集・削除

- **印刷機能**
  - 印刷プレビュー
  - 印刷設定

**移行方法**:

- 各機能を Vue コンポーネントに移行
- 既存の Manager パターンとの統合

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

### Phase 3.1: オペレーター画面の残りの部分（優先度: 高）

1. **辞書パネル**

   - `DictionaryPanel.vue`コンポーネントを作成
   - 既存の`dictionary-panel.js`と統合

2. **ピックアップパネル**

   - `PickupPanel.vue`コンポーネントを作成
   - 既存の`pickup-panel.js`と統合

3. **ログパネル**

   - `LogsPanel.vue`コンポーネントを作成
   - 既存の`logs-panel.js`と統合

4. **サイドテロップパネル**
   - `SideTelopPanel.vue`コンポーネントを作成
   - 既存の`side-telop-panel.js`と統合

### Phase 3.2: イベント管理画面（優先度: 高）

1. **イベント一覧**

   - `EventList.vue`コンポーネントを作成
   - 既存の`event-panel.js`と統合

2. **日程一覧**

   - `ScheduleList.vue`コンポーネントを作成
   - 既存の`schedule-panel.js`と統合

3. **参加者リスト**
   - `ParticipantList.vue`コンポーネントを作成
   - 既存の`participants-panel.js`と統合

### Phase 3.3: 質問管理画面（優先度: 中）

1. **参加者管理**

   - `ParticipantManagement.vue`コンポーネントを作成
   - 既存の Manager パターンと統合

2. **質問管理**

   - `QuestionManagement.vue`コンポーネントを作成
   - 既存の Manager パターンと統合

3. **印刷機能**
   - `PrintPreview.vue`コンポーネントを作成
   - 既存の`PrintManager`と統合

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
