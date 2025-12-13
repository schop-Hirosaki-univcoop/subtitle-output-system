# 質問フォーム送信エラーの原因

質問フォームの送信がブロックされる問題の根本原因を説明します。

## 問題の概要

質問フォームの送信が以下の 2 つのケースでブロックされていました：

## 原因 1: 認証済み非管理者クライアント

**問題**: `questionIntake/submissions/{token}` の Realtime Database ルールが、`auth == null` の場合、または呼び出し元が管理者の場合のみトークンベースの書き込みを許可していました。そのため、有効なトークンを持っていても、認証済みの非管理者ユーザーは `PERMISSION_DENIED` エラーで失敗していました。

**修正内容**: `auth == null` の制限を削除し、有効で取り消されていない、期限切れでないトークンであれば、認証状態に関わらず送信を作成できるようにしました（管理者は引き続き許可されています）。

## 原因 2: 数値型のトークンフィールド

**問題**: 認証要件を緩和した後も、トークンの `eventId`, `scheduleId`, `participantId` が RTDB で数値として保存されている場合、送信が拒否されていました。バリデーションがこれらの値を厳密に文字列として比較していたため、フォームから送信された `"123"` がトークンレコードの数値 `123` と一致せず、有効なトークンにもかかわらず `PERMISSION_DENIED` が発生していました。

**修正内容**: `eventId`, `scheduleId`, `participantId` のバリデーションを更新し、文字列または数値のいずれも受け入れるようにしました。これにより、型の不一致による誤検出を防止しました。

## 修正の詳細

### Firebase ルールの変更

`firebase.rules.json` の `questionIntake/submissions/{token}/{submissionId}` ルールを以下のように修正：

1. **認証要件の緩和**: `auth == null` の条件を削除し、有効なトークンがあれば認証状態に関わらず書き込みを許可
2. **型の柔軟性**: `eventId`, `scheduleId`, `participantId` のバリデーションで、文字列と数値の両方を許可

### 影響範囲

- 質問フォーム（`scripts/question-form/submission-service.js`）: 送信処理が正常に動作するようになりました
- Firebase セキュリティルール（`firebase.rules.json`）: ルールが更新され、より柔軟な認証と型チェックを実現

## 関連ドキュメント

- `firebase.rules.json`: Firebase セキュリティルールの定義
- `scripts/question-form/submission-service.js`: 質問フォームの送信処理
- `docs/firebase-data-structure.md`: Firebase データ構造の詳細
