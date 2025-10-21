import {
  operatorChatMessagesRef,
  onValue,
  push,
  set,
  serverTimestamp,
  query,
  orderByChild,
  limitToLast
} from "../operator/firebase.js";

const MESSAGE_LIMIT = 200;
const SCROLL_THRESHOLD = 48;

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
  return {
    id,
    uid: typeof value.uid === "string" ? value.uid : "",
    displayName: typeof value.displayName === "string" ? value.displayName : "",
    email: typeof value.email === "string" ? value.email : "",
    message: trimmed,
    timestamp
  };
}

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
      unreadCount: 0
    };
    this.initialized = false;
    this.sending = false;
    this.lastMessageCount = 0;
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
    const { chatForm, chatInput, chatScroll, chatUnreadButton } = this.app.dom;
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
      });
    }
    if (chatScroll) {
      chatScroll.addEventListener("scroll", () => this.handleScroll());
    }
    if (chatUnreadButton) {
      chatUnreadButton.addEventListener("click", () => this.scrollToLatest(true));
    }
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
      return;
    }
    if (this.app.dom.chatInput) {
      this.app.dom.chatInput.value = this.state.draft;
    }
    this.updateAvailability(true);
    this.startListening();
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
      this.clearError();
    }
    this.updateSendAvailability();
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

  handleScroll() {
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
      if (focusInput && chatInput && !chatInput.disabled) {
        chatInput.focus();
      }
    });
  }

  renderMessages() {
    const { chatMessages, chatEmpty } = this.app.dom;
    if (!chatMessages) {
      return;
    }
    chatMessages.innerHTML = "";
    const messages = this.state.messages || [];
    if (chatEmpty) {
      chatEmpty.hidden = messages.length > 0;
    }
    messages.forEach((message) => {
      const item = this.renderMessage(message);
      chatMessages.appendChild(item);
    });
    if (messages.length === 0) {
      this.state.unreadCount = 0;
      this.updateUnreadIndicator();
    }
    if (this.state.autoScroll) {
      this.scrollToLatest(false);
    } else if (messages.length > this.lastMessageCount) {
      const delta = messages.length - this.lastMessageCount;
      this.state.unreadCount += delta;
      this.updateUnreadIndicator();
    }
    this.lastMessageCount = messages.length;
  }

  renderMessage(message) {
    const article = document.createElement("article");
    article.className = "chat-message";
    const currentUser = this.app.currentUser;
    if (currentUser && message.uid && message.uid === currentUser.uid) {
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

    const tail = document.createElement("span");
    tail.className = "chat-message__tail";
    tail.setAttribute("aria-hidden", "true");

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

    bubble.append(tail, body);
    bubbleWrap.append(bubble, time);

    article.append(author, bubbleWrap);
    return article;
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
      const newRef = push(operatorChatMessagesRef);
      await set(newRef, payload);
      if (chatInput) {
        chatInput.value = "";
      }
      this.state.draft = "";
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

  updateUnreadIndicator() {
    const { chatUnreadButton, chatUnreadCount } = this.app.dom;
    const count = this.state.unreadCount || 0;
    if (chatUnreadButton) {
      chatUnreadButton.hidden = count <= 0;
    }
    if (chatUnreadCount) {
      chatUnreadCount.textContent = count > 99 ? "99+" : String(count);
    }
  }

  dispose() {
    this.stopListening();
  }
}
