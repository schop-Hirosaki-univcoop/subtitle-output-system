# ユーティリティ関数の整理計画

## 概要

`scripts/question-admin/app.js` に残っているユーティリティ関数を整理し、適切な Manager クラスまたはユーティリティモジュールに分離します。

## 現状

- `app.js`: 2,949 行（フェーズ 17 段階 7 進行中、元の 4,596 行から約 1,647 行削減）
- 残っている関数: 約 20-30 個（委譲関数を除く、`init()` 関数と `window.questionAdminEmbed` を含む）
- 実績削減行数: 約 1,647 行（フェーズ 17 段階 1-6 完了、段階 7 進行中）
- 推定残り削減可能行数: 約 850-1,050 行（`init()` 関数と `window.questionAdminEmbed` の完全移行後）

## フェーズ分割案

### フェーズ 9: 埋め込みモード・ホスト統合機能の分離（EmbedManager / HostIntegrationManager）

**対象関数**:

- `getEmbedPrefix()` - 埋め込みプレフィックスの取得
- `isEmbeddedMode()` - 埋め込みモードの判定
- `waitForEmbedReady()` - 埋め込み準備完了の待機
- `resolveEmbedReady()` - 埋め込み準備完了の解決
- `attachHost()` - ホストのアタッチ
- `detachHost()` - ホストのデタッチ
- `isHostAttached()` - ホストアタッチ状態の判定
- `handleHostSelection()` - ホスト選択の処理
- `handleHostEventsUpdate()` - ホストイベント更新の処理
- `applyHostEvents()` - ホストイベントの適用
- `cloneHostEvent()` - ホストイベントのクローン
- `broadcastSelectionChange()` - 選択変更のブロードキャスト
- `getSelectionBroadcastSource()` - 選択ブロードキャストソースの取得
- `signatureForSelectionDetail()` - 選択詳細のシグネチャ生成
- `buildSelectionDetail()` - 選択詳細の構築
- `applySelectionContext()` - 選択コンテキストの適用（約 130 行）
- `hostSelectionSignature()` - ホスト選択シグネチャの生成
- `getHostSelectionElement()` - ホスト選択要素の取得
- `readHostSelectionDataset()` - ホスト選択データセットの読み取り
- `applyHostSelectionFromDataset()` - ホスト選択データセットの適用
- `startHostSelectionBridge()` - ホスト選択ブリッジの開始
- `stopHostSelectionBridge()` - ホスト選択ブリッジの停止

**推定行数**: 約 430-530 行（`applySelectionContext`を含む）

**依存関係**:

- `state`, `dom`
- `normalizeKey`, `selectEvent`, `loadEvents`
- `HOST_SELECTION_ATTRIBUTE_KEYS`, `hostSelectionBridge`, `embedReadyDeferred`

---

### フェーズ 10: 状態管理・キャッシュ関連の関数の整理（StateManager / CacheManager）

**対象関数**:

- `captureParticipantBaseline()` - 参加者ベースラインのキャプチャ
- `hasUnsavedChanges()` - 未保存変更の有無判定
- `setUploadStatus()` - アップロードステータスの設定
- `isPlaceholderUploadStatus()` - プレースホルダーステータスの判定
- `resetState()` - 状態のリセット
- `cloneParticipantEntry()` - 参加者エントリのクローン
- `getMissingSelectionStatusMessage()` - 選択不足ステータスメッセージの取得
- `getSelectionRequiredMessage()` - 選択必須メッセージの取得

**推定行数**: 約 120-170 行

**依存関係**:

- `state`, `dom`
- `signatureForEntries`, `snapshotParticipantList`, `normalizeKey`, `isEmbeddedMode`
- `UPLOAD_STATUS_PLACEHOLDERS`
- 注: `UPLOAD_STATUS_PLACEHOLDERS` は定数として移行対象

---

### フェーズ 11: UI 関連の関数の整理（UIManager）

**対象関数**:

