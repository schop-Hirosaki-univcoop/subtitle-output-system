# Pick Up Question の日程毎ステータス管理 修正計画

## 問題の概要

現在、`questionStatus`はイベントベースで管理されており、構造は`questionStatus/${eventId}/${uid}`となっています。

Pick Up Question（PUQ）は日程に関係なく同じ UID を使用するため、同じイベント内で一度答えたら、別の日程では答えられないという問題が発生しています。

**例:**

- 3/1 に PUQ01 を答えた場合、`questionStatus/${eventId}/PUQ01`が`answered: true`になる
- 3/2 に同じ PUQ01 に答えようとしても、既に`answered: true`のため答えられない

## 修正方針

Pick Up Question の`questionStatus`を日程毎に管理するように変更します。

**新しい構造:**

- 通常質問: `questionStatus/${eventId}/${uid}` （変更なし）
- Pick Up Question: `questionStatus/${eventId}/${scheduleId}/${uid}` （scheduleId を追加）

## 影響範囲と修正箇所

### 1. パス生成関数の修正

#### `scripts/shared/channel-paths.js`

- `getQuestionStatusPath`関数を修正
- **重要**: 現在の実装（行 163）では、`isPickup`パラメータを受け取っているが使用されていない
- `isPickup`と`scheduleId`を受け取り、pickupquestion の場合は scheduleId を含める

**変更内容:**

```javascript
export function getQuestionStatusPath(
  eventId,
  isPickup = false,
  scheduleId = ""
) {
  const eventKey = normalizeEventId(eventId);
  if (!eventKey) {
    throw new Error("eventId is required for questionStatus path");
  }
  if (isPickup) {
    const scheduleKey = normalizeScheduleId(scheduleId);
    // scheduleIdが空の場合は`__default_schedule__`が使用される
    // これは意図した動作かどうかを確認する必要がある
    return `questionStatus/${eventKey}/${scheduleKey}`;
  }
  return `questionStatus/${eventKey}`;
}
```

**現在の実装との差分:**

- 現在: `scheduleId`パラメータが存在しない
- 現在: `isPickup`パラメータは存在するが使用されていない（コメントに「将来の拡張のために残しています」と記載）

#### `scripts/operator/firebase.js`

- `getQuestionStatusRef`関数を修正
- **重要**: 現在の実装（行 114）では、`scheduleId`パラメータが存在しない
- `scheduleId`パラメータを追加し、`getQuestionStatusPath`に渡す

**変更内容:**

```javascript
export function getQuestionStatusRef(
  eventId = "",
  isPickup = false,
  scheduleId = ""
) {
  const path = getQuestionStatusPath(eventId, isPickup, scheduleId);
  return ref(database, path);
}
```

**現在の実装との差分:**

- 現在: `scheduleId`パラメータが存在しない
- 現在: `getQuestionStatusPath(eventId, isPickup)`を呼び出している（`scheduleId`を渡していない）

### 2. Operator 側の修正

#### `scripts/operator/questions.js`

以下の関数で、pickupquestion の場合は scheduleId を渡すように修正:

- `handleDisplay` (行 873): 送出時に scheduleId を取得して渡す
  - **重要**: 現在`getQuestionStatusRef(eventId, isPickup)`を呼び出しているが、scheduleId を渡していない
  - 行 937 で`updateSelectingStatus`を呼び出す際、pickupquestion の場合は scheduleId を引数で渡す必要がある（Google Apps Script 側の修正も必要）
  - 行 958, 973 で`updateStatus`を呼び出す際も、pickupquestion の場合は scheduleId を渡す必要がある（Google Apps Script 側の修正も必要）
- `handleUnanswer` (行 1039): 未回答に戻す際に scheduleId を取得して渡す
  - **重要**: 現在`getQuestionStatusRef(eventId, isPickup)`を呼び出しているが、scheduleId を渡していない
  - 行 1043 で`updateStatus`を呼び出す際も、pickupquestion の場合は scheduleId を渡す必要がある（Google Apps Script 側の修正も必要）
- `handleBatchUnanswer` (行 1177): 一括未回答に戻す際に scheduleId を取得して渡す
  - **重要**: 各質問について scheduleId を取得し、pickupquestion の場合は scheduleId を含める
  - 現在は`getQuestionStatusRef(questionEventId, isPickup)`を呼び出しているが、scheduleId を渡していない
  - **実装方針**: 一括操作では現在の scheduleId を使用する（`resolveNowShowingReference(app)`から取得）
    - pickupquestion の場合は、現在選択中の scheduleId に対応する questionStatus のみを更新する
    - 各質問について異なる scheduleId を取得する必要はない（一括操作は現在のコンテキストで実行される）
  - scheduleId ごとにグループ化する必要がある（通常質問と pickupquestion を区別）
  - 行 1205 で`batchUpdateStatus`を呼び出す際も、pickupquestion の場合は scheduleId を渡す必要がある（Google Apps Script 側の修正も必要）
- `clearNowShowing` (行 1300, 1329): 送出クリア時に scheduleId を取得して渡す
  - **重要**: 行 1298 で selectingItems を処理する際、pickupquestion の場合は scheduleId を取得する必要がある
    - 現在の実装（行 1300）では、`getQuestionStatusRef(eventId, isPickup)`を呼び出しているが、scheduleId を渡していない
    - `resolveNowShowingReference(app)`または`app.getActiveChannel()`から scheduleId を取得する必要がある
  - 行 1329 で previousNowShowing を処理する際も、pickupquestion の場合は scheduleId を取得する必要がある
    - 現在の実装（行 1329）では、`getQuestionStatusRef(eventId, isPickup)`を呼び出しているが、scheduleId を渡していない
    - `resolveNowShowingReference(app)`または`app.getActiveChannel()`から scheduleId を取得する必要がある
  - 行 1337 で`updateStatus`を呼び出す際も、pickupquestion の場合は scheduleId を渡す必要がある（Google Apps Script 側の修正も必要）

**修正パターン:**

```javascript
const isPickup = app.state.selectedRowData.isPickup === true;
const { eventId, scheduleId } = resolveNowShowingReference(app);
const statusRef = getQuestionStatusRef(eventId, isPickup, scheduleId);
```

#### `scripts/operator/panels/pickup-panel.js`

以下の関数で、pickupquestion 作成・更新・削除時に scheduleId を取得して渡す:

