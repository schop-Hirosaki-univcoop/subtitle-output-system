# フェーズ 1: 質問カードの Vue コンポーネント化

## 概要

既存の質問カード表示を Vue.js コンポーネントに置き換える実験的な実装です。既存コードとの共存を確認しながら、段階的に移行します。

## 実装内容

### 1. Vue コンポーネントの構成

#### QuestionCard コンポーネント

- 個別の質問カードを表示
- 既存の HTML 構造（`q-card`クラス）を維持
- ステータス（未送出、送出準備中、送出済）を表示
- ラジオネーム、ジャンル、質問テキスト、班番号を表示

#### QuestionList コンポーネント

- 質問リスト全体を管理
- `app.state.allQuestions`からデータを取得
- 既存のフィルタリングロジック（タブ、ジャンル、日程）を適用
- リアクティブに更新（500ms ごとにチェック）

### 2. 既存コードとの統合

#### OperatorApp インスタンスへのアクセス

- `window.operatorEmbed.app`から OperatorApp インスタンスを取得
- `app.state.allQuestions`から質問データを取得
- `app.state.selectedRowData`で選択状態を管理

#### 既存の renderQuestions との共存

- `window.__vueExperimentEnabled`フラグで Vue コンポーネントを有効化
- 既存の`app.renderQuestions`をラップして、Vue コンポーネントが有効な場合はスキップ
- 既存のイベントハンドラ（クリック、チェックボックス）と統合

### 3. 実装の詳細

#### データフロー

```
app.state.allQuestions
  ↓
QuestionList.updateQuestions()
  ↓
フィルタリング・ソート
  ↓
QuestionCard（各質問）
```

#### イベントハンドリング

- **カードクリック**: `handleClick()` → `app.state.selectedRowData`を更新
- **チェックボックス**: `handleCheckboxChange()` → 既存のロジックに委譲

## 動作確認

### 確認項目

1. **Vue コンポーネントの表示**

   - [ ] 質問カードが表示される
   - [ ] 既存のスタイル（`q-card`クラス）が適用される
   - [ ] ラジオネーム、ジャンル、質問テキストが正しく表示される

2. **リアクティブな更新**

   - [ ] 新しい質問が追加されると自動的に表示される
   - [ ] 質問のステータスが変更されると自動的に更新される
   - [ ] タブやジャンルのフィルターが正しく機能する

3. **既存機能との統合**

   - [ ] カードをクリックすると選択状態が更新される
   - [ ] チェックボックスが機能する
   - [ ] 既存のアクションボタン（送出、未回答へ戻すなど）が機能する

4. **パフォーマンス**
   - [ ] 500ms ごとの更新が適切か確認
   - [ ] 大量の質問がある場合のパフォーマンスを確認

### トラブルシューティング

#### Vue コンポーネントが表示されない

1. **コンソールを確認**

   - `[Vue Experiment]`で始まるメッセージを確認
   - エラーメッセージがないか確認

2. **OperatorApp インスタンスの確認**

   ```javascript
   // ブラウザのコンソールで確認
   console.log(window.operatorEmbed?.app);
   ```

3. **コンテナの確認**
   ```javascript
   // ブラウザのコンソールで確認
   console.log(document.getElementById("vue-questions-container"));
   ```

#### 既存のカードと Vue コンポーネントが両方表示される

- `window.__vueExperimentEnabled`が`true`に設定されているか確認
- 既存の`app.renderQuestions`が正しくラップされているか確認

#### リアクティブな更新が機能しない

- `QuestionList.updateQuestions()`が定期的に呼ばれているか確認
- `app.state.allQuestions`が正しく更新されているか確認

## 次のステップ

### 成功した場合

1. **パフォーマンスの最適化**

   - 500ms ごとの更新を、Firebase リスナーやイベントベースの更新に変更
   - 不要な再レンダリングを削減

2. **既存コードの段階的な置き換え**

   - `renderQuestions`関数を完全に Vue コンポーネントに置き換え
   - 既存のイベントハンドラを Vue コンポーネントに統合

3. **フェーズ 2 への移行**
   - ビルドツール（Vite）の導入
   - TypeScript サポート
   - コンポーネントの`.vue`ファイル化

### 問題が発生した場合

1. **Vue コンポーネントを無効化**

   ```javascript
   window.__vueExperimentEnabled = false;
   // ページをリロード
   ```

2. **既存のコードに戻す**

   - `operator.html`から Vue コンポーネントのコードを削除
   - 既存の`renderQuestions`が正常に動作することを確認

3. **別のアプローチを検討**
   - より小さな機能から始める
   - 既存コードへの影響を最小限にする

## 注意事項

- **実験的な実装**: この実装は実験的なもので、本番環境での使用は推奨されません
- **既存コードへの影響**: 既存の`renderQuestions`をラップしているため、予期しない動作が発生する可能性があります
- **パフォーマンス**: 500ms ごとの更新は一時的な実装です。本番環境では、より効率的な更新方法を採用してください

## 関連ファイル

- `operator.html`: Vue コンポーネントの実装
- `scripts/operator/questions.js`: 既存の`renderQuestions`関数
- `scripts/operator/app.js`: OperatorApp クラス

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
