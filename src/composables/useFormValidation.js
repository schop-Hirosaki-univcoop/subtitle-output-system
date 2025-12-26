// useFormValidation.js: フォームのバリデーション管理を共通化
import { ref } from 'vue';

/**
 * フォームのバリデーション管理Composable
 * @returns {Object} バリデーション管理の関数とリアクティブな値
 */
export function useFormValidation() {
  const fieldErrors = ref({});

  /**
   * フィールドエラーを設定
   * @param {string} fieldName - フィールド名
   * @param {string} message - エラーメッセージ
   */
  const setFieldError = (fieldName, message) => {
    fieldErrors.value[fieldName] = message;
  };

  /**
   * フィールドエラーをクリア
   * @param {string} fieldName - フィールド名
   */
  const clearFieldError = (fieldName) => {
    if (fieldErrors.value[fieldName]) {
      delete fieldErrors.value[fieldName];
    }
  };

  /**
   * すべてのフィールドエラーをクリア
   */
  const clearAllFieldErrors = () => {
    fieldErrors.value = {};
  };

  /**
   * フィールドをバリデーション
   * @param {string} fieldName - フィールド名
   * @param {string} elementId - 要素ID（プレフィックス付き、例: 'gl-name'）
   */
  const validateField = (fieldName, elementId = null) => {
    clearFieldError(fieldName);
    const id = elementId || `gl-${fieldName}`;
    const element = document.getElementById(id);
    if (!element) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      if (!element.checkValidity()) {
        let message = '';
        if (element.validity.valueMissing) {
          message = 'この項目は必須です。';
        } else if (element.validity.typeMismatch && element.type === 'email') {
          message = '正しいメールアドレスを入力してください。';
        } else {
          message = element.validationMessage || '入力内容に誤りがあります。';
        }
        setFieldError(fieldName, message);
      }
    }
  };

  /**
   * 学歴フィールドをバリデーション
   * @param {number} depth - 深度
   * @param {string} elementId - 要素ID
   */
  const validateAcademicField = (depth, elementId = null) => {
    const fieldName = `academic-${depth}`;
    clearFieldError(fieldName);
    const id = elementId || `gl-academic-select-${depth}`;
    const element = document.getElementById(id);
    if (!element || !(element instanceof HTMLSelectElement)) return;
    if (!element.checkValidity()) {
      const levelLabel = element.dataset?.levelLabel || '所属';
      if (element.validity.valueMissing) {
        setFieldError(fieldName, `${levelLabel}を選択してください。`);
      } else {
        setFieldError(fieldName, element.validationMessage || '選択内容に誤りがあります。');
      }
    }
  };

  return {
    fieldErrors,
    setFieldError,
    clearFieldError,
    clearAllFieldErrors,
    validateField,
    validateAcademicField,
  };
}

