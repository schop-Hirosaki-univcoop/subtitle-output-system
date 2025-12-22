# Git ブランチ戦略：フレームワーク導入編

## 概要

フレームワーク導入時の Git/GitHub ブランチ戦略について、推奨事項と注意点をまとめたドキュメントです。

## 1. 提案された戦略の評価

### 1.1 提案内容

**新しいブランチでフレームワーク準拠を行い、うまくいっていることを確認したら main ブランチとマージする**

### 1.2 評価

**✅ この方向性は問題ありません。むしろ推奨される方法です。**

#### メリット

1. **既存コードの保護**
   - main ブランチのコードが壊れない
   - いつでもロールバック可能

2. **段階的な開発**
   - 機能ごとに開発・テストが可能
   - リスクを最小化

3. **レビューの容易さ**
   - 変更内容が明確
   - コードレビューがしやすい

4. **実験的な試行**
   - 失敗しても main ブランチに影響しない
   - 複数のアプローチを試せる

## 2. 推奨されるブランチ戦略

### 2.1 基本的なブランチ構成

```
main (本番環境)
  │
  ├── feature/vue-framework (フレームワーク導入)
  │   ├── feature/vue-operator (オペレーター画面の Vue 化)
  │   ├── feature/vue-question-form (質問フォームの Vue 化)
  │   └── feature/vue-events (イベント管理の Vue 化)
  │
  └── feature/mvc-refactoring (MVC パターンのリファクタリング)
```

### 2.2 推奨されるブランチ名

#### メインブランチ

- `main` - 本番環境用（現在のブランチ）

#### 機能ブランチ

- `feature/vue-framework` - フレームワーク導入のメインブランチ
- `feature/vue-operator` - オペレーター画面の Vue 化
- `feature/vue-question-form` - 質問フォームの Vue 化
- `feature/vue-events` - イベント管理の Vue 化
- `feature/mvc-refactoring` - MVC パターンのリファクタリング

#### 実験ブランチ

- `experiment/vue-cdn` - CDN 経由での Vue.js 導入実験
- `experiment/vite-setup` - Vite のセットアップ実験

### 2.3 ブランチ戦略の選択肢

#### オプション 1: Feature Branch 戦略（推奨）

```
main
  │
  └── feature/vue-framework
      ├── feature/vue-operator
      ├── feature/vue-question-form
      └── feature/vue-events
```

**メリット:**
- シンプル
- 機能ごとに独立して開発
- 小規模な変更を段階的にマージ可能

**デメリット:**
- 複数の機能ブランチの統合が複雑になる可能性

#### オプション 2: Develop Branch 戦略

```
main
  │
  └── develop
      ├── feature/vue-operator
      ├── feature/vue-question-form
      └── feature/vue-events
```

**メリット:**
- 統合テストが容易
- 複数の機能を統合してから main にマージ

**デメリット:**
- ブランチ管理が複雑
- 小規模なプロジェクトには過剰

#### 推奨: Feature Branch 戦略

**このプロジェクトの規模を考えると、Feature Branch 戦略を推奨します。**

## 3. 具体的な作業フロー

### 3.1 フェーズ 1: CDN 経由での実験（1-2 週間）

#### ステップ 1: 実験ブランチを作成

```bash
# main ブランチから実験ブランチを作成
git checkout main
git pull origin main
git checkout -b experiment/vue-cdn

# ブランチを GitHub にプッシュ
git push -u origin experiment/vue-cdn
```

#### ステップ 2: Vue.js を CDN 経由で導入

```html
<!-- operator.html に追加 -->
<script src="https://unpkg.com/vue@3.3.4/dist/vue.global.js"></script>
```

#### ステップ 3: 動作確認とコミット

```bash
# 変更をコミット
git add operator.html
git commit -m "feat: Vue.js を CDN 経由で導入（実験）"

# GitHub にプッシュ
git push origin experiment/vue-cdn
```

#### ステップ 4: 動作確認後の判断

**うまくいった場合:**
- `feature/vue-framework` ブランチにマージ
- または、直接 `main` にマージ（小規模な変更の場合）

**うまくいかなかった場合:**
- ブランチを削除
- 別のアプローチを試す

### 3.2 フェーズ 2: ビルドツールの導入（1-2 ヶ月）

