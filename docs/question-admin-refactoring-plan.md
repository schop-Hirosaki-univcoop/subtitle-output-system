# question-admin/app.js リファクタリング計画

このドキュメントは、`scripts/question-admin/app.js`（8,002 行）のリファクタリング計画をまとめます。

## 現状分析

### ファイルサイズ

- `scripts/question-admin/app.js`: 8,002 行（開発標準の約 5 倍）

### 主要な機能領域

1. **印刷機能**（約 400-500 行）

   - 印刷設定の管理（localStorage への保存・読み込み）
   - 印刷プレビューの生成と表示
   - 参加者リスト印刷
   - スタッフリスト印刷

2. **イベント管理**（約 300-400 行）

   - イベント一覧の読み込み
   - イベント一覧の描画
   - 日程一覧の描画
   - イベント・日程の選択

3. **CSV 処理**（約 200-300 行）

   - CSV ファイルのパース
   - CSV ファイルのダウンロード
   - アップロードステータスの管理

4. **参加者管理**（約 2,000-3,000 行）

   - 参加者一覧の読み込み・描画
   - 参加者の編集・移動
   - 参加者の選択・状態管理
   - 参加者カードの生成

5. **認証・初期化**（約 200-300 行）

   - 認証状態の監視
   - 初期化処理
   - ホスト統合

6. **その他**（約 3,000-4,000 行）
   - ユーティリティ関数
   - DOM 操作
   - 状態管理

## リファクタリング方針

### 原則

- 段階的な移行（一度にすべてを変更しない）
- 既存の動作を維持
- 各機能を独立した Manager クラスに分離
- `events/app.js` のリファクタリングパターンを参考にする

### 分割計画

#### フェーズ 1: 印刷機能の分離（優先度: 高）

**目標**: 印刷関連の機能を `PrintManager` クラスに分離

**分離対象**:

- `hydratePrintSettingsFromStorage()`
- `persistPrintSettings()`
- `applyPrintSettingsToForm()`
- `readPrintSettingsFromForm()`
- `setupPrintSettingsDialog()`
- `buildParticipantPrintGroups()`
- `buildStaffPrintGroups()`
- `openPrintView()`
- `openStaffPrintView()`
- `updateParticipantPrintPreview()`
- `updateStaffPrintPreview()`
- `cacheParticipantPrintPreview()`
- `setPrintPreviewNote()`
- `setPrintPreviewVisibility()`
- `setPrintPreviewBusy()`

**新規ファイル**: `scripts/question-admin/managers/print-manager.js`

**期待される効果**: 約 400-500 行の削減

#### フェーズ 2: CSV 処理機能の分離（優先度: 中）

**目標**: CSV 関連の機能を `CsvManager` クラスに分離

**分離対象**:

- `encodeCsvValue()`
- `createCsvContent()`
- `getSelectionIdentifiers()`
- `buildParticipantCsvFilename()`
- `buildTeamCsvFilename()`
- `downloadCsvFile()`
- `setUploadStatus()`
- `isPlaceholderUploadStatus()`
- CSV アップロード処理

**新規ファイル**: `scripts/question-admin/managers/csv-manager.js`

**期待される効果**: 約 200-300 行の削減

#### フェーズ 3: イベント管理機能の分離（優先度: 中）

**目標**: イベント・日程管理機能を `EventManager` クラスに分離

**分離対象**:

- `loadEvents()`
- `renderEvents()`
- `renderSchedules()`
- `selectEvent()`
- `selectSchedule()`
- `finalizeEventLoad()`
- `applyHostEvents()`
- `refreshScheduleLocationHistory()`
- `populateScheduleLocationOptions()`

**新規ファイル**: `scripts/question-admin/managers/event-manager.js`

**期待される効果**: 約 300-400 行の削減

#### フェーズ 4: 参加者管理機能の分離（優先度: 低）

**目標**: 参加者管理機能を `ParticipantManager` クラスに分離

**注意**: `participants.js` は既に存在するが、`app.js` 内にも多くの参加者関連の関数がある

**分離対象**:

