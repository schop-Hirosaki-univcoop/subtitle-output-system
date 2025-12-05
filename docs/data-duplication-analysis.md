# データ重複分析と修正完了報告

**状態**: ✅ 実装完了（2025 年）

## 概要

Firebase Realtime Database のデータ構造において、ID があるのにその ID に紐付けられた情報まで一緒に書き込まれている箇所を特定し、修正を完了しました。

**注意**: このドキュメントは正規化前の分析です。実装完了後の状態については、`docs/rtdb-normalization-check.md`を参照してください。

## 1. groupNumber と teamNumber の重複

### 問題点

`groupNumber`と`teamNumber`は実質的に同じ値を保持しており、完全に重複しています。

**確認箇所:**

- `code.gs:961`: `teamNumber: groupNumber` と、同じ値を設定
- `scripts/question-form/app.js:435`: `teamNumber: groupNumber` と、同じ値を設定
- 多くの箇所で `entry.teamNumber || entry.groupNumber` のようにフォールバックとして使用

**影響範囲:**

- `questionIntake/submissions/{token}/{submissionId}`: 両方のフィールドが保存されている
- `questionIntake/tokens/{token}`: 両方のフィールドが存在する可能性がある
- `questions/normal/{uid}`: `group`フィールドとして保存（`groupNumber`を使用）

### 修正提案

1. **統一するフィールド名を決定**: `groupNumber`に統一することを推奨（既存コードで`groupNumber`の使用頻度が高い）
2. **`teamNumber`の使用を削除**: 全ての箇所で`groupNumber`に統一
3. **既存データの移行**: 既存の`teamNumber`データを`groupNumber`に移行するスクリプトを作成

## 2. questionIntake/submissions の重複データ

### 問題点

`questionIntake/submissions/{token}/{submissionId}`には、`token`があるにも関わらず、以下の情報が重複して保存されています：

**重複しているフィールド（token から取得可能）:**

- `eventId` → `questionIntake/tokens/{token}/eventId`
- `scheduleId` → `questionIntake/tokens/{token}/scheduleId`
- `participantId` → `questionIntake/tokens/{token}/participantId`
- `eventName` → `questionIntake/tokens/{token}/eventName`
- `scheduleLabel` → `questionIntake/tokens/{token}/scheduleLabel`
- `scheduleLocation` → `questionIntake/tokens/{token}/scheduleLocation`
- `scheduleDate` → `questionIntake/tokens/{token}/scheduleDate`
- `scheduleStart` → `questionIntake/tokens/{token}/scheduleStart`
- `scheduleEnd` → `questionIntake/tokens/{token}/scheduleEnd`
- `participantName` → `questionIntake/tokens/{token}/displayName`
- `guidance` → `questionIntake/tokens/{token}/guidance`
- `groupNumber`/`teamNumber` → `questionIntake/tokens/{token}/groupNumber`または`teamNumber`

**保持すべきフィールド（submission 固有）:**

- `token`: 必須（トークンへの参照）
- `radioName`: 必須（ユーザー入力）
- `question`: 必須（ユーザー入力）
- `questionLength`: 必須（計算値）
- `genre`: 必須（ユーザー入力）
- `formVersion`: 必須（フォームバージョン）
- `submittedAt`: 必須（提出時刻）
- `status`: 必須（ステータス）
- `uid`: 必須（質問 UID）
- `clientTimestamp`: 任意（クライアント側タイムスタンプ）
- `language`: 任意（メタデータ）
- `userAgent`: 任意（メタデータ）
- `referrer`: 任意（メタデータ）
- `origin`: 任意（メタデータ）

### 修正提案

1. **submissions から重複フィールドを削除**: 上記の重複フィールドを削除し、必要に応じて token から取得するように変更
2. **コードの修正箇所**:
   - `code.gs`: `submissionBase`の作成部分（954-980 行目）
   - `scripts/question-form/submission-service.js`: `buildSubmissionPayload`関数（84-110 行目）
3. **既存データの処理**: 既存の submissions を読み取る際は、token から情報を取得するようにフォールバック処理を追加

## 3. questions/normal の重複データ

### 問題点

`questions/normal/{uid}`にも、`token`があるにも関わらず、以下の情報が重複して保存されています：

**重複しているフィールド（token から取得可能）:**

- `eventId` → `questionIntake/tokens/{token}/eventId`
- `scheduleId` → `questionIntake/tokens/{token}/scheduleId`
- `participantId` → `questionIntake/tokens/{token}/participantId`
- `eventName` → `questionIntake/tokens/{token}/eventName`
- `schedule` (scheduleLabel) → `questionIntake/tokens/{token}/scheduleLabel`
- `scheduleLocation` → `questionIntake/tokens/{token}/scheduleLocation`
- `scheduleDate` → `questionIntake/tokens/{token}/scheduleDate`
- `scheduleStart` → `questionIntake/tokens/{token}/scheduleStart`
- `scheduleEnd` → `questionIntake/tokens/{token}/scheduleEnd`
- `participantName` → `questionIntake/tokens/{token}/displayName`
- `guidance` → `questionIntake/tokens/{token}/guidance`
- `group` (groupNumber) → `questionIntake/tokens/{token}/groupNumber`

**保持すべきフィールド（question 固有）:**

- `uid`: 必須（質問 UID）
- `token`: 必須（トークンへの参照）
- `name`: 必須（ラジオネーム、ユーザー入力）
- `question`: 必須（質問内容、ユーザー入力）
- `genre`: 必須（ジャンル、ユーザー入力）
- `ts`: 必須（タイムスタンプ）
- `updatedAt`: 必須（更新時刻）
- `type`: 必須（タイプ）
- `questionLength`: 任意（質問の長さ）

### 修正提案

1. **questions/normal から重複フィールドを削除**: 上記の重複フィールドを削除
2. **コードの修正箇所**:
   - `scripts/question-form/submission-utils.js`: `buildQuestionRecord`関数（211-250 行目）
3. **表示時の処理**: 質問を表示する際は、token から情報を取得して表示するように変更

## 4. その他の重複可能性

### questionIntake/participants

`questionIntake/participants/{eventId}/{scheduleId}/{participantId}`には、`participantId`があるにも関わらず、以下の情報が重複している可能性があります：

- `eventId`, `scheduleId`はパスに含まれているため、データとしては不要
- ただし、クエリの利便性を考慮すると、保持することも検討可能

### render/events/{eventId}/{scheduleId}

`render/events/{eventId}/{scheduleId}`には、`eventId`と`scheduleId`がパスに含まれているため、データとしては不要な可能性がありますが、表示用のキャッシュとして機能している可能性があります。

## 修正の優先順位

1. **最優先**: `groupNumber`と`teamNumber`の統一（最も明確な重複）
2. **高優先**: `questionIntake/submissions`の重複データ削除（データ容量への影響が大きい）
3. **中優先**: `questions/normal`の重複データ削除（表示頻度が高いため影響が大きい）

## 修正時の注意事項

1. **後方互換性**: 既存のコードが重複フィールドを参照している可能性があるため、段階的な移行が必要
2. **フォールバック処理**: 既存データを読み取る際は、token から情報を取得するフォールバック処理を実装
3. **データ移行**: 既存の重複データを削除する前に、データの整合性を確認
4. **Firebase Rules**: 重複フィールドのバリデーションルールを削除または緩和

## 期待される効果

1. **データ容量の削減**: 重複データを削除することで、データベースの容量を削減
2. **データ整合性の向上**: 単一の情報源（token）から情報を取得することで、データの不整合を防止
3. **保守性の向上**: 重複を排除することで、データ更新時の処理を簡素化
