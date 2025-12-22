# フェーズ 2: Vite セットアップガイド

## 概要

フェーズ 2 では、ビルドツール（Vite）を導入して、本格的な開発環境を構築します。既存の multi-page application を維持しながら、Vue.js コンポーネントを段階的に導入します。

## セットアップ手順

### ステップ 1: 依存関係のインストール

```bash
npm install
```

これにより、以下のパッケージがインストールされます：
- `vite`: ビルドツール
- `@vitejs/plugin-vue`: Vue.js サポート
- `vue`: Vue.js フレームワーク

### ステップ 2: 開発サーバーの起動

```bash
npm run dev
```

開発サーバーが起動し、`http://localhost:3000` でアクセスできます。

### ステップ 3: ビルド

```bash
npm run build
```

`dist/` ディレクトリにビルド結果が出力されます。

### ステップ 4: プレビュー

```bash
npm run preview
```

ビルド結果をローカルでプレビューできます。

## プロジェクト構造

```
subtitle-output-system-1/
├── package.json          # npm プロジェクト設定
├── vite.config.js        # Vite 設定ファイル
├── index.html            # メインページ
├── operator.html         # オペレーター画面
├── display.html          # ディスプレイ画面
├── login.html            # ログイン画面
├── question-form.html    # 質問フォーム
├── gl-form.html          # GL フォーム
├── participant-mail-view.html
├── 404.html
├── scripts/              # 既存の JavaScript ファイル
├── assets/              # 静的アセット
└── dist/                # ビルド出力（.gitignore に含まれる）
```

## Vite 設定の詳細

### Multi-page Application の設定

`vite.config.js` で、複数の HTML エントリーポイントを設定しています：

- `main`: `index.html`
- `operator`: `operator.html`
- `display`: `display.html`
- `login`: `login.html`
- `questionForm`: `question-form.html`
- `glForm`: `gl-form.html`
- `participantMailView`: `participant-mail-view.html`
- `notFound`: `404.html`

### GitHub Pages 用のベースパス

リポジトリ名に応じて、`vite.config.js` の `base` オプションを設定してください：

```javascript
build: {
  base: '/subtitle-output-system-1/', // リポジトリ名に応じて変更
  // ...
}
```

ルートパスでホストする場合は、`base: '/'` のままにします。

## 既存コードとの統合

### Vue コンポーネントの作成

既存の JavaScript コードを Vue コンポーネントに段階的に移行します。

#### 例: 質問カードコンポーネント

```vue
<!-- src/components/QuestionCard.vue -->
<template>
  <article
    :class="[
      'q-card',
      { 'is-answered': question.answered },
      { 'is-selecting': question.selecting },
    ]"
    @click="handleClick"
  >
    <div class="q-text">{{ question.text }}</div>
  </article>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['click']);

const handleClick = () => {
  emit('click', props.question);
};
</script>
```

### 既存の HTML ファイルでの使用

```html
<!-- operator.html -->
<div id="app"></div>
<script type="module">
  import { createApp } from 'vue';
  import QuestionCard from './src/components/QuestionCard.vue';

  const app = createApp({
    components: {
      QuestionCard,
    },
    // ...
  });

  app.mount('#app');
</script>
```

## GitHub Actions の設定

GitHub Pages にデプロイするために、GitHub Actions を設定します。

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Setup Pages
        uses: actions/configure-pages@v4
      
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 移行戦略

### 段階的な移行

1. **既存コードを維持**
   - 既存の HTML ファイルと JavaScript ファイルはそのまま維持
   - Vue コンポーネントを段階的に追加

2. **小さな機能から始める**
   - 質問カードコンポーネント
   - ローディング表示
   - ステータス表示

3. **既存コードとの共存**
   - Vue コンポーネントと既存の JavaScript コードを共存させる
   - 段階的に既存コードを Vue コンポーネントに置き換え

### 注意事項

- **既存の機能を壊さない**: 既存のコードを変更する際は、十分にテストする
- **段階的な移行**: 一度にすべてを移行せず、小さな機能から始める
- **既存のユーザーへの影響**: 本番環境への影響を最小限にする

## トラブルシューティング

### ビルドエラー

1. **依存関係のインストール**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **キャッシュのクリア**
   ```bash
   rm -rf node_modules/.vite
   npm run dev
   ```

### パスの問題

- `vite.config.js` の `base` オプションを確認
- リポジトリ名に応じて `base` を設定

### Vue コンポーネントが読み込まれない

- ファイルパスを確認
- `import` 文のパスが正しいか確認
- `.vue` ファイルの拡張子を確認

## 次のステップ

1. **TypeScript の導入**（オプション）
   - `vite.config.ts` に変更
   - TypeScript の型定義を追加

2. **コンポーネントの整理**
   - `src/components/` ディレクトリを作成
   - コンポーネントを整理

3. **既存コードの段階的な移行**
   - 小さな機能から始める
   - 既存コードを Vue コンポーネントに置き換え

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0