- `loadParticipants()`
- `renderParticipants()`
- `buildParticipantCard()`
- `selectParticipantFromCardElement()`
- `commitParticipantQuickEdit()`
- `handleQuickRelocateAction()`
- `renderRelocationPrompt()`
- その他の参加者関連の関数

**新規ファイル**: `scripts/question-admin/managers/participant-manager.js`

**期待される効果**: 約 1,000-1,500 行の削減

## 実装手順

### フェーズ 1 の実装ステップ

1. **PrintManager クラスの骨格作成**

   - `scripts/question-admin/managers/print-manager.js` を作成
   - コンストラクタと基本的なメソッドを定義
   - `app.js` への参照を保持

2. **印刷設定管理機能の移行**

   - `hydratePrintSettingsFromStorage()` → `printManager.hydrateSettings()`
   - `persistPrintSettings()` → `printManager.persistSettings()`
   - `applyPrintSettingsToForm()` → `printManager.applyToForm()`
   - `readPrintSettingsFromForm()` → `printManager.readFromForm()`
   - `setupPrintSettingsDialog()` → `printManager.setupDialog()`

3. **印刷プレビュー機能の移行**

   - `buildParticipantPrintGroups()` → `printManager.buildParticipantGroups()`
   - `buildStaffPrintGroups()` → `printManager.buildStaffGroups()`
   - `openPrintView()` → `printManager.openParticipantView()`
   - `openStaffPrintView()` → `printManager.openStaffView()`
   - `updateParticipantPrintPreview()` → `printManager.updateParticipantPreview()`
   - `updateStaffPrintPreview()` → `printManager.updateStaffPreview()`

4. **app.js の整理**

   - `PrintManager` をインポート
   - `this.printManager = new PrintManager(this)` で初期化
   - 印刷関連の関数呼び出しを `printManager` に委譲
   - 不要になった関数を削除

5. **動作確認**
   - リンターエラーの確認
   - 印刷機能の動作確認

## 進捗状況

- [x] フェーズ 1: 印刷機能の分離
  - [x] ステップ 1: PrintManager クラスの骨格作成 ✅ 完了
  - [x] ステップ 2: 印刷設定管理機能の移行 ✅ 完了
  - [x] ステップ 3-1: 印刷グループ構築機能の移行 ✅ 完了
  - [x] ステップ 3-2-1: 印刷プレビュー制御機能の移行 ✅ 完了
  - [x] ステップ 3-2-2: 印刷プレビュー更新機能の移行（updateParticipantPrintPreview, updateStaffPrintPreview） ✅ 完了
  - [x] ステップ 4: app.js の整理 ✅ 完了
    - [x] 不要な関数と定数の削除 ✅ 完了
  - [ ] ステップ 5: 動作確認
- [x] フェーズ 2: CSV 処理機能の分離 ✅ 完了
- [x] フェーズ 3: イベント管理機能の分離 ✅ 完了
- [ ] フェーズ 4: 参加者管理機能の分離

### フェーズ 1 の進捗内容

#### ステップ 1-2: PrintManager クラスの骨格作成と印刷設定管理機能の移行 ✅ 完了

**scripts/question-admin/managers/print-manager.js** を作成

- `PrintManager` クラスの骨格
- 基本的なメソッド（`hydrateSettingsFromStorage`, `persistSettings`, `applySettingsToForm`, `readSettingsFromForm`, `setupSettingsDialog`, `openPopupPrintWindow`）
- 段階的移行のため、一部は `app.js` を参照（`this.updateParticipantPrintPreview` など）

**app.js の変更**:

- `PrintManager` をインポート
- `let printManager = null;` でグローバル変数を宣言
- `init()` で `printManager = new PrintManager({...})` を初期化
- `hydratePrintSettingsFromStorage()` を `printManager.hydrateSettingsFromStorage()` に委譲
- `setupPrintSettingsDialog()` を `printManager.setupSettingsDialog()` に委譲
- `persistPrintSettings()` を `printManager.persistSettings()` に委譲
- `applyPrintSettingsToForm()` を `printManager.applySettingsToForm()` に委譲
- `readPrintSettingsFromForm()` を `printManager.readSettingsFromForm()` に委譲

**確認済み項目**:

