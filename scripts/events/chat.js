// chat.js: 管理チャットの送受信とUI更新を制御するリアルタイム連携モジュールです。
import {
  operatorChatMessagesRef,
  onValue,
  push,
  set,
  serverTimestamp,
  query,
  orderByChild,
  limitToLast,
  remove,
  child
} from "../operator/firebase.js";

const MESSAGE_LIMIT = 200;
const SCROLL_THRESHOLD = 48;
const REPLY_PAYLOAD_LIMIT = 300;
const REPLY_PREVIEW_LIMIT = 180;

/**
 * チャットUIに表示する時刻文字列を生成します。
 * Intlが利用できない環境では toLocaleTimeString をフォールバックします。
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch (error) {
    return date.toLocaleTimeString();
  }
}

/**
 * 日付見出し用にローカライズされた日付文字列を返します。
 * Intlの失敗時には toLocaleDateString を使用します。
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
  } catch (error) {
    return date.toLocaleDateString();
  }
}

/**
 * 日付ごとのグルーピングキー(YYYY-MM-DD)を生成します。
 * @param {Date} date
 * @returns {string}
 */
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Realtime Database から受け取ったメッセージを描画用に正規化します。
 * 空白のみのメッセージは除外し、replyToの構造を安全に整えます。
 * @param {string} id
 * @param {unknown} value
 * @returns {object|null} 正常化されたメッセージ。null の場合は描画対象外です。
 */
function normalizeMessage(id, value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const messageText = typeof value.message === "string" ? value.message : "";
  const trimmed = messageText.trim();
  if (!trimmed) {
    return null;
  }
  const timestamp = typeof value.timestamp === "number" ? value.timestamp : 0;
  let replyTo = null;
  if (value && typeof value === "object" && value.replyTo && typeof value.replyTo === "object") {
    const replyId = typeof value.replyTo.id === "string" ? value.replyTo.id.trim() : "";
    const replyAuthor = typeof value.replyTo.author === "string" ? value.replyTo.author.trim() : "";
    const replyMessageRaw = typeof value.replyTo.message === "string" ? value.replyTo.message : "";
    const replyMessage = replyMessageRaw.trim().slice(0, REPLY_PAYLOAD_LIMIT);
    if (replyId && replyMessage) {
      replyTo = {
        id: replyId,
        author: replyAuthor,
        message: replyMessage
      };
    }
  }
  return {
    id,
    uid: typeof value.uid === "string" ? value.uid : "",
    displayName: typeof value.displayName === "string" ? value.displayName : "",
    email: typeof value.email === "string" ? value.email : "",
    message: trimmed,
    timestamp,
    replyTo
  };
}

/**
 * 管理画面内のリアルタイムチャット機能を制御するコントローラです。
 * メッセージ購読、入力フォーム制御、既読管理、返信プレビューを担います。
 */
export class EventChat {
  constructor(app) {
    this.app = app;
    this.dom = app.dom || {};
    this.unsubscribe = null;
    this.connectionState = "disabled";
    this.state = {
      messages: [],
      draft: "",
      autoScroll: true,
      unreadCount: 0,
      replyTarget: null
    };
    this.initialized = false;
    this.sending = false;
    this.lastMessageCount = 0;
    this.menuState = {
      element: null,
      targetId: null,
      targetElement: null
    };
    this.handleGlobalPointerDown = this.handleGlobalPointerDown.bind(this);
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
  }

  init() {
    this.dom = this.app.dom || {};
    this.bindDom();
    this.updateStatus("disabled");
    this.updateAvailability(false);
    this.renderMessages();
  }

