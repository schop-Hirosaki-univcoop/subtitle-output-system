# フェーズ 1 ステップ 2: Vue.js を CDN 経由で導入

## 概要

フェーズ 1 のステップ 1（実験ブランチの作成）が完了したので、続いてステップ 2（Vue.js を CDN 経由で導入）を進めます。

## ステップ 2: Vue.js を CDN 経由で導入

### 2.1 現在の状況確認

現在の `operator.html` の構造：

- 最後に `<script type="module" src="./scripts/events/index.js"></script>` が読み込まれている
- これは `EventAdminApp` を初期化している
- 質問表示は `id="op-questions-cards"` の要素に表示される

### 2.2 Vue.js を追加する場所

既存のスクリプトの**前**に Vue.js を追加します。これにより、既存コードが Vue.js を利用できるようになります。

### 2.3 実装手順

#### ステップ 2-1: Vue.js の CDN スクリプトを追加

`operator.html` の `<head>` セクションまたは `<body>` の最後（既存スクリプトの前）に追加します。

```html
<!-- operator.html -->
<!DOCTYPE html>
<html lang="ja" class="flow-page-root">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="same-origin" />
    <title>イベントコントロールセンター</title>
    <link rel="icon" type="image/svg+xml" href="assets/favicon.svg" />
    <link rel="stylesheet" href="style.css" />
    <script type="module" src="./scripts/shared/layout.js"></script>

    <!-- Vue.js を CDN から読み込む（実験） -->
    <script src="https://unpkg.com/vue@3.3.4/dist/vue.global.js"></script>
  </head>
  <body class="op-theme events-page flow-page">
    <!-- ... 既存の HTML ... -->

    <telop-footer year="2025"></telop-footer>

    <!-- 既存のスクリプト（そのまま維持） -->
    <script type="module" src="./scripts/events/index.js"></script>

    <!-- Vue.js の実験用スクリプト（新規追加） -->
    <script type="module">
      // Vue.js が読み込まれたことを確認
      if (typeof Vue === "undefined") {
        console.error("[Vue Experiment] Vue.js が読み込まれていません");
      } else {
        console.log("[Vue Experiment] Vue.js が読み込まれました", Vue.version);
      }
    </script>
  </body>
</html>
```

#### ステップ 2-2: 小さな Vue コンポーネントを追加（動作確認用）

既存コードに影響を与えないように、小さなテストコンポーネントを追加します。

```html
<!-- operator.html の <body> 内、既存コンテンツの後に追加 -->
<body class="op-theme events-page flow-page">
  <!-- ... 既存の HTML ... -->

  <!-- Vue.js 実験用のコンテナ（既存コードに影響しない場所に配置） -->
  <div id="vue-experiment-container" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 5px; font-size: 12px;">
    <!-- Vue コンポーネントがここにマウントされる -->
  </div>

  <telop-footer year="2025"></telop-footer>

  <!-- 既存のスクリプト（そのまま維持） -->
  <script type="module" src="./scripts/events/index.js"></script>

  <!-- Vue.js の実験用スクリプト -->
  <script type="module">
    // Vue.js が読み込まれたことを確認
    if (typeof Vue === 'undefined') {
      console.error('[Vue Experiment] Vue.js が読み込まれていません');
      return;
    }

    console.log('[Vue Experiment] Vue.js が読み込まれました', Vue.version);

    // 小さなテストコンポーネントを作成
    const { createApp } = Vue;

    const testApp = createApp({
      data() {
        return {
          message: 'Vue.js 実験中',
          count: 0
        };
      },
      mounted() {
        console.log('[Vue Experiment] Vue アプリがマウントされました');
        // 1秒ごとにカウントを増やす（動作確認用）
        setInterval(() => {
          this.count++;
        }, 1000);
      },
      template: `
        <div>
          <div>{{ message }}</div>
          <div>カウント: {{ count }}</div>
          <div style="font-size: 10px; margin-top: 5px; opacity: 0.7;">
            Vue {{ version }}
          </div>
        </div>
      `,
      computed: {
        version() {
          return Vue.version || 'unknown';
        }
      }
    });

    // コンテナにマウント
    const container = document.getElementById('vue-experiment-container');
    if (container) {
      testApp.mount('#vue-experiment-container');
      console.log('[Vue Experiment] Vue アプリをマウントしました');
    } else {
      console.warn('[Vue Experiment] コンテナが見つかりません');
    }
  </script>
</body>
</html>
```

### 2.4 動作確認

1. **ブラウザで `operator.html` を開く**
2. **開発者ツールのコンソールを確認**
   - `[Vue Experiment] Vue.js が読み込まれました` というメッセージが表示される
   - `[Vue Experiment] Vue アプリがマウントされました` というメッセージが表示される
3. **画面右下にテストコンポーネントが表示される**
   - 「Vue.js 実験中」というメッセージ
   - カウントが 1 秒ごとに増える
   - Vue のバージョンが表示される
4. **既存機能が正常に動作することを確認**
   - 既存の `EventAdminApp` が正常に動作する
   - 質問表示など、既存機能が壊れていない

### 2.5 トラブルシューティング

#### Vue.js が読み込まれない場合

- ネットワーク接続を確認
- CDN の URL が正しいか確認
- ブラウザのコンソールでエラーを確認

#### 既存機能が壊れた場合

- Vue.js のスクリプトを削除して動作確認
- 既存コードとの競合を確認
- 段階的に追加して問題箇所を特定

## 次のステップ

動作確認が完了したら、ステップ 3（動作確認とコミット）に進みます。

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
