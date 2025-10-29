// loading-tracker.js: 複数の非同期処理を束ねて読込状態を監視するユーティリティです。
/**
 * 同時発生するローディング処理を集計して状態を通知するクラスです。
 */
export class LoadingTracker {
  /**
   * @param {{ onChange?: (state: { active: boolean, message: string }) => unknown }} [options]
   */
  constructor({ onChange } = {}) {
    this.depth = 0;
    this.message = "";
    this.onChange = typeof onChange === "function" ? onChange : () => {};
  }

  /**
   * 読込カウンタをインクリメントし、メッセージを更新します。
   * @param {string} [message]
   */
  begin(message = "") {
    this.depth += 1;
    if (message || !this.message) {
      this.message = message;
    }
    this.onChange(this.getState());
  }

  /**
   * 読込カウンタをデクリメントし、終了時にはメッセージをリセットします。
   */
  end() {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.message = "";
    }
    this.onChange(this.getState());
  }

  /**
   * 現在の読み込みが継続中であればメッセージを差し替えます。
   * @param {string} [message]
   */
  updateMessage(message = "") {
    if (this.depth === 0) {
      this.message = "";
      this.onChange(this.getState());
      return;
    }
    this.message = message || this.message;
    this.onChange(this.getState());
  }

  /**
   * 状態を初期化し、全ての読み込みを解除します。
   */
  reset() {
    this.depth = 0;
    this.message = "";
    this.onChange(this.getState());
  }

  /**
   * 現在処理中かどうかを返します。
   * @returns {boolean}
   */
  isActive() {
    return this.depth > 0;
  }

  /**
   * 現在の読み込み状態を返します。
   * @returns {{ active: boolean, message: string }}
   */
  getState() {
    return { active: this.isActive(), message: this.message };
  }
}
