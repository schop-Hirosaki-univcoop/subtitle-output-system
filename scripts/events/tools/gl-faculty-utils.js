import { ensureString } from "../helpers.js";

function normalizeUnitOption(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = ensureString(raw.value ?? raw.id ?? raw.code ?? raw.label ?? raw.name ?? "");
  const label = ensureString(raw.label ?? raw.name ?? raw.title ?? value);
  if (!label && !value) {
    return null;
  }
  const option = {
    label: label || value,
    value: value || label
  };
  const child = normalizeUnitLevel(raw.children);
  if (child) {
    option.children = child;
  }
  return option;
}

function normalizeUnitLevel(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const label = ensureString(raw.label ?? raw.name ?? raw.title ?? "");
  const placeholder = ensureString(raw.placeholder ?? raw.hint ?? "");
  const allowCustom = raw.allowCustom !== false;
  const optionsSource = raw.options ?? raw.values ?? raw.items ?? raw.choices ?? raw.departments ?? raw.list ?? null;
  let options = [];
  if (Array.isArray(optionsSource)) {
    options = optionsSource.map(normalizeUnitOption).filter(Boolean);
  } else if (optionsSource && typeof optionsSource === "object") {
    options = Object.values(optionsSource).map(normalizeUnitOption).filter(Boolean);
  }
  if (!options.length) {
    return null;
  }
  return {
    label: label || "所属",
    placeholder: placeholder || `${label || "所属"}を選択してください`,
    allowCustom,
    options
  };
}

export function normalizeFacultyList(source) {
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source?.faculties)
      ? source.faculties
      : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const faculty = ensureString(entry.faculty ?? entry.name ?? "");
      if (!faculty) {
        return null;
      }
      const fallbackLabel = ensureString(entry.fallbackLabel ?? entry.departmentLabel ?? "学科") || "学科";
      const normalized = {
        faculty,
        fallbackLabel,
        departmentLabel: ensureString(entry.departmentLabel ?? fallbackLabel) || fallbackLabel
      };
      const tree = normalizeUnitLevel(entry.unitTree);
      if (tree) {
        normalized.unitTree = tree;
      }
      return normalized;
    })
    .filter(Boolean);
}
