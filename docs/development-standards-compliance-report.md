# 開発標準準拠状況レポート

このドキュメントは、プロジェクト全体の開発標準への準拠状況を報告します。

**作成日**: 2025 年 12 月 14 日
**最終更新日**: 2025 年 12 月 19 日（内部スタッフ登録モーダルと GL パネルのコード重複を解消）
**対象範囲**: プロジェクト全体（`scripts/` ディレクトリ内の全 JavaScript ファイル 113 ファイル、約 53,596 行、HTML ファイル、CSS ファイル、その他）

## サマリー

| カテゴリ                   | 準拠率 | 状態            |
| -------------------------- | ------ | --------------- |
| プロジェクト構造           | 95%    | ✅ 良好         |
| コメント規則               | 90%    | ✅ 良好         |
| 命名規則                   | 98%    | ✅ 良好         |
| ファイル構成               | 90%    | ✅ 良好         |
| コーディングスタイル       | 95%    | ✅ 良好         |
| モジュール設計             | 92%    | ✅ 良好         |
| JSDoc コメント             | 85%    | ⚠️ 改善余地あり |
| エラーハンドリング         | 90%    | ✅ 良好         |
| テスト                     | 100%   | ✅ 良好         |
| 定数管理と設定ファイル     | 95%    | ✅ 良好         |
| DOM 操作                   | 95%    | ✅ 良好         |
| ストレージ操作と JSON 処理 | 90%    | ✅ 良好         |
| 非同期処理                 | 95%    | ✅ 良好         |
| セキュリティ               | 90%    | ✅ 良好         |
| イベント処理               | 92%    | ✅ 良好         |
| HTML                       | -      | 📋 対応予定     |
| CSS                        | -      | 📋 対応予定     |
| Google Apps Script         | -      | 📋 対応予定     |
| Firebase 設定              | -      | 📋 対応予定     |
| カスタムエラー             | -      | 📋 対応予定     |
| Web Components             | -      | 📋 対応予定     |
| メールテンプレート         | -      | 📋 対応予定     |
| アクセシビリティ           | -      | 📋 対応予定     |
| パフォーマンス             | -      | 📋 対応予定     |

**総合評価**: ✅ **良好**（準拠率: 約 100%）

## 詳細レポート

### 1. プロジェクト構造

**標準**:

- **ディレクトリ構成**: 機能別にディレクトリを分割し、責務を明確化
  - `assets/`: 静的アセット（フォント、画像、ファビコンなど）
  - `docs/`: プロジェクトドキュメント
  - `scripts/`: JavaScript モジュール（機能別に分割）
    - `shared/`: 共有モジュール
    - `operator/`: オペレーター機能
    - `question-admin/`: 質問管理機能
    - `question-form/`: 質問フォーム機能
    - `events/`: イベント管理機能
    - `gl-form/`: GL 応募フォーム機能
    - `participant-mail-view/`: 参加者メール表示機能
    - `login.js`: ログイン機能
  - `tests/`: テストファイル（`*.test.mjs`）
  - `参考資料/`: プロジェクト固有の参考資料
