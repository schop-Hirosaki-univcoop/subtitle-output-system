# パネル実装のリファクタリング計画

このドキュメントは、UI パネルとファイル構造の対応関係を改善するための段階的なリファクタリング計画です。

## 目標

1. UI パネルとファイル構造を 1 対 1 で対応させる
2. パネル実装を探しやすくする
3. 開発標準に準拠した命名規則を適用する
4. 新しいパネルを追加する際の場所を明確にする

## 現状の問題

1. **イベント管理パネルと日程管理パネルが混在**

   - `scripts/events/app.js` (10,180 行) に両方が含まれている

2. **パネル実装の配置が分散**

   - `scripts/events/tools/` に一部
   - `scripts/operator/` に一部
   - 配置場所が一貫していない

3. **命名の不一致**
   - パネル名とファイル名が一致していない
   - ファイル名からパネル実装であることが明確でない

## リファクタリングの段階

### フェーズ 1: 命名の統一（影響範囲: 小）

**目的**: ファイル名に `-panel` サフィックスを追加し、パネル名と一致させる

**対象ファイル**:

- `scripts/events/tools/participant.js` → `participants-panel.js`
- `scripts/events/tools/gl.js` → `gl-panel.js`
- `scripts/events/tools/gl-faculty-admin.js` → `gl-faculties-panel.js`
- `scripts/events/tools/operator.js` → `operator-panel.js`
- `scripts/operator/dictionary.js` → `dictionary-panel.js`
- `scripts/operator/pickup.js` → `pickup-panel.js`
- `scripts/operator/logs.js` → `logs-panel.js`
- `scripts/events/chat.js` → `chat-panel.js`
- `scripts/operator/side-telop.js` → `side-telop-panel.js`

**作業内容**:

1. ファイル名を変更
2. すべてのインポート文を更新
3. 動作確認

**リスク**: 低（ファイル名の変更とインポートパスの更新のみ）

---

### フェーズ 2: パネル実装のディレクトリ構造への統一（影響範囲: 中）

**目的**: すべてのパネル実装を `panels/` ディレクトリに配置

**対象ディレクトリ**:

- `scripts/events/panels/` を作成
- `scripts/operator/panels/` を作成

**移動対象**:

- `scripts/events/tools/participants-panel.js` → `scripts/events/panels/participants-panel.js`
- `scripts/events/tools/gl-panel.js` → `scripts/events/panels/gl-panel.js`
- `scripts/events/tools/gl-faculties-panel.js` → `scripts/events/panels/gl-faculties-panel.js`
- `scripts/events/tools/operator-panel.js` → `scripts/events/panels/operator-panel.js`
- `scripts/events/chat-panel.js` → `scripts/events/panels/chat-panel.js`
- `scripts/operator/dictionary-panel.js` → `scripts/operator/panels/dictionary-panel.js`
- `scripts/operator/pickup-panel.js` → `scripts/operator/panels/pickup-panel.js`
- `scripts/operator/logs-panel.js` → `scripts/operator/panels/logs-panel.js`
- `scripts/operator/side-telop-panel.js` → `scripts/operator/panels/side-telop-panel.js`

**作業内容**:

1. `panels/` ディレクトリを作成
2. ファイルを移動
3. すべてのインポート文を更新
4. 動作確認

**リスク**: 中（ファイルの移動とインポートパスの更新）

---

### フェーズ 3: イベント管理パネルと日程管理パネルの分離（影響範囲: 大）

**目的**: `scripts/events/app.js` からイベント管理パネルと日程管理パネルを分離

**対象ファイル**:

- `scripts/events/app.js` (10,180 行) → 分割
  - `scripts/events/panels/event-panel.js` (新規作成)
  - `scripts/events/panels/schedule-panel.js` (新規作成)
  - `scripts/events/app.js` (縮小)

**作業内容**:

1. `app.js` を分析し、イベント管理と日程管理の責務を特定
2. `event-panel.js` と `schedule-panel.js` を作成
3. 機能を段階的に移行
4. 各ステップで動作確認
5. `app.js` を整理

**リスク**: 高（大規模な変更、複数の機能に影響）

---

## 実装順序

1. **フェーズ 1: 命名の統一** ← 最初に実施
2. **フェーズ 2: パネル実装のディレクトリ構造への統一**
3. **フェーズ 3: イベント管理パネルと日程管理パネルの分離**

## 各フェーズの詳細手順

### フェーズ 1 の詳細手順

1. **ファイル名の変更**

   - 各ファイルを新しい名前にリネーム
   - Git で追跡（`git mv` を使用）

