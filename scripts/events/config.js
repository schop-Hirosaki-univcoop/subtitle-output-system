export const STAGE_SEQUENCE = ["events", "schedules", "tabs"];

export const STAGE_INFO = {
  events: {
    title: "イベントの管理",
    description:
      "質問フォームで使用するイベントを追加・編集・削除し、選択したイベントを次のステップへ引き継ぎます。"
  },
  schedules: {
    title: "日程の管理",
    description: "選択したイベントに紐づく日程を整理し、次のツールに引き継ぐ日程を決めます。"
  }
};

export const PANEL_CONFIG = {
  events: { stage: "events", requireEvent: false, requireSchedule: false },
  schedules: { stage: "schedules", requireEvent: true, requireSchedule: false },
  participants: { stage: "tabs", requireEvent: true, requireSchedule: true },
  operator: { stage: "tabs", requireEvent: true, requireSchedule: true },
  dictionary: { stage: "tabs", requireEvent: false, requireSchedule: false, dictionary: true },
  pickup: { stage: "tabs", requireEvent: false, requireSchedule: false },
  logs: { stage: "tabs", requireEvent: false, requireSchedule: false, logs: true }
};

export const PANEL_STAGE_INFO = {
  events: STAGE_INFO.events,
  schedules: STAGE_INFO.schedules,
  participants: {
    title: "参加者リストの管理",
    description: "選択した日程の参加者リストを整理・更新します。"
  },
  operator: {
    title: "テロップ操作パネル",
    description: "質問の送出とステータス監視を行います。"
  },
  dictionary: {
    title: "ルビ辞書管理",
    description: "登録語句を編集して即座に共有できます。"
  },
  pickup: {
    title: "Pick Up Question 管理",
    description: "Pick Up Question の内容とジャンルを整備します。"
  },
  logs: {
    title: "操作ログ",
    description: "テロップ操作の履歴を確認します。"
  }
};

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");