- `handlePickupAddSubmit` (行 914): pickupquestion 追加時
  - **重要**: 現在`getQuestionStatusRef(eventId, false)`となっているが、`isPickup = true`にする必要がある
  - **重要**: 行 915 で`questionStatus`に書き込む際、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${uid}`のパスを使用する必要がある
  - `updates[`${statusRef.key}/${uid}`]`という書き方で、`statusRef.key`が`questionStatus/${eventId}/${scheduleId}`を返すことを確認
  - scheduleId を取得して渡す必要がある
  - `app.getActiveChannel()`または`resolveNowShowingReference(app)`から scheduleId を取得する
  - **重要**: scheduleId が空の場合の処理を考慮する必要がある
    - `normalizeScheduleId("")`は`__default_schedule__`を返すため、空の場合は`__default_schedule__`が使用される
    - または、scheduleId が空の場合は pickupquestion の作成を拒否する（エラーを返すか、ユーザーに警告を表示する）
- `handlePickupEditSubmit` (行 1036): pickupquestion 更新時
  - **重要**: 現在`getQuestionStatusRef(eventId, false)`となっているが、`isPickup = true`にする必要がある
  - **重要**: pickupquestion の更新時は、全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`を更新する必要がある可能性がある
  - または、現在の scheduleId に対応する`questionStatus/${eventId}/${scheduleId}/${uid}`のみを更新する
  - **実装方針**: 質問テキストの更新は全日程に影響するが、`questionStatus`の`updatedAt`は現在の scheduleId のみを更新する
  - 行 1040 で`updates[`${statusRef.key}/${state.uid}/updatedAt`]`を使用しているが、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${uid}/updatedAt`のパスを使用する必要がある
  - scheduleId を取得して渡す必要がある
  - `app.getActiveChannel()`または`resolveNowShowingReference(app)`から scheduleId を取得する
- `confirmPickupDelete` (行 1172): pickupquestion 削除時
  - **重要**: 現在`getQuestionStatusRef(eventId, false)`となっているが、`isPickup = true`にする必要がある
  - **重要**: pickupquestion の削除時は、全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`から削除する必要がある
  - `questionStatus/${eventId}`配下のすべての scheduleId ノードを走査し、該当する uid を削除する
  - 行 1173 で`updates[`${statusRef.key}/${trimmedUid}`] = null`を使用しているが、pickupquestion の場合は全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`を削除する必要がある
  - **実装方針**: 全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`を削除する
    - `questionStatus/${eventId}`配下のすべてのキーを走査し、scheduleId ノードの場合は配下の uid を削除する
    - または、`questionStatus/${eventId}`配下のすべての scheduleId ノードを取得し、各 scheduleId ノードの配下から uid を削除する
  - または、現在の scheduleId に対応する`questionStatus/${eventId}/${scheduleId}/${uid}`のみを削除する（実装方針による）
  - scheduleId を取得して渡す必要がある（現在の scheduleId のみを削除する場合）
  - `app.getActiveChannel()`または`resolveNowShowingReference(app)`から scheduleId を取得する

**修正パターン:**

```javascript
// app.getActiveChannel()から取得する方法
const { eventId = "", scheduleId = "" } = app.getActiveChannel() || {};
const statusRef = getQuestionStatusRef(eventId, true, scheduleId); // isPickup = true

// または、resolveNowShowingReferenceを使用する方法（questions.jsと同様）
import { resolveNowShowingReference } from "../questions.js";
const { eventId, scheduleId } = resolveNowShowingReference(app);
const statusRef = getQuestionStatusRef(eventId, true, scheduleId);
```

**注意:** pickupquestion の作成・更新・削除時は、現在選択中の日程（`app.getActiveChannel()`）を使用します。

#### `scripts/operator/app.js`

- `startQuestionStatusStream` (行 1769): questionStatus の監視を修正

  - **重要**: 現在`getQuestionStatusRef(eventId, false)`を呼び出しているが、pickupquestion の場合は現在の scheduleId に対応する questionStatus を監視する必要がある
  - 通常質問: `questionStatus/${eventId}`を監視（変更なし）
  - Pick Up Question: `questionStatus/${eventId}/${scheduleId}`を監視（現在の scheduleId のみ）
  - 日程変更時に`startQuestionStatusStream`を再呼び出しする必要がある（`refreshChannelSubscriptions`などから呼び出す）

- `applyQuestionStatusSnapshot` (行 1819): questionStatus のスナップショット処理を修正

  - **推奨アプローチ**: 現在の scheduleId に対応する status のみを保持する
    - `startQuestionStatusStream`で現在の scheduleId に対応する questionStatus のみを監視するため、`applyQuestionStatusSnapshot`では受け取ったスナップショットをそのまま処理すればよい
    - 通常質問と pickupquestion を区別する必要はない（既に適切なパスから取得している）
  - **重要**: 現在の実装では単一のスナップショットを処理しているが、推奨アプローチでは通常質問と pickupquestion の両方のリスナーから呼び出される可能性がある
  - **重要**: 現在の実装では、`next`を新規作成してから`this.state.questionStatusByUid = next`に設定しているため、通常質問と pickupquestion の status をマージするには、既存の`questionStatusByUid`とマージする必要がある
  - **実装方針**:
    - オプション 1: `applyQuestionStatusSnapshot`を修正し、既存の`questionStatusByUid`とマージする（推奨）
      - `const current = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();`
      - `Object.entries(branch).forEach(([uidKey, record]) => { ... current.set(...) ... });`
      - `this.state.questionStatusByUid = current;`
    - オプション 2: 通常質問と pickupquestion の status を別々に保持し、`rebuildQuestions`で統合する
    - **推奨**: オプション 1（既存の status を保持しつつ、新しい status を追加・更新する）
  - `questionStatusByUid`の構造は`Map<uid, status>`のまま（変更不要）

- `rebuildQuestions` (行 1922): 質問リストの再構築時に修正
  - **推奨アプローチ**: 変更不要
    - `questionStatusByUid`には既に現在の scheduleId に対応する status が含まれているため、`statusMap.get(uid)`で取得すればよい
    - pickupquestion の場合も、現在の scheduleId に対応する status が既に`questionStatusByUid`に含まれている

**修正方針:**

- 通常質問: `questionStatus/${eventId}`を監視（変更なし）
- Pick Up Question: 全日程の`questionStatus/${eventId}/${scheduleId}`を監視するか、現在選択中の日程のみを監視

**推奨アプローチ:**

- Pick Up Question の場合は、全日程の questionStatus を監視する
- `questionStatus/${eventId}`配下の全 scheduleId を監視するリスナーを追加
- または、`questionStatus/${eventId}`を監視し、配下の全 scheduleId ノードを走査する

**実装例（推奨アプローチ: 現在の scheduleId のみを監視）:**

