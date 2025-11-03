import {
  glIntakeFacultyCatalogRef,
  onValue,
  set,
  serverTimestamp
} from "../../operator/firebase.js";
import { ensureString, formatDateTimeLocal, logError } from "../helpers.js";
import { GlFacultyBuilder } from "./gl-faculty-builder.js";
import { normalizeFacultyList } from "./gl-faculty-utils.js";

function createSignature(list) {
  try {
    return JSON.stringify(list);
  } catch (error) {
    return "";
  }
}

export class GlFacultyAdminManager {
  constructor(app) {
    // ▼▼▼ ログ追加 ▼▼▼
    console.log("[FacultyAdmin] constructor: 初期化が開始されました。");
    this.app = app;
    this.dom = app.dom;
    // ▼▼▼ ログ追加 ▼▼▼
    console.log("[FacultyAdmin] constructor: GlFacultyBuilder を作成します。");
    this.builder = new GlFacultyBuilder(this.dom);
    this.catalogUnsubscribe = null;
    this.originalFaculties = [];
    this.originalSignature = "";
    this.catalogMeta = { updatedAt: 0, updatedByUid: "", updatedByName: "" };
    this.saving = false;
    this.builderObserver = null;
    this.bindDom();
    this.observeBuilder();
    this.showLoading(true);
    // ▼▼▼ ログ追加 ▼▼▼
    console.log("[FacultyAdmin] constructor: showLoading(true) を実行しました。");
//    this.attachListeners();
    // ▼▼▼ 修正: selectionListener (間違い) を削除し、onAuthStateChanged (正しい) に変更 ▼▼▼
    console.log("[FacultyAdmin] constructor: onAuthStateChanged リスナーを登録します。");
    this.app.auth.onAuthStateChanged((user) => {
      console.log(`[FacultyAdmin] onAuthStateChanged: 状態が変化しました。 User: ${user?.uid}`);
      // ユーザーがログインしており、かつリスナーがまだ登録されていない場合のみ実行
      if (user && !this.catalogUnsubscribe) {
        console.log("[FacultyAdmin] onAuthStateChanged: ユーザーがおり、リスナーは未登録です。attachListeners() を呼び出します。");
        this.attachListeners();
      }
    });
    // ▼▼▼ ログ追加 ▼▼▼
//    console.log("[FacultyAdmin] constructor: selectionListener を登録しました。");  //削除
  }

  attachListeners() {
    // ▼▼▼ ログ ▼▼▼
    console.log("[FacultyAdmin] attachListeners: メソッドが呼び出されました。");
    if (this.catalogUnsubscribe) {
      console.warn("[FacultyAdmin] attachListeners: 既にリスナーが登録済みのため、処理を中断します。");
      return; 
    }
    console.log("[FacultyAdmin] attachListeners: onValue リスナーを glIntakeFacultyCatalogRef に登録します...");
    // ▲▲▲ ログ ▲▲▲

    this.catalogUnsubscribe = onValue(
      glIntakeFacultyCatalogRef,
      (snapshot) => {
        // ▼▼▼ ログ ▼▼▼
        console.log("[FacultyAdmin] onValue (Success): データを受信しました。applyCatalog を呼び出します。", snapshot.val());
        // ▲▲▲ ログ ▼▼▲
        const value = snapshot.val() || {};
        this.applyCatalog(value);
      },
      (error) => {
        // ▼▼▼ ログ（エラーハンドラ追加） ▼▼▼
        console.error("[FacultyAdmin] onValue (Error): データ受信に失敗しました。", error);
        logError("Failed to fetch faculty catalog", error);
        this.setStatus("共通設定の読み込みに失敗しました。", "error");
        this.showLoading(false);
        // ▲▲▲ ログ（エラーハンドラ追加） ▲▲▲
      }
    );
  }

  bindDom() {
    if (this.dom.glFacultyAdminSaveButton) {
      this.dom.glFacultyAdminSaveButton.addEventListener("click", () => {
        if (this.saving) {
          return;
        }
        this.handleSave().catch((error) => {
          logError("Failed to save faculty catalog", error);
          this.setStatus("共通設定の保存に失敗しました。", "error");
          this.saving = false;
          this.updateSavingState();
        });
      });
    }
    if (this.dom.glFacultyAdminResetButton) {
      this.dom.glFacultyAdminResetButton.addEventListener("click", () => {
        this.handleReset();
      });
    }
  }

  observeBuilder() {
    if (this.builderObserver) {
      this.builderObserver.disconnect();
      this.builderObserver = null;
    }
    const list = this.dom.glFacultyList;
    if (!list) {
      return;
    }
    this.builderObserver = new MutationObserver(() => {
      this.updateSavingState();
    });
    this.builderObserver.observe(list, { childList: true });
  }

