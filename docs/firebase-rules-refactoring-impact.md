# Firebase ルール変更の影響範囲分析

## 概要

このドキュメントは、`firebase.rules.json`の構造を改善する際に影響を受けるコードの一覧です。
主な変更内容：

1. レガシーパスの削除（`render/state`, `render/session`など）
2. 新規パスへの統一（`render/events/$eventId/$scheduleId/...`）
3. 重複したバリデーションルールの削減
4. データ同期の問題の解決

## 影響を受けるパス一覧

### 1. レンダリング状態パス

#### レガシーパス（削除対象）

- `render/state`
- `render/state/nowShowing`
- `render/state/sideTelops`

#### 新規パス（統一先）

- `render/events/$eventId/$scheduleId/state`
- `render/events/$eventId/$scheduleId/nowShowing`
- `render/events/$eventId/$scheduleId/sideTelops`

#### 影響を受けるファイル

| ファイル                          | 行番号                          | 影響内容                           | 修正が必要な箇所                                     |
| --------------------------------- | ------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `scripts/shared/channel-paths.js` | 2-3, 40-47, 55-61, 69-75, 83-89 | レガシーパスへのフォールバック処理 | `LEGACY_RENDER_BASE`の削除、フォールバック処理の削除 |
| `scripts/operator/firebase.js`    | 50-52, 73-76, 78-81, 83-86      | レガシー参照の定義                 | `LEGACY_*_REF`の削除、フォールバック処理の削除       |
| `scripts/operator/app.js`         | 1310                            | `getRenderStatePath`の使用         | フォールバック処理が不要になる                       |
| `display.html`                    | 598, 657-659                    | レンダリングパスの参照             | フォールバック処理の削除                             |

### 2. セッション情報パス

#### レガシーパス（削除対象）

- `render/session` (単一セッション)
- `screens/sessions/$uid` (別の場所)

#### 新規パス（統一先）

- `render/events/$eventId/sessions/$uid` (複数セッション対応)

#### 影響を受けるファイル

| ファイル                       | 行番号                  | 影響内容                           | 修正が必要な箇所                                     |
| ------------------------------ | ----------------------- | ---------------------------------- | ---------------------------------------------------- |
| `scripts/operator/firebase.js` | 53                      | `displaySessionRef`の定義          | レガシーパス参照の削除                               |
| `scripts/operator/app.js`      | 4479-4481, 4536-4562    | セッション監視のフォールバック処理 | レガシーパスへのフォールバック削除、新規パスのみ使用 |
| `scripts/operator/app.js`      | 4876-4882               | セッション TTL 延長処理            | レガシーパスへのフォールバック削除                   |
| `display.html`                 | 663-669                 | セッションパスの設定               | レガシーパスへのフォールバック削除                   |
| `code.gs`                      | 3682-3690               | セッションパス生成関数             | レガシーパスへのフォールバック削除                   |
| `firebase.rules.json`          | 63-92, 141-144, 735-766 | セッション関連のルール定義         | レガシーパスのルール削除、新規パスのルールのみ残す   |

### 3. questionStatus パス

#### レガシーパス（削除対象）

- `questionStatus/$uid` (グローバル、イベント非依存)

#### 新規パス（統一先）

- `questionStatus/$eventId/$uid` (イベントごとに分離)

#### 影響を受けるファイル

| ファイル                                      | 行番号    | 影響内容                             | 修正が必要な箇所                             |
| --------------------------------------------- | --------- | ------------------------------------ | -------------------------------------------- |
| `scripts/operator/firebase.js`                | 58        | `questionStatusRef`の定義            | レガシーパス参照の削除（非推奨コメントあり） |
| `scripts/operator/app.js`                     | 3875-3884 | 初期ロード時の questionStatus 取得   | レガシーパスからの取得削除                   |
| `scripts/question-form/submission-service.js` | 179-184   | 質問送信時の questionStatus 書き込み | 既に新規パスを使用（問題なし）               |
| `scripts/question-admin/app.js`               | 5922-6040 | 質問管理での questionStatus 取得     | レガシーパスからの取得削除、新規パスに統一   |
| `code.gs`                                     | 5260      | 質問処理時の questionStatus 書き込み | 既に新規パスを使用（問題なし）               |
| `firebase.rules.json`                         | 507-531   | questionStatus のルール定義          | レガシーパスのルール削除                     |