#### ステップ 1: 機能ブランチを作成

```bash
# main ブランチから機能ブランチを作成
git checkout main
git pull origin main
git checkout -b feature/vite-setup

# ブランチを GitHub にプッシュ
git push -u origin feature/vite-setup
```

#### ステップ 2: Vite プロジェクトをセットアップ

```bash
# Vite プロジェクトを作成（別ディレクトリで）
npm create vite@latest operator -- --template vue-ts
cd operator
npm install

# 既存コードを段階的に移行
# ...

# 変更をコミット
git add .
git commit -m "feat: Vite を導入し、オペレーター画面を Vue.js 化"

# GitHub にプッシュ
git push origin feature/vite-setup
```

#### ステップ 3: GitHub Actions の設定

```yaml
# .github/workflows/deploy.yml を作成
# （詳細は build-tool-vs-cdn.md を参照）
```

#### ステップ 4: 動作確認とマージ

**動作確認が完了したら:**

```bash
# main ブランチにマージ
git checkout main
git pull origin main
git merge feature/vite-setup

# マージを GitHub にプッシュ
git push origin main
```

### 3.3 フェーズ 3: 段階的な移行（3-6 ヶ月）

#### 各機能ごとにブランチを作成

```bash
# オペレーター画面の Vue 化
git checkout -b feature/vue-operator
# 開発・テスト
git commit -m "feat: オペレーター画面を Vue.js 化"
git push origin feature/vue-operator

# 質問フォームの Vue 化
git checkout -b feature/vue-question-form
# 開発・テスト
git commit -m "feat: 質問フォームを Vue.js 化"
git push origin feature/vue-question-form
```

## 4. 注意点とベストプラクティス

### 4.1 ブランチの命名規則

**推奨される命名規則:**

- `feature/` - 新機能の追加
- `experiment/` - 実験的な試行
- `fix/` - バグ修正
- `refactor/` - リファクタリング

**例:**
- `feature/vue-operator` ✅
- `vue-operator` ❌（プレフィックスなし）
- `Vue-Operator` ❌（大文字）

### 4.2 コミットメッセージの規則

**推奨されるコミットメッセージ形式:**

```
<type>: <subject>

<body>

<footer>
```

**タイプ:**
- `feat`: 新機能
- `fix`: バグ修正
- `refactor`: リファクタリング
- `docs`: ドキュメント
- `test`: テスト

**例:**
```
feat: Vue.js を CDN 経由で導入

- operator.html に Vue.js を追加
- 質問一覧を Vue コンポーネント化
- 既存コードとの共存を確認
```

### 4.3 マージ前の確認事項

#### チェックリスト

- [ ] 動作確認が完了している
- [ ] 既存機能が壊れていない
- [ ] テストが通っている（可能な場合）
- [ ] コードレビューが完了している
- [ ] ドキュメントが更新されている
- [ ] デプロイが成功することを確認

### 4.4 既存コードとの共存期間

**重要な考慮事項:**

1. **既存コードの保護**
   - main ブランチのコードは常に動作する状態を保つ
   - 新機能は既存機能を壊さないように実装

2. **段階的なマージ**
   - 小さな変更から順にマージ
   - 大きな変更は分割してマージ

3. **ロールバック計画**
   - 問題が発生した場合のロールバック手順を準備
   - タグを使用してバージョン管理

### 4.5 デプロイ戦略

#### オプション 1: 機能フラグを使用

```javascript
// 機能フラグで新機能を制御
const USE_VUE = true; // または環境変数

if (USE_VUE) {
  // Vue.js を使用
} else {
  // 既存コードを使用
}
```

#### オプション 2: 別の URL でデプロイ

- `https://example.com/operator.html` - 既存版
- `https://example.com/operator-vue.html` - Vue 版（実験）

#### オプション 3: 段階的なロールアウト

- 最初は内部テストのみ
- 問題がなければ本番環境に展開

## 5. 具体的な作業例

### 5.1 実験ブランチでの作業例

