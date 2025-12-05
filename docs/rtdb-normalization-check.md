# RTDB 正規化状況チェック（第 3 正規形）

## 概要

Firebase Realtime Database（RTDB）のデータ構造が第 3 正規形（3NF）まで正規化されているかを確認しました。

## 第 3 正規形（3NF）の要件

1. **第 2 正規形（2NF）を満たしている**: 部分関数従属性がない
2. **推移的関数従属性を排除**: 非キー属性が他の非キー属性に依存していない

## 正規化の原則

- **ID のみを保存**: `eventId`, `scheduleId`, `participantId`などの ID のみを保存
- **参照時に取得**: イベント名、スケジュールラベルなどの情報は、正規化された場所から参照時に取得
- **単一の情報源**: 各情報は 1 箇所にのみ保存され、更新時も 1 箇所のみを更新すれば良い

## 正規化されているノード

### ✅ questionIntake/tokens/{token}

**状態**: 完全正規化済み

**保存されているフィールド**:

- `eventId` (必須)
- `scheduleId` (必須)
- `participantId` (必須)
- `groupNumber` (必須)
- `guidance` (任意)
- `expiresAt` (任意)
- `updatedAt` (任意)
- `createdAt` (任意)
- `revoked` (任意)

**削除されたフィールド**（正規化により）:

- `eventName` → `questionIntake/events/{eventId}/name` から取得
- `scheduleLabel` → `questionIntake/schedules/{eventId}/{scheduleId}/label` から取得
- `scheduleLocation` → `questionIntake/schedules/{eventId}/{scheduleId}/location` から取得
- `scheduleDate` → `questionIntake/schedules/{eventId}/{scheduleId}/date` から取得
- `scheduleStart` → `questionIntake/schedules/{eventId}/{scheduleId}/startAt` から取得
- `scheduleEnd` → `questionIntake/schedules/{eventId}/{scheduleId}/endAt` から取得
- `displayName` → `questionIntake/participants/{eventId}/{scheduleId}/{participantId}/name` から取得

**確認箇所**:

- `firebase.rules.json:582-593`
- `docs/firebase-data-structure.md:692-713`

### ✅ questionIntake/submissions/{token}/{submissionId}

**状態**: 完全正規化済み

**保存されているフィールド**:

- `token` (必須)
- `uid` (必須)
- `radioName` (必須)
- `question` (必須)
- `questionLength` (必須)
- `genre` (必須)
- `formVersion` (必須)
- `submittedAt` (必須)
- `status` (必須)
- `clientTimestamp` (任意)
- `language` (任意)
- `userAgent` (任意)
- `referrer` (任意)
- `origin` (任意)

**削除されたフィールド**（正規化により）:

- `eventId`, `scheduleId`, `participantId`, `eventName`, `scheduleLabel`など → `token`から取得可能なため含めない

**確認箇所**:

- `code.gs:968-1002`（コメント: "token から取得できる情報（eventId, scheduleId, participantId, eventName, scheduleLabel 等）は重複のため含めない"）
- `scripts/question-form/submission-service.js:84-98`

### ✅ questions/normal/{uid}

**状態**: 完全正規化済み

**保存されているフィールド**:

- `uid` (必須)
- `token` (必須)
- `name` (必須)
- `question` (必須)
- `genre` (必須)
- `ts` (任意)
- `updatedAt` (任意)
- `type` (必須)
- `questionLength` (任意)

**削除されたフィールド**（正規化により）:

- `eventId`, `scheduleId`, `participantId`, `eventName`, `scheduleLabel`など → `token`から取得可能なため含めない

**確認箇所**:

- `scripts/question-form/submission-utils.js:211-231`（コメント: "token から取得できる情報は context から取得（重複を避けるため submission には含めない）"）

### ✅ glIntake/applications/{eventId}/{applicationId}

**状態**: 完全正規化済み

**保存されているフィールド**:

- `name` (必須)
- `email` (必須)
- `faculty` (必須)
- `department` (必須)
- `shifts` (必須)
- `eventId` (必須)
- `slug` (必須)
- `createdAt` (必須)
- `updatedAt` (必須)
- `grade` (任意)
- `phonetic` (任意)
- `club` (任意)
- `studentId` (任意)
- `note` (任意)
- `academicPath` (任意)
- `sourceType` (任意)
- `role` (任意)

**削除されたフィールド**（正規化により）:

- `eventName` → `questionIntake/events/{eventId}/name` から取得

