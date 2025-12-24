# フェーズ 2: 完了チェックリスト

## 現在の状態確認

ビルド&デプロイが成功し、確認できたとのことです。以下が正しい状態か確認してください。

## ✅ 完了しているべき項目

### 1. Vite セットアップ

- [x] `package.json`が作成されている
- [x] `vite.config.js`が設定されている
- [x] 依存関係がインストールされている（Vite、Vue.js、@vitejs/plugin-vue）
- [x] ローカルで`npm run build`が成功する
- [x] ローカルで`npm run dev`が動作する

### 2. Vue コンポーネント

- [x] `src/components/QuestionCard.vue`が作成されている
- [x] `src/components/QuestionList.vue`が作成されている
- [x] `src/composables/useOperatorApp.js`が作成されている
- [x] `operator.html`に Vue アプリが統合されている

### 3. GitHub Actions

- [x] `.github/workflows/deploy.yml`が設定されている
- [x] `.github/workflows/build-test.yml`が設定されている（オプション）
- [x] ワークフローが正常に実行される
- [x] ビルドが成功する
- [x] デプロイが成功する

### 4. GitHub Pages

- [x] Settings > Pages で "GitHub Actions" が選択されている
- [x] Settings > Environments で `feature/vite-setup`ブランチが許可されている
- [x] デプロイが成功し、URL でアクセスできる
- [x] URL: `https://schop-hirosaki-univcoop.github.io/subtitle-output-system/`

### 5. 動作確認

- [x] 質問カードが正しく表示される
- [x] 既存のスタイル（`q-card`クラス）が適用される
- [x] ラジオネーム、ジャンル、質問テキストが正しく表示される
- [x] カードをクリックすると選択状態が更新される
- [x] 既存のアクションボタン（送出、未回答へ戻すなど）が機能する
- [x] リアクティブな更新が機能する（新しい質問が追加されると自動的に表示される）
- [x] 通常質問の送出・送出クリア・未回答に戻すが正常に動作する
- [x] PUQ の送出・送出クリア・未回答に戻すが正常に動作する
- [x] チェックボックスでの一括操作（未回答に戻す、全選択など）が正常に動作する
- [x] カードの選択・選択解除（クリック、ESC、余白クリック）が正常に動作する
- [x] 色の変更（送出中=赤、回答済=白、未回答=通常）が正常に動作する

## 正しい状態の確認方法

### 1. ビルド結果の確認

```bash
npm run build
```

- `dist/`ディレクトリが作成される
- `dist/operator.html`が存在する
- エラーが発生しない

### 2. デプロイ結果の確認

1. **GitHub Pages の URL にアクセス**

   - https://schop-hirosaki-univcoop.github.io/subtitle-output-system/operator.html

2. **開発者ツールのコンソールを確認**

   - `[Vue]`で始まるメッセージが表示される
   - エラーが表示されない

3. **質問カードが表示される**
   - 質問カードが正しく表示される
   - 既存のスタイルが適用される

### 3. 既存機能の確認

- [x] ログイン機能が動作する
- [x] イベント一覧が表示される
- [x] 質問表示が正常に動作する
- [x] 既存の JavaScript コードが正常に動作する

## 現在の状態が正しい場合

✅ **以下が確認できていれば正しい状態です：**

1. **ビルドが成功している**

   - `npm run build`がエラーなく完了
   - `dist/`ディレクトリにビルド結果が生成される

2. **デプロイが成功している**

   - GitHub Actions のワークフローが成功
   - GitHub Pages の URL でアクセスできる

3. **Vue コンポーネントが動作している**

   - 質問カードが表示される
   - 既存のスタイルが適用される
   - コンソールに`[Vue]`のメッセージが表示される

4. **既存機能が壊れていない**
   - 既存の JavaScript コードが正常に動作する
   - 既存の機能が使用できる

## 次のステップ

### 動作確認が完了したら

1. **動作確認の結果を記録**

   - 問題がないことを確認
   - 必要に応じて修正

2. **main ブランチにマージする準備**

   - 開発が完了したら、`main`ブランチにマージ
   - 環境保護ルールから`feature/vite-setup`を削除（オプション）

3. **パフォーマンスの最適化**（オプション）
   - 500ms ごとの更新を、Firebase リスナーやイベントベースの更新に変更
   - 不要な再レンダリングを削減

## トラブルシューティング

### 質問カードが表示されない

1. **コンソールを確認**

   - `[Vue]`のメッセージが表示されているか
   - エラーメッセージがないか

2. **OperatorApp インスタンスの確認**

   ```javascript
   console.log(window.operatorEmbed?.app);
   ```

3. **コンテナの確認**
   ```javascript
   console.log(document.getElementById("op-questions-cards"));
   ```

### 既存機能が壊れている

1. **Vue コンポーネントを一時的に無効化**

   ```javascript
   window.__vueExperimentEnabled = false;
   // ページをリロード
   ```

2. **既存のコードに戻す**
   - `operator.html`から Vue コンポーネントのコードを削除
   - 既存の`renderQuestions`が正常に動作することを確認

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
