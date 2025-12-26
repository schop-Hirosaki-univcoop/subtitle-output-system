<!-- IntakeFormLayout.vue: フォームの外側のモジュール構造を共通化 -->
<template>
  <section class="module module--primary intake-module" :aria-labelledby="titleId">
    <div class="module-header">
      <div class="module-heading">
        <h1 :id="titleId">{{ title }}</h1>
        <p class="module-description" :id="descriptionId">{{ description }}</p>
      </div>
    </div>
    <div class="module-body">
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  titleId: {
    type: String,
    required: true,
  },
  descriptionId: {
    type: String,
    default: '',
  },
});
</script>

