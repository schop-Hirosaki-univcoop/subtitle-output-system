# データ正規化の提案

**状態**: ✅ 実装完了（2025 年）

完全正規化（アプローチ 1）が実装され、すべてのノードが第 3 正規形（3NF）に準拠しています。詳細は`docs/rtdb-normalization-check.md`を参照してください。

## 実装完了した正規化

以下のノードが完全正規化されました：

- ✅ `operatorPresence/{eventId}/{sessionId}`: `eventName`, `scheduleLabel`を削除
- ✅ `render/events/{eventId}/sessions/{uid}`: `scheduleLabel`を削除
- ✅ `render/events/{eventId}/activeSchedule`: `scheduleLabel`を削除
- ✅ `render/events/{eventId}/{scheduleId}/state/nowShowing`: `name`, `question`, `participantId`, `genre`, `pickup`を削除、`uid`のみ保存
- ✅ `render/events/{eventId}/{scheduleId}/nowShowing`: `name`, `question`, `participantId`, `genre`, `pickup`, `sideTelopRight`を削除、`uid`のみ保存

## 問題点（実装前の状態）

現在のデータ構造では、ID があるにも関わらず、その ID に紐づく情報（イベント名、スケジュールラベルなど）が複数箇所に重複保存されています。これにより以下の問題が発生していました：

1. **データ整合性の問題**: イベント名やスケジュールラベルが変更された時に、すべての箇所を更新する必要がある
2. **保守性の低下**: 更新処理を忘れると、データの不整合が発生する
3. **データ容量の無駄**: 同じ情報が複数箇所に保存される

## 現在の重複箇所

### 1. イベント情報の重複

- **正規化された場所**: `questionIntake/events/{eventId}/name`
- **重複している場所**:
  - `questionIntake/tokens/{token}/eventName`
  - `questionIntake/tokens/{token}/eventId` (パスから取得可能だが、データにも保存)
  - `glIntake/applications/{eventId}/{applicationId}/eventName`
  - `glIntake/applications/{eventId}/{applicationId}/eventId` (パスから取得可能だが、データにも保存)

### 2. スケジュール情報の重複

- **正規化された場所**: `questionIntake/schedules/{eventId}/{scheduleId}/label`
- **重複している場所**:
  - `questionIntake/tokens/{token}/scheduleLabel`
  - `questionIntake/tokens/{token}/scheduleId` (パスから取得可能だが、データにも保存)
  - `questionIntake/tokens/{token}/scheduleLocation`
  - `questionIntake/tokens/{token}/scheduleDate`
  - `questionIntake/tokens/{token}/scheduleStart`
  - `questionIntake/tokens/{token}/scheduleEnd`

### 3. 参加者情報の重複

- **正規化された場所**: `questionIntake/participants/{eventId}/{scheduleId}/{participantId}/name`
- **重複している場所**:
  - `questionIntake/tokens/{token}/displayName`
  - `questionIntake/tokens/{token}/participantId` (パスから取得可能だが、データにも保存)

## 提案する解決策

### アプローチ 1: 完全正規化（推奨）

ID のみを保存し、必要な情報は参照時に取得する。

#### メリット

- データ整合性が保証される
- 更新処理が 1 箇所で済む
- データ容量の削減

#### デメリット

- 読み取り時に複数の参照が必要（パフォーマンスへの影響）
- オフライン対応が難しくなる可能性

#### 実装例

**トークンレコード（正規化後）**:

```json
{
  "eventId": "event-123",
  "scheduleId": "schedule-456",
  "participantId": "participant-789",
  "groupNumber": "1",
  "guidance": "ガイダンステキスト",
  "expiresAt": 1234567890,
  "revoked": false,
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

**参照時の処理**:

```javascript
// トークンからイベント名を取得する関数
async function getEventNameFromToken(database, token) {
  const tokenRecord = await get(
    ref(database, `questionIntake/tokens/${token}`)
  );
  const eventId = tokenRecord.val()?.eventId;
  if (!eventId) return null;

  const eventRecord = await get(
    ref(database, `questionIntake/events/${eventId}`)
  );
  return eventRecord.val()?.name || null;
}
```

### アプローチ 2: ハイブリッド（現実的な妥協案）

重要な情報（ID）は正規化し、表示用の情報（名前、ラベル）はキャッシュとして保存する。

#### メリット

- パフォーマンスと整合性のバランスが取れる
- 表示用情報の更新漏れがあっても、ID から正しい情報を取得可能

#### デメリット

- 完全な正規化ではない
- キャッシュの更新処理が必要

#### 実装例

**トークンレコード（ハイブリッド）**:

```json
{
  "eventId": "event-123", // 必須（正規化）
  "scheduleId": "schedule-456", // 必須（正規化）
  "participantId": "participant-789", // 必須（正規化）
  "eventName": "イベント名", // キャッシュ（任意、表示用）
  "scheduleLabel": "スケジュールラベル", // キャッシュ（任意、表示用）
  "displayName": "参加者名", // キャッシュ（任意、表示用）
  "groupNumber": "1",
  "guidance": "ガイダンステキスト",
  "expiresAt": 1234567890,
  "revoked": false,
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

**参照時の処理**:

```javascript
// キャッシュがあればそれを使用、なければ正規化された場所から取得
async function getEventNameFromToken(database, token) {
  const tokenRecord = await get(
    ref(database, `questionIntake/tokens/${token}`)
  );
  const cached = tokenRecord.val()?.eventName;
  if (cached) return cached; // キャッシュを使用

  // キャッシュがない場合は正規化された場所から取得
  const eventId = tokenRecord.val()?.eventId;
  if (!eventId) return null;

  const eventRecord = await get(
    ref(database, `questionIntake/events/${eventId}`)
  );
  return eventRecord.val()?.name || null;
}
```

### アプローチ 3: 更新時の一括同期

現在の構造を維持しつつ、更新時に一括同期処理を実装する。

#### メリット

- 既存コードへの影響が少ない
- 段階的な移行が可能

#### デメリット

- 更新処理を忘れるリスクが残る
- データ整合性の保証が弱い

#### 実装例

```javascript
// イベント名更新時に、関連するトークンを一括更新
async function updateEventName(eventId, newName) {
  const updates = {};

  // イベント名を更新
  updates[`questionIntake/events/${eventId}/name`] = newName;
  updates[`questionIntake/events/${eventId}/updatedAt`] = Date.now();

  // 関連するトークンを取得
  const tokensRef = ref(database, "questionIntake/tokens");
  const tokensSnapshot = await get(tokensRef);

  tokensSnapshot.forEach((tokenSnapshot) => {
    const token = tokenSnapshot.key;
    const tokenData = tokenSnapshot.val();
    if (tokenData?.eventId === eventId) {
      updates[`questionIntake/tokens/${token}/eventName`] = newName;
      updates[`questionIntake/tokens/${token}/updatedAt`] = Date.now();
    }
  });

  // 一括更新
  await update(ref(database), updates);
}
```

## 実装されたアプローチ

**アプローチ 1（完全正規化）**が実装されました。

### 実装内容

1. **完全正規化の実装**

   - ID のみを保存し、必要な情報は参照時に取得
   - `resolveScheduleLabel`関数を使用してスケジュールラベルを取得
   - `app.state.questionsByUid`（メモリキャッシュ）から質問情報を取得

2. **後方互換性の確保**

   - 既存の非正規化データとの互換性を保つため、フォールバック処理を実装
   - 新規書き込みはすべて正規化された形式

3. **パフォーマンスへの影響**
   - メモリキャッシュの活用により、追加の読み取りはほとんど発生しない
   - 実測結果では、パフォーマンスへの影響は実質的になし

### 実装順序（完了）

1. ✅ **フェーズ 1: 完全正規化の実装**

   - すべてのノードを完全正規化
   - 後方互換性を確保

2. ✅ **フェーズ 2: フォールバック処理の実装**

   - 既存データとの互換性を確保
   - エラーハンドリングを実装

3. ✅ **フェーズ 3: パフォーマンス評価**
   - メモリキャッシュの活用により、追加の遅延なし
   - 実測結果を確認

## 注意事項

1. **後方互換性**: 既存のコードが重複フィールドを参照している可能性があるため、フォールバック処理が必要
2. **パフォーマンス**: 完全正規化の場合、読み取り時の参照回数が増えるため、パフォーマンスへの影響を評価
3. **オフライン対応**: Firebase Realtime Database のオフライン機能を考慮した設計が必要
4. **Firebase Rules**: 正規化後の構造に合わせてルールを更新

## 実現された効果

1. ✅ **データ整合性の向上**: 単一の情報源から情報を取得することで、データの不整合を防止
2. ✅ **保守性の向上**: 更新処理が 1 箇所で済むため、保守が容易になる
3. ✅ **データ容量の削減**: 重複データを削除することで、データベースの容量を削減
4. ✅ **パフォーマンスへの影響なし**: メモリキャッシュの活用により、追加の読み取りはほとんど発生しない

## 実装の詳細

詳細な実装内容については、以下のドキュメントを参照してください：

- `docs/rtdb-normalization-check.md`: 正規化状況の詳細なチェック結果
- `docs/firebase-data-structure.md`: 正規化後のデータ構造の詳細
