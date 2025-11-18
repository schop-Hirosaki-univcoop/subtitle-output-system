import { normalizePrintSettings, DEFAULT_PRINT_SETTINGS } from "./print-utils.js";

const DEFAULT_PREVIEW_NOTE = "印刷設定を選ぶとここに最新のプレビューが表示されます。";
const DEFAULT_LOAD_TIMEOUT_MS = 4000;

function defaultOpenPrintWindow(html, docTitle) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    return false;
  }

  try {
    printWindow.opener = null;
  } catch (error) {
    // Ignore opener errors
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } catch (error) {
    // Ignore document write errors
  }

  try {
    if (docTitle) {
      printWindow.document.title = docTitle;
    }
  } catch (error) {
    // Ignore title errors
  }

  window.setTimeout(() => {
    try {
      printWindow.print();
    } catch (error) {
      // Ignore print errors
    }
  }, 150);

  return true;
}

function normalizeLivePoliteness(value, { defaultValue = "" } = {}) {
  const normalize = (input) => {
    const trimmed = (input || "").trim().toLowerCase();
    return trimmed === "assertive" || trimmed === "polite" || trimmed === "off"
      ? trimmed
      : "";
  };

  return normalize(value) || normalize(defaultValue);
}

function normalizeLiveRegionRole(value) {
  const trimmed = (value || "").trim().toLowerCase();
  return trimmed === "status" || trimmed === "alert" ? trimmed : "";
}