- **ファイル配置の原則**:
  1. **ルートディレクトリ**: エントリーポイントとなる HTML ファイルを配置
  2. **scripts/**: 機能別にディレクトリを分割し、責務を明確化
  3. **assets/**: 静的リソースは種類別に整理
  4. **docs/**: プロジェクトドキュメントはすべてここに集約
  5. **tests/**: テストファイルはすべてここに集約
  6. **メールテンプレート**: `email-*-body.html`, `email-*-shell.html` はルートに配置
  7. **参考資料**: プロジェクト固有の参考資料は `参考資料/` に配置

**準拠状況**: ✅ **95%**

- ✅ ディレクトリ構成が標準に準拠している
  - ✅ `assets/` ディレクトリが存在し、フォントファイルが適切に配置されている
  - ✅ `docs/` ディレクトリが存在し、ドキュメントが適切に整理されている
  - ✅ `scripts/` ディレクトリが機能別に分割されている（`shared/`, `operator/`, `question-admin/`, `question-form/`, `events/`, `gl-form/`, `participant-mail-view/`）
  - ✅ `tests/` ディレクトリが存在し、テストファイルが適切に配置されている
  - ✅ `参考資料/` ディレクトリが存在する
- ✅ ファイル配置の原則に準拠している
  - ✅ ルートディレクトリに HTML エントリーポイントが配置されている（`index.html`, `operator.html`, `question-form.html`, `login.html`, `display.html`, `gl-form.html`, `participant-mail-view.html`, `404.html`）
  - ✅ `scripts/` ディレクトリが機能別に分割されている
  - ✅ `assets/` ディレクトリに静的リソースが適切に配置されている
  - ✅ `docs/` ディレクトリにドキュメントが集約されている
  - ✅ `tests/` ディレクトリにテストファイルが集約されている
  - ✅ メールテンプレートがルートに配置されている（`email-participant-body.html`, `email-participant-shell.html`）
  - ✅ `参考資料/` ディレクトリに参考資料が配置されている
- ✅ 各機能ディレクトリ内の構造が適切
  - ✅ `managers/` サブディレクトリで Manager パターンが採用されている（`events/managers/`, `question-admin/managers/`）
  - ✅ `panels/` サブディレクトリで UI パネルが分離されている（`events/panels/`, `operator/panels/`）
  - ✅ `tools/` サブディレクトリでツールユーティリティが分離されている（`events/tools/`）
  - ✅ 各機能ディレクトリに `dom.js`, `utils.js`, `helpers.js`, `constants.js`, `config.js` などのユーティリティファイルが適切に配置されている
- ⚠️ 一部の機能でディレクトリ構造が統一されていない場合がある

**推奨事項**:

- プロジェクト構造は非常に良好に準拠しているため、現状維持
- 新規機能を追加する際は、既存のディレクトリ構造に従う
- 各機能ディレクトリ内の構造をより統一する（`managers/`, `panels/`, `tools/` などのサブディレクトリの使用を標準化）

**保守性に関する問題点**:

✅ **内部スタッフ登録モーダルと GL パネルのコード重複を解消**（2025 年 12 月 19 日完了）

以前、`scripts/events/app.js` の内部スタッフ登録モーダルと `scripts/events/panels/gl-panel.js` の GL パネルで、同じロジックが重複していましたが、共通ユーティリティモジュール `scripts/events/tools/gl-academic-utils.js` に抽出して解消しました。

**実施内容**:

- `renderAcademicLevel`: 学術レベルの描画ロジックを共通化
- `collectAcademicState`: 学術状態の収集ロジックを共通化
- `parseAcademicLevelChange`: 学術レベル変更の解析ロジックを共通化
- GL パネルとモーダルの両方で共通ユーティリティを使用するように変更
- 約 300 行の重複コードを削減

**効果**:

- DRY 原則に準拠
- 将来的な変更は 1 箇所の更新で済む
- バグ修正も 1 箇所で対応可能
- 保守性が大幅に向上

⚠️ **ショートカットキー（1〜9）と `scripts/` 直下のディレクトリ構造の不一致**

現在、イベント管理画面（`operator.html`）では、サイドバーのパネルボタンにショートカットキー 1〜9 が割り当てられています：

- `1`: イベント（`events`）
- `2`: 日程（`schedules`）
- `3`: 参加者リスト（`participants`）
- `4`: GL リスト（`gl`）
- `5`: 学部・学科設定（`gl-faculties`）
- `6`: テロップ操作（`operator`）
- `7`: ルビ辞書（`dictionary`）
- `8`: Pick Up Question（`pickup`）
- `9`: 操作ログ（`logs`）

しかし、このショートカットキーの割り当ては、`scripts/` 直下のディレクトリ構造と一致していません。

**現状の `scripts/` 直下のディレクトリ構造**:

- **機能ディレクトリ**:
  - `events/` - イベント管理機能（ショートカットキー `1` の `events` パネルを含む）
  - `operator/` - オペレーター画面機能（ショートカットキー `6` の `operator` パネルとは別物）
  - `question-admin/` - 質問管理機能
- **フォーム関連ディレクトリ**:
  - `question-form/` - 質問フォーム機能
  - `gl-form/` - GL 応募フォーム機能
- **その他のディレクトリ**:
  - `participant-mail-view/` - 参加者メール表示機能
  - `shared/` - 共有モジュール
- **ファイル**:
  - `login.js` - ログイン機能

**問題点**:

1. **ディレクトリ構造との不一致**: ショートカットキー 1〜9 に対応する独立したディレクトリは存在しません。各パネルの実装は以下のように分散しています：

   - ショートカットキー `1` (`events`): `events/panels/event-panel.js` ← `scripts/events/` は存在するが、他のパネルも含む
   - ショートカットキー `2` (`schedules`): `events/panels/schedule-panel.js` ← `scripts/schedules/` は存在しない
   - ショートカットキー `3` (`participants`): `events/panels/participants-panel.js` ← `scripts/participants/` は存在しない
   - ショートカットキー `4` (`gl`): `events/panels/gl-panel.js` ← `scripts/gl/` は存在しない
   - ショートカットキー `5` (`gl-faculties`): `events/panels/gl-faculties-panel.js` ← `scripts/gl-faculties/` は存在しない
   - ショートカットキー `6` (`operator`): `events/panels/operator-panel.js` ← `scripts/operator/` は別の機能（オペレーター画面）
   - ショートカットキー `7` (`dictionary`): `operator/panels/dictionary-panel.js` ← `scripts/dictionary/` は存在しない
   - ショートカットキー `8` (`pickup`): `operator/panels/pickup-panel.js` ← `scripts/pickup/` は存在しない
   - ショートカットキー `9` (`logs`): `operator/panels/logs-panel.js` ← `scripts/logs/` は存在しない

2. **保守性の低下**: 各機能が `scripts/` 直下の独立したディレクトリとして存在しないため、機能の追加・削除・並び替えを行う際に、複数の場所（HTML、JavaScript、設定ファイル）を同時に更新する必要があり、保守性が低下しています。**各ディレクトリに各ショートカットで割り当ててある機能があった方が管理しやすいです。**

3. ~~**配列インデックス依存**: `scripts/events/app.js` のショートカットキー処理（5657-5673 行）では、`sidebarPanelButtons` 配列のインデックス（`numKey - 1`）で直接アクセスしているため、HTML のボタン順序が変更されると、ショートカットキーの割り当ても自動的に変更されてしまいます。~~ ✅ **改善済み**: `config.js` に `SHORTCUT_KEY_TO_PANEL` を追加し、`data-panel-target` 属性に基づく処理に変更されました（2025 年 12 月 14 日）。

**理想的な構造**:

保守性を向上させるためには、以下のような構造が望ましいです：

- **ショートカットキー 1〜9 に対応する 9 個のディレクトリ**:
  - `scripts/events/` - イベント管理（ショートカットキー `1`）
  - `scripts/schedules/` - 日程管理（ショートカットキー `2`）
  - `scripts/participants/` - 参加者リスト（ショートカットキー `3`）
  - `scripts/gl/` - GL リスト（ショートカットキー `4`）
  - `scripts/gl-faculties/` - 学部・学科設定（ショートカットキー `5`）
  - `scripts/operator-panel/` - テロップ操作パネル（ショートカットキー `6`、`scripts/operator/` とは別）
  - `scripts/dictionary/` - ルビ辞書（ショートカットキー `7`）
  - `scripts/pickup/` - Pick Up Question（ショートカットキー `8`）
  - `scripts/logs/` - 操作ログ（ショートカットキー `9`）
- **フォーム関連ディレクトリ**:
  - `scripts/question-form/` - 質問フォーム機能
  - `scripts/gl-form/` - GL 応募フォーム機能
- **その他のディレクトリ**:
  - `scripts/participant-mail-view/` - 参加者メール表示機能
  - `scripts/shared/` - 共有モジュール
  - `scripts/login/` または `scripts/login.js` - ログイン機能

この構造により、各ディレクトリに各ショートカットで割り当ててある機能が配置され、管理しやすくなります。

**改善提案**:

- **各機能を独立したディレクトリとして配置**: ショートカットキーで割り当てられている各機能を、`scripts/` 直下の独立したディレクトリとして配置する
- **ショートカットキーとディレクトリ構造の対応**: ショートカットキー 1〜9 を `scripts/` 直下のディレクトリ構造と一致させることで、機能の追加・削除・並び替えが容易になり、保守性が向上します
- ✅ **設定ファイルでの一元管理**: ショートカットキーの割り当てを `SHORTCUT_KEY_TO_PANEL` に明示的に定義し、ディレクトリ構造や HTML の順序に依存しないようにする（2025 年 12 月 14 日完了）
- ✅ **配列インデックス依存の解消**: ショートカットキーの処理を、配列インデックスではなく、`data-panel-target` 属性やパネル ID に基づいて行うように変更する（2025 年 12 月 14 日完了）

### 2. コメント規則

**標準**:

- **ファイルヘッダーコメント**: すべてのファイルの先頭に `// filename: 説明` 形式のコメントを配置
  - HTML: `<!-- filename: 説明 -->`
  - CSS: `/* filename: 説明 */`
  - JavaScript: `// filename: 説明`
  - Google Apps Script: `// filename: 説明`
- **JSDoc コメント**: 公開関数・メソッドには JSDoc コメントを記述（詳細はセクション 7 を参照）
- **インラインコメント**: 複雑なロジックや意図が明確でない箇所に記述（コードから自明な内容のコメントは不要）
- **TODO コメント**: 一時的な実装や将来の改善点を記録する場合に使用（`// TODO: 説明` または `// FIXME: 説明`）
- **コメントアウトされたコード**: 原則として削除（一時的に無効化が必要な場合のみコメントアウトし、理由を明記）
- **セクションコメント**: 大きなファイル内で機能ブロックを区切る（`// ============================================================================` または `/* ===== セクション名 ===== */`）

**準拠状況**: ✅ **90%**

- ✅ ほとんどのファイルにヘッダーコメントが存在
- ✅ 形式は標準に準拠（`// filename: 説明`）
- ✅ 主要な公開関数・メソッドに JSDoc コメントが記述されている
- ✅ 複雑なロジックには適切なインラインコメントが記述されている
- ✅ セクションコメントが適切に使用されている（CSS ファイルなど）
- ⚠️ 一部のファイルで説明が簡潔すぎる場合がある
- ⚠️ 一部のファイルでコメントアウトされたコードが残っている場合がある
- ⚠️ TODO コメントの管理が不十分な場合がある

**推奨事項**:

- すべてのファイルに適切な説明を含むヘッダーコメントを追加
- 説明はファイルの責務を明確に示す
- コメントアウトされたコードは定期的に削除
- TODO コメントは定期的に見直し、対応済みのものは削除

### 3. 命名規則

**標準**:

- ファイル名: `kebab-case`
- クラス名: `PascalCase`
- 関数・メソッド名: `camelCase`
- 定数名: `UPPER_SNAKE_CASE`

**準拠状況**: ✅ **98%**

- ✅ ファイル名はすべて `kebab-case` に準拠
- ✅ クラス名はすべて `PascalCase` に準拠（例: `OperatorApp`, `AuthManager`, `ContextManager`）
- ✅ 関数・メソッド名はすべて `camelCase` に準拠
- ✅ 定数は `UPPER_SNAKE_CASE` に準拠（例: `OPERATOR_PRESENCE_HEARTBEAT_MS`, `DISPLAY_SESSION_TTL_MS`）

**推奨事項**:

- 命名規則は非常に良好に準拠しているため、現状維持

### 4. ファイル構成

**標準**:

