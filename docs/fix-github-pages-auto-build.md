# GitHub Pages の自動ビルドを無効化する方法

## 問題

`main`ブランチにマージした後、GitHub Actions のワークフロー名が変わってしまいました：

- **以前**: `Build Test` と `Deploy to GitHub Pages`
- **現在**: `pages-build-deployment` と `Deploy to GitHub Pages`

`pages-build-deployment`は、GitHub Pages の自動ビルド機能が有効になっていることを示しています。

## 原因

GitHub Pages には 2 つのデプロイ方法があります：

1. **GitHub Actions**（推奨）: カスタムワークフローでビルドとデプロイを制御
2. **自動ビルド**: GitHub が自動的に Jekyll などでビルドを試みる

このプロジェクトは Vite を使用しているため、GitHub Actions でビルドする必要があります。自動ビルドが有効になっていると、`pages-build-deployment`が実行され、正しくビルドされません。

## 解決方法

### ステップ 1: GitHub Pages の設定を確認

1. **GitHub リポジトリにアクセス**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system

2. **Settings を開く**

   - リポジトリの Settings タブをクリック

3. **Pages を開く**

   - 左側のサイドバーで "Pages" をクリック
   - または直接 URL: https://github.com/schop-Hirosaki-univcoop/subtitle-output-system/settings/pages

4. **Build and deployment の設定を確認**
   - **Source** が **"GitHub Actions"** になっていることを確認
   - **"Deploy from a branch"** が選択されている場合は、**"GitHub Actions"** に変更

### ステップ 2: 自動ビルドを無効化（必要に応じて）

もし **"Deploy from a branch"** が選択されている場合：

1. **Source を "GitHub Actions" に変更**

   - "Source" ドロップダウンから "GitHub Actions" を選択
   - これにより、自動ビルドが無効化され、GitHub Actions のワークフローのみが実行されます

2. **保存**
   - 設定が自動的に保存されます

### ステップ 3: 確認

1. **Actions タブを確認**

   - Actions タブで、`pages-build-deployment`が実行されなくなったことを確認
   - `Deploy to GitHub Pages`ワークフローのみが実行されることを確認

2. **ワークフローの実行を確認**
   - `Deploy to GitHub Pages`ワークフローが正常に実行されることを確認
   - ビルドとデプロイが成功することを確認

## 正しい設定

- **Source**: `GitHub Actions`
- **ワークフロー**: `.github/workflows/deploy.yml`が実行される
- **自動ビルド**: 無効（`pages-build-deployment`は実行されない）

## 注意事項

- **既存のデプロイ**: 設定を変更しても、既存のデプロイは影響を受けません
- **ワークフローの実行**: 設定変更後、次のプッシュで GitHub Actions のワークフローが実行されます
- **自動ビルドの無効化**: `pages-build-deployment`が実行されなくなります

## トラブルシューティング

### `pages-build-deployment`がまだ実行される

1. **設定を再確認**

   - Settings → Pages で、Source が "GitHub Actions" になっているか確認

2. **キャッシュをクリア**

   - Actions タブで、失敗した`pages-build-deployment`ワークフローを削除

3. **ワークフローの確認**
   - `.github/workflows/deploy.yml`が正しく設定されているか確認

### GitHub Actions のワークフローが実行されない

1. **ワークフローファイルの確認**

   - `.github/workflows/deploy.yml`が存在するか確認
   - ファイルの内容が正しいか確認

2. **ブランチの確認**

   - `main`ブランチにワークフローファイルが存在するか確認

3. **権限の確認**
   - リポジトリの設定で、GitHub Actions が有効になっているか確認

---

**作成日**: 2025 年 1 月  
**バージョン**: 1.0.0
