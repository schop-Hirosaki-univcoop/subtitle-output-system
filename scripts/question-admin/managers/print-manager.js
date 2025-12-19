// print-manager.js: 印刷機能のマネージャークラス
// 印刷設定の管理、印刷プレビューの生成と表示を担当します。

import {
  PRINT_SETTING_STORAGE_KEY,
  DEFAULT_PRINT_SETTINGS,
  normalizePrintSettings,
  formatPrintDateTimeRange,
  buildParticipantPrintHtml,
  buildStaffPrintHtml,
  logPrintInfo,
  logPrintWarn,
  logPrintError,
  logPrintDebug
} from "../../shared/print-utils.js";
import {
  DEFAULT_PREVIEW_NOTE,
  DEFAULT_LOAD_TIMEOUT_MS,
  createPrintPreviewController
} from "../../shared/print-preview.js";
import { combineDateAndTime } from "../calendar.js";

const GL_STAFF_LABEL = "運営待機";
const PRINT_PREVIEW_DEFAULT_NOTE = DEFAULT_PREVIEW_NOTE;
const PRINT_PREVIEW_LOAD_TIMEOUT_MS = DEFAULT_LOAD_TIMEOUT_MS;

/**
 * 印刷機能のマネージャークラス
 * QuestionAdminApp から印刷機能を分離したモジュール
 */
