// channel-manager.js: チャンネルとスケジュール管理を担当します。
import { normalizeScheduleId } from "../shared/channel-paths.js";

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
    const ensure = (value) => String(value ?? "").trim();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    let eventId = ensure(this.app.state?.activeEventId || (contextConfirmed ? context.eventId : ""));
    let scheduleId = ensure(this.app.state?.activeScheduleId || (contextConfirmed ? context.scheduleId : ""));

    if (!eventId || !scheduleId) {
      const scheduleKey = ensure(
        this.app.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || ""
      );
      if (scheduleKey) {
        const parts = extractScheduleKeyParts(scheduleKey);
        if (!eventId && parts.eventId) {
          eventId = ensure(parts.eventId);
        }
        if (!scheduleId && parts.scheduleId) {
          scheduleId = ensure(parts.scheduleId);
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
                  scheduleId = ensure(resolved.scheduleId);
                }
                if (!eventId && resolved.eventId) {
                  eventId = ensure(resolved.eventId);
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
            eventId = ensure(assignment.eventId || assignmentKey.eventId);
          }
          if (!scheduleId) {
            scheduleId = ensure(assignment.scheduleId || assignmentKey.scheduleId);
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
    const ensure = (value) => String(value ?? "").trim();
    const context = this.app.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const directKey = ensure(this.app.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || "");
    if (directKey) {
      return directKey;
    }
    const { eventId, scheduleId } = this.getActiveChannel();
    const scheduleLabel = ensure(
      this.app.state?.activeScheduleLabel || (contextConfirmed ? context.scheduleLabel : "") || ""
    );
    const entryId = ensure(this.app.operatorPresenceSessionId);
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
}

