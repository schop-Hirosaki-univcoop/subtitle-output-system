import { dictionaryRef, onValue, set } from "./firebase.js";
import { DICTIONARY_STATE_KEY } from "./constants.js";
import { escapeHtml } from "./utils.js";

function normalizeDictionaryEntries(data) {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? Object.values(data)
      : [];
  return list
    .map((item) => {
      const term = String(item?.term ?? "").trim();
      const ruby = String(item?.ruby ?? "").trim();
      const enabledValue = item?.enabled;
      let enabled = true;
      if (typeof enabledValue === "boolean") {
        enabled = enabledValue;
      } else if (typeof enabledValue === "string") {
        enabled = enabledValue.trim().toLowerCase() !== "false";
      } else if (typeof enabledValue === "number") {
        enabled = enabledValue !== 0;
      }
      return { term, ruby, enabled };
    })
    .filter((entry) => entry.term && entry.ruby);
}

function applyDictionarySnapshot(app, rawEntries, { render = true } = {}) {
  const normalized = normalizeDictionaryEntries(rawEntries);
  app.dictionaryData = normalized;
  app.dictionaryEntries = normalized.filter((entry) => entry.enabled);
  if (render) {
    renderDictionaryTable(app, normalized);
  }
  app.dictionaryLoaded = true;
  if (typeof app.refreshRenderSummary === "function") {
    app.refreshRenderSummary();
  }
  return normalized;
}

function renderDictionaryTable(app, entries) {
  if (!app.dom.dictionaryTableBody) return;
  app.dom.dictionaryTableBody.innerHTML = "";
  entries.forEach((item) => {
    const tr = document.createElement("tr");
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = item.enabled ? "無効にする" : "有効にする";
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-ghost btn-sm";
    toggleBtn.addEventListener("click", () => toggleTerm(app, item.term, !item.enabled));
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "削除";
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger btn-sm";
    deleteBtn.addEventListener("click", () => deleteTerm(app, item.term));
    tr.innerHTML = `
      <td>${escapeHtml(item.term)}</td>
      <td>${escapeHtml(item.ruby)}</td>
      <td>${item.enabled ? "有効" : "無効"}</td>
    `;
    const actionTd = document.createElement("td");
    actionTd.className = "table-actions";
    actionTd.append(toggleBtn, deleteBtn);
    tr.appendChild(actionTd);
    if (!item.enabled) tr.classList.add("disabled");
    app.dom.dictionaryTableBody.appendChild(tr);
  });
}

export async function fetchDictionary(app) {
  try {
    const result = await app.api.apiPost({ action: "fetchSheet", sheet: "dictionary" });
    if (!result.success) return;
    const normalized = applyDictionarySnapshot(app, result.data || []);
    const payload = normalized.map(({ term, ruby, enabled }) => ({ term, ruby, enabled }));
    await set(dictionaryRef, payload);
  } catch (error) {
    app.toast("辞書の取得に失敗: " + error.message, "error");
  }
}

export function startDictionaryListener(app) {
  if (app.dictionaryUnsubscribe) {
    app.dictionaryUnsubscribe();
    app.dictionaryUnsubscribe = null;
  }
  app.dictionaryUnsubscribe = onValue(
    dictionaryRef,
    (snapshot) => {
      applyDictionarySnapshot(app, snapshot.val() || []);
    },
    (error) => {
      console.error("辞書データの購読に失敗しました", error);
    }
  );
}

export function stopDictionaryListener(app) {
  if (app.dictionaryUnsubscribe) {
    app.dictionaryUnsubscribe();
    app.dictionaryUnsubscribe = null;
  }
}

export function applyInitialDictionaryState(app) {
  let saved = "0";
  try {
    saved = localStorage.getItem(DICTIONARY_STATE_KEY) || "0";
  } catch (error) {
    saved = "0";
  }
  app.preferredDictionaryOpen = saved === "1";
  toggleDictionaryDrawer(app, false, false);
}

export function toggleDictionaryDrawer(app, force, persist = true) {
  const body = document.body;
  if (!body) return;
  const currentOpen = body.classList.contains("dictionary-open");
  const nextOpen = typeof force === "boolean" ? force : !currentOpen;
  body.classList.toggle("dictionary-open", nextOpen);
  body.classList.toggle("dictionary-collapsed", !nextOpen);
  if (app.dom.dictionaryPanel) {
    if (nextOpen) {
      app.dom.dictionaryPanel.removeAttribute("hidden");
    } else {
      app.dom.dictionaryPanel.setAttribute("hidden", "");
    }
  }
  if (app.dom.dictionaryToggle) {
    app.dom.dictionaryToggle.setAttribute("aria-expanded", String(nextOpen));
    app.dom.dictionaryToggle.setAttribute(
      "aria-label",
      nextOpen ? "ルビ辞書管理を閉じる" : "ルビ辞書管理を開く"
    );
  }
  if (persist) {
    try {
      localStorage.setItem(DICTIONARY_STATE_KEY, nextOpen ? "1" : "0");
    } catch (error) {
      console.debug("dictionary toggle state not persisted", error);
    }
    app.preferredDictionaryOpen = nextOpen;
  }
  if (nextOpen && app.isAuthorized && !app.dictionaryLoaded) {
    fetchDictionary(app).catch((error) => console.error("辞書の読み込みに失敗しました", error));
  }
}

export async function addTerm(app, event) {
  event.preventDefault();
  const term = app.dom.newTermInput?.value.trim();
  const ruby = app.dom.newRubyInput?.value.trim();
  if (!term || !ruby) return;
  try {
    const result = await app.api.apiPost({ action: "addTerm", term, ruby });
    if (result.success) {
      if (app.dom.newTermInput) app.dom.newTermInput.value = "";
      if (app.dom.newRubyInput) app.dom.newRubyInput.value = "";
      await fetchDictionary(app);
    } else {
      app.toast("追加失敗: " + result.error, "error");
    }
  } catch (error) {
    app.toast("通信エラー: " + error.message, "error");
  }
}

export async function deleteTerm(app, term) {
  if (!term) return;
  const confirmed = await app.confirmAction({
    title: "辞書から削除",
    description: `「${term}」を辞書から削除します。よろしいですか？`,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル",
    tone: "danger"
  });
  if (!confirmed) return;
  try {
    const result = await app.api.apiPost({ action: "deleteTerm", term });
    if (result.success) {
      await fetchDictionary(app);
    } else {
      app.toast("削除失敗: " + result.error, "error");
    }
  } catch (error) {
    app.toast("通信エラー: " + error.message, "error");
  }
}

export async function toggleTerm(app, term, newStatus) {
  try {
    const result = await app.api.apiPost({ action: "toggleTerm", term, enabled: newStatus });
    if (result.success) {
      await fetchDictionary(app);
    } else {
      app.toast("状態の更新失敗: " + result.error, "error");
    }
  } catch (error) {
    app.toast("通信エラー: " + error.message, "error");
  }
}