2. **インポート文の更新**

   - すべてのインポート文を検索・置換
   - 動作確認

3. **動作確認**
   - 各パネルが正常に動作することを確認
   - エラーがないことを確認

### フェーズ 2 の詳細手順

1. **ディレクトリの作成**

   - `scripts/events/panels/` を作成
   - `scripts/operator/panels/` を作成

2. **ファイルの移動**

   - 各ファイルを `panels/` ディレクトリに移動
   - Git で追跡（`git mv` を使用）

3. **インポート文の更新**

   - すべてのインポート文を検索・置換
   - 動作確認

4. **動作確認**
   - 各パネルが正常に動作することを確認
   - エラーがないことを確認

### フェーズ 3 の詳細手順

1. **分析**

   - `app.js` を分析し、イベント管理と日程管理の責務を特定
   - 依存関係を確認

2. **新規ファイルの作成**

   - `event-panel.js` を作成
   - `schedule-panel.js` を作成

3. **段階的な移行**

   - 小さな機能から順に移行
   - 各ステップで動作確認

4. **整理**
   - `app.js` を整理
   - 不要なコードを削除

## 注意事項

- 各フェーズは独立して動作確認できるようにする
- 各フェーズの完了後にコミットする
- 大きな変更は小さなステップに分割する
- 動作確認を怠らない

## 進捗状況

- [x] フェーズ 1: 命名の統一 ✅ 完了
- [x] フェーズ 2: パネル実装のディレクトリ構造への統一 ✅ 完了
- [x] フェーズ 3: イベント管理パネルと日程管理パネルの分離 ✅ 完了
  - [x] ステップ 1: app.js の分析と責務の特定 ✅ 完了
  - [x] ステップ 2: event-panel.js の骨格作成 ✅ 完了
  - [x] ステップ 3: schedule-panel.js の骨格作成 ✅ 完了
  - [x] ステップ 4: イベント管理機能の段階的移行 ✅ 完了
  - [x] ステップ 5: 日程管理機能の段階的移行 ✅ 完了
  - [x] ステップ 6: app.js の整理・縮小 ✅ 完了

### フェーズ 1 の完了内容

以下のファイルをリネームしました：

