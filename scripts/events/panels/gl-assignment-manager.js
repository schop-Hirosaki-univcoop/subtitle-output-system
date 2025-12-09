// gl-assignment-manager.js: GLツール用の割り当て管理機能
// gl-panel.js から分離（フェーズ2 段階4）

import {
  database,
  ref,
  onValue,
  update,
  serverTimestamp,
  getGlAssignmentsRef
} from "../../operator/firebase.js";
import { ensureString } from "../helpers.js";
import {
  normalizeAssignmentSnapshot,
  resolveAssignmentStatus,
  resolveEffectiveAssignmentValue,
  ASSIGNMENT_VALUE_ABSENT,
  ASSIGNMENT_VALUE_STAFF,
  ASSIGNMENT_VALUE_UNAVAILABLE,
  ASSIGNMENT_BUCKET_UNASSIGNED,
  ASSIGNMENT_BUCKET_ABSENT,
  ASSIGNMENT_BUCKET_STAFF,
  ASSIGNMENT_BUCKET_UNAVAILABLE
} from "./gl-utils.js";

/**
 * GlAssignmentManager: GLツールの割り当て管理を担当するクラス
 * GlToolManagerから割り当て管理機能を分離（フェーズ2 段階4）
 */
export class GlAssignmentManager {
  constructor(context) {
    // コールバック関数
    this.onAssignmentsLoaded = context.onAssignmentsLoaded || (() => {});
    this.getCurrentEventId = context.getCurrentEventId || (() => "");
    this.getCurrentUser = context.getCurrentUser || (() => null);
    
    // 状態
    this.assignmentsUnsubscribe = null;
  }

  /**
   * 割り当てデータの読み込みを開始
   * @param {string} eventId - イベントID
   */
  subscribeAssignments(eventId) {
    this.unsubscribeAssignments();
    if (!eventId) {
      this.onAssignmentsLoaded(new Map());
      return;
    }
    this.assignmentsUnsubscribe = onValue(getGlAssignmentsRef(eventId), (snapshot) => {
      const assignments = normalizeAssignmentSnapshot(snapshot.val() || {});
      this.onAssignmentsLoaded(assignments);
    });
  }

  /**
   * 割り当てデータの読み込みを停止
   */
  unsubscribeAssignments() {
    if (typeof this.assignmentsUnsubscribe === "function") {
      this.assignmentsUnsubscribe();
      this.assignmentsUnsubscribe = null;
    }
  }

  /**
   * 特定のスケジュールに対する割り当てを取得
   * @param {Map} assignments - 割り当てデータのMap
   * @param {string} glId - 応募者ID
   * @param {string} scheduleId - スケジュールID
   * @returns {Object|null} 割り当てオブジェクト
   */
  getAssignmentForSchedule(assignments, glId, scheduleId) {
    if (!glId) {
      return null;
    }
    const entry = assignments.get(glId) || null;
    if (!entry) {
      return null;
    }
    const scheduleKey = ensureString(scheduleId);
    if (scheduleKey && entry.schedules instanceof Map && entry.schedules.has(scheduleKey)) {
      return entry.schedules.get(scheduleKey) || null;
    }
    return entry.fallback || null;
  }

  /**
   * 割り当て値をバケットキーに解決
   * @param {string} value - 割り当て値
   * @param {boolean} available - 利用可能かどうか
   * @returns {string} バケットキー
   */
  resolveAssignmentBucket(value, available) {
    if (value === ASSIGNMENT_VALUE_ABSENT) {
      return ASSIGNMENT_BUCKET_ABSENT;
    }
    if (value === ASSIGNMENT_VALUE_STAFF) {
      return ASSIGNMENT_BUCKET_STAFF;
    }
    if (value === ASSIGNMENT_VALUE_UNAVAILABLE) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    if (value) {
      return `team:${value}`;
    }
    if (!available) {
      return ASSIGNMENT_BUCKET_UNAVAILABLE;
    }
    return ASSIGNMENT_BUCKET_UNASSIGNED;
  }

  /**
   * バケットマッチャーを作成
   * @param {string} filter - フィルタ値
   * @returns {Function} マッチ関数
   */
  createBucketMatcher(filter) {
    if (filter === "unassigned") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_UNASSIGNED;
    }
    if (filter === "assigned") {
      return (bucket) => bucket.startsWith("team:");
    }
    if (filter === "absent") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_ABSENT;
    }
    if (filter === "staff") {
      return (bucket) => bucket === ASSIGNMENT_BUCKET_STAFF;
    }
    return () => true;
  }

  /**
   * 割り当てを適用
   * @param {string} glId - 応募者ID
   * @param {string} scheduleId - スケジュールID
   * @param {string} value - 割り当て値
   * @returns {Promise<void>}
   */
  async applyAssignment(glId, scheduleId, value) {
    const eventId = this.getCurrentEventId();
    if (!eventId || !glId || !scheduleId) {
      throw new Error("イベント、応募者ID、またはスケジュールIDが無効です。");
    }
    const { status, teamId } = resolveAssignmentStatus(value);
    const basePath = `glAssignments/${eventId}/${scheduleId}/${glId}`;
    if (!status && !teamId) {
      await update(ref(database), {
        [basePath]: null
      });
      return;
    }
    const user = this.getCurrentUser();
    const payload = {
      status,
      teamId,
      updatedAt: serverTimestamp(),
      updatedByUid: ensureString(user?.uid),
      updatedByName: ensureString(user?.displayName) || ensureString(user?.email)
    };
    await update(ref(database), {
      [basePath]: payload
    });
  }
}

