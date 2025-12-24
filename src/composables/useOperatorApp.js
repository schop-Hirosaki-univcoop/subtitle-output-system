// useOperatorApp.js: OperatorAppインスタンスにアクセスするcomposable
import { ref, onMounted } from "vue";

/**
 * OperatorAppインスタンスにアクセスするcomposable
 * @returns {{ app: import('vue').Ref<import('../../scripts/operator/app.js').OperatorApp | null> }}
 */
export function useOperatorApp() {
  const app = ref(null);

  onMounted(() => {
    if (typeof window !== "undefined" && window.operatorEmbed?.app) {
      app.value = window.operatorEmbed.app;
    } else {
      console.warn("[Vue] OperatorApp が見つかりません");
    }
  });

  return { app };
}

