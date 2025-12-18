// gl-application-manager.js: GLツール用の応募管理機能
// gl-panel.js から分離（フェーズ2 段階3）

import {
  database,
  ref,
  onValue,
  set,
  push,
  update,
  serverTimestamp,
  getGlApplicationsRef
} from "../../operator/firebase.js";
import { ensureString } from "../helpers.js";
import { normalizeApplications } from "./gl-utils.js";

/**
 * GlApplicationManager: GLツールの応募管理を担当するクラス
 * GlToolManagerから応募管理機能を分離（フェーズ2 段階3）
 */
export class GlApplicationManager {
  constructor(context) {
    // コールバック関数
    this.onApplicationsLoaded = context.onApplicationsLoaded || (() => {});
    this.getCurrentEventId = context.getCurrentEventId || (() => "");
    this.getConfig = context.getConfig || (() => null);
    this.getDefaultSlug = context.getDefaultSlug || (() => "");
    
    // 状態
    this.applicationsUnsubscribe = null;
  }

  /**
   * 応募データの読み込みを開始
   * @param {string} eventId - イベントID
   */
  subscribeApplications(eventId) {
    this.unsubscribeApplications();
    if (!eventId) {
      this.onApplicationsLoaded([]);
      return;
    }
    this.applicationsUnsubscribe = onValue(getGlApplicationsRef(eventId), (snapshot) => {
      const applications = normalizeApplications(snapshot.val() || {});
      this.onApplicationsLoaded(applications);
    });
  }

  /**
   * 応募データの読み込みを停止
   */
  unsubscribeApplications() {
    if (typeof this.applicationsUnsubscribe === "function") {
      this.applicationsUnsubscribe();
      this.applicationsUnsubscribe = null;
    }
  }

  /**
   * 内部スタッフを保存（追加または更新）
   * @param {Object} data - フォームデータ
   * @param {string} editingId - 編集中のID（更新時のみ）
   * @param {Array} applications - 既存の応募データ配列
   * @returns {Promise<void>}
   */
  async saveInternalApplication(data, editingId, applications) {
    const eventId = this.getCurrentEventId();
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    if (!data) {
      throw new Error("データが無効です。");
    }
    const existing = applications.find((entry) => ensureString(entry.id) === ensureString(editingId));
    const config = this.getConfig();
    const slug = ensureString(config?.slug) || this.getDefaultSlug();
    const basePath = `glIntake/applications/${eventId}`;
    const targetRef = existing
      ? ref(database, `${basePath}/${existing.id}`)
      : push(ref(database, basePath));
    
    // 完全正規化: eventNameは削除（eventIdから取得可能）
    const payload = {
      name: data.name,
      phonetic: data.phonetic,
      email: data.email,
      grade: data.grade,
      gender: data.gender,
      faculty: data.faculty,
      department: data.department,
      academicPath: Array.isArray(data.academicPath) ? data.academicPath : [],
      club: data.club,
      studentId: data.studentId,
      note: data.note,
      shifts: data.shifts,
      sourceType: "internal",
      eventId,
      slug,
      createdAt: existing?.raw?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    // 空のフィールドを削除
    if (!payload.note) {
      delete payload.note;
    }
    if (!payload.club) {
      delete payload.club;
    }
    if (!payload.studentId) {
      delete payload.studentId;
    }
    if (!payload.phonetic) {
      delete payload.phonetic;
    }
    if (!payload.grade) {
      delete payload.grade;
    }
    if (!payload.gender) {
      delete payload.gender;
    }
    if (!payload.department) {
      delete payload.department;
    }
    if (!Array.isArray(payload.academicPath) || !payload.academicPath.length) {
      delete payload.academicPath;
    }
    
    await set(targetRef, payload);
  }

  /**
   * 内部スタッフを削除
   * @param {string} applicationId - 削除する応募ID
   * @param {Map} assignments - 割り当てデータ
   * @returns {Promise<void>}
   */
  async deleteInternalApplication(applicationId, assignments) {
    const eventId = this.getCurrentEventId();
    // イベントIDが空文字列でないことを確認（空文字列だとルートパスへの更新となり権限エラーになる）
    if (!eventId || String(eventId).trim() === "") {
      throw new Error("イベントIDが無効です。");
    }
    // 応募IDが空文字列でないことを確認（空文字列だとルートパスへの更新となり権限エラーになる）
    if (!applicationId || String(applicationId).trim() === "") {
      throw new Error("応募IDが無効です。");
    }
    const trimmedEventId = String(eventId).trim();
    const trimmedApplicationId = String(applicationId).trim();
    const updates = {};
    updates[`glIntake/applications/${trimmedEventId}/${trimmedApplicationId}`] = null;
    
    const assignmentEntry = assignments.get(applicationId);
    if (assignmentEntry) {
      if (assignmentEntry.schedules instanceof Map) {
        assignmentEntry.schedules.forEach((_, scheduleId) => {
          // 空文字列のスケジュールIDを除外して、不正なパスが生成されるのを防ぐ
          const trimmedScheduleId = String(scheduleId || "").trim();
          if (trimmedScheduleId) {
            updates[`glAssignments/${trimmedEventId}/${trimmedScheduleId}/${trimmedApplicationId}`] = null;
          }
        });
      }
      if (assignmentEntry.fallback) {
        updates[`glAssignments/${trimmedEventId}/${trimmedApplicationId}`] = null;
      }
    }
    
    await update(ref(database), updates);
  }
}