### 4. displayPresence パス

#### 現在のパス（変更なし）

- `render/displayPresence/$uid`

#### 影響を受けるファイル

| ファイル                       | 行番号      | 影響内容                     | 修正が必要な箇所               |
| ------------------------------ | ----------- | ---------------------------- | ------------------------------ |
| `scripts/operator/firebase.js` | 54, 105-111 | displayPresence 参照の定義   | 変更不要（既に統一されている） |
| `scripts/operator/app.js`      | 4668-4674   | displayPresence 監視         | 変更不要                       |
| `firebase.rules.json`          | 145-167     | displayPresence のルール定義 | 変更不要（既に統一されている） |

### 5. questions パス

#### 現在のパス（変更なし）

- `questions/normal/$uid`
- `questions/pickup/$uid`

#### 影響を受けるファイル

| ファイル                                      | 行番号         | 影響内容                 | 修正が必要な箇所 |
| --------------------------------------------- | -------------- | ------------------------ | ---------------- |
| `scripts/operator/firebase.js`                | 55-56          | questions 参照の定義     | 変更不要         |
| `scripts/operator/app.js`                     | 2644-2785      | questions ストリーム処理 | 変更不要         |
| `scripts/operator/pickup.js`                  | 847, 964, 1090 | pickup 質問の書き込み    | 変更不要         |
| `scripts/question-form/submission-service.js` | 189            | 質問の書き込み           | 変更不要         |
| `code.gs`                                     | 5255           | 質問の書き込み           | 変更不要         |
| `firebase.rules.json`                         | 469-504        | questions のルール定義   | 変更不要         |

## 修正が必要なコードの詳細

### 1. `scripts/shared/channel-paths.js`

#### 削除が必要な定数

```javascript
const LEGACY_RENDER_BASE = "render/state";
const LEGACY_NOW_SHOWING_PATH = `${LEGACY_RENDER_BASE}/nowShowing`;
```

#### 修正が必要な関数

- `buildEventScheduleBase()`: レガシーパスへのフォールバックを削除
- `getRenderStatePath()`: 常に新規パスを返すように変更
- `getNowShowingPath()`: 常に新規パスを返すように変更
- `getSideTelopPath()`: 常に新規パスを返すように変更
- `isLegacyChannel()`: 削除（不要になる）

### 2. `scripts/operator/firebase.js`

#### 削除が必要な定数

```javascript
const LEGACY_RENDER_REF = ref(database, "render/state");
const LEGACY_NOW_SHOWING_REF = ref(database, "render/state/nowShowing");
const LEGACY_SIDE_TELOP_REF = ref(database, "render/state/sideTelops");
export const displaySessionRef = ref(database, "render/session");
export const questionStatusRef = ref(database, "questionStatus");
```

#### 修正が必要な関数

- `getRenderRef()`: レガシー参照へのフォールバックを削除
- `getNowShowingRef()`: レガシー参照へのフォールバックを削除
- `getSideTelopsRef()`: レガシー参照へのフォールバックを削除

### 3. `scripts/operator/app.js`

#### 修正が必要なメソッド

- `startDisplaySessionMonitor()` (line 4475-4661):

  - レガシーパス `render/session` へのフォールバックを削除
  - 常に `render/events/$eventId/sessions` を使用
  - 単一セッション形式の処理を削除（line 4536-4562）

- `refreshDisplaySessionTTL()` (line 4836-4888):

  - レガシーパスへのフォールバックを削除
  - 常に新規パスを使用

- `loadInitialData()` (line 3875-3884):
  - `questionStatusRef`（レガシー）からの取得を削除
  - イベントごとの questionStatus のみ使用

### 4. `display.html`

#### 修正が必要な関数

