# Viteのベースパス設定の修正

## 問題

GitHub Pagesでデプロイした際、すべてのアセット（CSS、JS、SVG）が404エラーになっていました。

```
Failed to load resource: the server responded with a status of 404
/assets/layout-CJMOUewM.css
/assets/operator-APugLq1g.js
...
```

## 原因

Viteのビルド結果が絶対パス（`/assets/...`）になっていたため、GitHub Pagesのベースパス（`/subtitle-output-system/`）と合っていませんでした。

- **ビルド結果**: `/assets/...` → `https://schop-hirosaki-univcoop.github.io/assets/...` ❌
- **正しいパス**: `/subtitle-output-system/assets/...` → `https://schop-hirosaki-univcoop.github.io/subtitle-output-system/assets/...` ✅

## 解決方法

`vite.config.js`の`base`オプションを正しく設定しました。

### 修正前

```javascript
export default defineConfig({
  plugins: [vue()],
  build: {
    // base: '/subtitle-output-system/', // 間違った位置
    // ...
  },
});
```

### 修正後

```javascript
export default defineConfig({
  plugins: [vue()],
  base: '/subtitle-output-system/', // 正しい位置
  build: {
    // ...
  },
});
```

## 確認

ビルド結果を確認すると、パスが正しく設定されています：

```html
<link rel="icon" type="image/svg+xml" href="/subtitle-output-system/assets/favicon-LldGNIFA.svg">
<script type="module" crossorigin src="/subtitle-output-system/assets/operator-DR-PUOxo.js"></script>
```

## 注意事項

### リポジトリ名が変更された場合

リポジトリ名が変更された場合は、`vite.config.js`の`base`オプションを更新してください。

```javascript
base: '/新しいリポジトリ名/',
```

### ルートパスでホストする場合

GitHub Pagesをルートパス（`https://username.github.io/`）でホストする場合は：

```javascript
base: '/',
```

### 開発サーバーでの動作

開発サーバー（`npm run dev`）では、`base`オプションは影響しません。開発サーバーは常にルートパス（`/`）で動作します。

---

**作成日**: 2025年12月  
**バージョン**: 1.0.0