```bash
# 1. ブランチを作成
git checkout main
git pull origin main
git checkout -b experiment/vue-cdn

# 2. Vue.js を CDN 経由で導入
# operator.html を編集
# ...

# 3. 動作確認
# ローカルで動作確認

# 4. コミット
git add operator.html
git commit -m "feat: Vue.js を CDN 経由で導入（実験）"

# 5. GitHub にプッシュ
git push -u origin experiment/vue-cdn

# 6. 動作確認が完了したら main にマージ
git checkout main
git merge experiment/vue-cdn
git push origin main

# 7. 実験ブランチを削除（オプション）
git branch -d experiment/vue-cdn
git push origin --delete experiment/vue-cdn
```

### 5.2 機能ブランチでの作業例

```bash
# 1. ブランチを作成
git checkout main
git pull origin main
git checkout -b feature/vue-operator

# 2. Vite プロジェクトをセットアップ
npm create vite@latest operator -- --template vue-ts
# ...

# 3. 開発
# 既存コードを段階的に移行
# ...

# 4. コミット（小刻みに）
git add .
git commit -m "feat: Vite プロジェクトをセットアップ"

git add .
git commit -m "feat: オペレーター画面の基本構造を Vue 化"

# 5. GitHub にプッシュ
git push -u origin feature/vue-operator

# 6. 動作確認が完了したら main にマージ
git checkout main
git pull origin main
git merge feature/vue-operator
git push origin main
```

## 6. 問題が発生した場合の対処

### 6.1 マージ後の問題

**問題が発生した場合:**

```bash
# 1. 問題を確認
git log --oneline -10

# 2. 問題のあるコミットを特定
git show <commit-hash>

# 3. ロールバック（必要に応じて）
git revert <commit-hash>
git push origin main

# または、以前のバージョンに戻す
git reset --hard <commit-hash>
git push origin main --force  # 注意: 強制プッシュ
```

### 6.2 ブランチの競合

**main ブランチが更新された場合:**

```bash
# 1. main ブランチの最新を取得
git checkout main
git pull origin main

# 2. 機能ブランチに戻る
git checkout feature/vue-operator

# 3. main の変更をマージ
git merge main

# 4. 競合を解決
# ...

# 5. コミット
git add .
git commit -m "merge: main ブランチの変更をマージ"
git push origin feature/vue-operator
```

## 7. GitHub の機能活用

### 7.1 Pull Request（PR）の活用

**推奨されるワークフロー:**

1. **機能ブランチで開発**
2. **Pull Request を作成**
3. **コードレビュー**
4. **動作確認**
5. **マージ**

**Pull Request のテンプレート例:**

```markdown
## 変更内容
- Vue.js を CDN 経由で導入
- オペレーター画面の質問一覧を Vue コンポーネント化

## 動作確認
- [ ] ローカルで動作確認済み
- [ ] 既存機能が壊れていないことを確認
- [ ] ブラウザで動作確認済み

## 関連 Issue
#123
```

### 7.2 ブランチ保護ルール

**推奨される設定:**

- main ブランチへの直接プッシュを禁止
- Pull Request 必須
- コードレビュー必須（可能な場合）
- ステータスチェック必須（可能な場合）

### 7.3 GitHub Actions の活用

**CI/CD パイプラインの例:**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Build
        run: npm run build
```

## 8. まとめ

### 8.1 提案された戦略の評価

**✅ 問題ありません。むしろ推奨される方法です。**

### 8.2 推奨されるワークフロー

1. **実験ブランチで試す**（`experiment/vue-cdn`）
2. **動作確認**
3. **機能ブランチで本格開発**（`feature/vue-operator`）
4. **Pull Request を作成**
5. **コードレビューと動作確認**
6. **main ブランチにマージ**

### 8.3 注意点

1. **既存コードの保護**
   - main ブランチのコードは常に動作する状態を保つ

2. **段階的なマージ**
   - 小さな変更から順にマージ

3. **ロールバック計画**
   - 問題が発生した場合の対処法を準備

4. **コミットメッセージ**
   - 明確なコミットメッセージを書く

5. **Pull Request の活用**
   - コードレビューと動作確認を徹底

### 8.4 推奨されるブランチ構成

```
main
  │
  ├── experiment/vue-cdn (実験)
  │
  └── feature/vue-framework (本格開発)
      ├── feature/vue-operator
      ├── feature/vue-question-form
      └── feature/vue-events
```

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0

