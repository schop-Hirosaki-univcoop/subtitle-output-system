<template>
  <section class="module module--primary" aria-labelledby="login-title">
    <div class="module-header">
      <div class="module-heading">
        <h1 id="login-title">イベントコントロールセンターへログイン</h1>
        <p class="module-description">
          イベントや日程の管理、テロップ操作ツールの利用には管理用 Google
          アカウントでのサインインが必要です。
        </p>
      </div>
    </div>
    <div class="module-body">
      <!-- 認証ボタン群: 最低限の文言とエラーハンドリング領域 -->
      <div class="login-panel">
        <p class="login-lead">
          ログインするとイベント管理や参加者リスト、テロップ操作ツールへ進むことができます。
        </p>
        <button
          id="login-button"
          class="btn btn-primary"
          :class="{ 'is-busy': isBusy }"
          type="button"
          :disabled="isBusy"
          :aria-describedby="errorMessage ? 'login-error' : undefined"
          :aria-busy="isBusy"
          :aria-disabled="isBusy"
          @click="handleLoginClick"
        >
          {{ buttonLabel }} <kbd>L</kbd>
        </button>
        <div class="login-status">
          <p class="login-status__title">ログイン処理の進捗</p>
          <ol id="login-status-list" class="login-status__list">
            <li
              v-for="step in statusSteps"
              :key="step.step"
              class="login-status__item"
              :class="{
                'is-active': step.state === 'active',
                'is-complete': step.state === 'complete',
                'is-error': step.state === 'error',
              }"
              :data-step="step.step"
              :data-state="step.state"
            >
              <span class="login-status__icon" aria-hidden="true">{{
                step.icon
              }}</span>
              <span class="login-status__label">{{ step.label }}</span>
            </li>
          </ol>
          <p
            id="login-status-detail"
            class="login-status__detail"
            :class="{ 'is-error': statusDetailIsError }"
            role="status"
            aria-live="polite"
          >
            {{ statusDetail }}
          </p>
        </div>
        <p
          v-if="errorMessage"
          id="login-error"
          class="form-error"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {{ errorMessage }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  auth,
  provider,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "../../scripts/operator/firebase.js";
import {
  storeAuthTransfer,
  clearAuthTransfer,
} from "../../scripts/shared/auth-transfer.js";
import {
  runAuthPreflight,
  AuthPreflightError,
  clearAuthPreflightContext,
} from "../../scripts/shared/auth-preflight.js";
import { goToEvents } from "../../scripts/shared/routes.js";
import {
  appendAuthDebugLog,
  replayAuthDebugLog,
} from "../../scripts/shared/auth-debug-log.js";

const ERROR_MESSAGES = {
  "auth/popup-closed-by-user":
    "ログインウィンドウが閉じられました。もう一度お試しください。",
  "auth/cancelled-popup-request":
    "別のログイン処理が進行中です。完了してから再試行してください。",
  "auth/popup-blocked":
    "ポップアップがブロックされました。ブラウザの設定を確認してから再試行してください。",
};

// ステップ定義
const STATUS_STEPS = [
  { step: "popup", label: "Googleアカウントを確認しています" },
  { step: "preflight-admin", label: "管理者権限を確認しています" },
  { step: "preflight-access", label: "アクセス権限を照合しています" },
  { step: "preflight-data", label: "イベント情報を取得しています" },
  { step: "transfer", label: "資格情報を保存しています" },
  { step: "redirect", label: "イベント管理画面へ移動しています" },
];

// 状態管理
const isBusy = ref(false);
const errorMessage = ref("");
const redirecting = ref(false);
const statusFlowActive = ref(false);
const activeStep = ref(null);
const statusDetail = ref(
  "Googleアカウントでログインを開始すると処理の進捗が表示されます。"
);
const statusDetailIsError = ref(false);
const preflightPromise = ref(null);
const preflightError = ref(null);

// ステップの状態管理
const statusSteps = ref(
  STATUS_STEPS.map((step) => ({
    ...step,
    state: "pending",
    icon: "•",
  }))
);

// ボタンラベル
const defaultLabel = "Googleアカウントでログイン";
const busyLabel = "サインイン中…";
const buttonLabel = computed(() => (isBusy.value ? busyLabel : defaultLabel));

// ステップの状態を更新
const setStepState = (stepKey, state) => {
  const step = statusSteps.value.find((s) => s.step === stepKey);
  if (!step) return;

  step.state = state;
  if (state === "active") {
    step.icon = "…";
    activeStep.value = stepKey;
  } else if (state === "complete") {
    step.icon = "✔";
    if (activeStep.value === stepKey) {
      activeStep.value = null;
    }
  } else if (state === "error") {
    step.icon = "!";
    activeStep.value = null;
  } else {
    step.icon = "•";
    if (activeStep.value === stepKey) {
      activeStep.value = null;
    }
  }
};

// ステップをアクティブにする
const activateStep = (stepKey, detailMessage) => {
  setStepState(stepKey, "active");
  if (detailMessage) {
    setStatusDetail(detailMessage);
  }
};

// ステップを完了にする
const completeStep = (stepKey) => {
  setStepState(stepKey, "complete");
};

// ステータス詳細を更新
const setStatusDetail = (message, { isError = false } = {}) => {
  statusDetail.value =
    message ||
    "Googleアカウントでログインを開始すると処理の進捗が表示されます。";
  statusDetailIsError.value = isError;
};

// ステータスフローをリセット
const resetStatusFlow = () => {
  statusSteps.value.forEach((step) => {
    setStepState(step.step, "pending");
  });
  activeStep.value = null;
  statusFlowActive.value = false;
  statusDetailIsError.value = false;
  statusDetail.value =
    "Googleアカウントでログインを開始すると処理の進捗が表示されます。";
};

// ステータスフローを開始
const startStatusFlow = () => {
  resetStatusFlow();
  statusFlowActive.value = true;
};

// エラーメッセージを表示
const showError = (message = "") => {
  errorMessage.value = message.trim();
};

// ビジー状態を設定
const setBusy = (busy) => {
  isBusy.value = busy;
};

// 視覚的更新の待機
const waitForVisualUpdate = async ({ minimumDelay = 0 } = {}) => {
  await new Promise((resolve) => {
    const raf =
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : null;
    if (raf) {
      raf(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
  if (minimumDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, minimumDelay));
  }
};

// エラーメッセージを取得
const getErrorMessage = (error) => {
  if (error instanceof AuthPreflightError) {
    return error.message || "プリフライト処理に失敗しました。";
  }
  const code = error?.code || "";
  if (code === "auth/network-request-failed") {
    return navigator.onLine
      ? "通信エラーが発生しました。ネットワークを確認して再試行してください。"
      : "ネットワークに接続できません。接続状況を確認してから再試行してください。";
  }
  return (
    ERROR_MESSAGES[code] || "ログインに失敗しました。もう一度お試しください。"
  );
};

// 資格情報を保存
const storeCredential = (credential) => {
  if (credential && (credential.idToken || credential.accessToken)) {
    appendAuthDebugLog("login:store-credential", {
      hasIdToken: Boolean(credential.idToken),
      hasAccessToken: Boolean(credential.accessToken),
    });
    storeAuthTransfer({
      providerId: credential.providerId || GoogleAuthProvider.PROVIDER_ID,
      signInMethod: credential.signInMethod || "",
      idToken: credential.idToken || "",
      accessToken: credential.accessToken || "",
    });
  } else {
    appendAuthDebugLog("login:store-credential:missing-token", null, {
      level: "warn",
    });
    clearAuthTransfer();
  }
};

// プリフライト進捗のハンドラー
const handlePreflightProgress = (progress) => {
  if (!progress || typeof progress !== "object") {
    return;
  }
  const { stage, phase, payload } = progress;
  const stepMap = {
    ensureAdmin: "preflight-admin",
    userSheet: "preflight-access",
    mirror: "preflight-data",
  };
  const stepKey = stage ? stepMap[stage] : null;
  if (!stepKey) {
    return;
  }

  if (phase === "start") {
    const startMessages = {
      ensureAdmin: "管理者権限を確認しています…",
      userSheet: "アクセス権限を照合しています…",
      mirror: "イベント情報を取得しています…",
    };
    const message = startMessages[stage] || null;
    activateStep(stepKey, message);
    return;
  }

  if (stage === "mirror" && phase === "refresh") {
    activateStep(stepKey, "最新のイベント情報を同期しています…");
    setStatusDetail("最新のイベント情報を同期しています…");
    return;
  }

  if (phase === "success") {
    completeStep(stepKey);
    let message = null;
    if (stage === "ensureAdmin") {
      message = "管理者権限を確認しました。アクセス権限を照合しています…";
    } else if (stage === "userSheet") {
      const useFallback = Boolean(payload && payload.fallback);
      if (useFallback) {
        message =
          "アクセス権限の最新情報を取得できなかったため、前回の情報で続行しています。イベント情報を取得しています…";
      } else {
        const totalUsers =
          payload &&
          typeof payload.totalUsers === "number" &&
          Number.isFinite(payload.totalUsers)
            ? payload.totalUsers
            : null;
        if (typeof totalUsers === "number" && totalUsers >= 0) {
          message = `アクセス権限を確認しました（登録ユーザー ${totalUsers} 件）。イベント情報を取得しています…`;
        } else {
          message = "アクセス権限を確認しました。イベント情報を取得しています…";
        }
      }
    } else if (stage === "mirror") {
      const useFallback = Boolean(payload && payload.fallback);
      if (useFallback) {
        message =
          "イベント情報の最新状態を取得できた範囲で続行しています。資格情報を保存しています…";
      } else {
        const questionCount =
          payload &&
          typeof payload.questionCount === "number" &&
          Number.isFinite(payload.questionCount)
            ? payload.questionCount
            : null;
        if (typeof questionCount === "number" && questionCount >= 0) {
          message = `イベント情報を取得しました（質問 ${questionCount} 件）。資格情報を保存しています…`;
        } else {
          message = "イベント情報を取得しました。資格情報を保存しています…";
        }
      }
    }
    if (message) {
      setStatusDetail(message);
    }
    return;
  }

  if (phase === "error") {
    const detail =
      payload && typeof payload.message === "string" ? payload.message : null;
    if (detail) {
      setStatusDetail(detail, { isError: true });
    }
    setStepState(stepKey, "error");
  }
};

// プリフライト失敗のハンドラー
const handlePreflightFailure = async (error) => {
  if (!error) {
    return;
  }
  appendAuthDebugLog(
    "login:preflight:failure",
    {
      code: error.code,
      message: error.message,
    },
    { level: "error" }
  );
  if (
    error.code === "NOT_IN_USER_SHEET" ||
    error.code === "ENSURE_ADMIN_FAILED"
  ) {
    try {
      await signOut(auth);
    } catch (signOutError) {
      console.warn("Failed to sign out after preflight error", signOutError);
      appendAuthDebugLog(
        "login:preflight:signout-error",
        { message: signOutError?.message || null },
        { level: "warn" }
      );
    }
  }
};

// フローエラーをマーク
const markFlowError = (error, message) => {
  let fallbackStep = null;
  for (const step of statusSteps.value) {
    if (step.state !== "complete") {
      fallbackStep = step.step;
      break;
    }
  }
  const targetStep =
    activeStep.value ||
    fallbackStep ||
    statusSteps.value[statusSteps.value.length - 1]?.step ||
    null;
  if (targetStep) {
    setStepState(targetStep, "error");
  }
  const detail = typeof message === "string" ? message : getErrorMessage(error);
  setStatusDetail(detail, { isError: true });
  statusFlowActive.value = false;
};

// ログイン処理
const performLogin = async () => {
  setBusy(true);
  showError("");
  preflightError.value = null;
  startStatusFlow();
  appendAuthDebugLog("login:perform-login:start");

  const loginFlow = (async () => {
    activateStep("popup", "Googleアカウントの認証を開始しています…");
    const result = await signInWithPopup(auth, provider);
    appendAuthDebugLog("login:popup-success", {
      uid: result?.user?.uid || null,
      email: result?.user?.email || null,
      providerId: result?.providerId || null,
    });
    completeStep("popup");
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const context = await runAuthPreflight({
      auth,
      credential,
      onProgress: handlePreflightProgress,
    });
    appendAuthDebugLog("login:preflight:success", {
      adminSheetHash: context?.admin?.sheetHash || null,
      questionCount: context?.mirror?.questionCount ?? null,
    });
    activateStep("transfer", "資格情報を保存しています…");
    await waitForVisualUpdate({ minimumDelay: 120 });
    storeCredential(credential);
    completeStep("transfer");
    await waitForVisualUpdate({ minimumDelay: 160 });
    setStatusDetail(
      "ログイン情報を保存しました。アカウント状態を確認しています…"
    );
    return context;
  })();

  preflightPromise.value = loginFlow;

  try {
    await loginFlow;
    appendAuthDebugLog("login:perform-login:completed");
  } catch (error) {
    console.error("Login failed:", error);
    appendAuthDebugLog(
      "login:perform-login:error",
      {
        code: error?.code || null,
        message: error?.message || null,
      },
      { level: "error" }
    );
    preflightError.value = error;
    clearAuthTransfer();
    clearAuthPreflightContext();
    if (error instanceof AuthPreflightError) {
      await handlePreflightFailure(error);
    }
    const message = getErrorMessage(error);
    markFlowError(error, message);
    showError(message);
  } finally {
    preflightPromise.value = null;
    setBusy(false);
  }
};

// ログインボタンのクリックハンドラー
const handleLoginClick = () => {
  if (isBusy.value) {
    appendAuthDebugLog(
      "login:click-ignored",
      { reason: "button-disabled" },
      { level: "warn" }
    );
    return;
  }

  appendAuthDebugLog("login:click");
  performLogin();
};

// 認証状態変更のハンドラー
const handleAuthStateChanged = async (user) => {
  appendAuthDebugLog("login:handle-auth-state", {
    uid: user?.uid || null,
  });
  if (!user) {
    redirecting.value = false;
    clearAuthTransfer();
    clearAuthPreflightContext();
    preflightError.value = null;
    appendAuthDebugLog("login:handle-auth-state:cleared");
    return;
  }

  if (redirecting.value) {
    appendAuthDebugLog("login:handle-auth-state:already-redirecting");
    return;
  }

  if (preflightPromise.value) {
    try {
      await preflightPromise.value;
    } catch (error) {
      appendAuthDebugLog(
        "login:handle-auth-state:preflight-error",
        { message: error?.message || null },
        { level: "error" }
      );
      return;
    }
  }

  if (preflightError.value) {
    appendAuthDebugLog(
      "login:handle-auth-state:preflight-error-pending",
      { message: preflightError.value?.message || null },
      { level: "error" }
    );
    return;
  }

  if (redirecting.value) {
    return;
  }

  redirecting.value = true;
  appendAuthDebugLog("login:redirect-to-events", {
    uid: user?.uid || null,
  });
  if (statusFlowActive.value) {
    activateStep("redirect", "イベント管理画面へ移動しています…");
    await waitForVisualUpdate({ minimumDelay: 200 });
    completeStep("redirect");
    await waitForVisualUpdate({ minimumDelay: 140 });
    statusFlowActive.value = false;
  }
  goToEvents();
};

// 認証状態の監視
let unsubscribeAuth = null;

onMounted(() => {
  replayAuthDebugLog({
    label: "[auth-debug] existing log (login)",
    clear: false,
  });
  appendAuthDebugLog("login:init", {
    hasCurrentUser: Boolean(auth?.currentUser),
  });

  // キーボードショートカット「l」でログイン
  const handleKeydown = (event) => {
    const target = event.target;
    const isFormField =
      target instanceof HTMLElement &&
      target.closest(
        "input, textarea, select, [role='textbox'], [contenteditable=''], [contenteditable='true']"
      );

    // 入力フィールドにフォーカスがある場合は無視
    if (
      !isFormField &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      if (event.key === "l" || event.key === "L") {
        if (!isBusy.value) {
          event.preventDefault();
          handleLoginClick();
        }
      }
    }
  };

  document.addEventListener("keydown", handleKeydown);

  // 認証状態の監視
  appendAuthDebugLog("login:observe-auth-state");
  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    appendAuthDebugLog("login:on-auth-state", {
      uid: user?.uid || null,
      email: user?.email || null,
    });
    handleAuthStateChanged(user);
  });

  appendAuthDebugLog("login:button-bound");
});

onUnmounted(() => {
  if (unsubscribeAuth) {
    unsubscribeAuth();
  }
});
</script>
