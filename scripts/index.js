import { auth, provider, signInWithPopup, onAuthStateChanged } from "./operator/firebase.js";

const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");

let redirecting = false;

function setBusy(isBusy) {
  if (!loginButton) return;
  loginButton.disabled = isBusy;
  loginButton.classList.toggle("is-busy", isBusy);
  loginButton.textContent = isBusy ? "サインイン中…" : "Googleアカウントでログイン";
}

function setError(message = "") {
  if (!loginError) return;
  const text = String(message || "").trim();
  if (text) {
    loginError.hidden = false;
    loginError.textContent = text;
  } else {
    loginError.hidden = true;
    loginError.textContent = "";
  }
}

async function login() {
  try {
    setBusy(true);
    setError("");
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    const code = error?.code || "";
    let message = "ログインに失敗しました。もう一度お試しください。";
    if (code === "auth/popup-closed-by-user") {
      message = "ログインウィンドウが閉じられました。もう一度お試しください。";
    } else if (code === "auth/cancelled-popup-request") {
      message = "別のログイン処理が進行中です。完了してから再試行してください。";
    } else if (code === "auth/popup-blocked") {
      message = "ポップアップがブロックされました。ブラウザの設定を確認してから再試行してください。";
    } else if (code === "auth/network-request-failed") {
      message = navigator.onLine
        ? "通信エラーが発生しました。ネットワークを確認して再試行してください。"
        : "ネットワークに接続できません。接続状況を確認してから再試行してください。";
    }
    setError(message);
  } finally {
    setBusy(false);
  }
}

if (loginButton) {
  loginButton.addEventListener("click", () => {
    if (!loginButton.disabled) {
      login().catch((error) => console.error(error));
    }
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user || redirecting) {
    return;
  }
  redirecting = true;
  window.location.replace("events.html");
});
