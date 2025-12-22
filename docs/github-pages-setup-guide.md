# GitHub Pages セットアップガイド

## 現在の状況

GitHub Actionsのワークフローは設定されていますが、以下の点を確認する必要があります：

1. **ブランチの設定**: ワークフローは`main`ブランチと`feature/vite-setup`ブランチで実行されるように設定されています
2. **GitHub Pagesの設定**: Settings > Pages で "GitHub Actions" が選択されている必要があります

## セットアップ手順

### ステップ 1: GitHub Pagesの設定を確認

1. **GitHubリポジトリにアクセス**
   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system

2. **Settings を開く**
   - リポジトリの Settings タブをクリック

3. **Pages を開く**
   - 左側のサイドバーで "Pages" をクリック

4. **Source を設定**
   - "Source" セクションで "GitHub Actions" を選択
   - これにより、GitHub Actionsでビルドされた結果が自動的にデプロイされます

### ステップ 2: ワークフローの実行を確認

1. **Actions タブを確認**
   - リポジトリの Actions タブをクリック
   - "Deploy to GitHub Pages" ワークフローが表示されているか確認

2. **ワークフローの実行**
   - `feature/vite-setup`ブランチにプッシュすると、自動的にワークフローが実行されます
   - または、Actions タブから手動で実行することもできます（"Run workflow" ボタン）

### ステップ 3: ビルド結果の確認

1. **ワークフローの実行状況を確認**
   - Actions タブで、実行中のワークフローをクリック
   - "build" ジョブと "deploy" ジョブが成功しているか確認

2. **エラーがある場合**
   - 各ステップのログを確認
   - エラーメッセージを確認して修正

## トラブルシューティング

### ワークフローが実行されない

1. **ブランチを確認**
   - 現在のブランチが`main`または`feature/vite-setup`であることを確認
   - 他のブランチでは実行されません

2. **ワークフローファイルの場所を確認**
   - `.github/workflows/deploy.yml`が正しい場所にあることを確認

3. **GitHub Actionsが有効になっているか確認**
   - Settings > Actions > General で、Actions が有効になっているか確認

### ビルドが失敗する

1. **依存関係のインストールエラー**
   - `package.json`と`package-lock.json`が正しくコミットされているか確認
   - `npm ci`が正常に実行されるか確認

2. **ビルドエラー**
   - ローカルで`npm run build`が正常に実行されるか確認
   - エラーメッセージを確認して修正

### デプロイが失敗する

1. **権限の確認**
   - Settings > Actions > General で、ワークフローの権限を確認
   - "Read and write permissions" が有効になっている必要があります

2. **Pages の設定を確認**
   - Settings > Pages で "GitHub Actions" が選択されているか確認

## 注意事項

### ブランチごとのデプロイ

- **`main`ブランチ**: 本番環境にデプロイされます
- **`feature/vite-setup`ブランチ**: テスト用にデプロイされます（開発中のみ）

### 本番環境への反映

`feature/vite-setup`ブランチの開発が完了したら、`main`ブランチにマージすることで、本番環境に反映されます。

## 次のステップ

1. **GitHub Pagesの設定を確認**
   - Settings > Pages で "GitHub Actions" を選択

2. **ワークフローを実行**
   - `feature/vite-setup`ブランチにプッシュするか、手動で実行

3. **デプロイ結果を確認**
   - GitHub PagesのURLでアクセスして確認

---

**作成日**: 2025年12月  
**バージョン**: 1.0.0

