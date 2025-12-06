# 開発標準

このドキュメントは、subtitle-output-system プロジェクトにおける JavaScript コードの開発標準を定義します。コードの一貫性、可読性、保守性を向上させることを目的としています。

## 目次

1. [命名規則](#命名規則)
2. [ファイル構成](#ファイル構成)
3. [コーディングスタイル](#コーディングスタイル)
4. [コメント規則](#コメント規則)
5. [モジュール設計](#モジュール設計)
6. [エラーハンドリング](#エラーハンドリング)

---

## 命名規則

### ファイル名

- **形式**: `kebab-case`（小文字とハイフン）
- **拡張子**: `.js`
- **例**:
  - ✅ `context-manager.js`
  - ✅ `auth-manager.js`
  - ✅ `channel-manager.js`
  - ❌ `ContextManager.js`（PascalCase は使用しない）
  - ❌ `context_manager.js`（スネークケースは使用しない）

**命名パターン**:

- クラスを含むファイル: `*-manager.js`, `*-renderer.js` など、責務を表す接尾辞を使用
- ユーティリティ関数: `utils.js`, `dom.js`, `firebase.js` など、機能を表す名前
- モジュール: `questions.js`, `dictionary.js` など、機能領域を表す名前

### クラス名

- **形式**: `PascalCase`（各単語の先頭を大文字）
- **例**:
  - ✅ `OperatorApp`
  - ✅ `ContextManager`
  - ✅ `AuthManager`
  - ✅ `ChannelManager`
  - ✅ `UIRenderer`
  - ❌ `operatorApp`（camelCase は使用しない）
  - ❌ `context_manager`（スネークケースは使用しない）

**命名ガイドライン**:

- クラス名は名詞で、その責務を明確に表現する
- Manager、Renderer、Handler などの接尾辞を使用して役割を明確化

### 関数・メソッド名

- **形式**: `camelCase`（最初の単語は小文字、以降の単語の先頭は大文字）
- **例**:
  - ✅ `getActiveChannel()`
  - ✅ `lockDisplayToSchedule()`
  - ✅ `renderChannelBanner()`
  - ✅ `extractPageContext()`
  - ❌ `GetActiveChannel()`（PascalCase は使用しない）
  - ❌ `get_active_channel()`（スネークケースは使用しない）

**命名ガイドライン**:

- 動詞で始める（`get`, `set`, `create`, `update`, `delete`, `render`, `handle`, `lock`, `resolve` など）
- 処理内容が明確に分かる名前を付ける
- ブール値を返す関数は `is`, `has`, `can`, `should` などのプレフィックスを使用
  - ✅ `isTelopEnabled()`
  - ✅ `hasChannelMismatch()`
  - ✅ `canLockDisplay()`

**関数名の命名パターン**:

- **取得系**: `get*`（`getActiveChannel()`, `getDisplayAssignment()`）
- **設定系**: `set*`（`setExternalContext()`）
- **作成系**: `create*`（`createInitialState()`）
- **更新系**: `update*`（`updateRenderAvailability()`）
- **削除系**: `delete*`, `remove*`, `clear*`（`clearOperatorPresence()`）
- **描画系**: `render*`（`renderChannelBanner()`, `renderChannelPresenceList()`）
- **処理系**: `handle*`（`handleAuthState()`, `handleSelectAll()`）
- **抽出系**: `extract*`（`extractPageContext()`, `extractScheduleKeyParts()`）
- **解決系**: `resolve*`（`resolveScheduleLabel()`）
- **評価系**: `evaluate*`（`evaluateScheduleConflict()`）
- **適用系**: `apply*`（`applyContextToState()`, `applyAssignmentLocally()`）
- **ロック系**: `lock*`（`lockDisplayToSchedule()`）
- **同期系**: `sync*`（`syncOperatorPresence()`）
- **リフレッシュ系**: `refresh*`（`refreshChannelSubscriptions()`）
- **開始系**: `start*`（`startDisplaySessionMonitor()`）
- **停止系**: `stop*`（`stopOperatorPresenceHeartbeat()`）
- **スケジュール系**: `schedule*`（`scheduleOperatorPresenceHeartbeat()`）
- **開閉系**: `open*`, `close*`（`openConflictDialog()`, `closeConflictDialog()`）

### 変数名

- **形式**: `camelCase`
- **例**:
  - ✅ `eventId`
  - ✅ `scheduleId`
  - ✅ `displaySession`
  - ✅ `channelAssignment`
  - ❌ `event_id`（スネークケースは使用しない）
  - ❌ `EventId`（PascalCase は使用しない）

**命名ガイドライン**:

- 意味が明確な名前を付ける
- 略語は一般的なものに限る（`Id`, `Ref`, `Uid`, `Api`, `Dom` など）
- 長い変数名は避けるが、可読性を優先する（**30 文字以下を目安**）
- 一時変数は用途を明確にする（`rawAssignment`, `normalizedScheduleId`, `fallbackLabel` など）

**変数名の長さに関する推奨事項**:

- **推奨**: 10-20 文字
- **許容**: 20-30 文字
- **要改善**: 30 文字以上（短縮を検討）

**改善例**:

- ❌ `operatorPresenceSubscribedEventId`（35 文字、長すぎる）
- ✅ `presenceSubscribedEventId`（25 文字、クラス内では`operator`は省略可）
- ❌ `displayPresenceLastRefreshAt`（26 文字、やや長い）
- ✅ `displayPresenceRefreshedAt`（24 文字、より簡潔）

**一時変数の命名パターン**:

- **生データ**: `raw*`（`rawAssignment`, `rawScheduleKey`）
- **正規化済み**: `normalized*`（`normalizedScheduleId`, `normalizedLabel`）
- **フォールバック**: `fallback*`（`fallbackLabel`, `fallbackScheduleId`）
- **候補**: `candidate*`（`candidateLabel`, `candidateEventId`）
- **解決済み**: `resolved*`（`resolvedScheduleKey`, `resolvedLabel`）
- **変換用**: `ensure*`（`ensureString`, `ensureNumber`）または用途を明確にした関数名

**プロパティ名の命名**:

- クラスのインスタンスプロパティは、クラスの責務が明確な場合は接頭辞を省略可能
- 例: `ChannelManager` クラス内では `operatorPresence*` → `presence*` と省略可
- ただし、外部からアクセスする場合は完全な名前を使用

### ブール値の変数・プロパティ

- **形式**: `is` または `has` プレフィックス + `camelCase`
- **例**:
  - ✅ `isEmbedded`
  - ✅ `isAuthorized`
  - ✅ `isDisplaySessionActive`
  - ✅ `hasChannelMismatch`
  - ✅ `channelLocking` → `isChannelLocking`（改善推奨）
  - ❌ `displaySessionActive`（`is`プレフィックスなしは避ける）

**統一ルール**:

- **状態を表すブール値**: `is` プレフィックス（`isActive`, `isEnabled`, `isLoading`, `isLocking`）
- **存在を表すブール値**: `has` プレフィックス（`hasError`, `hasData`, `hasPermission`, `hasMismatch`）
- **能力を表すブール値**: `can` プレフィックス（`canEdit`, `canDelete`, `canLock`）
- **完了を表すブール値**: `is*Completed` または `has*Completed`（`isLoaderCompleted`, `hasDataLoaded`）

**既存コードの改善対象**:

以下のプロパティは `is` プレフィックスを追加することを推奨：

- `displaySessionActive` → `isDisplaySessionActive`
- `channelLocking` → `isChannelLocking`
- `displayAssetChecked` → `isDisplayAssetChecked`
- `displayAssetChecking` → `isDisplayAssetChecking`
- `selectionConfirmed` → `isSelectionConfirmed`（ただし、`confirmed` は状態として `isConfirmed` の方が自然）

**例外**:

- 既存の API や外部ライブラリとの互換性が必要な場合は例外として認める
- ただし、新規コードでは必ずプレフィックスを使用する

### 定数名

- **形式**: `UPPER_SNAKE_CASE`（すべて大文字、単語間はアンダースコア）
- **例**:
  - ✅ `OPERATOR_PRESENCE_HEARTBEAT_MS`
  - ✅ `DISPLAY_PRESENCE_STALE_THRESHOLD_MS`
  - ✅ `DOM_EVENT_BINDINGS`
  - ✅ `OPERATOR_MODE_TELOP`
  - ❌ `operatorPresenceHeartbeatMs`（camelCase は使用しない）
  - ❌ `OperatorPresenceHeartbeatMs`（PascalCase は使用しない）

**命名ガイドライン**:

- モジュールレベルで定義される定数に使用
- 時間関連の定数は `_MS`（ミリ秒）、`_S`（秒）などの単位サフィックスを付ける
- 設定値やマジックナンバーは定数として定義する

### プライベートメンバー

- **形式**: 現時点では明示的なプライベート記法は使用していない
- **慣習**: 外部に公開しないメソッドやプロパティは、命名で意図を表現する
- 将来的に `#` プレフィックス（Private Class Fields）の導入を検討

### 略語の使用

**推奨される略語**:

- `Id` - Identifier（`eventId`, `scheduleId`, `userId`）
- `Ref` - Reference（`questionsRef`, `displayPresenceRootRef`）
- `Uid` - User Identifier（`questionsByUid`）
- `Api` - API（`createApiClient`）
- `Dom` - DOM（`queryDom`）
- `UI` - User Interface（`UIRenderer`）
- `TTL` - Time To Live（`DISPLAY_SESSION_TTL_MS`）
- `MS` - Milliseconds（`OPERATOR_PRESENCE_HEARTBEAT_MS`）

**使用時の注意**:

- 略語は一貫して使用する（`Id`と`ID`を混在させない）
- 一般的でない略語は避ける
- 略語を使用する場合は、プロジェクト全体で統一する
- 略語の大文字・小文字は統一する（`Id`は常に`I`が大文字、`d`が小文字）

**略語の統一ルール**:

- `Id` は常に `I` が大文字、`d` が小文字（`eventId`, `scheduleId`）
- `Ref` は常に `R` が大文字、`ef` が小文字（`questionsRef`, `displayPresenceRootRef`）
- `Uid` は常に `U` が大文字、`id` が小文字（`questionsByUid`）
- 定数内の略語はすべて大文字（`OPERATOR_PRESENCE_HEARTBEAT_MS`）

---

## ファイル構成

### ファイルサイズの目安

- **推奨**: 300-1,000 行
- **許容**: 1,000-1,500 行（複雑なロジックを含む場合）
- **要改善**: 1,500 行以上（分割を検討）

### ファイル分割の基準

1. **責務の分離**: 異なる責務を持つ機能は別ファイルに分割
2. **再利用性**: 複数の場所で使用される機能は独立したモジュールに
3. **テスト容易性**: 単体テストしやすい単位で分割
4. **可読性**: ファイルを見ただけで責務が分かるように

**分割例**:

- ✅ `app.js`（2,463 行）→ `context-manager.js`, `auth-manager.js`, `presence-manager.js`, `channel-manager.js`, `ui-renderer.js` に分割
- ✅ 各 Manager クラスは 300-1,300 行の範囲内

### インポート順序

1. 外部ライブラリ（Firebase など）
2. 共有モジュール（`../shared/`）
3. 同一ディレクトリのモジュール（`./`）
4. 型定義（TypeScript 使用時）

**例**:

```javascript
// 1. 外部ライブラリ
import { auth, provider, signInWithPopup } from "./firebase.js";

// 2. 共有モジュール
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { OPERATOR_MODE_TELOP } from "../shared/operator-modes.js";

// 3. 同一ディレクトリのモジュール
import { ContextManager } from "./context-manager.js";
import { AuthManager } from "./auth-manager.js";
```

---

## コーディングスタイル

### インデント

- **形式**: スペース 2 文字
- **タブは使用しない**

### セミコロン

- **使用**: セミコロンを使用する
- **例**: `const value = "test";`

### 文字列

- **引用符**: シングルクォート（`'`）またはダブルクォート（`"`）を使用
- **一貫性**: ファイル内で統一する
- **テンプレートリテラル**: 変数展開や改行を含む場合はバッククォート（`` ` ``）を使用

### オブジェクト・配列

- **末尾カンマ**: 複数行の場合は末尾カンマを付ける（推奨）
- **例**:

```javascript
const config = {
  eventId: "",
  scheduleId: "",
  scheduleLabel: "", // 末尾カンマ
};
```

### 関数定義

- **アロー関数**: 短い関数やコールバックで使用
- **関数宣言**: メソッド定義や名前付き関数で使用
- **async/await**: Promise チェーンより優先

**例**:

```javascript
// メソッド定義
async lockDisplayToSchedule(eventId, scheduleId, scheduleLabel, options = {}) {
  // ...
}

// アロー関数（コールバック）
const handler = (event) => {
  // ...
};
```

### 条件分岐

- **早期リターン**: ガード句を使用してネストを減らす
- **例**:

```javascript
// ✅ 推奨
function processData(data) {
  if (!data) return null;
  if (!data.isValid) return null;
  // メイン処理
}

// ❌ 避ける
function processData(data) {
  if (data) {
    if (data.isValid) {
      // メイン処理
    }
  }
}
```

---

## コメント規則

### ファイルヘッダーコメント

- **形式**: ファイルの先頭に 1 行コメントで責務を記述
- **例**:

```javascript
// context-manager.js: ページコンテキストと外部コンテキストの管理を担当します。
```

### JSDoc コメント

- **使用**: 公開関数・メソッドには JSDoc コメントを記述
- **必須項目**: `@param`, `@returns`（戻り値がある場合）
- **例**:

```javascript
/**
 * 現在操作対象となるイベント/日程を決定します。
 * @param {string} eventId - イベントID
 * @param {object} options - オプション
 * @returns {{ eventId: string, scheduleId: string }}
 */
getActiveChannel(eventId, options = {}) {
  // ...
}
```

### インラインコメント

- **使用**: 複雑なロジックや意図が明確でない箇所に記述
- **避ける**: コードから自明な内容のコメントは不要
- **例**:

```javascript
// 現在選択中のイベントと一致しない場合は適用しない
const activeEventId = String(this.app.state?.activeEventId || "").trim();
if (activeEventId && eventId && eventId !== activeEventId) {
  return;
}
```

### セクションコメント

- **使用**: 大きなファイル内で機能ブロックを区切る
- **形式**: `// ============================================================================`
- **例**:

```javascript
// ============================================================================
// 状態管理
// ============================================================================
```

---

## モジュール設計

### クラス設計原則

1. **単一責任の原則**: 1 つのクラスは 1 つの責務のみを持つ
2. **依存性の注入**: 必要な依存関係はコンストラクタで受け取る
3. **委譲パターン**: 大きなクラスは機能別の Manager クラスに分割

**例**:

```javascript
export class OperatorApp {
  constructor() {
    this.contextManager = new ContextManager(this);
    this.authManager = new AuthManager(this);
    this.channelManager = new ChannelManager(this);
  }

  // 委譲メソッド
  getActiveChannel() {
    return this.channelManager.getActiveChannel();
  }
}
```

### モジュールエクスポート

- **デフォルトエクスポート**: 使用しない（明示的な名前付きエクスポートを推奨）
- **名前付きエクスポート**: クラス、関数、定数を個別にエクスポート
- **例**:

```javascript
// ✅ 推奨
export class ChannelManager {}
export function extractScheduleKeyParts() {}
export const CONSTANT_VALUE = "";

// ❌ 避ける
export default class ChannelManager {}
```

### 状態管理

- **状態の場所**: アプリケーションの状態は `OperatorApp.state` に集約
- **状態の更新**: 直接変更を避け、メソッド経由で更新
- **イミュータブル**: 可能な限り新しいオブジェクトを作成して更新

---

## エラーハンドリング

### エラー処理の方針

1. **早期リターン**: エラー条件は早期に検出して処理を中断
2. **エラーログ**: 重要なエラーはログに記録
3. **ユーザー通知**: ユーザーに影響があるエラーは通知を表示
4. **エラー無視**: 意図的にエラーを無視する場合はコメントで理由を記述

### try-catch の使用

- **非同期処理**: `async/await` と組み合わせて使用
- **エラー処理**: 適切なエラーメッセージとフォールバック処理を実装
- **例**:

```javascript
async lockDisplayToSchedule(eventId, scheduleId, scheduleLabel, options = {}) {
  try {
    // 処理
  } catch (error) {
    console.error("[ChannelManager] lockDisplayToSchedule failed", error);
    this.app.toast("ロック処理に失敗しました。", "error");
    throw error;
  }
}
```

### エラーメッセージ

- **形式**: 日本語で明確なメッセージを表示
- **ログ**: デバッグ用の詳細情報はコンソールログに出力
- **例**:

```javascript
this.app.toast("ログインに失敗しました。", "error");
console.error("[AuthManager] login failed", { error, user });
```

---

## 命名規則の実践例

### 良い命名の例

```javascript
// ✅ クラス名: PascalCase
export class ChannelManager {}

// ✅ メソッド名: camelCase、動詞で始まる
getActiveChannel() {}
lockDisplayToSchedule() {}
renderChannelBanner() {}

// ✅ ブール値: is/has プレフィックス
isDisplaySessionActive
hasChannelMismatch
isAuthorized

// ✅ 変数名: camelCase、意味が明確
const eventId = "";
const scheduleId = "";
const displaySession = {};

// ✅ 一時変数: 用途が明確
const rawAssignment = {};
const normalizedScheduleId = "";
const fallbackLabel = "";
const resolvedScheduleKey = "";

// ✅ 定数: UPPER_SNAKE_CASE
const OPERATOR_PRESENCE_HEARTBEAT_MS = 60_000;
const DOM_EVENT_BINDINGS = [];
```

### 避けるべき命名の例

```javascript
// ❌ ファイル名: PascalCase
ContextManager.js

// ❌ メソッド名: PascalCase
GetActiveChannel() {}

// ❌ ブール値: プレフィックスなし
displaySessionActive  // → isDisplaySessionActive

// ❌ 変数名: 長すぎる
const operatorPresenceSubscribedEventId = "";  // 35文字
// → presenceSubscribedEventId (25文字)

// ❌ 変数名: 意味が不明確
const data = {};
const temp = "";
const x = "";

// ❌ 定数: camelCase
const operatorPresenceHeartbeatMs = 60_000;
```

## チェックリスト

新しいコードを書く際は、以下のチェックリストを確認してください：

### 命名規則

- [ ] ファイル名は `kebab-case` か？
- [ ] クラス名は `PascalCase` か？
- [ ] 関数・メソッド名は `camelCase` で動詞で始まるか？
- [ ] ブール値は `is`/`has`/`can` プレフィックスを使用しているか？
- [ ] 定数は `UPPER_SNAKE_CASE` か？
- [ ] 変数名は意味が明確で、30 文字以下か？
- [ ] 一時変数は用途が明確か（`raw*`, `normalized*`, `fallback*` など）？
- [ ] 略語の使用が一貫しているか（`Id`, `Ref`, `Uid` など）？

### コード品質

- [ ] ファイルサイズは 1,500 行以下か？
- [ ] 単一責任の原則に従っているか？
- [ ] JSDoc コメントが記述されているか？
- [ ] エラーハンドリングが適切か？
- [ ] 早期リターンを使用してネストを減らしているか？

### 一貫性

- [ ] 既存のコードスタイルと一致しているか？
- [ ] 略語の使用が一貫しているか？
- [ ] インポート順序が標準に従っているか？

---

## 参考資料

- [MDN Web Docs - JavaScript](https://developer.mozilla.org/ja/docs/Web/JavaScript)
- [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)

---

---

## 命名規則の改善計画

既存コードの命名規則を段階的に改善する計画：

### 優先度: 高 ✅ 完了

1. **ブール値の命名統一** ✅

   - ✅ `displaySessionActive` → `isDisplaySessionActive`（完了）
   - ✅ `channelLocking` → `isChannelLocking`（完了）
   - ✅ `displayAssetChecked` → `isDisplayAssetChecked`（完了）
   - ✅ `displayAssetChecking` → `isDisplayAssetChecking`（完了）

2. **長い変数名の短縮** ✅
   - ✅ `operatorPresenceSubscribedEventId` → `presenceSubscribedEventId`（完了、クラス内）
   - ✅ `displayPresenceLastRefreshAt` → `displayPresenceRefreshedAt`（完了）

### 優先度: 中 ✅ 完了

3. **一時変数の命名改善** ✅

   - ✅ `ensure` 関数の用途を明確化（`ensureString` に統一完了）

4. **プロパティ名の一貫性向上** ✅
   - ✅ クラス内での接頭辞省略ルールは既に実装済み（`presenceSubscribedEventId` など）

### 優先度: 低 ✅ 完了

5. **命名の細かい改善** ✅
   - ✅ 意味が不明確な変数名の改善（`raw` → `rawPresenceData`, `value` → `entryPayload`/`snapshotData`, `item` → `question`）
   - ✅ コメントで補足が必要な命名の見直し（主要な改善は完了）

---

**最終更新**: 2025 年
**バージョン**: 1.1.0
