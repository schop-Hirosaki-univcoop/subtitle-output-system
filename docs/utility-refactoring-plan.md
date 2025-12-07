# ユーティリティ関数の整理計画

## 概要

`scripts/question-admin/app.js` に残っているユーティリティ関数を整理し、適切な Manager クラスまたはユーティリティモジュールに分離します。

## 現状

- `app.js`: 4,596 行
- 残っている関数: 約 100-120 個（委譲関数を除く）
- 推定削減可能行数: 約 1,000-2,000 行

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

### フェーズ 13: GL 関連の関数の整理（GlManager）

**対象関数**:

- `getEventGlRoster()` - イベント GL 名簿の取得
- `getEventGlAssignmentsMap()` - イベント GL 割り当てマップの取得
- `normalizeGlRoster()` - GL 名簿の正規化
- `normalizeGlAssignmentEntry()` - GL 割り当てエントリの正規化
- `normalizeGlAssignments()` - GL 割り当ての正規化
- `resolveScheduleAssignment()` - スケジュール割り当ての解決
- `collectGroupGlLeaders()` - グループ GL リーダーの収集
- `renderGroupGlAssignments()` - グループ GL 割り当ての描画
- `loadGlDataForEvent()` - イベント GL データの読み込み

**推定行数**: 約 250-300 行

**依存関係**:

- `state`, `dom`
- `normalizeKey`, `fetchDbValue`, `renderParticipants`
- `glDataFetchCache`, `CANCEL_LABEL`, `GL_STAFF_GROUP_KEY`, `GL_STAFF_LABEL`
- 注: `glDataFetchCache` は変数として移行対象

---

### フェーズ 14: 参加者 UI 関連の関数の整理（ParticipantUIManager）

**対象関数**:

- `resolveParticipantActionTarget()` - 参加者アクションターゲットの解決
- `formatParticipantIdentifier()` - 参加者識別子のフォーマット
- `commitParticipantQuickEdit()` - 参加者クイック編集のコミット
- `handleQuickCancelAction()` - クイックキャンセルアクション
- `getParticipantGroupKey()` - 参加者グループキーの取得
- `describeParticipantGroup()` - 参加者グループの説明
- `createParticipantGroupElements()` - 参加者グループ要素の作成
- `createParticipantBadge()` - 参加者バッジの作成
- `createMailStatusBadge()` - メールステータスバッジの作成
- `MAIL_STATUS_ICON_SVG` - メールステータスアイコン SVG 定数
- `getEntryIdentifiers()` - エントリ識別子の取得
- `isEntryCurrentlySelected()` - エントリ選択状態の判定
- `getSelectedParticipantTarget()` - 選択された参加者ターゲットの取得
- `applyParticipantSelectionStyles()` - 参加者選択スタイルの適用
- `clearParticipantSelection()` - 参加者選択のクリア
- `selectParticipantFromCardElement()` - カード要素からの参加者選択
- `buildParticipantCard()` - 参加者カードの構築
- `renderParticipantChangePreview()` - 参加者変更プレビューの描画
- `participantChangeKey()` - 参加者変更キーの生成
- `formatChangeValue()` - 変更値のフォーマット
- `CHANGE_ICON_SVG` - 変更アイコン SVG 定数
- `changeTypeLabel()` - 変更タイプラベルの取得
- `describeParticipantForChange()` - 変更用参加者説明の生成
- `buildChangeMeta()` - 変更メタの構築
- `createChangePreviewItem()` - 変更プレビューアイテムの作成

**推定行数**: 約 600-800 行

**依存関係**:

- `dom`, `state`
- `resolveParticipantUid`, `sortParticipants`, `ensureRowKey`, `ensureTeamAssignmentMap`, `applyAssignmentsToEventCache`, `syncCurrentScheduleCache`, `updateDuplicateMatches`, `renderParticipants`, `syncSaveButtonState`, `setUploadStatus`, `hasUnsavedChanges`
- `CANCEL_LABEL`, `RELOCATE_LABEL`, `GL_STAFF_GROUP_KEY`, `GL_STAFF_LABEL`, `NO_TEAM_GROUP_KEY`
- `relocationManager`, `createShareUrl`, `describeDuplicateMatch`, `resolveMailStatusInfo`, `MAIL_STATUS_ICON_SVG`

---

### フェーズ 15: スケジュール関連の関数の整理（ScheduleUtilityManager）