```javascript
startQuestionStatusStream() {
  if (this.questionStatusUnsubscribe) this.questionStatusUnsubscribe();
  const eventId = String(this.state?.activeEventId || "").trim();
  if (!eventId) {
    console.debug("startQuestionStatusStream: activeEventId is empty; skipping subscription.");
    this.questionStatusUnsubscribe = null;
    return;
  }

  const { scheduleId = "" } = this.getActiveChannel() || {};
  const normalizedScheduleId = scheduleId ? normalizeScheduleId(scheduleId) : "";

  // 通常質問用: questionStatus/${eventId}を監視
  const normalStatusRef = getQuestionStatusRef(eventId, false);

  // Pick Up Question用: questionStatus/${eventId}/${scheduleId}を監視（現在のscheduleIdのみ）
  const pickupStatusRef = normalizedScheduleId
    ? getQuestionStatusRef(eventId, true, normalizedScheduleId)
    : null;

  // 通常質問のリスナーを設定
  const normalUnsubscribe = onValue(normalStatusRef, (snapshot) => {
    const value = snapshot.val() || {};
    // 通常質問のstatusのみを抽出（pickupquestionのscheduleIdノードを除外）
    const normalStatus = {};
    const questionsByUid = this.state.questionsByUid instanceof Map ? this.state.questionsByUid : new Map();
    Object.entries(value).forEach(([key, status]) => {
      // keyがscheduleId形式でない場合（通常質問のUID）のみを処理
      // pickupquestionのscheduleIdノードを除外するため、`questions/pickup/${key}`の存在を確認
      const questionRecord = questionsByUid.get(key);
      const isPickup = questionRecord && questionRecord.pickup === true;
      // keyがscheduleId形式（通常質問のUIDではない）かどうかを判定
      // scheduleIdノードの場合は、その配下にuidが含まれる構造になっている
      const isScheduleIdNode = status && typeof status === "object" &&
        !(status.answered !== undefined || status.selecting !== undefined) &&
        Object.values(status).some(v => v && typeof v === "object" && (v.answered !== undefined || v.selecting !== undefined));

      if (!isPickup && !isScheduleIdNode && status && typeof status === "object" && (status.answered !== undefined || status.selecting !== undefined)) {
        normalStatus[key] = status;
      }
    });
    // 通常質問のstatusを適用（pickupquestionのstatusとマージされる）
    this.applyQuestionStatusSnapshot(normalStatus);
  });

  // Pick Up Questionのリスナーを設定（scheduleIdがある場合のみ）
  let pickupUnsubscribe = null;
  if (pickupStatusRef) {
    pickupUnsubscribe = onValue(pickupStatusRef, (snapshot) => {
      const value = snapshot.val() || {};
      // pickupquestionのstatusを適用（通常質問のstatusとマージされる）
      // 通常質問とpickupquestionは異なるuidを持つため、上書きされることはない
      this.applyQuestionStatusSnapshot(value);
    });
  }

  this.questionStatusUnsubscribe = () => {
    normalUnsubscribe();
    if (pickupUnsubscribe) {
      pickupUnsubscribe();
    }
  };
}
```

**重要**: `refreshChannelSubscriptions`関数内で`startQuestionStatusStream`を呼び出す必要がある

- `scripts/operator/channel-manager.js`の`refreshChannelSubscriptions`関数（行 1248）を確認
- 現在は`startQuestionStatusStream`を呼び出していない可能性がある
- 日程変更時に`startQuestionStatusStream`を再呼び出しする処理を追加する必要がある

**注意**: 日程変更時に`startQuestionStatusStream`を再呼び出しする必要がある（`refreshChannelSubscriptions`などから呼び出す）

**より簡潔なアプローチ:**

- `questionStatus/${eventId}`を監視し、通常質問と Pick Up Question を区別する
- Pick Up Question の場合は、`questions/pickup/${uid}`の存在を確認し、該当する scheduleId 配下の questionStatus を参照する

**重要な修正点:**

- `applyQuestionStatusSnapshot`関数を修正して、pickupquestion の場合は全日程の status をマージする必要がある
- 現在の実装では単一のスナップショットしか処理していないため、pickupquestion の場合は全日程の status を統合する必要がある
- `rebuildQuestions`関数で、pickupquestion の場合は現在の scheduleId に対応する status を取得する必要がある

### 3. Google Apps Script 側の修正

#### `code.gs`

以下の関数を修正:

- `processQuestionSubmissionQueue_` (行 5154): キュー処理時に pickupquestion の場合は scheduleId を含める
  - **注意**: この関数は通常質問のみを処理している（`questions/normal/${uid}`に保存）
  - pickupquestion は operator 側で作成されるため、この関数では処理されない可能性が高い
  - ただし、将来的に pickupquestion がキューに含まれる可能性がある場合は、修正が必要
- `updateAnswerStatus` (行 5216): ステータス更新時に pickupquestion の場合は scheduleId を含める
  - **重要**: 現在の実装では、`questionStatus/${eventId}/${uid}`のパスを使用している
  - pickupquestion の場合は、`questionStatus/${eventId}/${scheduleId}/${uid}`のパスを使用する必要がある
  - scheduleId を引数で受け取る必要がある可能性がある（token から取得できない場合）
