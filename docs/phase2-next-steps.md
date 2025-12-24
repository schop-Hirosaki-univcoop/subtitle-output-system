# フェーズ 2: 次のステップ

## 現在の状況

### 完了した作業

- ✅ ステップ 1: `feature/vite-setup`ブランチを作成
- ✅ ステップ 2: Vite プロジェクトをセットアップ
  - `package.json`を作成
  - `vite.config.js`で multi-page application の設定
  - 依存関係をインストール
  - ビルドが成功することを確認
- ✅ ステップ 3: GitHub Actions の設定
  - `.github/workflows/deploy.yml`を作成
  - GitHub Pages へのデプロイワークフローを設定

### 実装内容

1. **Vite のセットアップ**

   - Vite 5.0.0 をインストール
   - @vitejs/plugin-vue 4.5.0 をインストール
   - Vue.js 3.3.4 をインストール

2. **Multi-page Application の設定**

   - 8 つの HTML エントリーポイントを設定
   - 既存の HTML ファイルを維持

3. **GitHub Actions の設定**
   - ビルドジョブとデプロイジョブを設定
   - GitHub Pages への自動デプロイを有効化

## 次のステップ

### ステップ 1: 既存コードを Vue コンポーネントに移行

**目標:** 既存の CDN 経由の Vue.js 実装を、Vite ベースの実装に移行する

#### 1.1 質問カードコンポーネントの移行

既存の `operator.html` の CDN 経由の Vue.js 実装を、Vite ベースの実装に移行します。

**実装内容:**

1. **Vue コンポーネントファイルを作成**

   ```vue
   <!-- src/components/QuestionCard.vue -->
   <template>
     <article
       :class="[
         'q-card',
         { 'is-answered': question['回答済'] },
         { 'is-selecting': question['選択中'] },
         { 'is-puq': isPickup },
         { 'is-selected': isSelected },
         { 'is-live': isLive, 'now-displaying': isLive },
       ]"
       :data-uid="question.UID"
       @click="handleClick"
     >
       <!-- ... -->
     </article>
   </template>

   <script setup>
   import { computed } from "vue";

   const props = defineProps({
     question: {
       type: Object,
       required: true,
     },
     isSelected: {
       type: Boolean,
       default: false,
     },
     isLive: {
       type: Boolean,
       default: false,
     },
   });

   // ... 既存のロジックを移行
   </script>
   ```

2. **operator.html を更新**

   ```html
   <!-- operator.html -->
   <div id="vue-questions-container"></div>
   <script type="module">
     import { createApp } from "vue";
     import QuestionList from "./src/components/QuestionList.vue";

     const app = createApp(QuestionList);
     app.mount("#vue-questions-container");
   </script>
   ```

#### 1.2 既存コードとの統合

既存の `OperatorApp` インスタンスと連携する方法を実装します。

**実装内容:**

1. **Composable 関数を作成**

   ```javascript
   // src/composables/useOperatorApp.js
   import { ref, onMounted } from "vue";

   export function useOperatorApp() {
     const app = ref(null);

     onMounted(() => {
       if (typeof window !== "undefined" && window.operatorEmbed?.app) {
         app.value = window.operatorEmbed.app;
       }
     });

     return { app };
   }
   ```

2. **コンポーネントで使用**

   ```vue
   <script setup>
   import { useOperatorApp } from "./composables/useOperatorApp.js";

   const { app } = useOperatorApp();
   // app.value を使用して既存の OperatorApp インスタンスにアクセス
   </script>
   ```

### ステップ 2: TypeScript の導入（オプション）

**目標:** TypeScript を導入して、型安全性を向上させる

**実装内容:**

1. **TypeScript の依存関係を追加**

   ```bash
   npm install -D typescript @vitejs/plugin-vue-tsx
   ```

2. **tsconfig.json を作成**

   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "useDefineForClassFields": true,
       "module": "ESNext",
       "lib": ["ES2020", "DOM", "DOM.Iterable"],
       "skipLibCheck": true,
       "moduleResolution": "bundler",
       "allowImportingTsExtensions": true,
       "resolveJsonModule": true,
       "isolatedModules": true,
       "noEmit": true,
       "jsx": "preserve",
       "strict": true,
       "noUnusedLocals": true,
       "noUnusedParameters": true,
       "noFallthroughCasesInSwitch": true
     },
     "include": [
       "src/**/*.ts",
       "src/**/*.d.ts",
       "src/**/*.tsx",
       "src/**/*.vue"
     ],
     "references": [{ "path": "./tsconfig.node.json" }]
   }
   ```

3. **vite.config.js を vite.config.ts に変更**
   ```typescript
   import { defineConfig } from "vite";
   import vue from "@vitejs/plugin-vue";
   // ...
   ```

### ステップ 3: コンポーネントの整理

**目標:** Vue コンポーネントを整理して、保守性を向上させる

**実装内容:**

1. **ディレクトリ構造を作成**

   ```
   src/
   ├── components/
   │   ├── QuestionCard.vue
   │   ├── QuestionList.vue
   │   └── ...
   ├── composables/
   │   ├── useOperatorApp.js
   │   └── ...
   ├── utils/
   │   └── ...
   └── main.js
   ```

2. **コンポーネントを整理**
   - 再利用可能なコンポーネントを作成
   - コンポーネントの責務を明確にする

### ステップ 4: パフォーマンスの最適化

**目標:** ビルド結果を最適化して、パフォーマンスを向上させる

**実装内容:**

1. **コード分割**

   - 動的インポートを使用
   - ルートごとにコードを分割

2. **アセットの最適化**

   - 画像の最適化
   - フォントの最適化

3. **バンドルサイズの削減**
   - 不要な依存関係を削除
   - Tree shaking を活用

## 推奨される次のステップ

### 優先度: 高

1. **既存コードを Vue コンポーネントに移行**

   - 質問カードコンポーネントの移行
   - 既存の CDN 経由の実装を Vite ベースに置き換え

2. **動作確認とテスト**
   - 開発サーバーで動作確認
   - ビルド結果の確認
   - GitHub Pages へのデプロイ確認

### 優先度: 中

3. **TypeScript の導入**

   - 型安全性の向上
   - 開発体験の向上

4. **コンポーネントの整理**
   - ディレクトリ構造の整理
   - コンポーネントの再利用性向上

### 優先度: 低

5. **パフォーマンスの最適化**
   - コード分割
   - アセットの最適化

## 注意事項

- **既存の機能を壊さない**: 既存のコードを変更する際は、十分にテストする
- **段階的な移行**: 一度にすべてを移行せず、小さな機能から始める
- **既存のユーザーへの影響**: 本番環境への影響を最小限にする

## 関連ファイル

- `package.json`: npm プロジェクト設定
- `vite.config.js`: Vite 設定ファイル
- `.github/workflows/deploy.yml`: GitHub Actions のデプロイワークフロー
- `docs/phase2-vite-setup-guide.md`: フェーズ 2 のセットアップガイド

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
