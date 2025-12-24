# main ブランチへのマージガイド

## 概要

`feature/vite-setup`ブランチを`main`ブランチにマージする手順を説明します。

## 前提条件

- ✅ 動作確認が完了している
- ✅ ビルドが成功する
- ✅ GitHub Pages へのデプロイが成功する
- ✅ 既存機能が正常に動作する

## マージ前の確認事項

### 1. 変更内容の確認

```bash
# feature/vite-setupブランチで実行
git log --oneline origin/main..HEAD
```

主要な変更内容：

- Vite と Vue.js 3 の導入
- 質問カードの Vue コンポーネント化
- GitHub Actions の設定
- Firebase `questionStatus`パスの修正
- PUQ の`answered`フラグ問題の修正

### 2. ビルドの確認

```bash
# feature/vite-setupブランチで実行
npm run build
```

- `dist/`ディレクトリが作成される
- エラーが発生しない

### 3. テストの確認（可能な場合）

- ローカルで`npm run dev`を実行し、動作確認
- GitHub Pages のデプロイ結果を確認

## マージ手順

### 方法 1: GitHub の Pull Request を使用（推奨）

**推奨する理由：**

1. **CI/CD の自動実行**

   - Pull Request を作成すると、GitHub Actions のワークフローが自動的に実行されます
   - ビルドエラーやテスト失敗をマージ前に検出できます

2. **変更内容の可視化**

   - GitHub の UI で変更内容を確認できます
   - ファイルごとの差分を確認できます

3. **履歴の記録**

   - Pull Request として履歴が残ります
   - 後から「なぜこの変更をしたのか」を確認できます

4. **安全性**

   - マージ前に変更内容を再確認できます
   - 誤ってマージしてしまうリスクを減らせます

5. **ロールバックの容易さ**
   - 問題が発生した場合、Pull Request を元に戻すことができます

**手順：**

1. **Pull Request を作成**

   - GitHub のリポジトリページにアクセス
   - `feature/vite-setup`ブランチから`main`ブランチへの Pull Request を作成
   - タイトル: `feat: Vue.js 3 と Vite の導入（Phase 2 完了）`
   - 説明: 変更内容の概要を記載

2. **CI/CD の確認**

   - GitHub Actions のワークフローが正常に実行されることを確認
   - ビルドが成功することを確認

3. **レビューとマージ**

   - 必要に応じてレビューを依頼
   - 問題がなければマージを実行

4. **マージ後の確認**

   - GitHub Actions のワークフローが正常に実行されることを確認
   - GitHub Pages へのデプロイが成功することを確認
   - 本番環境で動作確認

### 方法 2: コマンドラインから直接マージ

**この方法を使う場合：**

- 個人開発で、レビューが不要な場合
- 緊急の修正が必要な場合
- Pull Request を作成する手間を省きたい場合

**注意点：**

- CI/CD の確認が後回しになる
- 変更内容の可視化が限定的
- 誤ってマージしてしまうリスクがある

```bash
# mainブランチに切り替え
git checkout main

# 最新の状態を取得
git pull origin main

# feature/vite-setupブランチをマージ
git merge feature/vite-setup

# マージコミットメッセージを編集（必要に応じて）
# git commit --amend

# mainブランチにプッシュ
git push origin main
```

## マージ後の作業

### 1. GitHub Pages の環境保護ルールの更新

`feature/vite-setup`ブランチが`main`にマージされた後、GitHub Pages の環境保護ルールを更新する必要がある場合があります。

1. GitHub のリポジトリページにアクセス
2. Settings → Environments → `github-pages`を選択
3. Deployment branches の設定を確認
   - `main`ブランチが許可されていることを確認
   - 必要に応じて`feature/vite-setup`を削除

### 2. デプロイの確認

- GitHub Actions のワークフローが正常に実行されることを確認
- GitHub Pages の URL でアクセスできることを確認
- 本番環境で動作確認

### 3. ブランチの整理（オプション）

マージが完了し、問題がないことを確認したら、`feature/vite-setup`ブランチを削除できます。

```bash
# ローカルのブランチを削除
git branch -d feature/vite-setup

# リモートのブランチを削除
git push origin --delete feature/vite-setup
```

## トラブルシューティング

### マージコンフリクトが発生した場合

1. **コンフリクトを解決**

   ```bash
   # コンフリクトが発生したファイルを確認
   git status

   # コンフリクトを解決
   # エディタでコンフリクトマーカーを確認し、適切に解決

   # 解決後、マージを完了
   git add .
   git commit
   ```

2. **解決後の確認**

   - ビルドが成功することを確認
   - 動作確認を実施

### デプロイが失敗した場合

1. **GitHub Actions のログを確認**

   - Actions タブで失敗したワークフローを確認
   - エラーメッセージを確認

2. **環境保護ルールを確認**

   - Settings → Environments → `github-pages`を確認
   - `main`ブランチが許可されていることを確認

3. **必要に応じて修正**

   - エラーに応じて修正を実施
   - 再度プッシュしてデプロイを再実行

## 注意事項

- **本番環境への影響**: マージ後、本番環境に自動的にデプロイされます。動作確認を十分に行ってください。
- **ロールバック**: 問題が発生した場合、`main`ブランチを以前のコミットに戻すことができます。
- **バックアップ**: マージ前に、現在の`main`ブランチの状態を確認しておくことを推奨します。

## 関連ドキュメント

- `docs/phase2-vue-migration-complete.md`: Vue 移行の完了レポート
- `docs/phase2-completion-checklist.md`: 完了チェックリスト
- `docs/deployment-troubleshooting.md`: デプロイのトラブルシューティング

---

**作成日**: 2025 年 1 月  
**バージョン**: 1.0.0
