# GitHub Pages の URL について

## 基本 URL

このリポジトリの GitHub Pages の URL は：

```
https://schop-hirosaki-univcoop.github.io/subtitle-output-system/
```

## URL の構成

GitHub Pages の URL は以下の形式です：

```
https://[ユーザー名または組織名].github.io/[リポジトリ名]/
```

このリポジトリの場合：

- ユーザー名/組織名: `schop-hirosaki-univcoop`
- リポジトリ名: `subtitle-output-system`

## ブランチと URL の関係

### 重要なポイント

**GitHub Pages の URL は、デプロイ元のブランチに関係なく、常に同じ URL になります。**

- `main`ブランチからデプロイ → `https://schop-hirosaki-univcoop.github.io/subtitle-output-system/`
- `feature/vite-setup`ブランチからデプロイ → **同じ URL** `https://schop-hirosaki-univcoop.github.io/subtitle-output-system/`

### デプロイの動作

1. **最初のデプロイ**

   - `main`ブランチをデプロイ → URL に`main`ブランチの内容が表示される

2. **2 回目のデプロイ**

   - `feature/vite-setup`ブランチをデプロイ → **同じ URL**に`feature/vite-setup`ブランチの内容が**上書き**される
   - 以前の`main`ブランチの内容は置き換えられる

3. **3 回目のデプロイ**
   - 再度`main`ブランチをデプロイ → 同じ URL に`main`ブランチの内容が**上書き**される

### 注意事項

⚠️ **複数のブランチからデプロイする場合、最後にデプロイされたブランチの内容が表示されます。**

- 開発中のブランチ（`feature/vite-setup`）をデプロイすると、本番環境（`main`）の内容が一時的に置き換えられます
- 開発が完了したら、必ず`main`ブランチをデプロイして元に戻してください

## カスタムドメインを使用する場合

カスタムドメインが設定されている場合、そのドメインが使用されます：

```
https://your-custom-domain.com/
```

カスタムドメインの設定は、Settings > Pages > Custom domain で確認できます。

## プレビュー環境（Pull Request）

Pull Request を作成すると、GitHub Actions のワークフローでビルドが実行されますが、通常はデプロイされません。

プレビュー環境を使用する場合は、別途設定が必要です（例：Vercel、Netlify などのプレビュー機能）。

## 推奨される運用

### 開発中

1. **ローカルで確認**

   ```bash
   npm run dev
   ```

   - `http://localhost:3000` で確認

2. **ビルドテスト**

   ```bash
   npm run build
   npm run preview
   ```

   - ビルド結果をローカルで確認

3. **必要に応じてデプロイ**
   - `feature/vite-setup`ブランチをデプロイして動作確認
   - 確認後、`main`ブランチをデプロイして元に戻す

### 本番環境

- `main`ブランチのみをデプロイ
- 開発ブランチはデプロイしない

## トラブルシューティング

### URL にアクセスできない

1. **GitHub Pages が有効になっているか確認**

   - Settings > Pages で確認

2. **デプロイが完了しているか確認**

   - Actions タブでワークフローの実行状況を確認

3. **URL が正しいか確認**
   - リポジトリ名に誤字がないか確認
   - 大文字小文字が正しいか確認（GitHub Pages の URL は大文字小文字を区別します）

### 古い内容が表示される

1. **ブラウザのキャッシュをクリア**

   - ハードリロード（Ctrl+Shift+R または Cmd+Shift+R）

2. **最新のデプロイを確認**
   - Actions タブで最新のデプロイが成功しているか確認

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
