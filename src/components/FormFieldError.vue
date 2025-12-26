<!-- FormFieldError.vue: フォームフィールドのエラー表示コンポーネント -->
<template>
  <div v-if="error" :id="id || undefined" class="form-error" role="alert">
    {{ error }}
  </div>
</template>

<script setup>
defineProps({
  error: {
    type: String,
    default: '',
  },
  id: {
    type: String,
    default: '',
  },
});
</script>

