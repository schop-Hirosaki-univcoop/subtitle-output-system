<!-- ContextBanner.vue: フォームのコンテキストバナー表示コンポーネント -->
<template>
  <div v-if="visible" :id="id" class="context-banner">
    <slot />
  </div>
</template>

<script setup>
defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  id: {
    type: String,
    default: 'context-banner',
  },
});
</script>