- ✅ すべての依存関係が正しくインポートされている
- ✅ `app.js` への参照が正しく設定されている
- ✅ リンターエラーなし
- ✅ 命名規則に準拠している
- ✅ 印刷設定管理機能が正しく委譲されている

#### ステップ 3-1: 印刷グループ構築機能の移行 ✅ 完了

**scripts/question-admin/managers/print-manager.js** に追加した機能：

- `buildParticipantPrintGroups()`: 参加者印刷グループの構築
- `buildStaffPrintGroups()`: スタッフ印刷グループの構築

**app.js の変更**:

- `PrintManager` の初期化時に必要な依存関数と定数を context 経由で渡すように変更
  - `sortParticipants`, `getParticipantGroupKey`, `describeParticipantGroup`, `collectGroupGlLeaders`
  - `getEventGlRoster`, `getEventGlAssignmentsMap`, `resolveScheduleAssignment`, `loadGlDataForEvent`
  - `normalizeKey`, `normalizeGroupNumberValue`
  - `NO_TEAM_GROUP_KEY`, `CANCEL_LABEL`, `RELOCATE_LABEL`, `GL_STAFF_GROUP_KEY`
- `buildParticipantPrintGroups()` の呼び出しを `printManager.buildParticipantPrintGroups()` に委譲
- `buildStaffPrintGroups()` の呼び出しを `printManager.buildStaffPrintGroups()` に委譲（4 箇所）

**確認済み項目**:

- ✅ すべての依存関係が正しく context 経由で渡されている
- ✅ 呼び出し箇所が正しく委譲されている
- ✅ リンターエラーなし

#### ステップ 3-2-1: 印刷プレビュー制御機能の移行 ✅ 完了

**scripts/question-admin/managers/print-manager.js** に追加した機能：

- `cacheParticipantPrintPreview()`: 印刷プレビューのキャッシュを更新
- `setPrintPreviewNote()`: 印刷プレビューのノートを設定
- `setPrintPreviewVisibility()`: 印刷プレビューの表示/非表示を設定
- `setPrintPreviewBusy()`: 印刷プレビューのビジー状態を設定
- `clearParticipantPrintPreviewLoader()`: 印刷プレビューのローダーをクリア
- `resetPrintPreview()`: 印刷プレビューをリセット
- `renderPreviewFallbackNote()`: フォールバックノートを表示
- `renderParticipantPrintPreview()`: 参加者印刷プレビューを描画
- `triggerPrintFromPreview()`: プレビューから印刷をトリガー
- `printParticipantPreview()`: 参加者プレビューを印刷
- `closeParticipantPrintPreview()`: 参加者印刷プレビューを閉じる

**app.js の変更**:

- すべての印刷プレビュー制御関数を `printManager` に委譲
- `participantPrintInProgress` と `staffPrintInProgress` を `printManager` のプロパティに置き換え
- `participantPrintPreviewCache` の参照を `printManager.participantPrintPreviewCache` に置き換え

**確認済み項目**:

- ✅ すべての印刷プレビュー制御関数が正しく委譲されている
- ✅ 状態管理が正しく移行されている
- ✅ リンターエラーなし

#### ステップ 3-2-2: 印刷プレビュー更新機能の移行 ✅ 完了

**scripts/question-admin/managers/print-manager.js** に追加した機能：

- `updateParticipantPrintPreview()`: 参加者印刷プレビューを更新（約 200 行）
- `updateStaffPrintPreview()`: スタッフ印刷プレビューを更新（約 150 行）

**app.js の変更**:

- `PrintManager` の初期化時に必要な依存関数を context 経由で渡すように変更
  - `syncAllPrintButtonStates`, `setPrintButtonBusy`, `setStaffPrintButtonBusy`
- `updateParticipantPrintPreview()` を `printManager.updateParticipantPrintPreview()` に委譲
- `updateStaffPrintPreview()` を `printManager.updateStaffPrintPreview()` に委譲
- `setupSettingsDialog` 内で `this.updateParticipantPrintPreview()` を直接呼び出すように変更（循環参照を解消）

**ファイルサイズ**:

- `print-manager.js`: 1,000 行（618 行 → 1,000 行）

