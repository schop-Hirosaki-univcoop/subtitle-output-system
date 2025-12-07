// firebase-manager.js: イベント管理画面のFirebase操作を担当します。
// オペレータープレゼンス、スケジュールコンセンサス、ホストプレゼンスなどのFirebase操作を管理します。

import {
  get,
  set,
  update,
  remove,
  onValue,
  serverTimestamp,
  onDisconnect,
  getOperatorPresenceEventRef,
  getOperatorPresenceEntryRef,
  getOperatorScheduleConsensusRef,
  runTransaction,
  auth
} from "../../operator/firebase.js";
import { ensureString, logError } from "../helpers.js";
import { normalizeScheduleId } from "../../shared/channel-paths.js";
import { derivePresenceScheduleKey as sharedDerivePresenceScheduleKey } from "../../shared/presence-keys.js";
import { normalizeOperatorMode, OPERATOR_MODE_SUPPORT } from "../../shared/operator-modes.js";
import { formatScheduleRange } from "../../operator/utils.js";
import { generateShortId } from "../../question-admin/utils.js";

const HOST_PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * Firebase操作クラス
 * EventAdminApp からFirebase操作機能を分離したモジュール
 */
export class EventFirebaseManager {
  constructor(app) {
    this.app = app;
    
    // オペレータープレゼンス関連のプロパティ
    this.operatorPresenceEventId = "";
    this.operatorPresenceUnsubscribe = null;
    this.operatorPresenceEntries = [];
    
    // スケジュールコンセンサス関連のプロパティ
    this.scheduleConsensusEventId = "";
    this.scheduleConsensusUnsubscribe = null;
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    
    // ホストプレゼンス関連のプロパティ
    this.hostPresenceSessionId = this.generatePresenceSessionId();
    this.hostPresenceEntryKey = "";
    this.hostPresenceEntryRef = null;
    this.hostPresenceDisconnect = null;
    this.hostPresenceHeartbeat = null;
    this.hostPresenceLastSignature = "";
    
    // ストレージキャッシュ
    this.cachedHostPresenceStorage = undefined;
  }

