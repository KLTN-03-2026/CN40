// calendar-share-manager.js — Manages collaborative calendar sharing UI & API calls
// Exposes window.CalendarShareManager for use in calendar section.
window.CalendarShareManager = {
  shares: { sent: [], received: [] },
  invitations: [],
  pollInterval: null,

  _authHeader() {
    const token = localStorage.getItem("auth_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  },

  async _apiFetch(path, opts = {}) {
    if (!localStorage.getItem("auth_token")) return { success: false, data: [] };
    const res = await fetch(path, { headers: this._authHeader(), ...opts });
    const json = await res.json().catch(() => ({ success: false, message: "Lỗi phân tích phản hồi" }));
    if (!res.ok || !json.success) throw new Error(json.message || "Lỗi không xác định");
    return json;
  },

  async init() {
    if (!localStorage.getItem("auth_token")) return;
    try {
      await this.loadInvitations();
      this.renderInvitationBadge();
    } catch (err) {
      console.warn("[CalendarShareManager] init error:", err.message);
    }
  },

  // Send invitation to share calendar
  async invite(email, permission) {
    return this._apiFetch("/api/calendar-shares/invite", {
      method: "POST",
      body: JSON.stringify({ email, permission }),
    });
  },

  // Load shares I sent + received
  async loadShares() {
    const json = await this._apiFetch("/api/calendar-shares");
    this.shares = json.data || { sent: [], received: [] };
    return this.shares;
  },

  // Load pending invitations for current user
  async loadInvitations() {
    const json = await this._apiFetch("/api/calendar-shares/invitations");
    this.invitations = json.data || [];
    return this.invitations;
  },

  // Accept an invitation and reload share state
  async acceptInvitation(shareId) {
    await this._apiFetch(`/api/calendar-shares/${shareId}/accept`, { method: "PUT" });
    await this.loadInvitations();
    await this.loadShares();
    this.renderInvitationBadge();
    this.renderShareModal();
    window.CalendarModule?.refreshEventsInPlace?.();
  },

  // Reject an invitation
  async rejectInvitation(shareId) {
    await this._apiFetch(`/api/calendar-shares/${shareId}/reject`, { method: "PUT" });
    await this.loadInvitations();
    this.renderInvitationBadge();
    this.renderShareModal();
  },

  // Revoke (owner) or leave (recipient) a share
  async revokeShare(shareId) {
    await this._apiFetch(`/api/calendar-shares/${shareId}`, { method: "DELETE" });
    await this.loadShares();
    this.renderShareModal();
    window.CalendarModule?.refreshEventsInPlace?.();
  },

  // Poll every 30 s — only when calendar section is visible
  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(async () => {
      const current = window.AppNavigation?.currentSection;
      if (current !== "schedule") return;
      try {
        await this.loadInvitations();
        this.renderInvitationBadge();
      } catch (_) {}
    }, 30000);
  },

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  // Open (or create) the share modal
  async openShareModal() {
    try {
      await Promise.all([this.loadShares(), this.loadInvitations()]);
    } catch (err) {
      console.warn("[CalendarShareManager] openShareModal load error:", err.message);
    }
    this._ensureModalDOM();
    document.getElementById("shareModalOverlay")?.classList.remove("hidden");
    this.renderShareModal();
    this._loadFriendsPicker();
  },

  closeShareModal() {
    document.getElementById("shareModalOverlay")?.classList.add("hidden");
  },

  // Update badge count on share button
  renderInvitationBadge() {
    const badge = document.getElementById("share-invitation-badge");
    if (!badge) return;
    const count = this.invitations.length;
    badge.textContent = count;
    badge.classList.toggle("hidden", count === 0);
  },

  // Build/refresh modal content
  renderShareModal() {
    const body = document.getElementById("shareModalBody");
    if (!body) return;

    const sent = this.shares.sent || [];
    const received = this.shares.received || [];
    const invitations = this.invitations;

    const permLabel = (p) => p === "editor" ? "Chỉnh sửa" : "Xem";
    const statusLabel = (s) => s === "pending" ? "Chờ xác nhận" : s === "accepted" ? "Đã chấp nhận" : "Đã từ chối";

    const sentRows = sent.map((s) => `
      <div class="share-user-row">
        <div class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
             style="background:var(--accent, #2563EB)">
          ${(s.Users?.HoTen || s.Users?.Email || "?")[0].toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm truncate" style="color:#1e293b">${s.Users?.HoTen || "Người dùng"}</div>
          <div class="text-xs truncate" style="color:#64748b">${s.Users?.Email || ""}</div>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium" style="background:#eff6ff;color:#2563EB">${permLabel(s.Permission)}</span>
        <span class="text-xs" style="color:#94a3b8">${statusLabel(s.TrangThai)}</span>
        <button onclick="CalendarShareManager.revokeShare(${s.ShareID})"
          class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
          style="color:#ef4444" title="Thu hồi">
          <i class="fas fa-times text-xs"></i>
        </button>
      </div>`).join("") || `<p class="text-sm text-center py-3" style="color:#94a3b8">Chưa chia sẻ với ai</p>`;

    const inviteRows = invitations.map((inv) => `
      <div class="share-invitation-row">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm" style="color:#1e293b">${inv.Users?.HoTen || "Người dùng"}</div>
          <div class="text-xs" style="color:#64748b">${inv.Users?.Email || ""} · ${permLabel(inv.Permission)}</div>
        </div>
        <div class="flex gap-2">
          <button onclick="CalendarShareManager.acceptInvitation(${inv.ShareID})"
            class="px-3 py-1 rounded-lg text-xs font-semibold text-white" style="background:#10b981">Chấp nhận</button>
          <button onclick="CalendarShareManager.rejectInvitation(${inv.ShareID})"
            class="px-3 py-1 rounded-lg text-xs font-semibold border" style="border-color:#e2e8f0;color:#64748b">Từ chối</button>
        </div>
      </div>`).join("") || "";

    const receivedRows = received.map((r) => `
      <div class="share-user-row">
        <div class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
             style="background:var(--accent, #2563EB)">
          ${(r.Users?.HoTen || "?")[0].toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm truncate" style="color:#1e293b">${r.Users?.HoTen || "Người dùng"}</div>
          <div class="text-xs truncate" style="color:#64748b">${r.Users?.Email || ""}</div>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium" style="background:#dcfce7;color:#16a34a">${permLabel(r.Permission)}</span>
        <button onclick="CalendarShareManager.revokeShare(${r.ShareID})"
          class="px-3 py-1 rounded-lg text-xs font-semibold border" style="border-color:#e2e8f0;color:#64748b" title="Rời khỏi">
          Rời
        </button>
      </div>`).join("") || "";

    body.innerHTML = `
      <!-- Invite form -->
      <div class="p-5 border-b" style="border-color:#e2e8f0">
        <p class="text-sm font-semibold mb-3" style="color:#1e293b">Mời người dùng</p>
        <div class="flex gap-2">
          <input id="share-invite-email" type="email" placeholder="Email người dùng..."
            class="flex-1 px-3 py-2 rounded-xl text-sm border" style="border-color:#e2e8f0;outline:none"
            onkeydown="if(event.key==='Enter') CalendarShareManager._submitInvite()" />
          <select id="share-invite-perm" class="px-2 py-2 rounded-xl text-sm border" style="border-color:#e2e8f0;background:#fff">
            <option value="viewer">Xem</option>
            <option value="editor">Chỉnh sửa</option>
          </select>
          <button onclick="CalendarShareManager._submitInvite()"
            class="px-4 py-2 rounded-xl text-sm font-semibold text-white flex-shrink-0"
            style="background:var(--accent, #2563EB)">
            Mời
          </button>
        </div>
      </div>

      <!-- Quick pick from friends -->
      <div id="share-friends-picker" class="p-5 border-b hidden" style="border-color:#e2e8f0">
        <p class="text-sm font-semibold mb-3" style="color:#1e293b"><i class="fas fa-user-friends mr-1" style="color:var(--accent,#2563EB)"></i>Chọn từ bạn bè</p>
        <div id="share-friends-list" class="space-y-2"></div>
      </div>

      <!-- Pending invitations -->
      ${inviteRows ? `<div class="p-5 border-b" style="border-color:#e2e8f0">
        <p class="text-sm font-semibold mb-3" style="color:#1e293b">Lời mời chờ xử lý (${invitations.length})</p>
        ${inviteRows}
      </div>` : ""}

      <!-- Shares I sent -->
      <div class="p-5 ${received.length ? "border-b" : ""}" style="border-color:#e2e8f0">
        <p class="text-sm font-semibold mb-3" style="color:#1e293b">Đã chia sẻ với (${sent.length})</p>
        ${sentRows}
      </div>

      <!-- Calendars shared with me -->
      ${received.length ? `<div class="p-5">
        <p class="text-sm font-semibold mb-3" style="color:#1e293b">Được chia sẻ với tôi (${received.length})</p>
        ${receivedRows}
      </div>` : ""}
    `;
  },

  // Submit invite from modal form
  async _submitInvite() {
    const emailEl = document.getElementById("share-invite-email");
    const permEl = document.getElementById("share-invite-perm");
    const email = emailEl?.value?.trim();
    const permission = permEl?.value || "viewer";

    if (!email) {
      Utils?.showToast?.("Vui lòng nhập email", "error");
      return;
    }

    try {
      await this.invite(email, permission);
      Utils?.showToast?.("Đã gửi lời mời!", "success");
      if (emailEl) emailEl.value = "";
      await this.loadShares();
      this.renderShareModal();
    } catch (err) {
      Utils?.showToast?.(err.message || "Không thể gửi lời mời", "error");
    }
  },

  // Load friends list into share modal for quick picking
  async _loadFriendsPicker() {
    const picker = document.getElementById("share-friends-picker");
    const list = document.getElementById("share-friends-list");
    if (!picker || !list) return;

    try {
      const res = await this._apiFetch("/api/friends");
      const friends = res.data || [];
      if (friends.length === 0) { picker.classList.add("hidden"); return; }

      // Filter out friends already shared with
      const sharedEmails = new Set([
        ...(this.shares.sent || []).map((s) => s.Users?.Email),
        ...(this.shares.received || []).map((r) => r.Users?.Email),
      ]);
      const available = friends.filter((f) => !sharedEmails.has(f.Email));
      if (available.length === 0) { picker.classList.add("hidden"); return; }

      picker.classList.remove("hidden");
      list.innerHTML = available.map((f) => {
        const initial = (f.HoTen || f.Email || "?")[0].toUpperCase();
        return `
          <div class="share-user-row" style="cursor:pointer" onclick="CalendarShareManager._pickFriend('${f.Email}')">
            <div class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                 style="background:var(--accent, #2563EB)">${initial}</div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm truncate" style="color:#1e293b">${f.HoTen || "Người dùng"}</div>
              <div class="text-xs truncate" style="color:#64748b">${f.Email || ""}</div>
            </div>
            <span class="text-xs font-medium" style="color:var(--accent,#2563EB)"><i class="fas fa-share mr-1"></i>Chia sẻ</span>
          </div>`;
      }).join("");
    } catch (_) {
      picker.classList.add("hidden");
    }
  },

  _pickFriend(email) {
    const emailEl = document.getElementById("share-invite-email");
    if (emailEl) {
      emailEl.value = email;
      emailEl.focus();
    }
  },

  // Create modal DOM structure if not yet present
  _ensureModalDOM() {
    if (document.getElementById("shareModalOverlay")) return;

    const container = document.getElementById("shareModalContainer") || document.body;
    const overlay = document.createElement("div");
    overlay.id = "shareModalOverlay";
    overlay.className = "share-modal-overlay hidden";
    overlay.innerHTML = `
      <div class="share-modal-panel">
        <div class="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style="border-color:#e2e8f0">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl flex items-center justify-center text-white"
                 style="background:var(--accent, #2563EB)">
              <i class="fas fa-share-alt text-sm"></i>
            </div>
            <h3 class="font-bold text-base" style="color:#1e293b">Chia sẻ lịch</h3>
          </div>
          <button onclick="CalendarShareManager.closeShareModal()"
            class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style="color:#94a3b8" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div id="shareModalBody" class="overflow-y-auto flex-1"></div>
      </div>
    `;
    // Close on overlay click (not panel click)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeShareModal();
    });
    // Close on ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) this.closeShareModal();
    });
    container.appendChild(overlay);
  },
};