- `batchUpdateStatus` (行 5280): 一括更新時に pickupquestion の場合は scheduleId を含める
- `updateSelectingStatus` (行 5329): 選択中ステータス更新時に pickupquestion の場合は scheduleId を含める
  - **重要**: 現在の実装では、`questionStatus/${eventId}/${normalizedUid}`をチェックしているが、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`をチェックする必要がある
  - **重要**: pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}`配下を走査する必要がある
  - **重要**: pickupquestion には token がない場合があるため、scheduleId を引数で受け取る必要がある
  - 現在の実装では、`questionStatus/${eventId}`配下のすべてのキーを走査しているが、pickupquestion の場合は scheduleId ノードを除外する必要がある
  - `questionStatus/${eventId}`配下で、key が scheduleId か uid かを区別する方法が必要
    - 方法 1: `questions/pickup/${key}`の存在を確認（pickupquestion の UID の場合）
    - 方法 2: `questions/normal/${key}`の存在を確認（通常質問の UID の場合）
    - 方法 3: status オブジェクトの構造を確認（scheduleId ノードの場合は配下に uid が含まれる）
  - **重要**: `statusBranch[normalizedUid]`のチェック（行 5335）は、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`をチェックする必要がある
  - または、`questionStatus/${eventId}`配下の全 scheduleId ノードを走査し、該当する uid の selecting 状態を更新する
- `clearSelectingStatus` (行 5397): 選択中ステータスクリア時に pickupquestion の場合は scheduleId を含める（全日程を走査する必要がある）
  - **重要**: 現在の実装では、`questionStatus/${eventId}`配下のすべてのキーを走査しているが、scheduleId ノードと uid ノードを区別していない
  - `questionStatus/${eventId}`配下で、key が scheduleId か uid かを区別する方法が必要
  - pickupquestion の場合は、`questionStatus/${eventId}/${scheduleId}`配下のすべての uid を走査する必要がある
  - 現在の実装（行 5399）では、`statusBranch`のすべてのキーを走査しているが、scheduleId ノードの場合は配下の uid を走査する必要がある
- `editQuestionText` (行 5453): 質問テキスト編集時に pickupquestion の場合は scheduleId を含める
  - **重要**: 現在の実装では、`questionStatus/${eventId}/${normalizedUid}`のパスを使用している（行 5453）
  - pickupquestion の場合は、`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`のパスを使用する必要がある
  - pickupquestion には token がない場合があるため、scheduleId を引数で受け取る必要がある可能性がある
  - または、`questionStatus/${eventId}`配下の全 scheduleId ノードを走査し、該当する uid の updatedAt を更新する
- `batchUpdateStatus` (行 5244): 一括更新時に pickupquestion の場合は scheduleId を含める
  - **重要**: 各 uid について、pickupquestion かどうかを判定し、pickupquestion の場合は token から scheduleId を取得する
  - pickupquestion には token がない場合があるため、scheduleId を取得できない場合はスキップするか、エラーを返す

**修正パターン:**

```javascript
// pickupquestionかどうかを判定
const isPickup = branch === "pickup";
let statusPath;
if (isPickup) {
  // scheduleIdを取得（tokenから取得するか、引数で受け取る）
  const scheduleId = String(tokenRecord.scheduleId || "").trim();
  if (!scheduleId) {
    throw new Error(
      `UID: ${normalizedUid} has no scheduleId for pickup question.`
    );
  }
  statusPath = `questionStatus/${eventId}/${scheduleId}/${normalizedUid}`;
} else {
  statusPath = `questionStatus/${eventId}/${normalizedUid}`;
}
```

**`clearSelectingStatus`関数の特別な注意点:**

- pickupquestion の場合は、全日程の`questionStatus/${eventId}/${scheduleId}`を走査する必要がある
- `questionStatus/${eventId}`配下の各 scheduleId ノードを確認し、selecting 状態をクリアする

**修正例:**

```javascript
function clearSelectingStatus() {
  const token = getFirebaseAccessToken_();
  const normalQuestions = fetchRtdb_("questions/normal", token) || {};
  const pickupQuestions = fetchRtdb_("questions/pickup", token) || {};
  const allQuestions = { ...normalQuestions, ...pickupQuestions };

  const updates = {};
  let changed = false;
  const now = Date.now();
  const processedEventIds = new Set();

  Object.entries(allQuestions).forEach(([uid, questionRecord]) => {
    // ... 既存の処理 ...
    const { branch } = resolveQuestionRecordForUid_(uid, token);
    const isPickup = branch === "pickup";

    if (isPickup) {
      // pickupquestionの場合は、全日程のquestionStatusを走査
      const eventStatusBranch =
        fetchRtdb_(`questionStatus/${eventId}`, token) || {};
      Object.entries(eventStatusBranch).forEach(([key, value]) => {
        // keyがscheduleIdの場合（通常質問のUIDではない場合）
        if (value && typeof value === "object" && value[uid]) {
          const scheduleStatus = value[uid];
          if (scheduleStatus && scheduleStatus.selecting === true) {
            changed = true;
            updates[
              `questionStatus/${eventId}/${key}/${uid}/selecting`
            ] = false;
            updates[`questionStatus/${eventId}/${key}/${uid}/updatedAt`] = now;
            updates[`questions/pickup/${uid}/selecting`] = false;
            updates[`questions/pickup/${uid}/updatedAt`] = now;
          }
        }
      });
    } else {
      // 通常質問の処理（既存のまま）
      // ...
    }
  });

  // ...
}
```

**`updateSelectingStatus`関数の修正:**

- pickupquestion の場合は、scheduleId を含むパスを使用する
- ただし、pickupquestion には token がない場合があるため、scheduleId を引数で受け取る必要がある可能性がある
- または、`questionStatus/${eventId}`配下の全 scheduleId ノードを走査し、該当する uid の selecting 状態を更新する

**修正例:**

```javascript
function updateSelectingStatus(uid, scheduleId) {
  // ... 既存の処理 ...
  const { branch } = resolveQuestionRecordForUid_(normalizedUid, token);
  const isPickup = branch === "pickup";

  if (isPickup) {
    // pickupquestionの場合は、scheduleIdが必要
    // scheduleIdが引数で渡されていない場合は、questionStatus/${eventId}配下の全scheduleIdを走査
    if (!scheduleId) {
      // 全日程を走査する処理
      const eventStatusBranch =
        fetchRtdb_(`questionStatus/${eventId}`, token) || {};
      Object.entries(eventStatusBranch).forEach(([key, value]) => {
        // keyがscheduleIdの場合（通常質問のUIDではない場合）
        if (value && typeof value === "object" && value[normalizedUid]) {
          const scheduleStatus = value[normalizedUid];
          // このscheduleIdのselecting状態を更新
          // ...
        }
      });
    } else {
      // scheduleIdが指定されている場合は、そのscheduleIdのみを更新
      const statusPath = `questionStatus/${eventId}/${scheduleId}/${normalizedUid}`;
      // ...
    }
  } else {
    // 通常質問の処理（既存のまま）
    // ...
  }
}
```

**`batchUpdateStatus`関数の修正:**

- 各 uid について、pickupquestion かどうかを判定
- pickupquestion の場合は、token から scheduleId を取得する
- token がない場合はスキップするか、エラーを返す

**修正例:**

```javascript
normalized.forEach((uid) => {
  const { branch, record } = resolveQuestionRecordForUid_(uid, token);
  if (!record || !branch) {
    return;
  }

  const isPickup = branch === "pickup";
  let statusPath;

  if (isPickup) {
    // pickupquestionの場合はscheduleIdが必要
    const questionToken = String(record.token || "").trim();
    if (!questionToken) {
      // tokenがない場合はスキップ（pickupquestionにはtokenがない場合がある）
      return;
    }
    const tokenRecord =
      fetchRtdb_(`questionIntake/tokens/${questionToken}`, token) || {};
    const scheduleId = String(tokenRecord.scheduleId || "").trim();
    if (!scheduleId) {
      // scheduleIdが取得できない場合はスキップ
      return;
    }
    statusPath = `questionStatus/${eventId}/${scheduleId}/${uid}`;
  } else {
    // 通常質問の処理（既存のまま）
    statusPath = `questionStatus/${eventId}/${uid}`;
  }

  // ... 既存の処理 ...
});
```

### 4. Firebase セキュリティルールの修正

#### `firebase.rules.json`

- `questionStatus/${eventId}/${scheduleId}/${uid}`の構造に対応するルールを追加
- 既存の`questionStatus/${eventId}/${uid}`のルールは維持（通常質問用）

**修正内容:**

```json
"questionStatus": {
  "$eventId": {
    ".read": "auth != null",
    ".write": "auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))",
    // 通常質問用（既存）
    "$uid": {
      ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (!data.exists() && newData.hasChildren(['answered','selecting']) && newData.child('answered').isBoolean() && newData.child('answered').val() == false && newData.child('selecting').isBoolean() && newData.child('selecting').val() == false && (!newData.child('updatedAt').exists() || newData.child('updatedAt').isNumber()) && (root.child('questions/normal').child($uid).exists() || root.child('questions/pickup').child($uid).exists()))",
      "answered": {
        ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isBoolean() && newData.val() == false && (root.child('questions/normal').child($uid).exists() || root.child('questions/pickup').child($uid).exists()))",
        ".validate": "newData.isBoolean() || !newData.exists()"
      },
      "selecting": {
        ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isBoolean() && newData.val() == false && (root.child('questions/normal').child($uid).exists() || root.child('questions/pickup').child($uid).exists()))",
        ".validate": "newData.isBoolean() || !newData.exists()"
      },
      "updatedAt": {
        ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isNumber() && (root.child('questions/normal').child($uid).exists() || root.child('questions/pickup').child($uid).exists()))",
        ".validate": "newData.isNumber() || newData.val() == now || !newData.exists()"
      },
      "$other": { ".validate": false }
    },
    // Pick Up Question用（新規追加）
    "$scheduleId": {
      ".read": "auth != null",
      ".write": "auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))",
      "$uid": {
        ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (!data.exists() && newData.hasChildren(['answered','selecting']) && newData.child('answered').isBoolean() && newData.child('answered').val() == false && newData.child('selecting').isBoolean() && newData.child('selecting').val() == false && (!newData.child('updatedAt').exists() || newData.child('updatedAt').isNumber()) && root.child('questions/pickup').child($uid).exists())",
        "answered": {
          ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isBoolean() && newData.val() == false && root.child('questions/pickup').child($uid).exists())",
          ".validate": "newData.isBoolean() || !newData.exists()"
        },
        "selecting": {
          ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isBoolean() && newData.val() == false && root.child('questions/pickup').child($uid).exists())",
          ".validate": "newData.isBoolean() || !newData.exists()"
        },
        "updatedAt": {
          ".write": "(auth != null && ((auth.token.firebase.sign_in_provider != 'anonymous' || root.child('admins').child(auth.uid).val() == true || auth.token.admin == true) || (auth.token.firebase.sign_in_provider == 'anonymous' && root.child('screens/approved').child(auth.uid).val() == true))) || (newData.isNumber() && root.child('questions/pickup').child($uid).exists())",
          ".validate": "newData.isNumber() || newData.val() == now || !newData.exists()"
        },
        "$other": { ".validate": false }
      }
    }
  }
}
```

**重要**: 既存の`$uid`ルールは通常質問用として維持し、`$scheduleId/$uid`ルールを pickupquestion 用として追加する。これにより、通常質問と pickupquestion の両方のパス構造に対応できる。

### 5. テストファイルの修正

#### `tests/channel-paths.test.mjs`

- `getQuestionStatusPath`のテストを修正
- pickupquestion の場合のテストケースを追加

**追加テストケース:**

```javascript
test("getQuestionStatusPath builds pickup question status paths with scheduleId", () => {
  assert.equal(
    getQuestionStatusPath("event-1", true, "schedule-1"),
    "questionStatus/event-1/schedule-1"
  );
  assert.equal(
    getQuestionStatusPath("event-1", true, ""),
    "questionStatus/event-1/__default_schedule__"
  );
  assert.throws(
    () => getQuestionStatusPath(null, true, "schedule-1"),
    /eventId is required/
  );
});
```

### 6. ドキュメントの更新

#### `docs/firebase-data-structure.md`

- `questionStatus`の構造説明を更新
- Pick Up Question 用の新しいパス構造を追加

## 実装の注意点

### 1. 後方互換性

- 既存の通常質問のパス構造は変更しない
- 既存の pickupquestion の questionStatus データは移行が必要（または段階的移行）

### 2. scheduleId の取得方法

- Operator 側:
  - `app.getActiveChannel()`から取得（推奨）
  - または`resolveNowShowingReference(app)`から取得（`questions.js`で使用）
- Google Apps Script 側:
  - token から取得（`questionIntake/tokens/${token}`の`scheduleId`フィールド）
  - または引数で受け取る

### 3. questionStatus の監視

- **推奨アプローチ**: 現在選択中の日程のみを監視し、日程変更時に再購読する
  - `startQuestionStatusStream`で、現在の scheduleId に対応する questionStatus のみを監視する
  - 日程変更時に`startQuestionStatusStream`を再呼び出しする（`refreshChannelSubscriptions`などから呼び出す）
  - これにより、パフォーマンスを維持しつつ、必要な status のみを監視できる
- **代替アプローチ**: 全日程の questionStatus を監視する
  - `questionStatus/${eventId}`配下の全 scheduleId ノードを監視する
  - パフォーマンスへの影響を考慮する必要がある

### 4. データ移行

- 既存の`questionStatus/${eventId}/${uid}`形式の pickupquestion データを、`questionStatus/${eventId}/${scheduleId}/${uid}`形式に移行するスクリプトが必要
- 移行時は、どの日程で答えたかを判断する必要がある（履歴データから推測するか、デフォルトの scheduleId を使用）
- 移行スクリプトは`code.gs`の`migrateLegacyPaths_`関数を参考に作成する

### 5. questionStatus の統合方法

- pickupquestion の場合、全日程の questionStatus を統合して表示する必要がある
- 現在の scheduleId に対応する status を優先的に使用し、他の日程の status は参照のみ
- `questionStatusByUid`の構造を変更するか、scheduleId をキーにした Map 構造を追加する必要がある

### 6. エラーハンドリング

- scheduleId が取得できない場合のエラーハンドリング
- pickupquestion の作成時に scheduleId が未設定の場合の処理
  - **重要**: `normalizeScheduleId("")`は`__default_schedule__`を返す
  - pickupquestion の作成時に`scheduleId`が空の場合、`__default_schedule__`が使用される可能性がある
  - これは意図した動作かどうかを確認する必要がある
  - **推奨**: pickupquestion の作成時は`scheduleId`が必須であることを確認し、空の場合はエラーを返すか、ユーザーに警告を表示する
- 既存の pickupquestion データとの互換性（移行期間中の処理）
- `handlePickupAddSubmit`で`statusRef.key`を使用しているが、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}`のパスが返されることを確認
  - `updates[`${statusRef.key}/${uid}`]`という書き方で、`questionStatus/${eventId}/${scheduleId}/${uid}`のパスが正しく構築されることを確認