- `renderUserSummary()` - ユーザーサマリーの描画
- `setLoginError()` - ログインエラーの設定
- `setAuthUi()` - 認証 UI の設定
- `toggleSectionVisibility()` - セクション表示の切り替え
- `applyParticipantNoText()` - 参加者番号テキストの適用
- `getElementById()` - 要素 ID による取得
- `resolveFocusTargetElement()` - フォーカスターゲット要素の解決
- `maybeFocusInitialSection()` - 初期セクションへのフォーカス

**推定行数**: 約 150-200 行

**依存関係**:

- `dom`, `state`
- `FOCUS_TARGETS`, `isEmbeddedMode`
- 注: `FOCUS_TARGETS` は定数として移行対象

---

### フェーズ 12: 確認ダイアログ関連の関数の整理（ConfirmDialogManager）

**対象関数**:

- `confirmAction()` - 確認アクション
- `setupConfirmDialog()` - 確認ダイアログのセットアップ
- `cleanupConfirmState()` - 確認状態のクリーンアップ
- `finalizeConfirm()` - 確認の確定

**推定行数**: 約 100 行

**依存関係**:

- `dom`, `openDialog`, `closeDialog`
- `confirmState`
- 注: `confirmState` は変数として移行対象

---

### フェーズ 13: GL 関連の関数の整理（GlManager）✅ 完了

**対象関数**:

- ✅ `getEventGlRoster()` - イベント GL 名簿の取得（約 8 行削減）
- ✅ `getEventGlAssignmentsMap()` - イベント GL 割り当てマップの取得（約 8 行削減）
- ✅ `normalizeGlRoster()` - GL 名簿の正規化（約 20 行削減）
- ✅ `normalizeGlAssignmentEntry()` - GL 割り当てエントリの正規化（約 30 行削減）
- ✅ `normalizeGlAssignments()` - GL 割り当ての正規化（約 82 行削減）
- ✅ `resolveScheduleAssignment()` - スケジュール割り当ての解決（約 10 行削減）
- ✅ `collectGroupGlLeaders()` - グループ GL リーダーの収集（約 55 行削減）
- ✅ `renderGroupGlAssignments()` - グループ GL 割り当ての描画（約 35 行削減）
- ✅ `loadGlDataForEvent()` - イベント GL データの読み込み（約 59 行削減）

**実績行数**: 約 227 行削減（`app.js` は 4,092 行、`gl-manager.js` は 386 行）

**依存関係**:

- ✅ `state`, `dom`
- ✅ `normalizeKey`, `fetchDbValue`, `renderParticipants`
- ✅ `CANCEL_LABEL`, `GL_STAFF_GROUP_KEY`, `GL_STAFF_LABEL`
- ✅ `glDataFetchCache` は変数として移行完了

---

### フェーズ 14: 参加者 UI 関連の関数の整理（ParticipantUIManager）✅ 完了（段階 1-6 完了）

**対象関数**:

- ✅ `getParticipantGroupKey()` - 参加者グループキーの取得（約 13 行削減）
- ✅ `describeParticipantGroup()` - 参加者グループの説明（約 16 行削減）
- ✅ `createParticipantGroupElements()` - 参加者グループ要素の作成（約 54 行削減）
- ✅ `formatParticipantIdentifier()` - 参加者識別子のフォーマット（約 13 行削減）
- ✅ `createParticipantBadge()` - 参加者バッジの作成（約 19 行削減）
- ✅ `createMailStatusBadge()` - メールステータスバッジの作成（約 26 行削減）
- ✅ `getEntryIdentifiers()` - エントリ識別子の取得（約 6 行削減）
- ✅ `MAIL_STATUS_ICON_SVG` - メールステータスアイコン SVG 定数（約 12 行削減）
- ✅ `isEntryCurrentlySelected()` - エントリ選択状態の判定（約 18 行削減、段階 3 完了）
- ✅ `getSelectedParticipantTarget()` - 選択された参加者ターゲットの取得（約 14 行削減、段階 3 完了）
- ✅ `applyParticipantSelectionStyles()` - 参加者選択スタイルの適用（約 27 行削減、段階 3 完了）
- ✅ `clearParticipantSelection()` - 参加者選択のクリア（約 8 行削減、段階 3 完了）
- ✅ `selectParticipantFromCardElement()` - カード要素からの参加者選択（約 22 行削減、段階 3 完了）
- ✅ `buildParticipantCard()` - 参加者カードの構築（約 170 行削減、段階 4 完了）
- ✅ `resolveParticipantActionTarget()` - 参加者アクションターゲットの解決（約 47 行削減、段階 5 完了）
- ✅ `commitParticipantQuickEdit()` - 参加者クイック編集のコミット（約 49 行削減、段階 5 完了）
- ✅ `handleQuickCancelAction()` - クイックキャンセルアクション（約 55 行削減、段階 5 完了）
- ✅ `renderParticipantChangePreview()` - 参加者変更プレビューの描画（約 48 行削減、段階 6 完了）
- ✅ `participantChangeKey()` - 参加者変更キーの生成（約 10 行削減、段階 6 完了）
- ✅ `formatChangeValue()` - 変更値のフォーマット（約 4 行削減、段階 6 完了）
- ✅ `CHANGE_ICON_SVG` - 変更アイコン SVG 定数（約 5 行削減、段階 6 完了）
- ✅ `changeTypeLabel()` - 変更タイプラベルの取得（約 12 行削減、段階 6 完了）
- ✅ `describeParticipantForChange()` - 変更用参加者説明の生成（約 15 行削減、段階 6 完了）
- ✅ `buildChangeMeta()` - 変更メタの構築（約 15 行削減、段階 6 完了）
- ✅ `createChangePreviewItem()` - 変更プレビューアイテムの作成（約 41 行削減、段階 6 完了）

**実績行数**: 約 654 行削減（`app.js` は 3,601 行、`participant-ui-manager.js` は 906 行、段階 1-6 完了）

**依存関係**:

- `dom`, `state`
- `resolveParticipantUid`, `sortParticipants`, `ensureRowKey`, `ensureTeamAssignmentMap`, `applyAssignmentsToEventCache`, `syncCurrentScheduleCache`, `updateDuplicateMatches`, `renderParticipants`, `syncSaveButtonState`, `setUploadStatus`, `hasUnsavedChanges`
- `CANCEL_LABEL`, `RELOCATE_LABEL`, `GL_STAFF_GROUP_KEY`, `GL_STAFF_LABEL`, `NO_TEAM_GROUP_KEY`
- `relocationManager`, `createShareUrl`, `describeDuplicateMatch`, `resolveMailStatusInfo`, `MAIL_STATUS_ICON_SVG`

---

### フェーズ 15: スケジュール関連の関数の整理（ScheduleUtilityManager）✅ 完了

**対象関数**:

- ✅ `getScheduleRecord()` - スケジュールレコードの取得（約 8 行削減、段階 1 完了）
- ✅ `buildScheduleOptionLabel()` - スケジュールオプションラベルの構築（約 11 行削減、段階 1 完了）
- ✅ `refreshScheduleLocationHistory()` - スケジュール場所履歴の更新（約 29 行削減、段階 2 完了）
- ✅ `populateScheduleLocationOptions()` - スケジュール場所オプションの生成（約 42 行削減、段階 2 完了）
- ✅ `finalizeEventLoad()` - イベント読み込みの確定（約 115 行削減、段階 3 完了）

**実績行数**: 約 205 行削減（`app.js` は 3,461 行、`schedule-utility-manager.js` は 252 行、段階 1-3 完了）

**依存関係**:

- `state`, `dom`
- `describeScheduleRange`, `getScheduleLabel`, `normalizeKey`
- `state.scheduleLocationHistory`

---

### フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager）✅ 完了

**対象関数**:

- ✅ `syncSaveButtonState()` - 保存ボタン状態の同期（約 16 行削減、段階 1 完了）
- ✅ `syncClearButtonState()` - クリアボタン状態の同期（約 9 行削減、段階 1 完了）
- ✅ `syncTemplateButtons()` - テンプレートボタン状態の同期（約 28 行削減、段階 1 完了）
- ✅ `setActionButtonState()` - アクションボタン状態の設定（約 11 行削減、段階 1 完了）
- ✅ `syncAllPrintButtonStates()` - すべての印刷ボタン状態の同期（約 4 行削減、段階 2 完了）
- ✅ `syncPrintViewButtonState()` - 印刷ビューボタン状態の同期（約 65 行削減、段階 2 完了）
- ✅ `syncStaffPrintViewButtonState()` - スタッフ印刷ビューボタン状態の同期（約 53 行削減、段階 2 完了）
- ✅ `setPrintButtonBusy()` - 印刷ボタンのビジー状態設定（約 10 行削減、段階 2 完了）
- ✅ `setStaffPrintButtonBusy()` - スタッフ印刷ボタンのビジー状態設定（約 10 行削減、段階 2 完了）
- ⚠️ `openParticipantPrintView()` - 参加者印刷ビューのオープン（PrintManager に委譲済みのため移行不要）
- ⚠️ `openStaffPrintView()` - スタッフ印刷ビューのオープン（PrintManager に委譲済みのため移行不要）
- ⚠️ `syncMailActionState()` - メールアクション状態の同期（MailManager に委譲済みのため移行不要）
- ✅ `updateParticipantActionPanelState()` - 参加者アクションパネル状態の更新（約 42 行削減、段階 3 完了）
- ✅ `setParticipantTab()` - 参加者タブの設定（約 24 行削減、段階 4 完了）
- ✅ `focusParticipantTab()` - 参加者タブへのフォーカス（約 8 行削減、段階 4 完了）
- ✅ `setupParticipantTabs()` - 参加者タブのセットアップ（約 36 行削減、段階 4 完了）
- ✅ `syncSelectedEventSummary()` - 選択イベントサマリーの同期（約 33 行削減、段階 5 完了）

**実績行数**: 約 349 行削減（`app.js` は 3,290 行、`button-state-manager.js` は 454 行、段階 1-5 完了）

**依存関係**:

- `dom`, `state`
- `hasUnsavedChanges`, `resolveParticipantUid`, `renderSchedules`, `renderEvents`, `getScheduleLabel`
- `getSelectedParticipantTarget`, `formatParticipantIdentifier`
- `printManager`, `mailManager`（委譲経由）
- 注: `printActionButtonMissingLogged`, `staffPrintActionButtonMissingLogged` は変数として移行完了

---

### フェーズ 17: その他のユーティリティ関数の整理（進行中、段階 7 進行中）

**対象関数**:

- ✅ `generateQuestionToken()` - 質問トークンの生成（`TokenApiManager` に移行完了、段階 1）
- ✅ `createApiClient()` - API クライアントの作成（`TokenApiManager` に移行完了、段階 1）
- ✅ `ensureTokenSnapshot()` - トークンスナップショットの確保（`TokenApiManager` に移行完了、段階 1）
- ✅ `drainQuestionQueue()` - 質問キューのドレイン（`TokenApiManager` に移行完了、段階 1）
- ✅ `legacyCopyToClipboard()` - レガシークリップボードコピー（`ShareClipboardManager` に移行完了、段階 2）
- ✅ `copyShareLink()` - 共有リンクのクリップボードコピー（`ShareClipboardManager` に移行完了、段階 2）
- ✅ `getSelectionIdentifiers()` - 選択識別子の取得（`ShareClipboardManager` に移行完了、段階 2）
- ✅ `createShareUrl()` - 共有 URL の作成（`ShareClipboardManager` に移行完了、段階 2）
- ✅ `parseInitialSelectionFromUrl()` - URL からの初期選択の解析（`ParticipantContextManager` に移行完了、段階 3）
- ✅ `emitParticipantSyncEvent()` - 参加者同期イベントの送信（`ParticipantContextManager` に移行完了、段階 3）
- ✅ `updateParticipantContext()` - 参加者コンテキストの更新（`ParticipantContextManager` に移行完了、段階 3）
- `getDisplayParticipantId()` - 表示用参加者 ID の取得
- ✅ `handleRevertParticipants()` - 参加者の取り消し処理（`ParticipantActionManager` に移行完了、段階 4）
- ✅ `handleClearParticipants()` - 参加者のクリア処理（`ParticipantActionManager` に移行完了、段階 4）
- ✅ `handleEditSelectedParticipant()` - 選択参加者の編集処理（`ParticipantActionManager` に移行完了、段階 4）
- ✅ `handleCancelSelectedParticipant()` - 選択参加者のキャンセル処理（`ParticipantActionManager` に移行完了、段階 4）
- ✅ `handleDeleteSelectedParticipant()` - 選択参加者の削除処理（`ParticipantActionManager` に移行完了、段階 4）
- `openParticipantEditor()` - 参加者エディタのオープン
- `saveParticipantEdits()` - 参加者編集の保存
- ✅ `handleParticipantCardListClick()` - 参加者カードリストのクリック処理（`ParticipantUIManager` に移行完了、段階 5）
- ✅ `handleParticipantCardListKeydown()` - 参加者カードリストのキーダウン処理（`ParticipantUIManager` に移行完了、段階 5）
- ✅ `handleParticipantListFocus()` - 参加者リストのフォーカス処理（`ParticipantUIManager` に移行完了、段階 5）
- ✅ `attachEventHandlers()` - イベントハンドラーのアタッチ（`EventHandlersManager` に移行完了、段階 6）
- ⏳ `initAuthWatcher()` - 認証ウォッチャーの初期化（フォールバック、段階 7 で整理予定）
- ⏳ `init()` - アプリケーションの初期化（約 851 行、`InitManager` に移行中、段階 7 進行中、初期化後の処理は移行完了）
- ✅ `window.questionAdminEmbed` - グローバル API オブジェクト（約 65 行、`InitManager` に移行完了、段階 7）