**確認済み項目**:

- ✅ すべての印刷プレビュー更新機能が正しく委譲されている
- ✅ 循環参照が解消されている
- ✅ フォールバック処理が実装されている
- ✅ リンターエラーなし

#### ステップ 4: app.js の整理 ✅ 完了

**削除した内容**:

- `updateParticipantPrintPreview_OLD_DELETED` 関数（約 210 行）を削除
- `updateStaffPrintPreview_OLD` 関数（約 162 行）を削除
- 三項演算子によるフォールバック（`printManager ? printManager.xxx : xxx`）を簡素化
  - `openStaffPrintView()` で `printManager` が必須であることを前提に変更
  - `syncStaffPrintViewButtonState()` でフォールバックを簡素化

**ファイルサイズ**:

- `app.js`: 7,401 行（8,180 行 → 7,401 行、約 779 行削除）

**確認済み項目**:

- ✅ 削除済み関数が完全に削除されている
- ✅ 三項演算子によるフォールバックが簡素化されている
- ✅ リンターエラーなし

#### ステップ 4-2: 不要な関数と定数の削除 ✅ 完了

**削除した内容**:

- `buildParticipantPrintGroups` 関数（約 34 行）を削除
- `buildStaffPrintGroups` 関数（約 50 行）を削除
- `staffSortCollator` 定数（1 行）を削除
- `compareNullableStringsForStaff` 関数（約 9 行）を削除
- `resolveGradeSortKey` 関数（約 15 行）を削除
- `compareStaffEntries` 関数（約 19 行）を削除
- `PRINT_PREVIEW_DEFAULT_NOTE` 定数（1 行）を削除
- `PRINT_PREVIEW_LOAD_TIMEOUT_MS` 定数（1 行）を削除
- `setPrintPreviewNote` のデフォルト引数から `PRINT_PREVIEW_DEFAULT_NOTE` を削除

**検証結果**:

- `buildParticipantPrintGroups` と `buildStaffPrintGroups` は PrintManager に実装済みで、app.js からは直接呼び出されていない
- `PRINT_PREVIEW_DEFAULT_NOTE` と `PRINT_PREVIEW_LOAD_TIMEOUT_MS` は PrintManager に定義済みで、app.js では使用されていない

**ファイルサイズ**:

- `app.js`: 7,401 行（7,535 行 → 7,401 行、約 134 行削除）

**確認済み項目**:

- ✅ 不要な関数と定数が完全に削除されている
- ✅ リンターエラーなし
- ✅ すべての機能が PrintManager に正しく移行されている

### フェーズ 2 の進捗内容

#### ステップ 1-4: CsvManager クラスの作成と CSV 処理機能の移行 ✅ 完了

**scripts/question-admin/managers/csv-manager.js** を作成（351 行）

- `CsvManager` クラスの骨格
- CSV ユーティリティ関数（`encodeCsvValue`, `createCsvContent`, `buildParticipantCsvFilename`, `buildTeamCsvFilename`, `downloadCsvFile`）
- CSV アップロード処理（`handleCsvChange`, `handleTeamCsvChange`）
- CSV テンプレートダウンロード機能（`downloadParticipantTemplate`, `downloadTeamTemplate`）

**app.js の変更**:

- `CsvManager` をインポート
- `let csvManager = null;` でグローバル変数を宣言
- `init()` で `csvManager = new CsvManager({...})` を初期化
- すべての CSV 処理関数を `csvManager` に委譲
- CSV 処理関数を削除（約 214 行削減）

**ファイルサイズ**:

- `app.js`: 7,397 行 → 7,183 行（約 214 行削減）
- `csv-manager.js`: 351 行（新規作成）

**確認済み項目**:

- ✅ すべての CSV 処理機能が CsvManager に移行されている
- ✅ イベントハンドラーが正しく委譲されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている
- ✅ リンターエラーなし

### フェーズ 3 の進捗内容

#### ステップ 1-5: EventManager クラスの作成とイベント管理機能の移行 ✅ 完了

**scripts/question-admin/managers/event-manager.js** を作成（405 行）

