// presence-manager.js: オペレーターのプレゼンス管理を担当します。
import { auth } from "./firebase.js";
import {
  getOperatorPresenceEventRef,
  getOperatorPresenceEntryRef,
  set,
  update,
  remove,
  serverTimestamp,
  onDisconnect,
  onValue,
  get
} from "./firebase.js";
import { derivePresenceScheduleKey as sharedDerivePresenceScheduleKey } from "../shared/presence-keys.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { isTelopMode } from "../shared/operator-modes.js";

const OPERATOR_PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * プレゼンス管理クラス
 * オペレーターのプレゼンス（在席状態）を管理します。
 */
export class PresenceManager {
  constructor(app) {
    this.app = app;
  }

  /**
   * オペレーターpresence用のセッションIDを生成します。
   * crypto APIの利用可否に応じて最適な乱数生成手段を選択します。
   * @returns {string}
   */
  generatePresenceSessionId() {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      if (typeof crypto.getRandomValues === "function") {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, (value) => value.toString(16).padStart(2, "0")).join("");
      }
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /**
   * presenceデータから比較・集計に利用する一意のキーを導出します。
   * scheduleKey > scheduleId > label > entryIdの優先順位で構成します。
   * @param {string} eventId
   * @param {object} payload
   * @param {string} entryId
   * @returns {string}
   */
  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
    return sharedDerivePresenceScheduleKey(eventId, payload, entryId);
  }

  /**
   * オペレーターpresenceの監視対象を切り替えます。
   * イベントが変わった際には既存購読を解除し、新しいイベントのpresenceノードを監視します。
   */
  refreshOperatorPresenceSubscription() {
    const { eventId } = this.app.getActiveChannel();
    const nextEventId = String(eventId || "").trim();
    if (this.app.presenceSubscribedEventId === nextEventId) {
      return;
    }
    if (this.app.operatorPresenceUnsubscribe) {
      this.app.operatorPresenceUnsubscribe();
      this.app.operatorPresenceUnsubscribe = null;
    }
    if (this.app.operatorPresencePrimedEventId && this.app.operatorPresencePrimedEventId !== nextEventId) {
      this.app.operatorPresencePrimedEventId = "";
    }
    this.app.presenceSubscribedEventId = nextEventId;
    this.app.state.operatorPresenceEventId = nextEventId;
    this.app.state.operatorPresenceByUser = new Map();
    if (!nextEventId) {
      this.app.state.operatorPresenceSelf = null;
      this.app.renderChannelBanner();
      this.app.evaluateScheduleConflict();
      return;
    }

    const eventRef = getOperatorPresenceEventRef(nextEventId);
    this.app.operatorPresenceUnsubscribe = onValue(
      eventRef,
      (snapshot) => {
        const rawPresenceData = snapshot.val() || {};
        const presenceMap = new Map();
        Object.entries(rawPresenceData).forEach(([entryId, payload]) => {
          presenceMap.set(String(entryId), payload || {});
        });
        this.app.state.operatorPresenceEventId = nextEventId;
        this.app.state.operatorPresenceByUser = presenceMap;
        const selfResolution = this.resolveSelfPresenceEntry(nextEventId, presenceMap);
        let selfEntry = null;
        if (selfResolution) {
          const { payload, sessionId: resolvedSessionId, duplicates } = selfResolution;
          selfEntry = payload ? { ...payload, sessionId: resolvedSessionId || String(payload.sessionId || "") } : null;
          if (resolvedSessionId) {
            this.adoptOperatorPresenceSession(nextEventId, resolvedSessionId);
          }
          if (Array.isArray(duplicates) && duplicates.length) {
            duplicates.forEach((duplicate) => {
              const duplicateSessionId = String(duplicate?.sessionId || duplicate?.entryId || "").trim();
              if (!duplicateSessionId || duplicateSessionId === resolvedSessionId) {
                return;
              }
              try {
                remove(getOperatorPresenceEntryRef(nextEventId, duplicateSessionId)).catch(() => {});
              } catch (error) {
                // Ignore removal failures.
              }
            });
          }
        } else {
          const sessionId = String(this.app.operatorPresenceSessionId || "").trim();
          if (sessionId && presenceMap.has(sessionId)) {
            selfEntry = presenceMap.get(sessionId) || null;
          }
        }
        this.app.state.operatorPresenceSelf = selfEntry || null;
        this.app.renderChannelBanner();
        this.app.evaluateScheduleConflict();
      },
      () => {}
    );
  }

  /**
   * presenceに自身のセッションを登録する準備を行います。
   * 書き込み競合を避けるため、既存のエントリを確認しながら初期データを投入します。
   * @param {string} eventId
   * @returns {Promise<void>}
   */
  primeOperatorPresenceSession(eventId = "") {
    const ensureString = (value) => String(value ?? "").trim();
    const normalizedEventId = ensureString(eventId);
    const uid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!normalizedEventId || !uid) {
      this.app.operatorPresencePrimedEventId = normalizedEventId ? normalizedEventId : "";
      return Promise.resolve();
    }
    if (this.app.operatorPresencePrimedEventId === normalizedEventId && !this.app.operatorPresencePrimePromise) {
      return Promise.resolve();
    }
    const presenceMap = this.app.state?.operatorPresenceByUser instanceof Map ? this.app.state.operatorPresenceByUser : null;
    if (presenceMap && presenceMap.size) {
      const resolution = this.resolveSelfPresenceEntry(normalizedEventId, presenceMap);
      const resolvedSessionId = ensureString(resolution?.sessionId);
      if (resolvedSessionId) {
        this.app.operatorPresencePrimedEventId = normalizedEventId;
        this.adoptOperatorPresenceSession(normalizedEventId, resolvedSessionId);
        return Promise.resolve();
      }
    }
    if (this.app.operatorPresencePrimePromise) {
      if (this.app.operatorPresencePrimeTargetEventId === normalizedEventId) {
        return this.app.operatorPresencePrimePromise;
      }
    }
    const requestId = ++this.app.operatorPresencePrimeRequestId;
    this.app.operatorPresencePrimeTargetEventId = normalizedEventId;
    const primePromise = get(getOperatorPresenceEventRef(normalizedEventId))
      .then((snapshot) => {
        if (this.app.operatorPresencePrimeRequestId !== requestId) {
          return;
        }
        if (!snapshot.exists()) {
          return;
        }
        const rawPresenceData = snapshot.val();
        if (!rawPresenceData || typeof rawPresenceData !== "object") {
          return;
        }
        let resolvedSessionId = "";
        Object.entries(rawPresenceData).some(([entryId, payload]) => {
          if (resolvedSessionId) {
            return true;
          }
          if (!payload || typeof payload !== "object") {
            return false;
          }
          const entryUid = ensureString(payload.uid);
          if (!entryUid || entryUid !== uid) {
            return false;
          }
          const sessionId = ensureString(payload.sessionId) || ensureString(entryId);
          if (!sessionId) {
            return false;
          }
          resolvedSessionId = sessionId;
          return true;
        });
        if (resolvedSessionId) {
          this.adoptOperatorPresenceSession(normalizedEventId, resolvedSessionId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.app.operatorPresencePrimeRequestId === requestId) {
          this.app.operatorPresencePrimePromise = null;
          this.app.operatorPresencePrimedEventId = normalizedEventId;
          this.app.operatorPresencePrimeTargetEventId = "";
        }
      });
    this.app.operatorPresencePrimePromise = primePromise;
    return primePromise;
  }

  /**
   * presence一覧から自身に該当するエントリを特定します。
   * セッションIDの競合や重複がある場合には整理された結果を返します。
   * @param {string} eventId
   * @param {Map<string, any>} presenceMap
   * @returns {{ payload: any, sessionId: string, duplicates: any[] }|null}
   */
  resolveSelfPresenceEntry(eventId, presenceMap) {
    const ensureString = (value) => String(value ?? "").trim();
    const normalizedEventId = ensureString(eventId);
    if (!normalizedEventId) {
      return null;
    }
    const selfUid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!selfUid) {
      return null;
    }
    const map = presenceMap instanceof Map ? presenceMap : new Map();
    const entries = [];
    map.forEach((entryPayload, entryId) => {
      if (!entryPayload) {
        return;
      }
      const valueEventId = ensureString(entryPayload.eventId);
      if (valueEventId && valueEventId !== normalizedEventId) {
        return;
      }
      const valueUid = ensureString(entryPayload.uid);
      if (!valueUid || valueUid !== selfUid) {
        return;
      }
      const normalizedEntryId = ensureString(entryId);
      const sessionId = ensureString(entryPayload.sessionId) || normalizedEntryId;
      if (!sessionId) {
        return;
      }
      const timestamp = Number(entryPayload.clientTimestamp || entryPayload.updatedAt || 0) || 0;
      entries.push({
        entryId: normalizedEntryId,
        sessionId,
        payload: entryPayload,
        timestamp
      });
    });
    if (!entries.length) {
      return null;
    }
    const existingSessionId = ensureString(this.app.operatorPresenceSessionId);
    let canonical = null;
    if (existingSessionId) {
      canonical = entries.find((entry) => entry.sessionId === existingSessionId) || null;
    }
    if (!canonical) {
      entries.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return (b.timestamp || 0) - (a.timestamp || 0);
        }
        return a.sessionId.localeCompare(b.sessionId);
      });
      canonical = entries[0];
    }
    const duplicates = entries.filter((entry) => entry !== canonical);
    return {
      eventId: normalizedEventId,
      entryId: canonical.entryId,
      sessionId: canonical.sessionId,
      payload: canonical.payload,
      duplicates
    };
  }

  /**
   * 自身のセッションIDが変化した場合にローカル状態を更新し、新しいIDでpresence監視を継続します。
   * @param {string} eventId
   * @param {string} sessionId
   */
  adoptOperatorPresenceSession(eventId, sessionId) {
    const ensureString = (value) => String(value ?? "").trim();
    const normalizedEventId = ensureString(eventId);
    const normalizedSessionId = ensureString(sessionId);
    if (!normalizedEventId || !normalizedSessionId) {
      return;
    }
    const currentSessionId = ensureString(this.app.operatorPresenceSessionId);
    if (currentSessionId === normalizedSessionId) {
      const currentKey = ensureString(this.app.operatorPresenceEntryKey);
      if (currentKey !== `${normalizedEventId}/${normalizedSessionId}`) {
        this.app.operatorPresenceEntryKey = "";
        this.app.operatorPresenceEntryRef = null;
        this.app.operatorPresenceLastSignature = "";
        this.queueOperatorPresenceSync();
      }
      return;
    }
    this.stopOperatorPresenceHeartbeat();
    if (this.app.operatorPresenceDisconnect && typeof this.app.operatorPresenceDisconnect.cancel === "function") {
      try {
        this.app.operatorPresenceDisconnect.cancel().catch(() => {});
      } catch (error) {
        // Ignore disconnect cancellation errors.
      }
    }
    this.app.operatorPresenceDisconnect = null;
    this.app.operatorPresenceEntryRef = null;
    this.app.operatorPresenceEntryKey = "";
    this.app.operatorPresenceLastSignature = "";
    this.app.operatorPresenceSessionId = normalizedSessionId;
    this.queueOperatorPresenceSync();
  }

  /**
   * 現在のユーザーに紐づく古いpresenceエントリを全イベントから削除します。
   * sessionIdを指定した場合はそのエントリを除外します。
   * @param {string} uid
   * @param {{ excludeSessionId?: string }} [options]
   * @returns {Promise<void>}
   */
  purgeOperatorPresenceSessionsForUser(uid = "", options = {}) {
    const ensureString = (value) => String(value ?? "").trim();
    const normalizedUid = ensureString(uid || this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!normalizedUid) {
      return Promise.resolve();
    }
    const excludeSessionId = ensureString(options?.excludeSessionId);
    if (
      this.app.operatorPresencePurgePromise &&
      this.app.operatorPresencePurgeUid === normalizedUid &&
      this.app.operatorPresencePurgeExclude === excludeSessionId
    ) {
      return this.app.operatorPresencePurgePromise;
    }
    const requestId = ++this.app.operatorPresencePurgeRequestId;
    this.app.operatorPresencePurgeUid = normalizedUid;
    this.app.operatorPresencePurgeExclude = excludeSessionId;
    const rootRef = getOperatorPresenceEventRef();
    const purgePromise = get(rootRef)
      .then((snapshot) => {
        if (!snapshot || typeof snapshot.exists !== "function" || !snapshot.exists()) {
          return;
        }
        const removals = [];
        snapshot.forEach((eventSnap) => {
          const eventId = ensureString(eventSnap.key);
          if (!eventId || typeof eventSnap.forEach !== "function") {
            return;
          }
          eventSnap.forEach((entrySnap) => {
            const entryPayload = entrySnap && typeof entrySnap.val === "function" ? entrySnap.val() || {} : {};
            const entryUid = ensureString(entryPayload.uid);
            if (!entryUid || entryUid !== normalizedUid) {
              return;
            }
            const sessionId = ensureString(entryPayload.sessionId || entrySnap.key);
            if (excludeSessionId && sessionId === excludeSessionId) {
              return;
            }
            if (!sessionId) {
              return;
            }
            removals.push(remove(getOperatorPresenceEntryRef(eventId, sessionId)).catch(() => {}));
          });
        });
        if (removals.length) {
          return Promise.all(removals).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.app.operatorPresencePurgeRequestId === requestId) {
          this.app.operatorPresencePurgePromise = null;
          this.app.operatorPresencePurgeUid = "";
          this.app.operatorPresencePurgeExclude = "";
        }
      });
    this.app.operatorPresencePurgePromise = purgePromise;
    return purgePromise;
  }

  /**
   * presence同期処理を次のマイクロタスクに遅延させ、短時間に複数回呼ばれた場合もまとめて実行します。
   */
  queueOperatorPresenceSync() {
    if (this.app.operatorPresenceSyncQueued) {
      return;
    }
    this.app.operatorPresenceSyncQueued = true;
    Promise.resolve().then(() => {
      this.app.operatorPresenceSyncQueued = false;
      this.syncOperatorPresence();
    });
  }

  /**
   * 現在のオペレーター状態をpresenceツリーに反映します。
   * 書き込みは必要な場合のみ行い、サーバータイムスタンプで同期性を確保します。
   * @param {string} reason
   * @param {object} options
   * @returns {Promise<void>}
   */
  syncOperatorPresence(reason = "context-sync", options = {}) {
    const primePending = Boolean(this.app.operatorPresencePrimePromise);
    const user = this.app.operatorIdentity?.uid ? this.app.operatorIdentity : auth.currentUser || null;
    const uid = String(user?.uid || "").trim();
    if (!uid || !this.app.isAuthorized) {
      this.clearOperatorPresence();
      return;
    }

    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const selectionConfirmed = contextConfirmed && this.app.state?.selectionConfirmed === true;
    const eventId = selectionConfirmed
      ? String(this.app.state?.activeEventId || context.eventId || "").trim()
      : "";
    if (!selectionConfirmed || !eventId) {
      this.clearOperatorPresence();
      return;
    }

    if (primePending) {
      return;
    }

    const ensureString = (value) => String(value ?? "").trim();
    const committedScheduleId = selectionConfirmed ? ensureString(this.app.state?.committedScheduleId) : "";
    const committedScheduleLabel = selectionConfirmed ? ensureString(this.app.state?.committedScheduleLabel) : "";
    const committedScheduleKey = selectionConfirmed ? ensureString(this.app.state?.committedScheduleKey) : "";
    const intentScheduleId = ensureString(this.app.state?.operatorPresenceIntentId);
    const intentScheduleLabel = ensureString(this.app.state?.operatorPresenceIntentLabel);
    const intentScheduleKey = ensureString(this.app.state?.operatorPresenceIntentKey);
    const activeScheduleId = selectionConfirmed
      ? ensureString(this.app.state?.activeScheduleId || context.scheduleId || "")
      : "";
    const activeScheduleLabel = selectionConfirmed
      ? ensureString(this.app.state?.activeScheduleLabel || context.scheduleLabel || "")
      : "";
    const activeScheduleKey = selectionConfirmed
      ? ensureString(
          this.app.state?.currentSchedule ||
            this.app.state?.lastNormalSchedule ||
            context.scheduleKey || ""
        )
      : "";
    const previousPresence = this.app.state?.operatorPresenceSelf || null;
    const allowPresenceFallback =
      typeof options?.allowFallback === "boolean"
        ? options.allowFallback
        : reason === "heartbeat";
    const useActiveSchedule = options?.useActiveSchedule !== false;
    const publishScheduleOption = options?.publishSchedule;
    const sessionId = ensureString(this.app.operatorPresenceSessionId) || this.generatePresenceSessionId();

    const schedulePublicationExplicit = publishScheduleOption === true;
    const scheduleSuppressed =
      publishScheduleOption === false || (!selectionConfirmed && !schedulePublicationExplicit);
    const activeScheduleAvailable =
      useActiveSchedule && (activeScheduleKey || activeScheduleId || activeScheduleLabel);
    const shouldPublishSchedule =
      schedulePublicationExplicit ||
      (!scheduleSuppressed &&
        (committedScheduleKey || intentScheduleKey || intentScheduleId || intentScheduleLabel || activeScheduleAvailable));

    let scheduleId = "";
    let scheduleLabel = "";
    let scheduleKey = "";

    if (shouldPublishSchedule) {
      scheduleId = committedScheduleId || (useActiveSchedule ? activeScheduleId : "");
      if (!scheduleId && intentScheduleId) {
        scheduleId = intentScheduleId;
      }
      if (!scheduleId && intentScheduleKey) {
        const [, schedulePart = ""] = intentScheduleKey.split("::");
        scheduleId = ensureString(schedulePart || intentScheduleKey);
      }
      if (!scheduleId && allowPresenceFallback) {
        scheduleId = ensureString(previousPresence?.scheduleId);
      }

      scheduleLabel = committedScheduleLabel || (useActiveSchedule ? activeScheduleLabel : "");
      if (!scheduleLabel && intentScheduleLabel) {
        scheduleLabel = intentScheduleLabel;
      }
      if (!scheduleLabel && allowPresenceFallback) {
        scheduleLabel = ensureString(previousPresence?.scheduleLabel);
      }
      if (!scheduleLabel && scheduleId) {
        scheduleLabel = scheduleId;
      }

      scheduleKey = committedScheduleKey || (useActiveSchedule ? activeScheduleKey : "");
      if (!scheduleKey && intentScheduleKey) {
        scheduleKey = intentScheduleKey;
      }
      if (!scheduleKey && scheduleId && eventId) {
        scheduleKey = `${eventId}::${normalizeScheduleId(scheduleId)}`;
      }
      if (!scheduleKey && allowPresenceFallback) {
        scheduleKey = ensureString(previousPresence?.scheduleKey);
      }
      if (!scheduleKey && scheduleId) {
        scheduleKey = this.derivePresenceScheduleKey(eventId, { scheduleId, scheduleLabel }, sessionId);
      }
      if (!scheduleKey && scheduleLabel) {
        scheduleKey = this.derivePresenceScheduleKey(
          eventId,
          {
            scheduleId: "",
            scheduleLabel
          },
          sessionId
        );
      }
    }
    const publishEvent = shouldPublishSchedule || options?.publishEvent === true;
    const eventName = publishEvent
      ? String(this.app.state?.activeEventName || (selectionConfirmed ? context.eventName : "") || "").trim()
      : "";
    const skipTelop = !this.app.isTelopEnabled();
    this.app.operatorPresenceSessionId = sessionId;
    const nextKey = `${eventId}/${sessionId}`;

    if (this.app.operatorPresenceEntryKey && this.app.operatorPresenceEntryKey !== nextKey) {
      this.clearOperatorPresence();
    }

    const signature = JSON.stringify({
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel,
      sessionId,
      skipTelop
    });
    if (reason !== "heartbeat" && signature === this.app.operatorPresenceLastSignature) {
      this.scheduleOperatorPresenceHeartbeat();
      return;
    }
    this.app.operatorPresenceLastSignature = signature;

    const entryRef = getOperatorPresenceEntryRef(eventId, sessionId);
    this.app.operatorPresenceEntryKey = nextKey;
    this.app.operatorPresenceEntryRef = entryRef;

    // 完全正規化: eventNameとscheduleLabelは削除（eventIdとscheduleIdから取得可能）
    const payload = {
      sessionId,
      uid,
      email: String(user?.email || "").trim(),
      displayName: String(user?.displayName || "").trim(),
      eventId: publishEvent ? eventId : "",
      scheduleId,
      scheduleKey,
      skipTelop,
      updatedAt: serverTimestamp(),
      clientTimestamp: Date.now(),
      reason,
      source: "operator"
    };

    set(entryRef, payload).catch(() => {});

    try {
      if (this.app.operatorPresenceDisconnect) {
        this.app.operatorPresenceDisconnect.cancel().catch(() => {});
      }
      const disconnectHandle = onDisconnect(entryRef);
      this.app.operatorPresenceDisconnect = disconnectHandle;
      disconnectHandle.remove().catch(() => {});
    } catch (error) {
      // Ignore disconnect cleanup errors.
    }

    this.app.state.operatorPresenceSelf = {
      ...payload,
      updatedAt: Date.now()
    };

    this.scheduleOperatorPresenceHeartbeat();
    this.app.renderChannelBanner();
    this.app.evaluateScheduleConflict();
  }

  /**
   * 定期的にpresenceを更新するハートビートタイマーを設定します。
   */
  scheduleOperatorPresenceHeartbeat() {
    if (this.app.operatorPresenceHeartbeat) {
      return;
    }
    this.app.operatorPresenceHeartbeat = setInterval(() => this.touchOperatorPresence(), OPERATOR_PRESENCE_HEARTBEAT_MS);
  }

  /**
   * 現在のpresenceレコードにアクセスし、最終更新時刻をサーバータイムスタンプで更新します。
   * @returns {Promise<void>}
   */
  touchOperatorPresence() {
    if (!this.app.operatorPresenceEntryRef || !this.app.operatorPresenceEntryKey) {
      this.stopOperatorPresenceHeartbeat();
      return;
    }

    const ensureString = (value) => String(value ?? "").trim();

    const uid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!uid || !this.app.isAuthorized) {
      this.clearOperatorPresence();
      return;
    }

    const selfEntry = this.app.state?.operatorPresenceSelf || null;
    const entryUid = ensureString(selfEntry?.uid);
    if (!selfEntry || !entryUid || entryUid !== uid) {
      this.stopOperatorPresenceHeartbeat();
      this.app.operatorPresenceEntryRef = null;
      this.app.operatorPresenceEntryKey = "";
      this.app.operatorPresenceLastSignature = "";
      Promise.resolve().then(() =>
        this.syncOperatorPresence("heartbeat-recover", { allowFallback: true })
      );
      return;
    }

    const now = Date.now();
    update(this.app.operatorPresenceEntryRef, {
      clientTimestamp: now
    }).catch((error) => {
      const codeText = typeof error?.code === "string" ? error.code.toUpperCase() : "";
      const messageText = typeof error?.message === "string" ? error.message.toLowerCase() : "";
      const permissionDenied =
        codeText === "PERMISSION_DENIED" || messageText.includes("permission_denied");
      if (permissionDenied) {
        this.stopOperatorPresenceHeartbeat();
        this.app.operatorPresenceEntryRef = null;
        this.app.operatorPresenceEntryKey = "";
        this.app.operatorPresenceLastSignature = "";
        Promise.resolve().then(() =>
          this.syncOperatorPresence("heartbeat-recover", { allowFallback: true })
        );
      }
    });

    if (this.app.state.operatorPresenceSelf) {
      this.app.state.operatorPresenceSelf = {
        ...this.app.state.operatorPresenceSelf,
        clientTimestamp: now
      };
    }
  }

  /**
   * ハートビートタイマーを解除して、追加のpresence更新を停止します。
   */
  stopOperatorPresenceHeartbeat() {
    if (this.app.operatorPresenceHeartbeat) {
      clearInterval(this.app.operatorPresenceHeartbeat);
      this.app.operatorPresenceHeartbeat = null;
    }
  }

  /**
   * presenceから自身のエントリを削除し、ローカルに保持している参照も破棄します。
   * @returns {Promise<void>}
   */
  clearOperatorPresence() {
    this.stopOperatorPresenceHeartbeat();
    this.app.operatorPresenceSyncQueued = false;
    this.app.operatorPresenceLastSignature = "";
    this.app.operatorPresencePrimedEventId = "";
    this.app.operatorPresencePrimePromise = null;
    this.app.operatorPresencePrimeTargetEventId = "";
    this.app.operatorPresencePrimeRequestId += 1;
    const disconnectHandle = this.app.operatorPresenceDisconnect;
    this.app.operatorPresenceDisconnect = null;
    if (disconnectHandle && typeof disconnectHandle.cancel === "function") {
      disconnectHandle.cancel().catch(() => {});
    }
    const entryRef = this.app.operatorPresenceEntryRef;
    this.app.operatorPresenceEntryRef = null;
    const hadKey = !!this.app.operatorPresenceEntryKey;
    this.app.operatorPresenceEntryKey = "";
    const ensureString = (value) => String(value ?? "").trim();
    const sessionId = ensureString(this.app.operatorPresenceSessionId);
    if (entryRef && hadKey) {
      remove(entryRef).catch(() => {});
    } else {
      const uid = ensureString(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "");
      if (uid) {
        this.purgeOperatorPresenceSessionsForUser(uid, { excludeSessionId: sessionId });
      }
    }
    this.app.state.operatorPresenceSelf = null;
    this.clearOperatorPresenceIntent();
  }

  /**
   * オペレーターpresenceで使用する日程意図をクリアします。
   */
  clearOperatorPresenceIntent() {
    if (!this.app.state) {
      return;
    }
    this.app.state.operatorPresenceIntentId = "";
    this.app.state.operatorPresenceIntentLabel = "";
    this.app.state.operatorPresenceIntentKey = "";
  }

  /**
   * presenceで公開する日程意図を設定します。
   * @param {string} eventId
   * @param {string} scheduleId
   * @param {string} scheduleLabel
   */
  markOperatorPresenceIntent(eventId, scheduleId, scheduleLabel = "") {
    if (!this.app.state) {
      return;
    }
    const normalizedEvent = String(eventId || "").trim();
    const normalizedSchedule = normalizeScheduleId(scheduleId || "");
    const label = String(scheduleLabel || "").trim();
    const scheduleKey = normalizedEvent && normalizedSchedule ? `${normalizedEvent}::${normalizedSchedule}` : "";
    this.app.state.operatorPresenceIntentId = normalizedSchedule;
    this.app.state.operatorPresenceIntentLabel = label || normalizedSchedule;
    this.app.state.operatorPresenceIntentKey = scheduleKey;
  }
}

