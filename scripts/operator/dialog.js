import { database, ref, update } from "./firebase.js";

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

export function closeEditDialog(app) {
  const dialog = app.dom.editDialog;
  const wasActive = app.activeDialog === dialog;
  if (dialog && !dialog.hasAttribute("hidden")) {
    dialog.setAttribute("hidden", "");
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
  app.editSubmitting = false;
  app.pendingEditUid = null;
  app.pendingEditOriginal = "";
  if (app.dom.editSaveButton) {
    app.dom.editSaveButton.disabled = false;
  }
}

export function handleDialogKeydown(app, event) {
  if (event.key === "Escape" && app.activeDialog) {
    event.preventDefault();
    closeEditDialog(app);
  }
}

export function handleEdit(app) {
  if (!app.state.selectedRowData || !app.dom.editDialog || !app.dom.editTextarea) return;
  app.pendingEditUid = app.state.selectedRowData.uid;
  app.pendingEditOriginal = String(app.state.selectedRowData.question || "");
  app.dom.editTextarea.value = app.pendingEditOriginal;
  if (typeof app.dom.editTextarea.setSelectionRange === "function") {
    const length = app.pendingEditOriginal.length;
    app.dom.editTextarea.setSelectionRange(length, length);
  }
  openDialog(app, app.dom.editDialog, app.dom.editTextarea);
}

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
    await update(ref(database, `questions/${app.pendingEditUid}`), { question: newText });
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