  showLoading(flag) {
    // ▼▼▼ ログ追加 ▼▼▼
    console.log(`[FacultyAdmin] showLoading: 状態を ${!flag} に切り替えます。`, {
      loadingElement: this.dom.glFacultyAdminLoading,
      contentElement: this.dom.glFacultyAdminContent
    });
      if (this.dom.glFacultyAdminLoading) {
      this.dom.glFacultyAdminLoading.hidden = !flag;
    }
    if (this.dom.glFacultyAdminContent) {
      this.dom.glFacultyAdminContent.hidden = flag;
    }
  }

  setStatus(message, variant = "info") {
    const element = this.dom.glFacultyAdminStatus;
    if (!element) {
      return;
    }
    const text = ensureString(message);
    element.textContent = text;
    element.dataset.variant = variant;
    element.hidden = !text;
  }

  updateMetaDisplay() {
    const element = this.dom.glFacultyAdminUpdated;
    if (!element) {
      return;
    }
    const parts = [];
    const updatedAt = Number(this.catalogMeta.updatedAt) || 0;
    const updatedBy = ensureString(this.catalogMeta.updatedByName || this.catalogMeta.updatedByUid);
    if (updatedAt > 0) {
      const formatted = formatDateTimeLocal(new Date(updatedAt));
      if (formatted) {
        parts.push(`最終更新: ${formatted}`);
      }
    }
    if (updatedBy) {
      parts.push(`更新者: ${updatedBy}`);
    }
    element.textContent = parts.join(" ／ ");
    element.hidden = parts.length === 0;
  }

  applyCatalog(raw) {
    // ▼▼▼ ログ追加 ▼▼▼
    console.log("[FacultyAdmin] applyCatalog: カタログデータを適用します。showLoading(false) を実行します。");
    const faculties = normalizeFacultyList(raw);
    const meta = raw && typeof raw === "object" ? raw : {};
    this.originalFaculties = faculties;
    this.originalSignature = createSignature(faculties);
    this.catalogMeta = {
      updatedAt: Number(meta.updatedAt) || 0,
      updatedByUid: ensureString(meta.updatedByUid),
      updatedByName: ensureString(meta.updatedByName)
    };
    this.builder.setFaculties(faculties);
    this.showLoading(false);
    this.setStatus("", "info");
    this.updateMetaDisplay();
    this.updateSavingState();
  }

  collectFaculties() {
    const result = this.builder.collectFaculties();
    const normalized = normalizeFacultyList(result.faculties);
    return {
      normalized,
      errors: Array.isArray(result.errors) ? result.errors : []
    };
  }

  hasChanges(nextFaculties) {
    return createSignature(nextFaculties) !== this.originalSignature;
  }

  updateSavingState() {
    if (this.dom.glFacultyAdminSaveButton) {
      this.dom.glFacultyAdminSaveButton.disabled = this.saving;
    }
    if (this.dom.glFacultyAdminResetButton) {
      const hasBuilderEntries = this.builder?.hasFaculties?.() || false;
      const disableReset = this.saving || (this.originalFaculties.length === 0 && !hasBuilderEntries);
      this.dom.glFacultyAdminResetButton.disabled = disableReset;
    }
  }

  async handleSave() {
    const { normalized, errors } = this.collectFaculties();
    if (errors.length) {
      this.setStatus(errors[0], "error");
      return;
    }
    if (!normalized.length) {
      this.setStatus("学部カードを1件以上追加してください。", "error");
      return;
    }
    if (!this.hasChanges(normalized)) {
      this.setStatus("変更はありません。", "info");
      return;
    }
    this.saving = true;
    this.updateSavingState();
    this.setStatus("保存しています…", "progress");
    const user = this.app?.currentUser || null;
    const payload = {
      faculties: normalized,
      updatedAt: serverTimestamp(),
      updatedByUid: ensureString(user?.uid),
      updatedByName: ensureString(user?.displayName) || ensureString(user?.email)
    };
    try {
      await set(glIntakeFacultyCatalogRef, payload);
      this.setStatus("共通設定を保存しました。", "success");
    } finally {
      this.saving = false;
      this.updateSavingState();
    }
  }

  handleReset() {
    this.builder.setFaculties(this.originalFaculties);
    this.setStatus("変更を元に戻しました。", "info");
    this.updateSavingState();
  }

  resetFlowState() {
    this.setStatus("", "info");
  }

  resetContext() {
    // No event-specific context to reset.
  }
}