- `setChannel()` (line 645-675):
  - レガシーパス `render/session` へのフォールバックを削除 (line 665-669)
  - 常に `render/events/$eventId/sessions/$uid` を使用

### 5. `code.gs`

#### 修正が必要な関数

- `getRenderStatePath_()` (line 3662-3665):

  - レガシーパス `render/state` へのフォールバックを削除
  - eventId/scheduleId が必須になるため、空の場合はエラーを返すか、デフォルト値を設定

- `getNowShowingPath_()` (line 3667-3670):

  - レガシーパス `render/state/nowShowing` へのフォールバックを削除
  - eventId/scheduleId が必須になるため、空の場合はエラーを返すか、デフォルト値を設定

- `getEventSessionPath_()` (line 3682-3690):
  - eventId が空の場合はエラーを返すように変更（レガシーパスへのフォールバックを削除）
  - 常に新規パス `render/events/$eventId/sessions/$uid` を返すように変更

#### 修正が必要な関数（screens/sessions への書き込み）

以下の関数で `screens/sessions/$uid` への書き込みを行っているため、全て `render/events/$eventId/sessions/$uid` に変更する必要があります：

- `beginDisplaySession_()` (line 3898, 3930, 3976):

  - `screens/sessions/${principalUid}` への書き込みを削除
  - `render/events/$eventId/sessions/$uid` に書き込むように変更

- `refreshDisplaySession_()` (line 3995, 4028, 4050, 4073):

  - `screens/sessions/${currentUid}` への書き込みを削除
  - `render/events/$eventId/sessions/$uid` に書き込むように変更

- `endDisplaySession_()` (line 4083, 4125):

  - `screens/sessions/${principalUid}` への書き込みを削除
  - `render/events/$eventId/sessions/$uid` に書き込むように変更

- `rotateDisplaySession_()` (line 4248):
  - `screens/sessions/${uid}` への書き込みを削除
  - `render/events/$eventId/sessions/$uid` に書き込むように変更

**注意**: これらの関数では、eventId を取得する必要があります。セッションデータや assignment から eventId を取得する処理を追加する必要があります。

### 6. `scripts/question-admin/app.js`

#### 修正が必要な箇所

- `loadInitialData()` (line 5901-6040):
  - レガシーパス `questionStatus` からの取得を削除 (line 5922-5927)
  - イベントごとの questionStatus のみ使用

### 7. `firebase.rules.json`

#### 削除が必要なルール

1. **レガシーレンダリング状態** (line 6-22):

   - `render/state` のルール全体を削除

2. **レガシーセッション** (line 63-92, 141-144):

   - `render/events/$eventId/session` (単一セッション) のルールを削除
   - `render/session` のルールを削除

3. **screens/sessions** (line 728-767):

   - `screens/sessions/$uid` のルール全体を削除（`render/events/$eventId/sessions/$uid`に統一）

4. **レガシー questionStatus** (line 507-509):
   - グローバルな `questionStatus` のルールを削除（イベントごとのルールのみ残す）

#### 簡素化が必要なルール

1. **セッションのバリデーション** (line 31, 66, 739):

   - 3 箇所に重複している長いバリデーション式を共通化
   - 同じ構造の `assignment` オブジェクトのバリデーションも共通化

2. **nowShowing のバリデーション** (line 15-21, 102-108, 129-136):
   - 3 箇所に重複しているバリデーションを共通化

## データ移行が必要な箇所

### 1. レンダリング状態の移行

- `render/state` → `render/events/$eventId/$scheduleId/state`
- `render/state/nowShowing` → `render/events/$eventId/$scheduleId/nowShowing`
- `render/state/sideTelops` → `render/events/$eventId/$scheduleId/sideTelops`

**注意**: レガシーパスには eventId/scheduleId 情報がないため、既存データから推測する必要がある。

### 2. セッション情報の移行

- `render/session` → `render/events/$eventId/sessions/$uid`
- `screens/sessions/$uid` → `render/events/$eventId/sessions/$uid`

**注意**: セッションデータに eventId 情報が含まれているか確認が必要。