### 7. データ構造の変更

- `questionStatusByUid`の構造を変更する必要がある可能性がある
- pickupquestion の場合は、scheduleId をキーにした Map 構造（`Map<scheduleId, Map<uid, status>>`）を追加するか、現在の scheduleId に対応する status のみを保持する
- **推奨アプローチ**: 現在の scheduleId に対応する status のみを保持し、日程変更時に再取得する
  - `startQuestionStatusStream`で、現在の scheduleId に対応する questionStatus のみを監視する
  - 日程変更時に`startQuestionStatusStream`を再呼び出しして、新しい scheduleId に対応する questionStatus を監視する
  - `applyQuestionStatusSnapshot`では、受け取ったスナップショットをそのまま`questionStatusByUid`に設定する（現在の scheduleId に対応する status のみ）
  - `rebuildQuestions`では変更不要（`questionStatusByUid`に現在の scheduleId に対応する status が既に含まれている）

### 8. パフォーマンスへの影響

- pickupquestion の全日程を監視する場合、データ量が増える可能性がある
- 監視するリスナーの数を最小限に抑える（`questionStatus/${eventId}`を 1 つのリスナーで監視）
- 不要な再レンダリングを避けるため、status の変更を適切にフィルタリングする

### 9. その他の確認事項

- `scripts/question-admin/managers/participant-manager.js`では questionStatus がコメントアウトされているが、将来的に使用される可能性があるため、修正が必要になる可能性がある
- events 側（`scripts/events/app.js`）での questionStatus の扱いを確認（現在は使用されていない可能性が高い）
- `scripts/operator/display.js`は questionStatus を直接参照していないため、修正は不要
- `scripts/question-form/submission-service.js`は通常質問のみを処理するため、修正は不要（pickupquestion は operator 側で作成される）
  - **確認**: 行 173 で`questionStatus/${eventId}/${questionUid}`のパスを直接構築しているが、これは通常質問のみを処理するため問題ない
