<!-- FormMeta.vue: フォームのメタ情報表示コンポーネント -->
<template>
  <div v-if="visible" class="form-meta" :id="id">
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
    default: 'form-meta',
  },
});
</script>

