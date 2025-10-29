// config.js: イベント管理機能で利用する構成値と制御フラグを定義します。
export const STAGE_SEQUENCE = ["events", "schedules", "tabs"];

export const STAGE_INFO = {
  events: {
    title: "イベントの管理",
    description:
      "イベントを追加・編集・削除できます。イベントを選択し、次のステップへ引き継ぎます。"
  },
  schedules: {
    title: "日程の管理",
    description: "選択したイベントに紐づく日程を整理できます。日程を選択し、次のツールに引き継ぎます。"
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
    description:
      "選択したイベント・日程の参加者情報を管理できます。各参加者ごとに質問フォームの専用リンクを発行でき、「編集」から詳細や班番号を更新できます。電話番号とメールアドレスは内部で管理され、編集時のみ確認できます。同じイベント内で名前と学部学科が一致する参加者は重複候補として件数付きで表示されます。専用リンクは各行のボタンまたはURLから取得できます。"
  },
  operator: {
    title: "テロップ操作パネル",
    description: "質問を選択・送出できます。"
  },
  dictionary: {
    title: "ルビ辞書管理",
    description: "登録語句の追加や更新が即座にディスプレイへ反映されます。"
  },
  pickup: {
    title: "Pick Up Question 管理",
    description: "Pick Up Question の候補を追加・編集し、ジャンルを整理できます。"
  },
  logs: {
    title: "操作ログ",
    description: "直近の操作履歴を確認し、異常を素早く検知できます。"
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
