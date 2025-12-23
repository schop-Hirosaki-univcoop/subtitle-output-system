<template>
  <QuestionCard
    v-for="question in filteredQuestions"
    :key="question.UID"
    :question="question"
    :is-selected="selectedUid === String(question.UID)"
    :is-live="liveQuestionMap.get(String(question.UID)) || false"
    :is-loading="isLoadingQuestion(question.UID)"
    :should-flash="lastDisplayedUid === question.UID"
    :show-genre="viewingAllGenres"
    :viewing-all-genres="viewingAllGenres"
    @click="handleCardClick"
  />
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import QuestionCard from "./QuestionCard.vue";
import { useOperatorApp } from "../composables/useOperatorApp.js";
import { resolveNormalScheduleKey, loadingUids as moduleLoadingUids, loadingUidStates as moduleLoadingUidStates } from "../../scripts/operator/questions.js";
import { normalizeScheduleId } from "../../scripts/shared/channel-paths.js";
import { GENRE_ALL_VALUE } from "../../scripts/operator/constants.js";

const { app } = useOperatorApp();

const questions = ref([]);
const selectedUid = ref(null);
const liveUid = ref(null);
const liveParticipantId = ref("");
const liveQuestion = ref("");
const liveName = ref("");
const lastDisplayedUid = ref(null);
// Vueコンポーネント内で独自に管理（Vueへの移行のため）
const loadingUids = ref(new Set());
const loadingUidStates = ref(new Map());
const liveQuestionMap = ref(new Map());

// フィルタリング用の状態
const currentTab = ref("all");
const selectedGenre = ref("");
const selectedSchedule = ref("");

