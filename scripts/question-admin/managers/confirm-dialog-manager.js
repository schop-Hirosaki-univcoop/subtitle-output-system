// confirm-dialog-manager.js: 確認ダイアログ関連の機能を担当します。
export class ConfirmDialogManager {
  constructor(context) {
    this.dom = context.dom;
    
    // 依存関数
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    
    // 状態管理
    this.confirmState = {
      resolver: null,
      keydownHandler: null
    };
  }

  /**
   * 確認状態のクリーンアップ
   */
  cleanupConfirmState() {
    if (this.confirmState.keydownHandler) {
      document.removeEventListener("keydown", this.confirmState.keydownHandler, true);
      this.confirmState.keydownHandler = null;
    }
    this.confirmState.resolver = null;
  }

  /**
   * 確認の確定
   * @param {boolean} result - 確認結果
   */
  finalizeConfirm(result) {
    const resolver = this.confirmState.resolver;
    this.cleanupConfirmState();
    if (this.dom.confirmDialog) {
      this.closeDialog(this.dom.confirmDialog);
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  /**
   * 確認ダイアログのセットアップ
   */
  setupConfirmDialog() {
    if (!this.dom.confirmDialog) return;
    this.dom.confirmDialog.addEventListener("click", event => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        this.finalizeConfirm(false);
      }
    });
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.addEventListener("click", event => {
        event.preventDefault();
        this.finalizeConfirm(false);
      });
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.addEventListener("click", event => {
        event.preventDefault();
        this.finalizeConfirm(true);
      });
    }
  }

  /**
   * 確認アクション
   * @param {Object} options - 確認オプション
   * @param {string} options.title - タイトル
   * @param {string} options.description - 説明
   * @param {string} options.confirmLabel - 確認ラベル
   * @param {string} options.cancelLabel - キャンセルラベル
   * @param {string} options.tone - トーン（"danger" または "primary"）
   * @param {boolean} options.showCancel - キャンセルボタンを表示するか
   * @returns {Promise<boolean>} 確認結果
   */
  async confirmAction({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger",
    showCancel = true
  } = {}) {
    if (!this.dom.confirmDialog) {
      console.warn("Confirm dialog is unavailable; skipping confirmation.");
      return false;
    }

    if (this.confirmState.resolver) {
      this.finalizeConfirm(false);
    }

    if (this.dom.confirmDialogTitle) {
      this.dom.confirmDialogTitle.textContent = title || "確認";
    }
    if (this.dom.confirmDialogMessage) {
      this.dom.confirmDialogMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
      this.dom.confirmCancelButton.hidden = !showCancel;
    }

    this.openDialog(this.dom.confirmDialog);

    return await new Promise(resolve => {
      this.confirmState.resolver = resolve;
      this.confirmState.keydownHandler = event => {
        // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
        const activeElement = document.activeElement;
        const isInputFocused = activeElement && (
          activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.isContentEditable
        );
        
        // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.finalizeConfirm(false);
          return;
        }
        
        // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
        if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
          return;
        }
        
        // N で確認ダイアログをキャンセル（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
        if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.finalizeConfirm(false);
        }
      };
      document.addEventListener("keydown", this.confirmState.keydownHandler, true);
    });
  }
}

