// gl-manager.js: GL 関連の機能を担当します。
export class GlManager {
  constructor(context) {
    this.state = context.state;
    
    // 依存関数
    this.normalizeKey = context.normalizeKey;
    this.fetchDbValue = context.fetchDbValue;
    this.renderParticipants = context.renderParticipants;
    
    // 定数
    this.CANCEL_LABEL = context.CANCEL_LABEL;
    this.GL_STAFF_GROUP_KEY = context.GL_STAFF_GROUP_KEY;
    this.GL_STAFF_LABEL = context.GL_STAFF_LABEL;
    
    // 内部状態
    this.glDataFetchCache = new Map();
  }

  /**
   * イベント GL 名簿の取得
   * @param {string} eventId - イベントID
   * @returns {Map|null} GL名簿マップ
   */
  getEventGlRoster(eventId) {
    if (!(this.state.glRoster instanceof Map)) {
      this.state.glRoster = new Map();
    }
    const roster = this.state.glRoster.get(eventId);
    return roster instanceof Map ? roster : null;
  }

  /**
   * イベント GL 割り当てマップの取得
   * @param {string} eventId - イベントID
   * @returns {Map|null} GL割り当てマップ
   */
  getEventGlAssignmentsMap(eventId) {
    if (!(this.state.glAssignments instanceof Map)) {
      this.state.glAssignments = new Map();
    }
    const assignments = this.state.glAssignments.get(eventId);
    return assignments instanceof Map ? assignments : null;
  }

  /**
   * GL 名簿の正規化
   * @param {Object} raw - 生データ
   * @returns {Map} 正規化されたGL名簿マップ
   */
  normalizeGlRoster(raw) {
    const map = new Map();
    if (!raw || typeof raw !== "object") {
      return map;
    }
    Object.entries(raw).forEach(([glId, value]) => {
      if (!glId || !value || typeof value !== "object") return;
      map.set(String(glId), {
        id: String(glId),
        name: this.normalizeKey(value.name || value.fullName || ""),
        phonetic: this.normalizeKey(value.phonetic || value.furigana || ""),
        grade: this.normalizeKey(value.grade || ""),
        faculty: this.normalizeKey(value.faculty || ""),
        department: this.normalizeKey(value.department || ""),
        email: this.normalizeKey(value.email || ""),
        club: this.normalizeKey(value.club || ""),
        sourceType: value.sourceType === "internal" ? "internal" : "external"
      });
    });
    return map;
  }

  /**
   * GL 割り当てエントリの正規化
   * @param {Object} raw - 生データ
   * @returns {Object|null} 正規化されたGL割り当てエントリ
   */
  normalizeGlAssignmentEntry(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const statusRaw = String(raw.status || "").trim().toLowerCase();
    let status = "";
    if (statusRaw === "absent" || statusRaw === "欠席") {
      status = "absent";
    } else if (statusRaw === "unavailable" || statusRaw === "参加不可") {
      status = "unavailable";
    } else if (statusRaw === "staff" || statusRaw === "運営" || statusRaw === "運営待機") {
      status = "staff";
    } else if (statusRaw === "team") {
      status = "team";
    }
    const teamId = this.normalizeKey(raw.teamId || "");
    if (!status && teamId) {
      status = "team";
    }
    if (!status && !teamId) {
      return null;
    }
    return {
      status,
      teamId,
      updatedAt: Number(raw.updatedAt || 0) || 0,
      updatedByName: this.normalizeKey(raw.updatedByName || ""),
      updatedByUid: this.normalizeKey(raw.updatedByUid || "")
    };
  }

