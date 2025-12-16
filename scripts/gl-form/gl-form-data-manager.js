// gl-form-data-manager.js: GLフォーム用のデータ取得・送信機能
// gl-form/index.js から分離（フェーズ2 段階3）

import { ref, get, push, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { CUSTOM_OPTION_VALUE, ensureString, parseTimestamp, formatPeriod, parseFaculties, parseSchedules } from "./gl-form-utils.js";

/**
 * GlFormDataManager: GLフォームのデータ取得・送信を担当するクラス
 * gl-form/index.js からデータ取得・送信機能を分離（フェーズ2 段階3）
 */
export class GlFormDataManager {
  constructor(context) {
    // Firebase Database
    this.database = context.database;
    
    // DOM要素
    this.elements = context.elements || {};
    
    // 状態管理
    this.getState = context.getState || (() => ({}));
    this.setState = context.setState || (() => {});
    
    // コールバック関数
    this.onShowGuard = context.onShowGuard || (() => {});
    this.onHideGuard = context.onHideGuard || (() => {});
    this.onPopulateContext = context.onPopulateContext || (() => {});
    this.onRenderFaculties = context.onRenderFaculties || (() => {});
    this.onRenderAcademicTreeForFaculty = context.onRenderAcademicTreeForFaculty || (() => {});
    this.onRenderShifts = context.onRenderShifts || (() => {});
    this.onCollectAcademicPathState = context.onCollectAcademicPathState || (() => ({}));
  }

  /**
   * フォームを準備（データ取得と初期化）
   * @returns {Promise<void>}
   */
  async prepareForm() {
    this.onHideGuard();
    const params = new URLSearchParams(window.location.search || "");
    const slug = ensureString(params.get("evt"));
    if (!slug) {
      this.onShowGuard("このフォームは専用URLからアクセスしてください。");
      return;
    }
    const state = this.getState();
    state.slug = slug;
    if (this.elements.slugInput) {
      this.elements.slugInput.value = slug;
    }
    const slugRef = ref(this.database, `glIntake/slugIndex/${slug}`);
    const slugSnap = await get(slugRef);
    if (!slugSnap.exists()) {
      this.onShowGuard("募集が終了したか、URLが無効です。運営までお問い合わせください。");
      return;
    }
    const eventId = ensureString(slugSnap.val());
    if (!eventId) {
      this.onShowGuard("イベント情報を特定できませんでした。運営までお問い合わせください。");
      return;
    }
    state.eventId = eventId;
    if (this.elements.eventIdInput) {
      this.elements.eventIdInput.value = eventId;
    }
    
    let catalogFaculties = []; // 学部マスターデータの格納用
    try {
      const catalogRef = ref(this.database, "glIntake/facultyCatalog");
      const catalogSnap = await get(catalogRef);
      if (catalogSnap.exists()) {
        const catalogData = catalogSnap.val();
        catalogFaculties = parseFaculties(catalogData.faculties || []);
      }
    } catch (error) {
      console.error("Failed to fetch faculty catalog:", error);
      // カタログの取得に失敗しても、フォームの読み込みを続行
    }
   
    const configRef = ref(this.database, `glIntake/events/${eventId}`);
    const configSnap = await get(configRef);
    const config = configSnap.val() || {};
    const now = Date.now();
    const startAt = parseTimestamp(config.startAt);
    const endAt = parseTimestamp(config.endAt);
    if (startAt && now < startAt) {
      this.onShowGuard("まだ募集開始前です。募集開始までお待ちください。");
      return;
    }
    if (endAt && now > endAt) {
      this.onShowGuard("募集期間が終了しました。運営までお問い合わせください。");
      return;
    }
    state.faculties = catalogFaculties.length > 0 ? catalogFaculties : parseFaculties(config.faculties || []);
    const scheduleSources = [config.schedules, config.scheduleSummary, config.scheduleOptions];
    let parsedSchedules = [];
    for (const source of scheduleSources) {
      parsedSchedules = parseSchedules(source);
      if (parsedSchedules.length) {
        break;
      }
    }
    // questionIntake/schedules から recruitGl 情報を取得して補完
    if (parsedSchedules.length > 0) {
      try {
        const schedulesRef = ref(this.database, `questionIntake/schedules/${eventId}`);
        const schedulesSnap = await get(schedulesRef);
        if (schedulesSnap.exists()) {
          const schedulesData = schedulesSnap.val() || {};
          parsedSchedules = parsedSchedules.map((schedule) => {
            const scheduleData = schedulesData[schedule.id];
            if (scheduleData && typeof scheduleData === "object") {
              return {
                ...schedule,
                recruitGl: scheduleData.recruitGl !== false
              };
            }
            return schedule;
          });
        }
      } catch (error) {
        console.warn("Failed to fetch schedule recruitGl info, using defaults", error);
      }
    }
    state.schedules = parsedSchedules;
    // 完全正規化: eventNameはquestionIntake/events/{eventId}/nameから取得
    let eventName = eventId;
    try {
      const eventRef = ref(this.database, `questionIntake/events/${eventId}`);
      const eventSnap = await get(eventRef);
      if (eventSnap.exists()) {
        const eventData = eventSnap.val() || {};
        eventName = ensureString(eventData.name || eventId);
      }
    } catch (error) {
      console.warn("Failed to fetch event name, using eventId as fallback", error);
    }
    state.eventName = eventName;
    this.setState(state);
    const periodText = formatPeriod(startAt, endAt);
    this.onPopulateContext(eventName, periodText);
    this.onRenderFaculties(state.faculties);
    this.onRenderAcademicTreeForFaculty(this.elements.facultySelect ? this.elements.facultySelect.value : "");
    this.onRenderShifts(state.schedules);
    if (this.elements.form) {
      this.elements.form.hidden = false;
    }
    if (this.elements.formMeta) {
      this.elements.formMeta.hidden = true;
    }
  }

  /**
   * シフトデータを収集
   * @returns {Object} シフトデータ
   */
  collectShifts() {
    const state = this.getState();
    const result = {};
    state.schedules.forEach((schedule) => {
      const checkbox = this.elements.shiftList?.querySelector(`input[data-schedule-id="${CSS.escape(schedule.id)}"]`);
      result[schedule.id] = checkbox ? checkbox.checked : false;
    });
    return result;
  }

  /**
   * フォーム送信を処理
   * @param {Event} event - イベントオブジェクト
   * @returns {Promise<void>}
   */
  async handleSubmit(event) {
    event.preventDefault();
    const state = this.getState();
    if (!state.eventId) {
      this.onShowGuard("イベント情報が取得できませんでした。運営までお問い合わせください。");
      return;
    }
    const facultyValue = ensureString(this.elements.facultySelect?.value);
    if (!facultyValue || facultyValue === CUSTOM_OPTION_VALUE) {
      this.elements.feedback.textContent = "学部を選択してください。";
      this.elements.feedback.dataset.variant = "error";
      this.elements.facultySelect?.focus();
      return;
    }
    const academic = this.onCollectAcademicPathState();
    if (academic.pendingSelect instanceof HTMLSelectElement) {
      const label = ensureString(academic.pendingSelect.dataset.levelLabel) || "所属";
      this.elements.feedback.textContent = `${label}を選択してください。`;
      this.elements.feedback.dataset.variant = "error";
      academic.pendingSelect.focus();
      return;
    }
    if (!academic.path.length) {
      const label = state.currentCustomLabel || "所属情報";
      this.elements.feedback.textContent = `${label}を選択してください。`;
      this.elements.feedback.dataset.variant = "error";
      if (academic.firstSelect instanceof HTMLSelectElement) {
        academic.firstSelect.focus();
      } else if (this.elements.academicCustomInput) {
        this.elements.academicCustomInput.focus();
      }
      return;
    }
    if (academic.requiresCustom && !academic.customValue) {
      const label = academic.customLabel || state.currentCustomLabel || "所属";
      this.elements.feedback.textContent = `${label}を入力してください。`;
      this.elements.feedback.dataset.variant = "error";
      this.elements.academicCustomInput?.focus();
      return;
    }
    const departmentSegment = academic.path[academic.path.length - 1];
    const department = ensureString(departmentSegment?.value);
    if (!department) {
      const label = ensureString(departmentSegment?.label) || "所属";
      this.elements.feedback.textContent = `${label}を入力してください。`;
      this.elements.feedback.dataset.variant = "error";
      if (departmentSegment?.element instanceof HTMLElement) {
        departmentSegment.element.focus();
      } else {
        this.elements.academicCustomInput?.focus();
      }
      return;
    }
    const shifts = this.collectShifts();
    if (state.schedules.length && !Object.values(shifts).some(Boolean)) {
      this.elements.feedback.textContent = "参加可能な日程にチェックを入れてください。";
      this.elements.feedback.dataset.variant = "error";
      const firstCheckbox = this.elements.shiftList?.querySelector("input[type=checkbox]");
      if (firstCheckbox instanceof HTMLInputElement) {
        firstCheckbox.focus();
      }
      return;
    }
    if (this.elements.privacyConsent && !this.elements.privacyConsent.checked) {
      this.elements.feedback.textContent = "個人情報の取扱いについて同意してください。";
      this.elements.feedback.dataset.variant = "error";
      this.elements.privacyConsent.focus();
      return;
    }
    const academicPath = academic.path
      .map((segment) => ({
        label: ensureString(segment.label),
        value: ensureString(segment.value),
        display: ensureString(segment.displayLabel ?? segment.value),
        isCustom: Boolean(segment.isCustom)
      }))
      .filter((segment) => segment.value);
    // 完全正規化: eventNameは削除（eventIdから取得可能）
    const payload = {
      name: ensureString(this.elements.nameInput?.value),
      phonetic: ensureString(this.elements.phoneticInput?.value),
      grade: ensureString(this.elements.gradeInput?.value),
      faculty: facultyValue,
      department,
      academicPath,
      email: ensureString(this.elements.emailInput?.value),
      club: ensureString(this.elements.clubInput?.value),
      studentId: ensureString(this.elements.studentIdInput?.value),
      note: ensureString(this.elements.noteInput?.value),
      shifts,
      eventId: state.eventId,
      slug: state.slug,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (this.elements.privacyConsent) {
      payload.privacyConsent = true;
    }
    if (!payload.note) {
      delete payload.note;
    }
    if (!payload.name) {
      this.elements.feedback.textContent = "氏名を入力してください。";
      this.elements.feedback.dataset.variant = "error";
      this.elements.nameInput?.focus();
      return;
    }
    if (!payload.email) {
      this.elements.feedback.textContent = "メールアドレスを入力してください。";
      this.elements.feedback.dataset.variant = "error";
      this.elements.emailInput?.focus();
      return;
    }
    this.elements.feedback.textContent = "送信しています…";
    this.elements.feedback.dataset.variant = "progress";
    this.elements.submitButton?.setAttribute("disabled", "true");
    try {
      const applicationsRef = ref(this.database, `glIntake/applications/${state.eventId}`);
      const recordRef = push(applicationsRef);
      await set(recordRef, payload);
      this.elements.feedback.textContent = "応募を受け付けました。ご協力ありがとうございます。";
      this.elements.feedback.dataset.variant = "success";
      if (this.elements.form) {
        this.elements.form.reset();
        this.elements.form.hidden = true;
        this.onRenderAcademicTreeForFaculty(this.elements.facultySelect ? this.elements.facultySelect.value : "");
      }
      if (this.elements.formMeta) {
        this.elements.formMeta.hidden = false;
      }
    } catch (error) {
      console.error(error);
      this.elements.feedback.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
      this.elements.feedback.dataset.variant = "error";
      this.elements.submitButton?.removeAttribute("disabled");
    }
  }
}