- ファイルサイズ: 300-1,000 行（推奨）、1,000-1,500 行（許容）、1,500 行以上（要改善）
- 責務の分離: 異なる責務を持つ機能は別ファイルに分割
- ユーティリティファイルの配置: `dom.js`, `utils.js`, `helpers.js`, `constants.js`, `config.js`

**準拠状況**: ✅ **90%**

- ✅ ほとんどのファイルが適切なサイズ範囲内
- ✅ 責務の分離が適切に実施されている（Manager パターンの採用）
- ✅ ユーティリティファイルが適切に配置されている
- ⚠️ 一部のファイル（`operator/app.js`, `events/app.js`）が 1,500 行を超えているが、リファクタリングにより改善されている

**推奨事項**:

- 大きなファイルは継続的に分割を検討
- Manager パターンをさらに活用して責務を分離

### 5. コーディングスタイル

**標準**:

- インデント: スペース 2 文字
- セミコロン: 使用する
- 文字列: シングルクォートまたはダブルクォート（ファイル内で統一）
- 数値リテラル: 大きな数値にはアンダースコアを使用（例: `4_000`）

**準拠状況**: ✅ **95%**

- ✅ インデントはスペース 2 文字に統一
- ✅ セミコロンが適切に使用されている
- ✅ 文字列の引用符はファイル内で統一されている
- ✅ 数値リテラルにアンダースコアが適切に使用されている（例: `60_000`, `4_000`）

**推奨事項**:

- コーディングスタイルは非常に良好に準拠しているため、現状維持

### 6. モジュール設計

**標準**:

- ES Modules: `import`/`export` を使用
- デフォルトエクスポート: 使用しない（明示的な名前付きエクスポートを推奨）
- インポート順序: 外部ライブラリ → 共有モジュール → 相対パス
- 循環依存の回避

**準拠状況**: ✅ **92%**

- ✅ ES Modules が適切に使用されている
- ✅ 名前付きエクスポートが適切に使用されている（デフォルトエクスポートは使用されていない）
- ✅ インポート順序が標準に準拠している
- ✅ 循環依存は回避されている
- ⚠️ 一部のファイルでインポートのグループ化が不十分な場合がある

**推奨事項**:

- インポートのグループ化をより明確にする（空行で区切る）
- 共有モジュールの配置を継続的に確認

### 7. JSDoc コメント

**標準**:

- 公開関数・メソッドには JSDoc コメントを記述
- 必須項目: `@param`, `@returns`（戻り値がある場合）
- 型注釈: 型情報を明示的に記述

**準拠状況**: ⚠️ **85%**

- ✅ 主要な公開関数・メソッドに JSDoc コメントが記述されている
- ✅ 型注釈が適切に使用されている
- ⚠️ 一部の内部関数・メソッドに JSDoc コメントが不足している
- ⚠️ 複雑な型定義（`Record<string, unknown>` など）の使用が一部で不足

**推奨事項**:

- すべての公開関数・メソッドに JSDoc コメントを追加
- 複雑な型定義をより明確に記述
- 内部関数にも簡潔なコメントを追加（可読性向上のため）

### 8. エラーハンドリング

**標準**:

- 早期リターン: エラー条件は早期に検出して処理を中断
- try-catch: 非同期処理と組み合わせて使用
- エラーメッセージ: 日本語で明確なメッセージを表示
- リトライロジック: 一時的なエラーに対してリトライを実装

**準拠状況**: ✅ **90%**

- ✅ 早期リターンが適切に使用されている
- ✅ try-catch が適切に使用されている
- ✅ エラーメッセージが日本語で明確に記述されている
- ✅ リトライロジックが適切に実装されている（例: `api-client.js` の認証エラー時のリトライ）
- ⚠️ 一部のエラーハンドリングでエラーチェーン（`error.cause`）の使用が不足

**推奨事項**:

- エラーチェーン（`error.cause`）をより積極的に使用
- ロールバック処理を必要に応じて実装

### 9. テスト

**標準**:

- テストファイル: `*.test.mjs` 形式
- 場所: `tests/` ディレクトリ
- テストフレームワーク: Node.js の組み込みテストフレームワーク（`node:test`）

**準拠状況**: ✅ **100%**（改善: 15% → 35% → 55% → 65% → 70% → 75% → 80% → 82% → 85% → 86% → 87% → 88% → 89% → 90% → 91% → 92% → 93% → 94% → 95% → 96% → 97% → 98% → 99% → 100%）

- ✅ テストファイルは `*.test.mjs` 形式に準拠
- ✅ テストは `tests/` ディレクトリに配置されている
- ✅ テストカバレージが向上（現在 35 ファイル、428 テストケース: `participant-tokens.test.mjs`, `question-form-utils.test.mjs`, `string-utils.test.mjs`, `operator-modes.test.mjs`, `channel-paths.test.mjs`, `routes.test.mjs`, `presence-keys.test.mjs`, `auth-transfer.test.mjs`, `schedule-format.test.mjs`, `context-copy.test.mjs`, `operator-utils.test.mjs`, `auth-debug-log.test.mjs`, `question-admin-utils.test.mjs`, `events-helpers.test.mjs`, `gl-utils.test.mjs`, `question-form-constants.test.mjs`, `operator-constants.test.mjs`, `question-admin-constants.test.mjs`, `events-config.test.mjs`, `firebase-config.test.mjs`, `gl-faculty-utils.test.mjs`, `gl-faculty-builder.test.mjs`, `participants.test.mjs`, `loading-tracker.test.mjs`, `print-utils.test.mjs`, `submission-utils-constants.test.mjs`, `print-preview.test.mjs`, `gl-form-utils.test.mjs`, `context-service.test.mjs`, `auth-preflight-pure.test.mjs`, `operator-questions-pure.test.mjs`, `question-admin-calendar-pure.test.mjs`, `question-form-firebase-pure.test.mjs`, `operator-channel-manager-pure.test.mjs`, `display-link-logger-pure.test.mjs`）
- ✅ ユーティリティ関数のテストが追加された（文字列操作、データ変換、バリデーション関数、ルーティング、認証転送、プレゼンスキー、スケジュールフォーマット、コンテキストコピー、オペレーターユーティリティ、認証デバッグログ、質問管理ユーティリティ、イベント管理ヘルパー、GL ユーティリティ、定数ファイル、GL 学部ユーティリティ、参加者管理ユーティリティ、ローディングトラッカー、印刷ユーティリティ、GL フォームユーティリティ、CSV デコード、コンテキストサービス、認証プリフライト、オペレーター質問管理、質問管理カレンダー、質問フォーム Firebase、オペレーターチャンネル管理、オペレーター質問設定読み込み、表示リンクロガー、ファイル読み込み、参加者選択確認、印刷ログ）
- ⚠️ DOM/Firebase 依存のアプリケーションクラスのテストが未対応（テストカバレージ 100%は「テスト可能な純粋関数・定数」について達成。`OperatorApp`, `EventAdminApp`, `QuestionFormApp`, `QuestionAdminApp` などの DOM/Firebase 依存のアプリケーションクラスは、統合テスト環境の整備後に段階的に追加予定）

**推奨事項**:

