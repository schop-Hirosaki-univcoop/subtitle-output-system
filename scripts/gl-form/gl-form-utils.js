// gl-form-utils.js: GLフォーム用のユーティリティ関数と定数
// gl-form/index.js から分離（フェーズ2 段階1）

/**
 * カスタムオプションの値
 */
export const CUSTOM_OPTION_VALUE = "__custom";

/**
 * 文字列を正規化（空文字列の場合は空文字列を返す）
 * @param {*} value - 正規化する値
 * @returns {string} 正規化された文字列
 */
export function ensureString(value) {
  return String(value ?? "").trim();
}

/**
 * タイムスタンプをパース
 * @param {*} value - パースする値
 * @returns {number} タイムスタンプ（ミリ秒）
 */
export function parseTimestamp(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

/**
 * 期間をフォーマット
 * @param {number|string} startAt - 開始時刻
 * @param {number|string} endAt - 終了時刻
 * @returns {string} フォーマットされた期間文字列
 */
export function formatPeriod(startAt, endAt) {
  if (!startAt && !endAt) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  if (startAt && endAt) {
    return `${formatter.format(new Date(startAt))} 〜 ${formatter.format(new Date(endAt))}`;
  }
  if (startAt) {
    return `${formatter.format(new Date(startAt))} から募集開始`;
  }
  return `${formatter.format(new Date(endAt))} まで募集`;
}

/**
 * 配列から単位ツリーを作成
 * @param {Array} list - 配列
 * @param {string} label - ラベル
 * @returns {Object|null} 単位ツリーオブジェクト
 */
export function createUnitTreeFromArray(list, label) {
  if (!Array.isArray(list)) return null;
  const values = list.map(ensureString).filter(Boolean);
  if (!values.length) return null;
  const normalizedLabel = ensureString(label) || "学科";
  return {
    label: normalizedLabel,
    placeholder: `${normalizedLabel}を選択してください`,
    allowCustom: true,
    options: values.map((value) => ({
      value,
      label: value,
      children: null
    }))
  };
}

/**
 * 単位オプションをパース
 * @param {*} raw - 生データ
 * @param {string} fallbackValue - フォールバック値
 * @returns {Object|null} パースされたオプション
 */
export function parseUnitOption(raw, fallbackValue) {
  if (typeof raw === "string" || typeof raw === "number") {
    const value = ensureString(raw);
    if (!value) return null;
    return { value, label: value, children: null };
  }
  if (!raw || typeof raw !== "object") return null;
  const value = ensureString(raw.value ?? raw.id ?? raw.code ?? fallbackValue ?? raw.label ?? raw.name ?? "");
  const label = ensureString(raw.label ?? raw.name ?? value);
  if (!value && !label) return null;
  const childLabel = ensureString(raw.childLabel ?? raw.nextLabel ?? "");
  const childSource = raw.children ?? raw.next ?? raw.units ?? null;
  let children = null;
  if (childSource) {
    children = parseUnitLevel(childSource, childLabel || undefined);
  }
  return {
    value: value || label,
    label: label || value,
    children
  };
}

/**
 * 単位レベルをパース
 * @param {*} raw - 生データ
 * @param {string} fallbackLabel - フォールバックラベル
 * @returns {Object|null} パースされたレベル
 */
export function parseUnitLevel(raw, fallbackLabel) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const options = raw
      .map((item, index) => parseUnitOption(item, String(index)))
      .filter(Boolean);
    if (!options.length) return null;
    const label = ensureString(fallbackLabel) || "所属";
    return {
      label,
      placeholder: `${label}を選択してください`,
      allowCustom: true,
      options
    };
  }
  if (typeof raw !== "object") return null;
  const label =
    ensureString(raw.label ?? raw.name ?? raw.title ?? raw.type ?? fallbackLabel) || "学科";
  const placeholder =
    ensureString(raw.placeholder ?? raw.hint ?? "") || `${label}を選択してください`;
  const allowCustom = raw.allowCustom !== false;
  const source =
    raw.options ??
    raw.values ??
    raw.items ??
    raw.list ??
    raw.departments ??
    raw.choices ??
    null;
  let options = [];
  if (Array.isArray(source)) {
    options = source.map((item, index) => parseUnitOption(item, String(index))).filter(Boolean);
  } else if (source && typeof source === "object") {
    options = Object.entries(source)
      .map(([key, item]) => parseUnitOption(item, key))
      .filter(Boolean);
  }
  if (!options.length && Array.isArray(raw.children)) {
    options = raw.children.map((item, index) => parseUnitOption(item, String(index))).filter(Boolean);
  }
  if (!options.length) return null;
  return {
    label,
    placeholder,
    allowCustom,
    options
  };
}

/**
 * スケジュール範囲をフォーマット
 * @param {number} startAt - 開始時刻
 * @param {number} endAt - 終了時刻
 * @param {string} fallbackDate - フォールバック日付
 * @returns {string} フォーマットされた範囲文字列
 */
