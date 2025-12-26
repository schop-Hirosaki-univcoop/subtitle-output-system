// useFormState.js: フォームの状態管理を共通化
import { ref } from 'vue';

/**
 * フォームの状態管理Composable
 * @param {Object} options - オプション
 * @returns {Object} 状態管理のリアクティブな値
 */
export function useFormState() {
  const isLocked = ref(true);
  const isBusy = ref(false);
  const isSubmitting = ref(false);
  const isDirty = ref(false);
  const submissionSuccess = ref(false);

  /**
   * フォームをロック
   */
  const lockForm = () => {
    isLocked.value = true;
  };

  /**
   * フォームをアンロック
   */
  const unlockForm = () => {
    isLocked.value = false;
  };

  /**
   * ビジー状態を設定
   * @param {boolean} busy - ビジー状態
   */
  const setBusy = (busy) => {
    isBusy.value = busy;
  };

  /**
   * 送信状態を設定
   * @param {boolean} submitting - 送信状態
   */
  const setSubmitting = (submitting) => {
    isSubmitting.value = submitting;
  };

  /**
   * ダーティ状態を設定
   * @param {boolean} dirty - ダーティ状態
   */
  const setDirty = (dirty) => {
    isDirty.value = dirty;
  };

  /**
   * 送信成功状態を設定
   * @param {boolean} success - 送信成功状態
   */
  const setSubmissionSuccess = (success) => {
    submissionSuccess.value = success;
  };

  return {
    // 状態
    isLocked,
    isBusy,
    isSubmitting,
    isDirty,
    submissionSuccess,
    // エイリアス（互換性のため）
    formLocked: isLocked, // GlForm用
    // メソッド
    lockForm,
    unlockForm,
    setBusy,
    setSubmitting,
    setDirty,
    setSubmissionSuccess,
  };
}

