// useFormFeedback.js: フォームのフィードバックメッセージ管理を共通化
import { ref } from 'vue';

/**
 * フォームのフィードバックメッセージ管理Composable
 * @returns {Object} フィードバック管理の関数とリアクティブな値
 */
export function useFormFeedback() {
  const feedbackMessage = ref('');
  const feedbackType = ref(''); // 'success', 'error', 'progress'

  /**
   * フィードバックメッセージを設定
   * @param {string} message - メッセージ
   * @param {string} type - タイプ（'success', 'error', 'progress', ''）
   */
  const setFeedback = (message, type = '') => {
    feedbackMessage.value = message;
    feedbackType.value = type;
  };

  /**
   * フィードバックメッセージをクリア
   */
  const clearFeedback = () => {
    feedbackMessage.value = '';
    feedbackType.value = '';
  };

  return {
    feedbackMessage,
    feedbackType,
    setFeedback,
    clearFeedback,
  };
}