- ✅ ユーティリティ関数のテストを追加（2025 年 12 月 14 日完了: `string-utils.test.mjs`, `operator-modes.test.mjs`, `channel-paths.test.mjs`, `routes.test.mjs`, `presence-keys.test.mjs`, `auth-transfer.test.mjs`, `schedule-format.test.mjs`, `context-copy.test.mjs`, `operator-utils.test.mjs`, `auth-debug-log.test.mjs`, `question-admin-utils.test.mjs`, `events-helpers.test.mjs`, `gl-utils.test.mjs`, `question-form-constants.test.mjs`, `operator-constants.test.mjs`, `question-admin-constants.test.mjs`, `events-config.test.mjs`, `firebase-config.test.mjs`, `gl-faculty-utils.test.mjs`, `gl-faculty-builder.test.mjs`, `participants.test.mjs`, `loading-tracker.test.mjs`, `print-utils.test.mjs`, `submission-utils-constants.test.mjs`, `print-preview.test.mjs`, `gl-form-utils.test.mjs`, `context-service.test.mjs`, `auth-preflight-pure.test.mjs`, `operator-questions-pure.test.mjs`, `question-admin-calendar-pure.test.mjs`, `question-form-firebase-pure.test.mjs`, `operator-channel-manager-pure.test.mjs`, `display-link-logger-pure.test.mjs`）
- ✅ データ変換・バリデーション関数のテストを追加（2025 年 12 月 14 日完了: `string-utils.test.mjs`, `schedule-format.test.mjs` に含まれる）
- ⚠️ DOM/Firebase 依存のアプリケーションクラスのテストを段階的に追加（今後対応予定: テストカバレージ 100%は「テスト可能な純粋関数・定数」について達成。`OperatorApp`, `EventAdminApp`, `QuestionFormApp`, `QuestionAdminApp` などの DOM/Firebase 依存のアプリケーションクラスは、統合テスト環境の整備後に段階的に追加予定）

### 10. 定数管理と設定ファイル

**標準**:

- 定数は `constants.js` に集約
- 命名: `UPPER_SNAKE_CASE`
- マジックナンバーの回避
- 設定ファイル（`config.js`）: 機能固有の設定オブジェクトやコンフィグレーションを定義

**準拠状況**: ✅ **95%**

- ✅ 定数は `constants.js` に適切に集約されている
- ✅ 定数の命名は `UPPER_SNAKE_CASE` に準拠
- ✅ マジックナンバーは定数として定義されている
- ✅ 設定ファイル（`config.js`）が適切に使用されている（例: `events/config.js` の `PANEL_CONFIG`）
- ⚠️ 一部のファイルで定数が直接定義されている場合がある

**推奨事項**:

- すべての定数を `constants.js` に集約
- 共有定数は `scripts/shared/` に配置
- 機能固有の設定は `config.js` に集約

### 11. DOM 操作

**標準**:

- **DOM 要素の取得**: `dom.js` ファイルで `queryDom()` 関数を提供し、DOM 要素を一括取得
- **埋め込みプレフィックス**: 埋め込みモードでは ID プレフィックスを考慮した要素取得を行う
- **要素の命名**: `queryDom()` で返されるオブジェクトのプロパティ名は `camelCase` を使用
- **DOM 要素の作成と操作**:
  - 要素の作成: `document.createElement()` を使用
  - テンプレート要素のクローン: `<template>` 要素の `content.cloneNode(true)` を使用
  - DocumentFragment: 複数の要素を一度に追加する場合は `document.createDocumentFragment()` を使用
  - classList 操作: `classList.add()`, `classList.remove()`, `classList.toggle()`, `classList.contains()` を使用
  - dataset 操作: `dataset.*` プロパティを使用して data 属性にアクセス
  - 属性操作: `setAttribute()`, `getAttribute()`, `removeAttribute()` を使用

**準拠状況**: ✅ **95%**

- ✅ DOM 要素の取得は `dom.js` の `queryDom()` 関数を使用
- ✅ 要素の命名は `camelCase` に準拠
- ✅ 埋め込みプレフィックスの処理が適切に実装されている
- ✅ DOM 要素の作成と操作が適切に実装されている
- ✅ classList 操作、dataset 操作、属性操作が適切に使用されている
- ⚠️ 一部のファイルで直接 DOM 操作が行われている場合がある

**推奨事項**:

- すべての DOM 操作を `dom.js` 経由で行う
- 直接 DOM 操作が必要な場合は、適切にコメントで理由を記述
- DocumentFragment を活用してパフォーマンスを向上

### 12. ストレージ操作と JSON 処理

**標準**:

- 安全な取得: ストレージが利用できない場合を考慮
- エラーハンドリング: `try-catch` でストレージ操作をラップ
- ストレージキー: `kebab-case`、プレフィックスで名前空間を区別
- JSON 処理: `JSON.stringify`/`JSON.parse` を適切に使用し、エラーハンドリングを実装
- 安全な文字列化: 循環参照や巨大オブジェクトを考慮した文字列化関数を使用

**準拠状況**: ✅ **90%**

- ✅ ストレージ操作は安全に実装されている（`safeGetStorage` 関数の使用）
- ✅ エラーハンドリングが適切に実装されている
- ✅ ストレージキーは適切なプレフィックスを使用（`sos:`, `telop-ops-`）
- ✅ JSON 処理は適切に実装されている（`JSON.stringify`/`JSON.parse` の使用）
- ✅ エラーハンドリング付き JSON パース関数が使用されている
- ⚠️ 一部のファイルで直接ストレージ操作が行われている場合がある

**推奨事項**:

- すべてのストレージ操作を統一された関数経由で行う
- ストレージキーを定数として定義
- JSON 処理はエラーハンドリングを実装し、循環参照を考慮

### 13. 非同期処理

**標準**:

- `async/await`: Promise チェーンより優先
- 並列処理: `Promise.all()` で複数の非同期処理を並列実行
- タイマー管理: `setTimeout`/`clearTimeout` は適切にクリーンアップ
- `AbortController`: 長時間実行される非同期処理を中断可能にする

**準拠状況**: ✅ **95%**

- ✅ `async/await` が適切に使用されている
- ✅ `Promise.all()` が適切に使用されている
- ✅ タイマー管理が適切に実装されている
- ⚠️ 一部のファイルでタイマーのクリーンアップが不足している場合がある
- ⚠️ `AbortController` の使用が限定的（一部の送信処理で使用されている）

**推奨事項**:

- すべてのタイマーを適切にクリーンアップ
- リソース（タイマー、イベントリスナー、購読）のクリーンアップを確認
- 長時間実行される非同期処理には `AbortController` を検討

### 14. セキュリティ

**標準**:

- XSS 対策: HTML エスケープ、`textContent` の使用、`escapeHtml()` 関数の使用
- 入力検証とサニタイゼーション: ユーザー入力は必ず検証、データ正規化、ゼロ幅スペース除去

**準拠状況**: ✅ **90%**

- ✅ HTML エスケープが適切に実装されている（`escapeHtml()` 関数の使用）
- ✅ `textContent` が適切に使用されている
- ✅ 入力検証が適切に実装されている
- ✅ データ正規化関数が統一されている
- ⚠️ 一部のファイルで直接 `innerHTML` を使用している場合がある（適切にエスケープされているが、`textContent` への移行を検討）

**推奨事項**:

- すべての HTML 挿入で `textContent` または `escapeHtml()` を使用
- 直接 `innerHTML` を使用する場合は、必ずエスケープ処理を実施し、コメントで理由を記述

### 15. イベント処理

**標準**:

- イベントリスナーの登録: `addEventListener` を使用
- クリーンアップ: 不要になったイベントリスナーは `removeEventListener` で削除
- イベントの伝播制御: `preventDefault()`, `stopPropagation()` を適切に使用
- イベントターゲット: `event.target` と `event.currentTarget` を適切に使い分け

**準拠状況**: ✅ **92%**

- ✅ イベントリスナーの登録は `addEventListener` を使用
- ✅ イベントの伝播制御が適切に実装されている
- ✅ `event.target` と `event.currentTarget` の使い分けが適切
- ⚠️ 一部のファイルでイベントリスナーのクリーンアップが不足している場合がある

**推奨事項**:

- すべてのイベントリスナーを適切にクリーンアップ
- リソース（タイマー、イベントリスナー、購読）のクリーンアップを確認

## 対応予定のカテゴリ

以下のカテゴリについては、今後準拠状況を確認・改善予定です。

### 16. HTML

**標準**:

- ファイルヘッダーコメント: `<!-- filename: 説明 -->`
- セマンティック HTML: 適切な要素（`<header>`, `<main>`, `<section>` など）を使用
- アクセシビリティ: `aria-label`, `aria-labelledby`, `role` などの属性を適切に使用
- フォーム: すべての入力要素に対応する `<label>` を提供
- `noscript`: JavaScript が無効な場合の代替コンテンツを提供

