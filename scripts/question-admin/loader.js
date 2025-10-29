// loader.js: Firebaseからのデータロードや購読処理を集約したモジュールです。
import { dom } from "./dom.js";
import { loaderState } from "./state.js";

function ensureLoaderTargets() {
  if (typeof document === "undefined") {
    return;
  }

  if (!dom.loadingOverlay) {
    dom.loadingOverlay =
      document.getElementById("qa-loading-overlay") ||
      document.getElementById("loading-overlay") ||
      dom.adminMain?.querySelector(".loading-overlay") ||
      null;
  }

  if (!dom.participantModule) {
    dom.participantModule =
      document.getElementById("qa-participant-module") ||
      document.getElementById("participant-module") ||
      null;
  }

  if (!dom.adminMain) {
    dom.adminMain =
      document.getElementById("qa-admin-main") ||
      document.getElementById("admin-main") ||
      null;
  }

  if (!dom.loadingText && dom.loadingOverlay) {
    dom.loadingText =
      document.getElementById("qa-loading-text") ||
      document.getElementById("loading-text") ||
      dom.loadingOverlay.querySelector("#loading-text, #qa-loading-text, .loading-text span") ||
      null;
  }

  if (!dom.loaderSteps && dom.loadingOverlay) {
    dom.loaderSteps =
      document.getElementById("qa-loader-steps") ||
      document.getElementById("loader-steps") ||
      dom.loadingOverlay.querySelector("#loader-steps, #qa-loader-steps, .loader-steps") ||
      null;
  }
}

function showLoader(message = "初期化しています…") {
  ensureLoaderTargets();
  if (dom.adminMain) {
    dom.adminMain.hidden = false;
    dom.adminMain.removeAttribute("aria-hidden");
    dom.adminMain.removeAttribute("inert");
  }
  if (dom.loadingOverlay) {
    dom.loadingOverlay.hidden = false;
    dom.loadingOverlay.removeAttribute("hidden");
    dom.loadingOverlay.removeAttribute("aria-hidden");
    dom.loadingOverlay.removeAttribute("inert");
  }
  const target = dom.participantModule || dom.adminMain;
  if (target) {
    target.classList.add("is-loading-hidden");
    target.setAttribute("aria-hidden", "true");
    target.setAttribute("inert", "");
  }
  updateLoaderText(message);
}

function hideLoader() {
  ensureLoaderTargets();
  if (dom.loadingOverlay) {
    dom.loadingOverlay.hidden = true;
    dom.loadingOverlay.setAttribute("hidden", "");
    dom.loadingOverlay.setAttribute("aria-hidden", "true");
    dom.loadingOverlay.setAttribute("inert", "");
  }
  const target = dom.participantModule || dom.adminMain;
  if (target) {
    target.classList.remove("is-loading-hidden");
    target.removeAttribute("aria-hidden");
    target.removeAttribute("inert");
  }
}

function updateLoaderText(message) {
  if (dom.loadingText && message) {
    dom.loadingText.textContent = message;
  }
}

function initLoaderSteps(labels = []) {
  if (!dom.loaderSteps) return;
  dom.loaderSteps.innerHTML = "";
  loaderState.items = labels.map(label => {
    const li = document.createElement("li");
    li.textContent = label;
    dom.loaderSteps.appendChild(li);
    return li;
  });
  loaderState.currentIndex = -1;
}

function setLoaderStep(index, message) {
  if (!loaderState.items.length) {
    loaderState.currentIndex = index;
    updateLoaderText(message);
    return;
  }
  loaderState.items.forEach((li, idx) => {
    li.classList.remove("current", "done");
    if (idx < index) {
      li.classList.add("done");
    }
    if (idx === index) {
      li.classList.add("current");
      if (message) {
        li.textContent = message;
      }
    }
  });
  loaderState.currentIndex = index;
  updateLoaderText(message);
}

function finishLoaderSteps(message) {
  if (!loaderState.items.length) {
    updateLoaderText(message || "準備完了");
    return;
  }
  const lastIndex = loaderState.items.length - 1;
  setLoaderStep(lastIndex, message || loaderState.items[lastIndex].textContent);
  loaderState.items.forEach(li => li.classList.add("done"));
}

export { showLoader, hideLoader, updateLoaderText, initLoaderSteps, setLoaderStep, finishLoaderSteps };
