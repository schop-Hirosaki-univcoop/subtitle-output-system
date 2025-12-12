// participant-tokens.js: 参加者トークン集合の操作を共有するユーティリティ。

/**
 * イベント>日程>参加者のネスト構造から重複排除したトークン集合を返します。
 * @param {Record<string, Record<string, { token?: string }>>|null|undefined} branch
 * @returns {Set<string>}
 */
export function collectParticipantTokens(branch) {
  const tokens = new Set();
  if (!branch || typeof branch !== "object") {
    return tokens;
  }

  Object.values(branch).forEach((scheduleBranch) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") return;
    Object.values(scheduleBranch).forEach((participant) => {
      const token = participant?.token;
      // 空文字列や空白のみのトークンを除外
      const trimmedToken = String(token || "").trim();
      if (trimmedToken) {
        tokens.add(trimmedToken);
      }
    });
  });

  return tokens;
}
