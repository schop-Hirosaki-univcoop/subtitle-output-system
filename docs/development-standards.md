# 開発標準

このドキュメントは、subtitle-output-system プロジェクト全体における開発標準を定義します。コードの一貫性、可読性、保守性を向上させることを目的としています。

## 目次

1. [プロジェクト構造](#プロジェクト構造)
2. [命名規則](#命名規則)
3. [ファイル構成](#ファイル構成)
4. [コーディングスタイル](#コーディングスタイル)
5. [HTML](#html)
6. [CSS](#css)
7. [JavaScript](#javascript)
8. [Google Apps Script](#google-apps-script)
9. [Firebase 設定](#firebase設定)
10. [コメント規則](#コメント規則)
11. [モジュール設計](#モジュール設計)
12. [エラーハンドリング](#エラーハンドリング)
13. [カスタムエラー](#カスタムエラー)
14. [Web Components](#web-components)
15. [テスト](#テスト)
16. [メールテンプレート](#メールテンプレート)
17. [アクセシビリティ](#アクセシビリティ)
18. [パフォーマンス](#パフォーマンス)

---

## プロジェクト構造

### ディレクトリ構成

```
subtitle-output-system-1/
├── assets/              # 静的アセット（フォント、画像、ファビコンなど）
│   ├── fonts/          # フォントファイル
│   └── favicon.svg     # ファビコン
├── docs/               # プロジェクトドキュメント
├── scripts/            # JavaScriptモジュール
│   ├── shared/        # 共有モジュール
│   ├── operator/      # オペレーター機能
│   ├── question-admin/ # 質問管理機能
│   ├── question-form/  # 質問フォーム機能
│   └── ...
├── tests/             # テストファイル（*.test.mjs）
├── 参考資料/          # 参考資料（プロジェクト固有の参考資料）
├── *.html             # HTMLページ
│   ├── email-*.html   # メールテンプレート（email-*-body.html, email-*-shell.html）
│   └── ...
├── *.css              # スタイルシート
├── code.gs            # Google Apps Script
└── firebase.rules.json # Firebaseセキュリティルール
```

### ファイル配置の原則

1. **ルートディレクトリ**: エントリーポイントとなる HTML ファイルを配置
2. **scripts/**: 機能別にディレクトリを分割し、責務を明確化
3. **assets/**: 静的リソースは種類別に整理
4. **docs/**: プロジェクトドキュメントはすべてここに集約
5. **tests/**: テストファイルはすべてここに集約
6. **メールテンプレート**: `email-*-body.html`, `email-*-shell.html` はルートに配置
7. **参考資料**: プロジェクト固有の参考資料は `参考資料/` に配置

---

## 命名規則

### ファイル名

#### HTML ファイル

- **形式**: `kebab-case`（小文字とハイフン）
- **拡張子**: `.html`
- **例**:
  - ✅ `question-form.html`
  - ✅ `participant-mail-view.html`
  - ✅ `404.html`
  - ✅ `email-participant-body.html`（メールテンプレート）
  - ✅ `email-participant-shell.html`（メールテンプレート）
  - ❌ `QuestionForm.html`（PascalCase は使用しない）
  - ❌ `question_form.html`（スネークケースは使用しない）

#### CSS ファイル

- **形式**: `kebab-case`
- **拡張子**: `.css`
- **例**:
  - ✅ `style.css`（全体共通スタイル）
  - ✅ `question-form.css`（機能固有スタイル）
  - ❌ `Style.css`（PascalCase は使用しない）

#### JavaScript ファイル

- **形式**: `kebab-case`
- **拡張子**: `.js`
- **例**:
  - ✅ `context-manager.js`
  - ✅ `auth-manager.js`
  - ❌ `ContextManager.js`（PascalCase は使用しない）

#### テストファイル

- **形式**: `kebab-case` + `.test.mjs`
- **拡張子**: `.test.mjs`
- **例**:
  - ✅ `participant-tokens.test.mjs`
  - ✅ `question-form-utils.test.mjs`
  - ❌ `participantTokens.test.mjs`（camelCase は使用しない）

#### Google Apps Script ファイル

- **形式**: `kebab-case`
- **拡張子**: `.gs`
- **例**:
  - ✅ `code.gs`
  - ❌ `Code.gs`（PascalCase は使用しない）

#### ディレクトリ名

- **形式**: `kebab-case`
- **例**:
  - ✅ `question-admin/`
  - ✅ `participant-mail-view/`
  - ❌ `QuestionAdmin/`（PascalCase は使用しない）

#### ドキュメントファイル

- **形式**: `kebab-case`
- **拡張子**: `.md`（Markdown）、`.txt`（プレーンテキスト）
- **例**:
  - ✅ `development-standards.md`
  - ✅ `api-client.md`
  - ✅ `参加者リスト管理パネルのload時間が長い原因についての考察.txt`
  - ❌ `DevelopmentStandards.md`（PascalCase は使用しない）

### クラス名（JavaScript）

- **形式**: `PascalCase`（各単語の先頭を大文字）
- **例**:
  - ✅ `OperatorApp`
  - ✅ `ContextManager`
  - ✅ `AuthManager`
  - ❌ `operatorApp`（camelCase は使用しない）

### 関数・メソッド名（JavaScript）

- **形式**: `camelCase`（最初の単語は小文字、以降の単語の先頭は大文字）
- **例**:
  - ✅ `getActiveChannel()`
  - ✅ `lockDisplayToSchedule()`
  - ✅ `renderChannelBanner()`
  - ❌ `GetActiveChannel()`（PascalCase は使用しない）

### 変数名（JavaScript）

- **形式**: `camelCase`
- **例**:
  - ✅ `eventId`
  - ✅ `scheduleId`
  - ✅ `displaySession`
  - ❌ `event_id`（スネークケースは使用しない）

### 定数名（JavaScript）

- **形式**: `UPPER_SNAKE_CASE`（すべて大文字、単語間はアンダースコア）
- **例**:
  - ✅ `OPERATOR_PRESENCE_HEARTBEAT_MS`
  - ✅ `DISPLAY_SESSION_TTL_MS`
  - ❌ `operatorPresenceHeartbeatMs`（camelCase は使用しない）

**定数の定義場所**:

- **モジュールレベル**: ファイルの先頭で定義
- **共有定数**: `scripts/shared/` に配置（例: `firebase-config.js`）
- **機能固有定数**: 各機能ディレクトリの `constants.js` に配置
- **不変性**: オブジェクト定数は `Object.freeze()` を使用

**例**:

```javascript
// 共有設定
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "...",
  authDomain: "...",
  // ...
});

// 機能固有定数
export const GENRE_OPTIONS = [
  "学び",
  "活動",
  "暮らし",
  "食・スポット",
  "移動・季節",
  "その他",
];
export const DICTIONARY_STATE_KEY = "telop-ops-dictionary-open";
```

### CSS クラス名

- **形式**: `kebab-case`（小文字とハイフン）
- **BEM 記法**: 必要に応じて使用（`.block__element--modifier`）
- **例**:
  - ✅ `flow-page`
  - ✅ `question-form-page`
  - ✅ `flow-user-info__label`（BEM 記法）
  - ❌ `flowPage`（camelCase は使用しない）
  - ❌ `flow_page`（スネークケースは使用しない）

### CSS 変数（カスタムプロパティ）

- **形式**: `kebab-case`、`--` プレフィックス
- **命名パターン**: 意味が明確な名前を使用
- **例**:
  - ✅ `--ui-bg`
  - ✅ `--card-max`
  - ✅ `--flow-stage-panel-width`
  - ❌ `--uiBg`（camelCase は使用しない）

### HTML ID 属性

- **形式**: `kebab-case`
- **例**:
  - ✅ `events-backup-button`
  - ✅ `flow-user-label`
  - ❌ `eventsBackupButton`（camelCase は使用しない）

### HTML data 属性

- **形式**: `kebab-case`、`data-` プレフィックス
- **例**:
  - ✅ `data-event-id`
  - ✅ `data-schedule-id`
  - ❌ `data-eventId`（camelCase は使用しない）

### ストレージキー（localStorage/sessionStorage）

- **形式**: `kebab-case`、プレフィックスで名前空間を区別
- **プレフィックス**:
  - `sos:` - システム全体で共有する認証・セッション情報
  - `telop-ops-` - オペレーター機能固有の設定
- **例**:
  - ✅ `sos:operatorAuthTransfer`
  - ✅ `sos:authPreflightContext`
  - ✅ `telop-ops-dictionary-open`
  - ✅ `telop-ops-logs-open`
  - ❌ `operatorAuthTransfer`（プレフィックスなしは避ける）
  - ❌ `telopOpsDictionaryOpen`（camelCase は使用しない）

**ストレージキーの管理**:

- **定数化**: ストレージキーは定数として定義
- **共有キー**: `scripts/shared/` のモジュールで定義
- **機能固有キー**: 各機能の `constants.js` で定義

---

## ファイル構成

### ファイルサイズの目安

#### JavaScript

- **推奨**: 300-1,000 行
- **許容**: 1,000-1,500 行（複雑なロジックを含む場合）
- **要改善**: 1,500 行以上（分割を検討）

#### CSS

- **推奨**: 500-2,000 行
- **許容**: 2,000-3,000 行
- **要改善**: 3,000 行以上（分割を検討）

#### HTML

- **推奨**: 200-500 行
- **許容**: 500-1,000 行
- **要改善**: 1,000 行以上（コンポーネント化を検討）

### ファイル分割の基準

1. **責務の分離**: 異なる責務を持つ機能は別ファイルに分割
2. **再利用性**: 複数の場所で使用される機能は独立したモジュールに
3. **テスト容易性**: 単体テストしやすい単位で分割
4. **可読性**: ファイルを見ただけで責務が分かるように

### ユーティリティファイルの配置

- **dom.js**: DOM 操作のユーティリティ（各機能ディレクトリに配置）
- **utils.js**: 汎用的なユーティリティ関数
- **helpers.js**: 機能固有のヘルパー関数
- **constants.js**: 定数の集約
- **config.js**: 設定オブジェクトの定義

---

## コーディングスタイル

### インデント

- **形式**: スペース 2 文字
- **タブは使用しない**
- **全ファイル形式で統一**

### セミコロン（JavaScript）

- **使用**: セミコロンを使用する
- **例**: `const value = "test";`

### 文字列

- **引用符**: シングルクォート（`'`）またはダブルクォート（`"`）を使用
- **一貫性**: ファイル内で統一する
- **テンプレートリテラル**: 変数展開や改行を含む場合はバッククォート（`` ` ``）を使用

### 数値リテラル

- **数値区切り**: 大きな数値にはアンダースコア（`_`）を使用して可読性を向上
- **例**:
  - ✅ `4_000`（4,000 ミリ秒）
  - ✅ `60_000`（60,000 ミリ秒）
  - ✅ `1_000_000`（1,000,000）
  - ❌ `4000`（区切りなしは可読性が低い）

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

### 条件分岐

- **早期リターン**: ガード句を使用してネストを減らす
- **三項演算子**: 単純な条件分岐には三項演算子を使用（可読性を優先）
- **switch 文**: 複数の分岐がある場合は switch 文を使用

**条件分岐のパターン**:

```javascript
// ✅ 早期リターン（推奨）
function processData(data) {
  if (!data) return null;
  if (!data.isValid) return null;
  // メイン処理
}

// ❌ 避ける（深いネスト）
function processData(data) {
  if (data) {
    if (data.isValid) {
      // メイン処理
    }
  }
}

// ✅ 三項演算子（単純な条件分岐）
const label = isActive ? "有効" : "無効";
const count = items ? items.length : 0;

// ✅ switch 文（複数の分岐）
switch (action) {
  case "submit":
    return handleSubmit();
  case "cancel":
    return handleCancel();
  default:
    return handleDefault();
}
```

---

## HTML

### 基本構造

- **DOCTYPE**: HTML5 の `<!DOCTYPE html>` を使用
- **言語属性**: `lang="ja"` を指定
- **文字エンコーディング**: UTF-8 を明示（`<meta charset="UTF-8">`）
- **ビューポート**: レスポンシブ対応のメタタグを設定

### ファイルヘッダーコメント

- **形式**: HTML コメントでファイルの先頭に責務を記述
- **例**:

```html
<!-- operator.html: 管理者向けのイベント制御フローUI全体を構築するメインエントリーポイントです。 -->
<!DOCTYPE html>
```

### セマンティック HTML

- **適切な要素を使用**: `<header>`, `<main>`, `<section>`, `<article>`, `<nav>`, `<footer>` など
- **見出しの階層**: `<h1>` から順に使用し、階層を飛ばさない
- **リスト**: リスト項目には `<ul>`, `<ol>`, `<dl>` を使用

### アクセシビリティ

- **noscript**: JavaScript が無効な場合の代替コンテンツを提供
- **aria 属性**: 必要に応じて `aria-label`, `aria-labelledby`, `aria-hidden` などを使用
- **role 属性**: 必要に応じて `role="alert"` などを使用
- **alt 属性**: 画像には必ず `alt` 属性を設定（装飾画像は空文字列）

### フォーム

- **label 要素**: すべての入力要素に対応する `<label>` を提供
- **type 属性**: 適切な `type` を指定（`email`, `tel`, `number` など）
- **required 属性**: 必須項目には `required` を設定
- **placeholder**: 補助的な情報として使用（`label` の代替ではない）

### インラインスタイル

- **原則**: インラインスタイルは使用しない
- **例外**: 動的に生成されるスタイルや、特定のページ固有のスタイルのみ

### スクリプトの読み込み

- **type 属性**: ES モジュールの場合は `type="module"` を指定
- **defer/async**: 適切な属性を使用
- **位置**: 通常は `</body>` の直前に配置

---

## CSS

### ファイルヘッダーコメント

- **形式**: CSS コメントでファイルの先頭に責務を記述
- **例**:

```css
/* style.css: 管理画面全体に共通するテーマカラーやレイアウトユーティリティを定義するスタイル集です。 */
```

### CSS 変数（カスタムプロパティ）

- **定義場所**: `:root` セレクタで定義
- **命名**: `kebab-case`、意味が明確な名前
- **用途**: テーマカラー、スペーシング、ブレークポイントなど
- **例**:

```css
:root {
  --ui-bg: #0d1117;
  --accent: #1ec8ff;
  --card-max: min(780px, 90vw);
  --card-padding: clamp(1.8rem, 4vw, 2.6rem);
}
```

### セレクタの命名

- **クラス名**: `kebab-case` を使用
- **BEM 記法**: 必要に応じて使用（`.block__element--modifier`）
- **ID セレクタ**: スタイリングには使用しない（JavaScript での参照のみ）

### レスポンシブデザイン

- **モバイルファースト**: 基本スタイルをモバイル向けに記述し、メディアクエリで拡張
- **clamp()**: 流動的なサイズ指定に使用
- **min()/max()**: コンテナの最大幅などに使用

### モダン CSS 機能

- **Flexbox**: レイアウトに積極的に使用
- **Grid**: 複雑なレイアウトに使用
- **カスタムプロパティ**: テーマや設定値の管理に使用
- **論理プロパティ**: `margin-inline`, `padding-block` などを使用

### コメント

- **セクション区切り**: 大きなファイル内で機能ブロックを区切る
- **形式**: `/* ===== セクション名 ===== */`
- **例**:

```css
/* ===== Theme Tokens (Broadcast UI) ===== */
:root {
  /* ... */
}
```

### スタイルの順序

1. **変数定義**: `:root` でのカスタムプロパティ定義
2. **リセット/ベース**: リセット CSS、ベーススタイル
3. **レイアウト**: コンテナ、グリッド、フレックスボックス
4. **コンポーネント**: ボタン、カード、フォームなど
5. **ユーティリティ**: ヘルパークラス

---

## JavaScript

### ファイルヘッダーコメント

- **形式**: 1 行コメントでファイルの先頭に責務を記述
- **例**:

```javascript
// context-manager.js: ページコンテキストと外部コンテキストの管理を担当します。
```

### 定数ファイル（constants.js）

- **配置**: 各機能ディレクトリに `constants.js` を配置
- **責務**: その機能で使用する定数、設定値、ストレージキーを集約
- **共有設定**: `scripts/shared/` に共有設定ファイルを配置（例: `firebase-config.js`）
- **マジックナンバーの回避**: 数値リテラルは定数として定義（タイムアウト、間隔、閾値など）

**定数の命名規則**:

- **大文字とアンダースコア**: `UPPER_SNAKE_CASE` を使用
- **意味のある名前**: 数値の意味が明確に分かる名前を付ける
- **単位を含める**: 必要に応じて単位を含める（`_MS`, `_SEC`, `_PX` など）

**例**:

```javascript
// constants.js: オペレーター機能で共通利用する定数群を定義します。
import { FIREBASE_CONFIG } from "../shared/firebase-config.js";

export const firebaseConfig = FIREBASE_CONFIG;
export const GAS_API_URL = "https://...";
export const DICTIONARY_STATE_KEY = "telop-ops-dictionary-open";

// タイムアウト・間隔・閾値の定数
export const OPERATOR_PRESENCE_HEARTBEAT_MS = 60_000;
export const DISPLAY_PRESENCE_HEARTBEAT_MS = 20_000;
export const DISPLAY_PRESENCE_STALE_THRESHOLD_MS = 90_000;
export const AUTH_RESUME_FALLBACK_DELAY_MS = 4_000;

// オプション配列
export const GENRE_OPTIONS = [
  "学び",
  "活動",
  "暮らし",
  "食・スポット",
  "移動・季節",
  "その他",
];

// 正規表現パターン
export const ZERO_WIDTH_SPACE_PATTERN =
  /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;
```

### 設定ファイル（config.js）

- **配置**: 必要に応じて各機能ディレクトリに `config.js` を配置
- **責務**: 機能固有の設定オブジェクトやコンフィグレーションを定義
- **形式**: オブジェクト定数としてエクスポート

**例**:

```javascript
// config.js: イベント管理機能の設定を定義します。
export const PANEL_CONFIG = {
  events: { requireSchedule: false, logs: true },
  // ...
};
```

### モジュールシステム

- **ES Modules**: `import`/`export` を使用
- **デフォルトエクスポート**: 使用しない（明示的な名前付きエクスポートを推奨）
- **名前付きエクスポート**: クラス、関数、定数を個別にエクスポート
- **エクスポートの集約**: 複数のエクスポートがある場合は末尾でまとめてエクスポート
- **再エクスポート**: 他のモジュールからエクスポートを再公開する場合は `export { ... } from` を使用

**エクスポートのパターン**:

```javascript
// ✅ インラインエクスポート（推奨）
export function processData(data) {
  // 処理
}

export const CONSTANT_VALUE = "value";

export class MyClass {
  // クラス定義
}

// ✅ 末尾での集約エクスポート（多くのエクスポートがある場合）
function internalFunction() {
  // 内部関数
}

export { processData, CONSTANT_VALUE, MyClass };

// ✅ 再エクスポート（他のモジュールからエクスポートを再公開）
export { collectParticipantTokens } from "../shared/participant-tokens.js";
export { formatScheduleRange } from "../operator/utils.js";
```

### インポート順序

1. 外部ライブラリ（Firebase など）
2. 共有モジュール（`../shared/`）
3. 同一ディレクトリのモジュール（`./`）
4. **インポートのグループ化**: 関連するインポートをグループ化し、空行で区切る

**インポート順序のパターン**:

```javascript
// 1. 外部ライブラリ
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  ref,
  set,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// 2. 共有モジュール（shared/）
import { goToLogin } from "../shared/routes.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { OPERATOR_MODE_TELOP } from "../shared/operator-modes.js";

// 3. 相対パス（同一ディレクトリまたは親ディレクトリ）
import { queryDom } from "./dom.js";
import { createApiClient } from "./api-client.js";
import { formatScheduleRange } from "../operator/utils.js";
```

### クラス設計原則

1. **単一責任の原則**: 1 つのクラスは 1 つの責務のみを持つ
2. **依存性の注入**: 必要な依存関係はコンストラクタで受け取る
3. **委譲パターン**: 大きなクラスは機能別の Manager クラスに分割
4. **エクスポート**: 公開するクラスは `export class` を使用

**クラス定義のパターン**:

```javascript
// ✅ クラス定義
export class QuestionFormApp {
  /**
   * 依存するViewとDatabaseインスタンスを受け取り初期状態を確立します。
   * @param {{ view?: FormView, database?: import("firebase/database").Database }} [options]
   */
  constructor({ view, database } = {}) {
    this.database = database ?? getDatabaseInstance(firebaseConfig);
    this.view = view ?? new FormView();
    this.state = {
      context: null,
      token: null,
    };
  }

  /**
   * 初期化処理のエントリーポイント。
   */
  async init() {
    // 処理
  }
}

// static メソッド/プロパティの使用
export class OperatorApp {
  /**
   * 埋め込みモード時に使用されるURLプレフィックスを取得します。
   * @returns {string}
   */
  static get embedPrefix() {
    if (typeof document === "undefined") {
      return "";
    }
    return document.documentElement?.dataset?.operatorEmbedPrefix || "";
  }
}
```

### 関数定義

- **アロー関数**: 短い関数やコールバックで使用
- **関数宣言**: メソッド定義や名前付き関数で使用
- **async/await**: Promise チェーンより優先
- **エクスポート**: 公開する関数は `export function` または `export const` を使用

**関数定義のパターン**:

```javascript
// ✅ 関数宣言（メインの関数）
export function processData(data) {
  // 処理
}

// ✅ アロー関数（短い関数、コールバック）
export const formatValue = (value) => String(value ?? "").trim();

// ✅ async/await（非同期処理）
export async function fetchData(url) {
  const response = await fetch(url);
  return response.json();
}

// ✅ メソッドのバインド（クラス内）
constructor() {
  this.handleClick = this.handleClick.bind(this);
}

// ✅ Object.defineProperty を使用したメソッドバインディング
function bindModuleMethods(app) {
  MODULE_METHOD_GROUPS.forEach(({ module, methods }) => {
    methods.forEach((methodName) => {
      const implementation = module?.[methodName];
      if (typeof implementation !== "function") {
        throw new Error(`Missing method "${methodName}" on module.`);
      }
      Object.defineProperty(app, methodName, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (...args) => implementation(app, ...args)
      });
    });
  });
}

// ✅ .call() を使用したコンテキストの明示的な指定
target.addEventListener("click", (event) => method.call(app, event));
```

### Promise と async/await

- **非同期処理**: `async/await` を優先的に使用
- **エラーハンドリング**: `try-catch` で適切にエラーを処理
- **Promise の作成**: 必要に応じて `new Promise()` を使用（例: イベントリスナーの待機）
- **並列処理**: `Promise.all()` で複数の非同期処理を並列実行
- **部分成功**: `Promise.allSettled()` で一部が失敗しても全ての結果を取得
- **タイマー管理**: `setTimeout`/`clearTimeout`、`setInterval`/`clearInterval` は適切にクリーンアップする
- **ポーリング処理**: 条件を満たすまで繰り返しチェックする場合はタイムアウトを設定する

**非同期処理のパターン**:

```javascript
async function performAction() {
  try {
    const result = await someAsyncOperation();
    return result;
  } catch (error) {
    console.error("Action failed:", error);
    throw error;
  }
}

// イベントリスナーの待機
function waitForEvent(element, eventName) {
  return new Promise((resolve) => {
    const handler = () => {
      element.removeEventListener(eventName, handler);
      resolve();
    };
    element.addEventListener(eventName, handler);
  });
}

// タイマーのクリーンアップ
let timerId = null;

function startTimer() {
  clearTimer();
  timerId = setTimeout(() => {
    // 処理
    timerId = null;
  }, 1000);
}

function clearTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

// インターバルの管理
let intervalId = null;

function startInterval() {
  stopInterval();
  intervalId = setInterval(() => {
    // 処理
  }, 1000);
}

function stopInterval() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ポーリング処理
async function waitForCondition(check, timeoutMs = 5000, intervalMs = 150) {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
```

### イベントハンドリング

- **イベントリスナーの登録**: `addEventListener` を使用
- **クリーンアップ**: 不要になったイベントリスナーは `removeEventListener` で削除
- **バインディング**: メソッドをイベントハンドラとして使用する場合は `.bind()` でコンテキストを固定

**イベントハンドリングのパターン**:

```javascript
// コンストラクタでバインディング
constructor() {
  this.handleClick = this.handleClick.bind(this);
}

// イベントリスナーの登録
element.addEventListener("click", this.handleClick);

// クリーンアップ
cleanup() {
  element.removeEventListener("click", this.handleClick);
}

// リソースのクリーンアップ（タイマー、イベントリスナー、購読など）
cleanup() {
  // タイマーのクリーンアップ
  if (this.timerId) {
    clearTimeout(this.timerId);
    this.timerId = null;
  }
  if (this.intervalId) {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  // イベントリスナーのクリーンアップ
  if (this.element && this.handler) {
    this.element.removeEventListener("click", this.handler);
  }

  // Firebase 購読のクリーンアップ
  if (this.unsubscribe) {
    this.unsubscribe();
    this.unsubscribe = null;
  }
}

// destroy メソッド（クラスの完全な破棄）
destroy() {
  if (this.addButton) {
    this.addButton.removeEventListener("click", this.boundHandleAdd);
  }
  // その他のクリーンアップ処理
}
```

### 非同期処理の中断（AbortController）

- **用途**: 長時間実行される非同期処理を中断する場合に使用
- **パターン**: `AbortController` を使用して処理を中断可能にする
- **フォールバック**: `AbortController` が利用できない環境では簡易的なモックを提供

**AbortController のパターン**:

```javascript
// AbortController の作成
export function createSubmissionController() {
  if (typeof AbortController === "function") {
    return new AbortController();
  }
  // フォールバック: 簡易的なモック
  const signal = { aborted: false };
  return {
    signal,
    abort() {
      signal.aborted = true;
    },
  };
}

// 中断チェック
export function ensureControllerActive(controller) {
  if (controller?.signal?.aborted) {
    throw createAbortError();
  }
}

// 使用例
async function submitData(controller) {
  ensureControllerActive(controller);

  try {
    const result = await fetch(url, {
      signal: controller.signal,
    });
    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      // 中断された場合の処理
      return null;
    }
    throw error;
  }
}

// 中断の実行
const controller = createSubmissionController();
const promise = submitData(controller);
// 必要に応じて中断
controller.abort();
```

**並列処理のパターン**:

```javascript
// Promise.all: 全て成功する必要がある場合
const [user, events, schedules] = await Promise.all([
  fetchUser(userId),
  fetchEvents(),
  fetchSchedules(eventId),
]);

// Promise.allSettled: 一部が失敗しても全ての結果を取得
const results = await Promise.allSettled([
  fetchUser(userId),
  fetchEvents(),
  fetchSchedules(eventId),
]);

results.forEach((result, index) => {
  if (result.status === "fulfilled") {
    console.log(`Task ${index} succeeded:`, result.value);
  } else {
    console.error(`Task ${index} failed:`, result.reason);
  }
});

// エラーハンドリング付き Promise.all
try {
  const results = await Promise.all([
    fetchUser(userId),
    fetchEvents(),
    fetchSchedules(eventId),
  ]);
  // 全て成功した場合の処理
} catch (error) {
  // いずれかが失敗した場合の処理
  console.error("One or more requests failed", error);
}
```

### Factory 関数パターン

- **用途**: オブジェクトやコントローラーの作成を統一する
- **命名**: `create*` で始まる関数名を使用
- **依存性注入**: テスト容易性のために依存関係をオプションで注入可能にする

**Factory 関数のパターン**:

```javascript
// ✅ Factory 関数（推奨）
export function createApiClient(authInstance, onAuthStateChanged) {
  // 実装
  return {
    apiPost: async (endpoint, payload) => {
      /* ... */
    },
    fireAndForgetApi: async (endpoint, payload) => {
      /* ... */
    },
    logAction: async (action, details) => {
      /* ... */
    },
  };
}

// ✅ オプション付き Factory 関数
function createPrintPreviewController({
  previewContainer,
  previewFrame,
  previewMeta,
  defaultNote = DEFAULT_PREVIEW_NOTE,
  loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  defaultSettings = DEFAULT_PRINT_SETTINGS,
  normalizeSettings = (settings, fallback) =>
    normalizePrintSettings(settings, fallback),
  onVisibilityChange,
  onCacheChange,
  openPopup = defaultOpenPrintWindow,
  openDialog,
  closeDialog,
} = {}) {
  // 実装
  return {
    updatePreview: () => {
      /* ... */
    },
    cleanup: () => {
      /* ... */
    },
  };
}
```

### 環境検出とフォールバック

- **環境チェック**: `typeof window !== "undefined"`, `typeof document !== "undefined"` などで環境を検出
- **フォールバック**: 環境が利用できない場合の代替処理を提供
- **グローバルスコープ**: `globalThis` を使用してブラウザ/Node の両環境に対応

**環境検出のパターン**:

```javascript
// ブラウザ環境の検出
function getDocument() {
  if (typeof document !== "undefined") {
    return document;
  }
  return null;
}

// タイマーホストの解決（ブラウザ/Node 両対応）
function getTimerHost() {
  if (
    typeof window !== "undefined" &&
    typeof window.setTimeout === "function"
  ) {
    return window;
  }
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.setTimeout === "function"
  ) {
    return globalThis;
  }
  return {
    setTimeout,
    clearTimeout,
  };
}

// SSR 環境での安全な処理
export function prepareEmbeddedFrames(dom) {
  if (typeof document === "undefined") {
    return;
  }
  // DOM 操作
}

// IIFE での重複初期化防止
(() => {
  const runtime = typeof globalThis !== "undefined" ? globalThis : window;
  if (runtime.__MODULE_INITIALIZED__) {
    return;
  }
  runtime.__MODULE_INITIALIZED__ = true;
  // 初期化処理
})();
```

### ログ出力

- **統一されたフォーマット**: プレフィックスを使用してログの出所を明確にする
- **ログレベル**: `log`, `info`, `warn`, `error` を適切に使い分ける
- **デバッグログ**: デバッグ用のログは条件付きで出力する
- **ログ関数の統一**: モジュールごとに統一されたログ関数を提供

**ログ出力のパターン**:

```javascript
// プレフィックス付きログ
const PREFIX = "[ModuleName]";
console.log(PREFIX, "Message", details);

// レベル別ログ関数
function logError(message, error) {
  console.error(PREFIX, message, error);
}

// 統一されたログ関数
function log(level, message, ...details) {
  const method =
    typeof console?.[level] === "function" ? console[level] : console.log;
  const normalizedMessage =
    typeof message === "string" ? message : String(message ?? "");
  const extras = details.filter((detail) => detail !== undefined);
  method.call(console, PREFIX, normalizedMessage, ...extras);
}

// 条件付きデバッグログ
const DEBUG_ENABLED = false;
if (DEBUG_ENABLED) {
  console.log(PREFIX, "Debug message");
}

// コンソールの存在確認
if (typeof console !== "undefined" && typeof console.error === "function") {
  console.error(PREFIX, "Error message", error);
}
```

### モジュール初期化

- **重複初期化の防止**: グローバルフラグを使用して重複初期化を防ぐ
- **IIFE**: 必要に応じて即時実行関数式（IIFE）を使用

**モジュール初期化のパターン**:

```javascript
(() => {
  const runtime = typeof globalThis !== "undefined" ? globalThis : window;
  if (runtime.__MODULE_INITIALIZED__) {
    return;
  }
  runtime.__MODULE_INITIALIZED__ = true;

  // 初期化処理
})();
```

### 型チェックとバリデーション

- **typeof**: プリミティブ型のチェックに使用
- **instanceof**: オブジェクト型のチェックに使用
- **Array.isArray**: 配列のチェックに使用
- **null/undefined チェック**: `== null` で null と undefined を同時にチェック

**型チェックのパターン**:

```javascript
// typeof の使用
if (typeof value === "string") {
  // 文字列処理
}

// instanceof の使用
if (error instanceof FormValidationError) {
  // カスタムエラーの処理
}

// Array.isArray の使用
if (Array.isArray(items)) {
  // 配列処理
}

// null/undefined チェック
if (value == null) {
  // null または undefined の場合
}

// 数値の検証
if (typeof value === "number") {
  if (Number.isFinite(value)) {
    // 有限の数値の場合
  }
  if (Number.isNaN(value)) {
    // NaN の場合
  }
}

// 数値への変換と検証
const numericValue = Number(value);
if (Number.isFinite(numericValue)) {
  // 有効な数値として使用
} else {
  // 無効な数値の場合のフォールバック
}

// 型変換の使用
const stringValue = String(value || ""); // 安全な文字列変換
const numberValue = Number(value); // 数値変換（NaN の可能性あり）
const booleanValue = Boolean(value); // 真偽値変換

// 型変換と検証の組み合わせ
const normalized =
  typeof value === "string" ? value.trim() : String(value).trim();
const parsed = typeof value === "number" ? value : Number(value);
if (!Number.isFinite(parsed)) {
  // 無効な数値の場合の処理
}

// タイムスタンプの検証
const timestampCandidate = Number(now());
const timestamp = Number.isFinite(timestampCandidate)
  ? timestampCandidate
  : Date.now();
```

### null 安全とオプショナルチェーン

- **nullish coalescing (`??`)**: null または undefined の場合のデフォルト値
- **オプショナルチェーン (`?.`)**: プロパティアクセスの安全化
- **フォールバック処理**: 値が存在しない場合の代替処理

**null 安全のパターン**:

```javascript
// nullish coalescing
const value = input ?? defaultValue;
const trimmed = String(value ?? "").trim();

// オプショナルチェーン
const name = user?.profile?.name ?? "Unknown";
const result = element?.querySelector?.(".target");

// フォールバック処理
const storage = safeGetStorage();
if (!storage) {
  return null;
}
```

### 分割代入とスプレッド演算子

- **分割代入**: オブジェクトや配列から値を取り出す
- **スプレッド演算子**: 配列やオブジェクトの展開、コピー
- **関数パラメータ**: オプションオブジェクトの分割代入を使用して可読性を向上

**分割代入とスプレッドのパターン**:

```javascript
// オブジェクトの分割代入
const { eventId, scheduleId } = context;
const { name, email, ...rest } = user;

// 配列の分割代入
const [first, second, ...others] = items;

// 関数パラメータでの分割代入（オプションオブジェクト）
function createPrintPreviewController({
  previewContainer,
  previewFrame,
  previewMeta,
  previewNote,
  previewPrintButton,
  previewDialog,
  defaultNote = DEFAULT_PREVIEW_NOTE,
  loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  defaultSettings = DEFAULT_PRINT_SETTINGS,
  normalizeSettings = (settings, fallback) =>
    normalizePrintSettings(settings, fallback),
  onVisibilityChange,
  onCacheChange,
  openPopup = defaultOpenPrintWindow,
  openDialog,
  closeDialog,
} = {}) {
  // 処理
}

// 関数パラメータでの分割代入（必須パラメータ + オプション）
export function collectClientMetadata({
  navigator: nav = typeof navigator !== "undefined" ? navigator : undefined,
  document: doc = typeof document !== "undefined" ? document : undefined,
  location: loc = typeof location !== "undefined" ? location : undefined,
  now = Date.now,
} = {}) {
  // 処理
}

// スプレッド演算子（配列）
const combined = [...array1, ...array2];

// スプレッド演算子（オブジェクト）
const merged = { ...defaults, ...overrides };
```

### データ正規化とユーティリティ関数

- **正規化関数**: `normalizeKey`, `ensureString`, `ensureTrimmedString` などの統一された正規化関数を使用
- **NFKC 正規化**: Unicode 正規化が必要な場合は NFKC を使用
- **ゼロ幅スペース除去**: ゼロ幅スペースを除去する処理を統一

**データ正規化のパターン**:

```javascript
// 文字列の正規化
export function ensureTrimmedString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value.trim() : String(value).trim();
}

// キーの正規化
export function normalizeKey(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .normalize("NFKC");
}

// ゼロ幅スペース除去
const ZERO_WIDTH_SPACE_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;
const normalized = value.replace(ZERO_WIDTH_SPACE_PATTERN, "");
```

### Firebase Realtime Database 操作

- **参照の取得**: `ref(database, path)` を使用
- **データの読み取り**: `onValue()`, `get()` を使用
- **データの書き込み**: `set()`, `update()`, `remove()` を使用
- **タイムスタンプ**: `serverTimestamp()` を使用してサーバー側のタイムスタンプを取得

**Firebase 操作のパターン**:

```javascript
import { database, ref, set, onValue, serverTimestamp } from "./firebase.js";

// 参照の取得
const questionsRef = ref(database, `questions/normal/${uid}`);

// データの書き込み
await set(questionsRef, {
  uid,
  name,
  question,
  ts: serverTimestamp(),
});

// データの読み取り（リアルタイム）
onValue(questionsRef, (snapshot) => {
  const data = snapshot.val();
  // 処理
});
```

### 正規表現（RegExp）

- **リテラル形式**: 静的なパターンには `/pattern/flags` を使用
- **コンストラクタ形式**: 動的なパターンには `new RegExp(pattern, flags)` を使用
- **エスケープ処理**: ユーザー入力から正規表現を作成する場合は `escapeRegExp()` でエスケープ

**正規表現のパターン**:

```javascript
// リテラル形式（静的パターン）
const ZERO_WIDTH_SPACE_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;

// コンストラクタ形式（動的パターン）
const patternSource = entries
  .map((entry) => escapeRegExp(entry.term))
  .join("|");
const regex = new RegExp(patternSource, "g");

// エスケープ処理
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

### URL とルーティング

- **ルーティング関数**: `scripts/shared/routes.js` に集中管理
- **ナビゲーション**: `window.location.replace()` を使用（履歴に残さない）
- **URL パラメータ**: `URLSearchParams` を使用してパラメータを取得・解析

**URL とルーティングのパターン**:

```javascript
// ルーティング関数の定義
export function goToLogin() {
  replaceLocation(LOGIN_PAGE);
}

// URL パラメータの解析
const urlSearchParams = new URL(location.href).searchParams;
const eventId = urlSearchParams.get("eventId");

// 複数のキーを試行するパターン
export function extractToken(
  search = window.location.search,
  tokenKeys = TOKEN_PARAM_KEYS
) {
  const params = new URLSearchParams(search);
  for (const key of tokenKeys) {
    const value = params.get(key);
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^[A-Za-z0-9_-]{12,128}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

// URLSearchParams の型チェック
if (!(searchParams instanceof URLSearchParams)) {
  return { eventId: "", scheduleId: "" };
}
```

### 日付・時刻の処理

- **Date オブジェクト**: 日付・時刻の操作に使用
- **Intl.DateTimeFormat**: ロケール対応の日付フォーマットに使用（利用可能な場合）
- **パース関数**: 統一されたパース関数を使用（`parseDateTimeValue`, `parseLogTimestamp` など）

**日付・時刻処理のパターン**:

```javascript
// Intl.DateTimeFormat の使用（フォールバック付き）
const hasIntlDateTime =
  typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
const DATE_FORMATTER = hasIntlDateTime
  ? new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  : null;

// 日付のパース
export function parseDateTimeValue(value) {
  const trimmed = ensureTrimmedString(value);
  if (!trimmed) return null;
  // パース処理
  return new Date(/* ... */);
}
```

### CSV 処理

- **CSV パース**: 統一された `parseCsv()` 関数を使用
- **BOM 除去**: UTF-8 BOM を除去する処理を含める
- **エラーハンドリング**: 不正な CSV 形式に対する適切なエラーメッセージ

**CSV 処理のパターン**:

```javascript
// BOM 除去
function stripBom(text) {
  if (!text) return "";
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// CSV パース
function parseCsv(text) {
  const sanitized = stripBom(String(text || ""));
  // パース処理
  return rows;
}
```

### イベント処理

- **イベントの伝播制御**: `preventDefault()`, `stopPropagation()`, `stopImmediatePropagation()` を使用
- **イベントターゲット**: `event.target` と `event.currentTarget` を適切に使い分け
- **イベント委譲**: 親要素でイベントを処理し、`event.target` で実際の要素を判定

**イベント処理のパターン**:

```javascript
// preventDefault: デフォルト動作を防止
form.addEventListener("submit", (event) => {
  event.preventDefault();
  // カスタム処理
});

// stopPropagation: イベントの伝播を停止
button.addEventListener("click", (event) => {
  event.stopPropagation();
  // 親要素への伝播を防ぐ
});

// event.target と event.currentTarget の使い分け
container.addEventListener("click", (event) => {
  // event.currentTarget: イベントリスナーが登録された要素（container）
  // event.target: 実際にクリックされた要素（子要素の可能性）
  if (event.target.classList.contains("item")) {
    // 子要素がクリックされた場合の処理
  }
});

// イベント委譲パターン
list.addEventListener("click", (event) => {
  const item = event.target.closest(".list-item");
  if (item) {
    // リストアイテムがクリックされた場合の処理
  }
});
```

### キーボードショートカット

- **キーボードイベント**: `keydown` イベントを使用
- **入力フィールドの除外**: 入力フィールドにフォーカスがある場合はショートカットを無効化
- **HTML での表示**: `<kbd>` 要素でショートカットキーを表示

**キーボードショートカットのパターン**:

```javascript
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isFormField =
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [role='textbox']");

  // 入力フィールドにフォーカスがある場合は無視
  if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      // 処理
    }
  }
});
```

**HTML での表示**:

```html
<button type="button">ログアウト <kbd>L</kbd></button>
```

### クリップボード操作

- **Clipboard API**: `navigator.clipboard.writeText()` を優先的に使用
- **フォールバック**: Clipboard API が利用できない場合は代替方法を実装

**クリップボード操作のパターン**:

```javascript
let success = false;
try {
  if (
    navigator?.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(url);
    success = true;
  }
} catch (error) {
  console.warn("navigator.clipboard.writeText failed", error);
}

// フォールバック処理
if (!success) {
  // 代替方法を実装
}
```

### フォームバリデーション

- **HTML5 バリデーション API**: `reportValidity()`, `setCustomValidity()`, `checkValidity()` を使用
- **カスタムバリデーション**: 独自のバリデーションロジックと組み合わせる
- **エラー表示**: バリデーションエラーは適切にユーザーに表示

**フォームバリデーションのパターン**:

```javascript
// HTML5 バリデーション API の使用
if (!this.view.reportValidity()) {
  this.view.setFeedback("未入力の項目があります。確認してください。", "error");
  return;
}

// カスタムバリデーションメッセージの設定
const input = this.view.radioNameInput;
if (input && typeof input.setCustomValidity === "function") {
  input.setCustomValidity("ラジオネームを入力してください。");
  input.reportValidity();
  input.setCustomValidity(""); // メッセージをクリア
}

// カスタムエラーと組み合わせたバリデーション
try {
  formData = this.getSanitizedFormData();
} catch (error) {
  if (error instanceof FormValidationError) {
    error.invokeFocus(); // フォーカス移動
    this.view.setFeedback(error.message, "error");
    return;
  }
  throw error;
}
```

### ページ離脱警告

- **beforeunload イベント**: 未保存の変更がある場合にページ離脱を警告
- **条件付き**: 実際に未保存の変更がある場合のみ警告を表示

**ページ離脱警告のパターン**:

```javascript
// beforeunload イベントの登録
bindBeforeUnload(handler) {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", handler);
}

// ハンドラの実装
handleBeforeUnload(event) {
  if (this.hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = ""; // ブラウザのデフォルトメッセージを表示
  }
}
```

### ダイアログ管理とフォーカス管理

- **アクティブダイアログ**: 現在開いているダイアログを追跡
- **フォーカス管理**: ダイアログを開く際にフォーカスを保存し、閉じる際に復元
- **フォーカストラップ**: ダイアログ内でフォーカスを閉じ込める
- **ESC キー**: ESC キーでダイアログを閉じる

**ダイアログ管理のパターン**:

```javascript
const dialogState = {
  active: null,
  lastFocused: null,
};

// ダイアログを開く
function openDialog(element) {
  if (!element) return;
  if (dialogState.active && dialogState.active !== element) {
    closeDialog(dialogState.active);
  }
  dialogState.active = element;
  dialogState.lastFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  element.removeAttribute("hidden");
  document.body.classList.add("modal-open");

  // フォーカスをダイアログ内の要素に移動
  const focusTarget =
    element.querySelector("[data-autofocus]") ||
    element.querySelector("input, select, textarea, button");
  if (focusTarget instanceof HTMLElement) {
    requestAnimationFrame(() => focusTarget.focus());
  }
}

// ダイアログを閉じる
function closeDialog(element, options = {}) {
  if (!element) return;
  element.setAttribute("hidden", "");
  document.body.classList.remove("modal-open");

  // フォーカスを元の要素に復元
  if (dialogState.lastFocused && dialogState.lastFocused.focus) {
    requestAnimationFrame(() => dialogState.lastFocused.focus());
  }
  dialogState.active = null;
  dialogState.lastFocused = null;
}

// ESC キーでダイアログを閉じる
function handleDialogKeydown(event) {
  if (event.key === "Escape" && dialogState.active) {
    event.preventDefault();
    closeDialog(dialogState.active);
  }
}
```

### ブラウザ API の使用

#### requestAnimationFrame

- **用途**: DOM 更新の視覚的な反映を待つ場合に使用
- **フォールバック**: `requestAnimationFrame` が利用できない場合は `setTimeout` を使用

**requestAnimationFrame のパターン**:

```javascript
// DOM更新の視覚的な反映を待つ
async function waitForVisualUpdate({ minimumDelay = 0 } = {}) {
  await new Promise((resolve) => {
    const raf =
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : null;
    if (raf) {
      raf(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
  if (minimumDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, minimumDelay));
  }
}
```

#### Crypto API

- **用途**: UUID 生成やランダム値生成に使用
- **フォールバック**: Crypto API が利用できない場合は `Math.random()` を使用

**Crypto API のパターン**:

```javascript
// Crypto API の解決
function resolveCrypto(scopes = []) {
  for (const scope of scopes) {
    if (scope?.crypto) {
      return scope.crypto;
    }
  }
  return null;
}

// UUID生成（Crypto API 優先、フォールバック付き）
function generateQuestionUid({
  crypto: cryptoOverride,
  random = Math.random,
  now = Date.now,
} = {}) {
  const cryptoObj = cryptoOverride ?? resolveCrypto([globalThis, window, self]);

  if (cryptoObj) {
    if (typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    if (typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return formatUuidFromBytes(bytes);
    }
  }

  // フォールバック: Math.random() を使用
  const timestamp = Number.isFinite(Number(now())) ? Number(now()) : Date.now();
  const timestampPart = timestamp.toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${timestampPart}_${randomSuffix}`;
}
```

#### TreeWalker API

- **用途**: DOM ツリーを効率的に走査する場合に使用
- **パターン**: `document.createTreeWalker()` を使用してテキストノードを収集

**TreeWalker API のパターン**:

```javascript
// TreeWalker を使用してテキストノードを収集
const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
const textNodes = [];
while (walker.nextNode()) {
  textNodes.push(walker.currentNode);
}

// 収集したテキストノードを処理
for (const node of textNodes) {
  const value = node.nodeValue;
  if (!value) continue;
  // 処理
}
```

#### バイナリデータ処理

- **Uint8Array**: バイト配列の操作に使用
- **ArrayBuffer**: バイナリデータのバッファとして使用
- **TextDecoder**: バイナリデータをテキストに変換
- **文字エンコーディング**: UTF-8, Shift_JIS などの複数エンコーディングに対応
- **BOM の除去**: UTF-8 BOM（`\uFEFF`）を適切に処理

**バイナリデータ処理のパターン**:

```javascript
// ファイルをバイナリとして読み込み、テキストに変換
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    if (typeof TextDecoder === "undefined") {
      // フォールバック: FileReader を使用
      const reader = new FileReader();
      reader.onload = () => {
        resolve(stripBom(String(reader.result || "")));
      };
      reader.onerror = () => {
        reject(new Error("ファイルの読み込みに失敗しました。"));
      };
      reader.readAsText(file, "utf-8");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result;
        const buffer =
          result instanceof ArrayBuffer
            ? result
            : result?.buffer instanceof ArrayBuffer
            ? result.buffer
            : null;

        if (!buffer) {
          resolve(stripBom(String(result || "")));
          return;
        }

        const bytes = new Uint8Array(buffer);
        resolve(decodeCsvBytes(bytes));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    };
    reader.readAsArrayBuffer(file);
  });
}

// 複数のエンコーディングを試行
function decodeCsvBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return "";
  }

  const attempts = [
    () => new TextDecoder("utf-8", { fatal: true }),
    () => new TextDecoder("utf-8"),
    () => new TextDecoder("shift_jis"),
    () => new TextDecoder("windows-31j"),
    () => new TextDecoder("ms932"),
  ];

  for (const createDecoder of attempts) {
    try {
      const decoder = createDecoder();
      const text = decoder.decode(bytes);
      if (typeof text === "string") {
        return stripBom(text);
      }
    } catch (error) {
      // 次のデコーダーを試行
    }
  }

  throw new Error("CSV ファイルの文字エンコーディングを判定できませんでした。");
}

// BOM の除去
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
```

### セキュリティ

#### XSS 対策

- **HTML エスケープ**: ユーザー入力や外部データを HTML に挿入する場合は必ずエスケープ
- **`textContent` の使用**: DOM 操作では `innerHTML` の代わりに `textContent` を使用
- **`escapeHtml()` 関数**: 統一された `escapeHtml()` 関数を使用

**XSS 対策のパターン**:

```javascript
// HTML エスケープ関数
export function escapeHtml(value) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// textContent の使用（推奨）
element.textContent = userInput;

// innerHTML を使用する場合は必ずエスケープ
element.innerHTML = escapeHtml(userInput);
```

#### 入力検証とサニタイゼーション

- **入力検証**: ユーザー入力は必ず検証する
- **データ正規化**: 入力データは正規化関数で処理する
- **ゼロ幅スペース除去**: ゼロ幅スペースなどの制御文字を除去

**入力検証のパターン**:

```javascript
// 入力の検証と正規化
const sanitizedName = sanitizeRadioName(
  this.view.getRadioNameValue(),
  MAX_RADIO_NAME_LENGTH
);

// ゼロ幅スペース除去
const ZERO_WIDTH_SPACE_PATTERN = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;
const normalized = value.replace(ZERO_WIDTH_SPACE_PATTERN, "");
```

### バージョン管理

- **バージョン番号**: 機能固有のバージョン番号を定数として定義
- **命名規則**: `FORM_VERSION`, `CONTEXT_VERSION` などの形式
- **用途**: データ互換性の管理、デバッグ、ログ記録

**バージョン管理のパターン**:

```javascript
// 機能固有のバージョン
export const FORM_VERSION = "question-form@2024.11";
export const CONTEXT_VERSION = 1;

// 送信ペイロードに含める
const submission = {
  // ...
  formVersion: FORM_VERSION,
};
```

### 状態管理

- **状態の場所**: アプリケーションの状態は適切な場所に集約
- **状態の更新**: 直接変更を避け、メソッド経由で更新
- **イミュータブル**: 可能な限り新しいオブジェクトを作成して更新
- **ローディング状態**: 複数の非同期処理を束ねてローディング状態を管理

**ローディング状態管理のパターン**:

```javascript
// LoadingTracker: 複数の非同期処理を束ねて読込状態を監視
export class LoadingTracker {
  constructor({ onChange } = {}) {
    this.depth = 0;
    this.message = "";
    this.onChange = typeof onChange === "function" ? onChange : () => {};
  }

  begin(message = "") {
    this.depth += 1;
    if (message || !this.message) {
      this.message = message;
    }
    this.onChange(this.getState());
  }

  end() {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.message = "";
    }
    this.onChange(this.getState());
  }

  isActive() {
    return this.depth > 0;
  }

  getState() {
    return { active: this.isActive(), message: this.message };
  }
}

// 使用例
const tracker = new LoadingTracker({
  onChange: (state) => {
    if (state.active) {
      showLoader(state.message);
    } else {
      hideLoader();
    }
  },
});

tracker.begin("データを読み込んでいます...");
try {
  await fetchData();
} finally {
  tracker.end();
}
```

### データ構造の選択

- **Map**: キーが動的またはオブジェクトの場合、頻繁な追加・削除がある場合に使用
- **Set**: 一意の値の集合を管理する場合に使用
- **オブジェクト**: 静的な構造で、シリアライズが必要な場合に使用

**例**:

```javascript
// Map の使用例
const questionsByUid = new Map();
const duplicateMatches = new Map();

// Set の使用例
const knownTokens = new Set();
const stageHistory = new Set(["events"]);

// オブジェクトの使用例
const printSettings = {
  paperSize: "A4",
  orientation: "portrait",
  // ...
};
```

### 配列操作

- **map**: 配列の各要素を変換して新しい配列を作成
- **filter**: 条件に合う要素だけを抽出
- **reduce**: 配列を 1 つの値に集約
- **forEach**: 副作用を伴う処理（新しい配列を作らない）
- **for...of**: 通常のループ処理
- **Array.from**: 配列風オブジェクトやイテレータを配列に変換
- **Array.isArray**: 配列かどうかを判定
- **Array.of**: 引数から配列を作成

**配列操作のパターン**:

```javascript
// ✅ map（変換）
const names = items.map((item) => item.name);

// ✅ filter（抽出）
const activeItems = items.filter((item) => item.isActive);

// ✅ reduce（集約）
const total = items.reduce((sum, item) => sum + item.count, 0);

// ✅ forEach（副作用）
items.forEach((item) => {
  console.log(item);
});

// ✅ for...of（通常のループ）
for (const item of items) {
  if (!item.isValid) continue;
  processItem(item);
}

// ✅ while ループ（条件が満たされる間繰り返す）
while (walker.nextNode()) {
  textNodes.push(walker.currentNode);
}

// ✅ continue/break の使用
for (const item of items) {
  if (!item.isValid) continue; // 次のイテレーションへ
  if (item.isComplete) break; // ループを終了
  processItem(item);
}

// ✅ Array.from（配列風オブジェクトやイテレータを配列に変換）
const nodeList = document.querySelectorAll(".item");
const items = Array.from(nodeList);
// または文字列を文字配列として処理
for (const char of Array.from(value)) {
  // 処理
}

// ✅ Array.isArray（配列判定）
if (Array.isArray(items)) {
  // 配列の場合の処理
}

// ✅ Array.of（引数から配列を作成）
const numbers = Array.of(1, 2, 3); // [1, 2, 3]
```

### ジェネレータ関数

- **用途**: 遅延評価が必要な場合、大きなデータセットを段階的に処理する場合
- **構文**: `function*` と `yield` を使用
- **使用例**: 文字列の結合文字単位での走査など

**ジェネレータ関数のパターン**:

```javascript
/**
 * Intl.Segmenterが利用可能であれば結合文字単位で文字列を走査するジェネレーター。
 * @param {string} value
 */
function* iterateGraphemes(value) {
  if (!value) {
    return;
  }
  if (graphemeSegmenter) {
    for (const segmentData of graphemeSegmenter.segment(value)) {
      yield segmentData.segment;
    }
    return;
  }
  for (const char of Array.from(value)) {
    yield char;
  }
}

// 使用例
for (const grapheme of iterateGraphemes(text)) {
  // 処理
}
```

### オブジェクト操作

- **Object.keys**: オブジェクトのキーを配列で取得
- **Object.values**: オブジェクトの値を配列で取得
- **Object.entries**: オブジェクトのキーと値のペアを配列で取得
- **Object.assign**: オブジェクトのコピーやマージ
- **Object.create**: プロトタイプチェーンを指定したオブジェクトの作成

**オブジェクト操作のパターン**:

```javascript
// ✅ Object.values（値の取得）
Object.values(branch).forEach((scheduleBranch) => {
  // 処理
});

// ✅ Object.entries（キーと値のペア）
Object.entries(config).forEach(([key, value]) => {
  // 処理
});

// ✅ Object.assign（マージ）
const merged = Object.assign({}, defaults, overrides);

// ✅ スプレッド演算子（推奨）
const merged = { ...defaults, ...overrides };

// ✅ Object.create(null)（プロトタイプチェーンを持たない純粋なオブジェクトの作成）
const evaluationState = Object.assign(
  Object.create(null), // null プロトタイプで純粋なオブジェクトを作成
  state && typeof state === "object" ? state : {}
);

// テンプレート評価での使用例
const cleanObject = Object.create(null);
cleanObject.key = "value";

// ✅ Object.defineProperty（プロパティディスクリプタを指定してプロパティを定義）
Object.defineProperty(app, methodName, {
  configurable: true,
  enumerable: false,
  writable: true,
  value: (...args) => implementation(app, ...args),
});

// ✅ Object.freeze（オブジェクトの凍結）
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "...",
  // ...
});
```

### DOM 操作

- **DOM 要素の取得**: `dom.js` ファイルで `queryDom()` 関数を提供し、DOM 要素を一括取得
- **埋め込みプレフィックス**: 埋め込みモードでは ID プレフィックスを考慮した要素取得を行う
- **要素の命名**: `queryDom()` で返されるオブジェクトのプロパティ名は `camelCase` を使用

**DOM 操作のパターン**:

```javascript
// dom.js: オペレーター画面のDOM参照取得やテンプレート生成をまとめたユーティリティです。
function resolve(id) {
  const prefix = getPrefix();
  if (prefix) {
    const prefixed = document.getElementById(`${prefix}${id}`);
    if (prefixed) return prefixed;
  }
  return document.getElementById(id);
}

export function queryDom() {
  return {
    loginButton: resolve("login-button"),
    mainContainer: resolve("main-container"),
    // ...
  };
}
```

**埋め込みプレフィックスの処理**:

- 埋め込みモードでは `data-*-embed-prefix` 属性からプレフィックスを取得
- プレフィックス付き ID と通常の ID の両方を試行して要素を取得
- フォールバック処理を実装して、プレフィックスが外れている環境でも動作するようにする

### DOM 要素の作成と操作

- **要素の作成**: `document.createElement()` を使用
- **テンプレート要素のクローン**: `<template>` 要素の `content.cloneNode(true)` を使用
- **DocumentFragment**: 複数の要素を一度に追加する場合は `document.createDocumentFragment()` を使用
- **classList 操作**: `classList.add()`, `classList.remove()`, `classList.toggle()`, `classList.contains()` を使用
- **dataset 操作**: `dataset.*` プロパティを使用して data 属性にアクセス
- **属性操作**: `setAttribute()`, `getAttribute()`, `removeAttribute()` を使用

**DOM 要素の作成と操作のパターン**:

```javascript
// 要素の作成
const card = document.createElement("article");
card.className = "q-card";

// テンプレート要素のクローン
const fragment = this.facultyTemplate.content.cloneNode(true);
const card = fragment.querySelector("[data-faculty-card]");

// DocumentFragment の使用（複数要素を一度に追加）
const frag = document.createDocumentFragment();
while (condition) {
  const element = document.createElement("div");
  frag.appendChild(element);
}
container.appendChild(frag);

// classList 操作
card.classList.add("is-answered");
card.classList.remove("is-loading");
card.classList.toggle("is-active", condition);
if (card.classList.contains("is-selecting")) {
  // 処理
}

// dataset 操作
element.dataset.uid = uid;
element.dataset.initialized = "true";
if (element.dataset.prepared === "true") {
  // 処理
}

// 属性操作
element.setAttribute("aria-label", label);
const value = element.getAttribute("data-value");
element.removeAttribute("hidden");
```

### ストレージ操作（localStorage/sessionStorage）

- **安全な取得**: ストレージが利用できない場合（プライベートブラウジングなど）を考慮
- **エラーハンドリング**: `try-catch` でストレージ操作をラップ
- **JSON のシリアライズ**: オブジェクトを保存する場合は `JSON.stringify()` を使用
- **JSON のパース**: 取得時は `JSON.parse()` を使用し、エラーハンドリングを実装

**ストレージ操作のパターン**:

```javascript
// 安全なストレージ取得
function safeGetStorage(kind) {
  try {
    if (typeof window === "undefined") return null;
    if (kind === "session") {
      return window.sessionStorage || null;
    }
    if (kind === "local") {
      return window.localStorage || null;
    }
  } catch (error) {
    console.warn(`Storage (${kind}) unavailable`, error);
  }
  return null;
}

// ストレージへの保存
function saveToStorage(key, value) {
  const storage = safeGetStorage("local");
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.warn("Failed to save to storage", error);
    return false;
  }
}

// ストレージからの取得
function loadFromStorage(key) {
  const storage = safeGetStorage("local");
  if (!storage) return null;
  try {
    const serialized = storage.getItem(key);
    if (serialized === null) return null;
    return JSON.parse(serialized);
  } catch (error) {
    console.warn("Failed to load from storage", error);
    return null;
  }
}

// ストレージからの削除
function removeFromStorage(key) {
  const storage = safeGetStorage("local");
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    console.warn("Failed to remove from storage", error);
    return false;
  }
}
```

### JSON 処理

- **JSON.stringify**: オブジェクトを文字列に変換（循環参照に注意）
- **JSON.parse**: 文字列をオブジェクトに変換（エラーハンドリングを実装）
- **エラーハンドリング**: `try-catch` で JSON 操作をラップ
- **安全な文字列化**: 循環参照や巨大オブジェクトを考慮した文字列化関数を使用

**JSON 処理のパターン**:

```javascript
// 基本的な JSON 処理
const serialized = JSON.stringify(data);
const parsed = JSON.parse(serialized);

// エラーハンドリング付き JSON パース
function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(String(value));
  } catch (error) {
    console.warn("JSON parse failed", error);
    return fallback;
  }
}

// 循環参照を考慮した JSON 文字列化（ログ出力用）
function stringifyLogPayload(payload) {
  const seen = [];
  return JSON.stringify(payload, function (key, value) {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof Error) {
      return {
        name: value.name || "Error",
        message: value.message || String(value),
        stack: value.stack || "",
      };
    }
    if (typeof value === "function") {
      return `<Function ${value.name || "anonymous"}>`;
    }
    if (typeof value === "symbol") {
      return value.toString();
    }
    if (value && typeof value === "object") {
      if (seen.indexOf(value) !== -1) {
        return "<Circular>";
      }
      seen.push(value);
    }
    return value;
  });
}
```

---

## Google Apps Script

### ファイルヘッダーコメント

- **形式**: 1 行コメントでファイルの先頭に責務を記述
- **例**:

```javascript
// code.gs: Google Apps Script上でSpreadsheetやFirebase連携を行うサーバー側スクリプトのエントリーです。
```

### JSDoc コメント

- **使用**: 公開関数には JSDoc コメントを記述
- **必須項目**: `@param`, `@returns`（戻り値がある場合）
- **例**:

```javascript
/**
 * WebAppとしてアクセスされた際に応答を生成するエントリポイント。
 * 通常のGETリクエストには405相当のJSONレスポンスを返しますが、
 * 特定のviewパラメータが付与された場合のみ、
 * 参加者メールプレビューやQAアップロード状況などの確認用ページを返します。
 * @param {GoogleAppsScript.Events.DoGet} e - リクエストコンテキスト
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  // ...
}
```

### 定数定義

- **形式**: ファイルの先頭で定義
- **命名**: `UPPER_SNAKE_CASE`
- **例**:

```javascript
const DISPLAY_SESSION_TTL_MS = 60 * 1000;
const DEFAULT_SCHEDULE_KEY = "__default_schedule__";
const ALLOWED_ORIGINS = ["https://example.com"];
```

### プライベート関数

- **命名規則**: プライベート関数（内部でのみ使用する関数）にはアンダースコア（`_`）サフィックスを付ける
- **目的**: Google Apps Script のエディタで公開関数と内部関数を区別しやすくする
- **公開関数**: アンダースコアなし（例: `doGet`, `doPost`）
- **プライベート関数**: アンダースコアあり（例: `writeMailLog_`, `getAllowedDomains_`）

**プライベート関数のパターン**:

```javascript
// ✅ 公開関数（アンダースコアなし）
function doGet(e) {
  const principal = validatePrincipal_(e);
  return handleRequest_(principal, e);
}

// ✅ プライベート関数（アンダースコアあり）
function validatePrincipal_(e) {
  // 内部処理
}

function writeMailLog_(severity, message, error, details) {
  // ログ出力処理
}

function getAllowedDomains_() {
  const raw =
    PropertiesService.getScriptProperties().getProperty(
      "ALLOWED_EMAIL_DOMAINS"
    ) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

### エラーハンドリング

- **try-catch**: 適切なエラーハンドリングを実装
- **ログ出力**: 重要なエラーはログに記録
- **ユーザー通知**: ユーザーに影響があるエラーは通知を返す
- **リトライロジック**: 一時的なエラー（認証エラーなど）に対してリトライを実装

**リトライロジックのパターン**:

```javascript
// 認証エラー時の1回限りのリトライ
async function apiPost(payload, retryOnAuthError = true) {
  const idToken = await getIdTokenSafe();
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...payload, idToken }),
  });
  let json;
  try {
    json = await res.json();
  } catch (error) {
    throw new Error("Bad JSON response");
  }
  if (!json.success) {
    const message = String(json.error || "");
    // 認証エラーの場合、1回だけリトライ
    if (retryOnAuthError && /Auth/.test(message)) {
      await getIdTokenSafe(true); // トークンを強制更新
      return await apiPost(payload, false); // リトライ（再帰呼び出しを1回のみ許可）
    }
    throw new Error(
      `${message}${json.errorId ? " [" + json.errorId + "]" : ""}`
    );
  }
  return json;
}
```

---

## Firebase 設定

### ファイル形式

- **形式**: JSON
- **ファイル名**: `firebase.rules.json`
- **インデント**: スペース 2 文字

### セキュリティルール

- **原則**: デフォルトで読み書きを拒否（`.read: false`, `.write: false`）
- **明示的な許可**: 必要な箇所のみ明示的に許可
- **バリデーション**: `.validate` ルールでデータ構造を検証
- **コメント**: 複雑なルールには説明コメントを追加（JSON 内では `//` は使用不可のため、別途ドキュメント化）

### ルールの構造

- **階層構造**: データベース構造に合わせて階層的に定義
- **変数**: `$variable` を使用して動的パスを処理
- **インデックス**: 必要に応じて `.indexOn` を指定

---

## コメント規則

### ファイルヘッダーコメント

すべてのファイル形式で、ファイルの先頭に責務を記述する 1 行コメントを配置します。

- **HTML**: `<!-- filename: 説明 -->`
- **CSS**: `/* filename: 説明 */`
- **JavaScript**: `// filename: 説明`
- **Google Apps Script**: `// filename: 説明`

### JSDoc コメント（JavaScript/Google Apps Script）

- **使用**: 公開関数・メソッドには JSDoc コメントを記述
- **必須項目**: `@param`, `@returns`（戻り値がある場合）
- **型注釈**: 型情報を明示的に記述（`{string}`, `{object}`, `{Promise<string>}` など）

**JSDoc の型注釈パターン**:

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

/**
 * 送信ペイロードに含まれる空白やゼロ幅文字を除去し、型に応じた正規化を行います。
 * @param {Record<string, unknown>} values
 * @returns {Record<string, string | number | boolean>}
 */
export function sanitizeSubmissionPayload(values) {
  // ...
}

/**
 * 実行環境から利用言語やUAなどの端末メタデータを収集します。
 * @param {{ navigator?: Navigator, document?: Document, location?: Location, now?: () => number }} [options]
 * @returns {{ language: string, userAgent: string, referrer: string, origin: string, timestamp: number }}
 */
export function collectClientMetadata(options = {}) {
  // ...
}
```

**型注釈の規則**:

- **基本型**: `{string}`, `{number}`, `{boolean}`, `{object}`, `{Array}`
- **複合型**: `{string | number}`, `{Record<string, unknown>}`, `{Promise<string>}`
- **オプショナル**: `{string}` または `{string|undefined}`、パラメータ名に `[options]` と記述
- **インライン型**: `{{ eventId: string, scheduleId: string }}` のようにオブジェクト型を直接記述
- **型キャスト**: `/** @type {Record<string, string | number | boolean>} */` で型を明示

### インラインコメント

- **使用**: 複雑なロジックや意図が明確でない箇所に記述
- **避ける**: コードから自明な内容のコメントは不要
- **言語**: 日本語で記述（プロジェクトの性質上）

### TODO コメント

- **使用**: 一時的な実装や将来の改善点を記録する場合に使用
- **形式**: `// TODO: 説明` または `// FIXME: 説明`
- **管理**: TODO コメントは定期的に見直し、対応済みのものは削除

**TODO コメントのパターン**:

```javascript
// TODO: パフォーマンス最適化が必要
// FIXME: エッジケースの処理を追加
// NOTE: この実装は一時的なものです
```

### コメントアウトされたコード

- **原則**: コメントアウトされたコードは削除する
- **例外**: 一時的に無効化が必要な場合のみコメントアウト（理由をコメントで明記）
- **デバッグコード**: デバッグ用のコメントアウトされたコードは削除する

**コメントアウトされたコードの扱い**:

```javascript
// ❌ 避ける: 理由のないコメントアウト
// const value = oldFunction();

// ✅ 一時的な無効化（理由を明記）
// パフォーマンステストのため一時的に無効化
// const expensiveOperation = () => { /* ... */ };

// ✅ デバッグ用のログ（条件付きで有効化）
const DEBUG_ENABLED = false;
if (DEBUG_ENABLED) {
  console.log("Debug info", data);
}
```

### セクションコメント

- **使用**: 大きなファイル内で機能ブロックを区切る
- **形式**: `// ============================================================================` または `/* ===== セクション名 ===== */`
- **配置**: セクションの開始位置に配置

**セクションコメントのパターン**:

```javascript
// ============================================================================
// 状態管理
// ============================================================================

function createInitialState() {
  // ...
}

// ============================================================================
// DOM イベントバインディング
// ============================================================================

function bindDomEvents() {
  // ...
}
```

---

## モジュール設計

### 責務の分離

- **単一責任の原則**: 1 つのモジュールは 1 つの責務のみを持つ
- **依存関係の明確化**: 依存関係は明示的にインポート
- **循環依存の回避**: モジュール間の循環依存を避ける

### 再利用性

- **共有モジュール**: `scripts/shared/` に配置
- **機能固有モジュール**: 各機能ディレクトリに配置
- **ユーティリティ関数**: 汎用的な関数は独立したモジュールに

**共有モジュールの配置規則**:

- **`scripts/shared/`**: 複数の機能で使用される共通機能を配置
  - 例: `routes.js`, `print-utils.js`, `auth-debug-log.js`, `channel-paths.js`
- **機能固有のユーティリティ**: 各機能ディレクトリ内の `utils.js`, `helpers.js` に配置
  - 例: `scripts/question-admin/utils.js`, `scripts/events/helpers.js`
- **定数と設定**: 各機能ディレクトリの `constants.js`, `config.js` に配置
  - 共有定数は `scripts/shared/` に配置（例: `firebase-config.js`）

### 循環依存の回避

- **依存関係の方向**: 依存関係は一方向に保つ
- **共有モジュール**: 共有モジュールは他のモジュールに依存しない
- **依存性の注入**: 必要に応じて依存関係をコンストラクタで注入

**循環依存を避けるパターン**:

```javascript
// ✅ 良い例: 一方向の依存関係
// shared/utils.js
export function formatValue(value) {
  // 他のモジュールに依存しない
}

// feature/app.js
import { formatValue } from "../shared/utils.js";

// ❌ 避ける: 循環依存
// module-a.js
import { funcB } from "./module-b.js";

// module-b.js
import { funcA } from "./module-a.js"; // 循環依存
```

### テスト容易性

- **純粋関数**: 可能な限り純粋関数として実装
- **依存性の注入**: テスト時にモックを注入可能にする
- **副作用の分離**: 副作用を伴う処理は明確に分離

---

## エラーハンドリング

### エラー処理の方針

1. **早期リターン**: エラー条件は早期に検出して処理を中断
2. **エラーログ**: 重要なエラーはログに記録
3. **ユーザー通知**: ユーザーに影響があるエラーは通知を表示
4. **エラー無視**: 意図的にエラーを無視する場合はコメントで理由を記述
5. **ロールバック処理**: 複数の操作を行う場合は、エラー発生時に既存の操作をロールバックする

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

### リトライロジック

- **用途**: 一時的なエラー（認証エラーなど）に対してリトライを実装
- **パターン**: 条件付きリトライ、最大リトライ回数の制限、無限ループの防止

**リトライロジックのパターン**:

```javascript
// 認証エラー時の1回限りのリトライ
async function apiPost(payload, retryOnAuthError = true) {
  const idToken = await getIdTokenSafe();
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...payload, idToken }),
  });
  let json;
  try {
    json = await res.json();
  } catch (error) {
    throw new Error("Bad JSON response");
  }
  if (!json.success) {
    const message = String(json.error || "");
    // 認証エラーの場合、1回だけリトライ
    if (retryOnAuthError && /Auth/.test(message)) {
      await getIdTokenSafe(true); // トークンを強制更新
      return await apiPost(payload, false); // リトライ（再帰呼び出しを1回のみ許可）
    }
    throw new Error(
      `${message}${json.errorId ? " [" + json.errorId + "]" : ""}`
    );
  }
  return json;
}
```

### リトライロジック

- **用途**: 一時的なエラー（認証エラーなど）に対してリトライを実装
- **パターン**: 条件付きリトライ、最大リトライ回数の制限、無限ループの防止
- **注意**: 再帰呼び出しによるリトライは、フラグで制御して無限ループを防ぐ

**リトライロジックのパターン**:

```javascript
// 認証エラー時の1回限りのリトライ
async function apiPost(payload, retryOnAuthError = true) {
  const idToken = await getIdTokenSafe();
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ ...payload, idToken }),
  });
  let json;
  try {
    json = await res.json();
  } catch (error) {
    throw new Error("Bad JSON response");
  }
  if (!json.success) {
    const message = String(json.error || "");
    // 認証エラーの場合、1回だけリトライ
    if (retryOnAuthError && /Auth/.test(message)) {
      await getIdTokenSafe(true); // トークンを強制更新
      return await apiPost(payload, false); // リトライ（再帰呼び出しを1回のみ許可）
    }
    throw new Error(
      `${message}${json.errorId ? " [" + json.errorId + "]" : ""}`
    );
  }
  return json;
}
```

### ロールバック処理

- **用途**: 複数の操作を行う場合、エラー発生時に既存の操作をロールバックする
- **パターン**: 操作の成功状態をフラグで管理し、エラー時にクリーンアップを実行
- **エラーハンドリング**: ロールバック処理自体のエラーも適切に処理する

**ロールバック処理のパターン**:

```javascript
// 複数の操作を順次実行し、エラー時にロールバック
let intakeCreated = false;
let questionCreated = false;

try {
  await set(intakeRef, intakePayload);
  intakeCreated = true;

  await set(ref(database, `questions/normal/${questionUid}`), questionRecord);
  questionCreated = true;

  await set(ref(database, questionStatusPath), statusRecord);
} catch (error) {
  // ロールバック処理
  try {
    if (questionCreated) {
      await remove(ref(database, `questions/normal/${questionUid}`));
    }
    if (intakeCreated) {
      await remove(intakeRef);
    }
  } catch (cleanupError) {
    console.warn("Failed to roll back after error", cleanupError);
  }

  // エラーを再スローまたは適切に処理
  const clientError = new Error("送信に失敗しました");
  clientError.cause = error;
  throw clientError;
}
```

### エラーチェーン（error.cause）

- **用途**: エラーの原因を保持し、エラーチェーンを構築する
- **パターン**: `error.cause` プロパティを使用して元のエラーを保持
- **再帰的チェック**: エラーチェーンを再帰的にチェックして原因を特定

**エラーチェーンのパターン**:

```javascript
// エラーチェーンの構築
export class AuthPreflightError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "AuthPreflightError";
    this.code = code || "UNKNOWN_PREFLIGHT_ERROR";
    if (cause) {
      this.cause = cause;
    }
  }
}

// エラーチェーンの再帰的チェック
function isNotInUsersSheetError(error) {
  if (!error) return false;
  const message =
    typeof error.message === "string" ? error.message : String(error || "");
  if (/not in users sheet/i.test(message)) {
    return true;
  }
  // 原因エラーを再帰的にチェック
  if (error.cause) {
    return isNotInUsersSheetError(error.cause);
  }
  return false;
}

// エラーのラップ
try {
  // 処理
} catch (error) {
  const clientError = new Error("ユーザー向けエラーメッセージ");
  clientError.cause = error;
  throw clientError;
}
```

---

## カスタムエラー

### カスタムエラークラス

- **用途**: アプリケーション固有のエラーを表現する
- **命名**: `*Error` で終わるクラス名
- **継承**: `Error` クラスを継承
- **例**:

```javascript
class FormValidationError extends Error {
  constructor(message, { focus } = {}) {
    super(message);
    this.name = "FormValidationError";
    this.focus = typeof focus === "function" ? focus : null;
  }

  /**
   * 保持しているフォーカス移動処理があれば安全に実行します。
   */
  invokeFocus() {
    if (!this.focus) return;
    try {
      this.focus();
    } catch (error) {
      console.error("Failed to focus field after validation error", error);
    }
  }
}
```

### カスタムエラーの設計原則

1. **意味のある名前**: エラーの種類が明確に分かる名前を付ける
2. **追加情報**: エラーに関連する追加情報をプロパティとして保持
3. **エラーハンドリング**: 適切なエラーハンドリングを実装
4. **ログ記録**: 重要なエラーはログに記録

---

## Web Components

### カスタム要素の定義

- **場所**: `scripts/shared/layout.js` に共通コンポーネントを定義
- **命名**: `kebab-case`（例: `telop-header`, `telop-footer`）
- **登録**: `customElements.define()` を使用
- **重複登録の防止**: 登録前に `customElements.get()` で確認

### カスタム要素の実装パターン

```javascript
class TelopHeader extends HTMLElement {
  connectedCallback() {
    if (this.dataset.initialized === "true") {
      return;
    }
    this.dataset.initialized = "true";
    // 初期化処理
  }
}

if (!customElements.get("telop-header")) {
  customElements.define("telop-header", TelopHeader);
}
```

### スロットの使用

- **スロット属性**: `slot="actions"`, `slot="meta"` などで子要素を配置
- **例**:

```html
<telop-header tagline="Broadcast Subtitle Console" context-label="管理フロー">
  <div slot="actions" class="flow-header-actions">
    <!-- アクション要素 -->
  </div>
  <div slot="meta" class="flow-user-info">
    <!-- メタ情報 -->
  </div>
</telop-header>
```

### アクセシビリティ

- **ARIA 属性**: 必要に応じて `aria-label`, `role` などを設定
- **セマンティック HTML**: 内部で適切な HTML 要素を使用

---

## テスト

### テストファイル

- **命名**: `*.test.mjs`（テスト対象ファイル名 + `.test.mjs`）
- **場所**: `tests/` ディレクトリに配置
- **例**: `participant-tokens.test.mjs`, `question-form-utils.test.mjs`

### テストフレームワーク

- **使用**: Node.js の組み込みテストフレームワーク（`node:test`）
- **アサーション**: `node:assert/strict` を使用

### テストの記述パターン

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

import { collectParticipantTokens } from "../scripts/shared/participant-tokens.js";

test("collectParticipantTokens gathers unique tokens across schedules", () => {
  const branch = {
    scheduleA: { alice: { token: "abc" }, bob: { token: "def" } },
    scheduleB: { charlie: { token: "abc" }, delta: { token: "ghi" } },
  };

  const tokens = collectParticipantTokens(branch);
  assert.deepEqual([...tokens].sort(), ["abc", "def", "ghi"]);
});
```

### テストの原則

1. **単一責任**: 1 つのテストは 1 つの動作を検証
2. **明確な名前**: テスト名で何をテストしているかが分かる
3. **独立性**: テストは互いに依存しない
4. **エッジケース**: 正常系だけでなく異常系もテスト

### テストカバレージ

- **目標**: 重要なビジネスロジックはテストでカバー
- **優先順位**: ユーティリティ関数、データ変換、バリデーションなど

---

## メールテンプレート

### テンプレートファイル

- **命名**: `email-*-body.html`, `email-*-shell.html`
- **場所**: プロジェクトルートに配置
- **例**: `email-participant-body.html`, `email-participant-shell.html`

### テンプレート構文

- **サーバーサイドスクリプト**: Google Apps Script の HTML サービス構文を使用
- **変数展開**: `<?= variable ?>` 形式
- **条件分岐**: `<? if (condition) { ?> ... <? } ?>` 形式
- **エスケープ**: HTML エスケープを適切に実施

### テンプレートの構造

- **shell**: 外枠テンプレート（`email-*-shell.html`）
- **body**: 本文テンプレート（`email-*-body.html`）
- **モード**: `email` と `preview`（Web 表示）をサポート

### テンプレートの使用

- **読み込み**: Google Apps Script から `HtmlService` を使用して読み込み
- **キャッシュ**: テンプレートはキャッシュして再利用
- **名前空間**: 複数のテンプレートを組み合わせる場合は名前空間を考慮

### メールテンプレートのベストプラクティス

1. **インラインスタイル**: メールクライアント互換性のためインラインスタイルを使用
2. **テーブルレイアウト**: レイアウトにはテーブルを使用（一部メールクライアントの制限のため）
3. **フォールバック**: 画像が表示されない場合の代替テキストを提供
4. **プレビュー**: Web 表示用のプレビューモードを用意

---

## アクセシビリティ

### HTML セマンティクス

- **適切な要素**: セマンティックな HTML 要素を使用
- **見出しの階層**: `<h1>` から順に使用し、階層を飛ばさない
- **ランドマーク**: `<header>`, `<main>`, `<nav>`, `<footer>` などを適切に使用

### ARIA 属性

- **aria-label**: アイコンのみのボタンなどに使用
- **aria-labelledby**: 複数の要素でラベルを構成する場合に使用
- **aria-hidden**: 装飾的な要素に使用
- **role**: 必要に応じて使用（`role="alert"` など）

### キーボード操作

- **フォーカス管理**: すべてのインタラクティブ要素はキーボードで操作可能
- **フォーカス表示**: フォーカスインジケーターを明確に表示
- **タブ順序**: 論理的なタブ順序を維持

### スクリーンリーダー対応

- **noscript**: JavaScript が無効な場合の代替コンテンツを提供
- **alt 属性**: 画像には必ず `alt` 属性を設定
- **説明テキスト**: 複雑な UI には説明テキストを提供

---

## パフォーマンス

### リソースの読み込み

- **遅延読み込み**: 必要に応じて `defer` や `async` を使用
- **モジュール**: ES Modules を使用して必要なコードのみを読み込む
- **フォント**: `font-display: swap` を使用してフォント読み込みを最適化

### CSS 最適化

- **カスタムプロパティ**: テーマ変更を効率的に実装
- **メディアクエリ**: 必要なスタイルのみを読み込む
- **不要なスタイル**: 使用されていないスタイルを削除

### JavaScript 最適化

- **コード分割**: 大きなモジュールは分割して読み込む
- **不要な処理**: 不要な計算や DOM 操作を避ける
- **イベントリスナー**: 適切にクリーンアップする

### 画像・アセット

- **フォーマット**: 適切なフォーマットを使用（SVG、WebP など）
- **サイズ最適化**: 必要に応じて画像を最適化
- **遅延読み込み**: 必要に応じて `loading="lazy"` を使用

---

## チェックリスト

新しいコードを書く際は、以下のチェックリストを確認してください：

### 全般

- [ ] ファイルヘッダーコメントが記述されているか？
- [ ] 命名規則に従っているか？
- [ ] インデントはスペース 2 文字か？
- [ ] ファイルサイズが適切か？

### HTML

- [ ] セマンティックな HTML 要素を使用しているか？
- [ ] アクセシビリティ属性が適切に設定されているか？
- [ ] `noscript` が提供されているか？
- [ ] 適切なメタタグが設定されているか？
- [ ] Web Components を使用する場合は適切に定義されているか？

### CSS

- [ ] CSS 変数が適切に使用されているか？
- [ ] レスポンシブデザインが考慮されているか？
- [ ] セレクタの命名が一貫しているか？
- [ ] 不要なスタイルが含まれていないか？

### JavaScript

- [ ] ES Modules を使用しているか？
- [ ] JSDoc コメントが記述されているか？
- [ ] エラーハンドリングが適切か？
- [ ] 早期リターンを使用してネストを減らしているか？
- [ ] カスタムエラーを使用する場合は適切に定義されているか？
- [ ] 定数は `constants.js` に集約されているか？
- [ ] 共有設定は `scripts/shared/` に配置されているか？
- [ ] ストレージキーは適切なプレフィックスを使用しているか？
- [ ] DOM 操作は `dom.js` の `queryDom()` を使用しているか？
- [ ] 非同期処理は `async/await` を使用しているか？
- [ ] イベントリスナーは適切にクリーンアップされているか？
- [ ] ログ出力は統一されたフォーマットを使用しているか？
- [ ] データ構造（Map/Set/オブジェクト）は適切に選択されているか？
- [ ] 型チェックは適切な方法（typeof/instanceof/Array.isArray）を使用しているか？
- [ ] null 安全の処理（`??`, `?.`）が適切に使用されているか？
- [ ] データ正規化は統一されたユーティリティ関数を使用しているか？
- [ ] 正規表現は適切にエスケープされているか？
- [ ] URL 操作は `routes.js` の関数を使用しているか？
- [ ] 日付・時刻処理は統一された関数を使用しているか？
- [ ] キーボードショートカットは入力フィールドを除外しているか？
- [ ] HTML に挿入するデータは適切にエスケープされているか？
- [ ] ユーザー入力は適切に検証・サニタイズされているか？
- [ ] バージョン番号は定数として定義されているか？
- [ ] 配列操作は適切なメソッド（map/filter/reduce/forEach）を使用しているか？
- [ ] オブジェクト操作は適切なメソッド（Object.keys/values/entries）を使用しているか？
- [ ] ログ出力は統一されたフォーマットとプレフィックスを使用しているか？
- [ ] ループ処理は適切な方法（for...of/while/配列メソッド）を使用しているか？
- [ ] 共有機能は `scripts/shared/` に配置されているか？
- [ ] 循環依存が発生していないか？
- [ ] マジックナンバーは定数として定義されているか？
- [ ] 定数の命名は `UPPER_SNAKE_CASE` を使用しているか？
- [ ] エクスポートは名前付きエクスポートを使用しているか？
- [ ] 関数パラメータで分割代入を使用しているか？（オプションオブジェクトの場合）
- [ ] 長時間実行される非同期処理には `AbortController` を使用しているか？
- [ ] リソース（タイマー、イベントリスナー、購読）は適切にクリーンアップされているか？
- [ ] Factory 関数（`create*`）を使用してオブジェクトを作成しているか？
- [ ] 環境検出（`typeof window !== "undefined"` など）を適切に行っているか？
- [ ] 数値の検証には `Number.isFinite()` や `Number.isNaN()` を使用しているか？
- [ ] 複数の操作を行う場合は、エラー発生時にロールバック処理を実装しているか？
- [ ] テンプレート要素のクローンには `template.content.cloneNode(true)` を使用しているか？
- [ ] 複数の要素を一度に追加する場合は `DocumentFragment` を使用しているか？
- [ ] `classList` 操作（`add`, `remove`, `toggle`, `contains`）を適切に使用しているか？
- [ ] `dataset` プロパティを使用して data 属性にアクセスしているか？
- [ ] ストレージ操作（localStorage/sessionStorage）は安全に取得・エラーハンドリングを実装しているか？
- [ ] JSON 処理（`JSON.parse`, `JSON.stringify`）はエラーハンドリングを実装しているか？
- [ ] 複数の非同期処理を並列実行する場合は `Promise.all()` や `Promise.allSettled()` を使用しているか？
- [ ] イベント処理で `preventDefault()` や `stopPropagation()` を適切に使用しているか？
- [ ] `event.target` と `event.currentTarget` を適切に使い分けているか？
- [ ] 配列風オブジェクトを配列に変換する場合は `Array.from()` を使用しているか？
- [ ] `Object.create(null)` を使用して純粋なオブジェクトを作成しているか？
- [ ] 複数の非同期処理のローディング状態を管理する場合は `LoadingTracker` のようなパターンを使用しているか？
- [ ] 複数の非同期処理を並列実行する場合は `Promise.all()` や `Promise.allSettled()` を使用しているか？
- [ ] イベント処理で `preventDefault()` や `stopPropagation()` を適切に使用しているか？
- [ ] `event.target` と `event.currentTarget` を適切に使い分けているか？
- [ ] 配列風オブジェクトを配列に変換する場合は `Array.from()` を使用しているか？
- [ ] `Object.create(null)` を使用して純粋なオブジェクトを作成しているか？
- [ ] DOM 更新の視覚的な反映を待つ場合は `requestAnimationFrame` を使用しているか？
- [ ] UUID 生成やランダム値生成には Crypto API を優先的に使用し、フォールバックを実装しているか？
- [ ] DOM ツリーを効率的に走査する場合は `TreeWalker` API を使用しているか？
- [ ] フォームバリデーションには HTML5 バリデーション API（`reportValidity()`, `setCustomValidity()`）を使用しているか？
- [ ] 未保存の変更がある場合は `beforeunload` イベントでページ離脱を警告しているか？
- [ ] ダイアログを開く際にフォーカスを保存し、閉じる際に復元しているか？
- [ ] ダイアログ内でフォーカストラップを実装しているか？
- [ ] エラーチェーン（`error.cause`）を適切に使用しているか？
- [ ] バイナリデータ処理（`Uint8Array`, `ArrayBuffer`, `TextDecoder`）を適切に使用しているか？
- [ ] 型変換（`String()`, `Number()`, `Boolean()`）を明示的に行っているか？
- [ ] オブジェクトをキーとして使用する場合は `WeakMap`/`WeakSet` を検討しているか？
- [ ] メソッドバインディングには `.bind()`, `.call()`, `Object.defineProperty` を適切に使用しているか？
- [ ] プロトタイプチェーンを避ける必要がある場合は `Object.create(null)` を使用しているか？
- [ ] 一時的なエラーに対してリトライロジックを実装しているか？（無限ループを防ぐ）

### Google Apps Script

- [ ] プライベート関数にはアンダースコア（`_`）サフィックスを付けているか？
- [ ] 公開関数（`doGet`, `doPost` など）にはアンダースコアを付けていないか？
- [ ] 定数は `UPPER_SNAKE_CASE` で定義されているか？
- [ ] エラーハンドリングが適切に実装されているか？
- [ ] ログ出力は統一されたフォーマットを使用しているか？

### テスト

- [ ] テストファイルは `*.test.mjs` という命名規則に従っているか？
- [ ] テストは `tests/` ディレクトリに配置されているか？
- [ ] テスト名は何をテストしているかが明確か？
- [ ] エッジケースもテストされているか？

### 一貫性

- [ ] 既存のコードスタイルと一致しているか？
- [ ] 略語の使用が一貫しているか？
- [ ] インポート順序が標準に従っているか？

---

## 参考資料

- [MDN Web Docs - HTML](https://developer.mozilla.org/ja/docs/Web/HTML)
- [MDN Web Docs - CSS](https://developer.mozilla.org/ja/docs/Web/CSS)
- [MDN Web Docs - JavaScript](https://developer.mozilla.org/ja/docs/Web/JavaScript)
- [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
- [Web Content Accessibility Guidelines (WCAG)](https://www.w3.org/WAI/WCAG21/quickref/)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)

---

**最終更新**: 2025 年
**バージョン**: 2.0.0
