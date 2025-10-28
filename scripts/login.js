import {
  auth,
  provider,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "./operator/firebase.js";
import { storeAuthTransfer, clearAuthTransfer } from "./shared/auth-transfer.js";
import { goToEvents } from "./shared/routes.js";

const ERROR_MESSAGES = {
  "auth/popup-closed-by-user": "ログインウィンドウが閉じられました。もう一度お試しください。",
  "auth/cancelled-popup-request": "別のログイン処理が進行中です。完了してから再試行してください。",
  "auth/popup-blocked": "ポップアップがブロックされました。ブラウザの設定を確認してから再試行してください。"
};

class LoginPage {
  constructor({ authInstance, authProvider, googleAuthProvider }) {
    this.auth = authInstance;
    this.provider = authProvider;
    this.GoogleAuthProvider = googleAuthProvider;

    this.loginButton = document.getElementById("login-button");
    this.loginError = document.getElementById("login-error");
    this.defaultLabel = this.loginButton?.dataset?.labelDefault || "Googleアカウントでログイン";
    this.busyLabel = this.loginButton?.dataset?.labelBusy || "サインイン中…";
    this.redirecting = false;

    this.handleLoginClick = this.handleLoginClick.bind(this);
  }

  init() {
    this.bindEvents();
    this.observeAuthState();
  }

  bindEvents() {
    if (!this.loginButton) {
      console.warn("Login button not found; login flow is unavailable.");
      return;
    }

    this.loginButton.addEventListener("click", this.handleLoginClick);
  }

  observeAuthState() {
    onAuthStateChanged(this.auth, (user) => {
      this.handleAuthStateChanged(user);
    });
  }

  handleLoginClick() {
    if (this.loginButton?.disabled) {
      return;
    }

    this.performLogin();
  }

  async performLogin() {
    this.setBusy(true);
    this.showError("");

    try {
      const result = await signInWithPopup(this.auth, this.provider);
      const credential = this.GoogleAuthProvider.credentialFromResult(result);
      this.storeCredential(credential);
    } catch (error) {
      console.error("Login failed:", error);
      clearAuthTransfer();
      this.showError(this.getErrorMessage(error));
    } finally {
      this.setBusy(false);
    }
  }

  storeCredential(credential) {
    if (credential && (credential.idToken || credential.accessToken)) {
      storeAuthTransfer({
        providerId: credential.providerId || this.GoogleAuthProvider.PROVIDER_ID,
        signInMethod: credential.signInMethod || "",
        idToken: credential.idToken || "",
        accessToken: credential.accessToken || ""
      });
    } else {
      clearAuthTransfer();
    }
  }

  setBusy(isBusy) {
    if (!this.loginButton) return;
    this.loginButton.disabled = isBusy;
    this.loginButton.classList.toggle("is-busy", isBusy);
    const label = isBusy ? this.busyLabel : this.defaultLabel;
    if (this.loginButton.textContent !== label) {
      this.loginButton.textContent = label;
    }
    if (isBusy) {
      this.loginButton.setAttribute("aria-busy", "true");
      this.loginButton.setAttribute("aria-disabled", "true");
    } else {
      this.loginButton.removeAttribute("aria-busy");
      this.loginButton.removeAttribute("aria-disabled");
    }
  }

  showError(message = "") {
    if (!this.loginError) return;
    const text = String(message || "").trim();
    if (text) {
      this.loginError.hidden = false;
      this.loginError.removeAttribute("aria-hidden");
      this.loginError.textContent = text;
    } else {
      this.loginError.hidden = true;
      this.loginError.setAttribute("aria-hidden", "true");
      this.loginError.textContent = "";
    }
  }

  getErrorMessage(error) {
    const code = error?.code || "";
    if (code === "auth/network-request-failed") {
      return navigator.onLine
        ? "通信エラーが発生しました。ネットワークを確認して再試行してください。"
        : "ネットワークに接続できません。接続状況を確認してから再試行してください。";
    }
    return ERROR_MESSAGES[code] || "ログインに失敗しました。もう一度お試しください。";
  }

  handleAuthStateChanged(user) {
    if (!user || this.redirecting) {
      return;
    }
    this.redirecting = true;
    clearAuthTransfer();
    goToEvents();
  }
}

const page = new LoginPage({
  authInstance: auth,
  authProvider: provider,
  googleAuthProvider: GoogleAuthProvider
});

page.init();
