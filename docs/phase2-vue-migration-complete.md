# フェーズ 2: Vue.js 移行完了レポート

## 概要

フェーズ 2（ビルドツール導入）が完了し、Vue.js 3 を使用した質問カードの表示が正常に動作するようになりました。

## 完了日

2025 年 1 月

## 実装内容

### 1. Vite セットアップ

- `package.json`に Vite、Vue.js 3、@vitejs/plugin-vue を追加
- `vite.config.js`でマルチページアプリケーション（MPA）として設定
- GitHub Pages 用に`base`オプションを設定（`/subtitle-output-system/`）

### 2. Vue コンポーネント

- `src/components/QuestionCard.vue`: 個別の質問カードコンポーネント
- `src/components/QuestionList.vue`: 質問リスト管理コンポーネント
- `src/composables/useOperatorApp.js`: OperatorApp へのアクセスを提供する Composable
- `src/main.js`: Vue アプリケーションのエントリーポイント

### 3. 既存コードとの統合

- `window.__vueExperimentEnabled`フラグを使用して、Vue が有効な場合は既存の`renderQuestions`をスキップ
- 既存のイベントデリゲーション（チェックボックス、カードクリックなど）を維持
- `loadingUids`と`loadingUidStates`を Vue コンポーネントと共有

### 4. GitHub Actions

- `.github/workflows/deploy.yml`: ビルドと GitHub Pages へのデプロイを自動化
- `feature/vite-setup`ブランチからのデプロイに対応

### 5. 修正した問題

#### PUQ の`answered`フラグが反映されない問題

**問題**: PUQ を送出して送出クリアした際に、`answered: true`が Firebase に書き込まれているにもかかわらず、カードが白く（回答済み状態）表示されない。

**原因**: `startQuestionStatusStream`で、同じ UID が複数のスケジュールに存在する場合、最後に処理されたスケジュールのステータスで上書きされていた。PUQ は複数のスケジュールに存在するため、`answered: false`のステータスで上書きされていた。

**修正内容**:

- `startQuestionStatusStream`で、`answered: true`を優先するロジックを追加
- 両方とも`answered: false`の場合、現在のチャンネルのスケジュール ID を優先

#### Firebase `questionStatus`パスの修正

**問題**: 通常質問の`questionStatus`が、イベント直下に作成される場合があった。

**修正内容**:

- `getQuestionStatusPath`を修正し、通常質問もスケジュールの中に作成するように統一
- `handleDisplay`、`handleUnanswer`、`handleBatchUnanswer`、`clearNowShowing`で、通常質問の場合はその質問の`イベントID`と`日程ID`を使用するように修正

#### トランザクション競合エラーの改善

**問題**: Firebase Realtime Database のトランザクション競合エラーがコンソールにエラーとして表示されていた。

**修正内容**:

- `maybeClearScheduleConsensus`と`confirmScheduleConsensus`で、トランザクション競合エラー（`Error: set`）の場合は`console.debug`で記録し、ユーザーには表示しないように修正

## 動作確認済み項目

- ✅ 質問カードが正しく表示される
- ✅ 既存のスタイル（`q-card`クラス）が適用される
- ✅ ラジオネーム、ジャンル、質問テキストが正しく表示される
- ✅ カードをクリックすると選択状態が更新される
- ✅ 既存のアクションボタン（送出、未回答へ戻すなど）が機能する
- ✅ リアクティブな更新が機能する（新しい質問が追加されると自動的に表示される）
- ✅ 通常質問の送出・送出クリア・未回答に戻すが正常に動作する
- ✅ PUQ の送出・送出クリア・未回答に戻すが正常に動作する
- ✅ チェックボックスでの一括操作（未回答に戻す、全選択など）が正常に動作する
- ✅ カードの選択・選択解除（クリック、ESC、余白クリック）が正常に動作する
- ✅ 色の変更（送出中=赤、回答済=白、未回答=通常）が正常に動作する

## 技術的な詳細

### アーキテクチャ

- **フレームワーク**: Vue.js 3 (Composition API)
- **ビルドツール**: Vite 5
- **既存コードとの統合**: `window.__vueExperimentEnabled`フラグを使用して段階的に移行

### パフォーマンス

- 質問リストの更新間隔: 100ms（`updateQuestions`）
- `loadingUids`のチェック間隔: 500ms（`setInterval`）

### 今後の改善点（オプション）

1. **パフォーマンスの最適化**

   - 100ms ごとの更新を、Firebase リスナーやイベントベースの更新に変更
   - 不要な再レンダリングを削減

2. **`window.__vueExperimentEnabled`フラグの削除**

   - Vue がデフォルトになった場合、フラグを削除して既存の`renderQuestions`を削除

3. **TypeScript の導入**（オプション）
   - 型安全性の向上

## 次のステップ

1. **main ブランチへのマージ**

   - `feature/vite-setup`ブランチを`main`にマージ
   - GitHub Pages の環境保護ルールを更新（必要に応じて）

2. **本番環境での動作確認**
   - マージ後、本番環境で最終確認

---

**作成日**: 2025 年 12 月  
**バージョン**: 2.0.0
