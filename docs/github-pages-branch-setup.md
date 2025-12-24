# GitHub Pages のブランチ設定方法

## 方法 1: GitHub Pages の UI でブランチを設定（開発用）

### 手順

1. **GitHub リポジトリにアクセス**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system

2. **Settings > Pages を開く**

3. **Source を設定**

   - "Source" セクションで "Deploy from a branch" を選択
   - "Branch" で `feature/vite-setup` を選択
   - "Folder" で `/ (root)` を選択（または `/dist` を選択してビルド結果をデプロイ）
   - "Save" をクリック

4. **GitHub Actions を使用する場合**
   - "Source" で "GitHub Actions" を選択
   - 環境保護ルールで `feature/vite-setup` ブランチを許可する必要があります

### メリット

- 開発中のブランチから直接デプロイできる
- 動作確認が容易

### デメリット

- 本番環境と開発環境が混在する可能性
- 最終的には `main` ブランチに戻す必要がある

## 方法 2: 環境保護ルールでブランチを許可（推奨）

### 手順

1. **Settings > Environments を開く**

2. **github-pages 環境を選択**

3. **Deployment branches を設定**

   - "Deployment branches" セクションで "Selected branches" を選択
   - `feature/vite-setup` ブランチを追加
   - "Save protection rules" をクリック

4. **GitHub Actions の設定**
   - `deploy.yml` で `feature/vite-setup` ブランチでもデプロイが実行されるように設定

### メリット

- GitHub Actions を使用した自動デプロイが可能
- 本番環境と開発環境を分離できる
- より柔軟な設定が可能

### デメリット

- 設定がやや複雑

## 推奨される方法

### 開発中（現在）

**方法 1（UI でブランチ設定）を使用**

- 簡単で迅速
- 開発中の動作確認に適している
- 一時的な設定として使用

### 本番環境

**方法 2（環境保護ルール + GitHub Actions）を使用**

- `main` ブランチのみを本番環境として設定
- 自動デプロイが可能
- より安全で管理しやすい

## 注意事項

### 開発ブランチからデプロイする場合

1. **一時的な設定として使用**

   - 開発が完了したら、`main` ブランチに戻す

2. **本番環境への影響**

   - 開発中のコードが本番環境に表示される可能性がある
   - ユーザーに影響を与えないよう注意

3. **ブランチのマージ後**
   - `feature/vite-setup` を `main` にマージしたら、GitHub Pages の設定を `main` に戻す

## 現在の推奨設定

### 開発中（feature/vite-setup ブランチ）

1. **GitHub Pages の設定**

   - Settings > Pages > Source: "Deploy from a branch"
   - Branch: `feature/vite-setup`
   - Folder: `/ (root)` または `/dist`（ビルド結果を使用する場合）

2. **または、GitHub Actions を使用**
   - Settings > Pages > Source: "GitHub Actions"
   - 環境保護ルールで `feature/vite-setup` ブランチを許可

### 本番環境（main ブランチ）

1. **GitHub Pages の設定**
   - Settings > Pages > Source: "GitHub Actions"
   - 環境保護ルールで `main` ブランチのみを許可

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