  /**
   * GL 割り当ての正規化
   * @param {Object} raw - 生データ
   * @returns {Map} 正規化されたGL割り当てマップ
   */
  normalizeGlAssignments(raw) {
    const map = new Map();
    if (!raw || typeof raw !== "object") {
      return map;
    }

    const ensureEntry = (glId) => {
      const id = String(glId || "").trim();
      if (!id) {
        return null;
      }
      if (!map.has(id)) {
        map.set(id, { fallback: null, schedules: new Map() });
      }
      return map.get(id) || null;
    };

    Object.entries(raw).forEach(([outerKey, outerValue]) => {
      if (!outerValue || typeof outerValue !== "object") {
        return;
      }

      const legacyAssignment = this.normalizeGlAssignmentEntry(outerValue);
      if (legacyAssignment) {
        const entry = ensureEntry(outerKey);
        if (!entry) {
          return;
        }
        entry.fallback = legacyAssignment;
        const excludedKeys = new Set(["status", "teamId", "updatedAt", "updatedByUid", "updatedByName", "schedules"]);
        Object.entries(outerValue).forEach(([scheduleId, scheduleValue]) => {
          if (excludedKeys.has(scheduleId)) {
            return;
          }
          const normalized = this.normalizeGlAssignmentEntry(scheduleValue);
          if (!normalized) {
            return;
          }
          const key = String(scheduleId || "").trim();
          if (!key) {
            return;
          }
          entry.schedules.set(key, normalized);
        });
        const scheduleOverrides = outerValue?.schedules && typeof outerValue.schedules === "object"
          ? outerValue.schedules
          : null;
        if (scheduleOverrides) {
          Object.entries(scheduleOverrides).forEach(([scheduleId, scheduleValue]) => {
            const normalized = this.normalizeGlAssignmentEntry(scheduleValue);
            if (!normalized) {
              return;
            }
            const key = String(scheduleId || "").trim();
            if (!key) {
              return;
            }
            entry.schedules.set(key, normalized);
          });
        }
        return;
      }

      const scheduleId = String(outerKey || "").trim();
      if (!scheduleId) {
        return;
      }
      Object.entries(outerValue).forEach(([glId, value]) => {
        const normalized = this.normalizeGlAssignmentEntry(value);
        if (!normalized) {
          return;
        }
        const entry = ensureEntry(glId);
        if (!entry) {
          return;
        }
        entry.schedules.set(scheduleId, normalized);
      });
    });

    return map;
  }

  /**
   * スケジュール割り当ての解決
   * @param {Object} entry - GL割り当てエントリ
   * @param {string} scheduleId - スケジュールID
   * @returns {Object|null} 割り当て情報
   */
  resolveScheduleAssignment(entry, scheduleId) {
    if (!entry) {
      return null;
    }
    const key = String(scheduleId || "").trim();
    if (key && entry.schedules instanceof Map && entry.schedules.has(key)) {
      return entry.schedules.get(key) || null;
    }
    return entry.fallback || null;
  }

  /**
   * グループ GL リーダーの収集
   * @param {string} groupKey - グループキー
   * @param {Object} options - オプション
   * @param {string} options.eventId - イベントID
   * @param {Map} options.rosterMap - GL名簿マップ（オプション）
   * @param {Map} options.assignmentsMap - GL割り当てマップ（オプション）
   * @param {string} options.scheduleId - スケジュールID
   * @returns {Array} GLリーダー配列
   */
  collectGroupGlLeaders(groupKey, { eventId, rosterMap, assignmentsMap, scheduleId }) {
    const assignments = assignmentsMap instanceof Map ? assignmentsMap : this.getEventGlAssignmentsMap(eventId);
    const roster = rosterMap instanceof Map ? rosterMap : this.getEventGlRoster(eventId);
    if (!(assignments instanceof Map) || !(roster instanceof Map)) {
      return [];
    }

    const rawGroupKey = String(groupKey || "").trim();
    const normalizedGroupKey = this.normalizeKey(rawGroupKey);
    const normalizedCancelLabel = this.normalizeKey(this.CANCEL_LABEL);
    const normalizedStaffLabel = this.normalizeKey(this.GL_STAFF_LABEL);
    const isCancelGroup = normalizedGroupKey === normalizedCancelLabel;
    const isStaffGroup = rawGroupKey === this.GL_STAFF_GROUP_KEY || normalizedGroupKey === normalizedStaffLabel;

    const leaders = [];
    assignments.forEach((entry, glId) => {
      const assignment = this.resolveScheduleAssignment(entry, scheduleId);
      if (!assignment) return;
      const status = assignment.status || "";
      const teamId = this.normalizeKey(assignment.teamId || "");
      if (status === "team") {
        if (!teamId || isCancelGroup || isStaffGroup || teamId !== normalizedGroupKey) {
          return;
        }
      } else if (status === "absent") {
        if (!isCancelGroup) return;
      } else if (status === "staff") {
        if (!isStaffGroup) return;
      } else {
        return;
      }

      const profile = roster.get(String(glId)) || {};
      const name = profile.name || String(glId);
      const metaParts = [];
      if (status === "absent") {
        metaParts.push("欠席");
      } else if (status === "staff") {
        metaParts.push(this.GL_STAFF_LABEL);
      }
      if (profile.faculty) {
        metaParts.push(profile.faculty);
      }
      if (profile.department && profile.department !== profile.faculty) {
        metaParts.push(profile.department);
      }
      leaders.push({
        name,
        meta: metaParts.join(" / ")
      });
    });

    leaders.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
    return leaders;
  }

