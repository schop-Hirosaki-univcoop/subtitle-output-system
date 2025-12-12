// ui-helpers.js: UI補助機能（ローダー、ダイアログ）をまとめたモジュールです。
import { STEP_LABELS } from "./constants.js";
import { escapeHtml } from "./utils.js";
import { database, ref, update } from "./firebase.js";

// ============================================================================
// ローダー機能
// ============================================================================

/**
 * ローディングオーバーレイを表示します。
 * @param {object} app - OperatorAppインスタンス
 * @param {string} message - 表示するメッセージ
 */
export function showLoader(app, message) {
  if (app.dom.loadingOverlay) app.dom.loadingOverlay.removeAttribute("hidden");
  updateLoader(app, message);
  document.body?.setAttribute("aria-busy", "true");
}

/**
 * ローディングメッセージを更新します。
 * @param {object} app - OperatorAppインスタンス
 * @param {string} message - 表示するメッセージ
 */
export function updateLoader(app, message) {
  if (message && app.dom.loadingText) app.dom.loadingText.textContent = message;
}

/**
 * ローディングオーバーレイを非表示にします。
 * @param {object} app - OperatorAppインスタンス
 */
export function hideLoader(app) {
  if (app.dom.loadingOverlay) app.dom.loadingOverlay.setAttribute("hidden", "");
  document.body?.removeAttribute("aria-busy");
}

/**
 * ローダーのステップ表示を初期化します。
 * @param {object} app - OperatorAppインスタンス
 */
