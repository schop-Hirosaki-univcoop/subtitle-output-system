import { dictionaryRef, set } from "./firebase.js";
import { DICTIONARY_STATE_KEY } from "./constants.js";
import { escapeHtml } from "./utils.js";

export async function fetchDictionary(app) {
  try {
    const result = await app.api.apiPost({ action: "fetchSheet", sheet: "dictionary" });
    if (!result.success) return;
    if (app.dom.dictionaryTableBody) app.dom.dictionaryTableBody.innerHTML = "";
    (result.data || []).forEach((item) => {
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
      app.dom.dictionaryTableBody?.appendChild(tr);
    });
    app.dictionaryLoaded = true;
    const enabledOnly = (result.data || []).filter((item) => item.enabled === true);
    await set(dictionaryRef, enabledOnly);
  } catch (error) {
    app.toast("辞書の取得に失敗: " + error.message, "error");
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
  if (!confirm(`「${term}」を辞書から削除しますか？`)) return;
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