  /**
   * グループ GL 割り当ての描画
   * @param {Object} group - グループオブジェクト
   * @param {Object} context - コンテキスト
   */
  renderGroupGlAssignments(group, context) {
    if (!group || !group.leadersContainer || !group.leadersList) {
      return;
    }
    const container = group.leadersContainer;
    const list = group.leadersList;
    list.innerHTML = "";
    container.hidden = true;
    container.dataset.count = "0";

    const leaders = this.collectGroupGlLeaders(group.key, context);
    if (!leaders.length) {
      return;
    }

    leaders.forEach(leader => {
      const item = document.createElement("span");
      item.className = "participant-group-gl";
      const nameEl = document.createElement("span");
      nameEl.className = "participant-group-gl__name";
      nameEl.textContent = leader.name;
      item.appendChild(nameEl);
      if (leader.meta) {
        const metaEl = document.createElement("span");
        metaEl.className = "participant-group-gl__meta";
        metaEl.textContent = leader.meta;
        item.appendChild(metaEl);
      }
      list.appendChild(item);
    });

    container.hidden = false;
    container.dataset.count = String(leaders.length);
  }

  /**
   * イベント GL データの読み込み
   * @param {string} eventId - イベントID
   * @param {Object} options - オプション
   * @param {boolean} options.force - 強制再読み込み
   */
  async loadGlDataForEvent(eventId, { force = false } = {}) {
    const key = this.normalizeKey(eventId || "");
    if (!key) {
      return;
    }
    if (!force && this.glDataFetchCache.has(key)) {
      try {
        await this.glDataFetchCache.get(key);
      } catch (error) {
        // Swallow errors from prior attempts; a manual refresh will retry.
      }
      return;
    }

    const fetchPromise = (async () => {
      try {
        const [applicationsRaw, assignmentsRaw] = await Promise.all([
          this.fetchDbValue(`glIntake/applications/${key}`),
          this.fetchDbValue(`glAssignments/${key}`)
        ]);
        const rosterMap = this.normalizeGlRoster(applicationsRaw || {});
        const assignmentsMap = this.normalizeGlAssignments(assignmentsRaw || {});
        if (!(this.state.glRoster instanceof Map)) {
          this.state.glRoster = new Map();
        }
        if (!(this.state.glAssignments instanceof Map)) {
          this.state.glAssignments = new Map();
        }
        this.state.glRoster.set(key, rosterMap);
        this.state.glAssignments.set(key, assignmentsMap);
      } catch (error) {
        console.error("Failed to load GL roster", error);
        if (!(this.state.glRoster instanceof Map)) {
          this.state.glRoster = new Map();
        }
        if (!(this.state.glAssignments instanceof Map)) {
          this.state.glAssignments = new Map();
        }
        if (!this.state.glRoster.has(key)) {
          this.state.glRoster.set(key, new Map());
        }
        if (!this.state.glAssignments.has(key)) {
          this.state.glAssignments.set(key, new Map());
        }
        throw error;
      } finally {
        if (this.state.selectedEventId && this.normalizeKey(this.state.selectedEventId) === key) {
          this.renderParticipants();
        }
      }
    })();

    this.glDataFetchCache.set(key, fetchPromise);
    try {
      await fetchPromise;
    } finally {
      this.glDataFetchCache.delete(key);
    }
  }
}

