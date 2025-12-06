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
- [ ] フェーズ 3: イベント管理パネルと日程管理パネルの分離

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

---

**作成日**: 2025 年
**バージョン**: 1.0.0
