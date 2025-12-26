// useFormSubmission.js: フォームの送信処理を共通化
import { ref } from 'vue';

/**
 * フォームの送信処理管理Composable
 * @param {Object} options - オプション
 * @param {Function} options.createController - AbortControllerを作成する関数（オプション）
 * @returns {Object} 送信処理管理の関数とリアクティブな値
 */
export function useFormSubmission(options = {}) {
  const { createController = null } = options;
  const submittingController = ref(null);

  /**
   * 保留中の送信を中止
   */
  const abortPendingSubmission = () => {
    if (submittingController.value) {
      submittingController.value.abort();
      submittingController.value = null;
    }
  };

  /**
   * 送信コントローラーを開始
   * @returns {AbortController|null} 送信コントローラー
   */
  const startSubmissionController = () => {
    abortPendingSubmission();
    if (createController) {
      const controller = createController();
      submittingController.value = controller;
      return controller;
    }
    return null;
  };

  /**
   * 送信コントローラーをクリア
   * @param {AbortController} controller - クリアするコントローラー
   */
  const clearSubmissionController = (controller) => {
    if (submittingController.value === controller) {
      submittingController.value = null;
    }
  };

  return {
    submittingController,
    abortPendingSubmission,
    startSubmissionController,
    clearSubmissionController,
  };
}