- `code.gs`の`processQuestionSubmissionQueue_`関数（行 5154）は通常質問のみを処理するため、修正は不要
  - **確認**: 行 5154 で`questionStatus/${entryEventId.trim()}/${uid}`のパスを直接構築しているが、これは通常質問のみを処理するため問題ない

### 10. Google Apps Script API の修正

#### API エンドポイントの修正（`code.gs`行 697-711）

- **行 697-699**: `updateStatus` API エンドポイント

  - 現在: `updateAnswerStatus(req.uid, req.status, req.eventId)`を呼び出している
  - **修正**: pickupquestion の場合は`scheduleId`パラメータを受け取り、`updateAnswerStatus`に渡す必要がある
  - `req.scheduleId`を追加し、`updateAnswerStatus(req.uid, req.status, req.eventId, req.scheduleId)`に変更

- **行 706-708**: `updateSelectingStatus` API エンドポイント

  - 現在: `updateSelectingStatus(req.uid, principal)`を呼び出している
  - **修正**: pickupquestion の場合は`scheduleId`パラメータを受け取り、`updateSelectingStatus`に渡す必要がある
  - `req.scheduleId`を追加し、`updateSelectingStatus(req.uid, req.scheduleId, principal)`に変更

- **行 703-705**: `batchUpdateStatus` API エンドポイント
  - 現在: `batchUpdateStatus(req.uids, req.status, principal)`を呼び出している
  - **修正**: pickupquestion の場合は`scheduleId`パラメータを受け取る必要がある可能性がある
  - `req.scheduleId`を追加し、`batchUpdateStatus(req.uids, req.status, req.scheduleId, principal)`に変更（または各 uid について scheduleId を取得する）

#### Operator 側の API 呼び出しの修正

- **`scripts/operator/questions.js`行 937**: `handleDisplay`関数での`updateSelectingStatus`呼び出し

  - 現在: `app.api.fireAndForgetApi({ action: "updateSelectingStatus", uid: app.state.selectedRowData.uid })`
  - **修正**: pickupquestion の場合は`scheduleId`を追加する必要がある
  - `app.api.fireAndForgetApi({ action: "updateSelectingStatus", uid: app.state.selectedRowData.uid, scheduleId })`

- **`scripts/operator/questions.js`行 958, 973, 1043, 1337**: `updateStatus`呼び出し

  - 現在: `app.api.fireAndForgetApi({ action: "updateStatus", uid: ..., status: ..., eventId })`
  - **修正**: pickupquestion の場合は`scheduleId`を追加する必要がある可能性がある
  - `app.api.fireAndForgetApi({ action: "updateStatus", uid: ..., status: ..., eventId, scheduleId })`

- **`scripts/operator/questions.js`行 1205**: `batchUpdateStatus`呼び出し
  - 現在: `app.api.fireAndForgetApi({ action: "batchUpdateStatus", uids: uidsToUpdate, status: false })`
  - **修正**: pickupquestion の場合は`scheduleId`を追加する必要がある可能性がある
  - `app.api.fireAndForgetApi({ action: "batchUpdateStatus", uids: uidsToUpdate, status: false, scheduleId })`

#### Google Apps Script 関数のシグネチャ修正

- **`updateAnswerStatus`関数（行 5198）**: `scheduleId`パラメータを追加

  - `function updateAnswerStatus(uid, status, eventId, scheduleId)`
  - pickupquestion の場合は`scheduleId`を使用してパスを構築する

- **`updateSelectingStatus`関数（行 5304）**: `scheduleId`パラメータを追加

  - `function updateSelectingStatus(uid, scheduleId, principal)`
  - pickupquestion の場合は`scheduleId`を使用してパスを構築する

- **`batchUpdateStatus`関数（行 5244）**: `scheduleId`パラメータを追加（または各 uid について scheduleId を取得する）
  - `function batchUpdateStatus(uids, status, scheduleId, principal)`
  - または、各 uid について pickupquestion かどうかを判定し、pickupquestion の場合は token から scheduleId を取得する

### 11. questionStatus パスでの通常質問と pickupquestion の区別方法

- `questionStatus/${eventId}`配下で、key が scheduleId か uid かを区別する必要がある
- **区別方法**:
  - 方法 1: `questions/pickup/${key}`の存在を確認（pickupquestion の UID の場合）
  - 方法 2: `questions/normal/${key}`の存在を確認（通常質問の UID の場合）
  - 方法 3: status オブジェクトの構造を確認
    - scheduleId ノード: 配下に uid が含まれる構造（`{ [uid]: { answered, selecting } }`）
    - 通常質問の UID ノード: 直接 status が含まれる構造（`{ answered, selecting }`）
- **推奨**: 方法 1 と方法 2 を組み合わせる（`resolveQuestionRecordForUid_`関数を使用）

### 12. 重要な修正箇所のまとめ（見落としやすい箇所）

