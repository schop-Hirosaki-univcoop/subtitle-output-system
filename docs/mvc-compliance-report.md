# MVC モデル準拠状況レポート

## 概要

このレポートは、subtitle-output-system プロジェクトが MVC（Model-View-Controller）モデルに沿っているかを確認した結果をまとめたものです。

## 調査結果サマリー

### 結論

**このプロジェクトは、MVC モデルを一貫して適用しているわけではありません。**

- **開発標準**: MVC モデルについての明示的な記述なし
- **基本設計**: MVC モデルについての明示的な記述なし
- **実装**: モジュールによって MVC パターンの適用度が異なる

### 詳細分析

## 1. フレームワークの使用状況

### 1.1 使用フレームワーク

- **フレームワーク**: バニラ JavaScript（フレームワークなし）
- **モジュールシステム**: ES Modules
- **ビルドツール**: なし（ネイティブ ES Modules）

### 1.2 アーキテクチャパターン

プロジェクトでは以下のパターンが混在しています：

1. **Manager パターン**: `managers/`ディレクトリに各種 Manager クラス
2. **Panel パターン**: `panels/`ディレクトリに機能別パネル
3. **Service パターン**: `*-service.js`ファイル（例: `submission-service.js`）
4. **部分的 MVC パターン**: `question-form`モジュールのみ

## 2. モジュール別 MVC 準拠状況

### 2.1 question-form モジュール ✅（部分的に準拠）

**構造:**

- `view.js`: **View 層** - `FormView`クラスで DOM 操作を一元化
- `app.js`: **Controller 層** - `QuestionFormApp`クラスでビジネスロジックを統括
- `firebase.js`, `submission-service.js`: **Model 層** - データ操作を担当

**評価:**

- ✅ View 層が明確に分離されている
- ✅ Controller 層が存在する
- ⚠️ Model 層が複数のファイルに分散している

**コード例:**

```12:112:scripts/question-form/app.js
import { FormView } from "./view.js";
// ...
export class QuestionFormApp {
  constructor({ view, database } = {}) {
    this.database = database ?? getDatabaseInstance(firebaseConfig);
    this.view = view ?? new FormView({
      maxRadioNameLength: MAX_RADIO_NAME_LENGTH,
      maxQuestionLength: MAX_QUESTION_LENGTH
    });
    // ...
  }
}
```

### 2.2 operator モジュール ⚠️（部分的に準拠）

**構造:**

- `app.js`: **Controller 層** - `OperatorApp`クラス（約 2,600 行の大きなクラス）
- `ui-renderer.js`: **View 層の一部** - `UIRenderer`クラスで UI 描画を担当
- `firebase.js`: **Model 層の一部** - Firebase 操作を担当
- `questions.js`: ビジネスロジックと View 操作が混在

**評価:**

- ⚠️ Controller 層が肥大化している（単一責任の原則に反する可能性）
- ⚠️ View 層が完全に分離されていない（`app.js`内にも DOM 操作が存在）
- ⚠️ Model 層が分散している

**コード例:**

```1:12:scripts/operator/ui-renderer.js
// ui-renderer.js: UI描画を担当します。
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { auth } from "./firebase.js";

/**
 * UI描画クラス
 * UI要素の描画と更新を担当します。
 */
export class UIRenderer {
  constructor(app) {
    this.app = app;
  }
```

### 2.3 events モジュール ⚠️（Manager パターン使用）

**構造:**

- `app.js`: **Controller 層** - `EventAdminApp`クラス（約 6,700 行の非常に大きなクラス）
- `managers/ui-renderer.js`: **View 層の一部** - `EventUIRenderer`クラス
- `managers/firebase-manager.js`: **Model 層の一部** - `EventFirebaseManager`クラス
- `managers/state-manager.js`: 状態管理
- `managers/auth-manager.js`: 認証管理
- `panels/`: 機能別パネル（各パネルが独自の責務を持つ）

**評価:**

- ⚠️ Manager パターンを使用しているが、MVC の明確な分離ではない
- ⚠️ Controller 層が非常に肥大化している
- ✅ 機能別に Manager クラスで責務を分離している点は良い

**コード例:**

