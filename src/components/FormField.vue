<!-- FormField.vue: フォームフィールドのラッパーコンポーネント -->
<template>
  <div class="form-field" :class="fieldClass" :id="id" v-bind="dataAttributes">
    <div class="field-header">
      <label :for="fieldId">{{ label }}</label>
      <span v-if="required" class="field-tag field-tag--required">必須</span>
      <span v-else-if="optional" class="field-tag">任意</span>
    </div>
    <slot />
    <div v-if="hint" class="field-footer">
      <p class="field-hint">{{ hint }}</p>
    </div>
    <FormFieldError v-if="error" :error="error" :id="errorId" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import FormFieldError from './FormFieldError.vue';

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  fieldId: {
    type: String,
    required: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  optional: {
    type: Boolean,
    default: false,
  },
  hint: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
  errorId: {
    type: String,
    default: '',
  },
  fieldClass: {
    type: String,
    default: '',
  },
  dataDepth: {
    type: [String, Number],
    default: null,
  },
  id: {
    type: String,
    default: '',
  },
});

const dataAttributes = computed(() => {
  const attrs = {};
  if (props.dataDepth !== null) {
    attrs['data-depth'] = String(props.dataDepth);
  }
  return attrs;
});
</script>