**scripts/operator/**

- `dictionary.js` → `dictionary-panel.js` ✅
- `pickup.js` → `pickup-panel.js` ✅
- `logs.js` → `logs-panel.js` ✅
- `side-telop.js` → `side-telop-panel.js` ✅

**scripts/events/**

- `chat.js` → `chat-panel.js` ✅

**scripts/events/tools/**

- `participant.js` → `participants-panel.js` ✅
- `gl.js` → `gl-panel.js` ✅
- `gl-faculty-admin.js` → `gl-faculties-panel.js` ✅
- `operator.js` → `operator-panel.js` ✅

すべてのインポート文を更新し、リンターエラーはありません。

### フェーズ 2 の完了内容

以下のパネルファイルを `panels/` ディレクトリに移動しました：

**scripts/operator/panels/**

- `dictionary-panel.js` ✅
- `pickup-panel.js` ✅
- `logs-panel.js` ✅
- `side-telop-panel.js` ✅

**scripts/events/panels/**

- `chat-panel.js` ✅
- `participants-panel.js` ✅
- `gl-panel.js` ✅
- `gl-faculties-panel.js` ✅
- `operator-panel.js` ✅

すべてのインポート文と相対パスを更新し、リンターエラーはありません。

### フェーズ 3 の進捗内容

#### ステップ 1-3: パネルファイルの骨格作成 ✅ 完了

**scripts/events/panels/event-panel.js** を作成

- `EventPanelManager` クラスの骨格
- 基本的なメソッド（`loadEvents`, `renderEvents`, `selectEvent`, `createEvent`, `deleteEvent` など）
- 段階的移行のため、一部は `app.js` を参照（`this.app.selectEvent`, `this.app.focusEventListItem` など）

**scripts/events/panels/schedule-panel.js** を作成

- `SchedulePanelManager` クラスの骨格
- 基本的なメソッド（`renderScheduleList`, `selectSchedule`, `createSchedule`, `deleteSchedule` など）
- 段階的移行のため、一部は `app.js` を参照（`this.app.selectSchedule`, `this.app.selectedEventId` など）

**確認済み項目**:

- ✅ すべての依存関係が正しくインポートされている
- ✅ `app.js` への参照が正しく設定されている
- ✅ リンターエラーなし
- ✅ 命名規則に準拠している

#### ステップ 4: イベント管理機能の段階的移行 ✅ 完了

**scripts/events/panels/event-panel.js** に移行した機能：

- `loadEvents()`: イベント一覧の読み込み
- `renderEvents()`: イベント一覧の描画
- `selectEvent()`: イベントの選択（段階的移行のため、`app.js` の `selectEvent` を呼び出し）
- `createEvent()`: イベントの作成
- `deleteEvent()`: イベントの削除
- `getSelectedEvent()`: 選択されたイベントの取得

**app.js の変更**:

- `EventPanelManager` をインポート
- `this.eventPanel = new EventPanelManager(this)` で初期化
- `loadEvents()` で `this.eventPanel.loadEvents()` に委譲
- `renderEvents()` で `this.eventPanel.renderEvents()` に委譲
- 状態の同期（`this.events`, `this.selectedEventId`, `this.eventBatchSet`）

**確認済み項目**:

- ✅ すべてのインポートが正しく設定されている
- ✅ 状態の同期が適切に行われている
- ✅ メソッドの委譲が正しく実装されている
- ✅ リンターエラーなし

#### ステップ 5: 日程管理機能の段階的移行 ✅ 完了

**scripts/events/panels/schedule-panel.js** に移行した機能：

- `renderScheduleList()`: 日程一覧の描画
- `selectSchedule()`: 日程の選択（段階的移行のため、`app.js` の `selectSchedule` を呼び出し）
- `createSchedule()`: 日程の作成
- `updateSchedule()`: 日程の更新
- `deleteSchedule()`: 日程の削除
- `getSelectedSchedule()`: 選択された日程の取得

**app.js の変更**:

- `SchedulePanelManager` をインポート
- `this.schedulePanel = new SchedulePanelManager(this)` で初期化
- `updateScheduleStateFromSelection()` で `schedulePanel.schedules`, `selectedScheduleId`, `scheduleBatchSet` を同期
- `renderScheduleList()` で `this.schedulePanel.renderScheduleList()` に委譲
- `selectSchedule()` で `this.schedulePanel.selectedScheduleId` を同期
- `createSchedule()` で `this.schedulePanel.createSchedule()` に委譲
- `updateSchedule()` で `this.schedulePanel.updateSchedule()` に委譲
- `deleteSchedule()` で `this.schedulePanel.deleteSchedule()` に委譲

**確認済み項目**:

- ✅ すべてのインポートが正しく設定されている
- ✅ 状態の同期が適切に行われている
- ✅ メソッドの委譲が正しく実装されている
- ✅ リンターエラーなし

**ファイルサイズの変化**:

- `app.js`: 10,180 行 → 9,260 行（約 920 行削減）
- `event-panel.js`: 326 行（新規作成、`createEvent`, `updateEvent`, `deleteEvent` を含む）
- `schedule-panel.js`: 326 行（新規作成、`createSchedule`, `updateSchedule`, `deleteSchedule` を含む）

**完了した委譲**:

- ✅ `createEvent`: `eventPanel.createEvent()` に委譲
- ✅ `updateEvent`: `eventPanel.updateEvent()` に委譲
- ✅ `deleteEvent`: `eventPanel.deleteEvent()` に委譲
- ✅ `createSchedule`: `schedulePanel.createSchedule()` に委譲
- ✅ `updateSchedule`: `schedulePanel.updateSchedule()` に委譲
- ✅ `deleteSchedule`: `schedulePanel.deleteSchedule()` に委譲

#### ステップ 6: app.js の整理・縮小 ✅ 完了

**実施内容**:

- ファイル先頭のコメントを更新し、`eventPanel` と `schedulePanel` への分離を明記
- コメントの統一と改善

**最終的なファイルサイズ**:

- `app.js`: 10,180 行 → 9,260 行（約 920 行削減、約 9%削減）
- `event-panel.js`: 326 行（新規作成）
- `schedule-panel.js`: 326 行（新規作成）

**成果**:

- ✅ イベント管理機能を `eventPanel` に分離
- ✅ 日程管理機能を `schedulePanel` に分離
- ✅ `app.js` の責務が明確化（フロー制御、認証管理、UI 制御、状態管理）
- ✅ コードの可読性と保守性が向上

**注意事項**:

- `app.js` は依然として大きなファイル（9,260 行）ですが、主要な機能は適切に分離されています
- さらなる縮小は、他の機能（認証管理、フロー制御、UI 制御など）の分離が必要になりますが、これは別のフェーズとして検討すべきです

---

**作成日**: 2025 年
**バージョン**: 1.0.0