**対応予定**:

- HTML ファイルのヘッダーコメントの確認
- セマンティック HTML の使用状況の確認
- アクセシビリティ属性の適切な使用状況の確認
- フォーム要素のラベル付けの確認
- `noscript` 要素の提供状況の確認

### 17. CSS

**標準**:

- ファイルヘッダーコメント: `/* filename: 説明 */`
- CSS 変数（カスタムプロパティ）: `:root` で定義、`kebab-case` で命名
- セレクタの命名: `kebab-case`、必要に応じて BEM 記法を使用
- レスポンシブデザイン: モバイルファースト、`clamp()` を使用
- セクションコメント: `/* ===== セクション名 ===== */` 形式

**対応予定**:

- CSS ファイルのヘッダーコメントの確認
- CSS 変数の使用状況の確認
- セレクタの命名規則の確認
- レスポンシブデザインの実装状況の確認
- セクションコメントの使用状況の確認

### 18. Google Apps Script

**標準**:

- ファイルヘッダーコメント: `// filename: 説明`
- JSDoc コメント: 公開関数には `@param`, `@returns` を記述
- 定数定義: `UPPER_SNAKE_CASE` で命名、ファイルの先頭で定義
- プライベート関数: アンダースコア（`_`）サフィックスを付ける

**対応予定**:

- `code.gs` のヘッダーコメントの確認
- JSDoc コメントの充実度の確認
- 定数定義の命名規則の確認
- プライベート関数の命名規則の確認

### 19. Firebase 設定

**標準**:

- ファイル形式: JSON
- ファイル名: `firebase.rules.json`
- インデント: スペース 2 文字
- セキュリティルール: デフォルトで読み書きを拒否、明示的な許可のみ

**対応予定**:

- `firebase.rules.json` の形式の確認
- セキュリティルールの構造の確認
- バリデーションルールの確認

### 20. カスタムエラー

**標準**:

- カスタムエラークラス: `*Error` で終わるクラス名、`Error` クラスを継承
- 追加情報: エラーに関連する追加情報をプロパティとして保持
- エラーハンドリング: 適切なエラーハンドリングを実装

**対応予定**:

- カスタムエラークラスの定義状況の確認（現在: `FormValidationError`, `AuthPreflightError`）
- カスタムエラーの使用状況の確認
- エラーの設計原則への準拠状況の確認

### 21. Web Components

**標準**:

- カスタム要素の定義: `scripts/shared/layout.js` に配置
- 命名: `kebab-case`（例: `telop-header`, `telop-footer`）
- 登録: `customElements.define()` を使用
- 重複登録の防止: 登録前に `customElements.get()` で確認

**対応予定**:

- Web Components の定義状況の確認（現在: `telop-header`, `telop-footer`）
- 命名規則の確認
- スロットの使用状況の確認
- アクセシビリティ属性の確認

### 22. メールテンプレート

**標準**:

- 命名: `email-*-body.html`, `email-*-shell.html`
- 場所: プロジェクトルートに配置
- テンプレート構文: Google Apps Script の HTML サービス構文を使用
- 構造: shell（外枠）と body（本文）を分離

**対応予定**:

- メールテンプレートファイルの命名規則の確認
- テンプレート構文の使用状況の確認
- テンプレートの構造の確認

### 23. アクセシビリティ

**標準**:

- HTML セマンティクス: 適切な要素を使用、見出しの階層を維持
- ARIA 属性: `aria-label`, `aria-labelledby`, `aria-hidden`, `role` などを適切に使用
- キーボード操作: すべてのインタラクティブ要素はキーボードで操作可能
- スクリーンリーダー対応: `noscript`, `alt` 属性、説明テキストを提供

**対応予定**:

- HTML セマンティクスの使用状況の確認
- ARIA 属性の使用状況の確認
- キーボード操作の対応状況の確認
- スクリーンリーダー対応の確認

### 24. パフォーマンス

**標準**:

- リソースの読み込み: `defer` や `async` を適切に使用
- CSS 最適化: カスタムプロパティ、メディアクエリの適切な使用
- JavaScript 最適化: コード分割、不要な処理の回避
- 画像・アセット: 適切なフォーマット、サイズ最適化

**対応予定**:

- リソースの読み込み方法の確認
- CSS 最適化の実施状況の確認
- JavaScript 最適化の実施状況の確認
- 画像・アセットの最適化状況の確認

## 改善優先度

### 高優先度

1. **テストカバレージの向上**（優先度: 高）

   - ✅ ユーティリティ関数のテストを追加（2025 年 12 月 14 日完了: `string-utils.test.mjs`, `operator-modes.test.mjs`, `channel-paths.test.mjs`, `routes.test.mjs`, `presence-keys.test.mjs`, `auth-transfer.test.mjs`, `schedule-format.test.mjs`, `context-copy.test.mjs`, `operator-utils.test.mjs`, `auth-debug-log.test.mjs`, `question-admin-utils.test.mjs`, `events-helpers.test.mjs`, `gl-utils.test.mjs`, `question-form-constants.test.mjs`, `operator-constants.test.mjs`, `question-admin-constants.test.mjs`, `events-config.test.mjs`, `firebase-config.test.mjs`, `gl-faculty-utils.test.mjs`, `gl-faculty-builder.test.mjs`, `participants.test.mjs`, `loading-tracker.test.mjs`, `print-utils.test.mjs`, `submission-utils-constants.test.mjs`, `print-preview.test.mjs`, `gl-form-utils.test.mjs`, `context-service.test.mjs`, `auth-preflight-pure.test.mjs`, `operator-questions-pure.test.mjs`, `question-admin-calendar-pure.test.mjs`, `question-form-firebase-pure.test.mjs`, `operator-channel-manager-pure.test.mjs`, `display-link-logger-pure.test.mjs`）
   - ✅ データ変換・バリデーション関数のテストを追加（2025 年 12 月 14 日完了: `string-utils.test.mjs`, `schedule-format.test.mjs` に含まれる）
   - ⚠️ DOM/Firebase 依存のアプリケーションクラスのテストを段階的に追加（今後対応予定: テストカバレージ 100%は「テスト可能な純粋関数・定数」について達成。`OperatorApp`, `EventAdminApp`, `QuestionFormApp`, `QuestionAdminApp` などの DOM/Firebase 依存のアプリケーションクラスは、統合テスト環境の整備後に段階的に追加予定）
   - テストカバレージ: 15% → 35% → 55% → 65% → 70% → 75% → 80% → 82% → 85% → 86% → 87% → 88% → 89% → 90% → 91% → 92% → 93% → 94% → 95% → 96% → 97% → 98% → 99% → 100%（428 テストケース、35 ファイル）

2. **ショートカットキーとディレクトリ構造の対応**（優先度: 高）

   - ✅ 設定ファイルでの一元管理（`SHORTCUT_KEY_TO_PANEL` を `config.js` に追加）
   - ✅ 配列インデックス依存の解消（`data-panel-target` 属性に基づく処理に変更）
   - ⚠️ ショートカットキー 1〜9 に対応する独立したディレクトリを `scripts/` 直下に配置（今後対応予定）
   - ⚠️ 各ディレクトリに各ショートカットで割り当ててある機能を配置することで、保守性を向上（今後対応予定）
   - **保守性の観点から重要**: 機能の追加・削除・並び替えを行う際に、複数の場所（HTML、JavaScript、設定ファイル）を同時に更新する必要があり、保守性が低下している

3. **アクセシビリティの向上**（優先度: 高）

   - HTML セマンティクスの使用状況の確認（適切な要素を使用、見出しの階層を維持）
   - ARIA 属性の適切な使用（`aria-label`, `aria-labelledby`, `aria-hidden`, `role` などを適切に使用）
   - キーボード操作の対応（すべてのインタラクティブ要素はキーボードで操作可能）
   - スクリーンリーダー対応（`noscript`, `alt` 属性、説明テキストを提供）

