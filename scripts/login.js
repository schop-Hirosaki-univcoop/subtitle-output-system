// login.js: Firebase認証フローの初期化とログインUIのイベントを束ねるエントリースクリプトです。
import {
  auth,
  provider,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "./operator/firebase.js";
import { storeAuthTransfer, clearAuthTransfer } from "./shared/auth-transfer.js";
import {
  runAuthPreflight,
  AuthPreflightError,
  clearAuthPreflightContext
} from "./shared/auth-preflight.js";
import { goToEvents } from "./shared/routes.js";

const ERROR_MESSAGES = {
  "auth/popup-closed-by-user": "ログインウィンドウが閉じられました。もう一度お試しください。",
  "auth/cancelled-popup-request": "別のログイン処理が進行中です。完了してから再試行してください。",
  "auth/popup-blocked": "ポップアップがブロックされました。ブラウザの設定を確認してから再試行してください。"
};

/**
 * ログイン画面の状態とFirebase認証フローをまとめて制御するクラス。
 * @param {{ authInstance: import("firebase/auth").Auth,
 *          authProvider: import("firebase/auth").AuthProvider,
 *          googleAuthProvider: typeof GoogleAuthProvider }} deps
 *     依存関係を明示的に注入することでテスト容易性と実行時の柔軟性を確保します。
 */
class LoginPage {
  /**
   * コンストラクタではDOM要素のキャッシュやバインドを行い、イベント登録は別メソッドに分離して見通しを良くします。
   */
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
    this.preflightPromise = null;
  }

  /**
   * 初期化処理のエントリーポイント。
   * イベントハンドラ登録と認証状態の監視を開始し、UIを操作可能な状態にします。
   */
  init() {
    this.bindEvents();
    this.observeAuthState();
  }

  /**
   * ログインボタンの存在を確認した上でクリックイベントを登録します。
   * ボタンが存在しない環境では早期リターンし、想定外のDOM構造を把握しやすいよう警告を出します。
   */
  bindEvents() {
    if (!this.loginButton) {
      console.warn("Login button not found; login flow is unavailable.");
      return;
    }

    this.loginButton.addEventListener("click", this.handleLoginClick);
  }

  /**
   * Firebase Authの状態変化を監視し、既にサインイン済みの場合には自動で遷移させます。
   */
  observeAuthState() {
    onAuthStateChanged(this.auth, (user) => {
      this.handleAuthStateChanged(user);
    });
  }

  /**
   * ログインボタンのクリック時に多重実行を避けつつログイン処理を起動します。
   */
  handleLoginClick() {
    if (this.loginButton?.disabled) {
      return;
    }

    this.performLogin();
  }

  /**
   * ポップアップを利用したGoogleログインを実行し、結果に応じて資格情報を保管またはエラー表示を行います。
   */
  async performLogin() {
    this.setBusy(true);
    this.showError("");

    try {
      const result = await signInWithPopup(this.auth, this.provider);
      const credential = this.GoogleAuthProvider.credentialFromResult(result);
      this.preflightPromise = runAuthPreflight({ auth: this.auth, credential }).then((context) => {
        this.storeCredential(credential);
        return context;
      });
      await this.preflightPromise;
    } catch (error) {
      console.error("Login failed:", error);
      clearAuthTransfer();
      clearAuthPreflightContext();
      if (error instanceof AuthPreflightError) {
        await this.handlePreflightFailure(error);
      }
      this.showError(this.getErrorMessage(error));
    } finally {
      this.preflightPromise = null;
      this.setBusy(false);
    }
  }

  /**
   * 認証資格情報を次画面へ引き継ぐために安全な形式で保存します。
   * @param {import("firebase/auth").OAuthCredential|null} credential
   */
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

  /**
   * ログイン処理中であることをUIに反映し、ユーザーの多重操作を防ぎます。
   * @param {boolean} isBusy
   */
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

  /**
   * エラーメッセージの表示・非表示を管理し、アクセシビリティ属性も同期させます。
   * @param {string} [message]
   */
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

  /**
   * Firebaseから返却されたエラーオブジェクトをユーザー向けメッセージに変換します。
   * @param {Error & { code?: string }} error
   * @returns {string}
   */
  getErrorMessage(error) {
    if (error instanceof AuthPreflightError) {
      return error.message || "プリフライト処理に失敗しました。";
    }
    const code = error?.code || "";
    if (code === "auth/network-request-failed") {
      return navigator.onLine
        ? "通信エラーが発生しました。ネットワークを確認して再試行してください。"
        : "ネットワークに接続できません。接続状況を確認してから再試行してください。";
    }
    return ERROR_MESSAGES[code] || "ログインに失敗しました。もう一度お試しください。";
  }

  /**
   * プリフライト処理の失敗時に必要な後片付けを行います。
   * 未許可ユーザーなどのケースではサインアウトして状態を巻き戻します。
   * @param {AuthPreflightError} error
   */
  async handlePreflightFailure(error) {
    if (!error) {
      return;
    }
    if (error.code === "NOT_IN_USER_SHEET" || error.code === "ENSURE_ADMIN_FAILED") {
      try {
        await signOut(this.auth);
      } catch (signOutError) {
        console.warn("Failed to sign out after preflight error", signOutError);
      }
    }
  }

  /**
   * 認証状態がサインイン済みに変化した際に次画面への遷移を調整します。
   * @param {import("firebase/auth").User|null} user
   */
  async handleAuthStateChanged(user) {
    if (!user) {
      this.redirecting = false;
      clearAuthTransfer();
      clearAuthPreflightContext();
      return;
    }

    if (this.redirecting) {
      return;
    }

    if (this.preflightPromise) {
      try {
        await this.preflightPromise;
      } catch (error) {
        return;
      }
    }

    if (this.redirecting) {
      return;
    }

    this.redirecting = true;
    goToEvents();
  }
}

// 依存サービスを注入した LoginPage を作成し、ブラウザ起動時に即座に初期化します。
const page = new LoginPage({
  authInstance: auth,
  authProvider: provider,
  googleAuthProvider: GoogleAuthProvider
});

page.init();