  bindDom() {
    if (this.initialized) {
      return;
    }
    const {
      chatForm,
      chatInput,
      chatScroll,
      chatUnreadButton,
      chatScrollButton,
      chatMessages,
      chatContextMenu,
      chatReplyDismiss
    } = this.app.dom;
    if (chatForm) {
      chatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleSubmit();
      });
    }
    if (chatInput) {
      chatInput.addEventListener("input", () => {
        this.state.draft = chatInput.value || "";
        this.clearError();
        this.updateSendAvailability();
        this.syncComposerHeight();
      });
      chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          this.handleSubmit();
        }
      });
      chatInput.addEventListener("focus", () => this.syncComposerHeight());
      const scheduleInitialResize = () => this.syncComposerHeight();
      if (typeof queueMicrotask === "function") {
        queueMicrotask(scheduleInitialResize);
      } else {
        requestAnimationFrame(scheduleInitialResize);
      }
    }
    if (chatScroll) {
      chatScroll.addEventListener("scroll", () => this.handleScroll());
    }
    if (chatUnreadButton) {
      chatUnreadButton.addEventListener("click", () => this.scrollToLatest(true));
    }
    if (chatScrollButton) {
      chatScrollButton.addEventListener("click", () => this.scrollToLatest(true));
    }
    if (chatMessages) {
      chatMessages.addEventListener("contextmenu", (event) => this.handleMessageContextMenu(event));
      chatMessages.addEventListener("click", () => this.hideContextMenu());
    }
    if (chatReplyDismiss) {
      chatReplyDismiss.addEventListener("click", () => {
        this.clearReplyTarget();
        this.focusComposer();
      });
    }
    this.updateReplyPreview();
    if (chatContextMenu) {
      this.menuState.element = chatContextMenu;
      chatContextMenu.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) {
          return;
        }
        const button = event.target.closest("[data-chat-action]");
        if (!button || button.hasAttribute("disabled") || button.hasAttribute("hidden")) {
          return;
        }
        event.preventDefault();
        const action = button.getAttribute("data-chat-action");
        if (!action) {
          return;
        }
        void this.handleMenuAction(action);
      });
    }
    document.addEventListener("pointerdown", this.handleGlobalPointerDown);
    document.addEventListener("keydown", this.handleGlobalKeydown, true);
    this.updateScrollButton();
    this.initialized = true;
  }

  handleAuthChange(user) {
    if (!user) {
      this.stopListening();
      this.state.draft = "";
      this.state.unreadCount = 0;
      this.state.autoScroll = true;
      this.updateAvailability(false);
      this.updateStatus("disabled");
      this.updateUnreadIndicator();
      this.hideContextMenu();
      return;
    }
    if (this.app.dom.chatInput) {
      this.app.dom.chatInput.value = this.state.draft;
    }
    this.updateAvailability(true);
    this.startListening();
    this.syncComposerHeight();
    this.hideContextMenu();
  }

  startListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.updateStatus("connecting");
    const chatQuery = query(operatorChatMessagesRef, orderByChild("timestamp"), limitToLast(MESSAGE_LIMIT));
    this.unsubscribe = onValue(
      chatQuery,
      (snapshot) => {
        const value = snapshot.val() || {};
        const messages = Object.entries(value)
          .map(([id, entry]) => normalizeMessage(id, entry))
          .filter(Boolean)
          .sort((a, b) => {
            if (a.timestamp === b.timestamp) {
              return a.id.localeCompare(b.id);
            }
            return a.timestamp - b.timestamp;
          });
        this.state.messages = messages;
        this.updateStatus("online");
        this.renderMessages();
      },
      (error) => {
        console.error("Failed to monitor operator chat:", error);
        this.updateStatus("error");
        this.showError("チャットの読み込みに失敗しました。権限を確認してください。");
      }
    );
  }

  stopListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.state.messages = [];
    this.lastMessageCount = 0;
    this.renderMessages();
    this.hideContextMenu();
  }

  updateStatus(state) {
    this.connectionState = state;
    const { chatStatus } = this.app.dom;
    if (!chatStatus) {
      return;
    }
    let label = "未接続";
    switch (state) {
      case "connecting":
        label = "接続中…";
        break;
      case "online":
        label = "オンライン";
        break;
      case "error":
        label = "エラー";
        break;
      case "disabled":
      default:
        label = "未接続";
        break;
    }
    chatStatus.textContent = label;
  }

  updateAvailability(enabled) {
    const { chatForm, chatInput, chatSendButton } = this.app.dom;
    if (chatForm) {
      chatForm.classList.toggle("is-disabled", !enabled);
    }
    if (chatInput) {
      chatInput.disabled = !enabled;
      chatInput.placeholder = enabled
        ? "メッセージを入力"
        : "ログインするとメッセージを送信できます";
      if (!enabled) {
        chatInput.value = "";
      }
    }
    if (!enabled) {
      this.clearReplyTarget();
      this.clearError();
    }
    this.updateSendAvailability();
    this.syncComposerHeight();
  }

  updateSendAvailability() {
    const { chatSendButton, chatInput } = this.app.dom;
    if (!chatSendButton) {
      return;
    }
    const input = chatInput || null;
    const hasText = (this.state.draft || (input && input.value) || "").trim().length > 0;
    const canInteract = Boolean(this.app.currentUser) && Boolean(input) && !input.disabled;
    const shouldEnable = canInteract && !this.sending && hasText;
    chatSendButton.disabled = !shouldEnable;
  }

  syncComposerHeight() {
    const { chatInput } = this.app.dom;
    if (!chatInput) {
      return;
    }
    const computed = window.getComputedStyle(chatInput);
    const lineHeight = parseFloat(computed.lineHeight);
    const fontSize = parseFloat(computed.fontSize);
    const fallbackLineHeight = (Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.6 : 20);
    const baseLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallbackLineHeight;
    const minHeight = baseLineHeight;
    const maxHeight = baseLineHeight * 5;
    chatInput.style.height = "auto";
    chatInput.style.overflowY = "hidden";
    const scrollHeight = chatInput.scrollHeight;
    const clampedHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    chatInput.style.height = `${clampedHeight}px`;
    chatInput.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }

  handleScroll() {
    this.hideContextMenu();
    const { chatScroll } = this.app.dom;
    if (!chatScroll) {
      return;
    }
    const remaining = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    const atBottom = remaining <= SCROLL_THRESHOLD;
    this.state.autoScroll = atBottom;
    if (atBottom) {
      this.state.unreadCount = 0;
      this.updateUnreadIndicator();
    }
    this.updateScrollButton();
  }

  scrollToLatest(focusInput = false) {
    const { chatScroll, chatInput } = this.app.dom;
    if (!chatScroll) {
      return;
    }
    this.state.autoScroll = true;
    requestAnimationFrame(() => {
      chatScroll.scrollTop = chatScroll.scrollHeight;
      this.state.unreadCount = 0;
      this.updateUnreadIndicator();
      this.updateScrollButton();
      if (focusInput && chatInput && !chatInput.disabled) {
        chatInput.focus();
      }
    });
  }

  renderMessages() {
    this.hideContextMenu();
    const { chatMessages, chatEmpty } = this.app.dom;
    if (!chatMessages) {
      return;
    }
    chatMessages.innerHTML = "";
    const messages = this.state.messages || [];
    if (chatEmpty) {
      chatEmpty.hidden = messages.length > 0;
    }
    let lastDateKey = "";
    messages.forEach((message) => {
      if (Number.isFinite(message.timestamp) && message.timestamp > 0) {
        const date = new Date(message.timestamp);
        const dateKey = formatDateKey(date);
        if (dateKey !== lastDateKey) {
          chatMessages.appendChild(this.renderDateInfo(date));
          lastDateKey = dateKey;
        }
      }
      const item = this.renderMessage(message);
      chatMessages.appendChild(item);
    });
    if (typeof this.app.handleChatMessagesChange === "function") {
      const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      this.app.handleChatMessagesChange({
        messages,
        latestMessage,
        latestMessageId: latestMessage && typeof latestMessage.id === "string" ? latestMessage.id : ""
      });
    }
    if (messages.length === 0) {
      this.state.unreadCount = 0;
      this.updateUnreadIndicator();
    }
    const previousCount = this.lastMessageCount;
    const hasNewMessages = messages.length > previousCount;
    if (hasNewMessages) {
      const delta = messages.length - previousCount;
      const newMessages = messages.slice(-delta);
      const externalCount = newMessages.reduce((total, entry) => {
        return total + (this.isMessageFromCurrentUser(entry) ? 0 : 1);
      }, 0);
      if (externalCount > 0 && typeof this.app.handleChatActivity === "function") {
        this.app.handleChatActivity({
          delta,
          total: messages.length,
          externalCount
        });
      }
      if (!this.state.autoScroll) {
        this.state.unreadCount += delta;
        this.updateUnreadIndicator();
      }
    }
    if (this.state.autoScroll) {
      this.scrollToLatest(false);
    }
    this.updateScrollButton();
    this.lastMessageCount = messages.length;
  }

  updateScrollButton() {
    const { chatScrollButton, chatScroll } = this.app.dom;
    if (!chatScrollButton || !chatScroll) {
      return;
    }
    const hasMessages = Boolean(this.state.messages && this.state.messages.length > 0);
    const remaining = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    const atBottom = remaining <= SCROLL_THRESHOLD;
    chatScrollButton.hidden = !hasMessages || atBottom;
  }

  isMessageFromCurrentUser(message) {
    if (!message || typeof message !== "object") {
      return false;
    }
    const user = this.app.currentUser;
    if (!user || !user.uid) {
      return false;
    }
    return typeof message.uid === "string" && message.uid === user.uid;
  }

  renderMessage(message) {
    const article = document.createElement("article");
    article.className = "chat-message";
    article.dataset.messageId = message.id;
    if (this.isMessageFromCurrentUser(message)) {
      article.classList.add("chat-message--self");
    }

    const author = document.createElement("span");
    author.className = "chat-message__author";
    const resolvedName = message.displayName || message.email || "不明なユーザー";
    author.textContent = resolvedName;

    const bubbleWrap = document.createElement("div");
    bubbleWrap.className = "chat-message__bubble-wrap";

    const bubble = document.createElement("div");
    bubble.className = "chat-message__bubble";

    const time = document.createElement("time");
    time.className = "chat-message__time";
    if (message.timestamp) {
      const date = new Date(message.timestamp);
      time.dateTime = date.toISOString();
      time.textContent = formatTime(date);
    } else {
      time.textContent = "送信中…";
    }

    const body = document.createElement("p");
    body.className = "chat-message__body";
    body.textContent = message.message;

    if (message.replyTo && message.replyTo.message) {
      const quote = document.createElement("blockquote");
      quote.className = "chat-message__quote";
      if (message.replyTo.id) {
        quote.dataset.replyId = message.replyTo.id;
      }
      const replyAuthor = (message.replyTo.author || "").trim();
      if (replyAuthor) {
        const quoteAuthor = document.createElement("span");
        quoteAuthor.className = "chat-message__quote-author";
        quoteAuthor.textContent = replyAuthor;
        quote.appendChild(quoteAuthor);
      }
      const quoteText = document.createElement("p");
      quoteText.className = "chat-message__quote-text";
      quoteText.textContent = message.replyTo.message;
      quote.appendChild(quoteText);
      bubble.append(quote);
    }

    bubble.append(body);
    bubbleWrap.append(bubble, time);

    article.append(author, bubbleWrap);
    return article;
  }

  renderDateInfo(date) {
    const container = document.createElement("div");
    container.className = "chat-info";

    const time = document.createElement("time");
    time.dateTime = date.toISOString();
    time.textContent = formatDate(date);

    container.append(time);
    return container;
  }

  async handleSubmit() {
    if (this.sending) {
      return;
    }
    const { chatInput } = this.app.dom;
    const rawValue = chatInput ? chatInput.value : this.state.draft;
    const text = (rawValue || "").trim();
    if (!text || !this.app.currentUser) {
      return;
    }
    this.sending = true;
    this.updateSendAvailability();
    this.clearError();
    try {
      const payload = {
        uid: this.app.currentUser.uid,
        displayName: this.app.currentUser.displayName || "",
        email: this.app.currentUser.email || "",
        message: text,
        timestamp: serverTimestamp()
      };
      const replyPayload = this.getReplyPayload();
      if (replyPayload) {
        payload.replyTo = replyPayload;
      }
      const newRef = push(operatorChatMessagesRef);
      await set(newRef, payload);
      if (chatInput) {
        chatInput.value = "";
      }
      this.state.draft = "";
      this.clearReplyTarget();
      this.state.autoScroll = true;
      this.scrollToLatest(false);
    } catch (error) {
      console.error("Failed to send chat message:", error);
      this.showError("メッセージの送信に失敗しました。もう一度お試しください。");
    } finally {
      this.sending = false;
      this.updateSendAvailability();
    }
  }

  showError(message) {
    const { chatError } = this.app.dom;
    if (!chatError) {
      return;
    }
    chatError.hidden = false;
    chatError.textContent = message;
  }

  clearError() {
    const { chatError } = this.app.dom;
    if (!chatError) {
      return;
    }
    chatError.hidden = true;
    chatError.textContent = "";
  }

  handleMessageContextMenu(event) {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) {
      return;
    }
    const messageElement = event.target.closest(".chat-message");
    if (!messageElement) {
      this.hideContextMenu();
      return;
    }
    const messageId = messageElement.dataset.messageId;
    if (!messageId) {
      return;
    }
    event.preventDefault();
    this.showContextMenu(messageId, event, messageElement);
  }

  showContextMenu(messageId, event, targetElement) {
    const menu = this.menuState.element || this.app.dom.chatContextMenu;
    const panel = this.app.dom.chatPanel;
    if (!menu || !panel) {
      this.hideContextMenu();
      return;
    }
    const message = this.state.messages.find((item) => item && item.id === messageId);
    if (!message) {
      this.hideContextMenu();
      return;
    }
    if (this.menuState.targetElement && this.menuState.targetElement !== targetElement) {
      this.menuState.targetElement.classList.remove("chat-message--menu-open");
    }
    this.menuState.targetId = messageId;
    this.menuState.targetElement = targetElement;
    targetElement.classList.add("chat-message--menu-open");

    const cancelButton = this.app.dom.chatContextCancelButton || menu.querySelector("[data-chat-action=\"cancel\"]");
    const user = this.app.currentUser;
    const canCancel = Boolean(user && message.uid && user.uid === message.uid);
    if (cancelButton instanceof HTMLElement) {
      cancelButton.hidden = !canCancel;
      cancelButton.disabled = !canCancel;
      if (canCancel) {
        cancelButton.removeAttribute("aria-hidden");
      } else {
        cancelButton.setAttribute("aria-hidden", "true");
      }
    }

    menu.hidden = false;
    menu.style.visibility = "hidden";
    menu.style.pointerEvents = "none";
    menu.style.left = "0px";
    menu.style.top = "0px";

    const panelRect = panel.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = event.clientX - panelRect.left;
    let top = event.clientY - panelRect.top;
    if (left + menuRect.width > panelRect.width) {
      left = Math.max(panelRect.width - menuRect.width - 8, 0);
    }
    if (top + menuRect.height > panelRect.height) {
      top = Math.max(panelRect.height - menuRect.height - 8, 0);
    }
    menu.style.left = `${Math.max(left, 0)}px`;
    menu.style.top = `${Math.max(top, 0)}px`;
    menu.style.visibility = "";
    menu.style.pointerEvents = "";
  }

  hideContextMenu() {
    const menu = this.menuState.element || this.app.dom.chatContextMenu;
    if (!menu || menu.hidden) {
      return;
    }
    menu.hidden = true;
    menu.style.left = "";
    menu.style.top = "";
    menu.style.visibility = "";
    menu.style.pointerEvents = "";
    if (this.menuState.targetElement) {
      this.menuState.targetElement.classList.remove("chat-message--menu-open");
    }
    this.menuState.targetId = null;
    this.menuState.targetElement = null;
  }

  async handleMenuAction(action) {
    const messageId = this.menuState.targetId;
    if (!messageId) {
      this.hideContextMenu();
      return;
    }
    const message = this.state.messages.find((item) => item && item.id === messageId);
    if (!message) {
      this.hideContextMenu();
      return;
    }
    try {
      if (action === "reply") {
        this.performReply(message);
      } else if (action === "copy") {
        await this.performCopy(message);
      } else if (action === "cancel") {
        await this.performCancel(message);
      }
    } finally {
      this.hideContextMenu();
    }
  }

  performReply(message) {
    const { chatInput } = this.app.dom;
    if (!chatInput || chatInput.disabled) {
      return;
    }
    this.setReplyTarget(message);
  }

  async performCopy(message) {
    const text = message.message || "";
    if (!text) {
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn("Navigator clipboard copy failed", error);
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      console.warn("Fallback clipboard copy failed", error);
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async performCancel(message) {
    const user = this.app.currentUser;
    if (!user || !message.uid || user.uid !== message.uid) {
      return;
    }
    try {
      const messageRef = child(operatorChatMessagesRef, message.id);
      await remove(messageRef);
    } catch (error) {
      console.error("Failed to cancel chat message:", error);
      this.showError("メッセージの削除に失敗しました。権限を確認してください。");
    }
  }

  setReplyTarget(message) {
    const target = this.createReplyTarget(message);
    if (!target) {
      return;
    }
    this.state.replyTarget = target;
    this.updateReplyPreview();
    this.focusComposer();
  }

  clearReplyTarget() {
    if (!this.state.replyTarget) {
      this.updateReplyPreview();
      return;
    }
    this.state.replyTarget = null;
    this.updateReplyPreview();
    this.syncComposerHeight();
    this.updateSendAvailability();
  }

  updateReplyPreview() {
    const { chatReplyPreview, chatReplyAuthor, chatReplyText } = this.app.dom;
    const target = this.state.replyTarget;
    if (!chatReplyPreview || !chatReplyAuthor || !chatReplyText) {
      return;
    }
    if (!target) {
      chatReplyPreview.hidden = true;
      delete chatReplyPreview.dataset.replyId;
      chatReplyAuthor.textContent = "";
      chatReplyText.textContent = "";
      return;
    }
    chatReplyPreview.hidden = false;
    if (target.id) {
      chatReplyPreview.dataset.replyId = target.id;
    } else {
      delete chatReplyPreview.dataset.replyId;
    }
    const author = (target.author || "").trim() || "不明なユーザー";
    chatReplyAuthor.textContent = author;
    chatReplyText.textContent = this.buildReplyExcerpt(target.message);
  }

  focusComposer() {
    const { chatInput } = this.app.dom;
    if (!chatInput || chatInput.disabled) {
      return;
    }
    chatInput.focus();
    const caret = chatInput.value.length;
    try {
      chatInput.setSelectionRange(caret, caret);
    } catch (error) {
      // ignore selection errors (e.g., unsupported inputs)
    }
    this.state.draft = chatInput.value || "";
    this.syncComposerHeight();
    this.updateSendAvailability();
  }

  createReplyTarget(message) {
    if (!message || !message.id) {
      return null;
    }
    const baseText = typeof message.message === "string" ? message.message : "";
    const trimmed = baseText.trim().slice(0, REPLY_PAYLOAD_LIMIT);
    if (!trimmed) {
      return null;
    }
    const author = message.displayName || message.email || "不明なユーザー";
    return {
      id: message.id,
      author,
      message: trimmed
    };
  }

  buildReplyExcerpt(text) {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized) {
      return "";
    }
    if (normalized.length <= REPLY_PREVIEW_LIMIT) {
      return normalized;
    }
    return `${normalized.slice(0, REPLY_PREVIEW_LIMIT).trimEnd()}…`;
  }

  getReplyPayload() {
    const target = this.state.replyTarget;
    if (!target || !target.id) {
      return null;
    }
    const message = typeof target.message === "string" ? target.message.trim() : "";
    if (!message) {
      return null;
    }
    return {
      id: target.id,
      author: target.author || "",
      message
    };
  }

  handleGlobalPointerDown(event) {
    const menu = this.menuState.element || this.app.dom.chatContextMenu;
    if (!menu || menu.hidden) {
      return;
    }
    if (!(event.target instanceof Element)) {
      this.hideContextMenu();
      return;
    }
    if (menu.contains(event.target)) {
      return;
    }
    if (this.menuState.targetElement && this.menuState.targetElement.contains(event.target)) {
      return;
    }
    this.hideContextMenu();
  }

  handleGlobalKeydown(event) {
    if (event.key === "Escape") {
      const menu = this.menuState.element || this.app.dom.chatContextMenu;
      if (menu && !menu.hidden) {
        event.preventDefault();
        this.hideContextMenu();
      }
    }
  }

  updateUnreadIndicator() {
    const { chatUnreadButton, chatUnreadCount } = this.app.dom;
    const count = this.state.unreadCount || 0;
    if (chatUnreadButton) {
      chatUnreadButton.hidden = count <= 0;
    }
    if (chatUnreadCount) {
      chatUnreadCount.textContent = count > 99 ? "99+" : String(count);
    }
    if (typeof this.app.handleChatUnreadCountChange === "function") {
      this.app.handleChatUnreadCountChange(count);
    }
  }

  dispose() {
    this.stopListening();
    document.removeEventListener("pointerdown", this.handleGlobalPointerDown);
    document.removeEventListener("keydown", this.handleGlobalKeydown, true);
    this.clearReplyTarget();
    this.hideContextMenu();
  }
}
