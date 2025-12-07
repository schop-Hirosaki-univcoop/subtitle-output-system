// state-manager.js: 状態管理・キャッシュ関連の機能を担当します。
export class StateManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.signatureForEntries = context.signatureForEntries;
    this.snapshotParticipantList = context.snapshotParticipantList;
    this.normalizeKey = context.normalizeKey;
    this.isEmbeddedMode = context.isEmbeddedMode;
    
    // 定数
    this.UPLOAD_STATUS_PLACEHOLDERS = context.UPLOAD_STATUS_PLACEHOLDERS;
  }

  /**
   * 参加者エントリのクローン
   * @param {Object} entry - 参加者エントリ
   * @returns {Object}
   */
  cloneParticipantEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return {};
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(entry);
      } catch (error) {
        console.warn("Failed to structuredClone participant entry, falling back to JSON", error);
      }
    }
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch (error) {
      console.warn("Failed to JSON-clone participant entry", error);
      return { ...entry };
    }
  }

  /**
   * 参加者ベースラインのキャプチャ
   * @param {Array} entries - 参加者エントリの配列
   * @param {Object} options - オプション
   * @param {boolean} options.ready - ベースライン準備完了フラグ
   */
  captureParticipantBaseline(entries = this.state.participants, options = {}) {
    const { ready = true } = options || {};
    const list = Array.isArray(entries) ? entries : [];
    this.state.savedParticipantEntries = list.map(entry => this.cloneParticipantEntry(entry));
    this.state.savedParticipants = this.snapshotParticipantList(list);
    this.state.lastSavedSignature = this.signatureForEntries(list);
    this.state.participantBaselineReady = Boolean(ready);
  }

  /**
   * 未保存変更の有無判定
   * @returns {boolean}
   */
  hasUnsavedChanges() {
    return this.signatureForEntries(this.state.participants) !== this.state.lastSavedSignature;
  }

  /**
   * アップロードステータスの設定
   * @param {string} message - ステータスメッセージ
   * @param {string} variant - バリアント（success, error等）
   */
  setUploadStatus(message, variant = "") {
    const normalized = this.normalizeKey(message);
    if (normalized && this.UPLOAD_STATUS_PLACEHOLDERS.has(normalized)) {
      message = this.getMissingSelectionStatusMessage();
    }
    this.state.lastUploadStatusMessage = message;
    this.state.lastUploadStatusVariant = variant || "";
    if (!this.dom.uploadStatus) return;
    this.dom.uploadStatus.textContent = message;
    this.dom.uploadStatus.classList.remove("status-pill--success", "status-pill--error");
    if (variant === "success") {
      this.dom.uploadStatus.classList.add("status-pill--success");
    } else if (variant === "error") {
      this.dom.uploadStatus.classList.add("status-pill--error");
    }
  }

  /**
   * プレースホルダーステータスの判定
   * @returns {boolean}
   */
  isPlaceholderUploadStatus() {
    const message = this.normalizeKey(this.state.lastUploadStatusMessage || "");
    if (!message) {
      return true;
    }
    return this.UPLOAD_STATUS_PLACEHOLDERS.has(message);
  }

  /**
   * 選択不足ステータスメッセージの取得
   * @returns {string}
   */
  getMissingSelectionStatusMessage() {
    return this.isEmbeddedMode()
      ? "イベントコントロールセンターで対象の日程を選択してください。"
      : "日程を選択してください。";
  }

  /**
   * 選択必須メッセージの取得
   * @param {string} prefix - プレフィックス
   * @returns {string}
   */
  getSelectionRequiredMessage(prefix = "") {
    const requirement = this.isEmbeddedMode()
      ? "イベントコントロールセンターで対象の日程を選択してください。"
      : "イベントと日程を選択してください。";
    if (!prefix) {
      return requirement;
    }
    return `${prefix}${requirement}`;
  }

  /**
   * 状態のリセット
   */
  resetState() {
    this.state.events = [];
    this.state.participants = [];
    this.state.selectedEventId = null;
    this.state.selectedScheduleId = null;
    this.state.savedParticipants = [];
    this.state.savedParticipantEntries = [];
    this.state.lastSavedSignature = "";
    this.state.participantBaselineReady = false;
    this.state.saving = false;
    this.state.mailSending = false;
    this.state.tokenRecords = {};
    this.state.knownTokens = new Set();
    this.state.participantTokenMap = new Map();
    this.state.eventParticipantCache = new Map();
    this.state.duplicateMatches = new Map();
    this.state.duplicateGroups = new Map();
    this.state.scheduleContextOverrides = new Map();
    this.state.scheduleLocationHistory = new Set();
    this.state.teamAssignments = new Map();
    this.state.glRoster = new Map();
    this.state.glAssignments = new Map();
    this.state.lastUploadStatusMessage = "";
    this.state.lastUploadStatusVariant = "";
    this.state.tokenSnapshotFetchedAt = 0;
    this.state.editingParticipantId = null;
    this.state.editingRowKey = null;
    this.state.selectedParticipantId = "";
    this.state.selectedParticipantRowKey = "";
    this.state.pendingRelocations = new Map();
    this.state.relocationDraftOriginals = new Map();
    this.state.relocationPromptTargets = [];
    this.state.initialSelection = null;
    this.state.initialSelectionApplied = false;
    this.state.initialSelectionNotice = null;
    this.state.initialFocusTarget = "";
    this.state.activeParticipantTab = "manage";
  }
}