#### `scripts/operator/panels/pickup-panel.js`

- **行 914**: `handlePickupAddSubmit`関数
  - `getQuestionStatusRef(eventId, false)` → `getQuestionStatusRef(eventId, true, scheduleId)`に修正
  - 行 915 で`questionStatus`に書き込む際、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${uid}`のパスを使用する必要がある
  - `updates[`${statusRef.key}/${uid}`]`という書き方で、`statusRef.key`が`questionStatus/${eventId}/${scheduleId}`を返すことを確認
  - pickupquestion なのに`isPickup = false`になっているのは明らかなバグ
  - scheduleId が空の場合の処理を考慮する必要がある（エラーを返すか、`__default_schedule__`を使用する）
- **行 1036**: `handlePickupEditSubmit`関数
  - `getQuestionStatusRef(eventId, false)` → `getQuestionStatusRef(eventId, true, scheduleId)`に修正
  - pickupquestion の更新時は、全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`を更新する必要がある可能性がある
  - 行 1040 で`updates[`${statusRef.key}/${state.uid}/updatedAt`]`を使用しているが、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${uid}/updatedAt`のパスを使用する必要がある
  - 質問テキストの更新は全日程に影響するが、`questionStatus`の`updatedAt`は現在の scheduleId のみを更新する
- **行 1172**: `confirmPickupDelete`関数
  - `getQuestionStatusRef(eventId, false)` → `getQuestionStatusRef(eventId, true, scheduleId)`に修正
  - pickupquestion の削除時は、全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`から削除する必要がある
  - 行 1173 で`updates[`${statusRef.key}/${trimmedUid}`] = null`を使用しているが、pickupquestion の場合は全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`を削除する必要がある
  - `questionStatus/${eventId}`配下のすべての scheduleId ノードを走査し、各 scheduleId ノードの配下から uid を削除する処理を追加

#### `scripts/operator/questions.js`

- **行 873**: `getQuestionStatusRef(eventId, isPickup)` → `getQuestionStatusRef(eventId, isPickup, scheduleId)`に修正
- **行 1039**: `getQuestionStatusRef(eventId, isPickup)` → `getQuestionStatusRef(eventId, isPickup, scheduleId)`に修正
- **行 1177**: `getQuestionStatusRef(questionEventId, isPickup)` → `getQuestionStatusRef(questionEventId, isPickup, scheduleId)`に修正（各質問について scheduleId を取得）
- **行 1300, 1329**: `getQuestionStatusRef(eventId, isPickup)` → `getQuestionStatusRef(eventId, isPickup, scheduleId)`に修正

#### `scripts/operator/app.js`

- **行 1769**: `startQuestionStatusStream`関数で、pickupquestion の場合は現在の scheduleId に対応する questionStatus を監視する処理を追加
- **行 1819**: `applyQuestionStatusSnapshot`関数で、pickupquestion の場合は全日程の status をマージする処理を追加（推奨アプローチでは変更不要）
  - **重要**: 通常質問と pickupquestion の両方のリスナーから呼び出される可能性がある
  - 通常質問と pickupquestion は異なる uid を持つため、`Map`の`set`操作で上書きされることはない
  - **重要**: 現在の実装では、`next`を新規作成してから`this.state.questionStatusByUid = next`に設定しているため、通常質問と pickupquestion の status をマージするには、既存の`questionStatusByUid`とマージする必要がある
  - **実装方針**: `applyQuestionStatusSnapshot`を修正し、既存の`questionStatusByUid`とマージするようにする
    - `const current = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();`
    - `Object.entries(branch).forEach(([uidKey, record]) => { ... current.set(...) ... });`
    - `this.state.questionStatusByUid = current;`
  - これにより、通常質問と pickupquestion の status が正しく統合される
- **行 1922**: `rebuildQuestions`関数で、pickupquestion の場合は現在の scheduleId に対応する status を取得する処理を追加（推奨アプローチでは変更不要）

#### `scripts/operator/channel-manager.js`

- **行 1248**: `refreshChannelSubscriptions`関数で、`startQuestionStatusStream`を呼び出す処理を追加
  - 日程変更時に questionStatus の監視を更新するため
  - `this.app.startQuestionStatusStream()`を呼び出す処理を追加

#### `code.gs`

- **行 697-699**: `updateStatus` API エンドポイントで、`scheduleId`パラメータを受け取り、`updateAnswerStatus`に渡す
- **行 703-705**: `batchUpdateStatus` API エンドポイントで、`scheduleId`パラメータを受け取る（または各 uid について scheduleId を取得する）
- **行 706-708**: `updateSelectingStatus` API エンドポイントで、`scheduleId`パラメータを受け取り、`updateSelectingStatus`に渡す
- **行 5198**: `updateAnswerStatus`関数のシグネチャを修正し、`scheduleId`パラメータを追加
  - pickupquestion の場合は scheduleId を含むパスを使用する
- **行 5244**: `batchUpdateStatus`関数のシグネチャを修正し、`scheduleId`パラメータを追加（または各 uid について scheduleId を取得する）
- **行 5304**: `updateSelectingStatus`関数のシグネチャを修正し、`scheduleId`パラメータを追加
  - pickupquestion の場合は scheduleId ノードを除外する処理を追加
  - `questionStatus/${eventId}`配下の key が scheduleId か uid かを区別する必要がある
  - `statusBranch[normalizedUid]`のチェック（行 5335）は、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`をチェックする必要がある
- **行 5397**: `clearSelectingStatus`関数で、pickupquestion の場合は scheduleId ノードを区別する処理を追加
  - `questionStatus/${eventId}`配下の key が scheduleId か uid かを区別する必要がある
  - scheduleId ノードの場合は、配下の uid を走査する必要がある
- **行 5453**: `editQuestionText`関数で、pickupquestion の場合は scheduleId を含むパスを使用する
  - `questionStatus/${eventId}/${normalizedUid}`のパス（行 5453）を、pickupquestion の場合は`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`に変更する必要がある

## 実装順序

1. パス生成関数の修正（`channel-paths.js`, `firebase.js`）
2. テストファイルの修正とテスト実行
3. Operator 側の修正（`questions.js`, `pickup-panel.js`, `app.js`）
4. Google Apps Script 側の修正（`code.gs`）
5. Firebase セキュリティルールの修正（`firebase.rules.json`）
6. ドキュメントの更新
7. データ移行スクリプトの作成と実行（必要に応じて）

## 検証項目

