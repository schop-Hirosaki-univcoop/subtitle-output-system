// gl-config-manager.js: GLツール用の設定管理機能
// gl-panel.js から分離（フェーズ2 段階5）

import {
  database,
  ref,
  onValue,
  update,
  get,
  serverTimestamp,
  getGlEventConfigRef
} from "../../operator/firebase.js";
import { ensureString } from "../helpers.js";
import { normalizeFacultyList } from "../tools/gl-faculty-utils.js";
import {
  toTimestamp,
  parseTeamCount,
  buildSequentialTeams,
  normalizeScheduleConfig,
  sanitizeTeamList,
  normalizeScheduleTeamConfig,
  deriveTeamCountFromConfig,
  sanitizeScheduleEntries,
  buildScheduleConfigMap,
  createSignature
} from "./gl-utils.js";

/**
 * GlConfigManager: GLツールの設定管理を担当するクラス
 * GlToolManagerから設定管理機能を分離（フェーズ2 段階5）
 */
export class GlConfigManager {
  constructor(context) {
    // コールバック関数
    this.onConfigLoaded = context.onConfigLoaded || (() => {});
    this.getCurrentEventId = context.getCurrentEventId || (() => "");
    this.getDefaultSlug = context.getDefaultSlug || (() => "");
    this.getAvailableSchedules = context.getAvailableSchedules || (() => []);
    this.collectScheduleTeamSettings = context.collectScheduleTeamSettings || (() => ({}));
    this.setStatus = context.setStatus || (() => {});
    this.getConfig = context.getConfig || (() => null);
    
    // 状態
    this.configUnsubscribe = null;
  }

  /**
   * 設定データの読み込みを開始
   * @param {string} eventId - イベントID
   */
  subscribeConfig(eventId) {
    this.unsubscribeConfig();
    if (!eventId) {
      this.onConfigLoaded(null);
      return;
    }
    this.configUnsubscribe = onValue(getGlEventConfigRef(eventId), (snapshot) => {
      const config = this.normalizeConfig(snapshot.val() || {});
      this.onConfigLoaded(config);
    });
  }

  /**
   * 設定データの読み込みを停止
   */
  unsubscribeConfig() {
    if (typeof this.configUnsubscribe === "function") {
      this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
  }

  /**
   * 設定データを正規化
   * @param {Object} raw - 生の設定データ
   * @returns {Object} 正規化された設定データ
   */
  normalizeConfig(raw) {
    const config = raw && typeof raw === "object" ? raw : {};
    const schedules = normalizeScheduleConfig(config.schedules);
    const defaultTeams = sanitizeTeamList(config.defaultTeams || config.teams || []);
    const scheduleTeams = normalizeScheduleTeamConfig(config.scheduleTeams || {}, defaultTeams);
    return {
      slug: ensureString(config.slug),
      faculties: normalizeFacultyList(config.faculties || []),
      teams: defaultTeams,
      defaultTeams,
      scheduleTeams,
      schedules,
      startAt: config.startAt || "",
      endAt: config.endAt || "",
      guidance: ensureString(config.guidance),
      updatedAt: Number(config.updatedAt) || 0,
      createdAt: Number(config.createdAt) || 0
    };
  }

  /**
   * 設定を保存
   * @param {Object} formData - フォームデータ
   * @param {Object} currentConfig - 現在の設定
   * @returns {Promise<void>}
   */
  async saveConfig(formData, currentConfig) {
    const eventId = this.getCurrentEventId();
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    const slug = this.getDefaultSlug();
    const { count: teamCount, error: teamError } = parseTeamCount(formData.teamCount);
    if (teamError) {
      throw new Error(teamError);
    }
    const teams = buildSequentialTeams(teamCount);
    const previousSlug = ensureString(currentConfig?.slug);
    
    // スラッグの重複チェック
    if (slug) {
      const slugSnapshot = await get(ref(database, `glIntake/slugIndex/${slug}`));
      const ownerEventId = ensureString(slugSnapshot.val());
      if (ownerEventId && ownerEventId !== eventId) {
        throw new Error("同じイベントIDが別のGLフォームに割り当てられています。イベント設定を確認してください。");
      }
    }
    
    const scheduleSummaryList = sanitizeScheduleEntries(
      this.getAvailableSchedules({ includeConfigFallback: true })
    );
    const scheduleSummary = buildScheduleConfigMap(scheduleSummaryList);
    const scheduleTeams = this.collectScheduleTeamSettings(teams);
    if (scheduleTeams === null) {
      throw new Error("スケジュール班設定の収集に失敗しました。");
    }
    
    // 完全正規化: eventNameは削除（eventIdから取得可能）
    const configPayload = {
      slug,
      startAt: formData.startAt,
      endAt: formData.endAt,
      faculties: formData.faculties,
      teams,
      defaultTeams: teams,
      scheduleTeams,
      schedules: scheduleSummary,
      guidance: ensureString(currentConfig?.guidance),
      updatedAt: serverTimestamp(),
      eventId
    };
    if (currentConfig?.createdAt) {
      configPayload.createdAt = currentConfig.createdAt;
    } else {
      configPayload.createdAt = serverTimestamp();
    }
    
    const updates = {};
    updates[`glIntake/events/${eventId}`] = configPayload;
    if (slug) {
      updates[`glIntake/slugIndex/${slug}`] = eventId;
    }
    if (previousSlug && previousSlug !== slug) {
      updates[`glIntake/slugIndex/${previousSlug}`] = null;
    }
    
    await update(ref(database), updates);
  }

  /**
   * 応募フォームURLをコピー
   * @returns {Promise<string>} コピーしたURL
   */
  async copyFormUrl() {
    const eventId = this.getCurrentEventId();
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    const slug = this.getDefaultSlug();
    if (!slug) {
      throw new Error("イベントIDを取得できませんでした。");
    }
    let url = `${window.location.origin}${window.location.pathname}`;
    try {
      const currentUrl = new URL(window.location.href);
      const basePath = currentUrl.pathname.replace(/[^/]*$/, "");
      const formUrl = new URL("gl-form.html", `${currentUrl.origin}${basePath}`);
      formUrl.searchParams.set("evt", slug);
      url = formUrl.toString();
    } catch (error) {
      // fallback to relative path
      url = `gl-form.html?evt=${encodeURIComponent(slug)}`;
    }
    let success = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        success = true;
      } catch (error) {
        success = false;
      }
    }
    if (!success) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        success = document.execCommand("copy");
      } catch (error) {
        success = false;
      }
      document.body.removeChild(textarea);
    }
    if (!success) {
      throw new Error("応募URLのコピーに失敗しました。");
    }
    return url;
  }

  /**
   * 共通カタログを適用
   * @param {Object} raw - 生のカタログデータ
   * @returns {Object} 正規化されたカタログデータ
   */
  applySharedCatalog(raw) {
    const faculties = normalizeFacultyList(raw);
    const meta = raw && typeof raw === "object" ? raw : {};
    return {
      faculties,
      signature: createSignature(faculties),
      meta: {
        updatedAt: Number(meta.updatedAt) || 0,
        updatedByUid: ensureString(meta.updatedByUid),
        updatedByName: ensureString(meta.updatedByName)
      }
    };
  }
}

