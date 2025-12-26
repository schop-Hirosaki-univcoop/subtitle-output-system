<!-- ContextGuard.vue: フォームのコンテキストガード表示コンポーネント -->
<template>
  <div
    v-if="message"
    :id="id"
    class="context-guard"
    role="alert"
    aria-live="assertive"
    tabindex="-1"
  >
    {{ message }}
  </div>
</template>

<script setup>
defineProps({
  message: {
    type: String,
    default: '',
  },
  id: {
    type: String,
    default: 'context-guard',
  },
});
</script>