// 定期的な更新のためのinterval
let updateInterval = null;
let loadingUidsCheckInterval = null;

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
    !selectedGenre.value ||
    selectedGenre.value.toLowerCase() === GENRE_ALL_VALUE;

  let filtered = questions.value.filter((item) => {
    const isPuq = isPickUpQuestion(item);
    if (viewingPuqTab && !isPuq) return false;
    if (viewingNormalTab && isPuq) return false;
    const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
    if (!viewingAllGenres && itemGenre !== selectedGenre.value) return false;
    const itemSchedule = String(
      item.__scheduleKey ?? item["日程"] ?? ""
    ).trim();
    if (
      !isPuq &&
      selectedSchedule.value &&
      itemSchedule !== selectedSchedule.value
    )
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

// ライブ質問の判定を更新する関数
function updateLiveQuestionMap() {
  const map = new Map();
  const currentLiveUid = liveUid.value;
  const currentLiveParticipantId = liveParticipantId.value;
  const currentLiveQuestion = liveQuestion.value;
  const currentLiveName = liveName.value;

  filteredQuestions.value.forEach((question) => {
    const uid = String(question.UID || "");
    const participantId = String(question["参加者ID"] ?? "").trim();
    const questionText = String(question["質問・お悩み"] ?? "").trim();
    const radioName = String(question["ラジオネーム"] ?? "").trim();

    let isLive = false;

    // liveUidが存在する場合は、それで判定
    if (currentLiveUid && currentLiveUid.trim()) {
      isLive = currentLiveUid === uid;
    } else {
      // liveUidが存在しない場合は、participantId/questionまたはname/questionで判定
      if (currentLiveParticipantId && participantId && currentLiveQuestion) {
        if (
          currentLiveParticipantId === participantId &&
          currentLiveQuestion === questionText
        ) {
          isLive = true;
        }
      }

      if (!isLive && currentLiveName && radioName && currentLiveQuestion) {
        if (
          currentLiveName === radioName &&
          currentLiveQuestion === questionText
        ) {
          isLive = true;
        }
      }
    }

    map.set(uid, isLive);
  });

  liveQuestionMap.value = map;
}

const viewingAllGenres = computed(() => {
  return (
    !selectedGenre.value ||
    selectedGenre.value.toLowerCase() === GENRE_ALL_VALUE
  );
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

  // ライブ表示中の情報を更新
  const live =
    app.value.state.renderState?.nowShowing ||
    app.value.state.displaySession?.nowShowing ||
    null;
  liveUid.value =
    live && typeof live.uid !== "undefined" ? String(live.uid || "") : "";
  liveParticipantId.value = String(live?.participantId || "").trim();
  liveQuestion.value = live?.question ?? "";
  liveName.value = live?.name ?? "";

  // lastDisplayedUidを更新
  lastDisplayedUid.value = app.value.state.lastDisplayedUid || null;

  // フィルタリング用の状態を更新
  currentTab.value = app.value.state.currentSubTab || "all";
  selectedGenre.value =
    typeof app.value.state.currentGenre === "string"
      ? app.value.state.currentGenre.trim()
      : "";

  // 日程の解決（既存実装に合わせる）
  let resolvedSchedule = resolveNormalScheduleKey(app.value);
  const displaySession = app.value?.state?.displaySession || {};
  const assignment =
    displaySession && typeof displaySession === "object"
      ? displaySession.assignment
      : null;
  const displayEventId = String(
    displaySession?.eventId || assignment?.eventId || ""
  ).trim();
  const displayScheduleId = normalizeScheduleId(
    displaySession?.scheduleId || assignment?.scheduleId || ""
  );
  const derivedDisplayKey =
    displayEventId && displayScheduleId
      ? `${displayEventId}::${displayScheduleId}`
      : "";
  const displayScheduleKey = String(
    assignment?.scheduleKey || derivedDisplayKey || ""
  ).trim();
  // テロップ操作パネルの日程情報を優先的に使用
  if (displayScheduleKey) {
    resolvedSchedule = displayScheduleKey;
  }
  selectedSchedule.value = resolvedSchedule;

  // ライブ質問の判定を更新
  updateLiveQuestionMap();

  // 既存のJavaScriptコードが使用しているモジュールレベルのloadingUidsとloadingUidStatesを同期
  // 既存のコード（handleUnanswerなど）が変更した場合に、Vueコンポーネントの状態を更新
  const moduleUids = Array.from(moduleLoadingUids);
  const moduleStates = new Map(moduleLoadingUidStates);
  
  // VueコンポーネントのloadingUidsを更新
  loadingUids.value = new Set(moduleUids);
  loadingUidStates.value = new Map(moduleStates);
  
  // ローディング中のUIDについて、更新が反映されたか確認
  // （Firebaseリスナーが新しいデータを拾った時にローディング状態を解除）
  // 注意: filteredQuestions.valueを参照すると無限ループになるため、直接questions.valueを使用
  let loadingUidsChanged = false;
  loadingUids.value.forEach((uid) => {
    const question = questions.value.find((q) => String(q.UID) === uid);
    const loadingState = loadingUidStates.value.get(uid);
    if (question && loadingState) {
      // 更新が反映されたか確認
      // 未回答に戻す場合は、previousAnsweredがtrueで、現在answeredがfalseになっていることを確認
      if (
        loadingState.expectedAnswered === false &&
        loadingState.previousAnswered === true &&
        !question["回答済"]
      ) {
        // 更新が反映された
        loadingUids.value.delete(uid);
        loadingUidStates.value.delete(uid);
        // モジュールレベルの変数も更新（既存のコードとの同期のため）
        moduleLoadingUids.delete(uid);
        moduleLoadingUidStates.delete(uid);
        loadingUidsChanged = true;
      }
    }
  });

  // loadingUidsが変更された場合、リアクティビティをトリガー
  if (loadingUidsChanged) {
    loadingUidsVersion.value++;
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

// チェックボックスの変更は既存のイベントデリゲーション（cardsContainerのchangeイベント）で処理される

onMounted(() => {
  // 初期データを取得
  updateQuestions();

  // 定期的に更新（500msごと）
  // 注意: 本番環境では、Firebaseリスナーやイベントベースの更新に変更することを推奨
  updateInterval = setInterval(() => {
    updateQuestions();
  }, 500);

  // loadingUidsの変更を監視（100msごと）
  // 既存のJavaScriptコードがモジュールレベルのloadingUidsを変更した場合に検知するため
  let previousModuleLoadingUidsSize = moduleLoadingUids.size;
  loadingUidsCheckInterval = setInterval(() => {
    const currentSize = moduleLoadingUids.size;
    if (currentSize !== previousModuleLoadingUidsSize) {
      // モジュールレベルの変更を検知したら、Vueコンポーネントの状態を更新
      loadingUids.value = new Set(moduleLoadingUids);
      loadingUidStates.value = new Map(moduleLoadingUidStates);
      loadingUidsVersion.value++;
      previousModuleLoadingUidsSize = currentSize;
    }
  }, 100);

  console.log("[Vue] QuestionList コンポーネントがマウントされました");
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  if (loadingUidsCheckInterval) {
    clearInterval(loadingUidsCheckInterval);
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

// app.value.stateの変更を監視（allQuestions、renderState、displaySessionなど）
// 注意: selectedRowDataの変更は監視しない（無限ループを防ぐため）
watch(
  () => [
    app.value?.state?.allQuestions,
    app.value?.state?.renderState?.nowShowing,
    app.value?.state?.displaySession?.nowShowing,
    app.value?.state?.currentSubTab,
    app.value?.state?.currentGenre,
    app.value?.state?.displaySession,
    app.value?.state?.lastDisplayedUid,
  ],
  () => {
    if (app.value?.state) {
      updateQuestions();
    }
  },
  { deep: true, immediate: true }
);

// liveUid, liveParticipantId, liveQuestion, liveNameの変更を監視してliveQuestionMapを更新
watch(
  () => [
    liveUid.value,
    liveParticipantId.value,
    liveQuestion.value,
    liveName.value,
    filteredQuestions.value,
  ],
  () => {
    updateLiveQuestionMap();
  },
  { immediate: true }
);

// 既存のrenderQuestionsが呼ばれた時にも更新されるように、cardsContainerの変更を監視
watch(
  () => app.value?.dom?.cardsContainer,
  (newContainer) => {
    if (newContainer) {
      // cardsContainerが設定されたら、初期データを取得
      updateQuestions();
    }
  },
  { immediate: true }
);

// 選択状態の管理（既存実装に合わせる）
// 選択中の質問がフィルタリングされたリストに存在しない場合、selectedRowDataをnullに設定
watch(
  () => [filteredQuestions.value, selectedUid.value],
  () => {
    if (!app.value || !app.value.state) return;

    const currentSelectedUid = selectedUid.value;
    if (currentSelectedUid) {
      const questionInList = filteredQuestions.value.find(
        (item) => String(item.UID) === currentSelectedUid
      );
      if (!questionInList) {
        // 選択中の質問がリストに存在しない場合は、selectedRowDataをnullに設定
        app.value.state.selectedRowData = null;
        if (typeof app.value.updateActionAvailability === "function") {
          app.value.updateActionAvailability(app.value);
        }
      }
    }
  },
  { immediate: false }
);

// syncSelectAllStateとupdateBatchButtonVisibilityを呼び出す
watch(
  () => filteredQuestions.value,
  () => {
    nextTick(() => {
      if (app.value) {
        if (typeof app.value.syncSelectAllState === "function") {
          app.value.syncSelectAllState(app.value);
        }
        if (typeof app.value.updateBatchButtonVisibility === "function") {
          app.value.updateBatchButtonVisibility(app.value);
        }
      }
    });
  },
  { immediate: false }
);
</script>
