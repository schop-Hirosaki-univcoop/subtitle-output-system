// index.js: 質問フォームページの初期化を行い、必要なモジュールを結線します。
// Vue.js移行: Vueが有効な場合は既存の初期化をスキップ
if (typeof window === "undefined" || !window.__vueQuestionFormEnabled) {
  import("./app.js").then(({ QuestionFormApp }) => {
    const app = new QuestionFormApp();
    app.init();
  });
}