export function initLoaderSteps(app) {
  if (!app.dom.loaderSteps) return;
  const labels = Array.isArray(app.loaderStepLabels) ? app.loaderStepLabels : STEP_LABELS;
  if (!labels.length) {
    app.dom.loaderSteps.innerHTML = "";
    return;
  }
  app.dom.loaderSteps.innerHTML = labels
    .map((label, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`)
    .join("");
}

/**
 * ローダーのステップを設定します。
 * @param {object} app - OperatorAppインスタンス
 * @param {number} stepIndex - ステップインデックス
 * @param {string} message - 表示するメッセージ
 */
export function setLoaderStep(app, stepIndex, message) {
  updateLoader(app, message);
  if (!app.dom.loaderSteps) return;
  const labels = Array.isArray(app.loaderStepLabels) ? app.loaderStepLabels : STEP_LABELS;
  if (!labels.length) {
    return;
  }
  const items = app.dom.loaderSteps.querySelectorAll("li");
  items.forEach((item, index) => {
    item.classList.toggle("current", index === stepIndex);
    item.classList.toggle("done", index < stepIndex);
  });
}

/**
 * ローダーのステップを完了状態にします。
 * @param {object} app - OperatorAppインスタンス
 * @param {string} message - 表示するメッセージ（デフォルト: "準備完了"）
 */
export function finishLoaderSteps(app, message = "準備完了") {
  const labels = Array.isArray(app.loaderStepLabels) ? app.loaderStepLabels : STEP_LABELS;
  if (!labels.length) {
    updateLoader(app, message);
    return;
  }
  setLoaderStep(app, labels.length - 1, message);
}

// ============================================================================
// ダイアログ機能
// ============================================================================

/**
 * ダイアログを開きます。
 * @param {object} app - OperatorAppインスタンス
 * @param {HTMLElement} element - ダイアログ要素
 * @param {HTMLElement} focusTarget - フォーカス対象要素
 */
export function openDialog(app, element, focusTarget) {
  if (!element) return;
  if (app.activeDialog === element) return;
  app.activeDialog = element;
  app.dialogLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element.removeAttribute("hidden");
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", app.handleDialogKeydown);
  const focusEl = focusTarget || element.querySelector("[data-autofocus]") || element.querySelector("input, textarea, button");
  if (focusEl instanceof HTMLElement) {
    requestAnimationFrame(() => focusEl.focus());
  }
}

/**
 * ダイアログを閉じます。
 * @param {object} app - OperatorAppインスタンス
 * @param {HTMLElement} element - ダイアログ要素
 */
export function closeDialog(app, element) {
  if (!element) return;
  const wasActive = app.activeDialog === element;
  if (!element.hasAttribute("hidden")) {
    element.setAttribute("hidden", "");
  }
  if (wasActive) {
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", app.handleDialogKeydown);
    const toFocus = app.dialogLastFocused;
    app.activeDialog = null;
    app.dialogLastFocused = null;
    if (toFocus && typeof toFocus.focus === "function") {
      toFocus.focus();
    }
  }
}

/**
 * 編集ダイアログを閉じます。
 * @param {object} app - OperatorAppインスタンス
 */
export function closeEditDialog(app) {
  const dialog = app.dom.editDialog;
  closeDialog(app, dialog);
  app.editSubmitting = false;
  app.pendingEditUid = null;
  app.pendingEditType = null;
  app.pendingEditOriginal = "";
  if (app.dom.editSaveButton) {
    app.dom.editSaveButton.disabled = false;
  }
}

/**
 * ダイアログのキーダウンイベントを処理します。
 * Nキーでダイアログを閉じます（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）。
 * @param {object} app - OperatorAppインスタンス
 * @param {KeyboardEvent} event - キーボードイベント
 */
export function handleDialogKeydown(app, event) {
  // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
  if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && app.activeDialog) {
    event.preventDefault();
    if (app.activeDialog === app.dom.editDialog) {
      closeEditDialog(app);
    } else if (typeof app.closeActiveDialog === "function") {
      app.closeActiveDialog();
    } else {
      closeDialog(app, app.activeDialog);
    }
  }
}

/**
 * 編集ダイアログを開きます。
 * @param {object} app - OperatorAppインスタンス
 */
export function handleEdit(app) {
  if (!app.state.selectedRowData || !app.dom.editDialog || !app.dom.editTextarea) return;
  app.pendingEditUid = app.state.selectedRowData.uid;
  app.pendingEditType = app.state.selectedRowData.isPickup ? "pickup" : "normal";
  app.pendingEditOriginal = String(app.state.selectedRowData.question || "");
  app.dom.editTextarea.value = app.pendingEditOriginal;
  if (typeof app.dom.editTextarea.setSelectionRange === "function") {
    const length = app.pendingEditOriginal.length;
    app.dom.editTextarea.setSelectionRange(length, length);
  }
  openDialog(app, app.dom.editDialog, app.dom.editTextarea);
}

/**
 * 編集ダイアログの送信を処理します。
 * @param {object} app - OperatorAppインスタンス
 */
export async function handleEditSubmit(app) {
  if (!app.dom.editTextarea || !app.pendingEditUid) return;
  const newText = app.dom.editTextarea.value.trim();
  const original = (app.pendingEditOriginal || "").trim();
  if (!newText) {
    app.toast("質問内容を入力してください。", "error");
    app.dom.editTextarea.focus();
    return;
  }
  if (newText === original) {
    closeEditDialog(app);
    return;
  }
  if (app.editSubmitting) return;
  app.editSubmitting = true;
  if (app.dom.editSaveButton) {
    app.dom.editSaveButton.disabled = true;
  }
  try {
    const branch = app.pendingEditType === "pickup" ? "questions/pickup" : "questions/normal";
    const editPayload = { question: newText, updatedAt: Date.now() };
    console.log("[原稿修正] 更新用JSON:", JSON.stringify({ [`${branch}/${app.pendingEditUid}`]: editPayload }, null, 2));
    await update(ref(database, `${branch}/${app.pendingEditUid}`), editPayload);
    app.api.fireAndForgetApi({ action: "editQuestion", uid: app.pendingEditUid, text: newText });
    app.api.logAction("EDIT", `UID: ${app.pendingEditUid}`);
    app.toast("質問を更新しました。", "success");
    closeEditDialog(app);
  } catch (error) {
    console.error(error);
    app.editSubmitting = false;
    if (app.dom.editSaveButton) {
      app.dom.editSaveButton.disabled = false;
    }
    app.toast("通信エラー: " + error.message, "error");
  }
}