export class PrintManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    
    // 依存関数と定数
    this.sortParticipants = context.sortParticipants;
    this.getParticipantGroupKey = context.getParticipantGroupKey;
    this.describeParticipantGroup = context.describeParticipantGroup;
    this.collectGroupGlLeaders = context.collectGroupGlLeaders;
    this.getEventGlRoster = context.getEventGlRoster;
    this.getEventGlAssignmentsMap = context.getEventGlAssignmentsMap;
    this.resolveScheduleAssignment = context.resolveScheduleAssignment;
    this.loadGlDataForEvent = context.loadGlDataForEvent;
    this.normalizeKey = context.normalizeKey;
    this.normalizeGroupNumberValue = context.normalizeGroupNumberValue;
    this.NO_TEAM_GROUP_KEY = context.NO_TEAM_GROUP_KEY;
    this.CANCEL_LABEL = context.CANCEL_LABEL;
    this.RELOCATE_LABEL = context.RELOCATE_LABEL;
    this.GL_STAFF_GROUP_KEY = context.GL_STAFF_GROUP_KEY;
    // ボタン状態管理関数
    this.syncAllPrintButtonStates = context.syncAllPrintButtonStates;
    this.setPrintButtonBusy = context.setPrintButtonBusy;
    this.setStaffPrintButtonBusy = context.setStaffPrintButtonBusy;
    
    // 印刷プレビューコントローラー
    this.participantPrintPreviewController = createPrintPreviewController({
      previewContainer: this.dom.printPreview,
      previewFrame: this.dom.printPreviewFrame,
      previewMeta: this.dom.printPreviewMeta,
      previewNote: this.dom.printPreviewNote,
      previewPrintButton: this.dom.printPreviewPrintButton,
      previewDialog: this.dom.printPreviewDialog,
      defaultNote: PRINT_PREVIEW_DEFAULT_NOTE,
      loadTimeoutMs: PRINT_PREVIEW_LOAD_TIMEOUT_MS,
      defaultSettings: () => this.state.printSettings || DEFAULT_PRINT_SETTINGS,
      normalizeSettings: (settings, fallback) => normalizePrintSettings(settings, fallback),
      onCacheChange: (nextCache) => {
        this.participantPrintPreviewCache = nextCache;
      },
      openDialog: (element) => this.openDialog(element),
      closeDialog: (element) => this.closeDialog(element),
      openPopup: (html, title, settings) => this.openPopupPrintWindow(html, title, settings)
    });
    
    this.participantPrintPreviewCache = this.participantPrintPreviewController.getCache();
    this.participantPrintInProgress = false;
    this.staffPrintInProgress = false;
    this.printActionButtonMissingLogged = false;
    this.staffPrintActionButtonMissingLogged = false;
    
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * 印刷プレビューのキャッシュを更新する
   * @param {Object} data - キャッシュデータ
   * @param {Object} options - オプション
   * @returns {Object} 更新されたキャッシュ
   */
  cacheParticipantPrintPreview(data = {}, options = {}) {
    logPrintDebug("cacheParticipantPrintPreview", { data, options });
    this.participantPrintPreviewCache = this.participantPrintPreviewController.cachePreview(data, options);
    return this.participantPrintPreviewCache;
  }

  /**
   * 印刷プレビューのノートを設定する
   * @param {string} text - ノートテキスト
   * @param {Object} options - オプション
   */
  setPrintPreviewNote(text = PRINT_PREVIEW_DEFAULT_NOTE, options = {}) {
    logPrintDebug("setPrintPreviewNote", { text, options });
    this.participantPrintPreviewController.setNote(text, options);
  }

  /**
   * 印刷プレビューの表示/非表示を設定する
   * @param {boolean} visible - 表示するかどうか
   * @returns {boolean} 設定された値
   */
  setPrintPreviewVisibility(visible) {
    logPrintInfo("setPrintPreviewVisibility", { visible });
    return this.participantPrintPreviewController.setVisibility(visible);
  }

  /**
   * 印刷プレビューのビジー状態を設定する
   * @param {boolean} isBusy - ビジー状態かどうか
   */
  setPrintPreviewBusy(isBusy = false) {
    logPrintDebug("setPrintPreviewBusy", { isBusy });
    this.participantPrintPreviewController.setBusy(isBusy);
  }

  /**
   * 印刷プレビューのローダーをクリアする
   */
  clearParticipantPrintPreviewLoader() {
    logPrintDebug("clearParticipantPrintPreviewLoader");
    this.participantPrintPreviewController.setBusy(false);
  }

  /**
   * 印刷プレビューをリセットする
   * @param {Object} options - オプション
   */
  resetPrintPreview(options = {}) {
    const { skipCloseDialog = false } = options || {};
    logPrintInfo("resetPrintPreview", { skipCloseDialog });
    this.participantPrintPreviewCache = this.participantPrintPreviewController.reset();
    if (!skipCloseDialog) {
      this.participantPrintPreviewController.setVisibility(false);
    }
  }

  /**
   * フォールバックノートを表示する
   * @param {string} message - メッセージ
   * @param {string} metaText - メタテキスト
   */
  renderPreviewFallbackNote(message, metaText = "") {
    logPrintWarn("renderPreviewFallbackNote", { message, metaText });
    const hasCachedHtml = Boolean(this.participantPrintPreviewCache?.html || this.participantPrintPreviewCache?.forcePopupFallback);
    const noteText = `${message || "プレビューを表示できませんでした。"}${
      hasCachedHtml ? " 画面右の「このリストを印刷」からポップアップ印刷を再試行できます。" : ""
    }`;
    this.cacheParticipantPrintPreview({
      ...this.participantPrintPreviewCache,
      metaText: metaText || this.participantPrintPreviewCache.metaText || "",
      forcePopupFallback: true
    });
    this.participantPrintPreviewController.setVisibility(true);
    this.participantPrintPreviewController.setNote(noteText, { forceAnnounce: true, politeness: "assertive" });
    this.participantPrintPreviewController.setBusy(false);
    if (this.dom.printPreviewMeta) {
      this.dom.printPreviewMeta.textContent = metaText || this.participantPrintPreviewCache.metaText || "";
    }
    if (this.dom.printPreviewPrintButton) {
      this.dom.printPreviewPrintButton.disabled = !hasCachedHtml;
      if (hasCachedHtml) {
        this.dom.printPreviewPrintButton.dataset.popupFallback = "true";
      } else {
        delete this.dom.printPreviewPrintButton.dataset.popupFallback;
      }
    }
    this.dom.printPreviewNote?.classList.add("print-preview__note--error");
  }

  /**
   * 参加者印刷プレビューを描画する
   * @param {Object} options - オプション
   * @returns {boolean} 成功したかどうか
   */
  renderParticipantPrintPreview({
    html,
    metaText,
    title,
    autoPrint = false,
    printSettings
  } = {}) {
    logPrintInfo("renderParticipantPrintPreview", { hasHtml: Boolean(html), metaText, title, autoPrint, printSettings });
    return this.participantPrintPreviewController.renderPreview({
      html,
      metaText,
      title,
      autoPrint,
      printSettings
    });
  }

  /**
   * プレビューから印刷をトリガーする
   * @returns {boolean} 成功したかどうか
   */
  triggerPrintFromPreview() {
    logPrintInfo("triggerPrintFromPreview");
    if (!this.dom.printPreviewFrame) {
      logPrintWarn("triggerPrintFromPreview aborted: missing frame");
      return false;
    }
    const printWindow = this.dom.printPreviewFrame.contentWindow;
    if (!printWindow) {
      logPrintWarn("triggerPrintFromPreview aborted: missing window");
      return false;
    }
    try {
      printWindow.focus();
      printWindow.print();
      logPrintInfo("triggerPrintFromPreview succeeded");
      return true;
    } catch (error) {
      logPrintWarn("triggerPrintFromPreview failed", error);
      return false;
    }
  }

  /**
   * 参加者プレビューを印刷する
   * @param {Object} options - オプション
   * @returns {Promise} 印刷結果
   */
  printParticipantPreview({ showAlertOnFailure = false } = {}) {
    logPrintInfo("printParticipantPreview invoked", { showAlertOnFailure });
    return this.participantPrintPreviewController.printPreview({ showAlertOnFailure });
  }

  /**
   * 参加者印刷プレビューを閉じる
   */
  closeParticipantPrintPreview() {
    logPrintInfo("closeParticipantPrintPreview");
    this.resetPrintPreview();
  }

  /**
   * 印刷設定をストレージから読み込む
   */
  hydrateSettingsFromStorage() {
    logPrintInfo("hydratePrintSettingsFromStorage start");
    if (typeof localStorage === "undefined") {
      logPrintWarn("hydratePrintSettingsFromStorage skipped: localStorage unavailable");
      return;
    }
    try {
      const stored = localStorage.getItem(PRINT_SETTING_STORAGE_KEY);
      if (!stored) {
        logPrintDebug("hydratePrintSettingsFromStorage empty");
        return;
      }
      const parsed = JSON.parse(stored);
      const normalized = normalizePrintSettings(parsed, this.state.printSettings || DEFAULT_PRINT_SETTINGS);
      this.state.printSettings = normalized;
      logPrintInfo("hydratePrintSettingsFromStorage loaded", normalized);
    } catch (error) {
      console.warn("[Print] Failed to load print settings from storage", error);
    }
  }

  /**
   * 印刷設定をストレージに保存する
   * @param {Object} settings - 保存する設定
   * @returns {Object} 正規化された設定
   */
  persistSettings(settings) {
    logPrintInfo("persistPrintSettings start", settings);
    const normalized = normalizePrintSettings(settings, this.state.printSettings || DEFAULT_PRINT_SETTINGS);
    this.state.printSettings = normalized;
    if (typeof localStorage === "undefined") {
      logPrintWarn("persistPrintSettings skipped: localStorage unavailable");
      return normalized;
    }
    try {
      localStorage.setItem(PRINT_SETTING_STORAGE_KEY, JSON.stringify(normalized));
      logPrintInfo("persistPrintSettings saved", normalized);
    } catch (error) {
      console.warn("[Print] Failed to persist print settings", error);
    }
    return normalized;
  }

  /**
   * 印刷設定をフォームに適用する
   * @param {Object} settings - 適用する設定（省略時は state.printSettings）
   */
  applySettingsToForm(settings = this.state.printSettings) {
    logPrintDebug("applyPrintSettingsToForm", settings);
    const normalized = normalizePrintSettings(settings, this.state.printSettings || DEFAULT_PRINT_SETTINGS);
    if (this.dom.printPaperSizeInput) {
      this.dom.printPaperSizeInput.value = normalized.paperSize;
    }
    if (this.dom.printOrientationInput) {
      this.dom.printOrientationInput.value = normalized.orientation;
    }
    if (this.dom.printMarginInput) {
      this.dom.printMarginInput.value = normalized.margin;
    }
    if (this.dom.printCustomWidthInput) {
      this.dom.printCustomWidthInput.value = normalized.customWidth;
    }
    if (this.dom.printCustomHeightInput) {
      this.dom.printCustomHeightInput.value = normalized.customHeight;
    }
    if (this.dom.printShowHeaderInput) {
      this.dom.printShowHeaderInput.checked = normalized.showHeader;
    }
    if (this.dom.printRepeatHeaderInput) {
      this.dom.printRepeatHeaderInput.checked = normalized.repeatHeader && normalized.showHeader;
      this.dom.printRepeatHeaderInput.disabled = !normalized.showHeader;
    }
    if (this.dom.printShowPageNumberInput) {
      this.dom.printShowPageNumberInput.checked = normalized.showPageNumbers;
    }
    if (this.dom.printShowDateInput) {
      this.dom.printShowDateInput.checked = normalized.showDate;
    }
    if (this.dom.printShowTimeInput) {
      this.dom.printShowTimeInput.checked = normalized.showTime;
    }
    if (this.dom.printShowPhoneInput) {
      this.dom.printShowPhoneInput.checked = normalized.showPhone;
    }
    if (this.dom.printShowEmailInput) {
      this.dom.printShowEmailInput.checked = normalized.showEmail;
    }
  }

  /**
   * フォームから印刷設定を読み込む
   * @returns {Object} 正規化された設定
   */
  readSettingsFromForm() {
    logPrintDebug("readPrintSettingsFromForm start");
    const settings = {
      paperSize: this.dom.printPaperSizeInput?.value,
      orientation: this.dom.printOrientationInput?.value,
      margin: this.dom.printMarginInput?.value,
      customWidth: this.dom.printCustomWidthInput?.value,
      customHeight: this.dom.printCustomHeightInput?.value,
      showHeader: this.dom.printShowHeaderInput ? this.dom.printShowHeaderInput.checked : undefined,
      repeatHeader: this.dom.printRepeatHeaderInput ? this.dom.printRepeatHeaderInput.checked : undefined,
      showPageNumbers: this.dom.printShowPageNumberInput ? this.dom.printShowPageNumberInput.checked : undefined,
      showDate: this.dom.printShowDateInput ? this.dom.printShowDateInput.checked : undefined,
      showTime: this.dom.printShowTimeInput ? this.dom.printShowTimeInput.checked : undefined,
      showPhone: this.dom.printShowPhoneInput ? this.dom.printShowPhoneInput.checked : undefined,
      showEmail: this.dom.printShowEmailInput ? this.dom.printShowEmailInput.checked : undefined
    };
    if (settings.showHeader === false) {
      settings.repeatHeader = false;
    }
    const normalized = normalizePrintSettings(settings, this.state.printSettings || DEFAULT_PRINT_SETTINGS);
    logPrintInfo("readPrintSettingsFromForm normalized", normalized);
    return normalized;
  }

  /**
   * 印刷設定ダイアログをセットアップする
   */
  setupSettingsDialog() {
    if (!this.dom.printSettingsForm) return;

    logPrintInfo("setupPrintSettingsDialog initialized");

    const syncHeaderControls = () => {
      if (!this.dom.printShowHeaderInput || !this.dom.printRepeatHeaderInput) return;
      const enabled = Boolean(this.dom.printShowHeaderInput.checked);
      this.dom.printRepeatHeaderInput.disabled = !enabled;
      if (!enabled) {
        this.dom.printRepeatHeaderInput.checked = false;
      }
      logPrintDebug("syncHeaderControls", { enabled });
    };

    const syncCustomSizeVisibility = () => {
      if (!this.dom.printPaperSizeInput || !this.dom.printCustomSizeField) return;
      const isCustom = this.dom.printPaperSizeInput.value === "Custom";
      this.dom.printCustomSizeField.hidden = !isCustom;
      logPrintDebug("syncCustomSizeVisibility", { isCustom });
    };

    this.dom.printShowHeaderInput?.addEventListener("change", syncHeaderControls);
    this.dom.printPaperSizeInput?.addEventListener("change", syncCustomSizeVisibility);
    this.dom.printSettingsForm.addEventListener("change", () => {
      logPrintInfo("print settings form changed");
      const settings = this.readSettingsFromForm();
      this.persistSettings(settings);
      // PrintManager の updateParticipantPrintPreview を呼び出す
      this.updateParticipantPrintPreview({ autoPrint: false, forceReveal: true, quiet: true }).catch(error => {
        console.error("Failed to update participant print preview", error);
      });
    });

    this.dom.printSettingsForm.addEventListener("submit", event => {
      event.preventDefault();
      logPrintInfo("print settings form submitted");
      const settings = this.readSettingsFromForm();
      this.persistSettings(settings);
      // PrintManager の updateParticipantPrintPreview を呼び出す
      this.updateParticipantPrintPreview({ autoPrint: false, forceReveal: true }).catch(error => {
        console.error("Failed to update participant print preview", error);
      });
    });

    this.applySettingsToForm(this.state.printSettings);
    syncHeaderControls();
    syncCustomSizeVisibility();
  }

  /**
   * ポップアップ印刷ウィンドウを開く
   * @param {string} html - 印刷するHTML
   * @param {string} docTitle - ドキュメントタイトル
   * @param {Object} printSettings - 印刷設定
   * @returns {boolean} 成功したかどうか
   */
  openPopupPrintWindow(html, docTitle, printSettings = this.state.printSettings) {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      return false;
    }

    try {
      printWindow.opener = null;
    } catch (error) {
      // Ignore opener errors
    }

    try {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (error) {
      // Ignore document write errors
    }

    try {
      if (docTitle) {
        printWindow.document.title = docTitle;
      }
    } catch (error) {
      // Ignore title assignment errors
    }

    window.setTimeout(() => {
      try {
        printWindow.print();
      } catch (error) {
        // Ignore print errors
      }
    }, 150);

    return true;
  }

  /**
   * 参加者印刷グループを構築する
   * @param {Object} options - オプション
   * @param {string} options.eventId - イベントID
   * @param {string} options.scheduleId - 日程ID
   * @returns {Array} 参加者グループの配列
   */
  buildParticipantPrintGroups({ eventId, scheduleId }) {
    const participants = this.sortParticipants(this.state.participants);
    const rosterMap = this.getEventGlRoster(eventId);
    const assignmentsMap = this.getEventGlAssignmentsMap(eventId);
    const groupsByKey = new Map();

    participants.forEach(entry => {
      const groupKey = this.getParticipantGroupKey(entry);
      let group = groupsByKey.get(groupKey);
      if (!group) {
        const { label, value } = this.describeParticipantGroup(groupKey);
        group = {
          key: groupKey,
          label,
          value,
          participants: []
        };
        groupsByKey.set(groupKey, group);
      }
      group.participants.push(entry);
    });

    return Array.from(groupsByKey.values())
      .filter(group => Array.isArray(group.participants) && group.participants.length > 0)
      .map(group => ({
        ...group,
        glLeaders: this.collectGroupGlLeaders(group.key, {
          eventId,
          scheduleId,
          rosterMap,
          assignmentsMap
        })
      }));
  }

  /**
   * スタッフ印刷グループを構築する
   * @param {Object} options - オプション
   * @param {string} options.eventId - イベントID
   * @param {string} options.scheduleId - 日程ID
   * @returns {Array} スタッフグループの配列
   */
  buildStaffPrintGroups({ eventId, scheduleId }) {
    const roster = this.getEventGlRoster(eventId);
    const assignments = this.getEventGlAssignmentsMap(eventId);
    if (!(roster instanceof Map) || !(assignments instanceof Map)) {
      return [];
    }

    const staffEntries = [];
    assignments.forEach((entry, glId) => {
      const assignment = this.resolveScheduleAssignment(entry, scheduleId);
      if (!assignment) return;
      const status = assignment.status || "";
      if (status === "absent" || status === "unavailable") {
        return;
      }
      if (status !== "team" && status !== "staff") {
        return;
      }

      const profile = roster.get(String(glId)) || {};
      staffEntries.push({
        id: String(glId),
        assignment: status === "staff" ? GL_STAFF_LABEL : this.normalizeKey(assignment.teamId || ""),
        name: profile.name || String(glId),
        phonetic: profile.phonetic || "",
        faculty: profile.faculty || "",
        department: profile.department || "",
        grade: profile.grade || "",
        sourceType: profile.sourceType === "internal" ? "internal" : "external"
      });
    });

    // スタッフエントリをソート
    const staffSortCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

    const compareNullableStringsForStaff = (a, b) => {
      const aText = this.normalizeKey(a || "");
      const bText = this.normalizeKey(b || "");
      if (aText && bText) {
        return staffSortCollator.compare(aText, bText);
      }
      if (aText && !bText) return -1;
      if (!aText && bText) return 1;
      return 0;
    };

    const resolveGradeSortKey = (grade) => {
      const raw = this.normalizeKey(grade || "");
      if (!raw) {
        return { priority: 1, letter: "", number: Number.POSITIVE_INFINITY, text: "" };
      }
      const normalized = raw.replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
      const letterMatch = normalized.match(/^[A-Za-z]+/);
      const numberMatch = normalized.match(/(\d+)/);
      return {
        priority: 0,
        letter: (letterMatch ? letterMatch[0] : "").toLowerCase(),
        number: numberMatch ? parseInt(numberMatch[1], 10) : Number.POSITIVE_INFINITY,
        text: normalized
      };
    };

    const compareStaffEntries = (a, b) => {
      const facultyDiff = compareNullableStringsForStaff(a.faculty, b.faculty);
      if (facultyDiff) return facultyDiff;
      const departmentDiff = compareNullableStringsForStaff(a.department, b.department);
      if (departmentDiff) return departmentDiff;

      const gradeA = resolveGradeSortKey(a.grade);
      const gradeB = resolveGradeSortKey(b.grade);
      if (gradeA.priority !== gradeB.priority) return gradeA.priority - gradeB.priority;
      const letterDiff = staffSortCollator.compare(gradeA.letter, gradeB.letter);
      if (letterDiff) return letterDiff;
      if (gradeA.number !== gradeB.number) return gradeA.number - gradeB.number;
      const gradeTextDiff = staffSortCollator.compare(gradeA.text, gradeB.text);
      if (gradeTextDiff) return gradeTextDiff;

      const nameDiff = compareNullableStringsForStaff(a.name, b.name);
      if (nameDiff) return nameDiff;
      return compareNullableStringsForStaff(a.phonetic, b.phonetic);
    };

    staffEntries.sort(compareStaffEntries);

    const groups = [];
    let currentFaculty = "__init__";
    let currentGroup = null;

    staffEntries.forEach(entry => {
      const facultyLabel = entry.faculty || "学部未設定";
      if (!currentGroup || currentFaculty !== facultyLabel) {
        currentFaculty = facultyLabel;
        currentGroup = { faculty: facultyLabel, members: [] };
        groups.push(currentGroup);
      }
      currentGroup.members.push(entry);
    });

    return groups;
  }

  /**
   * 参加者印刷プレビューを更新する
   * @param {Object} options - オプション
   * @param {boolean} options.autoPrint - 自動印刷するかどうか
   * @param {boolean} options.forceReveal - 強制的に表示するかどうか
   * @param {boolean} options.quiet - エラーメッセージを表示しないかどうか
   * @returns {Promise<boolean>} 成功したかどうか
   */
  async updateParticipantPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
    logPrintInfo("updateParticipantPrintPreview start", { autoPrint, forceReveal, quiet });
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      this.clearParticipantPrintPreviewLoader();
      if (this.dom.printPreview) {
        this.dom.printPreview.classList.remove("print-preview--fallback");
      }
      if (this.dom.printPreviewFrame) {
        this.dom.printPreviewFrame.srcdoc = "";
      }
      if (this.dom.printPreviewMeta) {
        this.dom.printPreviewMeta.textContent = "";
      }
      this.cacheParticipantPrintPreview({ forcePopupFallback: false });
      this.setPrintPreviewVisibility(true);
      this.setPrintPreviewNote("印刷するにはイベントと日程を選択してください。", {
        forceAnnounce: true,
        politeness: "assertive",
        role: "alert"
      });
      if (this.dom.printPreviewPrintButton) {
        this.dom.printPreviewPrintButton.disabled = true;
        delete this.dom.printPreviewPrintButton.dataset.popupFallback;
      }
      if (!quiet) {
        window.alert("印刷するにはイベントと日程を選択してください。");
      }
      logPrintWarn("updateParticipantPrintPreview missing selection");
      return false;
    }

    if (!Array.isArray(this.state.participants) || this.state.participants.length === 0) {
      this.clearParticipantPrintPreviewLoader();
      if (this.dom.printPreview) {
        this.dom.printPreview.classList.remove("print-preview--fallback");
      }
      if (this.dom.printPreviewFrame) {
        this.dom.printPreviewFrame.srcdoc = "";
      }
      if (this.dom.printPreviewMeta) {
        this.dom.printPreviewMeta.textContent = "";
      }
      this.cacheParticipantPrintPreview({ forcePopupFallback: false });
      this.setPrintPreviewVisibility(true);
      this.setPrintPreviewNote("印刷できる参加者がまだ登録されていません。", {
        forceAnnounce: true,
        politeness: "assertive",
        role: "alert"
      });
      if (this.dom.printPreviewPrintButton) {
        this.dom.printPreviewPrintButton.disabled = true;
        delete this.dom.printPreviewPrintButton.dataset.popupFallback;
      }
      if (!quiet) {
        window.alert("印刷できる参加者がまだ登録されていません。");
      }
      logPrintWarn("updateParticipantPrintPreview no participants");
      return false;
    }

    if (this.participantPrintInProgress) {
      logPrintWarn("updateParticipantPrintPreview already in progress");
      return false;
    }

    const button = this.dom.openPrintViewButton;
    this.participantPrintInProgress = true;

    logPrintDebug("updateParticipantPrintPreview lock engaged", { eventId, scheduleId });

    if (button) {
      button.dataset.printLocked = "true";
      if (this.syncAllPrintButtonStates) {
        this.syncAllPrintButtonStates();
      }
    }

    if (forceReveal) {
      this.setPrintPreviewVisibility(true);
    }

    const printSettings = this.readSettingsFromForm();
    this.persistSettings(printSettings);

    try {
      if (this.setPrintButtonBusy) {
        this.setPrintButtonBusy(true);
      }
      try {
        try {
          await this.loadGlDataForEvent(eventId);
        } catch (error) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[Print] GLデータの取得に失敗しました。最新の情報が反映されない場合があります。", error);
          }
          logPrintError("updateParticipantPrintPreview failed to load GL data", error);
        }

        const groups = this.buildParticipantPrintGroups({ eventId, scheduleId });
        if (!groups.length) {
          if (!quiet) {
            window.alert("印刷できる参加者がまだ登録されていません。");
          }
          return false;
        }

        const selectedEvent = this.state.events.find(evt => evt.id === eventId) || null;
        const schedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
        const eventName = selectedEvent?.name || "";
        const scheduleLabel = schedule?.label || "";
        const scheduleLocation = schedule?.location || schedule?.place || "";
        let startAt = schedule?.startAt || "";
        let endAt = schedule?.endAt || "";
        const scheduleDate = String(schedule?.date || "").trim();
        if (scheduleDate) {
          if (!startAt && schedule?.startTime) {
            startAt = combineDateAndTime(scheduleDate, schedule.startTime);
          }
          if (!endAt && schedule?.endTime) {
            endAt = combineDateAndTime(scheduleDate, schedule.endTime);
          }
        }
        const scheduleRange = formatPrintDateTimeRange(startAt, endAt);
        const totalCount = this.state.participants.length;
        const generatedAt = new Date();

        const html = buildParticipantPrintHtml({
          eventId,
          scheduleId,
          eventName,
          scheduleLabel,
          scheduleLocation,
          scheduleRange,
          groups,
          totalCount,
          generatedAt,
          printOptions: printSettings
        }, { defaultSettings: this.state.printSettings || DEFAULT_PRINT_SETTINGS });

        logPrintDebug("updateParticipantPrintPreview generated html", {
          eventId,
          scheduleId,
          totalCount,
          groupsCount: groups.length,
          printSettings
        });

        const titleParts = [eventName || eventId || "", scheduleLabel || scheduleId || ""].filter(Boolean);
        const docTitle = titleParts.length ? `${titleParts.join(" / ")} - 参加者リスト` : "参加者リスト";

        const metaText = [eventName || eventId || "", scheduleLabel || scheduleId || "", `${totalCount}名`]
          .filter(text => String(text || "").trim())
          .join(" / ");

        this.cacheParticipantPrintPreview(
          { html, title: docTitle, metaText, printSettings },
          { preserveFallbackFlag: true }
        );

        const previewRendered = this.renderParticipantPrintPreview({
          html,
          metaText,
          title: docTitle,
          autoPrint,
          printSettings
        });

        if (this.participantPrintPreviewCache.forcePopupFallback) {
          logPrintInfo("updateParticipantPrintPreview using popup fallback");
          return true;
        }

        if (!previewRendered) {
          logPrintWarn("updateParticipantPrintPreview preview render failed");
          this.renderPreviewFallbackNote(
            "プレビュー枠を開けませんでした。ポップアップ許可後に再度お試しください。",
            metaText
          );

          const fallbackOpened = this.openPopupPrintWindow(html, docTitle, printSettings);
          if (!fallbackOpened) {
            logPrintWarn("updateParticipantPrintPreview popup open failed");
            window.alert("印刷プレビューを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
            return false;
          }
        }
        logPrintInfo("updateParticipantPrintPreview succeeded");
        return true;
      } finally {
        if (this.setPrintButtonBusy) {
          this.setPrintButtonBusy(false);
        }
      }
    } finally {
      this.participantPrintInProgress = false;
      logPrintDebug("updateParticipantPrintPreview lock released");
      if (button) {
        delete button.dataset.printLocked;
      }
      if (this.syncAllPrintButtonStates) {
        this.syncAllPrintButtonStates();
      }
    }
  }

  /**
   * スタッフ印刷プレビューを更新する
   * @param {Object} options - オプション
   * @param {boolean} options.autoPrint - 自動印刷するかどうか
   * @param {boolean} options.forceReveal - 強制的に表示するかどうか
   * @param {boolean} options.quiet - エラーメッセージを表示しないかどうか
   * @returns {Promise<boolean>} 成功したかどうか
   */
  async updateStaffPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
    logPrintInfo("updateStaffPrintPreview start", { autoPrint, forceReveal, quiet });
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      this.clearParticipantPrintPreviewLoader();
      if (this.dom.printPreview) {
        this.dom.printPreview.classList.remove("print-preview--fallback");
      }
      if (this.dom.printPreviewFrame) {
        this.dom.printPreviewFrame.srcdoc = "";
      }
      if (this.dom.printPreviewMeta) {
        this.dom.printPreviewMeta.textContent = "";
      }
      this.cacheParticipantPrintPreview({ forcePopupFallback: false });
      this.setPrintPreviewVisibility(true);
      this.setPrintPreviewNote("印刷するにはイベントと日程を選択してください。", {
        forceAnnounce: true,
        politeness: "assertive"
      });
      if (!quiet) {
        window.alert("印刷するにはイベントと日程を選択してください。");
      }
      return false;
    }

    if (this.staffPrintInProgress) {
      logPrintWarn("updateStaffPrintPreview already in progress");
      return false;
    }

    const button = this.dom.openStaffPrintViewButton;
    this.staffPrintInProgress = true;

    if (button) {
      button.dataset.printLocked = "true";
      if (this.syncAllPrintButtonStates) {
        this.syncAllPrintButtonStates();
      }
    }

    if (forceReveal) {
      this.setPrintPreviewVisibility(true);
    }

    const printSettings = this.readSettingsFromForm();
    this.persistSettings(printSettings);

    try {
      if (this.setStaffPrintButtonBusy) {
        this.setStaffPrintButtonBusy(true);
      }
      try {
        await this.loadGlDataForEvent(eventId);
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[Print] スタッフデータの取得に失敗しました。最新の情報が反映されない場合があります。", error);
        }
        logPrintError("updateStaffPrintPreview failed to load GL data", error);
      }

      const groups = this.buildStaffPrintGroups({ eventId, scheduleId });
      const totalCount = groups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
      if (!totalCount) {
        if (this.dom.printPreviewPrintButton) {
          this.dom.printPreviewPrintButton.disabled = true;
          delete this.dom.printPreviewPrintButton.dataset.popupFallback;
        }
        this.setPrintPreviewVisibility(true);
        this.setPrintPreviewNote("印刷できるスタッフがまだ登録されていません。", {
          forceAnnounce: true,
          politeness: "assertive"
        });
        if (!quiet) {
          window.alert("印刷できるスタッフがまだ登録されていません。");
        }
        logPrintWarn("updateStaffPrintPreview no staff");
        return false;
      }

      const selectedEvent = this.state.events.find(evt => evt.id === eventId) || null;
      const schedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
      const eventName = selectedEvent?.name || "";
      const scheduleLabel = schedule?.label || "";
      const scheduleLocation = schedule?.location || schedule?.place || "";
      let startAt = schedule?.startAt || "";
      let endAt = schedule?.endAt || "";
      const scheduleDate = String(schedule?.date || "").trim();
      if (scheduleDate) {
        if (!startAt && schedule?.startTime) {
          startAt = combineDateAndTime(scheduleDate, schedule.startTime);
        }
        if (!endAt && schedule?.endTime) {
          endAt = combineDateAndTime(scheduleDate, schedule.endTime);
        }
      }
      const scheduleRange = formatPrintDateTimeRange(startAt, endAt);
      const generatedAt = new Date();

      const { html, docTitle, metaText } = buildStaffPrintHtml({
        eventName,
        scheduleLabel,
        scheduleLocation,
        scheduleRange,
        groups,
        totalCount,
        generatedAt,
        printOptions: printSettings
      }, { defaultSettings: this.state.printSettings || DEFAULT_PRINT_SETTINGS });

      this.cacheParticipantPrintPreview(
        { html, title: docTitle, metaText, printSettings },
        { preserveFallbackFlag: true }
      );

      const previewRendered = this.renderParticipantPrintPreview({
        html,
        metaText,
        title: docTitle,
        autoPrint,
        printSettings
      });

      if (this.participantPrintPreviewCache.forcePopupFallback) {
        logPrintInfo("updateStaffPrintPreview using popup fallback");
        return true;
      }

      if (!previewRendered) {
        logPrintWarn("updateStaffPrintPreview preview render failed");
        this.renderPreviewFallbackNote(
          "プレビュー枠を開けませんでした。ポップアップ許可後に再度お試しください。",
          metaText
        );

        const fallbackOpened = this.openPopupPrintWindow(html, docTitle, printSettings);
        if (!fallbackOpened) {
          logPrintWarn("updateStaffPrintPreview popup open failed");
          window.alert("印刷プレビューを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
          return false;
        }
      }

      logPrintInfo("updateStaffPrintPreview succeeded");
      return true;
    } finally {
      if (this.setStaffPrintButtonBusy) {
        this.setStaffPrintButtonBusy(false);
      }
      this.staffPrintInProgress = false;
      if (button) {
        delete button.dataset.printLocked;
      }
      if (this.syncAllPrintButtonStates) {
        this.syncAllPrintButtonStates();
      }
    }
  }

  /**
   * 参加者印刷ビューを開く
   * @returns {Promise<void>}
   */
  async openParticipantPrintView() {
    logPrintInfo("openParticipantPrintView start");
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      window.alert("印刷するにはイベントと日程を選択してください。");
      logPrintWarn("openParticipantPrintView missing selection");
      return;
    }

    if (!Array.isArray(this.state.participants) || this.state.participants.length === 0) {
      window.alert("印刷できる参加者がまだ登録されていません。");
      logPrintWarn("openParticipantPrintView no participants");
      return;
    }

    if (this.participantPrintInProgress) {
      logPrintWarn("openParticipantPrintView skipped: print in progress");
      return;
    }

    this.setPrintPreviewVisibility(true);
    this.applySettingsToForm(this.state.printSettings);
    logPrintInfo("openParticipantPrintView updating preview");
    await this.updateParticipantPrintPreview({ autoPrint: false, forceReveal: true });
  }

  /**
   * スタッフ印刷ビューを開く
   * @returns {Promise<void>}
   */
  async openStaffPrintView() {
    logPrintInfo("openStaffPrintView start");
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      window.alert("印刷するにはイベントと日程を選択してください。");
      logPrintWarn("openStaffPrintView missing selection");
      return;
    }

    const staffGroups = this.buildStaffPrintGroups({ eventId, scheduleId });
    const totalStaff = staffGroups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
    if (!totalStaff) {
      window.alert("印刷できるスタッフがまだ登録されていません。");
      logPrintWarn("openStaffPrintView no staff");
      return;
    }

    if (this.staffPrintInProgress) {
      logPrintWarn("openStaffPrintView skipped: print in progress");
      return;
    }

    this.setPrintPreviewVisibility(true);
    this.applySettingsToForm(this.state.printSettings);
    logPrintInfo("openStaffPrintView updating preview");
    await this.updateStaffPrintPreview({ autoPrint: false, forceReveal: true });
  }
}

