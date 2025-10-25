export const OPERATOR_MODE_TELOP = "telop";
export const OPERATOR_MODE_SUPPORT = "support";

export function normalizeOperatorMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === OPERATOR_MODE_SUPPORT) {
    return OPERATOR_MODE_SUPPORT;
  }
  return OPERATOR_MODE_TELOP;
}

export function isTelopMode(mode) {
  return normalizeOperatorMode(mode) === OPERATOR_MODE_TELOP;
}
