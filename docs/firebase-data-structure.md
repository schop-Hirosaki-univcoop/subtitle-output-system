# Firebase Realtime Database データ構造ドキュメント

このドキュメントは、`firebase.rules.json`から抽出した全てのデータ構造と各ノードの説明を記載しています。

## 目次

1. [render](#render)
2. [operatorChat](#operatorchat)
3. [glIntake](#glintake)
4. [glAssignments](#glassignments)
5. [operatorPresence](#operatorpresence)
6. [operatorPresenceConsensus](#operatorpresenceconsensus)
7. [questions](#questions)
8. [questionStatus](#questionstatus)
9. [dictionary](#dictionary)
10. [logs](#logs)
11. [questionIntake](#questionintake)
12. [signals](#signals)
13. [admins](#admins)
14. [screens](#screens)

---

## render

レンダリング表示に関連するデータを管理するノード。

### render/events/{eventId}

イベントごとのレンダリング情報。

#### render/events/{eventId}/sessions/{uid}

セッション情報を管理。各ユーザー（uid）ごとにセッションを保持。

**読み取り権限:**

- 管理者（admins に登録されている、または auth.token.admin == true）
- 匿名認証ユーザーで、自分の uid の場合

**書き込み権限:**

- 管理者
- 匿名認証ユーザーで、自分の uid の場合

**データ構造:**

- `uid` (string, 必須): ユーザー ID。パスパラメータの$uid と一致する必要がある
- `sessionId` (string, 必須): セッション ID
- `status` (string, 必須): セッション状態。`active`, `expired`, `ended`, `superseded`のいずれか
- `eventId` (string, 任意): イベント ID
- `scheduleId` (string, 任意): スケジュール ID
- `scheduleLabel` (string, 任意): スケジュールラベル
- `assignment` (object, 任意): 割り当て情報
  - `eventId` (string, 必須): イベント ID
  - `scheduleId` (string, 必須): スケジュール ID
  - `scheduleLabel` (string, 任意): スケジュールラベル
  - `scheduleKey` (string, 任意): スケジュールキー
  - `lockedAt` (number, 任意): ロックされた時刻（タイムスタンプ）
  - `lockedByUid` (string, 任意): ロックしたユーザーの UID
  - `lockedByEmail` (string, 任意): ロックしたユーザーのメールアドレス
  - `lockedByName` (string, 任意): ロックしたユーザーの名前
- `startedAt` (number, 任意): セッション開始時刻（タイムスタンプ）
- `lastSeenAt` (number, 任意): 最終確認時刻（タイムスタンプ）
- `expiresAt` (number, 任意): セッション有効期限（タイムスタンプ）
- `endedAt` (number, 任意): セッション終了時刻（タイムスタンプ）
- `endedReason` (string, 任意): セッション終了理由
- `grantedBy` (string, 任意): セッションを付与したユーザー
- `lastPresenceReason` (string, 任意): 最終プレゼンス更新理由
- `lastPresenceUid` (string, 任意): 最終プレゼンス更新を行ったユーザー ID
- `lastPresenceClientTimestamp` (number, 任意): 最終プレゼンス更新のクライアント側タイムスタンプ
- `presenceUpdatedAt` (number, 任意): プレゼンス更新時刻（タイムスタンプ）

#### render/events/{eventId}/{scheduleId}

スケジュールごとのレンダリング状態。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

##### render/events/{eventId}/{scheduleId}/state

レンダリング状態を管理。

**読み取り権限:** 全員（true）

**書き込み権限:**

- 匿名認証ユーザーで、screens/approved に登録されている場合
- 管理者

**データ構造:**

- `phase` (string, 必須): 表示フェーズ。`visible`, `hidden`, `showing`, `hiding`, `error`のいずれか
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ）
- `nowShowing` (object, 任意): 現在表示中の情報
  - `name` (string, 必須): 表示名
  - `question` (string, 必須): 質問内容
  - `uid` (string, 任意): ユーザー ID
  - `participantId` (string, 任意): 参加者 ID
  - `genre` (string, 任意): ジャンル
  - `pickup` (boolean, 任意): ピックアップフラグ

##### render/events/{eventId}/{scheduleId}/sideTelops

サイドテロップ情報を管理。

**読み取り権限:** 全員（true）

**書き込み権限:**

- 匿名認証ユーザーで、screens/approved に登録されている場合
- 管理者

**データ構造:**

- `right` (object, 任意): 右側のサイドテロップ
  - `items` (array, 任意): テロップ項目の配列
    - `$index` (string): 各項目のテキスト
  - `activeIndex` (number, 任意): 現在アクティブな項目のインデックス
  - `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

##### render/events/{eventId}/{scheduleId}/nowShowing

現在表示中の質問情報。

**読み取り権限:** 全員（true）

**書き込み権限:**

- 匿名認証ユーザー以外、または管理者
- 匿名認証ユーザーで、screens/approved に登録されている場合

**データ構造:**

- `name` (string, 必須): 表示名
- `question` (string, 必須): 質問内容
- `uid` (string, 任意): ユーザー ID
- `participantId` (string, 任意): 参加者 ID
- `genre` (string, 任意): ジャンル
- `pickup` (boolean, 任意): ピックアップフラグ
- `sideTelopRight` (string, 任意): 右側サイドテロップのテキスト

### render/displayPresence

ディスプレイの存在状態を管理。

**読み取り権限:**

- 管理者
- 匿名認証ユーザー以外

#### render/displayPresence/{uid}

各ディスプレイ（uid）の存在状態。

**読み取り権限:**

- 匿名認証ユーザーで、自分の uid の場合
- 管理者

**書き込み権限:**

- 匿名認証ユーザーで、自分の uid の場合
- 管理者

**データ構造:**

- `sessionId` (string, 必須): セッション ID（空文字列不可）
- `uid` (string, 任意): ユーザー ID（パスパラメータの$uid と一致する必要がある）
- `clientTimestamp` (number, 必須): クライアント側タイムスタンプ（または`now`）
- `lastSeenAt` (number, 任意): 最終確認時刻（タイムスタンプ、または`now`）
- `eventId` (string, 任意): イベント ID
- `scheduleId` (string, 任意): スケジュール ID
- `channelEventId` (string, 任意): チャンネルイベント ID
- `channelScheduleId` (string, 任意): チャンネルスケジュール ID
- `assignmentEventId` (string, 任意): 割り当てイベント ID
- `assignmentScheduleId` (string, 任意): 割り当てスケジュール ID
- `status` (string, 任意): 状態
- `reason` (string, 任意): 理由
- `updatedBy` (string, 任意): 更新者
- `version` (string, 任意): バージョン

---

## operatorChat

オペレータ間のチャット機能を管理。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

### operatorChat/messages

チャットメッセージを管理。

**インデックス:** `timestamp`でインデックス化

#### operatorChat/messages/{messageId}

個別のメッセージ。

**データ構造:**

- `uid` (string, 必須): 送信者のユーザー ID
- `displayName` (string, 任意): 表示名
- `email` (string, 任意): メールアドレス
- `message` (string, 必須): メッセージ内容（1 文字以上 1000 文字以下）
- `timestamp` (number, 必須): 送信時刻（タイムスタンプ、または`now`）
- `replyTo` (object, 任意): 返信先メッセージ情報
  - `id` (string, 必須): 返信先メッセージ ID（空文字列不可）
  - `author` (string, 任意): 返信先メッセージの作者
  - `message` (string, 必須): 返信先メッセージの内容（1 文字以上 300 文字以下）

### operatorChat/reads

メッセージの既読状態を管理。

#### operatorChat/reads/{uid}

各ユーザーの既読状態。

**読み取り権限:** 管理者で、かつ自分の uid の場合

**書き込み権限:** 管理者で、かつ自分の uid の場合

**データ構造:**

- `lastReadMessageId` (string, 必須): 最後に読んだメッセージ ID（空文字列不可）
- `lastReadMessageTimestamp` (number, 任意): 最後に読んだメッセージのタイムスタンプ
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

---

## glIntake

GL（グループリーダー）の受付情報を管理。

### glIntake/events/{eventId}

イベントごとの GL 受付設定。

**読み取り権限:**

- 管理者
- slug が存在し、かつ空文字列でない場合（公開情報）

**書き込み権限:** 管理者のみ

**データ構造:**

- `eventId` (string, 任意): イベント ID
- `eventName` (string, 任意): イベント名
- `slug` (string, 任意): URL スラッグ
- `startAt` (string, 任意): 開始時刻
- `endAt` (string, 任意): 終了時刻
- `faculties` (array, 任意): 学部情報の配列
  - `$index` (object): 各学部の情報
    - `faculty` (string, 必須): 学部名
    - `fallbackLabel` (string, 任意): フォールバックラベル
    - `departmentLabel` (string, 任意): 学科ラベル
    - `unitTree` (object, 任意): 単位ツリー構造
      - `label` (string, 必須): ラベル
      - `placeholder` (string, 任意): プレースホルダー
      - `allowCustom` (boolean, 任意): カスタム入力を許可するか
      - `options` (array, 任意): オプションの配列
        - `$optionIndex` (object): 各オプション
          - `label` (string, 必須): ラベル
          - `value` (string, 必須): 値
          - `children` (object, 任意): 子オプション（再帰構造）
            - `label` (string, 必須): ラベル
            - `placeholder` (string, 任意): プレースホルダー
            - `allowCustom` (boolean, 任意): カスタム入力を許可するか
            - `options` (array, 任意): 子オプションの配列
              - `$childIndex` (object): 各子オプション
                - `label` (string, 必須): ラベル
                - `value` (string, 必須): 値
                - `children` (object, 任意): さらに深い階層の子オプション
- `teams` (array, 任意): チーム情報の配列
  - `$teamIndex` (string): チーム名
- `defaultTeams` (array, 任意): デフォルトチーム情報の配列
  - `$teamIndex` (string): チーム名
- `schedules` (array, 任意): スケジュール情報の配列
  - `$scheduleId` (object): 各スケジュール
    - `id` (string, 必須): スケジュール ID
    - `label` (string, 任意): スケジュールラベル
    - `date` (string, 任意): 日付
    - `glTeamCount` (number, 任意): GL チーム数
    - `teams` (array, 任意): チーム情報の配列
      - `$teamIndex` (string): チーム名
- `scheduleTeams` (object, 任意): スケジュールごとのチーム情報
  - `$scheduleId` (object): 各スケジュール
    - `teamCount` (number, 任意): チーム数
    - `teams` (array, 任意): チーム情報の配列
      - `$teamIndex` (string): チーム名
    - `$teamIndex` (string, 任意): 数値形式のチームインデックス（`^[0-9]+$`にマッチ）
- `guidance` (string, 任意): ガイダンステキスト
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `createdAt` (number, 任意): 作成時刻（タイムスタンプ、または`now`）

### glIntake/applications/{eventId}/{applicationId}

GL 応募情報を管理。

**読み取り権限:** 管理者のみ

**書き込み権限:**

- 管理者
- 認証なしで、新規作成時かつ sourceType が'external'の場合

**データ構造:**

- `name` (string, 必須): 名前
- `email` (string, 必須): メールアドレス
- `faculty` (string, 必須): 学部
- `department` (string, 必須): 学科
- `grade` (string, 任意): 学年
- `phonetic` (string, 任意): ふりがな
- `club` (string, 任意): 部活動
- `studentId` (string, 任意): 学生 ID
- `note` (string, 任意): 備考
- `academicPath` (array, 任意): 進路情報の配列
  - `$index` (object): 各進路情報
    - `label` (string, 必須): ラベル
    - `value` (string, 必須): 値
    - `display` (string, 任意): 表示用テキスト
    - `isCustom` (boolean, 任意): カスタム入力かどうか
- `sourceType` (string, 任意): ソースタイプ
- `role` (string, 任意): 役割
- `shifts` (object, 必須): シフト情報（オブジェクト形式）
  - `$scheduleId` (boolean): 各スケジュール ID に対する参加可否
- `eventId` (string, 必須): イベント ID
- `eventName` (string, 必須): イベント名
- `slug` (string, 必須): URL スラッグ
- `createdAt` (number, 必須): 作成時刻（タイムスタンプ、または`now`）
- `updatedAt` (number, 必須): 更新時刻（タイムスタンプ、または`now`）

### glIntake/slugIndex/{slug}

スラッグからイベント ID へのインデックス。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:**

- `$slug` (string, 任意): イベント ID

### glIntake/facultyCatalog

学部カタログ情報を管理。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:**

- `faculties` (array, 必須): 学部情報の配列（構造は`glIntake/events/{eventId}/faculties`と同じ）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `updatedByUid` (string, 任意): 更新者の UID
- `updatedByName` (string, 任意): 更新者の名前

---

## glAssignments

GL の割り当て情報を管理。

### glAssignments/{eventId}/{scheduleId}/{glId}

各 GL の割り当て情報。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

**データ構造:**

- `status` (string, 任意): ステータス
- `teamId` (string, 任意): チーム ID
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `updatedByUid` (string, 任意): 更新者の UID
- `updatedByName` (string, 任意): 更新者の名前

---

## operatorPresence

オペレータの存在状態を管理。

**読み取り権限:** 管理者のみ

### operatorPresence/{eventId}/{sessionId}

各オペレータセッションの存在状態。

**読み取り権限:** 管理者のみ

**書き込み権限:**

- 匿名認証ユーザー以外、または管理者
- 自分の uid の場合のみ書き込み可能

**データ構造:**

- `uid` (string, 必須): ユーザー ID（auth.uid と一致する必要がある）
- `eventId` (string, 必須): イベント ID（パスパラメータの$eventId と一致する必要がある）
- `eventName` (string, 任意): イベント名
- `scheduleId` (string, 任意): スケジュール ID
- `scheduleKey` (string, 任意): スケジュールキー
- `scheduleLabel` (string, 任意): スケジュールラベル
- `selectedScheduleId` (string, 任意): 選択されたスケジュール ID
- `selectedScheduleLabel` (string, 任意): 選択されたスケジュールラベル
- `displayName` (string, 任意): 表示名
- `email` (string, 任意): メールアドレス
- `clientTimestamp` (number, 任意): クライアント側タイムスタンプ
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `reason` (string, 任意): 理由
- `sessionId` (string, 任意): セッション ID（存在する場合、パスパラメータの$sessionId と一致する必要がある）
- `skipTelop` (boolean, 任意): テロップをスキップするか
- `source` (string, 任意): ソース

---

## operatorPresenceConsensus

オペレータの存在状態の合意（コンフリクト解決）を管理。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

### operatorPresenceConsensus/{eventId}

イベントごとの合意情報。

**データ構造:**

- `conflictSignature` (string, 必須): コンフリクト署名（空文字列不可）
- `scheduleKey` (string, 任意): スケジュールキー
- `scheduleId` (string, 任意): スケジュール ID
- `scheduleLabel` (string, 任意): スケジュールラベル
- `scheduleRange` (string, 任意): スケジュール範囲
- `status` (string, 任意): ステータス。`pending`または`resolved`
- `requestedByUid` (string, 任意): リクエストしたユーザーの UID
- `requestedByDisplayName` (string, 任意): リクエストしたユーザーの表示名
- `requestedBySessionId` (string, 任意): リクエストしたセッション ID
- `requestedAt` (number, 任意): リクエスト時刻（タイムスタンプ、または`now`）
- `resolvedByUid` (string, 任意): 解決したユーザーの UID
- `resolvedByDisplayName` (string, 任意): 解決したユーザーの表示名
- `resolvedBySessionId` (string, 任意): 解決したセッション ID
- `resolvedAt` (number, 任意): 解決時刻（タイムスタンプ、または`now`）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

---

## questions

質問データを管理。

**読み取り権限:** 認証済みユーザー

### questions/normal/{uid}

通常の質問。

**書き込み権限:**

- 管理者
- 新規作成時で、トークンが有効な場合（認証なしでも可能）

**データ構造:**

- `uid` (string, 必須): ユーザー ID
- `token` (string, 任意): トークン
- `name` (string, 必須): 名前
- `question` (string, 必須): 質問内容
- `group` (string, 任意): グループ
- `genre` (string, 任意): ジャンル
- `schedule` (string, 任意): スケジュール
- `scheduleStart` (string, 任意): スケジュール開始時刻
- `scheduleEnd` (string, 任意): スケジュール終了時刻
- `scheduleDate` (string, 任意): スケジュール日付
- `scheduleLocation` (string, 任意): スケジュール場所
- `participantId` (string, 任意): 参加者 ID
- `participantName` (string, 任意): 参加者名
- `guidance` (string, 任意): ガイダンス
- `eventId` (string, 任意): イベント ID
- `eventName` (string, 任意): イベント名
- `scheduleId` (string, 任意): スケジュール ID
- `ts` (number, 任意): タイムスタンプ
- `updatedAt` (number, 任意): 更新時刻
- `type` (string, 任意): タイプ（'normal'である必要がある）
- `questionLength` (number, 任意): 質問の長さ

### questions/pickup/{uid}

ピックアップされた質問。

**書き込み権限:** 管理者のみ

**データ構造:**

- `uid` (string, 必須): ユーザー ID
- `name` (string, 必須): 名前
- `question` (string, 必須): 質問内容

---

## questionStatus

質問の状態を管理。

### questionStatus/{eventId}/{uid}

各質問の状態。

**読み取り権限:** 認証済みユーザー

**書き込み権限:**

- 匿名認証ユーザー以外、または管理者
- 匿名認証ユーザーで、screens/approved に登録されている場合
- 新規作成時で、questions/normal または questions/pickup に該当する質問が存在する場合

**データ構造:**

- `answered` (boolean, 任意): 回答済みかどうか（新規作成時は false のみ許可）
- `selecting` (boolean, 任意): 選択中かどうか（新規作成時は false のみ許可）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

---

## dictionary

辞書データを管理。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:** 任意（ルールで制限なし）

---

## logs

ログデータを管理。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

### logs/history

ログ履歴。

**インデックス:** `timestamp`でインデックス化

#### logs/history/{logId}

個別のログエントリ。

**データ構造:**

- `timestamp` (number, 必須): タイムスタンプ
- `User` (string, 必須): ユーザー名
- `Action` (string, 必須): アクション
- `Details` (string, 必須): 詳細
- `UserId` (string, 任意): ユーザー ID
- `Level` (string, 任意): ログレベル
- `Timestamp` (string, 任意): タイムスタンプ（文字列形式）
- `createdAt` (number, 任意): 作成時刻（タイムスタンプ、または`now`）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

---

## questionIntake

質問受付システムのデータを管理。

**読み取り権限:** 管理者のみ

**書き込み権限:** false（個別ノードで制御）

### questionIntake/events/{eventId}

イベント情報。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:**

- `name` (string, 必須): イベント名
- `createdAt` (number, 任意): 作成時刻（タイムスタンプ、または`now`）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

### questionIntake/schedules/{eventId}/{scheduleId}

スケジュール情報。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:**

- `label` (string, 必須): ラベル
- `location` (string, 任意): 場所
- `date` (string, 任意): 日付
- `startAt` (string, 任意): 開始時刻
- `endAt` (string, 任意): 終了時刻
- `participantCount` (number, 任意): 参加者数
- `createdAt` (number, 任意): 作成時刻（タイムスタンプ、または`now`）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `glTeamCount` (number, 任意): GL チーム数
- `teams` (array, 任意): チーム情報の配列
  - `$teamIndex` (string): チーム名

### questionIntake/participants/{eventId}/{scheduleId}/{participantId}

参加者情報。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

**データ構造:**

- `participantId` (string, 必須): 参加者 ID
- `uid` (string, 任意): ユーザー ID
- `legacyParticipantId` (string, 任意): レガシー参加者 ID
- `name` (string, 必須): 名前
- `phonetic` (string, 任意): ふりがな
- `furigana` (string, 任意): ふりがな（別形式）
- `gender` (string, 任意): 性別
- `department` (string, 任意): 学科
- `phone` (string, 任意): 電話番号
- `email` (string, 任意): メールアドレス
- `groupNumber` (string, 必須): グループ番号
- `teamNumber` (string, 任意): チーム番号
- `token` (string, 必須): トークン
- `guidance` (string, 任意): ガイダンス
- `status` (string, 任意): ステータス
- `isCancelled` (boolean, 任意): キャンセル済みかどうか
- `isRelocated` (boolean, 任意): 移動済みかどうか
- `relocationSourceScheduleId` (string, 任意): 移動元スケジュール ID
- `relocationSourceScheduleLabel` (string, 任意): 移動元スケジュールラベル
- `relocationDestinationScheduleId` (string, 任意): 移動先スケジュール ID
- `relocationDestinationScheduleLabel` (string, 任意): 移動先スケジュールラベル
- `relocationDestinationTeamNumber` (string, 任意): 移動先チーム番号
- `mailStatus` (string, 任意): メール送信ステータス
- `mailSentAt` (number, 任意): メール送信時刻
- `mailError` (string, 任意): メール送信エラー
- `mailLastSubject` (string, 任意): 最後に送信したメールの件名
- `mailLastMessageId` (string, 任意): 最後に送信したメールのメッセージ ID
- `mailSentBy` (string, 任意): メール送信者
- `mailLastAttemptAt` (number, 任意): 最後のメール送信試行時刻
- `mailLastAttemptBy` (string, 任意): 最後のメール送信試行者
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）

### questionIntake/tokens/{token}

トークン情報。

**読み取り権限:** 全員（true）

**書き込み権限:** 管理者のみ

**データ構造:**

- `eventId` (string, 必須): イベント ID
- `eventName` (string, 任意): イベント名
- `scheduleId` (string, 必須): スケジュール ID
- `scheduleLabel` (string, 任意): スケジュールラベル
- `scheduleLocation` (string, 任意): スケジュール場所
- `scheduleDate` (string, 任意): スケジュール日付
- `scheduleStart` (string, 任意): スケジュール開始時刻
- `scheduleEnd` (string, 任意): スケジュール終了時刻
- `participantId` (string, 必須): 参加者 ID
- `participantUid` (string, 任意): 参加者のユーザー ID
- `displayName` (string, 必須): 表示名
- `groupNumber` (string, 必須): グループ番号
- `teamNumber` (string, 任意): チーム番号
- `guidance` (string, 任意): ガイダンス
- `expiresAt` (number, 任意): 有効期限（タイムスタンプ）
- `updatedAt` (number, 任意): 更新時刻（タイムスタンプ、または`now`）
- `createdAt` (number, 任意): 作成時刻（タイムスタンプ、または`now`）
- `revoked` (boolean, 任意): 取り消し済みかどうか

### questionIntake/submissions/{token}/{submissionId}

質問提出情報。

**読み取り権限:** false（読み取り不可）

**書き込み権限:**

- トークンが有効で、取り消されていない場合
- 管理者

**データ構造:**

- `radioName` (string, 必須): ラジオネーム（新規作成時のみ、空文字列不可）
- `question` (string, 必須): 質問内容（新規作成時のみ、空文字列不可）
- `questionLength` (number, 必須): 質問の長さ（新規作成時のみ、0 より大きい）
- `genre` (string, 必須): ジャンル（新規作成時のみ、空文字列不可）
- `eventId` (string, 必須): イベント ID（新規作成時のみ、トークンの eventId と一致する必要がある）
- `scheduleId` (string, 必須): スケジュール ID（新規作成時のみ、トークンの scheduleId と一致する必要がある）
- `participantId` (string, 必須): 参加者 ID（新規作成時のみ、トークンの participantId と一致する必要がある）
- `formVersion` (string, 必須): フォームバージョン（新規作成時のみ）
- `submittedAt` (number, 必須): 提出時刻（新規作成時のみ、タイムスタンプ、または`now`）
- `groupNumber` (string, 任意): グループ番号
- `teamNumber` (string, 任意): チーム番号
- `scheduleLabel` (string, 任意): スケジュールラベル
- `scheduleLocation` (string, 任意): スケジュール場所
- `scheduleDate` (string, 任意): スケジュール日付
- `scheduleStart` (string, 任意): スケジュール開始時刻
- `scheduleEnd` (string, 任意): スケジュール終了時刻
- `eventName` (string, 任意): イベント名
- `participantName` (string, 任意): 参加者名
- `guidance` (string, 任意): ガイダンス
- `language` (string, 任意): 言語
- `userAgent` (string, 任意): ユーザーエージェント
- `referrer` (string, 任意): リファラー
- `origin` (string, 任意): オリジン
- `clientTimestamp` (number, 任意): クライアント側タイムスタンプ
- `status` (string, 任意): ステータス（新規作成時は'pending'のみ許可）
- `token` (string, 任意): トークン（新規作成時はパスパラメータの$token と一致する必要がある）
- `uid` (string, 任意): ユーザー ID（新規作成時のみ）

### questionIntake/submissionErrors

提出エラー情報。

**読み取り権限:** 管理者のみ

**書き込み権限:** 管理者のみ

**データ構造:** 任意（ルールで制限なし）

---

## signals

シグナルデータを管理。

**読み取り権限:** 全員（true）

### signals/{signal}

個別のシグナル。

**書き込み権限:** 認証済みユーザー

**データ構造:** 任意（ルールで制限なし）

---

## admins

管理者情報を管理。

**読み取り権限:** false（読み取り不可）

**書き込み権限:** 管理者のみ（自分自身が管理者である場合のみ書き込み可能）

**データ構造:** 任意（ルールで制限なし。通常は`{uid: true}`の形式）

---

## screens

スクリーン（ディスプレイ）の承認情報を管理。

### screens/approved/{uid}

承認されたスクリーンの UID。

**読み取り権限:** 匿名認証ユーザーで、自分の uid の場合

**書き込み権限:** false（書き込み不可）

**データ構造:** 任意（ルールで制限なし。通常は`true`の値）

---

## 権限の説明

### 管理者（Admin）

以下のいずれかの条件を満たすユーザー：

- `admins/{uid}`が`true`に設定されている
- `auth.token.admin`が`true`である

### 匿名認証ユーザー

`auth.token.firebase.sign_in_provider === 'anonymous'`のユーザー。

### 認証済みユーザー

`auth != null`のユーザー（匿名認証を含む）。

---

## インデックス

以下のノードでインデックスが設定されています：

1. `operatorChat/messages`: `timestamp`でインデックス化
2. `logs/history`: `timestamp`でインデックス化

---

## 注意事項

- タイムスタンプフィールドでは、多くの場合`now`（サーバー側の現在時刻）の使用が許可されています
- 多くのノードで`$other`に対して`.validate: false`が設定されており、未定義のフィールドの追加が禁止されています
- 一部のノードでは、新規作成時と更新時で異なるバリデーションルールが適用されます
- トークンベースの認証では、トークンの有効性（存在、取り消し状態、有効期限）が厳密にチェックされます
