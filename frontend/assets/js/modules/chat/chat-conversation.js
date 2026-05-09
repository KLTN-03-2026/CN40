// chat-conversation.js — Active conversation: load, send, delete, realtime wiring
// Depends on: chat-utils.js, chat-message-renderer.js, chat-realtime-client.js
(function () {
  "use strict";

  const ChatConversation = {
    _convId: null,
    _sending: false,

    _authHeader() {
      const token = localStorage.getItem("auth_token");
      return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    },

    async _api(path, opts = {}) {
      const res = await fetch(path, { headers: this._authHeader(), ...opts });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "Lỗi");
      return json;
    },

    init() {
      // Resolve current user id from JWT payload
      try {
        const token = localStorage.getItem("auth_token");
        if (token) {
          const payload = JSON.parse(atob(token.split(".")[1]));
          ChatMessageRenderer.currentUserId =
            payload.userId || payload.id || payload.sub || null;
        }
      } catch (_) {}

      // Input events
      document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
      });
      document.getElementById("chat-send-btn")?.addEventListener("click", () => this.sendMessage());

      // Back button (mobile)
      document.getElementById("chat-back-btn")?.addEventListener("click", () => {
        document.getElementById("chat-sidebar")?.classList.remove("hidden-mobile");
        document.getElementById("chat-active")?.classList.add("hidden");
        document.getElementById("chat-empty-state")?.classList.remove("hidden");
      });

      // Close message menus on click outside
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".msg-menu-wrap")) this._closeMsgMenus();
      });

      // Wire realtime → append incoming messages
      ChatRealtimeClient.onMessage((msg) => this.onNewMessage(msg));
    },

    async loadConversation(conversationId, displayName, subtitle) {
      this._convId = conversationId;

      // Show active panel
      document.getElementById("chat-empty-state")?.classList.add("hidden");
      document.getElementById("chat-active")?.classList.remove("hidden");

      // Update header
      document.getElementById("chat-header-name").textContent = displayName || "Cuộc trò chuyện";
      document.getElementById("chat-header-sub").textContent = subtitle || "";
      document.getElementById("chat-header-avatar").textContent =
        (displayName || "?")[0].toUpperCase();

      // Loading placeholder
      const inner = document.getElementById("messages-inner");
      if (inner) inner.innerHTML =
        `<p class="text-xs text-center text-slate-400 py-6">Đang tải...</p>`;

      try {
        await this._loadMessages(conversationId);
      } catch (_) {
        if (inner) inner.innerHTML =
          `<p class="text-xs text-center text-slate-400 py-6">Không thể tải tin nhắn</p>`;
      }

      ChatRealtimeClient.subscribe(conversationId);
      document.getElementById("chat-input")?.focus();
    },

    async _loadMessages(conversationId, before = null) {
      let url = `/api/messages?conversationId=${conversationId}&limit=30`;
      if (before) url += `&before=${encodeURIComponent(before)}`;
      const json = await this._api(url);
      const msgs = json.data || [];
      ChatMessageRenderer.renderAll(msgs);
      this._scrollToBottom();
    },

    async sendMessage() {
      const input = document.getElementById("chat-input");
      const text = input?.value.trim();
      if (!text || !this._convId || this._sending) return;

      this._sending = true;
      input.value = "";
      const sendBtn = document.getElementById("chat-send-btn");
      if (sendBtn) sendBtn.disabled = true;

      const tempId = "temp-" + Date.now();
      ChatMessageRenderer.appendOptimistic(tempId, text);
      this._scrollToBottom();

      try {
        const json = await this._api("/api/messages", {
          method: "POST",
          body: JSON.stringify({ conversationId: this._convId, noiDung: text }),
        });
        const realMsg = json.data || {
          MessageID: tempId, NoiDung: text,
          SenderID: ChatMessageRenderer.currentUserId,
          NgayGui: new Date().toISOString(),
        };
        document.querySelector(`[data-msg-id="${tempId}"]`)?.outerHTML === undefined
          ? null
          : (document.querySelector(`[data-msg-id="${tempId}"]`).outerHTML =
              ChatMessageRenderer.buildBubble(realMsg));
        window.ChatListSection?.refresh();
      } catch (_) {
        // Dim the optimistic bubble to signal failure; restore input
        const bubble = document.querySelector(`[data-msg-id="${tempId}"] .msg-bubble`);
        if (bubble) bubble.style.opacity = "0.4";
        input.value = text;
      } finally {
        this._sending = false;
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
      }
    },

    onNewMessage(msg) {
      if (!msg || String(msg.ConversationID) !== String(this._convId)) return;
      // Skip own messages already shown via optimistic UI
      if (String(msg.SenderID) === String(ChatMessageRenderer.currentUserId)) return;

      const inner = document.getElementById("messages-inner");
      if (!inner) return;
      inner.querySelector("p.text-xs")?.remove();
      inner.insertAdjacentHTML("beforeend", ChatMessageRenderer.buildBubble(msg));
      this._scrollToBottom();
      window.ChatListSection?.refresh();
    },

    toggleMsgMenu(id) {
      document.querySelectorAll(".msg-menu").forEach((m) => {
        if (m.id !== `msg-menu-${id}`) m.classList.add("hidden");
      });
      document.getElementById(`msg-menu-${id}`)?.classList.toggle("hidden");
    },

    _closeMsgMenus() {
      document.querySelectorAll(".msg-menu").forEach((m) => m.classList.add("hidden"));
    },

    async startEdit(id) {
      this._closeMsgMenus();
      const row = document.querySelector(`[data-msg-id="${id}"]`);
      const bubble = row?.querySelector(".msg-bubble");
      if (!bubble || bubble.classList.contains("msg-bubble-del")) return;

      const oldText = bubble.textContent.trim();
      bubble.innerHTML = `<div class="flex flex-col gap-1.5"><input type="text" class="msg-edit-input" value="${ChatUtils.esc(oldText)}" maxlength="2000" /><div class="flex gap-1.5 justify-end"><button class="msg-edit-cancel" onclick="ChatConversation.cancelEdit(${id},'${ChatUtils.esc(oldText)}')">Huỷ</button><button class="msg-edit-save" onclick="ChatConversation.saveEdit(${id})">Lưu</button></div></div>`;
      const input = bubble.querySelector(".msg-edit-input");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    },

    cancelEdit(id, oldText) {
      const bubble = document.querySelector(`[data-msg-id="${id}"] .msg-bubble`);
      if (bubble) bubble.textContent = oldText;
    },

    async saveEdit(id) {
      const input = document.querySelector(`[data-msg-id="${id}"] .msg-edit-input`);
      const newText = input?.value.trim();
      if (!newText) return;
      try {
        await this._api(`/api/messages/${id}`, {
          method: "PUT",
          body: JSON.stringify({ noiDung: newText }),
        });
        const bubble = document.querySelector(`[data-msg-id="${id}"] .msg-bubble`);
        if (bubble) bubble.textContent = newText;
      } catch (e) {
        Utils?.showToast?.("Không thể sửa: " + e.message, "error");
      }
    },

    async recallMessage(id) {
      this._closeMsgMenus();
      const ok = await Utils?.confirmDanger?.("Thu hồi tin nhắn này?", "Thu hồi");
      if (!ok) return;
      try {
        await this._api(`/api/messages/${id}`, { method: "DELETE" });
        const bubble = document.querySelector(`[data-msg-id="${id}"] .msg-bubble`);
        if (bubble) {
          bubble.classList.add("msg-bubble-del");
          bubble.innerHTML = `<span class="text-xs" style="opacity:0.7">Tin nhắn đã bị thu hồi</span>`;
        }
        const menuWrap = document.querySelector(`[data-msg-id="${id}"] .msg-menu-wrap`);
        if (menuWrap) menuWrap.remove();
      } catch (e) {
        Utils?.showToast?.("Không thể thu hồi: " + e.message, "error");
      }
    },

    _scrollToBottom() {
      const area = document.getElementById("message-area");
      if (area) area.scrollTop = area.scrollHeight;
    },
  };

  window.ChatConversation = ChatConversation;
})();
