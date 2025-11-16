# 印刷プレビュー実装メモ

## iFrame を canvas の中に入れる案について
- ブラウザの印刷ワークフローは DOM を元にしており、canvas でラップしてしまうとページ分割やページカウンターなど CSS に依存する要素が失われます。
- iFrame + canvas で強制的に見た目を固定すると、ブラウザ標準の印刷機能によるフォント置換や拡大縮小制御を阻害する可能性があり、保守コストも高くなります。
- 既存の `print-surface` クラスは、プレビューと実際の印刷の両方で同じ HTML/CSS をそのまま利用する設計のため、追加の描画レイヤーが不要です。

## 現状の方針
- `app.js` で生成している印刷用 HTML に `print-surface` を付与し、@media print のスタイルを統合して再利用しています。
- ブラウザが提供するページ分割やカウンター、余白指定をそのまま活用できるため、canvas を介さずにプレビューと印刷の見た目を一致させられます。
- 追加の拡大縮小が必要な場合は、`print-surface` にスケール用のラッパーを付けるなど、DOM/CSS ベースで拡張する方が安全です。
- `print-surface` 自体をページサイズに合わせてセンタリングし（A3/A4/Letter を mm で指定）、`--preview-scale` で拡大率を統一できるようにしました。印刷時は box-shadow やスケールを無効化し、@page の余白だけを適用します。

## スプレッドシートのプレビュー構造との違い
Google スプレッドシートの印刷プレビューは以下のように複数のラッパーで canvas を囲み、ページごとにカード状のレイアウトを構築しています。

```html
<div class="waffle-printing-preview-pane">
  <div class="waffle-printing-preview-outer">
    <div class="waffle-printing-preview-inner">
      <div class="waffle-printing-preview-card-wrapper">
        <div class="waffle-printing-preview-card">
          <canvas>
        </div>
      </div>
    </div>
  </div>
</div>
```

canvas に描画する方式は「プレビュー専用の固定画」を生成するため、ブラウザのページ分割やカウンター、余白計算と切り離された独自実装になります。本プロダクトは `print-surface` で DOM/CSS をそのまま使う設計を維持し、必要に応じて外側に `preview-pane` やスケーリング用ラッパーを被せることで、印刷機能との整合性を保ったまま見た目を調整する方針です。

### さらに詳しい構造（スクロール可能なプレビュー）
Google 側では、`waffle-printing-preview-pane` 直下にスクロールコンテナがあり、その中にページカードが縦積みされています。

```html
<div class="waffle-printing-preview-pane">
  <div class="waffle-printing-preview-outer">
    <div class="waffle-printing-preview-inner">
      <div class="waffle-printing-preview-card-wrapper" role="presentation">
        <div class="waffle-printing-preview-card" tabindex="0" style="margin-bottom: 48px;">
          <canvas></canvas>
        </div>
        <!-- ページごとにカードが追加される -->
      </div>
    </div>
  </div>
</div>
```

`waffle-printing-preview-card-wrapper` は `overflow: auto;`（スクロール）、`waffle-printing-preview-card` はページ間マージン・影・背景色の付与と、キャンバスのアスペクト比固定に使われています。拡大縮小はカードの内側で canvas をスケールするのではなく、カード全体に `transform: scale(...)` を当てていました。

### 同様の見た目を実現する方法
- **DOM/CSS で再現可能**: `print-surface` の出力（実際に印刷する DOM）をキャンバス化せず、そのまま「プレビューカード」に入れることで同様の縦積み UI を構築できます。印刷時はカードの中身だけを印字対象にし、周囲の影や余白は `@media print { display: none; }` で除去できます。
- **推奨する実装パターン**:
  - プレビュー用の親: `.preview-pane { overflow: auto; height: 100%; background: #f5f5f5; }`
  - カードラッパー: `.preview-card { margin: 24px auto; padding: 24px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,.12); transform: scale(var(--preview-scale, 1)); transform-origin: top center; }`
  - 中身: `print-surface` をそのままカード内に配置し、ページ分割は CSS (`break-after`, `page-break-after`) を利用する。
  - 拡大縮小: スライダー等で `--preview-scale` を変更し、DOM をスケールさせる。
- **canvas 化は非推奨**: html2canvas などで DOM を画像化してカードに入れることも可能ですが、ページ区切り・ヘッダー/フッターやベクターフォントの再利用が失われるため、最終印刷と差異が生じやすくなります。