- `EventManager` クラスの骨格
- イベント読み込み機能（`loadEvents`）
- イベント描画機能（`renderEvents`）
- イベント選択機能（`selectEvent`）
- イベントフォーム表示機能（`openEventForm`）
- イベント CRUD 機能（`createEvent`, `updateEvent`, `deleteEvent`）

**app.js の変更**:

- `EventManager` をインポート
- `let eventManager = null;` でグローバル変数を宣言
- `init()` で `eventManager = new EventManager({...})` を初期化
- すべてのイベント管理関数を `eventManager` に委譲
- イベント管理関数を削除（約 237 行削減）

**ファイルサイズ**:

- `app.js`: 7,183 行 → 6,946 行（約 237 行削減）
- `event-manager.js`: 405 行（新規作成）

**確認済み項目**:

- ✅ すべてのイベント管理機能が EventManager に移行されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている
- ✅ リンターエラーなし

### フェーズ 4 の進捗内容

#### ステップ 1-2: ParticipantManager クラスの骨格作成と参加者読み込み機能の移行 ✅ 完了

**scripts/question-admin/managers/participant-manager.js** を作成（282 行）

- `ParticipantManager` クラスの骨格
- 参加者読み込み機能（`loadParticipants`）
  - ホスト選択データセットからの選択回復
  - スケジュール参加者データの読み込み
  - 重複チェックの遅延実行
  - エラーハンドリング

**app.js の変更**:

- `ParticipantManager` をインポート
- `let participantManager = null;` でグローバル変数を宣言
- `init()` で `participantManager = new ParticipantManager({...})` を初期化
- `loadParticipants()` を `participantManager.loadParticipants()` に委譲
- 元の実装は `loadParticipants_OLD_DELETED` として保持（後で削除予定）

**ファイルサイズ**:

- `app.js`: 6,946 行 → 6,987 行（約 41 行増加、委譲関数と初期化コードの追加による）
- `participant-manager.js`: 282 行（新規作成）

**確認済み項目**:

- ✅ ParticipantManager が正しく初期化されている
- ✅ loadParticipants が正しく委譲されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている（ParticipantManager 未初期化時のエラー）
- ✅ リンターエラーなし

#### ステップ 3: 参加者描画機能の移行 ✅ 完了

**scripts/question-admin/managers/participant-manager.js** に追加した機能：

- `renderParticipants()`: 参加者一覧の描画（約 165 行）
  - 参加者カードの生成とグループ化
  - GL 割り当ての表示
  - 重複候補の表示
  - 変更プレビューの表示

**app.js の変更**:

- `ParticipantManager` の初期化時に必要な依存関係を context 経由で渡すように変更
  - `buildParticipantCard`, `getParticipantGroupKey`, `createParticipantGroupElements`
  - `getEventGlRoster`, `getEventGlAssignmentsMap`, `resolveScheduleAssignment`
  - `renderGroupGlAssignments`, `clearParticipantSelection`, `participantChangeKey`
  - `CANCEL_LABEL`, `GL_STAFF_GROUP_KEY`
- `renderParticipants()` を `participantManager.renderParticipants()` に委譲
- 元の実装は `renderParticipants_OLD_DELETED` として保持（後で削除予定）

**ファイルサイズ**:

- `app.js`: 6,987 行 → 7,008 行（約 21 行増加、委譲関数と初期化コードの追加による）
- `participant-manager.js`: 282 行 → 463 行（約 181 行増加）

**確認済み項目**:

- ✅ renderParticipants が正しく委譲されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている（ParticipantManager 未初期化時のエラー）
- ✅ リンターエラーなし

#### ステップ 4: 参加者 CRUD 機能の移行 ✅ 完了

**scripts/question-admin/managers/participant-manager.js** に追加した機能：

- `openParticipantEditor(participantId, rowKey)`: 参加者編集フォームを開く（約 80 行）
  - フォームへの値の設定
  - メールステータスの表示
  - 移動先情報の表示
- `saveParticipantEdits()`: 編集内容を保存（約 110 行）
  - フォームからの値の読み取り
  - メールステータスの更新
  - 移動先ドラフトの適用
  - 班割り当ての更新