### 3. questionStatus の移行

- `questionStatus/$uid` → `questionStatus/$eventId/$uid`

**注意**: 質問データから eventId を取得して移行する必要がある。

## 移行手順

### フェーズ 1: コード修正（新規パスのみ使用）

1. レガシーパスへのフォールバック処理を削除
2. 新規パスのみを使用するようにコードを修正
3. テストを実施

### フェーズ 2: データ移行

1. **移行スクリプトの実行**:
   - `code.gs`に`migrateLegacyPaths_`関数が追加されました
   - API エンドポイント: `action: "migrateLegacyPaths"`（`dryRun`パラメータでドライラン/実実行を切り替え）
   - まず`dryRun: true`で実行し、移行計画を確認
   - 問題がなければ`dryRun: false`で実際の移行を実行
2. 移行完了を確認

### フェーズ 3: ルールファイルの簡素化

1. レガシーパスのルールを削除
2. 重複したバリデーションルールを共通化
3. ルールファイルを簡素化

### フェーズ 4: レガシーパスの削除

1. レガシーパスのデータを削除
2. 最終確認

## 注意事項

1. **後方互換性の破壊**: レガシーパスを削除すると、古いクライアントが動作しなくなる可能性があります。移行期間中は両方のパスをサポートする必要があるかもしれません。

2. **eventId/scheduleId の必須化**: 新規パスでは eventId と scheduleId が必須になります。これらが不明な場合の処理を検討する必要があります。

3. **データの整合性**: 移行中にデータが不整合になる可能性があるため、移行スクリプトのテストを十分に行う必要があります。

4. **パフォーマンス**: 新規パスはイベント/スケジュールごとに分離されているため、クエリのパフォーマンスが向上する可能性があります。

## 影響を受けるファイルの一覧

### 修正が必要なファイル（優先度順）

| 優先度 | ファイル                          | 影響箇所数 | 主な変更内容                                     |
| ------ | --------------------------------- | ---------- | ------------------------------------------------ |
| 高     | `scripts/shared/channel-paths.js` | 5 箇所     | レガシーパスへのフォールバック削除               |
| 高     | `scripts/operator/firebase.js`    | 8 箇所     | レガシー参照の削除、フォールバック削除           |
| 高     | `scripts/operator/app.js`         | 3 箇所     | セッション監視、questionStatus 取得の修正        |
| 高     | `display.html`                    | 2 箇所     | セッションパスの設定修正                         |
| 高     | `code.gs`                         | 10 箇所    | セッション書き込みパスの変更、パス生成関数の修正 |
| 中     | `scripts/question-admin/app.js`   | 1 箇所     | questionStatus 取得の修正                        |
| 低     | `firebase.rules.json`             | 全体       | レガシーパスのルール削除、重複ルールの共通化     |

### 変更不要なファイル

以下のファイルは既に新規パスを使用しているため、変更不要です：

- `scripts/question-form/submission-service.js`: 既に新規パスを使用
- `scripts/operator/questions.js`: 既に新規パスを使用
- `scripts/operator/pickup.js`: 既に新規パスを使用
- `scripts/operator/dialog.js`: 既に新規パスを使用

## 修正作業のチェックリスト

### フェーズ 1: コード修正（完了）

- [x] `scripts/shared/channel-paths.js`の修正

  - [x] `LEGACY_RENDER_BASE`定数の削除
  - [x] `buildEventScheduleBase()`のフォールバック削除
  - [x] `getRenderStatePath()`のフォールバック削除
  - [x] `getNowShowingPath()`のフォールバック削除
  - [x] `getSideTelopPath()`のフォールバック削除
  - [x] `isLegacyChannel()`関数の削除

- [x] `scripts/operator/firebase.js`の修正

  - [x] `LEGACY_*_REF`定数の削除
  - [x] `displaySessionRef`の削除
  - [x] `questionStatusRef`の削除
  - [x] `getRenderRef()`のフォールバック削除
  - [x] `getNowShowingRef()`のフォールバック削除
  - [x] `getSideTelopsRef()`のフォールバック削除

