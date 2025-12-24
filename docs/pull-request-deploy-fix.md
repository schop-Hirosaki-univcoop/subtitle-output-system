# Pull Request のデプロイエラー修正

## 問題

Pull Request を作成した際に、以下のエラーが発生しました：

```
Branch "refs/pull/701/merge" is not allowed to deploy to github-pages due to environment protection rules.
The deployment was rejected or didn't satisfy other protection rules.
```

## 原因

Pull Request のマージコミット（`refs/pull/701/merge`）は、GitHub Pages の環境保護ルールで許可されていません。これは、セキュリティ上の理由で、Pull Request から直接本番環境にデプロイできないようにするための保護機能です。

## 解決方法

Pull Request の場合はデプロイをスキップし、`main`ブランチにマージされた後にデプロイするようにワークフローを修正しました。

### 変更内容

`.github/workflows/deploy.yml`の`deploy`ジョブに、以下の条件を追加しました：

```yaml
deploy:
  # Pull Requestの場合はデプロイをスキップ（mainブランチにマージされた後にデプロイ）
  if: github.event_name != 'pull_request'
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  # ...
```

### 動作

1. **Pull Request の場合**
   - ビルドのみが実行されます
   - デプロイはスキップされます
   - ビルドエラーを検出できます

2. **`main`ブランチにマージされた後**
   - ビルドとデプロイが実行されます
   - GitHub Pages に自動的にデプロイされます

## 確認方法

1. **Pull Request の Actions を確認**
   - Pull Request の「Checks」タブで、ビルドが成功することを確認
   - デプロイジョブがスキップされることを確認

2. **マージ後の確認**
   - `main`ブランチにマージされた後、Actions タブでデプロイが実行されることを確認
   - GitHub Pages の URL でアクセスできることを確認

## メリット

- **セキュリティ**: Pull Request から直接本番環境にデプロイされない
- **CI/CD の確認**: Pull Request でビルドエラーを検出できる
- **自動デプロイ**: `main`ブランチにマージされた後に自動的にデプロイされる

---

**作成日**: 2025 年 1 月  
**バージョン**: 1.0.0