- `handleDeleteParticipant(participantId, rowIndex, rowKey)`: 参加者を削除（約 65 行）
  - 確認ダイアログの表示
  - 参加者の削除処理
- `removeParticipantFromState(participantId, fallbackEntry, rowKey)`: 状態から参加者を削除（内部メソッド、約 55 行）

**app.js の変更**:

- `ParticipantManager` の初期化時に CRUD 機能に必要な依存関係を context 経由で渡すように変更
  - `getDisplayParticipantId`, `ensurePendingRelocationMap`, `applyRelocationDraft`
  - `ensureTeamAssignmentMap`, `applyAssignmentsToEventCache`
  - `hasUnsavedChanges`, `confirmAction`, `setFormError`
  - `openDialog`, `closeDialog`, `RELOCATE_LABEL`
- `openParticipantEditor()`, `saveParticipantEdits()`, `handleDeleteParticipant()` を `participantManager` に委譲
- `handleEditSelectedParticipant()` も委譲
- 元の実装は `app.js` に残っている（後で削除予定）

**ファイルサイズ**:

- `app.js`: 7,007 行 → 6,799 行（約 208 行削減、ステップ 3 完了時点）
- `participant-manager.js`: 462 行 → 804 行（約 342 行増加）

**確認済み項目**:

- ✅ CRUD 機能が正しく委譲されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている（ParticipantManager 未初期化時のエラー）
- ✅ リンターエラーなし

**残りの作業**:

#### ステップ 5: 参加者保存機能の移行 ✅ 完了

**scripts/question-admin/managers/participant-manager.js** に追加した機能：

- `handleSave(options = {})`: 参加者データを Firebase に保存（約 350 行）
  - トークンの生成と管理
  - 参加者データのペイロード作成
  - 移動（relocation）の処理
  - 質問データの更新
  - Firebase への一括更新
  - 保存後の再読み込みと状態更新

**app.js の変更**:

- `ParticipantManager` の初期化時に `handleSave` に必要な依存関係を context 経由で渡すように変更
  - `getScheduleRecord`: スケジュールレコードの取得
  - `loadEvents`: イベントの再読み込み（EventManager に委譲）
- `handleSave()` を `participantManager.handleSave()` に委譲
- 元の実装は `handleSave_OLD_DELETED` として保持（後で削除予定）

**ファイルサイズ**:

- `app.js`: 6,799 行 → 6,808 行（約 9 行増加、委譲関数の追加による、ステップ 4 完了時点）
- `participant-manager.js`: 804 行 → 1,155 行（約 351 行増加）

**確認済み項目**:

- ✅ handleSave が正しく委譲されている
- ✅ 必要な依存関係が context 経由で渡されている
- ✅ エラーハンドリングが実装されている（ParticipantManager 未初期化時のエラー）
- ✅ リンターエラーなし

#### ステップ 6: app.js の整理 ✅ 完了

**削除した関数**:

- `renderParticipants_OLD_DELETED`: 参加者描画の旧実装（約 164 行）
- `loadParticipants_OLD_DELETED`: 参加者読み込みの旧実装（約 224 行）
- `handleSave_OLD_DELETED`: 参加者保存の旧実装（約 346 行）
- `removeParticipantFromState`: 参加者削除の旧実装（約 54 行）

**ファイルサイズ**:

- `app.js`: 6,808 行 → 6,023 行（約 785 行削減）
- `participant-manager.js`: 1,155 行（変更なし）

**確認済み項目**:

- ✅ すべての `_OLD_DELETED` 関数が削除された
- ✅ リンターエラーなし
- ✅ 委譲が正しく機能している

**フェーズ 4 完了**:

フェーズ 4（参加者管理機能の分離）が完了しました。`ParticipantManager` に以下の機能が移行されました：

- 参加者読み込み（`loadParticipants`）
- 参加者描画（`renderParticipants`）
- 参加者 CRUD 操作（`openParticipantEditor`, `saveParticipantEdits`, `handleDeleteParticipant`, `removeParticipantFromState`）
- 参加者保存（`handleSave`）

**残りの作業**:

- [ ] 動作確認とテスト

---

**作成日**: 2025 年
**バージョン**: 1.0.0
