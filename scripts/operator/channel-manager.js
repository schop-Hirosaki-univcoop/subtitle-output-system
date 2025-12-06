// channel-manager.js: チャンネルとスケジュール管理を担当します。
import { normalizeScheduleId, getRenderStatePath } from "../shared/channel-paths.js";
import { auth, onValue, getRenderRef } from "./firebase.js";
import { error as logDisplayLinkError } from "../shared/display-link-logger.js";
import * as Questions from "./questions.js";

/**
 * プレゼンスラベルを正規化します。
 * @param {any} value
 * @returns {string}
 */
export function sanitizePresenceLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\s+/g, " ").replace(/::/g, "／");
}

/**
 * スケジュールキーをパースしてeventId、scheduleId、labelを抽出します。
 * @param {any} value
 * @returns {{ eventId: string, scheduleId: string, label: string }}
 */
export function extractScheduleKeyParts(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { eventId: "", scheduleId: "", label: "" };
  }
  const segments = raw.split("::");
  if (segments.length <= 1) {
    return { eventId: "", scheduleId: raw, label: "" };
  }
  const [first = "", second = "", ...rest] = segments;
  const eventId = String(first || "").trim();
  const marker = String(second || "").trim();
  if (!marker) {
    return { eventId, scheduleId: "", label: "" };
  }
  if (marker === "label") {
    return { eventId, scheduleId: "", label: rest.join("::").trim() };
  }
  if (marker === "session") {
    return { eventId, scheduleId: "", label: "" };
  }
  return { eventId, scheduleId: marker, label: "" };
}

/**
 * チャンネル管理クラス
 * チャンネルとスケジュールの管理を担当します。
 */
export class ChannelManager {
  constructor(app) {
    this.app = app;
  }

  /**
   * stateとURLから現在操作対象となるイベント/日程を決定します。
   * いずれかの値が欠落している場合はscheduleKeyから復元を試みます。
   * @returns {{ eventId: string, scheduleId: string }}
   */
  getActiveChannel() {
    const ensureString = (value) => String(value ?? "").trim();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    let eventId = ensureString(this.app.state?.activeEventId || (contextConfirmed ? context.eventId : ""));
    let scheduleId = ensureString(this.app.state?.activeScheduleId || (contextConfirmed ? context.scheduleId : ""));

    if (!eventId || !scheduleId) {
        const scheduleKey = ensureString(
          this.app.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || ""
        );
        if (scheduleKey) {
          const parts = extractScheduleKeyParts(scheduleKey);
          if (!eventId && parts.eventId) {
            eventId = ensureString(parts.eventId);
          }
          if (!scheduleId && parts.scheduleId) {
            scheduleId = ensureString(parts.scheduleId);
          }
        if (!scheduleId && parts.label) {
          const normalizedLabel = sanitizePresenceLabel(parts.label);
          const metadataMap = this.app.state?.scheduleMetadata instanceof Map ? this.app.state.scheduleMetadata : null;
          if (metadataMap && normalizedLabel) {
            for (const [metaKey, metaValue] of metadataMap.entries()) {
              if (eventId) {
                if (!metaKey.startsWith(`${eventId}::`)) {
                  continue;
                }
              }
              const candidateLabel = sanitizePresenceLabel(metaValue?.label);
              if (candidateLabel && candidateLabel === normalizedLabel) {
                const resolved = extractScheduleKeyParts(metaKey);
                if (resolved.scheduleId) {
                  scheduleId = ensureString(resolved.scheduleId);
                }
                if (!eventId && resolved.eventId) {
                  eventId = ensureString(resolved.eventId);
                }
                if (scheduleId) {
                  break;
                }
              }
            }
          }
        }
      }
    }

    // selectionConfirmedがfalseの場合、channelAssignmentから自動取得しない
    // これにより、初期状態で何も選択されていない状態を維持できる
    const selectionConfirmed = this.app.state?.selectionConfirmed === true || contextConfirmed;
    if (!eventId || !scheduleId) {
      if (selectionConfirmed) {
        const assignment = this.app.state?.channelAssignment || this.getDisplayAssignment();
        if (assignment) {
          const assignmentKey = extractScheduleKeyParts(assignment.canonicalScheduleKey || assignment.scheduleKey);
          if (!eventId) {
            eventId = ensureString(assignment.eventId || assignmentKey.eventId);
          }
          if (!scheduleId) {
            scheduleId = ensureString(assignment.scheduleId || assignmentKey.scheduleId);
          }
        }
      }
    }

    return { eventId, scheduleId };
  }

  /**
   * 現在アクティブなイベントと日程IDを基に正規化されたチャンネルキーを生成します。
   * @returns {string}
   */
  getCurrentScheduleKey() {
    const ensureString = (value) => String(value ?? "").trim();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const directKey = ensureString(this.app.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || "");
    if (directKey) {
      return directKey;
    }
    const { eventId, scheduleId } = this.getActiveChannel();
    const scheduleLabel = ensureString(
      this.app.state?.activeScheduleLabel || (contextConfirmed ? context.scheduleLabel : "") || ""
    );
    const entryId = ensureString(this.app.operatorPresenceSessionId);
    return this.app.derivePresenceScheduleKey(eventId, { scheduleId, scheduleLabel }, entryId);
  }

