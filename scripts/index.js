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
    setError("ログインに失敗しました。もう一度お試しください。");
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