  /**
   * プレゼンスセッションIDを生成します。
   */
  generatePresenceSessionId() {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      if (crypto.getRandomValues && typeof Uint8Array !== "undefined") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
    }
    return generateShortId("presence-");
  }

  /**
   * スケジュールIDまたはエイリアスでスケジュールを検索します。
   */
  findScheduleByIdOrAlias(scheduleId = "") {
    const normalized = ensureString(scheduleId);
    if (!normalized) {
      return null;
    }
    const directMatch = this.app.schedules.find((schedule) => schedule.id === normalized) || null;
    if (directMatch) {
      return directMatch;
    }
    const normalizedCandidate = normalizeScheduleId(normalized);
    if (!normalizedCandidate) {
      return null;
    }
    return (
      this.app.schedules.find((schedule) => normalizeScheduleId(schedule.id) === normalizedCandidate) || null
    );
  }

  /**
   * スケジュールキーからスケジュールIDを抽出します。
   */
  extractScheduleIdFromKey(scheduleKey, eventId = "") {
    const key = ensureString(scheduleKey);
    if (!key) {
      return "";
    }
    const normalizedEvent = ensureString(eventId) || ensureString(this.app.selectedEventId);
    let working = key;
    if (normalizedEvent && working.startsWith(`${normalizedEvent}::`)) {
      working = working.slice(normalizedEvent.length + 2);
    }
    if (!working) {
      return "";
    }
    const [firstPart] = working.split("::");
    if (!firstPart || firstPart === "label" || firstPart === "session") {
      return "";
    }
    const normalizedCandidate = normalizeScheduleId(firstPart);
    const candidates = [firstPart];
    if (normalizedCandidate && normalizedCandidate !== firstPart) {
      candidates.push(normalizedCandidate);
    }
    const match = this.app.schedules.find((schedule) => {
      if (!schedule || !schedule.id) {
        return false;
      }
      if (candidates.includes(schedule.id)) {
        return true;
      }
      const normalizedId = normalizeScheduleId(schedule.id);
      return Boolean(normalizedId) && candidates.includes(normalizedId);
    });
    return match ? match.id : "";
  }

  /**
   * プレゼンススケジュールキーを導出します。
   */
  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
    return sharedDerivePresenceScheduleKey(eventId, payload, entryId);
  }

  /**
   * プレゼンスエントリからスケジュールを解決します。
   */
  resolveScheduleFromPresenceEntry(entry = null) {
    if (!entry || typeof entry !== "object") {
      return { scheduleId: "", schedule: null };
    }
    const direct = this.findScheduleByIdOrAlias(entry.scheduleId);
    if (direct) {
      return { scheduleId: direct.id, schedule: direct };
    }
    const derivedId = this.extractScheduleIdFromKey(entry.scheduleKey, this.app.selectedEventId);
    const derived = this.findScheduleByIdOrAlias(derivedId);
    if (derived) {
      return { scheduleId: derived.id, schedule: derived };
    }
    const label = ensureString(entry.scheduleLabel);
    if (label) {
      const labelMatch = this.app.schedules.find((schedule) => ensureString(schedule.label) === label) || null;
      if (labelMatch) {
        return { scheduleId: labelMatch.id, schedule: labelMatch };
      }
    }
    const fallbackId = ensureString(entry.scheduleId) || ensureString(derivedId);
    return { scheduleId: fallbackId, schedule: null };
  }

  /**
   * プレゼンスソースの優先度を取得します。
   */
  getPresenceSourcePriority(entry = null) {
    const source = ensureString(entry?.source).toLowerCase();
    if (!source) {
      return 0;
    }
    if (source.includes("operator")) {
      return 3;
    }
    if (source === "events") {
      return 2;
    }
    return 1;
  }

  /**
   * プレゼンスから割り当てられたスケジュールを取得します。
   */
  getAssignedScheduleFromPresence() {
    const uid = ensureString(this.app.currentUser?.uid);
    if (!uid) {
      return null;
    }
    const entries = Array.isArray(this.operatorPresenceEntries) ? this.operatorPresenceEntries : [];
    if (!entries.length) {
      return null;
    }
    const matches = entries.filter((entry) => ensureString(entry?.uid) === uid);
    if (!matches.length) {
      return null;
    }
    const evaluated = matches.map((entry) => {
      const { scheduleId, schedule } = this.resolveScheduleFromPresenceEntry(entry);
      return {
        entry,
        scheduleId,
        schedule,
        hasSchedule: Boolean(scheduleId),
        priority: this.getPresenceSourcePriority(entry),
        updatedAt: Number(entry?.updatedAt || 0) || 0
      };
    });
    const pool = evaluated.some((item) => item.hasSchedule)
      ? evaluated.filter((item) => item.hasSchedule)
      : evaluated;
    if (!pool.length) {
      return null;
    }
    pool.sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      const aId = ensureString(a.entry?.entryId);
      const bId = ensureString(b.entry?.entryId);
      return aId.localeCompare(bId, "ja");
    });
    const best = pool[0];
    if (!best) {
      return null;
    }
    return { entry: best.entry, scheduleId: best.scheduleId, schedule: best.schedule };
  }

  /**
   * ホストスケジュールコンテキストを解決します。
   */
  resolveHostScheduleContext(eventId = "", { scheduleMap = null } = {}) {
    const normalizedEventId = ensureString(eventId) || ensureString(this.app.selectedEventId);
    const map =
      scheduleMap instanceof Map
        ? scheduleMap
        : new Map(this.app.schedules.map((schedule) => [schedule.id, schedule]));
    const selectedScheduleId = ensureString(this.app.selectedScheduleId);
    const committedScheduleId = ensureString(this.app.hostCommittedScheduleId);
    const pendingNavigationTarget = ensureString(this.app.pendingNavigationTarget);
    let resolvedScheduleId = "";
    if (this.app.scheduleSelectionCommitted) {
      resolvedScheduleId = selectedScheduleId || committedScheduleId;
    } else if (pendingNavigationTarget && selectedScheduleId) {
      resolvedScheduleId = selectedScheduleId;
    }
    if (!resolvedScheduleId && committedScheduleId) {
      resolvedScheduleId = committedScheduleId;
    }
    const schedule = resolvedScheduleId ? map.get(resolvedScheduleId) || null : null;
    let scheduleLabel = "";
    if (resolvedScheduleId) {
      if (resolvedScheduleId === committedScheduleId) {
        scheduleLabel = ensureString(this.app.hostCommittedScheduleLabel);
      }
      if (!scheduleLabel) {
        scheduleLabel = ensureString(schedule?.label) || resolvedScheduleId;
      }
    }
    const selectedSchedule = selectedScheduleId ? map.get(selectedScheduleId) || null : null;
    const selectedScheduleLabel = selectedSchedule
      ? ensureString(selectedSchedule.label) || selectedScheduleId
      : selectedScheduleId;
    const scheduleRange = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
    const scheduleLocation = schedule ? ensureString(schedule.location) : "";
    const scheduleKey = resolvedScheduleId
      ? this.derivePresenceScheduleKey(
          normalizedEventId,
          { scheduleId: resolvedScheduleId, scheduleLabel },
          this.hostPresenceSessionId
        )
      : "";
    return {
      eventId: normalizedEventId,
      scheduleId: resolvedScheduleId,
      scheduleLabel,
      scheduleRange,
      location: scheduleLocation,
      scheduleKey,
      schedule,
      committedScheduleId,
      selectedScheduleId,
      selectedScheduleLabel
    };
  }

  /**
   * ホストプレゼンスストレージを取得します。
   */
  getHostPresenceStorage() {
    if (typeof this.cachedHostPresenceStorage !== "undefined") {
      return this.cachedHostPresenceStorage;
    }
    if (typeof window === "undefined") {
      this.cachedHostPresenceStorage = null;
      return null;
    }
    const candidates = [window.sessionStorage, window.localStorage];
    for (const storage of candidates) {
      if (!storage) {
        continue;
      }
      try {
        const probeKey = "__events_host_presence_probe__";
        storage.setItem(probeKey, "1");
        storage.removeItem(probeKey);
        this.cachedHostPresenceStorage = storage;
        return storage;
      } catch (error) {
        // Ignore storage access errors and continue checking fallbacks.
      }
    }
    this.cachedHostPresenceStorage = null;
    return null;
  }

  /**
   * ホストプレゼンスストレージキーを取得します。
   */
  getHostPresenceStorageKey(uid = "", eventId = "") {
    const normalizedUid = ensureString(uid);
    const normalizedEventId = ensureString(eventId);
    if (!normalizedUid || !normalizedEventId) {
      return "";
    }
    return `events:host-presence:${normalizedUid}:${normalizedEventId}`;
  }

  /**
   * 保存されたホストプレゼンスセッションIDを読み込みます。
   */
  loadStoredHostPresenceSessionId(uid = "", eventId = "") {
    const storage = this.getHostPresenceStorage();
    const key = this.getHostPresenceStorageKey(uid, eventId);
    if (!storage || !key) {
      return "";
    }
    try {
      return ensureString(storage.getItem(key));
    } catch (error) {
      return "";
    }
  }

  /**
   * ホストプレゼンスセッションIDを永続化します。
   */
  persistHostPresenceSessionId(uid = "", eventId = "", sessionId = "") {
    const storage = this.getHostPresenceStorage();
    const key = this.getHostPresenceStorageKey(uid, eventId);
    const normalizedSessionId = ensureString(sessionId);
    if (!storage || !key || !normalizedSessionId) {
      return;
    }
    try {
      storage.setItem(key, normalizedSessionId);
    } catch (error) {
      // Ignore storage persistence failures.
    }
  }

  /**
   * ローカルホストプレゼンスエントリを収集します。
   */
  collectLocalHostPresenceEntries(presenceEntries = [], uid = "") {
    const normalizedUid = ensureString(uid);
    if (!normalizedUid || !Array.isArray(presenceEntries)) {
      return [];
    }
    return presenceEntries
      .filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const entryUid = ensureString(entry.uid);
        if (!entryUid || entryUid !== normalizedUid) {
          return false;
        }
        const source = ensureString(entry.source);
        return !source || source === "events";
      })
      .map((entry) => ({
        entryId: ensureString(entry.entryId),
        sessionId: ensureString(entry.sessionId || entry.entryId),
        source: ensureString(entry.source),
        updatedAt: Number(entry.updatedAt || 0) || 0
      }));
  }

  /**
   * ホストプレゼンスエントリを取得します。
   */
  async fetchHostPresenceEntries(eventId = "", uid = "") {
    const normalizedEventId = ensureString(eventId);
    const normalizedUid = ensureString(uid);
    if (!normalizedEventId || !normalizedUid) {
      return [];
    }
    try {
      const snapshot = await get(getOperatorPresenceEventRef(normalizedEventId));
      const raw = snapshot.exists() ? snapshot.val() : {};
      if (!raw || typeof raw !== "object") {
        return [];
      }
      const entries = [];
      Object.entries(raw).forEach(([entryId, payload]) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const entryUid = ensureString(payload.uid);
        if (!entryUid || entryUid !== normalizedUid) {
          return;
        }
        const source = ensureString(payload.source);
        if (source && source !== "events") {
          return;
        }
        const normalizedEntryId = ensureString(entryId);
        const sessionId = ensureString(payload.sessionId) || normalizedEntryId;
        if (!sessionId) {
          return;
        }
        const updatedAt = Number(payload.clientTimestamp || payload.updatedAt || 0) || 0;
        entries.push({
          entryId: normalizedEntryId,
          sessionId,
          source,
          updatedAt
        });
      });
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return entries;
    } catch (error) {
      console.debug("Failed to fetch host presence entries:", error);
      return [];
    }
  }

  /**
   * 古いホストプレゼンスエントリを削除します。
   */
  pruneHostPresenceEntries(eventId = "", entries = [], sessionId = "") {
    const normalizedEventId = ensureString(eventId);
    if (!normalizedEventId || !Array.isArray(entries) || entries.length === 0) {
      return;
    }
    const keepSessionId = ensureString(sessionId);
    entries.forEach((entry) => {
      const entrySessionId = ensureString(entry?.sessionId || entry?.entryId);
      if (!entrySessionId || entrySessionId === keepSessionId) {
        return;
      }
      try {
        remove(getOperatorPresenceEntryRef(normalizedEventId, entrySessionId)).catch(() => {});
      } catch (error) {
        console.debug("Failed to remove stale host presence entry:", error);
      }
    });
  }

  /**
   * ホストプレゼンスセッションを調整します。
   */
  async reconcileHostPresenceSessions(eventId = "", uid = "", sessionId = "", prefetchedEntries = null) {
    const normalizedEventId = ensureString(eventId);
    const normalizedUid = ensureString(uid);
    if (!normalizedEventId || !normalizedUid) {
      return;
    }
    let entries = Array.isArray(prefetchedEntries) ? prefetchedEntries.slice() : null;
    if (!entries || entries.length === 0) {
      entries = await this.fetchHostPresenceEntries(normalizedEventId, normalizedUid);
    }
    if (!entries || entries.length === 0) {
      return;
    }
    const keepSessionId = ensureString(sessionId);
    let preferredEntry = null;
    if (keepSessionId) {
      preferredEntry = entries.find((entry) => ensureString(entry.sessionId || entry.entryId) === keepSessionId) || null;
    }
    if (!preferredEntry) {
      preferredEntry = entries[0] || null;
    }
    const preferredSessionId = ensureString(preferredEntry?.sessionId || preferredEntry?.entryId);
    if (!preferredSessionId) {
      return;
    }
    const targetSessionId = keepSessionId && preferredSessionId === keepSessionId ? keepSessionId : preferredSessionId;
    if (ensureString(this.hostPresenceSessionId) !== targetSessionId) {
      this.hostPresenceSessionId = targetSessionId;
      this.persistHostPresenceSessionId(normalizedUid, normalizedEventId, targetSessionId);
    }
    this.hostPresenceEntryKey = `${normalizedEventId}/${targetSessionId}`;
    this.hostPresenceEntryRef = getOperatorPresenceEntryRef(normalizedEventId, targetSessionId);
    const staleEntries = entries.filter((entry) => {
      const entrySessionId = ensureString(entry.sessionId || entry.entryId);
      return entrySessionId && entrySessionId !== targetSessionId;
    });
    this.pruneHostPresenceEntries(normalizedEventId, staleEntries, targetSessionId);
  }

  /**
   * ホストプレゼンスハートビートをスケジュールします。
   */
  scheduleHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      return;
    }
    this.hostPresenceHeartbeat = setInterval(
      () => this.touchHostPresence(),
      HOST_PRESENCE_HEARTBEAT_MS
    );
  }

  /**
   * ホストプレゼンスを更新します。
   */
  touchHostPresence() {
    if (!this.hostPresenceEntryRef || !this.hostPresenceEntryKey) {
      this.stopHostPresenceHeartbeat();
      return;
    }
    const now = Date.now();
    update(this.hostPresenceEntryRef, {
      clientTimestamp: now
    }).catch((error) => {
      console.debug("Host presence heartbeat failed:", error);
    });
  }

  /**
   * ホストプレゼンスハートビートを停止します。
   */
  stopHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      clearInterval(this.hostPresenceHeartbeat);
      this.hostPresenceHeartbeat = null;
    }
  }

  /**
   * ホストプレゼンスをクリアします。
   */
  clearHostPresence() {
    this.stopHostPresenceHeartbeat();
    this.hostPresenceLastSignature = "";
    const disconnectHandle = this.hostPresenceDisconnect;
    this.hostPresenceDisconnect = null;
    if (disconnectHandle && typeof disconnectHandle.cancel === "function") {
      disconnectHandle.cancel().catch(() => {});
    }
    const entryRef = this.hostPresenceEntryRef;
    this.hostPresenceEntryRef = null;
    const hadKey = !!this.hostPresenceEntryKey;
    const entryKey = ensureString(this.hostPresenceEntryKey);
    this.hostPresenceEntryKey = "";
    if (entryRef && hadKey) {
      remove(entryRef).catch((error) => {
        console.debug("Failed to clear host presence:", error);
      });
    }
  }

  /**
   * オペレータープレゼンスの購読を同期します。
   */
  syncOperatorPresenceSubscription() {
    const eventId = ensureString(this.app.selectedEventId);
    if (this.operatorPresenceEventId === eventId) {
      this.app.updateScheduleConflictState();
      return;
    }
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.operatorPresenceEventId = "";
    this.operatorPresenceEntries = [];
    if (!eventId) {
      this.app.updateScheduleConflictState();
      return;
    }
    try {
      const ref = getOperatorPresenceEventRef(eventId);
      this.operatorPresenceUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : {};
          this.operatorPresenceEntries = this.normalizeOperatorPresenceEntries(raw, eventId);
          this.app.updateScheduleConflictState();
        },
        (error) => {
          console.error("Failed to monitor operator presence:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe operator presence:", error);
      this.operatorPresenceUnsubscribe = null;
    }
    this.app.updateScheduleConflictState();
  }

  /**
   * オペレータープレゼンスエントリを正規化します。
   */
  normalizeOperatorPresenceEntries(raw = {}, eventId = "") {
    const entries = [];
    if (!raw || typeof raw !== "object") {
      return entries;
    }
    const selfUid = ensureString(this.app.currentUser?.uid);
    Object.entries(raw).forEach(([entryId, payload]) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const normalizedId = ensureString(entryId) || generateShortId("presence-");
      const scheduleKey = this.buildPresenceScheduleKey(eventId, payload, normalizedId);
      const scheduleId = ensureString(payload.scheduleId) || ensureString(payload.selectedScheduleId);
      let scheduleLabel = "";
      if (scheduleId && Array.isArray(this.app.schedules)) {
        const schedule = this.app.schedules.find((s) => ensureString(s?.id) === scheduleId);
        if (schedule) {
          scheduleLabel = ensureString(schedule.label || "");
        }
      }
      if (!scheduleLabel) {
        scheduleLabel = ensureString(payload.scheduleLabel) || ensureString(payload.selectedScheduleLabel) || "";
      }
      const displayName = ensureString(payload.displayName) || ensureString(payload.email) || ensureString(payload.uid) || normalizedId;
      const uid = ensureString(payload.uid);
      const mode = normalizeOperatorMode(payload.mode);
      const skipTelop = payload.skipTelop === true || mode === OPERATOR_MODE_SUPPORT;
      const updatedAt = Number(payload.clientTimestamp || payload.updatedAt || 0) || 0;
      const sessionId = ensureString(payload.sessionId) || normalizedId;
      const source = ensureString(payload.source);
      entries.push({
        entryId: normalizedId,
        sessionId,
        source,
        uid,
        displayName,
        scheduleId,
        scheduleLabel,
        scheduleKey,
        selectedScheduleId: ensureString(payload.selectedScheduleId),
        selectedScheduleLabel: ensureString(payload.selectedScheduleLabel),
        mode,
        skipTelop,
        updatedAt,
        isSelf: Boolean(selfUid && uid && uid === selfUid)
      });
    });
    entries.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
    return entries;
  }

  /**
   * プレゼンススケジュールキーを構築します。
   */
  buildPresenceScheduleKey(eventId, payload = {}, entryId = "") {
    return this.derivePresenceScheduleKey(eventId, payload, entryId);
  }

  /**
   * スケジュールコンセンサスの購読を同期します。
   */
  syncScheduleConsensusSubscription() {
    const eventId = ensureString(this.app.selectedEventId);
    if (this.scheduleConsensusEventId === eventId) {
      return;
    }
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = eventId;
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    if (!eventId) {
      return;
    }
    try {
      const ref = getOperatorScheduleConsensusRef(eventId);
      this.scheduleConsensusUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : null;
          const consensus = this.normalizeScheduleConsensus(raw);
          this.scheduleConsensusState = consensus;
          this.app.handleScheduleConsensusUpdate(eventId, consensus);
        },
        (error) => {
          console.error("Failed to monitor schedule consensus:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe schedule consensus:", error);
      this.scheduleConsensusUnsubscribe = null;
    }
  }

  /**
   * スケジュールコンセンサスを正規化します。
   */
  normalizeScheduleConsensus(raw = null) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      conflictSignature: ensureString(raw.conflictSignature),
      scheduleKey: ensureString(raw.scheduleKey),
      scheduleId: ensureString(raw.scheduleId),
      scheduleLabel: ensureString(raw.scheduleLabel),
      scheduleRange: ensureString(raw.scheduleRange),
      status: ensureString(raw.status),
      requestedByUid: ensureString(raw.requestedByUid),
      requestedByDisplayName: ensureString(raw.requestedByDisplayName),
      requestedBySessionId: ensureString(raw.requestedBySessionId),
      resolvedByUid: ensureString(raw.resolvedByUid),
      resolvedByDisplayName: ensureString(raw.resolvedByDisplayName),
      resolvedBySessionId: ensureString(raw.resolvedBySessionId),
      updatedAt: Number(raw.updatedAt || raw.clientTimestamp || 0) || 0
    };
  }

  /**
   * スケジュールコンセンサス状態をクリアします。
   */
  clearScheduleConsensusState({ reason = "" } = {}) {
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = "";
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    if (reason) {
      this.app.logFlowState("スケジュール合意情報をリセットしました", { reason });
    }
  }

  /**
   * オペレータープレゼンス状態をクリアします。
   */
  clearOperatorPresenceState() {
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.clearHostPresence();
    this.operatorPresenceEventId = "";
    this.operatorPresenceEntries = [];
  }

  /**
   * クリーンアップ処理を行います。
   */
  cleanup() {
    this.clearOperatorPresenceState();
    this.clearScheduleConsensusState({ reason: "cleanup" });
  }

  /**
   * オペレータープレゼンスエントリを処理して、スケジュールコンフリクト用のエントリリストを構築します。
   * @param {string} eventId - イベントID
   * @param {Map<string, Object>} scheduleMap - スケジュールマップ
   * @param {string} selfUid - 現在のユーザーのUID
   * @returns {{ entries: Array, hasSelfPresence: boolean }} - 処理されたエントリと自己プレゼンスの有無
   */
  buildPresenceEntries(eventId = "", scheduleMap = null, selfUid = "") {
    const normalizedEventId = ensureString(eventId);
    const normalizedSelfUid = ensureString(selfUid);
    const map = scheduleMap instanceof Map ? scheduleMap : new Map();
    const entries = [];
    let hasSelfPresence = false;

    this.operatorPresenceEntries.forEach((entry) => {
      const baseScheduleId = ensureString(entry.scheduleId);
      const scheduleFromMap = baseScheduleId ? map.get(baseScheduleId) : null;
      const derivedFromKey = this.extractScheduleIdFromKey(entry.scheduleKey, normalizedEventId);
      const resolvedScheduleId = ensureString(scheduleFromMap?.id || baseScheduleId || derivedFromKey);
      const schedule = resolvedScheduleId ? map.get(resolvedScheduleId) || scheduleFromMap : scheduleFromMap;
      const normalizedMode = normalizeOperatorMode(entry.mode);
      const skipTelop = entry.skipTelop === true || normalizedMode === OPERATOR_MODE_SUPPORT;
      const isSelf = Boolean(entry.isSelf || (normalizedSelfUid && entry.uid && entry.uid === normalizedSelfUid));
      
      if (isSelf) {
        hasSelfPresence = true;
      }
      
      const scheduleLabel = schedule?.label || entry.scheduleLabel || resolvedScheduleId || "未選択";
      const scheduleRange = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
      const scheduleKey = ensureString(
        entry.scheduleKey ||
          (resolvedScheduleId
            ? this.derivePresenceScheduleKey(
                normalizedEventId,
                { scheduleId: resolvedScheduleId, scheduleLabel },
                ensureString(entry.entryId)
              )
            : "")
      );
      
      entries.push({
        entryId: entry.entryId,
        uid: entry.uid,
        displayName: entry.displayName || entry.uid || entry.entryId,
        scheduleId: resolvedScheduleId,
        scheduleKey,
        scheduleLabel,
        scheduleRange,
        isSelf,
        mode: normalizedMode,
        skipTelop,
        updatedAt: entry.updatedAt || 0
      });
    });

    return { entries, hasSelfPresence };
  }

  /**
   * スケジュール合意を確定します。
   * @param {Object} selection - 選択情報（scheduleId, scheduleKey, option, context）
   * @returns {Promise<boolean>} 確定が成功したかどうか
   */
  async confirmScheduleConsensus(selection) {
    const eventId = ensureString(this.app.selectedEventId);
    if (!eventId) {
      this.app.setScheduleConflictError("イベントが選択されていません。イベントを選択し直してください。");
      return false;
    }
    const context = selection?.context || this.app.scheduleConflictContext || this.app.buildScheduleConflictContext();
    const signature = ensureString(context?.signature);
    if (!signature) {
      this.app.setScheduleConflictError("現在の選択状況を確認できませんでした。再度お試しください。");
      return false;
    }
    let scheduleId = ensureString(selection?.scheduleId);
    const scheduleKey = ensureString(selection?.scheduleKey);
    if (!scheduleKey) {
      this.app.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    if (!scheduleId) {
      scheduleId = this.extractScheduleIdFromKey(scheduleKey, eventId);
    }
    if (!scheduleId) {
      this.app.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    const scheduleMatch = this.app.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.app.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return false;
    }
    scheduleId = scheduleMatch.id;
    const user = this.app.currentUser || auth.currentUser || null;
    const resolvedByUid = ensureString(user?.uid);
    if (!resolvedByUid) {
      this.app.setScheduleConflictError("ログイン状態を確認できませんでした。ページを再読み込みしてください。");
      return false;
    }
    const resolvedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || resolvedByUid;
    const resolvedBySessionId = ensureString(this.hostPresenceSessionId);
    const option = selection?.option || null;
    const fallbackSchedule = this.app.schedules.find((schedule) => schedule.id === scheduleId) || null;
    const scheduleLabel =
      ensureString(option?.scheduleLabel) || ensureString(fallbackSchedule?.label) || scheduleId;
    let scheduleRange = ensureString(option?.scheduleRange);
    if (!scheduleRange && fallbackSchedule) {
      scheduleRange = formatScheduleRange(fallbackSchedule.startAt, fallbackSchedule.endAt);
    }
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature && currentSignature !== signature) {
            return current;
          }
          if (currentSignature === signature && currentKey) {
            return current;
          }
          const next = {
            ...current,
            conflictSignature: signature,
            scheduleKey,
            scheduleId,
            scheduleLabel,
            scheduleRange,
            resolvedByUid,
            resolvedByDisplayName,
            resolvedBySessionId,
            resolvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "resolved"
          };
          return next;
        }
        return {
          conflictSignature: signature,
          scheduleKey,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          resolvedByUid,
          resolvedByDisplayName,
          resolvedBySessionId,
          resolvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          status: "resolved"
        };
      });
      if (!result.committed) {
        this.app.setScheduleConflictError("別のオペレーターが日程を確定しました。最新の状態に更新しています…");
        return false;
      }
      this.app.clearScheduleConflictError();
      this.app.logFlowState("スケジュール合意の書き込みが完了しました", {
        eventId,
        scheduleId,
        scheduleKey,
        conflictSignature: signature
      });
      const scheduleForCommit = fallbackSchedule || scheduleMatch || null;
      this.app.setHostCommittedSchedule(scheduleId, {
        schedule: scheduleForCommit,
        reason: "consensus-submit",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.app.scheduleSelectionCommitted = true;
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[confirmScheduleConsensus] Set scheduleSelectionCommitted to true", {
          scheduleId,
          eventId,
          hostCommittedScheduleId: ensureString(this.app.hostCommittedScheduleId) || "(empty)"
        });
      }
      this.app.tools.prepareContextForSelection();
      if (
        this.app.tools.isPendingSync() ||
        this.app.activePanel === "participants" ||
        this.app.activePanel === "operator"
      ) {
        this.app.tools
          .syncEmbeddedTools({ reason: "consensus-submit" })
          .catch((error) => logError("Failed to sync tools after schedule consensus", error));
      } else {
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[confirmScheduleConsensus] About to sync operator context", {
            eventId,
            scheduleId,
            scheduleSelectionCommitted: this.app.scheduleSelectionCommitted,
            hostCommittedScheduleId: ensureString(this.app.hostCommittedScheduleId) || "(empty)",
            activePanel: this.app.activePanel
          });
        }
        this.app.tools
          .syncOperatorContext({ force: true, reason: "consensus-submit" })
          .catch((error) => logError("Failed to sync operator context after schedule consensus", error));
      }
      return true;
    } catch (error) {
      console.error("Failed to confirm schedule consensus:", error);
      this.app.setScheduleConflictError("日程の確定に失敗しました。通信環境を確認して再度お試しください。");
      return false;
    }
  }

  /**
   * スケジュールコンフリクトプロンプトを要求します。
   * @param {Object} context - スケジュールコンフリクトコンテキスト（オプション）
   * @returns {Promise<boolean>} 要求が成功したかどうか
   */
  async requestScheduleConflictPrompt(context = null) {
    const eventId = ensureString(this.app.selectedEventId);
    if (!eventId) {
      return false;
    }
    const resolvedContext = context || this.app.scheduleConflictContext || this.app.buildScheduleConflictContext();
    const signature = ensureString(resolvedContext?.signature);
    if (!resolvedContext?.hasConflict || !signature) {
      return false;
    }
    if (this.app.scheduleConflictPromptSignature === signature) {
      return true;
    }
    const consensus = this.scheduleConsensusState;
    if (consensus && ensureString(consensus.conflictSignature) === signature) {
      const existingKey = ensureString(consensus.scheduleKey);
      if (!existingKey) {
        this.app.scheduleConflictPromptSignature = signature;
      }
      return true;
    }
    const user = this.app.currentUser || auth.currentUser || null;
    const requestedByUid = ensureString(user?.uid);
    if (!requestedByUid) {
      return false;
    }
    const requestedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || requestedByUid;
    const requestedBySessionId = ensureString(this.hostPresenceSessionId);
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature === signature) {
            if (!currentKey) {
              return {
                ...current,
                requestedByUid: requestedByUid || current.requestedByUid || "",
                requestedByDisplayName:
                  requestedByDisplayName || current.requestedByDisplayName || "",
                requestedBySessionId:
                  requestedBySessionId || current.requestedBySessionId || "",
                requestedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: ensureString(current.status) || "pending"
              };
            }
            return current;
          }
        }
        return {
          conflictSignature: signature,
          scheduleKey: "",
          scheduleId: "",
          scheduleLabel: "",
          scheduleRange: "",
          requestedByUid,
          requestedByDisplayName,
          requestedBySessionId,
          requestedAt: serverTimestamp(),
          status: "pending",
          updatedAt: serverTimestamp()
        };
      });
      if (result.committed) {
        this.app.scheduleConflictPromptSignature = signature;
        this.app.logFlowState("スケジュール合意の確認を要求しました", {
          eventId,
          conflictSignature: signature,
          requestedByUid,
          requestedBySessionId
        });
        this.app.uiRenderer.syncScheduleConflictPromptState(resolvedContext);
      }
      return result.committed;
    } catch (error) {
      console.debug("Failed to request schedule consensus prompt:", error);
      return false;
    }
  }

  /**
   * ホストコミット済みスケジュールを設定します。
   * Firebase関連の処理（プレゼンス同期など）を担当します。
   * @param {string} scheduleId - スケジュールID
   * @param {Object} options - オプション
   * @param {Object} options.schedule - スケジュールオブジェクト（オプション）
   * @param {string} options.reason - 変更理由（デフォルト: "state-change"）
   * @param {boolean} options.sync - プレゼンスを同期するか（デフォルト: true）
   * @param {boolean} options.force - 強制更新フラグ（デフォルト: false）
   * @returns {boolean} 変更があったかどうか
   */
  setHostCommittedSchedule(
    scheduleId,
    {
      schedule = null,
      reason = "state-change",
      sync = true,
      force = false
    } = {}
  ) {
    const normalizedId = ensureString(scheduleId);
    let resolvedSchedule = schedule;
    if (normalizedId && (!resolvedSchedule || resolvedSchedule.id !== normalizedId)) {
      resolvedSchedule = this.app.schedules.find((item) => item.id === normalizedId) || null;
    }
    const previousId = ensureString(this.app.hostCommittedScheduleId);
    const previousLabel = ensureString(this.app.hostCommittedScheduleLabel);
    const nextLabel = normalizedId ? ensureString(resolvedSchedule?.label) || normalizedId : "";
    const changed = previousId !== normalizedId || previousLabel !== nextLabel;
    
    // プロパティの更新（app.jsに同期）
    this.app.hostCommittedScheduleId = normalizedId;
    this.app.hostCommittedScheduleLabel = normalizedId ? nextLabel : "";
    
    if (normalizedId) {
      this.app.scheduleSelectionCommitted = true;
    } else {
      this.app.scheduleSelectionCommitted = false;
      this.app.clearPendingDisplayLock();
    }
    
    // Firebase関連の処理
    if (force) {
      this.hostPresenceLastSignature = "";
    }
    if (sync) {
      // syncHostPresenceを直接呼び出し（再帰的呼び出しを避けるため）
      void this.syncHostPresence(reason);
    } else if (changed) {
      this.hostPresenceLastSignature = "";
    }
    
    return changed;
  }

  /**
   * ホストプレゼンスを同期します。
   * @param {string} reason - 同期理由（デフォルト: "state-change"）
   */
  async syncHostPresence(reason = "state-change") {
    const user = this.app.currentUser || auth.currentUser || null;
    const uid = ensureString(user?.uid);
    if (!uid) {
      this.clearHostPresence();
      this.app.logFlowState("在席情報をクリアしました (未ログイン)", { reason });
      return;
    }

    const eventId = ensureString(this.app.selectedEventId);
    if (!eventId) {
      this.clearHostPresence();
      this.app.logFlowState("在席情報をクリアしました (イベント未選択)", { reason });
      return;
    }

    if (!this.app.eventSelectionCommitted) {
      this.clearHostPresence();
      this.app.logFlowState("イベント未確定のため在席情報の更新を保留します", {
        reason,
        eventId
      });
      return;
    }

    const presenceEntries = Array.isArray(this.app.operatorPresenceEntries)
      ? this.app.operatorPresenceEntries
      : [];
    let hostEntries = this.collectLocalHostPresenceEntries(presenceEntries, uid);
    if (hostEntries.length === 0) {
      const fetchedEntries = await this.fetchHostPresenceEntries(eventId, uid);
      hostEntries = Array.isArray(fetchedEntries) ? fetchedEntries : [];
    }
    hostEntries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const hostSessionIds = new Set(
      hostEntries.map((entry) => ensureString(entry.sessionId || entry.entryId)).filter(Boolean)
    );
    const entryKey = ensureString(this.hostPresenceEntryKey);
    const [entryKeyEventId = ""] = entryKey.split("/");
    const previousSessionId = entryKeyEventId === eventId ? ensureString(this.hostPresenceSessionId) : "";
    const storedSessionId = ensureString(this.loadStoredHostPresenceSessionId(uid, eventId));
    const preferredEntry = hostEntries.length > 0 ? hostEntries[0] : null;
    const preferredSessionId = ensureString(preferredEntry?.sessionId || preferredEntry?.entryId);
    const baselineSessionId = previousSessionId || storedSessionId || "";

    let sessionId = "";
    let reusedSessionId = "";

    if (previousSessionId && hostSessionIds.has(previousSessionId)) {
      sessionId = previousSessionId;
      reusedSessionId = previousSessionId;
    } else if (storedSessionId && hostSessionIds.has(storedSessionId)) {
      sessionId = storedSessionId;
      reusedSessionId = storedSessionId;
    } else if (preferredSessionId) {
      sessionId = preferredSessionId;
      reusedSessionId = preferredSessionId;
    } else if (storedSessionId) {
      sessionId = storedSessionId;
    } else if (previousSessionId) {
      sessionId = previousSessionId;
    } else {
      sessionId = this.generatePresenceSessionId();
    }

    this.hostPresenceSessionId = sessionId;
    this.app.hostPresenceSessionId = sessionId;
    this.persistHostPresenceSessionId(uid, eventId, sessionId);
    const nextKey = `${eventId}/${sessionId}`;
    if (this.hostPresenceEntryKey && this.hostPresenceEntryKey !== nextKey) {
      this.clearHostPresence();
      this.hostPresenceSessionId = sessionId;
      this.app.hostPresenceSessionId = sessionId;
    }

    if (reusedSessionId) {
      this.app.logFlowState("既存の在席セッションを引き継ぎます", {
        reason,
        eventId,
        previousSessionId: baselineSessionId || "",
        sessionId
      });
    }

    const event = this.app.getSelectedEvent();
    const hostContext = this.resolveHostScheduleContext(eventId);
    let presenceScheduleId = ensureString(hostContext.scheduleId);
    const committedScheduleId = ensureString(hostContext.committedScheduleId);
    const selectedScheduleId = ensureString(hostContext.selectedScheduleId);
    const selectedScheduleLabel = ensureString(hostContext.selectedScheduleLabel);
    const scheduleLabel = ensureString(hostContext.scheduleLabel);
    const scheduleKey = ensureString(hostContext.scheduleKey);
    const pendingNavigationTarget = ensureString(this.app.pendingNavigationTarget);
    if (!presenceScheduleId && selectedScheduleId && pendingNavigationTarget) {
      presenceScheduleId = selectedScheduleId;
    }
    if (!presenceScheduleId && committedScheduleId) {
      presenceScheduleId = committedScheduleId;
    }
    let effectiveScheduleLabel = scheduleLabel;
    if (!effectiveScheduleLabel && presenceScheduleId) {
      if (presenceScheduleId === committedScheduleId) {
        effectiveScheduleLabel = ensureString(this.app.hostCommittedScheduleLabel) || presenceScheduleId;
      } else if (selectedScheduleId === presenceScheduleId) {
        effectiveScheduleLabel = selectedScheduleLabel || presenceScheduleId;
      } else {
        const fallbackSchedule = this.findScheduleByIdOrAlias(presenceScheduleId);
        effectiveScheduleLabel = ensureString(fallbackSchedule?.label) || presenceScheduleId;
      }
    }
    const operatorMode = normalizeOperatorMode(this.app.operatorMode);
    const skipTelop = operatorMode === OPERATOR_MODE_SUPPORT;
    const signature = JSON.stringify({
      eventId,
      scheduleId: presenceScheduleId,
      scheduleKey,
      scheduleLabel: effectiveScheduleLabel,
      sessionId,
      skipTelop,
      committedScheduleId,
      selectedScheduleId,
      selectedScheduleLabel,
      committedScheduleLabel: ensureString(this.app.hostCommittedScheduleLabel)
    });
    if (reason !== "heartbeat" && signature === this.hostPresenceLastSignature) {
      this.scheduleHostPresenceHeartbeat();
      this.app.logFlowState("在席情報に変更はありません", {
        reason,
        eventId,
        scheduleId: presenceScheduleId,
        committedScheduleId,
        scheduleKey,
        sessionId
      });
      return;
    }
    this.hostPresenceLastSignature = signature;
    this.app.hostPresenceLastSignature = signature;

    const entryRef = getOperatorPresenceEntryRef(eventId, sessionId);
    this.hostPresenceEntryKey = nextKey;
    this.hostPresenceEntryRef = entryRef;
    this.app.hostPresenceEntryKey = nextKey;
    this.app.hostPresenceEntryRef = entryRef;

    const payload = {
      sessionId,
      uid,
      email: ensureString(user?.email),
      displayName: ensureString(user?.displayName),
      eventId,
      eventName: ensureString(event?.name || eventId),
      scheduleId: presenceScheduleId,
      scheduleKey,
      scheduleLabel: effectiveScheduleLabel,
      selectedScheduleId,
      selectedScheduleLabel,
      skipTelop,
      updatedAt: serverTimestamp(),
      clientTimestamp: Date.now(),
      reason,
      source: "events"
    };

    if (this.app.logOperatorPresenceDebug) {
      this.app.logOperatorPresenceDebug("Write operator presence entry", {
        eventId,
        sessionId,
        payload: this.app.describeOperatorPresencePayload ? this.app.describeOperatorPresencePayload(payload) : payload
      });
    }

    set(entryRef, payload).catch((error) => {
      console.error("Failed to persist host presence:", error);
    });

    const staleEntries = hostEntries.filter((entry) => {
      const entrySessionId = ensureString(entry.sessionId || entry.entryId);
      return entrySessionId && entrySessionId !== sessionId;
    });
    this.pruneHostPresenceEntries(eventId, staleEntries, sessionId);

    try {
      if (this.hostPresenceDisconnect) {
        this.hostPresenceDisconnect.cancel().catch(() => {});
      }
      const disconnectHandle = onDisconnect(entryRef);
      this.hostPresenceDisconnect = disconnectHandle;
      this.app.hostPresenceDisconnect = disconnectHandle;
      disconnectHandle.remove().catch(() => {});
    } catch (error) {
      console.debug("Failed to register host presence cleanup:", error);
    }

    this.scheduleHostPresenceHeartbeat();
    this.app.logFlowState("在席情報を更新しました", {
      reason,
      eventId,
      scheduleId: presenceScheduleId,
      committedScheduleId,
      scheduleKey,
      sessionId
    });

    this.reconcileHostPresenceSessions(eventId, uid, sessionId).catch(() => {});
  }
}

