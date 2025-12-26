<!-- FormActions.vue: フォームの送信ボタンとフィードバック表示コンポーネント -->
<template>
  <div class="form-actions">
    <button
      type="submit"
      class="btn btn-primary"
      :id="buttonId"
      :disabled="disabled"
      :aria-busy="isBusy"
    >
      {{ computedButtonLabel }}
    </button>
    <p
      v-if="feedbackMessage"
      :id="feedbackId"
      class="form-feedback"
      :class="{
        'form-feedback--success': feedbackType === 'success',
        'form-feedback--error': feedbackType === 'error',
      }"
      role="alert"
      aria-live="polite"
    >
      {{ feedbackMessage }}
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  buttonLabel: {
    type: String,
    default: '送信する',
  },
  busyLabel: {
    type: String,
    default: '送信中…',
  },
  isBusy: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  feedbackMessage: {
    type: String,
    default: '',
  },
  feedbackType: {
    type: String,
    default: '', // 'success', 'error', 'progress'
  },
  buttonId: {
    type: String,
    default: 'submit-button',
  },
  feedbackId: {
    type: String,
    default: 'form-feedback',
  },
});

const computedButtonLabel = computed(() => {
  return props.isBusy ? props.busyLabel : props.buttonLabel;
});
</script>

