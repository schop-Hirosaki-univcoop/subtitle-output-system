# questionStatus 書き込みデバッグのヒント

実際の画面から `questionStatus` 更新が権限エラーになる場合に確認するポイントをまとめました。

## 1. 送信しているパスとペイロードを再確認する

- Realtime Database の multi-path update では、`/questionStatus` 直下に「質問 ID」ごとのノードがあります。
- ブラウザのコンソールで実際に送っているオブジェクト（例: `questionStatus/<eventId>/<questionId>/answered` など）が、想定している質問 ID になっているかを確認してください。
- 既存データがあるノードに対する更新は「既存の値がルールを満たしているか」も判定されるため、数値や真偽値の型ズレがないかもチェックします。

## 2. 認証情報が想定通りかを確認する

- オペレーター画面ではモジュール版 SDK を使っているため、コンソールからは `await window.__opFirebase.getIdToken(window.__opFirebase.auth.currentUser)` か `await firebase.auth().currentUser.getIdTokenResult()` のどちらかで ID トークンを取得できます。
- トークンの `sign_in_provider` が `anonymous` かどうか、`admin` クレームが付いているかを確認します。
- 匿名サインインの場合、`screens/approved/<uid>` が `true` でないと書き込みが拒否されます。`auth.uid` と `screens/approved` の UID が一致しているかを Realtime Database で確認してください。

## 3. ルールシミュレータと実機でデータを合わせる

- ルールシミュレータでは、更新対象ノードの既存データや `screens/approved` の値を手動で設定しないと、本番と条件がずれます。
- 本番と同じ `questions/normal/<questionId>`、`questionStatus/<eventId>/<questionId>`、`screens/approved/<uid>` のデータを一度コピーしてから、同じリクエストを再現すると差分が見つかりやすくなります。

## 4. デバッグログを有効化する

- ブラウザコンソールで `firebase.database.enableLogging(true);` もしくは `window.__opFirebase.enableLogging(true);` を実行すると、どのパスへのリクエストが拒否されているか詳細ログが出ます。
- ログに表示されたパスが想定とズレていないか（例: 余分なスラッシュや質問 ID の取り違え）を確認してください。

## 5. 既存ノードのバリデーションを確認する

- 既存の `questionStatus/<eventId>/<questionId>` に不要なプロパティが残っていると、子のバリデーションで拒否されます。
- 必要なら `questionStatus/<eventId>/<questionId>` ノードを一旦削除（または `answered`, `selecting`, `updatedAt` だけにする）してから、改めて送出ボタンを試すと原因切り分けになります。

## 6. 時刻フィールドの扱い

- `updatedAt` は数値か `now` でのみ許可されます。`{'.sv': 'timestamp'}` を送る場合は書き込み時に数値へ展開されているか確認してください。

## 7. イベント ID の確認

- `questionStatus` はイベントスコープパス（`questionStatus/<eventId>/<uid>`）を使用します。
- 送信しているパスに正しい `eventId` が含まれているか確認してください。

これらを順に確認すると、ルールシミュレータでは通るが実機で拒否されるケースの多くを特定できます。

## 関連ドキュメント

- `firebase.rules.json`: Firebase セキュリティルールの定義
- `docs/firebase-data-structure.md`: Firebase データ構造の詳細
- `docs/rtdb-normalization-check.md`: RTDB 正規化状況の確認
