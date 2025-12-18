import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { FIREBASE_CONFIG } from "../shared/firebase-config.js";
// フォーム管理機能を gl-form-manager.js からインポート（フェーズ2 段階2）
// データ取得・送信機能を gl-form-data-manager.js からインポート（フェーズ2 段階3）
import { GlFormManager } from "./gl-form-manager.js";
import { GlFormDataManager } from "./gl-form-data-manager.js";

(() => {
  const runtime = typeof globalThis !== "undefined" ? globalThis : window;
  if (runtime.__TEL_OP_GL_FORM_INITIALIZED__) {
    return;
  }
  runtime.__TEL_OP_GL_FORM_INITIALIZED__ = true;

  const apps = getApps();
  const firebaseApp = apps.length ? getApp() : initializeApp(FIREBASE_CONFIG);
  const database = getDatabase(firebaseApp);
  
  const elements = {
    form: document.getElementById("gl-entry-form"),
    contextBanner: document.getElementById("gl-context-banner"),
    contextEvent: document.getElementById("gl-context-event"),
    contextPeriod: document.getElementById("gl-context-period"),
    contextGuard: document.getElementById("gl-context-guard"),
    nameInput: document.getElementById("gl-name"),
    phoneticInput: document.getElementById("gl-phonetic"),
    gradeInput: document.getElementById("gl-grade"),
    genderInput: document.getElementById("gl-gender"),
    facultySelect: document.getElementById("gl-faculty"),
    academicFields: document.getElementById("gl-academic-fields"),
    academicSelectTemplate: document.getElementById("gl-academic-select-template"),
    academicCustomField: document.getElementById("gl-academic-custom-field"),
    academicCustomLabel: document.getElementById("gl-academic-custom-label"),
    academicCustomInput: document.getElementById("gl-academic-custom"),
    emailInput: document.getElementById("gl-email"),
    clubInput: document.getElementById("gl-club"),
    studentIdInput: document.getElementById("gl-student-id"),
    noteInput: document.getElementById("gl-note"),
    shiftList: document.getElementById("gl-shift-list"),
    shiftFieldset: document.getElementById("gl-shift-fieldset"),
    submitButton: document.getElementById("gl-submit-button"),
    feedback: document.getElementById("gl-form-feedback"),
    formMeta: document.getElementById("gl-form-meta"),
    eventIdInput: document.getElementById("gl-event-id"),
    slugInput: document.getElementById("gl-slug"),
    privacyConsent: document.getElementById("gl-privacy-consent")
  };
  
  const state = {
    eventId: "",
    slug: "",
    eventName: "",
    faculties: [],
    schedules: [],
    unitSelections: [],
    currentCustomLabel: ""
  };
  
  const unitLevelMap = new WeakMap();
  
  // フォーム管理機能はgl-form-manager.jsからインポート（フェーズ2 段階2）
  
  // GlFormManagerのインスタンスを作成（フェーズ2 段階2）
  const formManager = new GlFormManager({
    elements,
    getState: () => state,
    setState: (newState) => {
      Object.assign(state, newState);
    },
    unitLevelMap
  });
  
  // 既存の関数をGlFormManagerに委譲（フェーズ2 段階2）
  function showGuard(message) {
    formManager.showGuard(message);
  }
  
  function hideGuard() {
    formManager.hideGuard();
  }
  
  function renderFaculties(faculties) {
    formManager.renderFaculties(faculties);
  }
  
  // 学歴管理機能はGlFormManagerに委譲（フェーズ2 段階2）
  function clearAcademicFields() {
    formManager.clearAcademicFields();
  }
  
  function removeAcademicFieldsAfter(depth) {
    formManager.removeAcademicFieldsAfter(depth);
  }
  
  function updateAcademicCustomField(label) {
    formManager.updateAcademicCustomField(label);
  }
  
  function renderAcademicLevel(level, depth) {
    formManager.renderAcademicLevel(level, depth, (select) => {
      handleAcademicLevelChange(select);
    });
  }
  
  function handleAcademicLevelChange(select) {
    formManager.handleAcademicLevelChange(select, (children, nextDepth) => {
      renderAcademicLevel(children, nextDepth);
    });
  }
  
  function renderAcademicTreeForFaculty(facultyName) {
    formManager.renderAcademicTreeForFaculty(facultyName, (select) => {
      handleAcademicLevelChange(select);
    });
  }
  
  function collectAcademicPathState() {
    return formManager.collectAcademicPathState();
  }
  
  // シフト描画機能はGlFormManagerに委譲（フェーズ2 段階2）
  function renderShifts(schedules) {
    formManager.renderShifts(schedules);
  }
  
  // コンテキスト表示機能はGlFormManagerに委譲（フェーズ2 段階2）
  function populateContext(eventName, periodText) {
    formManager.populateContext(eventName, periodText);
  }
  
  // GlFormDataManagerのインスタンスを作成（フェーズ2 段階3）
  const dataManager = new GlFormDataManager({
    database,
    elements,
    getState: () => state,
    setState: (newState) => {
      Object.assign(state, newState);
    },
    onShowGuard: showGuard,
    onHideGuard: hideGuard,
    onPopulateContext: populateContext,
    onRenderFaculties: renderFaculties,
    onRenderAcademicTreeForFaculty: renderAcademicTreeForFaculty,
    onRenderShifts: renderShifts,
    onCollectAcademicPathState: collectAcademicPathState
  });
  
  async function prepareForm() {
    await dataManager.prepareForm();
  }
  
  function collectShifts() {
    return dataManager.collectShifts();
  }
  
  async function handleSubmit(event) {
    await dataManager.handleSubmit(event);
  }
  
  function bindEvents() {
    elements.facultySelect?.addEventListener("change", (event) => {
      const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
      renderAcademicTreeForFaculty(value);
    });
    elements.form?.addEventListener("submit", handleSubmit);
  }
  
  (async function init() {
    bindEvents();
    try {
      await prepareForm();
    } catch (error) {
      console.error(error);
      showGuard("フォームの初期化に失敗しました。時間をおいて再度お試しください。");
    }
  })();
})();