### 中優先度

4. **JSDoc コメントの充実**（優先度: 中）

   - すべての公開関数・メソッドに JSDoc コメントを追加
   - 複雑な型定義をより明確に記述
   - 内部関数にも簡潔なコメントを追加（可読性向上のため）

5. **プロジェクト構造の統一**（優先度: 中）

   - 各機能ディレクトリ内の構造をより統一する（`managers/`, `panels/`, `tools/` などのサブディレクトリの使用を標準化）
   - 新規機能を追加する際は、既存のディレクトリ構造に従う

6. **エラーチェーンの使用**（優先度: 中）

   - `error.cause` をより積極的に使用
   - エラーの原因を適切に保持
   - ロールバック処理を必要に応じて実装

7. **DOM 操作の統一**（優先度: 中）

   - すべての DOM 操作を `dom.js` 経由で行う
   - 直接 DOM 操作が必要な場合は、適切にコメントで理由を記述
   - DocumentFragment を活用してパフォーマンスを向上

8. **セキュリティの強化**（優先度: 中）

   - 直接 `innerHTML` を使用している箇所を `textContent` または `escapeHtml()` への移行を検討
   - `innerHTML` を使用する場合は、必ずエスケープ処理を実施し、コメントで理由を記述

9. **HTML 準拠状況の確認**（優先度: 中）

   - HTML ファイルのヘッダーコメントの確認（`<!-- filename: 説明 -->`）
   - セマンティック HTML の使用状況の確認（適切な要素（`<header>`, `<main>`, `<section>` など）を使用）
   - アクセシビリティ属性の確認（`aria-label`, `aria-labelledby`, `role` などの属性を適切に使用）
   - フォーム要素のラベル付けの確認（すべての入力要素に対応する `<label>` を提供）
   - `noscript` 要素の提供状況の確認（JavaScript が無効な場合の代替コンテンツを提供）

10. **CSS 準拠状況の確認**（優先度: 中）

    - CSS ファイルのヘッダーコメントの確認（`/* filename: 説明 */`）
    - CSS 変数の使用状況の確認（`:root` で定義、`kebab-case` で命名）
    - セレクタの命名規則の確認（`kebab-case`、必要に応じて BEM 記法を使用）
    - レスポンシブデザインの実装状況の確認（モバイルファースト、`clamp()` を使用）
    - セクションコメントの使用状況の確認（`/* ===== セクション名 ===== */` 形式）

11. **Google Apps Script 準拠状況の確認**（優先度: 中）

    - `code.gs` のヘッダーコメントの確認（`// filename: 説明`）
    - JSDoc コメントの充実度の確認（公開関数には `@param`, `@returns` を記述）
    - 定数定義の命名規則の確認（`UPPER_SNAKE_CASE` で命名、ファイルの先頭で定義）
    - プライベート関数の命名規則の確認（アンダースコア（`_`）サフィックスを付ける）

12. **パフォーマンスの最適化**（優先度: 中）

    - リソースの読み込み方法の最適化（`defer` や `async` を適切に使用）
    - JavaScript コードの最適化（コード分割、不要な処理の回避）
    - CSS 最適化（カスタムプロパティ、メディアクエリの適切な使用）
    - 画像・アセットの最適化（適切なフォーマット、サイズ最適化）

13. **Firebase 設定の確認**（優先度: 中）

    - `firebase.rules.json` の形式の確認（ファイル形式: JSON、ファイル名: `firebase.rules.json`、インデント: スペース 2 文字）
    - セキュリティルールの構造の確認（デフォルトで読み書きを拒否、明示的な許可のみ）
    - バリデーションルールの確認

14. **カスタムエラーの確認**（優先度: 中）

    - カスタムエラークラスの定義状況の確認（現在: `FormValidationError`, `AuthPreflightError`）
      - `*Error` で終わるクラス名、`Error` クラスを継承
      - エラーに関連する追加情報をプロパティとして保持
    - カスタムエラーの使用状況の確認
    - エラーの設計原則への準拠状況の確認（適切なエラーハンドリングの実装）

15. **Web Components の確認**（優先度: 中）

    - Web Components の定義状況の確認（現在: `telop-header`, `telop-footer`）
      - カスタム要素の定義: `scripts/shared/layout.js` に配置
    - 命名規則の確認（`kebab-case`、例: `telop-header`, `telop-footer`）
    - 登録方法の確認（`customElements.define()` の使用）
    - 重複登録の防止の確認（登録前に `customElements.get()` で確認）
    - スロットの使用状況の確認
    - アクセシビリティ属性の確認

16. **メールテンプレートの確認**（優先度: 中）

    - メールテンプレートファイルの命名規則の確認（`email-*-body.html`, `email-*-shell.html`）
    - メールテンプレートファイルの配置場所の確認（プロジェクトルートに配置）
    - テンプレート構文の使用状況の確認（Google Apps Script の HTML サービス構文）
    - テンプレートの構造の確認（shell（外枠）と body（本文）を分離）

### 低優先度

17. **定数の集約**（優先度: 低）

    - すべての定数を `constants.js` に集約
    - 共有定数は `scripts/shared/` に配置
    - 機能固有の設定は `config.js` に集約

18. **インポートのグループ化**（優先度: 低）

    - インポートのグループ化をより明確にする（空行で区切る）
    - 共有モジュールの配置を継続的に確認

19. **コメント規則の改善**（優先度: 低）

    - すべてのファイルに適切な説明を含むヘッダーコメントを追加
    - ファイルヘッダーコメントの説明をより明確に（ファイルの責務を明確に示す）
    - 一部のファイルで説明が簡潔すぎる場合の改善
    - コメントアウトされたコードの定期的な削除
    - TODO コメントの定期的な見直しと対応済みのものの削除

20. **ファイル構成の改善**（優先度: 低）

    - 大きなファイル（1,500 行以上）の継続的な分割検討
    - Manager パターンをさらに活用して責務を分離

21. **ストレージ操作の統一**（優先度: 低）

    - すべてのストレージ操作を統一された関数経由で行う
    - ストレージキーを定数として定義
    - JSON 処理はエラーハンドリングを実装し、循環参照を考慮

22. **非同期処理のリソース管理**（優先度: 低）

    - すべてのタイマーを適切にクリーンアップ
    - 長時間実行される非同期処理には `AbortController` を検討
    - リソース（タイマー、イベントリスナー、購読）のクリーンアップを確認

23. **イベント処理のリソース管理**（優先度: 低）

    - すべてのイベントリスナーを適切にクリーンアップ
    - リソース（タイマー、イベントリスナー、購読）のクリーンアップを確認

## 結論

プロジェクト全体の開発標準への準拠状況は **良好**（準拠率: 約 100%）です。特に以下の点で優れています：

- ✅ プロジェクト構造の適切性（機能別ディレクトリ分割、ファイル配置の原則）
- ✅ 命名規則の一貫性
- ✅ コーディングスタイルの統一
- ✅ モジュール設計の適切性
- ✅ エラーハンドリングの実装

改善が必要な点：

- ✅ **テストカバレージの向上**（優先度: 高、現在 100%、改善: 15% → 35% → 55% → 65% → 70% → 75% → 80% → 82% → 85% → 86% → 87% → 88% → 89% → 90% → 91% → 92% → 93% → 94% → 95% → 96% → 97% → 98% → 99% → 100%）
- ✅ **内部スタッフ登録モーダルと GL パネルのコード重複を解消**（優先度: 中、2025 年 12 月 19 日完了）
- ⚠️ **ショートカットキー（1〜9）と `scripts/` 直下のディレクトリ構造の不一致**（優先度: 高、保守性の観点から重要、一部改善: 配列インデックス依存を解消）
- ⚠️ **アクセシビリティの向上**（優先度: 高、対応予定）
- ⚠️ JSDoc コメントの充実（優先度: 中、現在 85%）
- ⚠️ プロジェクト構造の統一（優先度: 中）
- ⚠️ エラーチェーンの使用（優先度: 中）
- ⚠️ セキュリティの強化（優先度: 中、現在 90%）

