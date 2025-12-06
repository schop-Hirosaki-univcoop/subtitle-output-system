// csv-manager.js: CSV処理機能のマネージャークラス
// CSVファイルのアップロード、ダウンロード、テンプレート生成を担当します。

import { readFileAsText, parseCsv } from "../utils.js";
import {
  parseParticipantRows,
  parseTeamAssignmentRows,
  ensureTeamAssignmentMap,
  getTeamAssignmentMap,
  applyAssignmentsToEntries,
  applyAssignmentsToEventCache,
  normalizeParticipantRecord,
  assignParticipantIds,
  resolveParticipantUid,
  resolveParticipantStatus,
  sortParticipants
} from "../participants.js";
import {
  syncCurrentScheduleCache,
  updateDuplicateMatches,
  signatureForEntries
} from "../participants.js";

/**
 * CSV処理機能のマネージャークラス
 * QuestionAdminApp からCSV処理機能を分離したモジュール
 */
export class CsvManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.getSelectionIdentifiers = context.getSelectionIdentifiers;
    this.getSelectionRequiredMessage = context.getSelectionRequiredMessage;
    this.setUploadStatus = context.setUploadStatus;
    this.PARTICIPANT_TEMPLATE_HEADERS = context.PARTICIPANT_TEMPLATE_HEADERS;
    this.TEAM_TEMPLATE_HEADERS = context.TEAM_TEMPLATE_HEADERS;
    this.sortParticipants = context.sortParticipants;
    this.resolveParticipantUid = context.resolveParticipantUid;
    this.renderParticipants = context.renderParticipants;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.queueRelocationPrompt = context.queueRelocationPrompt;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * CSV値をエンコードする
   * @param {*} value - エンコードする値
   * @returns {string} エンコードされた文字列
   */
  encodeCsvValue(value) {
    if (value == null) return "";
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  /**
   * CSVコンテンツを作成する
   * @param {Array<Array<string>>} rows - CSV行の配列
   * @returns {string} CSVコンテンツ
   */
  createCsvContent(rows) {
    return rows.map(row => row.map(this.encodeCsvValue.bind(this)).join(",")).join("\r\n");
  }

  /**
   * 参加者CSVファイル名を構築する
   * @param {string} eventId - イベントID
   * @param {string} scheduleId - 日程ID
   * @returns {string} ファイル名
   */
  buildParticipantCsvFilename(eventId, scheduleId) {
    return `${eventId}_${scheduleId}_participants.csv`;
  }

  /**
   * 班番号CSVファイル名を構築する
   * @param {string} eventId - イベントID
   * @param {string} scheduleId - 日程ID
   * @returns {string} ファイル名
   */
  buildTeamCsvFilename(eventId, scheduleId) {
    return `${eventId}_${scheduleId}_teams.csv`;
  }

  /**
   * CSVファイルをダウンロードする
   * @param {string} filename - ファイル名
   * @param {Array<Array<string>>} rows - CSV行の配列
   */
  downloadCsvFile(filename, rows) {
    if (!rows || !rows.length) return;
    const content = this.createCsvContent(rows);
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf]);
    let blob;

    if (typeof TextEncoder !== "undefined") {
      const encoder = new TextEncoder();
      const body = encoder.encode(content);
      blob = new Blob([bomBytes, body], { type: "text/csv;charset=utf-8;" });
    } else {
      blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * 参加者CSVテンプレートをダウンロードする
   */
  downloadParticipantTemplate() {
    const { eventId, scheduleId } = this.getSelectionIdentifiers();
    if (!eventId || !scheduleId) {
      this.setUploadStatus(this.getSelectionRequiredMessage("参加者CSVテンプレをダウンロードするには"), "error");
      return;
    }

    const filename = this.buildParticipantCsvFilename(eventId, scheduleId);
    this.downloadCsvFile(filename, [this.PARTICIPANT_TEMPLATE_HEADERS]);
    this.setUploadStatus(`${filename} をダウンロードしました。`, "success");
  }

  /**
   * 班番号CSVテンプレートをダウンロードする
   */
  downloadTeamTemplate() {
    const { eventId, scheduleId } = this.getSelectionIdentifiers();
    if (!eventId || !scheduleId) {
      this.setUploadStatus(this.getSelectionRequiredMessage("班番号CSVテンプレをダウンロードするには"), "error");
      return;
    }

    const rows = this.sortParticipants(this.state.participants)
      .filter(entry => this.resolveParticipantUid(entry))
      .map(entry => [
        String(entry.department || ""),
        String(entry.gender || ""),
        String(entry.name || ""),
        String(entry.groupNumber || ""),
        this.resolveParticipantUid(entry)
      ]);

    if (!rows.length) {
      this.setUploadStatus("テンプレに出力できる参加者が見つかりません。参加者リストを読み込んでからお試しください。", "error");
      return;
    }

    const filename = this.buildTeamCsvFilename(eventId, scheduleId);
    this.downloadCsvFile(filename, [this.TEAM_TEMPLATE_HEADERS, ...rows]);
    this.setUploadStatus(`${filename} をダウンロードしました。（${rows.length}名）`, "success");
  }

  /**
   * 参加者CSVの変更を処理する
   * @param {Event} event - ファイル入力イベント
   */
  async handleCsvChange(event) {
    const files = event.target.files;
    if (!files || !files.length) {
      return;
    }

    const file = files[0];
    const { eventId, scheduleId } = this.getSelectionIdentifiers();

    try {
      if (!eventId || !scheduleId) {
        throw new Error(this.getSelectionRequiredMessage());
      }

      const expectedName = this.buildParticipantCsvFilename(eventId, scheduleId);
      if (file.name !== expectedName) {
        throw new Error(`ファイル名が一致しません。${expectedName} をアップロードしてください。`);
      }

      const text = await readFileAsText(file);
      const rows = parseCsv(text);
      const parsedEntries = parseParticipantRows(rows);
      const sortedEntries = parsedEntries.slice().sort((a, b) => {
        const deptA = String(a.department || "");
        const deptB = String(b.department || "");
        const deptCompare = deptA.localeCompare(deptB, "ja", { sensitivity: "base", numeric: true });
        if (deptCompare !== 0) return deptCompare;
        const phoneticA = String(a.phonetic || a.furigana || a.name || "");
        const phoneticB = String(b.phonetic || b.furigana || b.name || "");
        const phoneticCompare = phoneticA.localeCompare(phoneticB, "ja", { sensitivity: "base", numeric: true });
        if (phoneticCompare !== 0) return phoneticCompare;
        return String(a.name || "").localeCompare(String(b.name || ""), "ja", { sensitivity: "base", numeric: true });
      });
      const entries = assignParticipantIds(
        sortedEntries,
        this.state.participants,
        { eventId: this.state.selectedEventId, scheduleId: this.state.selectedScheduleId }
      );
      const existingMap = new Map(
        this.state.participants
          .map(entry => {
            const key = resolveParticipantUid(entry) || entry.participantId || entry.id;
            return key ? [key, entry] : null;
          })
          .filter(Boolean)
      );
      this.state.participants = sortParticipants(
        entries.map(entry => {
          const uid = resolveParticipantUid(entry) || entry.participantId;
          const entryKey = uid;
          const existing = entryKey ? existingMap.get(entryKey) || {} : {};
          const department = entry.department || existing.department || "";
          const groupNumber = entry.groupNumber || existing.groupNumber || "";
          const phonetic = entry.phonetic || entry.furigana || existing.phonetic || existing.furigana || "";
          const status = resolveParticipantStatus({ ...existing, ...entry, groupNumber }, groupNumber) || existing.status || "active";
          const legacyParticipantId = existing.legacyParticipantId || (existing.participantId && existing.participantId !== uid ? existing.participantId : "");
          return {
            participantId: uid,
            uid,
            legacyParticipantId,
            name: entry.name || existing.name || "",
            phonetic,
            furigana: phonetic,
            gender: entry.gender || existing.gender || "",
            department,
            groupNumber,
            phone: entry.phone || existing.phone || "",
            email: entry.email || existing.email || "",
            token: existing.token || "",
            guidance: existing.guidance || "",
            status,
            isCancelled: status === "cancelled",
            isRelocated: status === "relocated"
          };
        })
      );
      syncCurrentScheduleCache();
      updateDuplicateMatches();
      if (this.dom.fileLabel) this.dom.fileLabel.textContent = file.name;
      this.renderParticipants();
      const relocationCandidates = this.state.participants
        .filter(entry => {
          const teamValue = String(entry.groupNumber || "");
          return resolveParticipantStatus(entry, teamValue) === "relocated";
        })
        .map(entry => ({ participantId: entry.participantId || "", rowKey: entry.rowKey || "" }));
      this.queueRelocationPrompt(relocationCandidates, { replace: true });
      const signature = signatureForEntries(this.state.participants);
      if (signature === this.state.lastSavedSignature) {
        if (this.dom.saveButton) this.dom.saveButton.disabled = true;
        this.setUploadStatus("既存のデータと同じ内容です。", "success");
      } else {
        if (this.dom.saveButton) this.dom.saveButton.disabled = false;
        this.setUploadStatus(`読み込み成功: ${this.state.participants.length}名`, "success");
      }
      this.updateParticipantActionPanelState();
    } catch (error) {
      console.error(error);
      this.setUploadStatus(error.message || "CSVの読み込みに失敗しました。", "error");
    } finally {
      if (this.dom.csvInput) {
        this.dom.csvInput.value = "";
      }
    }
  }

  /**
   * 班番号CSVの変更を処理する
   * @param {Event} event - ファイル入力イベント
   */
  async handleTeamCsvChange(event) {
    const files = event.target.files;
    if (!files || !files.length) {
      return;
    }

    const file = files[0];
    const { eventId, scheduleId } = this.getSelectionIdentifiers();

    try {
      if (!eventId || !scheduleId) {
        throw new Error(this.getSelectionRequiredMessage());
      }

      const expectedName = this.buildTeamCsvFilename(eventId, scheduleId);
      if (file.name !== expectedName) {
        throw new Error(`ファイル名が一致しません。${expectedName} をアップロードしてください。`);
      }

      const text = await readFileAsText(file);
      const rows = parseCsv(text);
      const assignments = parseTeamAssignmentRows(rows);
      const eventAssignmentMap = ensureTeamAssignmentMap(eventId);
      const currentMapMatches = applyAssignmentsToEntries(this.state.participants, assignments);

      assignments.forEach((groupNumber, participantId) => {
        if (eventAssignmentMap) {
          eventAssignmentMap.set(participantId, groupNumber);
        }
      });

      const aggregateMap = eventAssignmentMap || assignments;
      const applyResult = applyAssignmentsToEntries(this.state.participants, aggregateMap);
      this.state.participants = sortParticipants(applyResult.entries);
      syncCurrentScheduleCache();
      const cacheMatched = applyAssignmentsToEventCache(eventId, aggregateMap);
      updateDuplicateMatches();
      this.renderParticipants();
      this.syncSaveButtonState();

      if (this.dom.teamFileLabel) {
        this.dom.teamFileLabel.textContent = file.name;
      }

      const matchedIds = currentMapMatches.matchedIds || new Set();
      const updatedIds = currentMapMatches.updatedIds || new Set();
      const allMatched = new Set([...(matchedIds || []), ...(cacheMatched || [])]);
      const unmatchedCount = Math.max(assignments.size - allMatched.size, 0);
      const summaryParts = [];
      summaryParts.push(`班番号を照合: ${allMatched.size}名`);
      summaryParts.push(`変更: ${updatedIds.size}件`);
      if (unmatchedCount > 0) {
        summaryParts.push(`未一致: ${unmatchedCount}名`);
      }
      this.setUploadStatus(summaryParts.join(" / "), "success");
    } catch (error) {
      console.error(error);
      this.setUploadStatus(error.message || "班番号CSVの読み込みに失敗しました。", "error");
    } finally {
      if (this.dom.teamCsvInput) {
        this.dom.teamCsvInput.value = "";
      }
    }
  }
}

