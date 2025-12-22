<template>
  <div class="cards-list">
    <QuestionCard
      v-for="question in filteredQuestions"
      :key="question.UID"
      :question="question"
      :is-selected="selectedUid === String(question.UID)"
      :is-live="liveUid === String(question.UID)"
      :is-loading="loadingUids.has(String(question.UID))"
      :show-genre="viewingAllGenres"
      :viewing-all-genres="viewingAllGenres"
      @click="handleCardClick"
      @checkbox-change="handleCheckboxChange"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import QuestionCard from "./QuestionCard.vue";
import { useOperatorApp } from "../composables/useOperatorApp.js";

const { app } = useOperatorApp();

const questions = ref([]);
const selectedUid = ref(null);
const liveUid = ref(null);
const loadingUids = ref(new Set());

// フィルタリング用の状態
const currentTab = ref("all");
const selectedGenre = ref("");
const selectedSchedule = ref("");

// 定期的な更新のためのinterval
let updateInterval = null;

// 既存のisPickUpQuestion関数の実装
function isPickUpQuestion(record) {
  if (!record || typeof record !== "object") return false;
  if (record["ピックアップ"] === true) return true;
  const radioName = String(record["ラジオネーム"] ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return radioName === "pick up question";
}

// フィルタリングされた質問リスト
const filteredQuestions = computed(() => {
  if (!app.value || !app.value.state) return [];

  const viewingPuqTab = currentTab.value === "puq";
  const viewingNormalTab = currentTab.value === "normal";
  const viewingAllGenres =
    !selectedGenre.value || selectedGenre.value.toLowerCase() === "すべて";

  let filtered = questions.value.filter((item) => {
    const isPuq = isPickUpQuestion(item);
    if (viewingPuqTab && !isPuq) return false;
    if (viewingNormalTab && isPuq) return false;
    const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
    if (!viewingAllGenres && itemGenre !== selectedGenre.value) return false;
    const itemSchedule = String(item.__scheduleKey ?? item["日程"] ?? "").trim();
    if (!isPuq && selectedSchedule.value && itemSchedule !== selectedSchedule.value)
      return false;
    return true;
  });

  // ソート
  filtered = [...filtered].sort((a, b) => {
    const aTs = Number(a.__ts || 0);
    const bTs = Number(b.__ts || 0);
    return bTs - aTs;
  });

  return filtered;
});

const viewingAllGenres = computed(() => {
  return !selectedGenre.value || selectedGenre.value.toLowerCase() === "すべて";
});

// 質問データを更新
function updateQuestions() {
  if (!app.value || !app.value.state) return;

  const allQuestions = Array.isArray(app.value.state.allQuestions)
    ? app.value.state.allQuestions
    : [];

  questions.value = allQuestions;

  // 選択中のUIDを更新
  if (app.value.state.selectedRowData) {
    selectedUid.value = String(app.value.state.selectedRowData.uid || "");
  } else {
    selectedUid.value = null;
  }

  // ライブ表示中のUIDを更新
  const live =
    app.value.state.renderState?.nowShowing ||
    app.value.state.displaySession?.nowShowing ||
    null;
  liveUid.value = live && typeof live.uid !== "undefined" ? String(live.uid || "") : "";

  // フィルタリング用の状態を更新
  currentTab.value = app.value.state.currentSubTab || "all";
  selectedGenre.value =
    typeof app.value.state.currentGenre === "string"
      ? app.value.state.currentGenre.trim()
      : "";

  // 日程の解決（簡易実装）
  const displaySession = app.value?.state?.displaySession || {};
  const assignment =
    displaySession && typeof displaySession === "object" ? displaySession.assignment : null;
  const displayEventId = String(
    displaySession?.eventId || assignment?.eventId || ""
  ).trim();
  const displayScheduleId = String(
    displaySession?.scheduleId || assignment?.scheduleId || ""
  ).trim();
  if (displayEventId && displayScheduleId) {
    selectedSchedule.value = `${displayEventId}::${displayScheduleId}`;
  } else {
    selectedSchedule.value = "";
  }
}

// カードクリックハンドラ
function handleCardClick(question) {
  if (!app.value) return;

  const uid = String(question.UID);
  const isAnswered = !!question["回答済"];
  const participantId = String(question["参加者ID"] ?? "").trim();
  const rawGenre = String(question["ジャンル"] ?? "").trim() || "その他";
  const isPickup = isPickUpQuestion(question);

  // 既存の選択ロジックを呼び出す
  if (app.value.dom.cardsContainer) {
    app.value.dom.cardsContainer
      .querySelectorAll(".q-card")
      .forEach((el) => el.classList.remove("is-selected"));
  }

  app.value.state.selectedRowData = {
    uid,
    name: question["ラジオネーム"],
    question: question["質問・お悩み"],
    isAnswered,
    participantId,
    genre: rawGenre,
    isPickup,
  };

  // 既存のupdateActionAvailabilityを呼び出す
  if (typeof app.value.updateActionAvailability === "function") {
    app.value.updateActionAvailability(app.value);
  }
}

// チェックボックス変更ハンドラ
function handleCheckboxChange(question, checked) {
  // 既存のロジックに委譲（必要に応じて実装）
  console.log("Checkbox changed", question.UID, checked);
}

onMounted(() => {
  // 初期データを取得
  updateQuestions();

  // 定期的に更新（500msごと）
  // 注意: 本番環境では、Firebaseリスナーやイベントベースの更新に変更することを推奨
  updateInterval = setInterval(() => {
    updateQuestions();
  }, 500);

  console.log("[Vue] QuestionList コンポーネントがマウントされました");
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});

// app.valueの変更を監視
watch(
  () => app.value,
  (newApp) => {
    if (newApp) {
      updateQuestions();
    }
  },
  { immediate: true }
);
</script>