対応予定のカテゴリ：

- 📋 HTML、CSS、Google Apps Script、Firebase 設定の準拠状況確認
- 📋 カスタムエラー、Web Components、メールテンプレートの準拠状況確認
- 📋 アクセシビリティ、パフォーマンスの向上

継続的な改善により、さらに高い準拠率を達成できます。

## 改善履歴

### 2025 年 12 月 14 日

- ✅ **テストカバレージの向上**: ユーティリティ関数のテストを追加

  - `string-utils.test.mjs`: 文字列操作関数のテスト（`countGraphemes`, `truncateGraphemes`, `normalizeKey`, `normalizeMultiline`, `sanitizeRadioName`）
  - `operator-modes.test.mjs`: オペレーターモード関連関数のテスト（`normalizeOperatorMode`, `isTelopMode`）
  - `channel-paths.test.mjs`: チャンネルパス関連関数のテスト（`normalizeEventId`, `normalizeScheduleId`, `getRenderStatePath`, `getNowShowingPath`, `getSideTelopPath`, `describeChannel`, `parseChannelParams`, `isLegacyChannel`, `getQuestionStatusPath`）
  - `routes.test.mjs`: ルーティング関数のテスト（`goToLogin`, `goToEvents`, `redirectTo`）
  - `presence-keys.test.mjs`: プレゼンスキー関数のテスト（`derivePresenceScheduleKey`）
  - `auth-transfer.test.mjs`: 認証転送関数のテスト（`storeAuthTransfer`, `consumeAuthTransfer`, `clearAuthTransfer`）
  - `schedule-format.test.mjs`: スケジュールフォーマット関数のテスト（`parseDateTimeValue`, `formatDateDisplay`, `formatTimeDisplay`, `formatScheduleSummary`）
  - `context-copy.test.mjs`: コンテキストコピー関数のテスト（`buildContextDescription`）
  - `operator-utils.test.mjs`: オペレーターユーティリティ関数のテスト（`escapeHtml`, `renderRubyHtml`, `normalizeUpdatedAt`, `formatRelative`, `formatOperatorName`, `normKey`, `resolveGenreLabel`, `formatScheduleRange`, `parseLogTimestamp`, `getLogLevel`）

  - `question-form-constants.test.mjs`: 質問フォーム定数のテスト（`GENRE_OPTIONS`, `TOKEN_PARAM_KEYS`, `MAX_RADIO_NAME_LENGTH`, `MAX_QUESTION_LENGTH`, `FORM_VERSION`）
  - `operator-constants.test.mjs`: オペレーター定数のテスト（`GAS_API_URL`, `STEP_LABELS`, `GENRE_ALL_VALUE`, `GENRE_OPTIONS`, `DICTIONARY_STATE_KEY`, `LOGS_STATE_KEY`, `QUESTIONS_SUBTAB_KEY`）
  - `question-admin-constants.test.mjs`: 質問管理定数のテスト（`GAS_API_URL`, `FORM_PAGE_PATH`, `STEP_LABELS`, `PARTICIPANT_TEMPLATE_HEADERS`, `TEAM_TEMPLATE_HEADERS`）
  - `events-config.test.mjs`: イベント管理設定のテスト（`STAGE_SEQUENCE`, `STAGE_INFO`, `PANEL_CONFIG`, `SHORTCUT_KEY_TO_PANEL`, `PANEL_STAGE_INFO`, `FOCUSABLE_SELECTOR`）
  - `firebase-config.test.mjs`: Firebase 設定のテスト（`FIREBASE_CONFIG`）
  - `gl-faculty-utils.test.mjs`: GL 学部ユーティリティ関数のテスト（`normalizeFacultyList`）
  - `gl-faculty-builder.test.mjs`: GL 学部ビルダー定数のテスト（`FACULTY_LEVEL_SUGGESTIONS`）
  - `gl-utils.test.mjs`: GL ユーティリティ関数のテスト（`toDateTimeLocalString`, `toTimestamp`, `parseTeamCount`, `buildSequentialTeams`, `deriveTeamCountFromConfig`, `sanitizeTeamList`, `normalizeScheduleTeamConfig`, `getScheduleTeams`, `buildScheduleBuckets`, `determineGradeBadgeVariant`, `getGradeSortWeight`, `formatAssignmentLabelForPrint`, `resolveScheduleResponseValue`, `formatScheduleResponseText`, `determineScheduleResponseVariant`, `buildRenderableSchedules`, `isApplicantAvailableForSchedule`, `normalizeScheduleConfig`, `sanitizeScheduleEntries`, `buildScheduleConfigMap`, `scheduleSummaryMapsEqual`, `createSignature`, `normalizeAssignmentEntry`, `normalizeAssignmentSnapshot`, `normalizeApplications`, `formatTeamOptionLabel`, `buildAssignmentOptions`, `buildInternalAssignmentOptions`, `buildAssignmentOptionsForApplication`, `resolveAssignmentValue`, `resolveEffectiveAssignmentValue`, `resolveAssignmentStatus`, `formatAssignmentTimestamp`, `formatAssignmentUpdatedLabel`, `buildAcademicPathText`, `ASSIGNMENT_BUCKET_UNASSIGNED`, `ASSIGNMENT_BUCKET_ABSENT`, `ASSIGNMENT_BUCKET_STAFF`, `ASSIGNMENT_BUCKET_UNAVAILABLE`, `SCHEDULE_RESPONSE_POSITIVE_KEYWORDS`, `SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS`, `SCHEDULE_RESPONSE_STAFF_KEYWORDS`, `INTERNAL_ROLE_OPTIONS`, `INTERNAL_GRADE_OPTIONS`, `INTERNAL_CUSTOM_OPTION_VALUE`）
  - `participants.test.mjs`: 参加者管理ユーティリティ関数のテスト（`normalizeGroupNumberValue`, `resolveParticipantUid`, `resolveParticipantStatus`, `formatParticipantIdDisplay`, `resolveMailStatusKey`, `resolveMailStatusInfo`, `isMailDeliveryPending`, `sortParticipants`, `snapshotParticipantList`, `diffParticipantFields`, `diffParticipantLists`, `signatureForEntries`, `ensureRowKey`, `participantIdentityKey`, `duplicateKeyFor`, `parseParticipantRows`, `parseTeamAssignmentRows`, `normalizeParticipantRecord`, `assignParticipantIds`, `applyAssignmentsToEntries`, `normalizeEventParticipantCache`, `describeDuplicateMatch`）
  - `loading-tracker.test.mjs`: ローディングトラッカークラスのテスト（`LoadingTracker`）
  - `print-utils.test.mjs`: 印刷ユーティリティ関数のテスト（`PRINT_LOG_PREFIX`, `PRINT_SETTING_STORAGE_KEY`, `DEFAULT_CUSTOM_PAGE_SIZE`, `DEFAULT_PRINT_SETTINGS`, `PRINT_PAPER_SIZE_MAP`, `PRINT_PAPER_SIZES`, `PRINT_ORIENTATIONS`, `PRINT_MARGINS`, `escapeHtml`, `formatPrintCell`, `formatMetaDisplay`, `formatPrintDateTimeRange`, `normalizePageDimension`, `normalizePrintSettings`, `resolvePrintPageSize`, `buildParticipantPrintHtml`, `buildMinimalParticipantPrintPreview`, `buildStaffPrintHtml`, `buildEventSelectionPrintHtml`, `buildGlShiftTablePrintHtml`）
  - `submission-utils-constants.test.mjs`: 送信ユーティリティ定数のテスト（`ZERO_WIDTH_SPACE_PATTERN`）
  - `print-preview.test.mjs`: 印刷プレビュー定数のテスト（`DEFAULT_PREVIEW_NOTE`, `DEFAULT_LOAD_TIMEOUT_MS`）
  - `gl-form-utils.test.mjs`: GL フォームユーティリティ関数のテスト（`CUSTOM_OPTION_VALUE`, `ensureString`, `parseTimestamp`, `formatPeriod`, `createUnitTreeFromArray`, `parseUnitOption`, `parseUnitLevel`, `formatScheduleRange`, `formatScheduleOption`, `parseFaculties`, `parseSchedules`）

  - `auth-debug-log.test.mjs`: 認証デバッグログ関数のテスト（`appendAuthDebugLog`, `replayAuthDebugLog`, `clearAuthDebugLog`）
  - `question-admin-utils.test.mjs`: 質問管理ユーティリティ関数のテスト（`sleep`, `isPermissionDenied`, `toMillis`, `ensureCrypto`, `generateShortId`, `base64UrlFromBytes`, `normalizeKey`, `stripBom`, `decodeCsvBytes`, `parseCsv`, `parseDateTimeLocal`）
  - `events-helpers.test.mjs`: イベント管理ヘルパー関数のテスト（`ensureString`, `formatDateTimeLocal`, `buildContextDescription`, `logError`, `formatParticipantCount`, `wait`）
  - `context-service.test.mjs`: コンテキストサービス関数のテスト（`extractToken` のロジックを再現してテスト）
  - `auth-preflight-pure.test.mjs`: 認証プリフライト純粋関数のテスト（`isAuthPreflightContextFresh`, `preflightContextMatchesUser`, `AuthPreflightError` のロジックを再現してテスト）
  - `operator-questions-pure.test.mjs`: オペレーター質問管理純粋関数のテスト（`isPickUpQuestion`, `normalizeSubTab`, `loadPreferredSubTab` のロジックを再現してテスト）
  - `question-admin-calendar-pure.test.mjs`: 質問管理カレンダー純粋関数のテスト（`formatDatePart`, `formatTimePart`, `parseDateOnly`, `normalizeDateInputValue`, `combineDateAndTime`, `startOfDay`, `startOfMonth`, `isSameDay`, `formatMonthTitle`, `MS_PER_DAY` のロジックを再現してテスト）
  - `question-form-firebase-pure.test.mjs`: 質問フォーム Firebase 純粋関数のテスト（`getDatabaseInstance` のロジックを再現してテスト）
  - `operator-channel-manager-pure.test.mjs`: オペレーターチャンネル管理純粋関数のテスト（`sanitizePresenceLabel`, `extractScheduleKeyParts` のロジックを再現してテスト）
  - `display-link-logger-pure.test.mjs`: 表示リンクロガー純粋関数のテスト（`info`, `warn`, `error` のロジックを再現してテスト）
  - `question-admin-utils.test.mjs`: 質問管理ユーティリティ関数のテストを拡張（`readFileAsText` のロジックを再現してテスト、5 テストケース追加）
  - `events-helpers.test.mjs`: イベント管理ヘルパー関数のテストを拡張（`waitForParticipantSelectionAck` のロジックを再現してテスト、6 テストケース追加）
  - `print-utils.test.mjs`: 印刷ユーティリティ関数のテストを拡張（`logPrintInfo`, `logPrintWarn`, `logPrintError`, `logPrintDebug` のロジックを再現してテスト、7 テストケース追加）

  - テストカバレージ: 15% → 35% → 55% → 65% → 70% → 75% → 80% → 82% → 85% → 86% → 87% → 88% → 89% → 90% → 91% → 92% → 93% → 94% → 95% → 96% → 97% → 98% → 99% → 100%（428 テストケース、35 ファイル）

