const STACK_ID = "app-toast-stack";
const DEFAULT_DURATION = 4000;

function getDocument() {
  if (typeof document !== "undefined") {
    return document;
  }
  return null;
}

function ensureStack(doc) {
  let stack = doc.getElementById(STACK_ID);
  if (stack) {
    return stack;
  }

  stack = doc.createElement("div");
  stack.id = STACK_ID;
  stack.className = "toast-stack";
  stack.setAttribute("role", "region");
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-label", "通知");
  doc.body.append(stack);
  return stack;
}

function buildToastElement(doc, message, type) {
  const toast = doc.createElement("div");
  toast.className = `toastify toastify-${type}`.trim();
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  toast.setAttribute("aria-hidden", "true");
  toast.tabIndex = -1;

  const messageEl = doc.createElement("div");
  messageEl.className = "toastify__message";
  messageEl.textContent = message;
  toast.append(messageEl);

  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "toastify__close";
  closeButton.setAttribute("aria-label", "通知を閉じる");
  closeButton.textContent = "×";
  toast.append(closeButton);

  return { toast, closeButton };
}

function scheduleRemoval(toast, stack, duration) {
  const win = typeof window !== "undefined" ? window : null;
  if (!win) {
    return {
      dismiss() {},
      clear() {}
    };
  }

  let timerId = win.setTimeout(() => dismiss(), duration);

  const removeStackIfEmpty = () => {
    if (!stack || stack.children.length > 0) {
      return;
    }
    if (typeof stack.remove === "function") {
      stack.remove();
    } else if (stack.parentNode) {
      stack.parentNode.removeChild(stack);
    }
  };

  function dismiss() {
    if (!toast.isConnected) {
      return;
    }
    toast.classList.remove("on");
    toast.setAttribute("aria-hidden", "true");

    const handleTransitionEnd = () => {
      toast.removeEventListener("transitionend", handleTransitionEnd);
      if (toast.isConnected) {
        toast.remove();
      }
      removeStackIfEmpty();
    };

    toast.addEventListener("transitionend", handleTransitionEnd);
    win.setTimeout(() => handleTransitionEnd(), 320);
  }

  const handlePointerEnter = () => {
    if (timerId) {
      win.clearTimeout(timerId);
      timerId = 0;
    }
  };

  const handlePointerLeave = () => {
    if (timerId || !toast.isConnected) {
      return;
    }
    timerId = win.setTimeout(() => dismiss(), duration);
  };

  toast.addEventListener("pointerenter", handlePointerEnter);
  toast.addEventListener("pointerleave", handlePointerLeave);
  toast.addEventListener("focusin", handlePointerEnter);
  toast.addEventListener("focusout", handlePointerLeave);

  return {
    dismiss,
    clear() {
      if (timerId) {
        win.clearTimeout(timerId);
        timerId = 0;
      }
      dismiss();
    }
  };
}

export function showToast(message, type = "success", options = {}) {
  const doc = getDocument();
  if (!doc || !doc.body) {
    return { dismiss() {} };
  }

  const safeType = type === "error" ? "error" : "success";
  const text = String(message ?? "");
  if (!text) {
    return { dismiss() {} };
  }

  const stack = ensureStack(doc);
  const { toast, closeButton } = buildToastElement(doc, text, safeType);
  stack.append(toast);

  const rawDuration = Number(options.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : DEFAULT_DURATION;

  const removal = scheduleRemoval(toast, stack, duration);

  closeButton.addEventListener("click", () => removal.clear());

  requestAnimationFrame(() => {
    toast.classList.add("on");
    toast.removeAttribute("aria-hidden");
    try {
      toast.focus({ preventScroll: true });
    } catch (error) {
      // older browsers may not support focus options
      toast.focus();
    }
  });

  return {
    dismiss: () => removal.clear()
  };
}