```171:178:scripts/events/app.js
    // 認証管理を初期化
    this.authManager = new EventAuthManager(this);
    // 状態管理を初期化
    this.stateManager = new EventStateManager(this);
    // 画面遷移制御を初期化
    this.navigationManager = new EventNavigationManager(this);
    // UI描画を初期化
    this.uiRenderer = new EventUIRenderer(this);
```

### 2.4 question-admin モジュール ⚠️（Manager パターン使用）

**構造:**

- `app.js`: **Controller 層** - `QuestionAdminApp`クラス
- `managers/`: 22 個の Manager クラス（機能別に分離）
  - `ui-manager.js`: View 層の一部
  - `firebase-manager.js`: Model 層の一部（存在しない可能性）
  - その他多数の Manager クラス

**評価:**

- ⚠️ Manager パターンを使用しているが、MVC の明確な分離ではない
- ⚠️ Manager クラスが多すぎて、責務の境界が不明確な可能性

## 3. 問題点と改善提案

### 3.1 主な問題点

1. **MVC パターンの一貫性がない**

   - `question-form`モジュールのみが MVC パターンを採用
   - 他のモジュールは Manager パターンや独自の構造を使用

2. **Controller 層の肥大化**

   - `OperatorApp`: 約 2,600 行
   - `EventAdminApp`: 約 6,700 行
   - 単一責任の原則に反している

3. **View 層の不完全な分離**

   - `app.js`内に DOM 操作が残っている
   - View 層が完全に独立していない

4. **Model 層の分散**

   - Firebase 操作が複数のファイルに分散
   - データアクセス層が統一されていない

5. **開発標準に MVC の記述がない**
   - プロジェクトのアーキテクチャ方針が不明確

### 3.2 改善提案

#### 提案 1: MVC パターンの統一

すべてのモジュールで MVC パターンを採用する：

```
scripts/
├── {module}/
│   ├── model.js          # Model層: データ操作
│   ├── view.js           # View層: DOM操作
│   ├── controller.js     # Controller層: ビジネスロジック
│   └── app.js            # エントリーポイント
```

#### 提案 2: Controller 層の分割

大きな Controller クラスを機能別に分割：

```
scripts/operator/
├── controllers/
│   ├── questions-controller.js
│   ├── dictionary-controller.js
│   ├── display-controller.js
│   └── ...
```

#### 提案 3: Model 層の統一

データアクセス層を統一：

```
scripts/shared/
├── models/
│   ├── question-model.js
│   ├── event-model.js
│   └── ...
```

#### 提案 4: 開発標準への追加

開発標準ドキュメントに MVC パターンの記述を追加：

```markdown
## アーキテクチャパターン

### MVC パターン

本プロジェクトは MVC（Model-View-Controller）パターンを採用します。

- **Model**: データ操作とビジネスロジック
- **View**: UI 表示と DOM 操作
- **Controller**: ユーザー入力の処理と Model/View の調整
```

## 4. 現在のアーキテクチャの評価

### 4.1 良い点

1. **モジュール化**: 機能別にディレクトリを分割している
2. **ES Modules**: モダンなモジュールシステムを使用
3. **依存性注入**: 一部のクラスで依存性注入を実装（テスト容易性）
4. **Manager パターン**: 機能別に責務を分離している（events, question-admin）

### 4.2 改善が必要な点

1. **アーキテクチャの一貫性**: モジュール間でパターンが異なる
2. **ファイルサイズ**: 一部のファイルが非常に大きい（開発標準の推奨値を超えている）
3. **責務の分離**: Controller 層に View 操作が混在している
4. **ドキュメント**: アーキテクチャパターンについての記述が不足

## 5. 結論

### 5.1 現状

- **フレームワーク**: バニラ JavaScript（フレームワークなし）✅
- **MVC モデル**: 部分的に適用（question-form モジュールのみ）⚠️
- **アーキテクチャ**: Manager パターンと MVC パターンが混在 ⚠️

### 5.2 推奨事項

1. **短期**: 開発標準にアーキテクチャパターンの記述を追加
2. **中期**: 既存モジュールを段階的に MVC パターンにリファクタリング
3. **長期**: すべてのモジュールで MVC パターンを統一

### 5.3 優先度

- **高**: Controller 層の分割（可読性・保守性の向上）
- **中**: View 層の完全な分離（責務の明確化）
- **低**: Model 層の統一（既存の Manager パターンでも動作しているため）

---

**作成日**: 2025 年 12 月
**バージョン**: 1.0.0
