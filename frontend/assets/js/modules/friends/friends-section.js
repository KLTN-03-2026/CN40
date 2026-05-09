// friends-section.js — Friends management UI
(function () {
  "use strict";

  const FriendsSection = {
    friends: [],
    requests: [],
    sent: [],
    initialized: false,
    _lastLoadTime: 0,
    _CACHE_TTL: 15000,

    _authHeader() {
      const token = localStorage.getItem("auth_token");
      return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    },

    async _api(path, opts = {}) {
      const res = await fetch(path, { headers: this._authHeader(), ...opts });
      const json = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success) throw new Error(json.message || "Lỗi");
      return json;
    },

    async init() {
      if (this.initialized) {
        if (Date.now() - this._lastLoadTime < this._CACHE_TTL) return;
        await this.refresh();
        return;
      }
      this.initialized = true;
      this._bindEvents();
      await this.refresh();
    },

    _bindEvents() {
      const searchBtn = document.getElementById("friend-search-btn");
      const searchInput = document.getElementById("friend-search-input");
      if (searchBtn) searchBtn.onclick = () => this.search();
      if (searchInput) searchInput.onkeydown = (e) => { if (e.key === "Enter") this.search(); };
    },

    async refresh() {
      await Promise.all([this.loadFriends(), this.loadRequests(), this.loadSent()]);
      this._lastLoadTime = Date.now();
    },

    // --- Friends list ---
    async loadFriends() {
      try {
        const json = await this._api("/api/friends");
        this.friends = json.data || [];
      } catch (_) {
        this.friends = [];
      }
      this._renderFriends();
    },

    _renderFriends() {
      const container = document.getElementById("friends-list");
      const countEl = document.getElementById("friend-count");
      if (!container) return;
      if (countEl) countEl.textContent = this.friends.length;

      if (this.friends.length === 0) {
        container.innerHTML = `<p class="text-sm text-center py-6 text-slate-400">Chưa có bạn bè nào</p>`;
        return;
      }
      container.innerHTML = this.friends.map((f) => this._friendRow(f)).join("");
    },

    _badge(id) { return window.BadgeDisplay?.inline(id, 12) || ""; },

    _avatarImg(url, name, size) {
      const sz = size || 40;
      const ini = (name || "?")[0].toUpperCase();
      if (url) {
        return `<img src="${url}" alt="" class="rounded-full flex-shrink-0 object-cover" style="width:${sz}px;height:${sz}px"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="rounded-full flex-shrink-0 items-center justify-center text-white text-sm font-bold" style="display:none;width:${sz}px;height:${sz}px;background:var(--accent,#2563EB)">${ini}</div>`;
      }
      return `<div class="rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold" style="width:${sz}px;height:${sz}px;background:var(--accent,#2563EB)">${ini}</div>`;
    },

    _friendRow(f) {
      const streakHtml = f.Streak > 0
        ? `<span style="display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--text-primary,#1d1d1f);font-weight:600;letter-spacing:-0.12px"><i class="fas fa-fire" style="font-size:10px;color:var(--apple-blue,#0071e3)"></i>${f.Streak}</span>`
        : "";
      const levelHtml = `<span style="font-size:11px;color:rgba(0,0,0,0.48);letter-spacing:-0.12px">Lv.${f.Level || 1}</span>`;
      return `
        <div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg-card-alt,#f5f5f7);transition:all .15s"
          onmouseover="this.style.boxShadow='rgba(0,0,0,0.22) 3px 5px 30px 0px'" onmouseout="this.style.boxShadow='none'">
          ${this._avatarImg(f.AvatarUrl, f.HoTen || f.Email, 40)}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate" style="color:var(--text-primary,#1e293b)">${f.HoTen || "Người dùng"}${this._badge(f.EquippedBadge)}</div>
            <div class="flex items-center gap-2 mt-0.5">
              ${levelHtml}
              ${streakHtml}
              <span class="text-xs truncate" style="color:var(--text-muted,#94a3b8)">${f.Email || ""}</span>
            </div>
          </div>
          <button onclick="FriendsSection.unfriend(${f.FriendshipID})"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition" style="border-color:var(--border,#e2e8f0);color:var(--text-muted,#94a3b8)"
            onmouseover="this.style.color='#dc2626';this.style.borderColor='#fecaca'" onmouseout="this.style.color='';this.style.borderColor=''">
            Huỷ kết bạn
          </button>
        </div>`;
    },

    // --- Requests received ---
    async loadRequests() {
      try {
        const json = await this._api("/api/friends/requests");
        this.requests = json.data || [];
      } catch (_) {
        this.requests = [];
      }
      this._renderRequests();
    },

    _renderRequests() {
      const section = document.getElementById("friend-requests-section");
      const list = document.getElementById("friend-requests-list");
      const countEl = document.getElementById("friend-request-count");
      if (!section || !list) return;

      section.classList.toggle("hidden", this.requests.length === 0);
      if (countEl) countEl.textContent = this.requests.length;
      this.updateBadge();

      list.innerHTML = this.requests.map((r) => {
        const u = r.Requester;
        return `
          <div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg-card-alt,#f5f5f7)">
            ${this._avatarImg(u?.AvatarUrl, u?.HoTen || u?.Email, 40)}
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm truncate" style="color:var(--text-primary,#1e293b)">${u?.HoTen || "Người dùng"}${this._badge(u?.EquippedBadge)}</div>
              <div class="text-xs truncate" style="color:var(--text-muted,#94a3b8)">${u?.Email || ""}</div>
            </div>
            <div class="flex gap-2">
              <button onclick="FriendsSection.acceptRequest(${r.FriendshipID})"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style="background:#10b981">Chấp nhận</button>
              <button onclick="FriendsSection.rejectRequest(${r.FriendshipID})"
                class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-500">Từ chối</button>
            </div>
          </div>`;
      }).join("");
    },

    // --- Requests sent ---
    async loadSent() {
      try {
        const json = await this._api("/api/friends/sent");
        this.sent = json.data || [];
      } catch (_) {
        this.sent = [];
      }
      this._renderSent();
    },

    _renderSent() {
      const section = document.getElementById("friend-sent-section");
      const list = document.getElementById("friend-sent-list");
      if (!section || !list) return;

      section.classList.toggle("hidden", this.sent.length === 0);

      list.innerHTML = this.sent.map((s) => {
        const u = s.Receiver;
        return `
          <div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg-card-alt,#f5f5f7)">
            ${this._avatarImg(u?.AvatarUrl, u?.HoTen || u?.Email, 40)}
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm truncate" style="color:var(--text-primary,#1e293b)">${u?.HoTen || "Người dùng"}${this._badge(u?.EquippedBadge)}</div>
              <div class="text-xs truncate" style="color:var(--text-muted,#94a3b8)">${u?.Email || ""}</div>
            </div>
            <span class="text-xs font-medium" style="color:#d97706">Chờ phản hồi</span>
            <button onclick="FriendsSection.cancelRequest(${s.FriendshipID})"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-500 hover:text-red-600 transition">
              Huỷ
            </button>
          </div>`;
      }).join("");
    },

    // --- Search ---
    async search() {
      const input = document.getElementById("friend-search-input");
      const container = document.getElementById("friend-search-results");
      if (!input || !container) return;

      const q = input.value.trim();
      if (q.length < 2) {
        Utils?.showToast?.("Nhập ít nhất 2 ký tự", "error");
        return;
      }

      try {
        const json = await this._api(`/api/friends/search?q=${encodeURIComponent(q)}`);
        const results = json.data || [];

        container.classList.remove("hidden");

        if (results.length === 0) {
          container.innerHTML = `<p class="text-sm text-slate-400 text-center py-2">Không tìm thấy</p>`;
          return;
        }

        const friendIds = new Set(this.friends.map((f) => f.UserID));
        const pendingIds = new Set([
          ...this.requests.map((r) => r.Requester?.UserID),
          ...this.sent.map((s) => s.Receiver?.UserID),
        ]);

        container.innerHTML = results.map((u) => {

          let actionHtml;
          if (friendIds.has(u.UserID)) {
            actionHtml = `<span class="text-xs text-green-600 font-medium"><i class="fas fa-check mr-1"></i>Bạn bè</span>`;
          } else if (pendingIds.has(u.UserID)) {
            actionHtml = `<span class="text-xs text-amber-600 font-medium">Đã gửi lời mời</span>`;
          } else {
            actionHtml = `<button onclick="FriendsSection.sendRequest('${u.Email}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style="background:var(--accent, #2563EB)"><i class="fas fa-user-plus mr-1"></i>Kết bạn</button>`;
          }

          return `
            <div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg-card-alt,#f5f5f7)">
              ${this._avatarImg(u.AvatarUrl, u.HoTen || u.Email, 40)}
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate" style="color:var(--text-primary,#1e293b)">${u.HoTen || "Người dùng"}${this._badge(u.EquippedBadge)}</div>
                <div class="text-xs truncate" style="color:var(--text-muted,#94a3b8)">${u.Email || ""}</div>
              </div>
              ${actionHtml}
            </div>`;
        }).join("");
      } catch (err) {
        container.classList.remove("hidden");
        container.innerHTML = `<p class="text-sm text-red-500 text-center py-2">${err.message}</p>`;
      }
    },

    // --- Actions ---
    async sendRequest(email) {
      try {
        await this._api("/api/friends/request", { method: "POST", body: JSON.stringify({ email }) });
        Utils?.showToast?.("Đã gửi lời mời kết bạn!", "success");
        await this.refresh();
        this.search();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    async acceptRequest(id) {
      try {
        await this._api(`/api/friends/${id}/accept`, { method: "PUT" });
        Utils?.showToast?.("Đã chấp nhận!", "success");
        await this.refresh();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    async rejectRequest(id) {
      try {
        await this._api(`/api/friends/${id}/reject`, { method: "PUT" });
        Utils?.showToast?.("Đã từ chối", "info");
        await this.refresh();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    async cancelRequest(id) {
      try {
        await this._api(`/api/friends/${id}`, { method: "DELETE" });
        Utils?.showToast?.("Đã huỷ lời mời", "info");
        await this.refresh();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    async unfriend(id) {
      const ok = await Utils?.confirm?.("Bạn có chắc muốn huỷ kết bạn?", "Huỷ kết bạn");
      if (!ok) return;
      try {
        await this._api(`/api/friends/${id}`, { method: "DELETE" });
        Utils?.showToast?.("Đã huỷ kết bạn", "info");
        await this.refresh();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    // Update sidebar badge with pending request count
    updateBadge() {
      const badge = document.getElementById("sidebar-friend-badge");
      if (!badge) return;
      const count = this.requests.length;
      badge.textContent = count;
      badge.classList.toggle("hidden", count === 0);
    },

    // Poll for friend requests (called once on app load)
    async pollRequests() {
      if (!localStorage.getItem("auth_token")) return;
      try {
        const json = await this._api("/api/friends/requests");
        this.requests = json.data || [];
        this.updateBadge();
      } catch (_) {}
    },
  };

  window.FriendsSection = FriendsSection;

  // Auto-poll badge on page load
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => FriendsSection.pollRequests(), 3000);
  });
})();
