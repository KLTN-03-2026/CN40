// chat-list-section.js — Conversation list: load, render, select, new direct chat
// Depends on: chat-utils.js, chat-conversation.js, chat-realtime-client.js
(function () {
  "use strict";

  const ChatListSection = {
    _conversations: [],
    _activeId: null,
    _initialized: false,
    _lastLoadTime: 0,
    _CACHE_TTL: 15000,

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

    async init() {
      if (this._initialized) {
        if (Date.now() - this._lastLoadTime < this._CACHE_TTL) {
          this._renderConversations();
          return;
        }
        await this.loadConversations();
        return;
      }
      this._initialized = true;
      await ChatRealtimeClient.init();
      this._bindEvents();
      await this.loadConversations();
    },

    _bindEvents() {
      document.getElementById("new-chat-btn")
        ?.addEventListener("click", () => this._openNewChatModal());
      document.getElementById("cancel-new-chat")
        ?.addEventListener("click", () => this._closeNewChatModal());
      document.getElementById("new-chat-modal")
        ?.addEventListener("click", (e) => {
          if (e.target === e.currentTarget) this._closeNewChatModal();
        });

      // Debounced friend search
      let debounce = null;
      document.getElementById("new-chat-search")
        ?.addEventListener("input", (e) => {
          clearTimeout(debounce);
          debounce = setTimeout(() => this._searchFriends(e.target.value.trim()), 280);
        });
    },

    async loadConversations() {
      try {
        const json = await this._api("/api/conversations");
        this._conversations = json.data || [];
        this._lastLoadTime = Date.now();
      } catch (_) {
        this._conversations = [];
      }
      this._renderConversations();
    },

    _renderConversations() {
      const list = document.getElementById("conversation-list");
      if (!list) return;

      if (!this._conversations.length) {
        list.innerHTML = `
          <p class="conv-empty text-xs text-center py-8" style="color:rgba(255,255,255,0.3)">
            <i class="fas fa-comment-dots text-2xl mb-2 block"></i>
            Chưa có cuộc trò chuyện nào
          </p>`;
        return;
      }

      list.innerHTML = this._conversations.map((c) => this._convItemHtml(c)).join("");

      if (this._activeId) {
        list.querySelector(`[data-conv-id="${this._activeId}"]`)?.classList.add("active");
      }
    },

    _convItemHtml(conv) {
      const id = conv.conversationId || conv.ConversationID;
      const name = ChatUtils.esc(conv.displayName || "Người dùng");
      const last = ChatUtils.esc(ChatUtils.truncate(conv.lastMessage || conv.TinNhanCuoi || "Chưa có tin nhắn", 36));
      const timeVal = conv.lastMessageAt || conv.ThoiGianCuoi;
      const time = timeVal ? ChatUtils.relativeTimeShort(new Date(timeVal)) : "";
      const isGroup = (conv.type || conv.LoaiHoiThoai) === "group";
      const unread = conv.isRead === false ? `<div class="ci-unread"></div>` : "";
      const ini = (conv.displayName || "?")[0].toUpperCase();
      const avBg = isGroup
        ? "background:linear-gradient(135deg,#2563EB,#1d4ed8)"
        : "background:var(--accent,#2563EB)";
      const avContent = isGroup ? `<i class="fas fa-users" style="font-size:14px"></i>` : ini;

      const bdg = window.BadgeDisplay?.inline(conv.equippedBadge, 11) || "";
      return `<div class="ci-wrap flex items-center gap-2.5 px-3.5 py-2.5" data-conv-id="${id}" onclick="ChatListSection.selectConversation(${id})"><div class="ci-avatar flex items-center justify-center" style="${avBg}">${avContent}</div><div class="flex-1 min-w-0"><div class="ci-name">${name}${bdg}</div><div class="ci-last">${last}</div></div><div class="flex flex-col items-end gap-1 flex-shrink-0"><span class="ci-time">${time}</span>${unread}</div></div>`;
    },

    async selectConversation(id) {
      this._activeId = id;

      document.querySelectorAll(".ci-wrap")
        .forEach((el) => el.classList.remove("active"));
      document.querySelector(`[data-conv-id="${id}"]`)?.classList.add("active");

      // Mobile: slide to message panel
      if (window.innerWidth < 768) {
        document.getElementById("chat-sidebar")?.classList.add("hidden-mobile");
      }

      const conv = this._conversations.find((c) => (c.conversationId || c.ConversationID) === id);
      const name = conv?.displayName || "Cuộc trò chuyện";
      const sub = (conv?.type || conv?.LoaiHoiThoai) === "group" ? "Nhóm" : "";

      // Mark read (fire-and-forget) and clear unread dot
      this._api(`/api/conversations/${id}/read`, { method: "PUT" }).catch(() => {});
      if (conv) { conv.isRead = true; this._renderConversations(); }

      await ChatConversation.loadConversation(id, name, sub);
    },

    async startDirectChat(userId) {
      try {
        const json = await this._api(`/api/conversations/direct/${userId}`);
        const result = json.data;
        if (!result) throw new Error("Không tìm thấy cuộc trò chuyện");
        const conv = result.conversation || result;
        const convId = conv.ConversationID || conv.conversationId;
        if (!this._conversations.find((c) => (c.conversationId || c.ConversationID) === convId)) {
          await this.loadConversations();
        }
        this.selectConversation(convId);
      } catch (e) {
        window.Utils?.alert?.("Không thể mở cuộc trò chuyện: " + e.message, "Lỗi", "error");
      }
    },

    async refresh() {
      await this.loadConversations();
    },

    // ===== New chat modal =====
    async _openNewChatModal() {
      document.getElementById("new-chat-modal")?.classList.remove("hidden");
      const input = document.getElementById("new-chat-search");
      if (input) { input.value = ""; input.focus(); }
      await this._loadAllFriends();
    },

    async _loadAllFriends() {
      const results = document.getElementById("new-chat-results");
      if (!results) return;
      results.innerHTML = `<p class="text-xs text-slate-400 text-center py-2">Đang tải...</p>`;
      try {
        const json = await this._api("/api/friends");
        this._friendsCache = json.data || [];
        this._renderFriendResults(this._friendsCache);
      } catch (_) {
        results.innerHTML = `<p class="text-xs text-red-400 text-center py-2">Lỗi tải danh sách bạn bè</p>`;
      }
    },

    _renderFriendResults(friends) {
      const results = document.getElementById("new-chat-results");
      if (!results) return;
      if (!friends.length) {
        results.innerHTML = `<p class="text-xs text-slate-400 text-center py-2">Không có bạn bè nào</p>`;
        return;
      }
      results.innerHTML = friends.map((f) => {
        const uid = f.NguoiDungID || f.UserID;
        const ini = (f.HoTen || f.Email || "?")[0].toUpperCase();
        return `<div class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition" onclick="ChatListSection._pickFriend(${uid})">
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style="background:var(--accent,#2563EB)">${ini}</div>
          <div><div class="text-sm font-medium text-slate-800">${ChatUtils.esc(f.HoTen || "Người dùng")}</div><div class="text-xs text-slate-400">${ChatUtils.esc(f.Email || "")}</div></div></div>`;
      }).join("");
    },

    _closeNewChatModal() {
      document.getElementById("new-chat-modal")?.classList.add("hidden");
    },

    _searchFriends(query) {
      if (!query) {
        this._renderFriendResults(this._friendsCache || []);
        return;
      }
      const q = query.toLowerCase();
      const filtered = (this._friendsCache || []).filter((f) =>
        (f.HoTen || "").toLowerCase().includes(q) || (f.Email || "").toLowerCase().includes(q)
      );
      this._renderFriendResults(filtered);
    },

    _pickFriend(userId) {
      this._closeNewChatModal();
      this.startDirectChat(userId);
    },
  };

  window.ChatListSection = ChatListSection;
})();