**確認箇所**:

- `scripts/events/tools/gl.js:2395`（コメント: "完全正規化: eventName は削除（eventId から取得可能）"）

## 正規化されていないノード（第 3 正規形違反）

### ❌ operatorPresence/{eventId}/{sessionId}

**状態**: 正規化されていない

**問題点**:

- `eventName`が保存されている（`eventId`から取得可能）
- `scheduleLabel`が保存されている（`scheduleId`から取得可能）

**保存されているフィールド**:

- `uid` (必須)
- `eventId` (必須)
- `eventName` (任意) ← **正規化違反**
- `scheduleId` (任意)
- `scheduleKey` (任意)
- `scheduleLabel` (任意) ← **正規化違反**
- `selectedScheduleId` (任意)
- `selectedScheduleLabel` (任意)
- `displayName` (任意)
- `email` (任意)
- `clientTimestamp` (任意)
- `updatedAt` (任意)
- `reason` (任意)
- `sessionId` (任意)
- `skipTelop` (任意)
- `source` (任意)

**正規化すべき内容**:

- `eventName`を削除し、`eventId`から`questionIntake/events/{eventId}/name`を参照
- `scheduleLabel`を削除し、`scheduleId`から`questionIntake/schedules/{eventId}/{scheduleId}/label`を参照

**確認箇所**:

- `scripts/operator/app.js:1869-1884`
- `firebase.rules.json:371-388`

### ❌ render/events/{eventId}/sessions/{uid}

**状態**: 正規化されていない

**問題点**:

- `scheduleLabel`が保存されている（`scheduleId`から取得可能）

**保存されているフィールド**:

- `uid` (必須)
- `sessionId` (必須)
- `status` (必須)
- `eventId` (任意)
- `scheduleId` (任意)
- `scheduleLabel` (任意) ← **正規化違反**
- `assignment` (任意)
  - `eventId` (必須)
  - `scheduleId` (必須)
  - `scheduleLabel` (任意) ← **正規化違反**
  - `scheduleKey` (任意)
  - `lockedAt` (任意)
  - `lockedByUid` (任意)
  - `lockedByEmail` (任意)
  - `lockedByName` (任意)
- `startedAt` (任意)
- `lastSeenAt` (任意)
- `expiresAt` (任意)
- `endedAt` (任意)
- `endedReason` (任意)
- `grantedBy` (任意)
- `lastPresenceReason` (任意)
- `lastPresenceUid` (任意)
- `lastPresenceClientTimestamp` (任意)
- `presenceUpdatedAt` (任意)

**正規化すべき内容**:

- `scheduleLabel`を削除し、`scheduleId`から`questionIntake/schedules/{eventId}/{scheduleId}/label`を参照
- `assignment.scheduleLabel`を削除し、`assignment.scheduleId`から参照

**確認箇所**:

- `firebase.rules.json:15-44`

### ❌ render/events/{eventId}/activeSchedule

**状態**: 正規化されていない

**問題点**:

- `scheduleLabel`が保存されている（`scheduleId`から取得可能）

**保存されているフィールド**:

- `eventId` (必須)
- `scheduleId` (必須)
- `scheduleKey` (必須)
- `scheduleLabel` (必須) ← **正規化違反**
- `mode` (必須)
- `lockedAt` (必須)
- `updatedAt` (必須)
- `lockedByUid` (必須)
- `lockedByEmail` (任意)
- `lockedByName` (任意)
- `sessionUid` (任意)
- `sessionId` (任意)
- `expiresAt` (任意)

**正規化すべき内容**:

- `scheduleLabel`を削除し、`scheduleId`から`questionIntake/schedules/{eventId}/{scheduleId}/label`を参照

**確認箇所**:

- `code.gs:3655-3683`

### ⚠️ render/events/{eventId}/{scheduleId}/state/nowShowing

**状態**: テロップ送出状態管理ノード（正規化の例外として許容可能）

**用途**: operator.html で現在送出中のテロップ情報を表示するために使用

**保存されているフィールド**:

- `name` (必須)
- `question` (必須)
- `uid` (任意)
- `participantId` (任意)
- `genre` (任意)
- `pickup` (任意)

**備考**:

- `render/events/{eventId}/{scheduleId}/state`を監視して、`state.nowShowing`を取得し、operator.html の「オンエア:」セクションに表示している
- `eventId`と`scheduleId`はパスに含まれているため、データとしては不要
- テロップ送出の状態管理に使われている重要なノードであり、リアルタイム表示のために必要
- パフォーマンス上の理由で、正規化の例外として許容される可能性がある

