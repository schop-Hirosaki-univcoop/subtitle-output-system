// tools/frame-utils.js: iframe連携やウィンドウメッセージングの補助処理を提供します。
/**
 * 埋め込み用 iframe や外部ツール DOM を初期化し、ログイン画面を排除して運用モードに整えます。
 * すでに初期化済みの場合は何もせず、SSR環境では副作用を避けます。
 * @param {{ participantsTool?: Element|null, operatorTool?: Element|null }} dom
 */
export function prepareEmbeddedFrames(dom) {
  if (typeof document === "undefined") {
    return;
  }

  const html = document.documentElement;
  if (html) {
    if (!html.dataset.qaEmbedPrefix) {
      html.dataset.qaEmbedPrefix = "qa-";
    }
    if (!html.dataset.operatorEmbedPrefix) {
      html.dataset.operatorEmbedPrefix = "op-";
    }
  }

  const ensurePrepared = (element, loginSelector) => {
    if (!element || element.dataset.prepared === "true") {
      return;
    }
    element.dataset.prepared = "true";
    if (loginSelector) {
      const loginElement = element.querySelector(loginSelector);
      if (loginElement) {
        loginElement.remove();
      }
    }
  };

  ensurePrepared(dom?.participantsTool, "#qa-login-card");
  ensurePrepared(dom?.operatorTool, "#op-login-container");

  if (document.body) {
    document.body.classList.add("dictionary-collapsed", "logs-collapsed");
    document.body.classList.remove("dictionary-open", "logs-open");
  }
}

/**
 * 埋め込みツールへリセット命令を送り、次のイベントに備えて状態をクリーンアップします。
 * window が無い環境では安全のため即座に終了します。
 */
export function resetEmbeddedFrames() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.questionAdminEmbed?.reset?.();
  } catch (error) {
    console.warn("Failed to reset participant tool state", error);
  }

  try {
    window.operatorEmbed?.reset?.();
  } catch (error) {
    console.warn("Failed to reset operator tool state", error);
  }
}