このように、キャンバスを使わなくても同じ「縦に並ぶカード形式のプレビュー」を構築できます。DOM をそのまま活かすことで、印刷時に `@media print` の指定とページ分割ロジックを共有し、プレビューと実際の出力のズレを最小化できます。

## プレビューと印刷のサイズがずれないようにするには
- **基準を紙サイズに寄せる**: プレビューカードの内側にある `print-surface` に対し、印刷と同じ `@page { size: A4; margin: ... }`（または相当の CSS）を適用し、カード自身の幅・余白も同じ値に合わせます。CSS の実寸ベースを揃えておけば、プレビュー縮尺を 1 にした時点で印刷と同一寸法になります。
- **プレビュー側の縮尺は `transform` で統一**: プレビューだけ縮小／拡大させたい場合は、カード外側で `transform: scale(var(--preview-scale)); transform-origin: top center;` を使います。`--preview-scale: 1` を標準値にしておけば、印刷時（`@media print`）にスケール指定を無効化するだけで実寸に戻せます。
- **キャンバスを使わなくても比率は保持できる**: DOM/CSS のままでも、カード幅を `210mm`（A4 幅）など物理単位で固定し、`@media print` の余白と一致させれば、プレビュー＝印刷のレイアウトを担保できます。キャンバスを二重に指定する利点（内部解像度と表示サイズの分離）は、DOM でも「幅を mm/px で固定し、`transform` で表示スケールを変える」ことで代替できます。
- **border-box で寸法を一致させる**: プレビュー時に `width: var(--page-width); padding: var(--page-margin);` とする場合は `box-sizing: border-box;` を付与すると、余白込みの外寸がページ幅と一致し、印刷時に余分な拡大/縮小が入らなくなります。実際の印刷では `@media print` 内で `box-sizing: content-box;` に戻し、ページマージン（`@page margin`）を優先させるとズレを防げます。
- **印刷時は @page の余白幅に合わせて幅を再指定する**: 印刷媒体では `@page` の余白を引いた実効領域が `var(--page-width) - 2 * var(--page-margin)` になるため、`@media print` 内の `.print-surface` に `width: var(--page-content-width); margin: 0 auto; padding: 0; box-sizing: content-box;` を与えておくと、プレビューと印刷で同じ幅に揃えられます（ボックスモデルの差分によるはみ出しを防止）。このとき `:root` に `--page-content-width: calc(var(--page-width) - (2 * var(--page-margin)));` を置いておけば、余白計算を 1 箇所にまとめつつプレビュー／印刷の両方で流用できます。
- **画面プレビューの縦横比を固定する**: `.print-surface` に `aspect-ratio: calc(var(--page-width) / var(--page-height));` を与えると、スクロール中に中身が少なくてもカードのシルエットが紙サイズの比率で保たれます。印刷時は `aspect-ratio: auto;` に戻し、実データの高さと `min-height: var(--page-content-height);` を優先させると安全です。
- **縦横比固定時も高さは自動伸長させる**: プレビューで比率を維持する場合でも、`height: auto; min-height: var(--page-height);` を併用しておくと、行数が増えたときにカードが自然に縦方向へ拡張され、スクロールやレイアウト崩れを避けられます。
- **高さも余白差分を一元管理する**: 上下余白を引いた実効高さは `var(--page-height) - 2 * var(--page-margin)` なので、同様に `--page-content-height` を `:root` で計算しておくと、印刷時の `.print-surface` に `min-height: var(--page-content-height);` を与えてプレビューと揃えるときに再利用できます。

## 画像に写っていた iframe と同名クラスの div について
Google Sheets のプレビュー DOM では、`<iframe class="goog-modalpopup-bg" src="about:blank">` と同じクラス名の `<div class="goog-modalpopup-bg">` が縦に並んでいます。これは Closure Library の `ModalPopup` が使う古い「iframe シム」と背景オーバーレイの二重構造で、以下の目的があります。
- `iframe` 側: 旧ブラウザ（特に IE 系）で `select` 要素などフォーカスを奪う要素を覆い隠すための透明シム。`about:blank` で中身を空にし、背景用クラスを適用。
- `div` 側: 実際の半透明オーバーレイ（黒背景＋透過）や z-index 制御用。ユーザーが目視するのはこちら。

この二層で、レンダリング上の抜け漏れを防ぎつつ、画面ロック用の背景を安定表示する仕組みになっています。