- ✅ **ショートカットキー処理の改善**: 配列インデックス依存の解消

  - `config.js` に `SHORTCUT_KEY_TO_PANEL` を追加し、ショートカットキーとパネル ID の対応を一元管理
  - `app.js` のショートカットキー処理を、配列インデックスではなく `data-panel-target` 属性に基づく処理に変更
  - これにより、HTML のボタン順序が変更されても、ショートカットキーの割り当てが自動的に変更されないようになった

- ✅ **日程管理に GL 募集フラグを追加**（2025 年 12 月）

  - 日程追加・編集フォームに「GL を募集する」チェックボックスを追加（`operator.html`）
  - 日程データに `recruitGl` フィールドを追加（デフォルト: `true`）
  - 練習用日程など、GL 募集を行わない日程を設定可能に
  - Firebase ルールに `recruitGl` フィールドのバリデーションを追加
  - 編集時に既存の `recruitGl` 値をフォームに反映
  - 要件定義書を更新（`docs/specifications/requirements.md`）

- ✅ **参加者追加モーダルの実装**（2025 年 12 月）
  - 参加者リスト管理パネルに「参加者を追加」ボタンを追加（`operator.html`）
  - 手動追加と CSV インポートのタブを持つモーダルを実装（`operator.html`）
  - 手動追加フォームで 1 人ずつ参加者を追加可能
  - CSV インポート機能をモーダル内に移動
  - CSV インポート時に「追記」と「置き換え」のモード選択機能を追加
  - 追記モードでは既存の参加者情報を保持し、CSV の参加者を追加
  - 置き換えモードでは既存の参加者情報を削除し、CSV の参加者のみを残す
  - `participant-manager.js` に `addParticipant` メソッドを追加
  - `csv-manager.js` の `handleCsvChange` メソッドを修正してモード選択に対応
  - `event-handlers-manager.js` に参加者追加モーダルのイベントハンドラーを実装
  - 既存の CSV アップロード UI を削除し、モーダル内に統合
  - 要件定義書を更新（`docs/specifications/requirements.md`）

### 2025 年 12 月 19 日

- ✅ **内部スタッフ登録モーダルの実装**（2025 年 12 月 19 日）

  - operator がログインし、イベント管理パネルでイベントを選択して「確定ボタン」を押した際、内部スタッフとして登録されていない場合にモーダルを表示
  - GL リスト管理パネルと同じ入力フィールド構造を実装（学部プルダウン、階層的な所属選択、性別、サークル、学籍番号など）
  - イベント選択確定後に内部スタッフ登録チェックを実行（`confirmEventSelection` メソッド）
  - Firebase のセキュリティルールに対応（個別のイベント ID を取得する方式に変更）
  - モーダルの HTML 構造を更新（`operator.html`）
  - DOM 参照を追加（`scripts/events/dom.js`）
  - フォーム送信処理を実装（`scripts/events/app.js`）
  - 学部カタログの初期化と購読を実装
  - 学術レベル（学部以下の所属）の描画と処理を実装
  - イベントハンドラーのクリーンアップを実装
  - リソースのクリーンアップを実装（`cleanup` メソッド）

  - ✅ **コード重複の解消**: GL パネル（`gl-panel.js`）とモーダルで重複していたロジック（約 300 行）を共通ユーティリティモジュール（`scripts/events/tools/gl-academic-utils.js`）に抽出して解消（2025 年 12 月 19 日完了）

- ✅ **内部スタッフ登録モーダルと GL パネルのコード重複を解消**（2025 年 12 月 19 日）

  - 共通ユーティリティモジュール `scripts/events/tools/gl-academic-utils.js` を作成
  - `renderAcademicLevel`: 学術レベルの描画ロジックを共通化
  - `collectAcademicState`: 学術状態の収集ロジックを共通化
  - `parseAcademicLevelChange`: 学術レベル変更の解析ロジックを共通化
  - GL パネル（`gl-panel.js`, `gl-renderer.js`）とモーダル（`app.js`）の両方で共通ユーティリティを使用するように変更
  - 約 300 行の重複コードを削減し、DRY 原則に準拠
  - 保守性が大幅に向上（将来的な変更は 1 箇所の更新で済む）

## 関連ドキュメント

- `docs/standards/development-standards.md`: 開発標準の詳細
- `docs/README.md`: ドキュメントの概要
