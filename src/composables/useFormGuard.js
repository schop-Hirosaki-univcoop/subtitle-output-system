// useFormGuard.js: フォームのコンテキストガード管理を共通化
import { ref } from 'vue';

/**
 * フォームのコンテキストガード管理Composable
 * @param {Object} options - オプション
 * @param {Function} options.onLock - ロック時のコールバック
 * @param {Function} options.onUnlock - アンロック時のコールバック
 * @param {string} options.guardElementId - ガード要素のID（フォーカス用）
 * @returns {Object} ガード管理の関数とリアクティブな値
 */
export function useFormGuard(options = {}) {
  const { onLock, onUnlock, guardElementId = 'context-guard' } = options;

  const contextGuardMessage = ref('アクセス権を確認しています…');

  /**
   * ガードメッセージを設定してフォームをロック
   * @param {string} message - メッセージ
   */
  const setContextGuard = (message) => {
    contextGuardMessage.value = message || '';
    if (message) {
      if (onLock) {
        onLock();
      }
      // ガード要素にフォーカス
      requestAnimationFrame(() => {
        const guardEl = document.getElementById(guardElementId);
        if (guardEl) {
          try {
            guardEl.focus();
          } catch (error) {
            // no-op
          }
        }
      });
    }
  };

  /**
   * ガードメッセージをクリアしてフォームをアンロック
   */
  const clearContextGuard = () => {
    contextGuardMessage.value = '';
    if (onUnlock) {
      onUnlock();
    }
  };

  /**
   * フォームをロックしてメッセージを表示（QuestionForm互換）
   * @param {string} message - メッセージ
   */
  const lockFormWithMessage = (message) => {
    setContextGuard(message);
  };

  return {
    contextGuardMessage,
    setContextGuard,
    clearContextGuard,
    lockFormWithMessage, // QuestionForm互換用
  };
}