**実績行数**:

- 段階 1: 約 67 行削減（`app.js` は 3,223 行、`token-api-manager.js` は 106 行）
- 段階 2: 約 48 行削減（`app.js` は 3,175 行、`share-clipboard-manager.js` は 90 行）
- 段階 3: 約 109 行削減（`app.js` は 3,066 行、`participant-context-manager.js` は 138 行）
- 段階 4: 約 126 行削減（`app.js` は 2,940 行、`participant-action-manager.js` は 168 行）
- 段階 5: 約 45 行削減（`app.js` は 2,895 行、`ParticipantUIManager` に追加）
- 段階 6: 約 419 行削減（`app.js` は 2,949 行、`event-handlers-manager.js` は 506 行）
- 段階 7: 進行中（`InitManager` は 435 行、8 個の Manager 初期化と初期化後の処理を移行済み、`app.js` は 2,973 行、managerRefs への代入とグローバル変数への同期を追加完了）

**推定残り行数**: 約 850-1,050 行（`init()` 関数と `window.questionAdminEmbed` の完全移行後）

**現在の進捗**:

- `app.js`: 2,756 行（InitManager 初期化コード追加により一時的に増加、移行完了後に削減予定）
- `init-manager.js`: 648 行（基本構造 + 14 個の Manager 初期化 + 初期化後の処理）
- 完了: PrintManager, StateManager, UIManager, ConfirmDialogManager, ScheduleUtilityManager, ButtonStateManager, TokenApiManager, ShareClipboardManager, ParticipantContextManager, ParticipantActionManager, GlManager, ParticipantUIManager, CsvManager, EventManager の初期化を移行、初期化後の処理を移行、window.questionAdminEmbed を移行、managerRefs への代入を追加、グローバル変数への同期を追加、initAuthWatcher()のフォールバック実装を整理
- 残り: 7 個の Manager 初期化を InitManager に移行（現在は app.js で初期化し managerRefs に代入）

**依存関係**:

- `dom`, `state`, `api`
- 各種 Manager クラス
- 各種ユーティリティ関数

---

## 実装方針

1. **段階的な実装**: 各フェーズを順次実装
2. **依存関係の管理**: 各 Manager クラスに必要な依存関係を明示的に渡す
3. **委譲パターンの維持**: `app.js`から Manager クラスへの委譲メソッドを維持
4. **テストの実施**: 各フェーズ完了後に動作確認

## 期待される効果

- `app.js`の行数を約 2,000-3,000 行に削減（目標: 3,000 行以下）
- 責務の明確化
- テスト容易性の向上
- 保守性の向上
