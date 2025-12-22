# 環境保護ルールの設定手順

## エラー内容

```
Branch "feature/vite-setup" is not allowed to deploy to github-pages due to environment protection rules.
The deployment was rejected or didn't satisfy other protection rules.
```

## 解決方法

### ステップ 1: Environments 設定を開く

1. **GitHub リポジトリにアクセス**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system

2. **Settings を開く**

   - リポジトリの Settings タブをクリック

3. **Environments を開く**
   - 左側のサイドバーで "Environments" をクリック
   - または直接 URL: https://github.com/schop-Hirosaki-univcoop/subtitle-output-system/settings/environments

### ステップ 2: github-pages 環境を設定

1. **github-pages 環境を選択**

   - 環境一覧から "github-pages" をクリック

2. **Deployment branches を設定**

   - "Deployment branches" セクションを探す
   - デフォルトでは "All branches" または "Protected branches only" が選択されている可能性があります

3. **Selected branches を選択**

   - "Selected branches" ラジオボタンを選択
   - ブランチ名の入力欄に `feature/vite-setup` を入力
   - または、ドロップダウンから選択（既存のブランチが表示される場合）

4. **保存**
   - "Save protection rules" ボタンをクリック

### ステップ 3: 確認

1. **設定が保存されたか確認**

   - "Deployment branches" セクションに `feature/vite-setup` が表示されていることを確認

2. **ワークフローを再実行**
   - Actions タブで、失敗したワークフローを再実行
   - または、`feature/vite-setup`ブランチに新しいコミットをプッシュ

## 設定後の動作

設定が完了すると：

1. **`feature/vite-setup`ブランチからデプロイ可能**

   - プッシュすると自動的にビルドとデプロイが実行されます

2. **`main`ブランチも引き続きデプロイ可能**

   - 両方のブランチからデプロイできます

3. **同じ URL にデプロイ**
   - どちらのブランチからデプロイしても、同じ URL にデプロイされます
   - 最後にデプロイされたブランチの内容が表示されます

## 注意事項

⚠️ **重要**: 開発が完了したら、環境保護ルールから `feature/vite-setup` を削除することを推奨します。

- 本番環境（`main`ブランチ）のみをデプロイするように設定
- 開発ブランチが誤ってデプロイされることを防ぐ

## トラブルシューティング

### "Environments" が見つからない

- リポジトリの管理者権限が必要です
- 組織のリポジトリの場合、組織の設定を確認してください

### ブランチが追加できない

- ブランチ名が正しいか確認（`feature/vite-setup`）
- ブランチが既に存在するか確認

### 設定を保存できない

- リポジトリの管理者権限を確認
- 組織のリポジトリの場合、組織の設定を確認

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
