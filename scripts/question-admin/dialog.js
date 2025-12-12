// dialog.js: ダイアログ表示や確認モーダルの生成ロジックをまとめています。
import { state } from "./state.js";
import { dom } from "./dom.js";

const dialogState = {
  active: null,
  lastFocused: null
};

function handleDialogKeydown(event) {
  // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
  const activeElement = document.activeElement;
  const isInputFocused = activeElement && (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.isContentEditable
  );
  
  // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
  if (event.key === "Escape") {
    if (dialogState.active) {
      event.preventDefault();
      closeDialog(dialogState.active);
    }
    return;
  }
  
  // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
  if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return;
  }
  
  // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
  if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && dialogState.active) {
    event.preventDefault();
    closeDialog(dialogState.active);
  }
}

function openDialog(element) {
  if (!element) return;
  if (dialogState.active && dialogState.active !== element) {
    closeDialog(dialogState.active);
  }
  dialogState.active = element;
  dialogState.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element.removeAttribute("hidden");
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", handleDialogKeydown);
  const focusTarget = element.querySelector("[data-autofocus]") || element.querySelector("input, select, textarea, button");
  if (focusTarget instanceof HTMLElement) {
    requestAnimationFrame(() => focusTarget.focus());
  }
}

function closeDialog(element, options = {}) {
  if (!element) return;
  const { reason = "dismiss" } = options || {};
  if (!element.hasAttribute("hidden")) {
    element.setAttribute("hidden", "");
  }
  if (element === dom.participantDialog) {
    state.editingParticipantId = null;
    if (dom.participantForm) {
      dom.participantForm.reset();
    }
    setFormError(dom.participantError);
  }
  element.dispatchEvent(new CustomEvent("dialog:close", { detail: { reason } }));
  if (dialogState.active === element) {
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", handleDialogKeydown);
    const toFocus = dialogState.lastFocused;
    dialogState.active = null;
    dialogState.lastFocused = null;
    if (toFocus && typeof toFocus.focus === "function") {
      toFocus.focus();
    }
  }
}

function bindDialogDismiss(element) {
  if (!element) return;
  element.addEventListener("click", event => {
    if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
      event.preventDefault();
      closeDialog(element);
    }
  });
}

function setFormError(element, message = "") {
  if (!element) return;
  if (message) {
    element.textContent = message;
    element.hidden = false;
  } else {
    element.textContent = "";
    element.hidden = true;
  }
}

export { openDialog, closeDialog, bindDialogDismiss, setFormError };
