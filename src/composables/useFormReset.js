// useFormReset.js: フォームのリセット処理を共通化
/**
 * フォームのリセット処理管理Composable
 * @param {Object} options - オプション
 * @param {Object} options.fields - リセットするフィールドのrefオブジェクト
 * @param {Array<string>} options.excludeFields - リセットから除外するフィールド名（例: ['radioName']）
 * @param {Function} options.onReset - リセット後のコールバック
 * @returns {Object} リセット処理の関数
 */
export function useFormReset(options = {}) {
  const { fields = {}, excludeFields = [], onReset = null } = options;

  /**
   * フォームをリセット
   * @param {Object} additionalFields - 追加でリセットするフィールド
   */
  const resetForm = (additionalFields = {}) => {
    const allFields = { ...fields, ...additionalFields };
    Object.keys(allFields).forEach((fieldName) => {
      if (!excludeFields.includes(fieldName) && allFields[fieldName]?.value !== undefined) {
        // 文字列フィールドは空文字列に、booleanフィールドはfalseに、配列フィールドは空配列にリセット
        if (Array.isArray(allFields[fieldName].value)) {
          allFields[fieldName].value = [];
        } else if (typeof allFields[fieldName].value === 'boolean') {
          allFields[fieldName].value = false;
        } else {
          allFields[fieldName].value = '';
        }
      }
    });
    if (onReset) {
      onReset();
    }
  };

  /**
   * フォームを送信後にリセット（ラジオネームなど特定フィールドを保持）
   * @param {Object} additionalFields - 追加でリセットするフィールド
   */
  const resetFormAfterSubmission = (additionalFields = {}) => {
    resetForm(additionalFields);
  };

  /**
   * フォームをコンテキスト変更時にリセット
   * @param {Object} additionalFields - 追加でリセットするフィールド
   */
  const resetFormForContext = (additionalFields = {}) => {
    resetForm(additionalFields);
  };

  return {
    resetForm,
    resetFormAfterSubmission,
    resetFormForContext,
  };
}

