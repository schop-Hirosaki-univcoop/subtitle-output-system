<template>
  <article
    ref="cardElement"
    :class="[
      'q-card',
      { 'is-answered': isAnswered },
      { 'is-selecting': isSelecting },
      { 'is-puq': isPickup },
      { 'is-selected': isSelected },
      { 'is-live': isLive, 'now-displaying': isLive },
      { 'is-loading': isLoading },
    ]"
    :data-uid="question.UID"
    @click="handleClick"
  >
    <span class="status-text visually-hidden">{{ statusText }}</span>
    <div class="q-corner">
      <span
        v-if="groupLabel"
        class="q-group"
        role="text"
        :aria-label="'班番号 ' + groupLabel"
      >
        {{ groupLabel }}
      </span>
      <label class="q-check" :aria-label="statusText + 'の質問をバッチ選択'">
        <input type="checkbox" class="row-checkbox" :data-uid="question.UID" />
        <span class="visually-hidden">選択</span>
      </label>
    </div>
    <header class="q-head">
      <div class="q-title">
        <span class="q-name">{{ displayName }}</span>
        <span
          v-if="showGenre && viewingAllGenres"
          class="q-genre"
          :aria-label="'ジャンル ' + genreLabel"
        >
          {{ genreLabel }}
        </span>
      </div>
    </header>
    <div class="q-text">{{ questionText }}</div>
    <div v-if="isLoading" class="q-loading-spinner" aria-label="更新中"></div>
  </article>
</template>

<script setup>
import { computed, ref, watch, onMounted } from "vue";
// 既存のユーティリティ関数をインポート
import {
  formatOperatorName,
  resolveGenreLabel,
} from "../../scripts/operator/utils.js";

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  isSelected: {
    type: Boolean,
    default: false,
  },
  isLive: {
    type: Boolean,
    default: false,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  shouldFlash: {
    type: Boolean,
    default: false,
  },
  showGenre: {
    type: Boolean,
    default: true,
  },
  viewingAllGenres: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["click"]);
const cardElement = ref(null);

const isAnswered = computed(() => !!props.question["回答済"]);
const isSelecting = computed(() => !!props.question["選択中"]);

const statusText = computed(() => {
  if (isSelecting.value) return "送出準備中";
  if (isAnswered.value) return "送出済";
  return "未送出";
});

const displayName = computed(() => {
  const rawName = props.question["ラジオネーム"];
  // 既存のformatOperatorName関数を使用（空文字列の場合は"—"を表示）
  return formatOperatorName(rawName) || "—";
});

const genreLabel = computed(() => {
  const rawGenre = String(props.question["ジャンル"] ?? "").trim() || "その他";
  // 既存のresolveGenreLabel関数を使用
  return resolveGenreLabel(rawGenre);
});

const questionText = computed(() => {
  return String(props.question["質問・お悩み"] ?? "").trim();
});

const groupLabel = computed(() => {
  return String(props.question["班番号"] ?? "").trim();
});

const isPickup = computed(() => {
  if (props.question["ピックアップ"] === true) return true;
  const radioName = String(props.question["ラジオネーム"] ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return radioName === "pick up question";
});

const handleClick = (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest(".q-check")) return;
  emit("click", props.question);
};

// flashアニメーションの処理
watch(
  () => props.shouldFlash,
  (newValue, oldValue) => {
    if (newValue && !oldValue && cardElement.value) {
      // flashクラスを追加
      cardElement.value.classList.add("flash");
      // animationendイベントでflashクラスを削除
      const handleAnimationEnd = () => {
        if (cardElement.value) {
          cardElement.value.classList.remove("flash");
        }
      };
      cardElement.value.addEventListener("animationend", handleAnimationEnd, {
        once: true,
      });
    }
  }
);

// チェックボックスの変更は既存のイベントデリゲーション（cardsContainerのchangeイベント）で処理される
// そのため、Vueのハンドラは不要
</script>
