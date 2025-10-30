// context-copy.js: 質問フォームに表示する挨拶文や説明文を統一的に生成します。
import { ensureTrimmedString } from "./value-utils.js";

export const CONTEXT_DESCRIPTION_SUFFIX = "気になることや相談したいことをお気軽にお寄せください。";
export const DEFAULT_CONTEXT_DESCRIPTION =
  `こちらは【なんでも相談ラジオ】の質問受付フォームです。${CONTEXT_DESCRIPTION_SUFFIX}`;

/**
 * 画面上部に表示する挨拶文の定型フレーズを生成します。
 * @param {string} eventName
 * @returns {string}
 */
export function buildContextDescription(eventName) {
  const trimmedEventName = ensureTrimmedString(eventName);
  if (!trimmedEventName) {
    return DEFAULT_CONTEXT_DESCRIPTION;
  }
  return `こちらは「${trimmedEventName}」の中で行われる【なんでも相談ラジオ】の質問受付フォームです。${CONTEXT_DESCRIPTION_SUFFIX}`;
}