export function formatScheduleRange(startAt, endAt, fallbackDate) {
  const shiftDateFormatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short"
  });
  
  const scheduleTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });
  
  const hasStartTime = Number.isFinite(startAt) && startAt > 0;
  const hasEndTime = Number.isFinite(endAt) && endAt > 0;
  if (hasStartTime && hasEndTime) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const startDateText = shiftDateFormatter.format(start);
    const endDateText = shiftDateFormatter.format(end);
    const startTimeText = scheduleTimeFormatter.format(start);
    const endTimeText = scheduleTimeFormatter.format(end);
    if (startDateText === endDateText) {
      return `${startDateText} ${startTimeText}〜${endTimeText}`;
    }
    return `${startDateText} ${startTimeText} 〜 ${endDateText} ${endTimeText}`;
  }
  if (hasStartTime) {
    const start = new Date(startAt);
    return `${shiftDateFormatter.format(start)} ${scheduleTimeFormatter.format(start)}`;
  }
  if (hasEndTime) {
    const end = new Date(endAt);
    return `${shiftDateFormatter.format(end)} ${scheduleTimeFormatter.format(end)}`;
  }
  const rawDateText = ensureString(fallbackDate);
  if (!rawDateText) {
    return "";
  }
  const parsed = Date.parse(rawDateText);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    // 日付のみの場合は時刻を表示しない（時間情報がない場合）
    // ISO形式の日付文字列（YYYY-MM-DD）の場合は時刻部分を表示しない
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateText)) {
      return shiftDateFormatter.format(date);
    }
    // 時刻情報がある場合のみ時刻を表示
    const hasTimeInfo = date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0;
    if (hasTimeInfo) {
      return `${shiftDateFormatter.format(date)} ${scheduleTimeFormatter.format(date)}`;
    }
    return shiftDateFormatter.format(date);
  }
  return rawDateText;
}

/**
 * スケジュールオプションをフォーマット
 * @param {Object} schedule - スケジュールオブジェクト
 * @returns {string} フォーマットされたオプション文字列
 */
export function formatScheduleOption(schedule) {
  const fallbackDate = ensureString(schedule.date);
  const rangeText = ensureString(formatScheduleRange(schedule.startAt, schedule.endAt, fallbackDate));
  const labelText = ensureString(schedule.label);
  if (rangeText && labelText && !rangeText.includes(labelText)) {
    return `${rangeText}（${labelText}）`;
  }
  return rangeText || labelText || ensureString(schedule.id);
}

/**
 * 学部データをパース
 * @param {*} raw - 生データ
 * @returns {Array} パースされた学部データの配列
 */
export function parseFaculties(raw) {
  if (!raw || typeof raw !== "object") return [];
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  return entries
    .map((entry) => {
      if (typeof entry === "string" || typeof entry === "number") {
        const facultyName = ensureString(entry);
        if (!facultyName) return null;
        return {
          faculty: facultyName,
          unitTree: null,
          fallbackLabel: "学科"
        };
      }
      const faculty = ensureString(entry?.faculty ?? entry?.name ?? "");
      if (!faculty) return null;
      const unitLabel = ensureString(entry?.departmentLabel ?? entry?.unitLabel ?? "");
      const hierarchySource = entry?.units ?? entry?.unitTree ?? entry?.hierarchy ?? null;
      let unitTree = parseUnitLevel(hierarchySource, unitLabel || "学科");
      if (!unitTree) {
        const departments = Array.isArray(entry?.departments)
          ? entry.departments.map(ensureString).filter(Boolean)
          : [];
        unitTree = createUnitTreeFromArray(departments, unitLabel || "学科");
      }
      const fallbackLabel = unitLabel || unitTree?.label || "学科";
      return {
        faculty,
        unitTree,
        fallbackLabel
      };
    })
    .filter(Boolean);
}

/**
 * スケジュールデータをパース
 * @param {*} raw - 生データ
 * @returns {Array} パースされたスケジュールデータの配列
 */
export function parseSchedules(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((schedule) => ({
        id: ensureString(schedule?.id),
        label: ensureString(schedule?.label || schedule?.date || schedule?.id),
        date: ensureString(schedule?.date),
        startAt: parseTimestamp(schedule?.startAt),
        endAt: parseTimestamp(schedule?.endAt),
        recruitGl: schedule?.recruitGl !== false
      }))
      .filter((entry) => entry.id);
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([id, schedule]) => {
        const scheduleId = ensureString(schedule?.id) || ensureString(id);
        return {
          id: scheduleId,
          label: ensureString(schedule?.label || schedule?.date || scheduleId || id),
          date: ensureString(schedule?.date || schedule?.startAt || ""),
          startAt: parseTimestamp(schedule?.startAt),
          endAt: parseTimestamp(schedule?.endAt),
          recruitGl: schedule?.recruitGl !== false
        };
      })
      .filter((entry) => entry.id);
  }
  return [];
}

