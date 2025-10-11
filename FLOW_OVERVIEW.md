# HTMLからスプレッドシートまでのデータフローまとめ

## 質問受付フォーム（question-form.html）
- ブラウザで `question-form.html` を開くと、隠しフィールドを含むフォームと `QuestionFormApp` が読み込まれる。`QuestionFormApp` は初期化時にフォームのイベントを登録し、URL のクエリからトークンを抽出する。【F:question-form.html†L17-L63】【F:scripts/question-form/app.js†L118-L146】
- トークンが見つかると、Firebase Realtime Database の `questionIntake/tokens/{token}` から参加者コンテキストを取得し、フォームにイベント名・日程・参加者情報を差し込む。【F:scripts/question-form/context-service.js†L4-L38】【F:scripts/question-form/app.js†L147-L209】
- 利用者が送信すると、入力値を正規化・バリデーションしたうえで、固有の UID を生成し `questions/{uid}` にレコードを書き込む。レコードには班番号やスケジュール情報が含まれ、`group` フィールドとして班番号が保存される。【F:scripts/question-form/app.js†L280-L456】【F:scripts/question-form/app.js†L457-L520】

## 質問管理画面（question-admin.html）
- 管理画面は Firebase 認証後に Apps Script Web API を呼び出すクライアントを構築し、イベントや参加者一覧を取得する。API への POST リクエストは `createApiClient` で生成された `apiPost` を通じて行われる。【F:scripts/question-admin/app.js†L138-L200】
- 参加者 CSV や班番号 CSV を読み込むと、`state.participants` に反映され、未保存状態として扱われる。班番号は `teamNumber`/`groupNumber` フィールドに格納され、`handleSave` が呼ばれると RTDB の `questionIntake/participants` と `questionIntake/tokens` に反映される。【F:scripts/question-admin/app.js†L1420-L1719】
- 保存後は `syncQuestionIntakeToSheet` アクションを呼び出して Apps Script 側の同期処理をトリガーし、スプレッドシートと `questions` データの更新を要求する。【F:scripts/question-admin/app.js†L229-L239】【F:scripts/question-admin/app.js†L1707-L1719】

## Apps Script（code.gs）
- WebApp の `doPost` はアクションに応じて処理を振り分け、`syncQuestionIntakeToSheet` アクションで `syncQuestionIntakeToSheet_()` を実行する。【F:code.gs†L489-L575】
- `syncQuestionIntakeToSheet_()` は RTDB からイベント・日程・参加者・質問データを取得し、参加者シートや質問シートを更新する。班番号の同期では `applyParticipantGroupsToQuestionSheet_()` を呼び出し、参加者の班情報をシートに書き戻す。【F:code.gs†L1569-L1745】
- 今回の修正により `applyParticipantGroupsToQuestionSheet_()` は RTDB `questions` ブランチも参照し、シートに行が存在しない質問でも `group` フィールドを直接補正する。これにより班番号 CSV を適用した際に `questions` ノードへ確実に反映される。【F:code.gs†L1078-L1165】

## スプレッドシート更新フロー
- `applyParticipantGroupsToQuestionSheet_()` が班番号セルを更新したあと、必要に応じて `mirrorQuestionsFromRtdbToSheet_()` が質問データをシートへ取り込み、`mirrorSheetToRtdb_()` がシート内容を RTDB `questions` に書き戻す。【F:code.gs†L1688-L1753】【F:code.gs†L200-320】【F:code.gs†L2238-L2289】
- `mirrorQuestionIntake_()` はスプレッドシートの参加者一覧を読み取り、現在存在しないイベント・日程・参加者・トークンを RTDB から確実に削除するようになった。これにより、過去の班番号情報が残存して新しい参加者へ引き継がれることを防ぐ。【F:code.gs†L1415-L1708】
- これらの処理によって、HTML フォームで入力されたデータや管理画面で付与された班番号がスプレッドシートに集約され、さらに RTDB の `questions` ブランチへ整合的に反映される。【F:code.gs†L1569-L1753】【F:code.gs†L2238-L2289】

## 双方向同期のトリガーと制限
- スプレッドシートから RTDB への反映は、管理画面から `syncQuestionIntakeToSheet` や `mirrorQuestionIntake` を呼び出したときに Apps Script が `mirrorQuestionIntake_()` と `mirrorSheetToRtdb_()` を実行することで行われる。任意のセル編集をフックして自動同期する仕組みは用意されていない。【F:scripts/question-admin/app.js†L229-L239】【F:code.gs†L1415-L1753】【F:code.gs†L2238-L2289】
- 逆方向（RTDB → スプレッドシート）は `syncQuestionIntakeToSheet_()` が明示的に呼ばれたときに実行され、`questions`・`questionIntake` ブランチを読み取ってシートを更新する。RTDB での変更が即時にシートへ伝播する常時監視の仕組みはなく、必要に応じて同期アクションを実行する運用になっている。【F:code.gs†L1569-L1753】
