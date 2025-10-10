import { STEP_LABELS } from "./constants.js";
import { escapeHtml } from "./utils.js";

export function showLoader(app, message) {
  if (app.dom.loadingOverlay) app.dom.loadingOverlay.removeAttribute("hidden");
  updateLoader(app, message);
  document.body?.setAttribute("aria-busy", "true");
}

export function updateLoader(app, message) {
  if (message && app.dom.loadingText) app.dom.loadingText.textContent = message;
}

export function hideLoader(app) {
  if (app.dom.loadingOverlay) app.dom.loadingOverlay.setAttribute("hidden", "");
  document.body?.removeAttribute("aria-busy");
}

export function initLoaderSteps(app) {
  if (!app.dom.loaderSteps) return;
  app.dom.loaderSteps.innerHTML = STEP_LABELS.map((label, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`).join("");
}

export function setLoaderStep(app, stepIndex, message) {
  updateLoader(app, message);
  if (!app.dom.loaderSteps) return;
  const items = app.dom.loaderSteps.querySelectorAll("li");
  items.forEach((item, index) => {
    item.classList.toggle("current", index === stepIndex);
    item.classList.toggle("done", index < stepIndex);
  });
}

export function finishLoaderSteps(app, message = "準備完了") {
  setLoaderStep(app, STEP_LABELS.length - 1, message);
}