function createPrintPreviewController({
  previewContainer,
  previewFrame,
  previewMeta,
  previewNote,
  previewPrintButton,
  previewDialog,
  defaultNote = DEFAULT_PREVIEW_NOTE,
  loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  defaultSettings = DEFAULT_PRINT_SETTINGS,
  normalizeSettings = (settings, fallback) => normalizePrintSettings(settings, fallback),
  onVisibilityChange,
  onCacheChange,
  openPopup = defaultOpenPrintWindow
} = {}) {
  const resolveDefaultSettings = () =>
    typeof defaultSettings === "function" ? defaultSettings() : defaultSettings;

  let previewCache = {
    html: "",
    title: "",
    metaText: "",
    printSettings: null,
    forcePopupFallback: false
  };
  let previewLoadAbort = null;
  let autoPrintPending = false;

  const clearLoadHandlers = () => {
    if (!previewLoadAbort) {
      return;
    }
    const { loadHandler, errorHandler, timeoutId } = previewLoadAbort;
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    if (previewFrame && loadHandler) {
      previewFrame.removeEventListener("load", loadHandler);
    }
    if (previewFrame && errorHandler) {
      previewFrame.removeEventListener("error", errorHandler);
    }
    previewLoadAbort = null;
  };

  const cachePreview = (
    { html = "", title = "", metaText = "", printSettings = null, forcePopupFallback } = {},
    { preserveFallbackFlag = false } = {}
  ) => {
    const nextForcePopupFallback =
      forcePopupFallback !== undefined
        ? Boolean(forcePopupFallback)
        : preserveFallbackFlag
        ? Boolean(previewCache.forcePopupFallback)
        : false;

    previewCache = {
      html: html || "",
      title: title || "",
      metaText: metaText || "",
      printSettings: printSettings
        ? normalizeSettings(printSettings, resolveDefaultSettings())
        : previewCache.printSettings,
      forcePopupFallback: nextForcePopupFallback
    };

    if (typeof onCacheChange === "function") {
      onCacheChange(previewCache);
    }

    return previewCache;
  };

  const setVisibility = (visible) => {
    if (previewDialog && typeof previewDialog.showModal === "function") {
      if (visible && !previewDialog.open) {
        try {
          previewDialog.showModal();
        } catch (error) {
          // ignore dialog errors
        }
      } else if (!visible && previewDialog.open) {
        try {
          previewDialog.close();
        } catch (error) {
          // ignore dialog errors
        }
      }
    }

    if (previewContainer) {
      previewContainer.hidden = !visible;
      previewContainer.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    if (typeof onVisibilityChange === "function") {
      onVisibilityChange(Boolean(visible));
    }
  };

  const setBusy = (isBusy) => {
    if (previewContainer) {
      previewContainer.setAttribute("aria-busy", isBusy ? "true" : "false");
    }
  };

  const setNote = (text = defaultNote, options = {}) => {
    const { forceAnnounce = false, politeness, role } = options || {};
    if (!previewNote) {
      return;
    }

    const nextText = text || "";
    const currentText = previewNote.textContent || "";
    const rawCurrentLive = previewNote.getAttribute("aria-live");
    const roleOverride = role !== undefined ? normalizeLiveRegionRole(role) : null;
    const defaultPoliteness = roleOverride === "alert" ? "assertive" : "polite";
    const nextLive = normalizeLivePoliteness(politeness, { defaultValue: defaultPoliteness });
    const currentLive = normalizeLivePoliteness(rawCurrentLive, { defaultValue: "" });
    let nextRole =
      roleOverride !== null
        ? roleOverride
        : nextLive === "assertive"
        ? "alert"
        : nextLive === "polite"
        ? "status"
        : "";

    if (nextLive === "off") {
      nextRole = "";
    }
    const rawCurrentRole = previewNote.getAttribute("role");
    const currentRole = normalizeLiveRegionRole(rawCurrentRole);
    const liveChanged = nextLive !== currentLive;
    const roleChanged = nextRole !== currentRole;
    const liveNeedsClear = !nextLive && rawCurrentLive !== null;
    const roleNeedsClear = !nextRole && rawCurrentRole !== null;

    previewNote.classList.remove("print-preview__note--error");

    const shouldAnnounce =
      forceAnnounce || liveChanged || roleChanged || liveNeedsClear || roleNeedsClear;
    const shouldUpdateRole = roleChanged || roleNeedsClear || forceAnnounce;
    const shouldForceLiveReset = forceAnnounce && nextLive !== "off";
    const shouldForceRoleReset = forceAnnounce && shouldUpdateRole;

    const applyLive = (value) => {
      if (!value || value === "off") {
        previewNote.removeAttribute("aria-live");
      } else {
        previewNote.setAttribute("aria-live", value);
      }
    };

    if (!shouldAnnounce && currentText === nextText) {
      return;
    }

    if (shouldForceLiveReset) {
      applyLive("off");
    } else if (liveChanged || liveNeedsClear || nextLive === "off") {
      applyLive(nextLive);
    }

    if (shouldForceRoleReset) {
      previewNote.removeAttribute("role");
    }

    if (shouldUpdateRole && !shouldForceRoleReset) {
      if (nextRole) {
        previewNote.setAttribute("role", nextRole);
      } else {
        previewNote.removeAttribute("role");
      }
    }

    previewNote.textContent = "";

    const restoreLive = () => {
      if (shouldForceLiveReset) {
        applyLive(nextLive);
      }
    };

    const renderText = () => {
      if (previewNote.textContent === nextText) {
        restoreLive();
        return;
      }
      previewNote.textContent = nextText;
      restoreLive();
    };

    if (shouldAnnounce || shouldForceRoleReset || shouldForceLiveReset) {
      window.requestAnimationFrame(renderText);
    } else {
      renderText();
    }
  };

  const reset = () => {
    clearLoadHandlers();
    if (previewFrame) {
      previewFrame.srcdoc = "";
    }
    if (previewContainer) {
      previewContainer.classList.remove("print-preview--fallback");
    }
    if (previewMeta) {
      previewMeta.textContent = "";
    }
    if (previewPrintButton) {
      previewPrintButton.disabled = true;
      delete previewPrintButton.dataset.popupFallback;
    }
    setBusy(false);
    cachePreview({ forcePopupFallback: false });
    setNote(defaultNote);
    autoPrintPending = false;
    if (typeof onCacheChange === "function") {
      onCacheChange(previewCache);
    }
    return previewCache;
  };

  const renderPreviewFallbackNote = (message, metaText) => {
    const hasCachedHtml = Boolean(previewCache.html || previewCache.forcePopupFallback);
    const popupHint = hasCachedHtml
      ? " 画面右の「このリストを印刷」からポップアップ印刷を再試行できます。"
      : "";
    const noteText = `${message || "プレビューを表示できませんでした。"}${popupHint}`;
    const nextMetaText = metaText || previewCache.metaText || "";

    setVisibility(true);
    setNote(noteText, { forceAnnounce: true, politeness: "assertive" });
    setBusy(false);
    cachePreview({
      ...previewCache,
      metaText: nextMetaText,
      forcePopupFallback: true
    });
    autoPrintPending = false;
    if (previewMeta) {
      previewMeta.textContent = nextMetaText;
    }
    if (previewPrintButton) {
      previewPrintButton.disabled = !hasCachedHtml;
      if (hasCachedHtml) {
        previewPrintButton.dataset.popupFallback = "true";
      } else {
        delete previewPrintButton.dataset.popupFallback;
      }
    }
    if (previewNote) {
      previewNote.classList.add("print-preview__note--error");
    }
  };

  const renderPreview = ({ html, metaText, title, autoPrint = false, printSettings } = {}) => {
    if (!previewContainer || !previewFrame) {
      return false;
    }

    setBusy(true);

    const fallbackSettings = resolveDefaultSettings();
    const normalizedPrintSettings = normalizeSettings(
      printSettings || previewCache.printSettings || fallbackSettings,
      fallbackSettings
    );

    clearLoadHandlers();
    cachePreview({ html, title, metaText, printSettings: normalizedPrintSettings }, { preserveFallbackFlag: true });
    autoPrintPending = Boolean(autoPrint);

    const handleLoad = () => {
      clearLoadHandlers();
      const hasWindow = Boolean(previewFrame?.contentWindow);
      const hasDocument = Boolean(previewFrame?.contentDocument);
      if (previewContainer) {
        previewContainer.classList.remove("print-preview--fallback");
      }
      if (!hasWindow || !hasDocument) {
        renderPreviewFallbackNote("プレビューを読み込めませんでした。", metaText);
        return;
      }

      if (previewMeta) {
        previewMeta.textContent = metaText || "";
      }
      if (previewPrintButton) {
        previewPrintButton.disabled = false;
        if (previewCache.forcePopupFallback) {
          previewPrintButton.dataset.popupFallback = "true";
        } else {
          delete previewPrintButton.dataset.popupFallback;
        }
      }

      setNote("プレビューを読み込みました。", { forceAnnounce: true, politeness: "polite" });
      setBusy(false);
      setVisibility(true);

      if (title && previewFrame?.contentDocument) {
        previewFrame.contentDocument.title = title;
      }

      if (autoPrintPending && previewCache.html) {
        autoPrintPending = false;
        try {
          const printWindow = previewFrame.contentWindow;
          if (printWindow) {
            printWindow.focus();
            printWindow.print();
          }
        } catch (error) {
          renderPreviewFallbackNote(
            "印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。",
            metaText
          );
        }
      }
    };

    const handleError = () => {
      clearLoadHandlers();
      renderPreviewFallbackNote("プレビューを読み込めませんでした。", metaText);
    };

    previewLoadAbort = { loadHandler: handleLoad, errorHandler: handleError };
    previewFrame.addEventListener("load", handleLoad);
    previewFrame.addEventListener("error", handleError);

    const handleTimeout = () => {
      clearLoadHandlers();
      renderPreviewFallbackNote("プレビューの読み込みがタイムアウトしました。", metaText);
      if (autoPrint && html) {
        const fallbackOpened = openPopup(html, title, normalizedPrintSettings);
        if (!fallbackOpened) {
          window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
        }
      }
    };

    const loadTimeoutId = window.setTimeout(handleTimeout, loadTimeoutMs);
    previewLoadAbort.timeoutId = loadTimeoutId;
    autoPrintPending = Boolean(autoPrint);
    previewFrame.srcdoc = html || "<!doctype html><title>プレビュー</title>";
    return true;
  };

  const triggerInlinePrint = () => {
    if (!previewFrame) return false;
    const printWindow = previewFrame.contentWindow;
    if (!printWindow) return false;
    try {
      printWindow.focus();
      printWindow.print();
      return true;
    } catch (error) {
      return false;
    }
  };

  const printPreview = ({ showAlertOnFailure = false } = {}) => {
    const cachedHtml = previewCache?.html || "";
    const cachedTitle = previewCache?.title || "";
    const cachedMeta = previewCache?.metaText || "";
    const cachedSettings = previewCache?.printSettings || resolveDefaultSettings();
    const forcePopupFallback = previewCache?.forcePopupFallback;

    if (!forcePopupFallback) {
      const printedInline = triggerInlinePrint();
      if (printedInline) {
        if (previewPrintButton) {
          delete previewPrintButton.dataset.popupFallback;
        }
        return true;
      }
    }

    if (cachedHtml) {
      renderPreviewFallbackNote("ブラウザの印刷ダイアログを新しいタブで開いています。", cachedMeta);

      const popupOpened = openPopup(cachedHtml, cachedTitle, cachedSettings);
      if (popupOpened) {
        cachePreview({ ...previewCache, forcePopupFallback: true });
        if (previewPrintButton) {
          previewPrintButton.dataset.popupFallback = "true";
        }
        return true;
      }
    }

    if (showAlertOnFailure) {
      window.alert("印刷を開始できませんでした。ブラウザのポップアップ設定をご確認ください。");
    }

    return false;
  };

  return {
    cachePreview,
    setVisibility,
    setBusy,
    setNote,
    reset,
    renderPreview,
    printPreview,
    getCache: () => previewCache,
    setAutoPrintPending: (value) => {
      autoPrintPending = Boolean(value);
    }
  };
}

export {
  DEFAULT_PREVIEW_NOTE,
  DEFAULT_LOAD_TIMEOUT_MS,
  defaultOpenPrintWindow,
  createPrintPreviewController
};