- [x] `scripts/operator/app.js`の修正

  - [x] `startDisplaySessionMonitor()`のレガシーパス処理削除
  - [x] `refreshDisplaySessionTTL()`のレガシーパス処理削除
  - [x] `loadInitialData()`のレガシー questionStatus 取得削除

- [x] `display.html`の修正

  - [x] `setChannel()`のレガシーパス処理削除
  - [x] `beginDisplaySession()`の`screens/sessions`書き込み削除
  - [x] `heartbeatDisplaySession()`の`screens/sessions`書き込み削除
  - [x] `endDisplaySession()`の`screens/sessions`書き込み削除

- [x] `code.gs`の修正

  - [x] `getRenderStatePath_()`のフォールバック削除
  - [x] `getNowShowingPath_()`のフォールバック削除
  - [x] `getEventSessionPath_()`のフォールバック削除
  - [x] `beginDisplaySession_()`の`screens/sessions`書き込み削除
  - [x] `heartbeatDisplaySession_()`の`screens/sessions`書き込み削除
  - [x] `endDisplaySession_()`の`screens/sessions`書き込み削除
  - [x] `lockDisplaySchedule_()`の`screens/sessions`書き込み削除

- [x] `scripts/question-admin/app.js`の修正
  - [x] `loadInitialData()`のレガシー questionStatus 取得削除

### フェーズ 2: データ移行（完了）

- [x] レンダリング状態の移行スクリプト作成（`migrateLegacyPaths_`関数に実装済み）
- [x] セッション情報の移行スクリプト作成（`migrateLegacyPaths_`関数に実装済み）
- [x] questionStatus の移行スクリプト作成（`migrateLegacyPaths_`関数に実装済み）
- [x] 移行スクリプトのテスト（ドライラン実行）
- [x] 本番環境での移行実行（`dryRun: false`で実行）

**移行スクリプトの使用方法**:

- API エンドポイント: `action: "migrateLegacyPaths"`
- パラメータ: `{ dryRun: true }`（ドライラン）または `{ dryRun: false }`（実実行）
- 戻り値: 移行結果のサマリー（移行件数、スキップ件数、エラー一覧）

### フェーズ 3: ルールファイルの簡素化（完了）

- [x] `firebase.rules.json`からレガシーパスのルール削除
  - [x] `render/state` のルール削除
  - [x] `render/events/$eventId/session`（単一セッション）のルール削除
  - [x] `render/session` のルール削除
  - [x] `screens/sessions/$uid` のルール削除
  - [x] グローバルな `questionStatus` のルール削除
- [x] 重複したバリデーションルールの削除（レガシーパス削除により自動的に簡素化）
- [x] ルールファイルの JSON 構文検証

### フェーズ 4: レガシーパスの削除（完了）

- [x] レガシーパスのデータ削除
- [x] 最終確認

## 関連ドキュメント

- `scripts/shared/channel-paths.js`: パス生成ロジックの実装

## 現在のステータス

### 完了した作業

1. **コード修正**: すべてのレガシーパスへのフォールバック処理を削除し、新規パスのみを使用するように修正しました。
2. **ルールファイルの簡素化**: `firebase.rules.json`からレガシーパスのルールを削除しました。
3. **データ移行スクリプト**: `migrateLegacyPaths_`関数を作成し、レガシーパスのデータを新規パスに移行できるようにしました。
4. **データ移行**: 移行スクリプトを実行して、既存のレガシーパスのデータを新規パスに移行しました。
5. **レガシーパスの削除**: 移行完了後、レガシーパスのデータを削除しました。

### リファクタリング完了

すべてのフェーズが完了し、Firebase Realtime Database のパス構造のリファクタリングが完了しました。システムは現在、イベントスコープパス（`render/events/<event>/<schedule>/...`, `render/events/<event>/sessions/<uid>`, `questionStatus/<event>/<uid>`）のみを使用しています。

### 関連ドキュメント

- `docs/operator-shared-storage-and-fallback.md`: 共有ストレージの一覧とフォールバック処理の説明（更新済み）