- [ ] 通常質問の questionStatus が正常に動作する
- [ ] Pick Up Question を 3/1 で答えた後、3/2 でも同じ PUQ に答えられる
- [ ] Pick Up Question の questionStatus が日程毎に正しく管理される
- [ ] questionStatus の監視が正常に動作する（通常質問と pickupquestion の両方）
- [ ] 一括操作（一括未回答に戻す等）が正常に動作する
- [ ] Firebase セキュリティルールが正常に動作する
- [ ] pickupquestion の作成・更新・削除時に scheduleId が正しく設定される
- [ ] `clearSelectingStatus`が pickupquestion の全日程を正しく処理する
- [ ] `editQuestionText`が pickupquestion の questionStatus を正しく更新する
- [ ] `applyQuestionStatusSnapshot`が pickupquestion の全日程 status を正しく統合する
- [ ] `rebuildQuestions`が pickupquestion の現在 scheduleId に対応する status を正しく取得する
- [ ] `batchUpdateStatus`が pickupquestion の scheduleId を正しく取得して更新する
- [ ] `updateSelectingStatus`が pickupquestion の scheduleId を正しく処理する（token がない場合も含む）
- [ ] `handleBatchUnanswer`が pickupquestion の scheduleId を正しく取得して更新する
- [ ] `handleDisplay`の`updateSelectingStatus`呼び出しが pickupquestion の場合に正しく動作する
- [ ] `pickup-panel.js`の`getQuestionStatusRef`呼び出しが`isPickup = true`になっている
- [ ] `pickup-panel.js`の各関数で scheduleId が正しく取得・渡されている
- [ ] `clearNowShowing`の selectingItems 処理で pickupquestion の scheduleId が正しく取得されている
- [ ] `applyQuestionStatusSnapshot`が pickupquestion の全日程 status を正しく統合している
- [ ] `rebuildQuestions`が pickupquestion の現在 scheduleId に対応する status を正しく取得している
- [ ] `startQuestionStatusStream`が現在の scheduleId に対応する questionStatus を正しく監視している
- [ ] 日程変更時に`startQuestionStatusStream`が再呼び出しされている
- [ ] `handleBatchUnanswer`が各質問について scheduleId を正しく取得している（pickupquestion の場合）
- [ ] `handleBatchUnanswer`が scheduleId ごとに正しくグループ化している（pickupquestion の場合）
- [ ] `refreshChannelSubscriptions`が`startQuestionStatusStream`を呼び出している
- [ ] `startQuestionStatusStream`が通常質問と pickupquestion の scheduleId ノードを正しく区別している
- [ ] `updateSelectingStatus`が pickupquestion の scheduleId ノードを正しく除外している
- [ ] `updateAnswerStatus`が pickupquestion の scheduleId を正しく取得して使用している
- [ ] `updateSelectingStatus`が pickupquestion の token がない場合を正しく処理している
- [ ] `updateSelectingStatus`が pickupquestion の`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`を正しくチェックしている
- [ ] `clearSelectingStatus`が pickupquestion の scheduleId ノードを正しく区別している
- [ ] `clearSelectingStatus`が pickupquestion の全日程の selecting 状態を正しくクリアしている
- [ ] `editQuestionText`が pickupquestion の`questionStatus/${eventId}/${scheduleId}/${normalizedUid}`を正しく更新している
- [ ] `clearNowShowing`の selectingItems 処理で pickupquestion の scheduleId が正しく取得されている（行 1300）
- [ ] `clearNowShowing`の previousNowShowing 処理で pickupquestion の scheduleId が正しく取得されている（行 1329）
- [ ] `updateStatus` API エンドポイントが`scheduleId`パラメータを受け取っている
- [ ] `updateSelectingStatus` API エンドポイントが`scheduleId`パラメータを受け取っている
- [ ] `batchUpdateStatus` API エンドポイントが`scheduleId`パラメータを受け取っている（または各 uid について scheduleId を取得している）
- [ ] `handleDisplay`の`updateSelectingStatus`呼び出しで pickupquestion の場合は`scheduleId`が渡されている（行 937）
- [ ] `handleDisplay`の`updateStatus`呼び出しで pickupquestion の場合は`scheduleId`が渡されている（行 958, 973）
- [ ] `handleUnanswer`の`updateStatus`呼び出しで pickupquestion の場合は`scheduleId`が渡されている（行 1043）
- [ ] `handleBatchUnanswer`の`batchUpdateStatus`呼び出しで pickupquestion の場合は`scheduleId`が渡されている（行 1205）
- [ ] `clearNowShowing`の`updateStatus`呼び出しで pickupquestion の場合は`scheduleId`が渡されている（行 1337）
- [ ] `updateAnswerStatus`関数が`scheduleId`パラメータを受け取っている
- [ ] `updateSelectingStatus`関数が`scheduleId`パラメータを受け取っている
- [ ] `batchUpdateStatus`関数が`scheduleId`パラメータを受け取っている（または各 uid について scheduleId を取得している）
- [ ] `getQuestionStatusPath`関数が`scheduleId`パラメータを受け取っている
- [ ] `getQuestionStatusRef`関数が`scheduleId`パラメータを受け取っている
- [ ] `handlePickupAddSubmit`で pickupquestion の`questionStatus`が正しいパス（`questionStatus/${eventId}/${scheduleId}/${uid}`）に書き込まれている（行 915）
- [ ] `handlePickupEditSubmit`で pickupquestion の`questionStatus`が正しいパスに更新されている
- [ ] `confirmPickupDelete`で pickupquestion の`questionStatus`が正しいパスから削除されている（全日程または現在の scheduleId）
- [ ] `handlePickupAddSubmit`で scheduleId が空の場合の処理が正しく実装されている（エラーを返すか、`__default_schedule__`を使用する）
- [ ] `handlePickupAddSubmit`で`statusRef.key`が正しいパス（`questionStatus/${eventId}/${scheduleId}`）を返していることを確認
- [ ] `handlePickupEditSubmit`で`statusRef.key`が正しいパス（`questionStatus/${eventId}/${scheduleId}`）を返していることを確認
- [ ] `confirmPickupDelete`で全日程の`questionStatus/${eventId}/${scheduleId}/${uid}`が正しく削除されている
- [ ] `normalizeScheduleId("")`が`__default_schedule__`を返す場合の動作が意図通りであることを確認
- [ ] `applyQuestionStatusSnapshot`が通常質問と pickupquestion の両方のリスナーから呼び出された場合に正しくマージされている
- [ ] `applyQuestionStatusSnapshot`が既存の`questionStatusByUid`とマージしている（既存の status を保持しつつ、新しい status を追加・更新している）
- [ ] `startQuestionStatusStream`の通常質問と pickupquestion の両方のリスナーが同時に動作している
- [ ] Firebase セキュリティルールの`$scheduleId/$uid`ルールが既存の`$uid`ルールと同じ構造になっている
- [ ] Firebase セキュリティルールの`$scheduleId/$uid`ルールで`root.child('questions/pickup').child($uid).exists()`のチェックが正しく実装されている