**対象関数**:

- `getScheduleRecord()` - スケジュールレコードの取得
- `buildScheduleOptionLabel()` - スケジュールオプションラベルの構築
- `refreshScheduleLocationHistory()` - スケジュール場所履歴の更新
- `populateScheduleLocationOptions()` - スケジュール場所オプションの生成
- `finalizeEventLoad()` - イベント読み込みの確定

**推定行数**: 約 150-200 行

**依存関係**:

- `state`, `dom`
- `describeScheduleRange`, `getScheduleLabel`, `normalizeKey`
- `state.scheduleLocationHistory`

---

### フェーズ 16: ボタン状態同期関連の関数の整理（ButtonStateManager）

**対象関数**:

- `syncSaveButtonState()` - 保存ボタン状態の同期
- `syncClearButtonState()` - クリアボタン状態の同期
- `syncTemplateButtons()` - テンプレートボタン状態の同期
- `setActionButtonState()` - アクションボタン状態の設定
- `syncAllPrintButtonStates()` - すべての印刷ボタン状態の同期
- `syncPrintViewButtonState()` - 印刷ビューボタン状態の同期
- `syncStaffPrintViewButtonState()` - スタッフ印刷ビューボタン状態の同期
- `setPrintButtonBusy()` - 印刷ボタンのビジー状態設定
- `setStaffPrintButtonBusy()` - スタッフ印刷ボタンのビジー状態設定
- `openParticipantPrintView()` - 参加者印刷ビューのオープン（PrintManager に委譲されていない実装部分）
- `openStaffPrintView()` - スタッフ印刷ビューのオープン（PrintManager に委譲されていない実装部分）
- `syncMailActionState()` - メールアクション状態の同期
- `updateParticipantActionPanelState()` - 参加者アクションパネル状態の更新
- `setParticipantTab()` - 参加者タブの設定
- `focusParticipantTab()` - 参加者タブへのフォーカス
- `setupParticipantTabs()` - 参加者タブのセットアップ
- `syncSelectedEventSummary()` - 選択イベントサマリーの同期

**推定行数**: 約 300-400 行

**依存関係**:

- `dom`, `state`
- `hasUnsavedChanges`, `getPendingMailCount`, `resolveParticipantUid`, `renderSchedules`, `renderEvents`
- `mailManager`, `printManager`
- 注: `printActionButtonMissingLogged`, `staffPrintActionButtonMissingLogged` は変数として移行対象

---

### フェーズ 17: その他のユーティリティ関数の整理

**対象関数**:

- `generateQuestionToken()` - 質問トークンの生成
- `createApiClient()` - API クライアントの作成
- `getDisplayParticipantId()` - 表示用参加者 ID の取得
- `legacyCopyToClipboard()` - レガシークリップボードコピー
- `copyShareLink()` - 共有リンクのクリップボードコピー
- `emitParticipantSyncEvent()` - 参加者同期イベントの送信
- `getSelectionIdentifiers()` - 選択識別子の取得
- `createShareUrl()` - 共有 URL の作成
- `parseInitialSelectionFromUrl()` - URL からの初期選択の解析
- `updateParticipantContext()` - 参加者コンテキストの更新
- `ensureTokenSnapshot()` - トークンスナップショットの確保
- `drainQuestionQueue()` - 質問キューのドレイン
- `handleRevertParticipants()` - 参加者の取り消し処理
- `handleClearParticipants()` - 参加者のクリア処理
- `handleEditSelectedParticipant()` - 選択参加者の編集処理
- `handleCancelSelectedParticipant()` - 選択参加者のキャンセル処理
- `handleDeleteSelectedParticipant()` - 選択参加者の削除処理
- `openParticipantEditor()` - 参加者エディタのオープン
- `saveParticipantEdits()` - 参加者編集の保存
- `handleParticipantCardListClick()` - 参加者カードリストのクリック処理
- `handleParticipantCardListKeydown()` - 参加者カードリストのキーダウン処理
- `handleParticipantListFocus()` - 参加者リストのフォーカス処理
- `attachEventHandlers()` - イベントハンドラーのアタッチ
- `initAuthWatcher()` - 認証ウォッチャーの初期化（フォールバック）
- `init()` - アプリケーションの初期化（約 310 行）
- `window.questionAdminEmbed` - グローバル API オブジェクト（約 60 行）

**推定行数**: 約 870-1,070 行（追加関数を含む）

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
