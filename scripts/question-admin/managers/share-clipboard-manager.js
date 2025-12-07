// share-clipboard-manager.js: 共有・クリップボード関連の機能を担当します。
export class ShareClipboardManager {
  constructor(context) {
    this.state = context.state;
    
    // 依存関数と定数
    this.FORM_PAGE_PATH = context.FORM_PAGE_PATH;
  }

  /**
   * レガシークリップボードコピー
   * @param {string} text - コピーするテキスト
   * @returns {boolean} コピー成功したか
   */
  legacyCopyToClipboard(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try {
      success = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    } catch (error) {
      success = false;
    }
    document.body.removeChild(textarea);
    return success;
  }

  /**
   * 共有 URL の作成
   * @param {string} token - トークン
   * @returns {string} 共有URL
   */
  createShareUrl(token) {
    const url = new URL(this.FORM_PAGE_PATH, window.location.href);
    url.searchParams.set("token", token);
    return url.toString();
  }

  /**
   * 共有リンクのクリップボードコピー
   * @param {string} token - トークン
   * @param {Function} setUploadStatus - アップロードステータス設定関数
   * @returns {Promise<void>}
   */
  async copyShareLink(token, setUploadStatus) {
    if (!token) return;
    const url = this.createShareUrl(token);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        if (setUploadStatus) {
          setUploadStatus("専用リンクをクリップボードへコピーしました。", "success");
        }
      } else {
        throw new Error("Clipboard API is unavailable");
      }
    } catch (error) {
      console.error(error);
      const copied = this.legacyCopyToClipboard(url);
      if (copied) {
        if (setUploadStatus) {
          setUploadStatus("専用リンクをクリップボードへコピーしました。", "success");
        }
      } else {
        if (setUploadStatus) {
          setUploadStatus(`クリップボードにコピーできませんでした。URL: ${url}`, "error");
        }
      }
    }
  }

  /**
   * 選択識別子の取得
   * @returns {Object} 選択識別子オブジェクト
   */
  getSelectionIdentifiers() {
    return {
      eventId: this.state.selectedEventId ? String(this.state.selectedEventId) : "",
      scheduleId: this.state.selectedScheduleId ? String(this.state.selectedScheduleId) : ""
    };
  }
}