  /**
   * 送出端末のセッション状態から現在の割当情報を抽出します。
   * @returns {null|{ eventId: string, scheduleId: string, label: string, updatedAt?: number, lockedAt?: number }}
   */
  getDisplayAssignment() {
    const session = this.app.state?.displaySession || null;
    const rawAssignment = session && typeof session === "object" ? session.assignment || null : null;
    const candidate = rawAssignment && typeof rawAssignment === "object" ? rawAssignment : null;
    // デバッグ: sessionから直接eventIdを取得することを優先
    const sessionEventId = session && typeof session === "object" ? String(session.eventId || "").trim() : "";
    const sessionScheduleId = session && typeof session === "object" ? String(session.scheduleId || "").trim() : "";
    let eventId = String((candidate && candidate.eventId) || sessionEventId || "").trim();
    if (!eventId) {
      const fallbackFromKey = extractScheduleKeyParts((candidate && candidate.scheduleKey) || (session && session.scheduleKey));
      eventId = fallbackFromKey.eventId || "";
    }
    
    // デバッグログ: getDisplayAssignmentの処理状況
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[Operator] getDisplayAssignment processing", {
        hasSession: !!session,
        hasRawAssignment: !!rawAssignment,
        hasCandidate: !!candidate,
        sessionEventId: sessionEventId || "(empty)",
        sessionScheduleId: sessionScheduleId || "(empty)",
        candidateEventId: candidate ? String(candidate.eventId || "").trim() : null,
        resolvedEventId: eventId || "(empty)",
        activeEventId: String(this.app.state?.activeEventId || "").trim() || "(empty)"
      });
    }
    
    if (!eventId) {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[Operator] getDisplayAssignment returning null: no eventId");
      }
      return null;
    }
    // 現在選択中のイベントと一致しない場合はnullを返す
    // これにより、イベントを選んでいない場合や別のイベントの情報が表示されることを防ぐ
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    if (activeEventId && eventId !== activeEventId) {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[Operator] getDisplayAssignment returning null: eventId mismatch", {
          resolvedEventId: eventId,
          activeEventId: activeEventId
        });
      }
      return null;
    }
    // デバッグ: sessionから直接scheduleIdを取得することを優先
    let scheduleId = String((candidate && candidate.scheduleId) || sessionScheduleId || "").trim();
    const rawScheduleKey = String(
      (candidate && candidate.scheduleKey) || (session && session.scheduleKey) || ""
    ).trim();
    if (!scheduleId && rawScheduleKey) {
      const parsedFromKey = extractScheduleKeyParts(rawScheduleKey);
      if (parsedFromKey.scheduleId) {
        scheduleId = parsedFromKey.scheduleId;
      }
      if (!eventId && parsedFromKey.eventId) {
        eventId = parsedFromKey.eventId;
      }
    }
    const normalizedScheduleId = scheduleId ? normalizeScheduleId(scheduleId) : "";
    // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、candidate/sessionから直接取得をフォールバックとして使用）
    const fallbackScheduleLabel = String((candidate && candidate.scheduleLabel) || (session && session.scheduleLabel) || "").trim();
    const scheduleKeyForLabel = eventId && normalizedScheduleId ? `${eventId}::${normalizedScheduleId}` : "";
    const scheduleLabel = scheduleKeyForLabel
      ? this.resolveScheduleLabel(scheduleKeyForLabel, fallbackScheduleLabel, normalizedScheduleId) || fallbackScheduleLabel || normalizedScheduleId
      : fallbackScheduleLabel || normalizedScheduleId;
    const canonicalScheduleId = String(
      (candidate && candidate.canonicalScheduleId) ||
        (session && session.canonicalScheduleId) ||
        normalizedScheduleId ||
        ""
    ).trim();
    const canonicalScheduleKey = String(
      (candidate && candidate.canonicalScheduleKey) ||
        (session && session.canonicalScheduleKey) ||
        (eventId && normalizedScheduleId ? `${eventId}::${normalizedScheduleId}` : "") ||
        ""
    ).trim();
    const scheduleKey = rawScheduleKey || canonicalScheduleKey || (normalizedScheduleId || "");
    const lockedByUid = String((candidate && candidate.lockedByUid) || (session && session.lockedByUid) || "").trim();
    const lockedByName = String((candidate && candidate.lockedByName) || (session && session.lockedByName) || "").trim();
    const lockedAt = Number((candidate && candidate.lockedAt) || (session && session.lockedAt) || 0);
    return {
      eventId,
      scheduleId,
      scheduleLabel,
      scheduleKey,
      canonicalScheduleId,
      canonicalScheduleKey,
      lockedByUid,
      lockedByName,
      lockedAt
    };
  }

  /**
   * 日程キーから表示用ラベルを決定します。
   * メタデータが存在しない場合はフォールバックのラベルや日程IDを使用します。
   * @param {string} scheduleKey
   * @param {string} fallbackLabel
   * @param {string} fallbackScheduleId
   * @returns {string}
   */
  resolveScheduleLabel(scheduleKey, fallbackLabel = "", fallbackScheduleId = "") {
    const metadataMap = this.app.state?.scheduleMetadata instanceof Map ? this.app.state.scheduleMetadata : null;
    if (metadataMap && scheduleKey && metadataMap.has(scheduleKey)) {
      const meta = metadataMap.get(scheduleKey);
      const label = String(meta?.label || "").trim();
      if (label) {
        return label;
      }
    }
    const directLabel = String(fallbackLabel || "").trim();
    if (directLabel) {
      return directLabel;
    }
    const scheduleId = String(fallbackScheduleId || "").trim();
    if (scheduleId && scheduleId !== "__default_schedule__") {
      return scheduleId;
    }
    return "未選択";
  }

  /**
   * オペレーター視点での割当状況を判定し、UI表示用の説明文を組み立てます。
   * @returns {string}
   */
  describeChannelAssignment() {
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずに空文字列を返す
    // これにより、イベントを選んでいない状態で古いassignmentが表示されることを防ぐ
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    if (!activeEventId) {
      return "";
    }
    const assignment = this.app.state?.channelAssignment || this.getDisplayAssignment();
    if (!assignment || !assignment.eventId) {
      return "";
    }
    // 現在選択中のイベントと一致しない場合は空文字列を返す
    const assignmentEventId = String(assignment.eventId || "").trim();
    if (assignmentEventId !== activeEventId) {
      return "";
    }
    const eventId = assignmentEventId;
    const scheduleId = String(assignment.scheduleId || "").trim();
    const canonicalScheduleKey = String(assignment.canonicalScheduleKey || "").trim();
    const scheduleKey = canonicalScheduleKey || `${eventId}::${normalizeScheduleId(scheduleId)}`;
    const metadataMap = this.app.state?.scheduleMetadata instanceof Map ? this.app.state.scheduleMetadata : null;
    const eventsMap = this.app.state?.eventsById instanceof Map ? this.app.state.eventsById : null;
    let eventName = "";
    if (metadataMap && metadataMap.has(scheduleKey)) {
      eventName = String(metadataMap.get(scheduleKey)?.eventName || "").trim();
    }
    if (!eventName && eventsMap && eventsMap.has(eventId)) {
      eventName = String(eventsMap.get(eventId)?.name || "").trim();
    }
    const label = this.resolveScheduleLabel(scheduleKey, assignment.scheduleLabel, scheduleId);
    if (eventName && label) {
      return `「${eventName} / ${label}」`;
    }
    if (label) {
      return `「${label}」`;
    }
    if (eventName) {
      return `「${eventName}」`;
    }
    return "「指定された日程」";
  }

  /**
   * 表示端末がロックしているチャンネルとオペレーターの選択が矛盾しているか判定します。
   * @returns {boolean}
   */
  hasChannelMismatch() {
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずにnullにする
    // これにより、イベントを選んでいない状態で古いassignmentが評価されることを防ぐ
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    const assignment = activeEventId
      ? (this.app.state?.channelAssignment || this.getDisplayAssignment())
      : null;
    const debugAssignment = assignment
      ? {
          eventId: String(assignment.eventId || "").trim(),
          scheduleId: String(assignment.scheduleId || "").trim(),
          scheduleKey: String(assignment.scheduleKey || "").trim(),
          canonicalScheduleKey: String(assignment.canonicalScheduleKey || "").trim(),
          canonicalScheduleId: String(assignment.canonicalScheduleId || "").trim(),
          scheduleLabel: String(assignment.scheduleLabel || "").trim()
        }
      : null;
    const activeChannel = this.getActiveChannel();
    if (!assignment || (!assignment.eventId && !assignment.scheduleKey && !assignment.canonicalScheduleKey)) {
      if (typeof this.app.logScheduleDebug === "function") {
        this.app.logScheduleDebug("hasChannelMismatch", {
          assignment: debugAssignment,
          activeChannel,
          reason: "missing-assignment",
          result: true
        });
      }
      return true;
    }

    const rawScheduleKey = String(assignment.scheduleKey || "").trim();
    const canonicalScheduleKey = String(assignment.canonicalScheduleKey || "").trim();
    const parsedKey = extractScheduleKeyParts(rawScheduleKey || canonicalScheduleKey);
    const assignmentScheduleId = String(
      assignment.scheduleId || assignment.canonicalScheduleId || parsedKey.scheduleId || ""
    ).trim();
    const assignedEvent = String(assignment.eventId || parsedKey.eventId || "").trim();
    const normalizedAssignedSchedule = assignmentScheduleId ? normalizeScheduleId(assignmentScheduleId) : "";
    const normalizedCanonicalKey =
      assignedEvent && normalizedAssignedSchedule ? `${assignedEvent}::${normalizedAssignedSchedule}` : "";

    const candidateKeys = new Set();
    if (rawScheduleKey) {
      candidateKeys.add(rawScheduleKey);
    }
    if (canonicalScheduleKey) {
      candidateKeys.add(canonicalScheduleKey);
    }
    if (normalizedCanonicalKey) {
      candidateKeys.add(normalizedCanonicalKey);
    }
    const derivedFromAssignment = this.app.derivePresenceScheduleKey(
      assignedEvent,
      {
        scheduleKey: rawScheduleKey || canonicalScheduleKey,
        scheduleId: assignmentScheduleId,
        scheduleLabel: assignment.scheduleLabel
      },
      ""
    );
    if (derivedFromAssignment) {
      candidateKeys.add(derivedFromAssignment);
    }

    const currentKey = String(this.getCurrentScheduleKey() || "").trim();
    const details = {
      assignment: debugAssignment,
      assignedEvent,
      assignmentScheduleId,
      normalizedAssignedSchedule,
      normalizedCanonicalKey,
      candidateKeys: Array.from(candidateKeys),
      currentKey,
      metadataMatch: null,
      labelMatch: null
    };

    let mismatch = true;
    let reason = "no-match";

    if (currentKey) {
      if (candidateKeys.has(currentKey)) {
        mismatch = false;
        reason = "current-key";
      } else {
        const assignmentLabelKey = this.app.derivePresenceScheduleKey(
          assignedEvent,
          { scheduleLabel: assignment.scheduleLabel },
          ""
        );
        details.assignmentLabelKey = assignmentLabelKey || "";
        if (assignmentLabelKey && assignmentLabelKey === currentKey) {
          mismatch = false;
          reason = "assignment-label-key";
        } else {
          const labelMatch = currentKey.match(/^(.*)::label::(.+)$/);
          details.labelMatch = labelMatch ? { eventPart: labelMatch[1] || "", labelPart: labelMatch[2] || "" } : null;
          if (labelMatch) {
            const [, currentEventPart = "", labelPart = ""] = labelMatch;
            const currentEvent = String(currentEventPart || "").trim();
            if (!currentEvent || currentEvent === assignedEvent) {
              const labelValue = String(labelPart || "").trim();
              if (labelValue) {
                // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、assignmentから直接取得をフォールバックとして使用）
                const assignmentScheduleId = String(assignment.scheduleId || "").trim();
                const assignmentScheduleKey = String(assignment.scheduleKey || (assignedEvent && assignmentScheduleId ? `${assignedEvent}::${assignmentScheduleId}` : "") || "").trim();
                const fallbackAssignmentLabel = String(assignment.scheduleLabel || "").trim();
                const resolvedAssignmentLabel = assignmentScheduleKey
                  ? this.resolveScheduleLabel(assignmentScheduleKey, fallbackAssignmentLabel, assignmentScheduleId) || fallbackAssignmentLabel || assignmentScheduleId
                  : fallbackAssignmentLabel || assignmentScheduleId;
                const normalizedAssignmentLabel = sanitizePresenceLabel(resolvedAssignmentLabel);
                details.assignmentLabelNormalized = normalizedAssignmentLabel;
                if (normalizedAssignmentLabel && normalizedAssignmentLabel === labelValue) {
                  mismatch = false;
                  reason = "normalized-label";
                } else {
                  const metadataMap =
                    this.app.state?.scheduleMetadata instanceof Map ? this.app.state.scheduleMetadata : null;
                  if (metadataMap) {
                    const acceptableMetaKeys = new Set();
                    if (normalizedCanonicalKey) {
                      acceptableMetaKeys.add(normalizedCanonicalKey);
                    }
                    if (
                      canonicalScheduleKey &&
                      !canonicalScheduleKey.includes("::label::") &&
                      !canonicalScheduleKey.includes("::session::")
                    ) {
                      acceptableMetaKeys.add(canonicalScheduleKey);
                    }
                    for (const [metaKey, metaValue] of metadataMap.entries()) {
                      if (!assignedEvent || !metaKey.startsWith(`${assignedEvent}::`)) {
                        continue;
                      }
                      const candidateLabel = sanitizePresenceLabel(metaValue?.label);
                      if (candidateLabel && candidateLabel === labelValue) {
                        details.metadataMatch = { key: metaKey, label: candidateLabel };
                        if (!acceptableMetaKeys.size || acceptableMetaKeys.has(metaKey)) {
                          mismatch = false;
                          reason = "metadata-label";
                        }
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    details.activeChannel = activeChannel;

    if (mismatch) {
      const normalizedEvent = String(activeChannel?.eventId || "").trim();
      const currentSchedule = normalizeScheduleId(activeChannel?.scheduleId);
      const activeKey = normalizedEvent ? `${normalizedEvent}::${currentSchedule}` : "";
      details.activeKey = activeKey;
      if (!normalizedEvent) {
        reason = "missing-active-event";
        mismatch = true;
      } else if (activeKey && candidateKeys.has(activeKey)) {
        mismatch = false;
        reason = "active-key";
      } else if (assignedEvent && normalizedAssignedSchedule) {
        mismatch = assignedEvent !== normalizedEvent || normalizedAssignedSchedule !== currentSchedule;
        reason = mismatch ? "active-mismatch" : "active-match";
      } else {
        reason = "incomplete-assignment";
        mismatch = true;
      }
    }

    details.reason = reason;
    details.result = mismatch;

    if (typeof this.app.logScheduleDebug === "function") {
      this.app.logScheduleDebug("hasChannelMismatch", details);
    }
    return mismatch;
  }

  /**
   * displayセッションの割当変更をローカルstateに反映します。
   * レンダリングの更新とpresence評価を適宜行います。
   * @param {object|null} assignment
   */
  applyAssignmentLocally(assignment) {
    if (!assignment || typeof assignment !== "object") {
      return;
    }
    let eventId = String(assignment.eventId || "").trim();
    let scheduleId = String(assignment.scheduleId || "").trim();
    // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、assignmentから直接取得をフォールバックとして使用）
    const fallbackScheduleLabel = String(assignment.scheduleLabel || "").trim();
    const rawScheduleKey = String(assignment.scheduleKey || "").trim();
    const parsedKey = extractScheduleKeyParts(rawScheduleKey);
    if (!eventId && parsedKey.eventId) {
      eventId = parsedKey.eventId;
    }
    if (!scheduleId && parsedKey.scheduleId) {
      scheduleId = parsedKey.scheduleId;
    }
    // 現在選択中のイベントと一致しない場合は適用しない
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    if (activeEventId && eventId && eventId !== activeEventId) {
      // 別のイベントの割り当てのため、channelAssignmentをnullに設定
      this.app.state.channelAssignment = null;
      return;
    }
    const normalizedScheduleId = scheduleId ? normalizeScheduleId(scheduleId) : "";
    const canonicalScheduleKey = eventId && normalizedScheduleId ? `${eventId}::${normalizedScheduleId}` : "";
    const resolvedScheduleKey = rawScheduleKey || canonicalScheduleKey || (normalizedScheduleId || "");
    // 完全正規化: scheduleLabelは参照先から取得
    const resolvedScheduleLabel = resolvedScheduleKey
      ? this.resolveScheduleLabel(resolvedScheduleKey, fallbackScheduleLabel, normalizedScheduleId) || fallbackScheduleLabel || normalizedScheduleId
      : fallbackScheduleLabel || normalizedScheduleId;
    const enriched = {
      ...assignment,
      eventId,
      scheduleId,
      scheduleLabel: resolvedScheduleLabel,
      scheduleKey: resolvedScheduleKey,
      canonicalScheduleKey,
      canonicalScheduleId: normalizedScheduleId
    };
    const nextSession = {
      ...(this.app.state.displaySession || {}),
      assignment: enriched,
      eventId,
      scheduleId,
      scheduleLabel: resolvedScheduleLabel,
      scheduleKey: resolvedScheduleKey,
      canonicalScheduleKey,
      canonicalScheduleId: normalizedScheduleId
    };
    this.app.state.displaySession = nextSession;
    // イベントが選択されていない場合はnullに設定
    this.app.state.channelAssignment = activeEventId && eventId === activeEventId ? enriched : null;
    this.app.state.autoLockAttemptKey = "";
    this.app.state.autoLockAttemptAt = 0;
    if (typeof this.app.syncSideTelopToChannel === "function") {
      this.app.syncSideTelopToChannel();
    }
  }

  /**
   * 現在選択中のイベント/日程を送出端末にロックさせます。
   * サイレントモードや自動ロック時の挙動をオプションで制御します。
   * @param {string} eventId
   * @param {string} scheduleId
   * @param {string} scheduleLabel
   * @param {{ silent?: boolean, autoLock?: boolean, fromModal?: boolean }} options
   * @returns {Promise<object|null>}
   */
  async lockDisplayToSchedule(eventId, scheduleId, scheduleLabel, options = {}) {
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[lockDisplayToSchedule] Called", {
        eventId,
        scheduleId,
        scheduleLabel,
        options
      });
    }
    const normalizedEvent = String(eventId || "").trim();
    const normalizedSchedule = String(scheduleId || "").trim();
    const label = String(scheduleLabel || "").trim();
    const fromModal = options?.fromModal === true;
    const silent = options?.silent === true;
    const assetChecked = this.app.state.isDisplayAssetChecked === true;
    const assetAvailable = this.app.state.displayAssetAvailable !== false;
    if (assetChecked && !assetAvailable) {
      const message = "表示端末ページ（display.html）が配置されていないため固定できません。";
      if (fromModal && this.app.dom.conflictError) {
        this.app.dom.conflictError.textContent = message;
        this.app.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.app.toast(message, "error");
      }
      return;
    }
    if (!this.app.isTelopEnabled()) {
      const message = "テロップ操作なしモードでは固定できません。";
      if (fromModal && this.app.dom.conflictError) {
        this.app.dom.conflictError.textContent = message;
        this.app.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.app.toast(message, "error");
      }
      return;
    }
    if (!normalizedEvent) {
      const message = "イベントが選択されていないため固定できません。";
      if (fromModal && this.app.dom.conflictError) {
        this.app.dom.conflictError.textContent = message;
        this.app.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.app.toast(message, "error");
      }
      return;
    }
    if (!normalizedSchedule) {
      const message = "日程が選択されていないため固定できません。";
      if (fromModal && this.app.dom.conflictError) {
        this.app.dom.conflictError.textContent = message;
        this.app.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.app.toast(message, "error");
      }
      return;
    }
    if (this.app.state.isChannelLocking) {
      return;
    }
    this.app.state.isChannelLocking = true;
    this.app.renderChannelBanner();
    if (fromModal && this.app.dom.conflictConfirmButton) {
      this.app.dom.conflictConfirmButton.disabled = true;
    }
    if (fromModal && this.app.dom.conflictError) {
      this.app.dom.conflictError.hidden = true;
      this.app.dom.conflictError.textContent = "";
    }
    try {
      const response = await this.app.api.apiPost({
        action: "lockDisplaySchedule",
        eventId: normalizedEvent,
        scheduleId: normalizedSchedule,
        scheduleLabel: label,
        operatorName: String(this.app.operatorIdentity?.displayName || "").trim()
      });
      const normalizedScheduleId = normalizeScheduleId(normalizedSchedule);
      const fallbackLabel =
        label ||
        (normalizedScheduleId === "__default_schedule__"
          ? "未選択"
          : normalizedSchedule || normalizedScheduleId || normalizedEvent);
      const canonicalScheduleKey = `${normalizedEvent}::${normalizedScheduleId}`;
      const fallbackAssignment = {
        eventId: normalizedEvent,
        scheduleId: normalizedScheduleId,
        scheduleLabel: fallbackLabel,
        scheduleKey: canonicalScheduleKey,
        canonicalScheduleKey,
        canonicalScheduleId: normalizedScheduleId,
        lockedAt: Date.now(),
        lockedByUid: String(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "").trim(),
        lockedByEmail: String(this.app.operatorIdentity?.email || "").trim(),
        lockedByName:
          String(this.app.operatorIdentity?.displayName || "").trim() ||
          String(this.app.operatorIdentity?.email || "").trim()
      };
      const appliedAssignment = response && response.assignment ? response.assignment : fallbackAssignment;
      this.applyAssignmentLocally(appliedAssignment);
      const committedEventId = String(appliedAssignment?.eventId || normalizedEvent).trim();
      const committedScheduleId = normalizeScheduleId(appliedAssignment?.scheduleId || normalizedScheduleId);
      const committedLabel =
        String(appliedAssignment?.scheduleLabel || "").trim() || fallbackLabel || committedScheduleId;
      const committedKey = committedEventId && committedScheduleId ? `${committedEventId}::${committedScheduleId}` : "";
      if (this.app.state) {
        this.app.state.committedScheduleId = committedScheduleId;
        this.app.state.committedScheduleLabel = committedLabel;
        this.app.state.committedScheduleKey = committedKey;
      }
      this.app.pageContext = {
        ...(this.app.pageContext || {}),
        eventId: committedEventId,
        scheduleId: committedScheduleId,
        scheduleKey: committedKey,
        scheduleLabel: committedLabel,
        selectionConfirmed: true
      };
      this.app.markOperatorPresenceIntent(committedEventId, committedScheduleId, committedLabel);
      this.app.updateScheduleContext({
        presenceReason: "schedule-commit",
        presenceOptions: { allowFallback: false, publishSchedule: true },
        trackIntent: true,
        selectionConfirmed: true
      });
      const summary = this.describeChannelAssignment();
      
      // ログ出力: ディスプレイの日程情報
      const scheduleKey = committedKey || `${committedEventId}::${normalizeScheduleId(committedScheduleId)}`;
      const formattedDate = this.app.formatScheduleDateForLog(appliedAssignment, scheduleKey);
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log(`[Operator] ディスプレイの日程は${formattedDate}です (lockDisplayToSchedule完了)`, {
          eventId: committedEventId,
          scheduleId: committedScheduleId,
          scheduleLabel: committedLabel,
          scheduleKey,
          formattedDate
        });
      }
      
      if (!silent) {
        this.app.toast(summary ? `${summary}に固定しました。` : "ディスプレイのチャンネルを固定しました。", "success");
      }
      this.app.state.autoLockAttemptKey = "";
      this.app.state.autoLockAttemptAt = 0;
      if (fromModal) {
        this.app.snoozeConflictDialog(this.app.currentConflictSignature);
        this.app.closeConflictDialog();
      }
      return appliedAssignment;
    } catch (error) {
      logDisplayLinkError("Failed to lock display schedule", {
        eventId: normalizedEvent || null,
        scheduleId: normalizeScheduleId(normalizedSchedule) || null,
        error
      });
      const message = error?.message || "日程の固定に失敗しました。";
      if (fromModal && this.app.dom.conflictError) {
        this.app.dom.conflictError.textContent = message;
        this.app.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.app.toast(message, "error");
      }
    } finally {
      this.app.state.isChannelLocking = false;
      if (fromModal && this.app.dom.conflictConfirmButton) {
        this.app.dom.conflictConfirmButton.disabled = false;
      }
      this.app.renderChannelBanner();
      this.evaluateScheduleConflict();
    }
  }

  /**
   * 現在のpresence状況から衝突状態を特定するシグネチャを生成します。
   * シグネチャを使って前回の状態との差分を検出します。
   * @param {Array<{ key: string }>} options
   * @returns {string}
   */
  computeConflictSignature(options = []) {
    if (!Array.isArray(options) || options.length === 0) {
      return "";
    }
    const keys = options
      .map((option) => {
        if (!option || typeof option !== "object") {
          return "";
        }
        const key = String(option.key || "").trim();
        if (key) {
          return key;
        }
        const eventId = String(option.eventId || "").trim();
        const scheduleId = normalizeScheduleId(option.scheduleId || "");
        if (eventId && scheduleId) {
          return `${eventId}::${scheduleId}`;
        }
        return scheduleId || eventId;
      })
      .filter(Boolean)
      .sort();
    if (!keys.length) {
      return "";
    }
    return keys.join("|");
  }

  /**
   * 衝突状態が既にスヌーズされているか、または再通知不要かを判定します。
   * @param {string} signature
   * @param {Array} options
   * @param {{ uniqueKeys: Set<string>, channelAligned: boolean, assignmentAlignedKey: string }} meta
   * @returns {boolean}
   */
  isConflictDialogSnoozed(signature = "", options = [], { uniqueKeys = new Set(), channelAligned = false, assignmentAlignedKey = "" } = {}) {
    if (!signature || !this.app.conflictDialogSnoozedSignature) {
      return false;
    }
    if (signature !== this.app.conflictDialogSnoozedSignature) {
      return false;
    }
    if (!channelAligned) {
      return false;
    }
    const currentKey = this.getCurrentScheduleKey();
    if (!currentKey) {
      return false;
    }
    if (assignmentAlignedKey && assignmentAlignedKey !== currentKey) {
      return false;
    }
    if (uniqueKeys && !uniqueKeys.has(currentKey)) {
      return false;
    }
    const targetOption = Array.isArray(options) ? options.find((option) => option && option.key === currentKey) : null;
    if (!targetOption) {
      return false;
    }
    const members = Array.isArray(targetOption.members) ? targetOption.members : [];
    if (!members.some((member) => member && member.isSelf)) {
      return false;
    }
    return true;
  }

  /**
   * presence情報と割当を照合し、衝突ダイアログの表示や自動ロックを制御します。
   */
  evaluateScheduleConflict() {
    if (!this.app.isTelopEnabled()) {
      this.app.state.scheduleConflict = null;
      this.app.state.conflictSelection = "";
      this.app.closeConflictDialog();
      return;
    }
    const selectionConfirmed = this.app.state?.selectionConfirmed === true;
    // selectionConfirmedがfalseの場合、初期状態で何も選択されていないため、モーダルを表示しない
    if (!selectionConfirmed) {
      this.app.state.scheduleConflict = null;
      this.app.state.conflictSelection = "";
      this.app.closeConflictDialog();
      return;
    }
    const eventId = String(this.app.state?.activeEventId || "").trim();
    if (!eventId) {
      this.app.state.scheduleConflict = null;
      this.app.state.conflictSelection = "";
      this.app.closeConflictDialog();
      return;
    }
    const presenceMap = this.app.state?.operatorPresenceByUser instanceof Map ? this.app.state.operatorPresenceByUser : new Map();
    const groups = new Map();
    let latestPresenceAt = 0;
    const selfUid = String(this.app.operatorIdentity?.uid || auth.currentUser?.uid || "").trim();
    const selfSessionId = String(this.app.operatorPresenceSessionId || "").trim();
    presenceMap.forEach((value, entryId) => {
      if (!value) return;
      const valueEventId = String(value.eventId || "").trim();
      if (valueEventId && valueEventId !== eventId) return;
      const resolvedEventId = valueEventId || eventId;
      const scheduleId = String(value.scheduleId || "").trim();
      if (!scheduleId) {
        return;
      }
      const scheduleKey = this.app.derivePresenceScheduleKey(resolvedEventId, value, entryId);
      const label = this.resolveScheduleLabel(scheduleKey, value.scheduleLabel, value.scheduleId);
      const skipTelop = Boolean(value.skipTelop);
      const entry = groups.get(scheduleKey) || {
        key: scheduleKey,
        eventId: resolvedEventId || eventId,
        scheduleId,
        label,
        members: []
      };
      if (!groups.has(scheduleKey)) {
        groups.set(scheduleKey, entry);
      }
      entry.label = entry.label || label;
      const memberUid = String(value.uid || "").trim();
      const isSelfSession = selfSessionId && String(entryId) === selfSessionId;
      const isSelfUid = memberUid && memberUid === selfUid;
      const fallbackId = String(entryId);
      const updatedAt = Number(value.updatedAt || value.clientTimestamp || 0);
      if (updatedAt > latestPresenceAt) {
        latestPresenceAt = updatedAt;
      }
      entry.members.push({
        uid: memberUid || fallbackId,
        name: String(value.displayName || value.email || memberUid || fallbackId || "").trim() || memberUid || fallbackId,
        isSelf: Boolean(isSelfSession || isSelfUid),
        skipTelop,
        updatedAt
      });
    });
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずにnullにする
    // これにより、イベントを選んでいない状態で古いassignmentが表示されることを防ぐ
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    const assignment = activeEventId
      ? (this.app.state?.channelAssignment || this.getDisplayAssignment())
      : null;
    // 現在選択中のイベントと一致する場合のみ表示
    const assignmentEventId = assignment && assignment.eventId ? String(assignment.eventId || "").trim() : "";
    const assignmentKey = assignment && assignmentEventId === activeEventId && assignment.eventId
      ? `${assignment.eventId}::${normalizeScheduleId(assignment.scheduleId || "")}`
      : "";
    if (assignment && assignmentEventId === activeEventId && assignmentKey && !groups.has(assignmentKey)) {
      const label = this.resolveScheduleLabel(assignmentKey, assignment.scheduleLabel, assignment.scheduleId);
      groups.set(assignmentKey, {
        key: assignmentKey,
        eventId: assignment.eventId,
        scheduleId: String(assignment.scheduleId || ""),
        label,
        members: []
      });
    }
    const options = Array.from(groups.values());
    if (!options.length) {
      this.app.state.autoLockAttemptKey = "";
      this.app.state.autoLockAttemptAt = 0;
      this.app.state.scheduleConflict = null;
      this.app.state.conflictSelection = "";
      this.app.closeConflictDialog();
      this.app.currentConflictSignature = "";
      this.app.conflictDialogSnoozedSignature = "";
      return;
    }
    options.sort((a, b) => (a.label || "").localeCompare(b.label || "", "ja"));
    const conflictSignature = this.computeConflictSignature(options);
    if (conflictSignature && this.app.conflictDialogSnoozedSignature && conflictSignature !== this.app.conflictDialogSnoozedSignature) {
      this.app.conflictDialogSnoozedSignature = "";
    }
    this.app.currentConflictSignature = conflictSignature;
    const resolveOptionKey = (option) => {
      if (!option || typeof option !== "object") {
        return "";
      }
      const explicitKey = String(option.key || "").trim();
      if (explicitKey) {
        return explicitKey;
      }
      const optionEventId = String(option.eventId || eventId || "").trim();
      const optionScheduleId = normalizeScheduleId(option.scheduleId || "");
      if (optionEventId && optionScheduleId) {
        return `${optionEventId}::${optionScheduleId}`;
      }
      if (optionScheduleId) {
        return optionScheduleId;
      }
      return explicitKey;
    };

    const uniqueKeys = new Set(options.map((opt) => resolveOptionKey(opt) || ""));
    uniqueKeys.delete("");
    const presenceHasMultipleSchedules = uniqueKeys.size > 1;
    const hasPresence = options.length > 0;
    let channelAligned = !this.hasChannelMismatch();
    const assignmentTimestamp = Number(
      (this.app.state?.channelAssignment &&
        (this.app.state.channelAssignment.updatedAt || this.app.state.channelAssignment.lockedAt)) ||
        (assignment && (assignment.updatedAt || assignment.lockedAt)) ||
        0
    );
    const presenceNewerThanAssignment =
      latestPresenceAt > assignmentTimestamp || (assignmentTimestamp === 0 && hasPresence);
    const now = Date.now();
    const selfEntry = this.app.state?.operatorPresenceSelf || null;
    const selfEntrySessionId = String(selfEntry?.sessionId || this.app.operatorPresenceSessionId || "").trim();
    const selfEntryEventId = String(selfEntry?.eventId || eventId || "").trim();
    let selfPresenceKey = selfEntry
      ? this.app.derivePresenceScheduleKey(selfEntryEventId, selfEntry, selfEntrySessionId || selfEntry?.sessionId || "")
      : "";
    // selectionConfirmedがfalseの場合、getCurrentScheduleKey()から自動取得しない
    // これにより、初期状態で何も選択されていない場合はモーダルを表示しない
    if (!selfPresenceKey && selectionConfirmed) {
      selfPresenceKey = this.getCurrentScheduleKey();
    }

    let winningOption = null;
    let winningKey = "";
    if (assignmentKey && uniqueKeys.has(assignmentKey)) {
      winningKey = assignmentKey;
      winningOption = options.find((opt) => resolveOptionKey(opt) === assignmentKey) || null;
    }
    if (!winningKey) {
      let bestTimestamp = Number.POSITIVE_INFINITY;
      options.forEach((opt) => {
        const timestamps = Array.isArray(opt?.members)
          ? opt.members.map((member) => Number(member?.updatedAt || 0)).filter((value) => value > 0)
          : [];
        const earliest = timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
        if (!winningOption || earliest < bestTimestamp) {
          winningOption = opt;
          bestTimestamp = earliest;
        }
      });
      if (!winningOption && options.length) {
        winningOption = options[0];
      }
      winningKey = resolveOptionKey(winningOption);
    }
    const selfHasSchedule = !!selfPresenceKey;
    const selfOnWinning = Boolean(winningKey && selfPresenceKey && selfPresenceKey === winningKey);
    if (uniqueKeys.size === 1) {
      const [soleKeyCandidate] = uniqueKeys;
      let consensusOption = null;
      if (soleKeyCandidate) {
        consensusOption = options.find((opt) => opt && (opt.key === soleKeyCandidate || opt.scheduleId === soleKeyCandidate));
      }
      if (!consensusOption && options.length) {
        consensusOption = options[0];
      }
      if (consensusOption && selectionConfirmed) {
        const consensusEventId = String(consensusOption.eventId || eventId || "").trim();
        const consensusScheduleId = normalizeScheduleId(consensusOption.scheduleId || "");
        const consensusKey =
          String(consensusOption.key || "").trim() ||
          (consensusEventId && consensusScheduleId ? `${consensusEventId}::${consensusScheduleId}` : "");
        const currentKey = this.getCurrentScheduleKey();
        const needsAlignment = consensusKey && (currentKey !== consensusKey || !channelAligned);
        if (needsAlignment) {
          const assignmentMatches = assignmentKey && consensusKey ? assignmentKey === consensusKey : !assignmentKey;
          this.scheduleConsensusAdoption(consensusOption, {
            reason: assignmentMatches ? "assignment-align" : "consensus-adopt",
            presenceOptions: { allowFallback: false },
            publishPresence: true
          });
          if (!assignmentKey || assignmentMatches) {
            channelAligned = true;
          }
        }
      }
    }

    let shouldPrompt = false;
    if (hasPresence && presenceNewerThanAssignment && selfHasSchedule) {
      if (presenceHasMultipleSchedules) {
        shouldPrompt = !selfOnWinning;
      } else if (assignmentKey && (!uniqueKeys.has(assignmentKey) || !channelAligned)) {
        shouldPrompt = !selfOnWinning;
      } else if (!channelAligned && assignmentKey) {
        shouldPrompt = !selfOnWinning;
      }
    }
    const assignmentAlignedKey = assignmentKey && uniqueKeys.has(assignmentKey) ? assignmentKey : "";
    const suppressed = this.isConflictDialogSnoozed(conflictSignature, options, {
      uniqueKeys,
      channelAligned,
      assignmentAlignedKey
    });
    if (uniqueKeys.size === 1) {
      const soleOption = options[0] || null;
      const soleKey = soleOption?.key || "";
      const attemptKey = String(this.app.state?.autoLockAttemptKey || "").trim();
      const attemptAt = Number(this.app.state?.autoLockAttemptAt || 0);
      const recentlyAttempted = soleKey && attemptKey === soleKey && attemptAt && now - attemptAt < 15000;
      const targetEventId = String((soleOption?.eventId || eventId) || "").trim();
      const targetScheduleId = String(soleOption?.scheduleId || "").trim();
      const assignmentMatches = Boolean(assignmentKey && assignmentKey === soleKey && channelAligned);
      if (assignmentMatches) {
        this.app.state.autoLockAttemptKey = "";
        this.app.state.autoLockAttemptAt = 0;
      }
      const members = Array.isArray(soleOption?.members) ? soleOption.members : [];
      const hasTelopOperators = members.some((member) => member && !member.skipTelop);
      const canLock = Boolean(targetEventId && targetScheduleId && soleKey && hasTelopOperators);
      if (!assignmentMatches && canLock && !recentlyAttempted && !this.app.state.isChannelLocking) {
        this.app.state.autoLockAttemptKey = soleKey;
        this.app.state.autoLockAttemptAt = now;
        this.lockDisplayToSchedule(targetEventId, targetScheduleId, soleOption?.label || "", { silent: true, autoLock: true });
        return;
      }
    }
    if (!shouldPrompt) {
      this.app.state.scheduleConflict = null;
      this.app.state.conflictSelection = "";
      this.app.closeConflictDialog();
      if (!uniqueKeys.size) {
        this.app.conflictDialogSnoozedSignature = "";
      }
      return;
    }
    if (suppressed) {
      this.app.state.scheduleConflict = { eventId, assignmentKey, options };
      if (!this.app.state.conflictSelection || !uniqueKeys.has(this.app.state.conflictSelection)) {
        const preferredKey = this.getCurrentScheduleKey();
        if (uniqueKeys.has(preferredKey)) {
          this.app.state.conflictSelection = preferredKey;
        } else if (assignmentKey && uniqueKeys.has(assignmentKey)) {
          this.app.state.conflictSelection = assignmentKey;
        } else {
          this.app.state.conflictSelection = options[0]?.key || "";
        }
      }
      if (this.app.conflictDialogOpen) {
        this.app.closeConflictDialog();
      }
      return;
    }
    this.app.state.scheduleConflict = { eventId, assignmentKey, options };
    if (!this.app.state.conflictSelection || !uniqueKeys.has(this.app.state.conflictSelection)) {
      const preferredKey = this.getCurrentScheduleKey();
      if (uniqueKeys.has(preferredKey)) {
        this.app.state.conflictSelection = preferredKey;
      } else if (assignmentKey && uniqueKeys.has(assignmentKey)) {
        this.app.state.conflictSelection = assignmentKey;
      } else {
        this.app.state.conflictSelection = options[0]?.key || "";
      }
    }
    this.app.renderConflictDialog();
    if (!this.app.conflictDialogOpen) {
      this.app.openConflictDialog();
    }
  }

  /**
   * 衝突解消後に合意された日程へ自動的に合わせる処理を遅延実行でスケジュールします。
   * evaluateScheduleConflict内で直接stateを書き換えると再帰が発生するため、マイクロタスクで適用します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  scheduleConsensusAdoption(option, meta = {}) {
    if (!option || typeof option !== "object") {
      return;
    }
    const payload = {
      option: { ...option },
      meta: { ...meta }
    };
    this.app.pendingConsensusAdoption = payload;
    if (this.app.consensusAdoptionScheduled) {
      return;
    }
    this.app.consensusAdoptionScheduled = true;
    Promise.resolve().then(() => {
      this.app.consensusAdoptionScheduled = false;
      const pending = this.app.pendingConsensusAdoption;
      this.app.pendingConsensusAdoption = null;
      if (!pending || !pending.option) {
        return;
      }
      this.applyConsensusAdoption(pending.option, pending.meta || {});
    });
  }

  /**
   * 合意された日程をローカルstateとpresenceへ反映します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  applyConsensusAdoption(option, meta = {}) {
    if (!option || typeof option !== "object") {
      return;
    }
    const ensureString = (value) => String(value ?? "").trim();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const eventId = ensureString(
      option.eventId || this.app.state?.activeEventId || (contextConfirmed ? context.eventId : "") || ""
    );
    const scheduleIdRaw = ensureString(option.scheduleId || "");
    const scheduleId = normalizeScheduleId(scheduleIdRaw);
    const keyCandidate = ensureString(option.key);
    const scheduleKey = keyCandidate || (eventId && scheduleId ? `${eventId}::${scheduleId}` : "");
    if (!eventId || !scheduleId || !scheduleKey) {
      return;
    }

    const resolvedLabel = this.resolveScheduleLabel(scheduleKey, option.label, option.scheduleId);
    const reason = ensureString(meta.reason) || "consensus-adopt";
    const publishPresence = meta.publishPresence !== false;
    const presenceOptions = {
      allowFallback: false,
      ...(meta.presenceOptions || {})
    };

    const contextStart = ensureString(option.startAt || option.scheduleStart || this.app.pageContext?.startAt || "");
    const contextEnd = ensureString(option.endAt || option.scheduleEnd || this.app.pageContext?.endAt || "");

    this.app.pageContext = {
      ...(this.app.pageContext || {}),
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel: resolvedLabel,
      startAt: contextStart,
      endAt: contextEnd,
      selectionConfirmed: true
    };

    Questions.updateScheduleContext(this.app, {
      syncPresence: false,
      presenceOptions,
      selectionConfirmed: true
    });

    this.app.state.conflictSelection = scheduleKey;
    this.app.markOperatorPresenceIntent(eventId, scheduleId, resolvedLabel);

    if (publishPresence) {
      this.app.syncOperatorPresence(reason, {
        allowFallback: false,
        publishSchedule: true,
        useActiveSchedule: true
      });
    }

    // ディスプレイが接続されている場合、自動的にロックを試みる
    const displayActive = this.app.isDisplayOnline();
    if (displayActive && this.app.isTelopEnabled()) {
      const currentAssignment = this.app.state?.channelAssignment || this.getDisplayAssignment();
      const assignmentEventId = String(currentAssignment?.eventId || "").trim();
      const assignmentScheduleId = String(currentAssignment?.scheduleId || "").trim();
      const normalizedScheduleId = normalizeScheduleId(scheduleId);
      
      // ログ出力: 適用前の日程情報
      if (typeof console !== "undefined" && typeof console.log === "function") {
        const formattedDate = this.app.formatScheduleDateForLog({ eventId, scheduleId: normalizedScheduleId, scheduleLabel: resolvedLabel }, scheduleKey);
        console.log(`[Operator] ディスプレイの日程は${formattedDate}です (applyConsensusAdoption)`, {
          eventId,
          scheduleId: normalizedScheduleId,
          scheduleLabel: resolvedLabel,
          scheduleKey,
          formattedDate
        });
      }
      
      // 現在のassignmentと一致しない場合、またはassignmentが存在しない場合に自動ロック
      if (!currentAssignment || assignmentEventId !== eventId || assignmentScheduleId !== normalizedScheduleId) {
        this.lockDisplayToSchedule(eventId, scheduleId, resolvedLabel, { silent: true }).catch((err) => {
          // エラーが発生してもログに残すだけで、UI更新を阻害しない
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[applyConsensusAdoption] Failed to auto-lock display schedule:", err);
          }
        });
      }
    }
  }

  /**
   * チャンネル購読を更新します。
   * アクティブなチャンネルに基づいてレンダリング状態の監視を開始または更新します。
   */
  refreshChannelSubscriptions() {
    const { eventId, scheduleId } = this.getActiveChannel();
    // eventIdが必須のため、空の場合は購読を解除
    if (!eventId || !String(eventId).trim()) {
      if (this.app.renderUnsubscribe) {
        this.app.renderUnsubscribe();
        this.app.renderUnsubscribe = null;
      }
      this.app.currentRenderPath = null;
      this.app.updateRenderAvailability(null);
      return;
    }
    let path;
    try {
      path = getRenderStatePath(eventId, scheduleId);
    } catch (error) {
      console.error("Failed to get render state path:", error);
      if (this.app.renderUnsubscribe) {
        this.app.renderUnsubscribe();
        this.app.renderUnsubscribe = null;
      }
      this.app.currentRenderPath = null;
      this.app.updateRenderAvailability(null);
      return;
    }
    // イベントが変わった場合、セッション監視も更新する（複数イベントの同時操作に対応）
    const activeEventId = String(this.app.state?.activeEventId || "").trim();
    if (this.app.displaySessionSubscribedEventId !== activeEventId) {
      this.app.displaySessionSubscribedEventId = activeEventId;
      this.app.startDisplaySessionMonitor();
    }
    if (this.app.currentRenderPath !== path) {
      const normalizedEvent = String(eventId || "").trim();
      const normalizedSchedule = normalizeScheduleId(scheduleId || "");
      // logDisplayLinkInfo("Switching render subscription", {
      //   path,
      //   eventId: normalizedEvent || null,
      //   scheduleId: normalizedSchedule || null
      // });
    }
    if (this.app.currentRenderPath === path && this.app.renderUnsubscribe) {
      return;
    }
    if (this.app.renderUnsubscribe) {
      this.app.renderUnsubscribe();
      this.app.renderUnsubscribe = null;
    }
    this.app.currentRenderPath = path;
    this.app.updateRenderAvailability(null);
    const channelRef = getRenderRef(eventId, scheduleId);
    this.app.renderUnsubscribe = onValue(
      channelRef,
      (snapshot) => this.app.handleRenderUpdate(snapshot),
      (error) => {
        logDisplayLinkError("Render state monitor error", error);
      }
    );

    if (typeof this.app.startSideTelopListener === "function") {
      this.app.startSideTelopListener();
    }
    this.app.refreshOperatorPresenceSubscription();
    this.app.renderChannelBanner();
    this.evaluateScheduleConflict();
  }
}

