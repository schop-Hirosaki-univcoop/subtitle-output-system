import { state } from "./state.js";
import { dom } from "./dom.js";

const dialogState = {
  active: null,
  lastFocused: null
};

function handleDialogKeydown(event) {
  if (event.key === "Escape" && dialogState.active) {
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

function closeDialog(element) {
  if (!element) return;
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
