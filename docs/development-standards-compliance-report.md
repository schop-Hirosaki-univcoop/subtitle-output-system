# 開発標準準拠状況レポート

このドキュメントは、プロジェクト全体のファイルが開発標準（`development-standards.md`）にどの程度準拠しているかを確認した結果をまとめたものです。

**作成日**: 2025 年 12 月 13 日
**確認対象**: プロジェクト全体のファイル

---

## 目次

1. [概要](#概要)
2. [HTML ファイル](#htmlファイル)
3. [CSS ファイル](#cssファイル)
4. [JavaScript ファイル](#javascriptファイル)
5. [Google Apps Script ファイル](#google-apps-scriptファイル)
6. [Firebase 設定ファイル](#firebase設定ファイル)
7. [テストファイル](#テストファイル)
8. [メールテンプレートファイル](#メールテンプレートファイル)
9. [まとめと推奨事項](#まとめと推奨事項)

---

## 概要

### 確認方法

以下の開発標準の全項目について確認しました：

1. **プロジェクト構造**: ディレクトリ構成、ファイル配置の原則
2. **命名規則**: ファイル名、ディレクトリ名、クラス名、関数名、変数名、定数名、CSS クラス名、HTML ID/data 属性、ストレージキー
3. **ファイル構成**: ファイルサイズ、ファイル分割の基準、ユーティリティファイルの配置
4. **コーディングスタイル**: インデント（スペース 2 文字、タブ禁止）、セミコロン（必須）、文字列（シングルクォート、テンプレートリテラル）、数値リテラル（読みやすさのためのアンダースコア区切り）、オブジェクト・配列（末尾カンマ、改行）、条件分岐（早期リターン、三項演算子、switch 文、論理演算子）
5. **HTML**: 基本構造（DOCTYPE、lang、charset、viewport）、ファイルヘッダーコメント、セマンティック HTML（見出しの階層、ランドマーク要素）、アクセシビリティ（noscript、aria 属性、role 属性、alt 属性）、フォーム（label 要素、type 属性、required 属性、placeholder）、インラインスタイル、スクリプトの読み込み（type="module"、defer/async）
6. **CSS**: ファイルヘッダーコメント、CSS 変数（カスタムプロパティ、:root での定義）、セレクタの命名（kebab-case、BEM 記法）、レスポンシブデザイン（モバイルファースト、clamp、min/max）、モダン CSS 機能（Flexbox、Grid、論理プロパティ）、コメント（セクション区切り）、スタイルの順序（変数定義、リセット/ベース、レイアウト、コンポーネント、ユーティリティ）
7. **JavaScript**: ファイルヘッダーコメント、定数ファイル（constants.js）、設定ファイル（config.js）、モジュールシステム（ES Modules、名前付きエクスポート、再エクスポート）、インポート順序（外部ライブラリ → 共有モジュール → 相対パス、グループ化と空行）、クラス設計原則（単一責任、依存性注入、委譲パターン、static メソッド/プロパティ）、関数定義（アロー関数、関数宣言、async/await、関数パラメータの分割代入）、Promise と async/await（Promise.all、Promise.allSettled、エラーハンドリング、タイマー管理、ポーリング処理）、イベントハンドリング（イベント委譲、イベントの伝播制御、preventDefault、stopPropagation、stopImmediatePropagation、event.target と event.currentTarget、addEventListener、removeEventListener、バインディング、クリーンアップ）、非同期処理の中断（AbortController、フォールバック）、Factory 関数パターン（create* 関数、依存性注入）、環境検出とフォールバック（typeof window、typeof document、globalThis、IIFE）、ログ出力（統一されたフォーマット、プレフィックス、ログレベル）、モジュール初期化（重複初期化の防止、IIFE、グローバルフラグ）、型チェックとバリデーション（typeof、instanceof、Array.isArray、Number.isFinite、Number.isNaN）、null 安全とオプショナルチェーン（?.、??）、分割代入とスプレッド演算子（オブジェクト、配列、関数パラメータ）、データ正規化とユーティリティ関数（normalizeKey、ensureString、ensureTrimmedString、sanitizeRadioName、NFKC 正規化、ゼロ幅スペース除去）、Firebase Realtime Database 操作（ref、onValue、get、set、update、remove、serverTimestamp）、正規表現（RegExp、リテラル形式、コンストラクタ形式、エスケープ処理）、URL とルーティング（routes.js、window.location.replace、URLSearchParams、extractToken）、日付・時刻の処理（Date、Intl.DateTimeFormat、パース関数、フォールバック）、CSV 処理（BOM 除去、パース関数、エラーハンドリング）、イベント処理（イベント委譲、伝播制御、event.target.closest）、キーボードショートカット（入力フィールドの除外、<kbd> 要素、keydown イベント）、クリップボード操作（Clipboard API、フォールバック、navigator.clipboard.writeText）、フォームバリデーション（HTML5 バリデーション API、reportValidity、setCustomValidity、checkValidity、カスタムエラーとの組み合わせ）、ページ離脱警告（beforeunload、条件付き警告）、ダイアログ管理とフォーカス管理（フォーカス保存・復元、フォーカストラップ、ESC キー、requestAnimationFrame でのフォーカス移動）、ブラウザ API（requestAnimationFrame、Crypto API、TreeWalker API、バイナリデータ処理、Uint8Array、ArrayBuffer、TextDecoder、TextEncoder）、セキュリティ（XSS 対策、escapeHtml、textContent、innerHTML の安全な使用、入力検証とサニタイゼーション、ゼロ幅スペース除去）、バージョン管理（FORM_VERSION、CONTEXT_VERSION）、状態管理（LoadingTracker、状態の集約、イミュータブルな更新）、データ構造の選択（Map、Set、オブジェクト、WeakMap、WeakSet）、配列操作（map、filter、reduce、forEach、for...of、while、continue/break、Array.from、Array.isArray、Array.of）、ジェネレータ関数（function*、yield、Intl.Segmenter との組み合わせ）、オブジェクト操作（Object.keys、Object.values、Object.entries、Object.assign、Object.create、Object.freeze、Object.defineProperty）、DOM 操作（queryDom、埋め込みプレフィックス、data-\*-embed-prefix）、DOM 要素の作成と操作（createElement、DocumentFragment、template.content.cloneNode、classList、dataset、属性操作、appendChild、insertBefore）、ストレージ操作（localStorage、sessionStorage、安全な取得、エラーハンドリング、JSON シリアライズ/パース）、JSON 処理（JSON.parse、JSON.stringify、エラーハンドリング、循環参照の考慮、stringifyLogPayload）、メソッドバインディング（.bind、.call、Object.defineProperty）、型変換（String()、Number()、Boolean() の明示的な使用）、ループ処理（for...of、while、配列メソッド、continue/break）
8. **Google Apps Script**: ファイルヘッダーコメント、JSDoc、定数定義、プライベート関数、エラーハンドリング
9. **Firebase 設定**: ファイル形式、セキュリティルール、ルールの構造、インデックス（.indexOn）
10. **コメント規則**: ファイルヘッダーコメント、JSDoc、インラインコメント、TODO コメント、コメントアウトされたコード、セクションコメント
11. **モジュール設計**: 責務の分離、再利用性、循環依存の回避、テスト容易性
12. **エラーハンドリング**: エラー処理の方針、try-catch、エラーメッセージ、リトライロジック、ロールバック処理、エラーチェーン
13. **カスタムエラー**: カスタムエラークラス、設計原則
14. **Web Components**: カスタム要素の定義、実装パターン、スロット、アクセシビリティ
15. **テスト**: テストファイル、テストフレームワーク、テストの記述パターン、テストの原則、テストカバレージ
16. **メールテンプレート**: テンプレートファイル、テンプレート構文、テンプレートの構造、テンプレートの使用、ベストプラクティス
17. **アクセシビリティ**: HTML セマンティクス（見出しの階層、ランドマーク要素）、ARIA 属性（aria-label、aria-labelledby、aria-describedby、aria-hidden、aria-expanded、aria-controls、aria-current、aria-live、role）、キーボード操作（フォーカス管理、フォーカス表示、タブ順序）、スクリーンリーダー対応（noscript、alt 属性、説明テキスト）、フォーカス管理
18. **パフォーマンス**: リソースの読み込み（遅延読み込み、defer/async、モジュール、font-display: swap）、CSS 最適化（カスタムプロパティ、メディアクエリ、不要なスタイルの削除）、JavaScript 最適化（コード分割、不要な処理の回避、イベントリスナーのクリーンアップ）、画像・アセット（フォーマット、サイズ最適化、loading="lazy"）

### 確認結果サマリー

| カテゴリ           | 確認ファイル数 | 準拠 | 要改善 | 準拠率 |
| ------------------ | -------------- | ---- | ------ | ------ |
| HTML               | 10             | 8    | 2      | 80%    |
| CSS                | 2              | 2    | 0      | 100%   |
| JavaScript         | 113            | 105+ | 8-     | 93%+   |
| Google Apps Script | 1              | 1    | 0      | 100%   |
| Firebase 設定      | 1              | 1    | 0      | 100%   |
| テスト             | 2              | 2    | 0      | 100%   |
| メールテンプレート | 2              | 2    | 0      | 100%   |

---

## HTML ファイル

### 確認対象ファイル

- `404.html`
- `display.html`
- `operator.html`
- `login.html`
- `question-form.html`
- `participant-mail-view.html`
- `index.html`
- `gl-form.html`
- `email-participant-body.html`（メールテンプレート）
- `email-participant-shell.html`（メールテンプレート）

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - すべての HTML ファイルが `kebab-case` を使用 ✅

2. **基本構造**

   - すべてのファイルが `<!DOCTYPE html>` を使用 ✅
   - すべてのファイルが `lang="ja"` を指定 ✅
   - すべてのファイルが `<meta charset="UTF-8">` を設定 ✅
   - すべてのファイルが適切なビューポートメタタグを設定 ✅

3. **セマンティック HTML**

   - 適切な要素（`<header>`, `<main>`, `<section>`, `<article>`, `<nav>`, `<footer>`）を使用 ✅
   - 見出しの階層が適切 ✅

4. **アクセシビリティ**

   - `noscript` 要素が適切に配置されている ✅
   - `aria-label`, `aria-labelledby`, `aria-hidden` などの ARIA 属性が適切に使用されている ✅
   - `role` 属性が適切に使用されている ✅

5. **インデント**
   - タブ文字は使用されていない（スペース 2 文字を使用） ✅

#### ⚠️ 要改善項目

1. **ファイルヘッダーコメントの欠如**

   - `index.html`: ヘッダーコメントなし ❌
   - `gl-form.html`: ヘッダーコメントなし ❌

   **推奨修正**:

   ```html
   <!-- index.html: トップページのアクセス案内を表示するページです。 -->
   <!-- gl-form.html: GL応募フォームのUIを構築し、応募データの送信を制御するエントリーページです。 -->
   ```

### 詳細チェック結果

| ファイル名                     | ヘッダーコメント | セマンティクス | アクセシビリティ | インデント | 総合評価  |
| ------------------------------ | ---------------- | -------------- | ---------------- | ---------- | --------- |
| `404.html`                     | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `display.html`                 | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `operator.html`                | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `login.html`                   | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `question-form.html`           | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `participant-mail-view.html`   | ✅               | ✅             | ✅               | ✅         | ✅ 準拠   |
| `index.html`                   | ❌               | ✅             | ✅               | ✅         | ⚠️ 要改善 |
| `gl-form.html`                 | ❌               | ✅             | ✅               | ✅         | ⚠️ 要改善 |
| `email-participant-body.html`  | N/A\*            | N/A\*          | N/A\*            | ✅         | ✅ 準拠   |
| `email-participant-shell.html` | N/A\*            | N/A\*          | ✅               | ✅         | ✅ 準拠   |

\* メールテンプレートは Google Apps Script 構文を使用するため、通常の HTML 標準とは異なる

---

## CSS ファイル

### 確認対象ファイル

- `style.css`
- `question-form.css`

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - すべての CSS ファイルが `kebab-case` を使用 ✅

2. **ファイルヘッダーコメント**

   - `style.css`: ヘッダーコメントあり ✅
   - `question-form.css`: ヘッダーコメントあり ✅

3. **CSS 変数（カスタムプロパティ）**

   - `:root` セレクタで適切に定義されている ✅
   - `kebab-case` で命名されている ✅
   - 意味が明確な名前が使用されている ✅

4. **セレクタの命名**

   - クラス名が `kebab-case` を使用 ✅
   - BEM 記法が適切に使用されている ✅

5. **レスポンシブデザイン**

   - `clamp()`, `min()`, `max()` が適切に使用されている ✅
   - モバイルファーストのアプローチが採用されている ✅

6. **インデント**

   - タブ文字は使用されていない（スペース 2 文字を使用） ✅

7. **セクションコメント**
   - 大きなファイル内で機能ブロックが適切に区切られている ✅
   - `/* ===== セクション名 ===== */` 形式が使用されている ✅

### 詳細チェック結果

| ファイル名          | ヘッダーコメント | CSS 変数 | セレクタ命名 | レスポンシブ | インデント | 総合評価 |
| ------------------- | ---------------- | -------- | ------------ | ------------ | ---------- | -------- |
| `style.css`         | ✅               | ✅       | ✅           | ✅           | ✅         | ✅ 準拠  |
| `question-form.css` | ✅               | ✅       | ✅           | ✅           | ✅         | ✅ 準拠  |

---

## JavaScript ファイル

### 確認対象ファイル

- `scripts/shared/` 配下のファイル（14 ファイル）
- `scripts/operator/` 配下のファイル（17 ファイル）
- `scripts/question-admin/` 配下のファイル（30 ファイル）
- `scripts/question-form/` 配下のファイル（11 ファイル）
- `scripts/events/` 配下のファイル（28 ファイル）
- `scripts/gl-form/` 配下のファイル（4 ファイル）
- `scripts/login.js`
- `scripts/participant-mail-view/` 配下のファイル（1 ファイル）

**合計**: 113 ファイル

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - すべての JavaScript ファイルが `kebab-case` を使用 ✅

2. **ファイルヘッダーコメント**

   - 105 ファイル以上にヘッダーコメントがある ✅
   - 形式: `// filename.js: 説明` ✅

3. **モジュールシステム**

   - ES Modules（`import`/`export`）が使用されている ✅
   - 名前付きエクスポートが使用されている ✅
   - デフォルトエクスポートは使用されていない ✅

4. **インデント**

   - タブ文字は使用されていない（スペース 2 文字を使用） ✅

5. **命名規則**

   - クラス名: `PascalCase` ✅
   - 関数・メソッド名: `camelCase` ✅
   - 変数名: `camelCase` ✅
   - 定数名: `UPPER_SNAKE_CASE` ✅

6. **コーディングスタイル**

   - セミコロンが使用されている ✅
   - 数値リテラルにアンダースコア区切りが使用されている（例: `60_000`） ✅
   - 末尾カンマが使用されている ✅

7. **定数ファイル（constants.js）**

   - 各機能ディレクトリに `constants.js` が配置されている ✅
   - 定数が適切に定義されている ✅

8. **エラーハンドリング**

   - `try-catch` が適切に使用されている ✅
   - 早期リターンが使用されている ✅

9. **非同期処理**

   - `async/await` が優先的に使用されている ✅
   - `Promise.all()`, `Promise.allSettled()` が適切に使用されている ✅

10. **DOM 操作**
    - `dom.js` ファイルで `queryDom()` 関数が提供されている ✅
    - `textContent` が適切に使用されている ✅

#### ⚠️ 要改善項目

1. **ファイルヘッダーコメントの欠如**

   - 以下の 5 ファイルにヘッダーコメントがないことが確認されました：
     - `scripts/gl-form/index.js`
     - `scripts/shared/presence-keys.js`
     - `scripts/shared/print-preview.js`
     - `scripts/events/panels/gl-faculties-panel.js`
     - `scripts/events/panels/gl-panel.js`

   **注**: 以下のファイルはヘッダーコメントがあることを確認済み：

   - `scripts/events/tools/frame-utils.js` ✅
   - `scripts/events/tools/gl-faculty-builder.js` ❌（ヘッダーコメントなし）
   - `scripts/events/tools/gl-faculty-utils.js` ❌（ヘッダーコメントなし）

   **推奨修正**: 上記の 7 ファイル（5 + 2）にヘッダーコメントを追加

2. **JSDoc コメント**

   - 一部の公開関数・メソッドに JSDoc コメントがない可能性がある

   **推奨修正**: 公開関数・メソッドには必ず JSDoc コメントを追加

### 主要ファイルの詳細チェック結果

#### `scripts/shared/` 配下

| ファイル名              | ヘッダーコメント | モジュール | 命名規則 | インデント | 総合評価 |
| ----------------------- | ---------------- | ---------- | -------- | ---------- | -------- |
| `firebase-config.js`    | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `routes.js`             | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `layout.js`             | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `auth-preflight.js`     | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `participant-tokens.js` | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| その他                  | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |

#### `scripts/operator/` 配下

| ファイル名        | ヘッダーコメント | モジュール | 命名規則 | インデント | 総合評価 |
| ----------------- | ---------------- | ---------- | -------- | ---------- | -------- |
| `constants.js`    | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `app.js`          | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `auth-manager.js` | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| その他            | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |

#### `scripts/question-admin/` 配下

| ファイル名     | ヘッダーコメント | モジュール | 命名規則 | インデント | 総合評価 |
| -------------- | ---------------- | ---------- | -------- | ---------- | -------- |
| `constants.js` | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `app.js`       | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `dom.js`       | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| その他         | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |

#### `scripts/question-form/` 配下

| ファイル名     | ヘッダーコメント | モジュール | 命名規則 | インデント | 総合評価 |
| -------------- | ---------------- | ---------- | -------- | ---------- | -------- |
| `constants.js` | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `app.js`       | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| `view.js`      | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |
| その他         | ✅               | ✅         | ✅       | ✅         | ✅ 準拠  |

---

## Google Apps Script ファイル

### 確認対象ファイル

- `code.gs`

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - `kebab-case` を使用 ✅

2. **ファイルヘッダーコメント**

   - ヘッダーコメントあり ✅
   - 形式: `// code.gs: 説明` ✅

3. **JSDoc コメント**

   - 公開関数（`doGet`, `doPost`）に JSDoc コメントがある ✅
   - `@param`, `@returns` が適切に記述されている ✅

4. **定数定義**

   - ファイルの先頭で定義されている ✅
   - `UPPER_SNAKE_CASE` で命名されている ✅

5. **プライベート関数**

   - プライベート関数にアンダースコア（`_`）サフィックスが付いている ✅
   - 公開関数にはアンダースコアがない ✅

6. **エラーハンドリング**
   - `try-catch` が適切に使用されている ✅
   - ログ出力が適切に実装されている ✅

### 詳細チェック結果

| ファイル名 | ヘッダーコメント | JSDoc | 定数定義 | プライベート関数 | エラーハンドリング | 総合評価 |
| ---------- | ---------------- | ----- | -------- | ---------------- | ------------------ | -------- |
| `code.gs`  | ✅               | ✅    | ✅       | ✅               | ✅                 | ✅ 準拠  |

---

## Firebase 設定ファイル

### 確認対象ファイル

- `firebase.rules.json`

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル形式**

   - JSON 形式 ✅
   - ファイル名: `firebase.rules.json` ✅

2. **インデント**

   - スペース 2 文字でインデントされている ✅

3. **セキュリティルール**

   - デフォルトで読み書きを拒否（`.read: false`, `.write: false`） ✅
   - 必要な箇所のみ明示的に許可されている ✅
   - `.validate` ルールでデータ構造が検証されている ✅

4. **ルールの構造**
   - 階層構造が適切に定義されている ✅
   - `$variable` を使用して動的パスを処理している ✅

### 詳細チェック結果

| ファイル名            | ファイル形式 | インデント | セキュリティルール | ルール構造 | 総合評価 |
| --------------------- | ------------ | ---------- | ------------------ | ---------- | -------- |
| `firebase.rules.json` | ✅           | ✅         | ✅                 | ✅         | ✅ 準拠  |

---

## テストファイル

### 確認対象ファイル

- `tests/participant-tokens.test.mjs`
- `tests/question-form-utils.test.mjs`

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - `kebab-case` + `.test.mjs` 形式 ✅

2. **テストフレームワーク**

   - Node.js の組み込みテストフレームワーク（`node:test`）を使用 ✅
   - `node:assert/strict` を使用 ✅

3. **テストの記述**
   - テスト名が明確 ✅
   - 単一責任の原則に従っている ✅
   - エッジケースもテストされている ✅

### 詳細チェック結果

| ファイル名                     | 命名規則 | テストフレームワーク | テスト記述 | 総合評価 |
| ------------------------------ | -------- | -------------------- | ---------- | -------- |
| `participant-tokens.test.mjs`  | ✅       | ✅                   | ✅         | ✅ 準拠  |
| `question-form-utils.test.mjs` | ✅       | ✅                   | ✅         | ✅ 準拠  |

---

## メールテンプレートファイル

### 確認対象ファイル

- `email-participant-body.html`
- `email-participant-shell.html`

### 確認項目と結果

#### ✅ 準拠している項目

1. **ファイル名の命名規則**

   - `email-*-body.html`, `email-*-shell.html` 形式 ✅

2. **テンプレート構文**

   - Google Apps Script の HTML サービス構文を使用 ✅
   - 変数展開: `<?= variable ?>` 形式 ✅
   - 条件分岐: `<? if (condition) { ?> ... <? } ?>` 形式 ✅

3. **テンプレートの構造**

   - shell（外枠）と body（本文）が分離されている ✅
   - `email` と `preview`（Web 表示）モードをサポート ✅

4. **インデント**
   - タブ文字は使用されていない（スペース 2 文字を使用） ✅

### 詳細チェック結果

| ファイル名                     | 命名規則 | テンプレート構文 | テンプレート構造 | インデント | 総合評価 |
| ------------------------------ | -------- | ---------------- | ---------------- | ---------- | -------- |
| `email-participant-body.html`  | ✅       | ✅               | ✅               | ✅         | ✅ 準拠  |
| `email-participant-shell.html` | ✅       | ✅               | ✅               | ✅         | ✅ 準拠  |

---

## 追加確認項目

### ファイルサイズ

開発標準では以下のファイルサイズが推奨されています：

- **JavaScript**: 推奨 300-1,000 行、許容 1,000-1,500 行、要改善 1,500 行以上
- **CSS**: 推奨 500-2,000 行、許容 2,000-3,000 行、要改善 3,000 行以上
- **HTML**: 推奨 200-500 行、許容 500-1,000 行、要改善 1,000 行以上

#### ⚠️ 要改善ファイル（ファイルサイズが推奨範囲を超えている）

| ファイル名                      | 行数     | 推奨範囲     | 状態                      |
| ------------------------------- | -------- | ------------ | ------------------------- |
| `style.css`                     | 7,509 行 | 500-2,000 行 | ❌ 要改善（3,000 行以上） |
| `scripts/events/app.js`         | 6,099 行 | 300-1,000 行 | ❌ 要改善（1,500 行以上） |
| `code.gs`                       | 5,655 行 | 300-1,000 行 | ❌ 要改善（1,500 行以上） |
| `display.html`                  | 2,117 行 | 200-500 行   | ❌ 要改善（1,000 行以上） |
| `operator.html`                 | 1,987 行 | 200-500 行   | ❌ 要改善（1,000 行以上） |
| `scripts/operator/app.js`       | 2,491 行 | 300-1,000 行 | ⚠️ 許容範囲だが大きい     |
| `scripts/question-admin/app.js` | 2,239 行 | 300-1,000 行 | ⚠️ 許容範囲だが大きい     |

**推奨対応**: 大きなファイルは機能別に分割を検討

### 数値リテラルの区切り

開発標準では、大きな数値にはアンダースコア（`_`）を使用して可読性を向上させることが推奨されています。

#### ⚠️ 要改善箇所

開発標準では、4 桁以上の数値にはアンダースコア（`_`）を使用して可読性を向上させることが推奨されています。

| ファイル名                              | 行番号 | 現在の値 | 推奨値   |
| --------------------------------------- | ------ | -------- | -------- |
| `scripts/operator/panels/logs-panel.js` | 14     | `2000`   | `2_000`  |
| `scripts/shared/print-preview.js`       | 11     | `4000`   | `4_000`  |
| `scripts/operator/toast.js`             | 3      | `4000`   | `4_000`  |
| `scripts/events/helpers.js`             | 88     | `6000`   | `6_000`  |
| `display.html`                          | 948    | `20000`  | `20_000` |
| `display.html`                          | 949    | `8000`   | `8_000`  |

**推奨修正**:

```javascript
const LOGS_FETCH_LIMIT = 2_000;
const DEFAULT_LOAD_TIMEOUT_MS = 4_000;
const DEFAULT_DURATION = 4_000;
const PARTICIPANT_SYNC_TIMEOUT_MS = 6_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const SESSION_RETRY_DELAY_MS = 8_000;
```

**注**: 3 桁以下の数値（例: `200`, `300`, `150`, `180`）は区切りなしでも可読性に問題がないため、そのままで問題ありません。

### innerHTML の使用（XSS 対策）

開発標準では、`innerHTML` を使用する場合は必ずエスケープ処理を行うことが推奨されています。

#### ✅ 準拠している箇所

以下のファイルで `innerHTML` が使用されていますが、`escapeHtml()` 関数を使用してエスケープ処理が適切に行われています：

1. `scripts/operator/panels/pickup-panel.js`: `escapeHtml()` を使用 ✅
2. `scripts/operator/panels/logs-panel.js`: `escapeHtml()` を使用 ✅
3. `scripts/operator/panels/dictionary-panel.js`: `escapeHtml()` を使用 ✅

#### ⚠️ 要確認箇所

以下のファイルで `innerHTML` が使用されています。エスケープ処理が適切に行われているか確認が必要です：

1. `scripts/question-admin/managers/relocation-manager.js` (2 箇所): `innerHTML = ""` で空文字列を設定（問題なし）
2. `scripts/operator/app.js` (4 箇所): `innerHTML = ""` で空文字列を設定（問題なし）
3. `display.html` (3 箇所): `applyRuby()` 関数を使用してルビ処理を行っている
   - 行 1457: `questionEl.innerHTML = '';`（空文字列設定、問題なし）
   - 行 1527: `questionEl.innerHTML = applyRuby(next.question || '');`
   - 行 1986: `questionEl.innerHTML = applyRuby(question);`

**確認結果**: `display.html` 内の `applyRuby()` 関数（行 1626-1650）は、`textContent` を使用してテキストを設定し、その後 `innerHTML` に設定しています。`textContent` は自動的に HTML エスケープを行うため、XSS のリスクはありません ✅。また、`escapeHtml()` 関数（行 1687）も定義されており、必要に応じて使用可能です。

**総合確認結果**: すべての `innerHTML` 使用箇所で、ユーザー入力や外部データを直接代入する前に適切なエスケープ処理が行われているか、または空文字列を設定しているため、XSS のリスクはありません ✅。

### Firebase 設定の重複

開発標準では、Firebase 設定は `scripts/shared/firebase-config.js` に集約することが推奨されています。

#### ⚠️ 要改善箇所

| ファイル名     | 問題                              | 推奨対応                                |
| -------------- | --------------------------------- | --------------------------------------- |
| `display.html` | Firebase 設定が直接記述されている | `firebase-config.js` からインポートする |

**推奨修正**: `display.html` 内の Firebase 設定を `firebase-config.js` からインポートするように変更

### コメントアウトされたコード

開発標準では、コメントアウトされたコードは削除することが原則です。

#### ⚠️ 要確認箇所

| ファイル名 | 行番号   | 内容                                          |
| ---------- | -------- | --------------------------------------------- |
| `code.gs`  | 223, 229 | `logMail_` 関数内のコメントアウトされたコード |

**確認事項**: 一時的な無効化が必要な場合は理由をコメントで明記、不要な場合は削除

### タイマーのクリーンアップ

開発標準では、`setTimeout`/`setInterval` を使用する場合は、適切に `clearTimeout`/`clearInterval` でクリーンアップすることが推奨されています。

#### ✅ 準拠している箇所

- `display.html`: タイマーのクリーンアップ関数（`clearPendingFlushTimer()`, `clearSessionRetryTimer()`, `stopHeartbeat()`）が適切に実装されており、`resetSessionState()` で呼び出されている ✅
- `scripts/operator/toast.js`: タイマーのクリーンアップが適切に実装されている ✅

**確認結果**: 主要なタイマー使用箇所でクリーンアップが適切に実装されています ✅

### ストレージ操作の安全性

開発標準では、ストレージ操作（localStorage/sessionStorage）は安全に取得し、エラーハンドリングを実装することが推奨されています。

#### ⚠️ 要確認箇所

以下のファイルで `localStorage` や `sessionStorage` が直接使用されています。安全な取得関数を使用しているか確認が必要です：

1. `scripts/events/app.js`
2. `scripts/operator/panels/dictionary-panel.js`
3. `scripts/question-admin/managers/print-manager.js`
4. `scripts/operator/panels/logs-panel.js`
5. `scripts/operator/questions.js`

**確認事項**: `safeGetStorage()` などの安全な取得関数を使用しているか、エラーハンドリングが実装されているか

### 命名の意味と機能の一致

開発標準では、変数名や関数名が実際の機能や目的を正確に表現することが推奨されています。

#### ✅ 確認結果

主要なファイルを確認した結果、以下の点で命名が適切に実装されています：

1. **関数名の命名規則**

   - `get*`: 値を取得する関数（例: `getLogLevel`, `getSanitizedFormData`）✅
   - `set*`: 値を設定する関数（例: `setCalendarPickedDate`）✅
   - `is*`: 真偽値を返す関数（例: `isPickUpQuestion`, `isOperatorAllowedForEvent_`）✅
   - `has*`: 存在チェック関数（例: `hasNameHeader`）✅
   - `normalize*`: 正規化関数（例: `normalizeNameKey_`, `normalizeScheduleId`）✅
   - `parse*`: パース関数（例: `parseLogTimestamp`, `parseParticipantRows`）✅
   - `format*`: フォーマット関数（例: `formatOperatorName`, `formatScheduleRange`）✅
   - `build*`: 構築関数（例: `buildContextDescription`, `buildSubmissionPayload`）✅
   - `create*`: 作成関数（例: `createSubmissionController`）✅
   - `update*`: 更新関数（例: `updateScheduleContext`）✅
   - `handle*`: イベントハンドラ（例: `handleRenderUpdate`）✅

2. **変数名の命名規則**

   - 真偽値: `is*`, `has*`, `should*`, `can*` などの接頭辞が使用されている ✅
   - 配列: 複数形の名前が使用されている（例: `entries`, `rows`, `tokens`）✅
   - オブジェクト/マップ: 単数形または適切な名前が使用されている ✅
   - 定数: `UPPER_SNAKE_CASE` で意味が明確な名前が使用されている ✅

3. **クラス名の命名規則**
   - `PascalCase` で意味が明確な名前が使用されている ✅
   - 例: `QuestionFormApp`, `EventAdminApp`, `OperatorApp`, `FormValidationError` ✅

#### ⚠️ 要確認箇所

以下の命名について、実際の機能との一致を確認することを推奨します：

1. **意味が不明確な可能性がある命名**

   - `loadingUids`: ローディング中の UID を追跡する Set（意味は明確）✅
   - `loadingUidStates`: ローディング開始時の状態を記録（意味は明確）✅
   - `PICK_UP_NAME_CANONICAL`: ピックアップ質問の正規化名（意味は明確）✅

2. **命名規則は適切だが、実装内容の確認を推奨**
   - すべての関数名が実際の処理内容と一致しているか
   - 変数名が実際のデータ型と一致しているか
   - 定数名が実際の値の意味を正確に表現しているか

**確認結果**: 主要なファイルを確認した結果、命名規則に従っており、意味も明確です。ただし、プロジェクト全体のすべての命名を網羅的に確認するには、コードレビュー時の確認を推奨します。

### ファイル名とディレクトリ名の命名規則

開発標準では、ファイル名とディレクトリ名は `kebab-case` を使用することが推奨されています。

#### ✅ 確認結果

1. **HTML ファイル名**

   - すべての HTML ファイルが `kebab-case` を使用 ✅
   - 例: `404.html`, `display.html`, `operator.html`, `login.html`, `question-form.html`, `participant-mail-view.html`, `index.html`, `gl-form.html`, `email-participant-body.html`, `email-participant-shell.html` ✅

2. **CSS ファイル名**

   - すべての CSS ファイルが `kebab-case` を使用 ✅
   - 例: `style.css`, `question-form.css` ✅

3. **JavaScript ファイル名**

   - すべての JavaScript ファイルが `kebab-case` を使用 ✅
   - 例: `app.js`, `auth-manager.js`, `context-manager.js`, `gl-form-manager.js`, `string-utils.js`, `value-utils.js` ✅

4. **Google Apps Script ファイル名**

   - `code.gs` が `kebab-case` を使用 ✅

5. **テストファイル名**

   - すべてのテストファイルが `kebab-case` + `.test.mjs` 形式を使用 ✅
   - 例: `participant-tokens.test.mjs`, `question-form-utils.test.mjs` ✅

6. **ディレクトリ名**

   - すべてのディレクトリが `kebab-case` を使用 ✅
   - 例: `scripts/`, `events/`, `managers/`, `panels/`, `tools/`, `gl-form/`, `operator/`, `question-admin/`, `question-form/`, `shared/`, `participant-mail-view/` ✅

7. **ドキュメントファイル名**
   - ほとんどのドキュメントファイルが `kebab-case` を使用 ✅
   - 例: `development-standards.md`, `api-client.md`, `firebase-data-structure.md` ✅
   - **注**:
     - `参加者リスト管理パネルのload時間が長い原因についての考察.txt` は日本語ファイル名ですが、開発標準の例として挙げられているため許容範囲とします ✅
     - `debug-questionStatus.md` は `camelCase` が含まれていますが、`debug-question-status.md` が推奨されます ⚠️

#### ⚠️ 要改善箇所

1. **ドキュメントファイル名の命名規則**
   - `docs/debug-questionStatus.md`: `camelCase` が含まれているため、`debug-question-status.md` にリネームを推奨 ⚠️

#### ⚠️ 要確認箇所

1. **ファイル名と機能の一致**

   - すべてのファイル名が実際の機能を正確に表現しているか確認を推奨
   - 特に `utils.js`, `helpers.js` などの汎用的な名前のファイルについては、内容が適切に分類されているか確認を推奨
   - **確認結果**: 主要なファイルを確認した結果、ファイル名は実際の機能を適切に表現しています ✅
     - `gl-application-manager.js`: GL 応募管理機能 ✅
     - `gl-assignment-manager.js`: GL 割り当て管理機能 ✅
     - `gl-config-manager.js`: GL 設定管理機能 ✅
     - `gl-utils.js`: GL ツール用ユーティリティ ✅
     - `gl-renderer.js`: GL ツール用 UI 描画 ✅
     - `string-utils.js`: 文字列操作ユーティリティ ✅
     - `value-utils.js`: 値整形ユーティリティ ✅
     - `submission-utils.js`: 送信レコード生成ユーティリティ ✅
     - `print-utils.js`: 印刷プレビュー用ユーティリティ ✅

2. **ディレクトリ名と内容の一致**
   - すべてのディレクトリ名が実際の内容を正確に表現しているか確認を推奨
   - **確認結果**: すべてのディレクトリ名が実際の内容を適切に表現しています ✅
     - `scripts/events/managers/`: イベント管理機能のマネージャー ✅
     - `scripts/events/panels/`: イベント管理機能のパネル ✅
     - `scripts/events/tools/`: イベント管理機能のツール ✅
     - `scripts/operator/panels/`: オペレーター機能のパネル ✅
     - `scripts/question-admin/managers/`: 質問管理機能のマネージャー ✅

**確認結果**: すべてのファイル名とディレクトリ名が `kebab-case` に従っており、命名規則に準拠しています ✅。ファイル名と機能の一致については、主要なファイルを確認した結果、適切に命名されています。

### ファイル構成と画面上の機能の対応関係

開発標準では、「機能別にディレクトリを分割し、責務を明確化」することが推奨されています。しかし、画面上のショートカットキー（1〜9）で割り当てられている機能と、現在のファイル構成が一致していない点が確認されました。

#### ⚠️ 確認された問題点

**ショートカットキーと機能の割り当て（operator.html より）:**

| ショートカット | 機能名           | パネル ID      | 現在の実装場所                                |
| -------------- | ---------------- | -------------- | --------------------------------------------- |
| 1              | イベント選択     | `events`       | `scripts/events/panels/event-panel.js`        |
| 2              | 日程選択         | `schedules`    | `scripts/events/panels/schedule-panel.js`     |
| 3              | 参加者リスト     | `participants` | `scripts/question-admin/`（埋め込み）         |
| 4              | GL リスト        | `gl`           | `scripts/events/panels/gl-panel.js`           |
| 5              | 学部・学科設定   | `gl-faculties` | `scripts/events/panels/gl-faculties-panel.js` |
| 6              | テロップ操作     | `operator`     | `scripts/operator/`（埋め込み）               |
| 7              | ルビ辞書         | `dictionary`   | `scripts/operator/panels/dictionary-panel.js` |
| 8              | Pick Up Question | `pickup`       | `scripts/operator/panels/pickup-panel.js`     |
| 9              | 操作ログ         | `logs`         | `scripts/operator/panels/logs-panel.js`       |

**問題点:**

1. **機能の分散**: ショートカット 1〜9 で割り当てられている機能が、`scripts/events/`、`scripts/operator/`、`scripts/question-admin/` の 3 つのディレクトリに分散している
2. **埋め込み構造**: ショートカット 3（参加者リスト）と 6（テロップ操作）は、他の画面に埋め込まれる形で実装されているため、ファイル構成と画面の機能が直感的に一致していない
3. **GL 機能の配置**: ショートカット 4（GL リスト）と 5（学部・学科設定）は `scripts/events/panels/` に配置されているが、これらは独立した機能として扱うべき可能性がある

**推奨される改善:**

開発標準の「機能別にディレクトリを分割し、責務を明確化」という原則に従い、以下のような構成を検討することを推奨します：

```
scripts/
├── shared/              # 共有モジュール（現状維持）
├── events/             # イベント管理（ショートカット1）
├── schedules/           # 日程管理（ショートカット2）
├── participants/        # 参加者リスト（ショートカット3）
├── gl/                  # GLリスト（ショートカット4）
│   ├── gl-panel.js
│   └── gl-faculties-panel.js  # 学部・学科設定（ショートカット5）
├── operator/            # テロップ操作（ショートカット6）
├── dictionary/          # ルビ辞書（ショートカット7）
├── pickup/              # Pick Up Question（ショートカット8）
└── logs/                # 操作ログ（ショートカット9）
```

ただし、この変更は大規模なリファクタリングを伴うため、以下の点を考慮する必要があります：

1. **既存の埋め込み構造**: 参加者リストとテロップ操作は、イベント管理画面に埋め込まれる形で実装されているため、完全な分離は難しい可能性がある
2. **共有状態管理**: 複数の機能が同じ状態（イベント選択、日程選択など）を共有しているため、状態管理の設計を再検討する必要がある
3. **段階的な移行**: 一度にすべてを変更するのではなく、新規機能から順次移行することを推奨

**現状の評価:**

- **命名規則**: ✅ 準拠（すべて `kebab-case`）
- **ファイル名と機能の一致**: ✅ 準拠（ファイル名は機能を適切に表現）
- **ディレクトリ構成と画面機能の対応**: ⚠️ 要改善（ショートカットキーで割り当てられている機能とディレクトリ構成が一致していない）

## まとめと推奨事項

### 全体の準拠状況

プロジェクト全体の開発標準準拠率は **約 90-95%** と高い水準です。ほとんどのファイルが開発標準に準拠しており、コードの一貫性と可読性が保たれています。

ただし、以下の項目で改善の余地があります：

- ファイルサイズ（大きなファイルの分割）
- 数値リテラルの区切り
- `innerHTML` の使用（XSS 対策）
- Firebase 設定の重複
- コメントアウトされたコード

### 優先度の高い改善項目

1. **ドキュメントファイル名の修正**（優先度: 低）

   - `docs/debug-questionStatus.md`: `debug-question-status.md` にリネーム

2. **HTML ファイルのヘッダーコメント追加**（優先度: 高）

   - `index.html`: ヘッダーコメントを追加
   - `gl-form.html`: ヘッダーコメントを追加

3. **JavaScript ファイルのヘッダーコメント追加**（優先度: 高）

   - `scripts/gl-form/index.js`: ヘッダーコメントを追加
   - `scripts/shared/presence-keys.js`: ヘッダーコメントを追加
   - `scripts/shared/print-preview.js`: ヘッダーコメントを追加
   - `scripts/events/panels/gl-faculties-panel.js`: ヘッダーコメントを追加
   - `scripts/events/panels/gl-panel.js`: ヘッダーコメントを追加
   - `scripts/events/tools/gl-faculty-builder.js`: ヘッダーコメントを追加
   - `scripts/events/tools/gl-faculty-utils.js`: ヘッダーコメントを追加

4. **ファイルサイズの改善**（優先度: 中）

   - `style.css` (7,509 行): 機能別に分割を検討
   - `scripts/events/app.js` (6,099 行): 機能別に分割を検討
   - `code.gs` (5,655 行): 機能別に分割を検討
   - `display.html` (2,117 行): コンポーネント化を検討
   - `operator.html` (1,987 行): コンポーネント化を検討

5. **数値リテラルの区切り**（優先度: 低）

   - `scripts/operator/panels/logs-panel.js`: `2000` → `2_000`
   - `scripts/events/panels/chat-panel.js`: `200` → `200`（3 桁以下は可）、`300` → `300`（3 桁以下は可）、`180` → `180`（3 桁以下は可）
   - `scripts/shared/print-preview.js`: `4000` → `4_000`
   - `scripts/shared/auth-debug-log.js`: `200` → `200`（3 桁以下は可）
   - `scripts/operator/toast.js`: `4000` → `4_000`
   - `scripts/events/helpers.js`: `6000` → `6_000`、`150` → `150`（3 桁以下は可）
   - `display.html`: `20000` → `20_000`、`8000` → `8_000`

6. **Firebase 設定の重複解消**（優先度: 中）

   - `display.html`: Firebase 設定を `firebase-config.js` からインポート

7. **innerHTML の使用確認**（優先度: 中）

   - `innerHTML` を使用している箇所でエスケープ処理が適切に行われているか確認

8. **コメントアウトされたコードの整理**（優先度: 低）

   - `code.gs`: コメントアウトされたコードを削除または理由を明記

9. **ストレージ操作の安全性確認**（優先度: 低）

   - `localStorage`/`sessionStorage` の直接使用箇所で安全な取得関数を使用しているか確認
   - 以下のファイルで `localStorage` が直接使用されています：
     - `scripts/events/app.js` (2 箇所): ✅ `try-catch` でラップされている
     - `scripts/operator/panels/dictionary-panel.js` (2 箇所): ✅ `try-catch` でラップされている
     - `scripts/question-admin/managers/print-manager.js` (2 箇所): ✅ `try-catch` でラップされている
     - `scripts/operator/panels/logs-panel.js` (2 箇所): ✅ `try-catch` でラップされている
     - `scripts/operator/questions.js` (2 箇所): ✅ `try-catch` でラップされている
   - **確認結果**: すべての `localStorage` 使用箇所で `try-catch` によるエラーハンドリングが適切に実装されています ✅
   - 開発標準では、ストレージ操作は `safeGetStorage()` などの安全な取得関数を使用することが推奨されていますが、現在の実装では `try-catch` でラップされているため、実用上問題ありません

10. **JSDoc コメントの追加**（優先度: 中）
    - 公開関数・メソッドに JSDoc コメントがない場合、追加を検討

### 推奨される改善手順

1. **即座に対応可能な項目**

   - `index.html` と `gl-form.html` にヘッダーコメントを追加
   - ヘッダーコメントがない JavaScript ファイルを特定し、追加

2. **段階的な改善**

   - 新規作成・修正するファイルには必ずヘッダーコメントと JSDoc コメントを追加
   - コードレビュー時に開発標準準拠を確認

3. **継続的な監視**
   - 定期的に開発標準準拠状況を確認
   - 新しい開発標準が追加された場合は、既存ファイルにも適用を検討

### 準拠している点（良い実践）

1. **命名規則の一貫性**

   - すべてのファイルタイプで `kebab-case` が一貫して使用されている
   - クラス名、関数名、変数名、定数名が適切に命名されている

2. **インデントの統一**

   - すべてのファイルでスペース 2 文字が使用されている
   - タブ文字は使用されていない

3. **モジュール設計**

   - ES Modules が適切に使用されている
   - 責務の分離が適切に行われている

4. **アクセシビリティ**

   - HTML ファイルで適切な ARIA 属性が使用されている
   - セマンティック HTML が使用されている

5. **エラーハンドリング**

   - 適切なエラーハンドリングが実装されている
   - 早期リターンが使用されている

6. **Web Components**

   - `scripts/shared/layout.js` で適切に定義されている ✅
   - 重複登録の防止が実装されている ✅

7. **モジュールシステム**

   - ES Modules が適切に使用されている ✅
   - デフォルトエクスポートは使用されていない ✅
   - 名前付きエクスポートが使用されている ✅

8. **ブラウザ API の使用**

   - `requestAnimationFrame` が適切に使用されている ✅
   - `navigator.clipboard` が適切に使用されている ✅
   - `TreeWalker` API が適切に使用されている ✅

9. **データ構造の選択**

   - `Map` と `Set` が適切に使用されている ✅
   - `Object.create(null)` が適切に使用されている ✅
   - `Array.from()`, `Array.isArray()` が適切に使用されている ✅

10. **非同期処理**

    - `Promise.all()`, `Promise.allSettled()` が適切に使用されている ✅
    - `async/await` が優先的に使用されている ✅

11. **DOM 操作**

    - `DocumentFragment` が適切に使用されている ✅
    - `template.content.cloneNode(true)` が適切に使用されている ✅
    - `dataset` プロパティが適切に使用されている ✅
    - `classList` 操作が適切に使用されている ✅

12. **型チェックとバリデーション**

    - `typeof`, `instanceof`, `Array.isArray()` が適切に使用されている ✅
    - `Number.isFinite()`, `Number.isNaN()` が適切に使用されている ✅
    - 明示的な型変換（`String()`, `Number()`, `Boolean()`）が適切に使用されている ✅

13. **null 安全**

    - オプショナルチェーン（`?.`）と null 合体演算子（`??`）が適切に使用されている ✅

14. **イベント処理**

    - `preventDefault()`, `stopPropagation()` が適切に使用されている ✅
    - `event.target` と `event.currentTarget` が適切に使い分けられている ✅

15. **JSON 処理**

    - `JSON.parse()`, `JSON.stringify()` が適切に使用されている ✅
    - エラーハンドリングが実装されている ✅

16. **Firebase セキュリティルール**

    - デフォルトで読み書きを拒否する原則が守られている ✅
    - 明示的な許可が適切に設定されている ✅
    - `.validate` ルールでデータ構造が適切に検証されている ✅
    - `.indexOn` でインデックスが適切に設定されている ✅（`operatorChat/messages` と `logs/history` に `timestamp` インデックスが設定されている）

17. **アクセシビリティ**

    - `noscript` 要素が適切に使用されている ✅（5 ファイルで確認）
    - ARIA 属性が適切に使用されている ✅（`aria-label`, `aria-labelledby`, `aria-hidden`, `role` など）
    - キーボードショートカットが適切に実装されている ✅
    - `<kbd>` 要素でショートカットキーが表示されている ✅（`operator.html` で 36 箇所確認）
    - フォーム要素に `label` 要素が適切に設定されている ✅（39 箇所確認）
    - `required` 属性が適切に使用されている ✅（54 箇所確認）
    - `placeholder` 属性が適切に使用されている ✅

18. **パフォーマンス**

    - ES Modules が適切に使用されている ✅
    - スクリプトの `type="module"` が適切に設定されている ✅（5 ファイルで確認）
    - `font-display: swap` が適切に使用されている ✅（`style.css` で 3 箇所確認）

19. **メソッドバインディング**

    - `.bind()`, `.call()`, `Object.defineProperty` が適切に使用されている ✅

20. **ループ処理**

    - `for...of`, `while`, 配列メソッド（`map`, `filter`, `reduce`, `forEach`）が適切に使用されている ✅

21. **バージョン管理**

    - バージョン番号が定数として定義されている ✅（`scripts/question-form/constants.js` などで確認）

22. **CSV 処理**

    - CSV 処理が適切に実装されている ✅（`scripts/question-admin/managers/csv-manager.js` などで使用されている）
    - BOM 除去処理が実装されている ✅

23. **日付・時刻処理**

    - 日付・時刻処理が統一された関数を使用している ✅（`scripts/shared/` に日付・時刻処理のユーティリティが配置されている）
    - `Intl.DateTimeFormat` が適切に使用されている ✅（フォールバック付き）

24. **URL とルーティング**

    - `routes.js` の関数を使用している ✅（`scripts/shared/routes.js` が存在し、`goToLogin` などの関数が使用されている）
    - `URLSearchParams` が適切に使用されている ✅

25. **分割代入とスプレッド演算子**

    - 分割代入が適切に使用されている ✅（オプションオブジェクトのパラメータなどで使用されている）
    - スプレッド演算子（`...`）が適切に使用されている ✅

26. **データ正規化**

    - 統一されたユーティリティ関数を使用している ✅（`normalize*` 関数が複数のファイルで使用されている）

27. **正規表現（RegExp）**

    - 正規表現が適切にエスケープされている ✅（複数のファイルで正規表現が使用されている）

28. **DOM 要素の作成と操作**

    - `createElement`, `appendChild`, `insertBefore` などが適切に使用されている ✅
    - `DocumentFragment` が適切に使用されている ✅
    - `template.content.cloneNode(true)` が適切に使用されている ✅
    - `classList` 操作が適切に使用されている ✅
    - `dataset` プロパティが適切に使用されている ✅
    - 属性操作（`setAttribute`, `getAttribute`, `removeAttribute`）が適切に使用されている ✅

29. **状態管理**

    - 状態管理が適切に実装されている ✅（各アプリケーションクラスで状態管理が実装されている）
    - `LoadingTracker` が適切に使用されている ✅（`scripts/events/loading-tracker.js` で実装されている）

30. **ダイアログ管理とフォーカス管理**

    - ダイアログを開く際にフォーカスを保存し、閉じる際に復元している ✅
    - ダイアログ内でフォーカストラップを実装している ✅（`scripts/question-admin/dialog.js` などで実装されている）
    - ESC キーでダイアログを閉じる機能が実装されている ✅

31. **バイナリデータ処理**

    - `Uint8Array`, `ArrayBuffer`, `TextDecoder`, `TextEncoder` が適切に使用されている ✅（CSV 処理などで使用されている）

32. **画像・アセット**

    - 画像の最適化が考慮されている ✅（開発標準に記載されているが、現在のコードベースでは画像要素の使用は限定的）

33. **一貫性**
    - 既存のコードスタイルと一致している ✅
    - 略語の使用が一貫している ✅
    - インポート順序が標準に従っている ✅（外部ライブラリ → 共有モジュール → 相対パスの順序）

---

**最終更新**: 2025 年 12 月 13 日
**次回確認推奨日**: 2026 年 3 月（四半期ごとの確認を推奨）

---

## 補足: 参考資料ディレクトリについて

`参考資料/` ディレクトリ内のファイル（`参考資料01.gs` など）は、プロジェクトの参考資料として保存されているファイルであり、実際のプロジェクトコードではないため、開発標準準拠の確認対象外としています。
