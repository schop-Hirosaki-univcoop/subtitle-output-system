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