**確認箇所**:

- `scripts/operator/display.js:5-58`（`handleRenderUpdate`関数で監視）
- `scripts/operator/app.js:1355-1362`（`startRenderChannelMonitor`関数で監視開始）
- `firebase.rules.json:56-62`

### ⚠️ render/events/{eventId}/{scheduleId}/nowShowing

**状態**: テロップ送出状態管理ノード（正規化の例外として許容可能）

**用途**: operator.html でテロップ送出を行うために使用

**保存されているフィールド**:

- `name` (必須)
- `question` (必須)
- `uid` (任意)
- `participantId` (任意)
- `genre` (任意)
- `pickup` (任意)
- `sideTelopRight` (任意)

**備考**:

- `render/events/{eventId}/{scheduleId}/nowShowing`に直接書き込んで、テロップ送出を行っている
- `eventId`と`scheduleId`はパスに含まれているため、データとしては不要
- テロップ送出の状態管理に使われている重要なノードであり、リアルタイム表示のために必要
- パフォーマンス上の理由で、正規化の例外として許容される可能性がある

**確認箇所**:

- `scripts/operator/questions.js:830-902`（`sendNowShowing`関数で書き込み）
- `scripts/operator/questions.js:1198-1291`（`clearNowShowing`関数でクリア）
- `scripts/operator/side-telop.js:105-110`（サイドテロップ更新）
- `scripts/shared/channel-paths.js:70-73`（`getNowShowingPath`関数）
- `firebase.rules.json:80-91`

## まとめ

### 正規化状況

| ノード                                                  | 状態          | 違反内容                                         |
| ------------------------------------------------------- | ------------- | ------------------------------------------------ |
| `questionIntake/tokens/{token}`                         | ✅ 完全正規化 | -                                                |
| `questionIntake/submissions/{token}/{submissionId}`     | ✅ 完全正規化 | -                                                |
| `questions/normal/{uid}`                                | ✅ 完全正規化 | -                                                |
| `glIntake/applications/{eventId}/{applicationId}`       | ✅ 完全正規化 | -                                                |
| `operatorPresence/{eventId}/{sessionId}`                | ❌ 正規化違反 | `eventName`, `scheduleLabel`が重複保存           |
| `render/events/{eventId}/sessions/{uid}`                | ❌ 正規化違反 | `scheduleLabel`が重複保存                        |
| `render/events/{eventId}/activeSchedule`                | ❌ 正規化違反 | `scheduleLabel`が重複保存                        |
| `render/events/{eventId}/{scheduleId}/state/nowShowing` | ⚠️ 許容可能   | テロップ送出状態管理（operator.html で表示）     |
| `render/events/{eventId}/{scheduleId}/nowShowing`       | ⚠️ 許容可能   | テロップ送出状態管理（operator.html で書き込み） |

### 正規化違反の影響

1. **データ整合性の問題**: `eventName`や`scheduleLabel`が変更された時に、すべての箇所を更新する必要がある
2. **保守性の低下**: 更新処理を忘れると、データの不整合が発生する
3. **データ容量の無駄**: 同じ情報が複数箇所に保存される

### 推奨される対応

1. **operatorPresence**: `eventName`と`scheduleLabel`を削除し、参照時に取得するように変更
2. **render/events/{eventId}/sessions/{uid}**: `scheduleLabel`を削除し、参照時に取得するように変更
3. **render/events/{eventId}/activeSchedule**: `scheduleLabel`を削除し、参照時に取得するように変更

### 注意事項

- `render/events/{eventId}/{scheduleId}/state/nowShowing`と`render/events/{eventId}/{scheduleId}/nowShowing`は、operator.html で現在送出中のテロップ情報を表示・管理するために使われている重要なノードです
  - `state/nowShowing`: operator.html の「オンエア:」セクションに表示するために監視されている
  - `nowShowing`: テロップ送出時に直接書き込まれる
- これらはテロップ送出の状態管理に使われているため、リアルタイム表示のために必要です
- パフォーマンス上の理由で、正規化の例外として許容される可能性があります
- ただし、これらのノードも完全に正規化する場合は、参照時に取得するように変更する必要があります（ただし、リアルタイム表示のパフォーマンスへの影響を考慮する必要があります）
