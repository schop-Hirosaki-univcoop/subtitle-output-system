# デプロイ失敗のトラブルシューティング

## 現在の状況

`feature/vite-setup`ブランチからデプロイしようとしているが、失敗している可能性があります。

## 考えられる原因と解決方法

### 1. 環境保護ルールでブランチが許可されていない

**症状:**

```
Branch "feature/vite-setup" is not allowed to deploy to github-pages due to environment protection rules.
```

**解決方法:**

1. **Settings > Environments を開く**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system/settings/environments

2. **github-pages 環境を選択**

3. **Deployment branches を設定**
   - "Deployment branches" セクションで "Selected branches" を選択
   - `feature/vite-setup` ブランチを追加
   - "Save protection rules" をクリック

### 2. ビルドエラー

**症状:**

- ワークフローの "build" ジョブが失敗している
- エラーメッセージにビルドエラーが表示されている

**確認方法:**

1. **Actions タブを開く**

   - 失敗したワークフローをクリック
   - "build" ジョブをクリック
   - エラーメッセージを確認

2. **ローカルでビルドを確認**
   ```bash
   npm run build
   ```
   - ローカルでビルドが成功するか確認

**解決方法:**

- エラーメッセージに従って修正
- 依存関係の問題の場合は、`package.json`と`package-lock.json`を確認

### 3. ワークフローの設定ミス

**症状:**

- ワークフローが実行されない
- ワークフローの構文エラー

**確認方法:**

1. **ワークフローファイルの構文を確認**

   - `.github/workflows/deploy.yml` の構文が正しいか確認

2. **Actions タブでエラーを確認**
   - ワークフローの実行履歴を確認

**解決方法:**

- ワークフローファイルの構文エラーを修正
- 必要に応じて、ワークフローファイルを再コミット

### 4. 権限の問題

**症状:**

- "Permission denied" エラー
- ワークフローが実行されない

**確認方法:**

1. **Settings > Actions > General を開く**

   - "Workflow permissions" で "Read and write permissions" が選択されているか確認

2. **Settings > Pages を開く**
   - "Source" で "GitHub Actions" が選択されているか確認

**解決方法:**

- 権限を正しく設定
- リポジトリの管理者に確認

## 現在の推奨対応

### ステップ 1: エラーメッセージを確認

1. **GitHub リポジトリにアクセス**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system

2. **Actions タブを開く**

   - 最新のワークフロー実行を確認
   - 失敗しているワークフローをクリック

3. **エラーメッセージを確認**
   - どのジョブが失敗しているか確認
   - エラーメッセージの内容を確認

### ステップ 2: 環境保護ルールを設定

もし環境保護ルールのエラーが出ている場合：

1. **Settings > Environments を開く**
2. **github-pages 環境を選択**
3. **Deployment branches で `feature/vite-setup` を追加**

### ステップ 3: ローカルでビルドを確認

```bash
npm run build
```

ローカルでビルドが成功するか確認してください。

## 一時的な回避策

環境保護ルールの設定が難しい場合、一時的に以下を試してください：

### 方法 A: ビルドテストのみ実行

`build-test.yml`ワークフローが実行されているか確認してください。これはデプロイを行わず、ビルドが成功するか確認するだけです。

### 方法 B: main ブランチにマージしてデプロイ

開発が完了したら、`main`ブランチにマージすることで、自動的にデプロイされます。

## 次のステップ

1. **エラーメッセージを確認**

   - Actions タブで具体的なエラーを確認

2. **エラーの内容を共有**
   - エラーメッセージの内容を教えていただければ、より具体的な解決方法を提案できます

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
