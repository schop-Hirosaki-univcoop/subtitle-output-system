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
        <input
          type="checkbox"
          class="row-checkbox"
          :data-uid="question.UID"
          ref="checkboxElement"
        />
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
import { computed, ref, onMounted, onUpdated, nextTick } from "vue";
// 既存のユーティリティ関数をインポート
import {
  formatOperatorName,
  resolveGenreLabel,
} from "../../scripts/operator/utils.js";
import { useOperatorApp } from "../composables/useOperatorApp.js";

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
const checkboxElement = ref(null);
const { app } = useOperatorApp();

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
// ただし、コンポーネントが再レンダリングされてもチェックボックスの状態を保持する必要がある

// チェックボックスの状態を復元する関数
// 既存のDOMに同じUIDのチェックボックスが存在する場合、その状態を復元
// handleSelectAllなどで既存のJavaScriptコードがチェックボックスの状態を変更した場合にも対応
function restoreCheckboxState() {
  if (!checkboxElement.value || !app.value?.dom?.cardsContainer) return;

  const uid = String(props.question.UID);

  // 既存のDOMに同じUIDのチェックボックスが存在する場合、その状態を復元
  // 複数のチェックボックスが存在する可能性があるため、すべて確認
  const allCheckboxes = app.value.dom.cardsContainer.querySelectorAll(
    `.row-checkbox[data-uid="${uid}"]`
  );

  // 既存のチェックボックスでcheckedになっているものがあれば、新しいチェックボックスもcheckedにする
  let shouldBeChecked = false;
  for (const checkbox of allCheckboxes) {
    if (checkbox instanceof HTMLInputElement) {
      if (checkbox === checkboxElement.value) {
        // 現在のチェックボックスの状態を保持（既存の状態を優先）
        shouldBeChecked = checkbox.checked;
      } else if (checkbox.checked) {
        // 他のチェックボックスがcheckedの場合、現在のチェックボックスもcheckedにする
        shouldBeChecked = true;
        break;
      }
    }
  }

  // 状態を更新（既存の状態と異なる場合のみ）
  // 注意: 既存のJavaScriptコード（handleSelectAllなど）がチェックボックスの状態を変更した場合、
  // この関数が呼ばれた時点で既にDOMの状態が更新されているため、その状態を反映する
  if (checkboxElement.value.checked !== shouldBeChecked) {
    checkboxElement.value.checked = shouldBeChecked;
  }
}

// 注意: チェックボックスの変更は既存のイベント委譲（cardsContainerのchangeイベント）で処理される
// handleSelectAllやhandleBatchUnanswerなど、既存のJavaScriptコードがチェックボックスの状態を変更する場合、
// onUpdatedで状態を復元することで対応する

onMounted(() => {
  nextTick(() => {
    restoreCheckboxState();
  });
});

onUpdated(() => {
  // コンポーネントが更新された時も、チェックボックスの状態を復元
  // これは、Vueコンポーネントが再レンダリングされた際に、既存のDOMの状態を確認して復元するため
  nextTick(() => {
    restoreCheckboxState();
  });
});
</script>
