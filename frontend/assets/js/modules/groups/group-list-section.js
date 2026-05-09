// group-list-section.js — Groups list management: load, create, delete, show cards
(function () {
  "use strict";

  const GroupListSection = {
    groups: [],
    initialized: false,

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
      if (this.initialized) { await this.load(); return; }
      this.initialized = true;
      this._bindEvents();
      await this.load();
    },

    _bindEvents() {
      const createBtn = document.getElementById("create-group-btn");
      const cancelBtn = document.getElementById("cancel-create-group");
      const submitBtn = document.getElementById("submit-create-group");
      const modal = document.getElementById("create-group-modal");

      if (createBtn) createBtn.onclick = () => this._openModal();
      if (cancelBtn) cancelBtn.onclick = () => this._closeModal();
      if (submitBtn) submitBtn.onclick = () => this.create();
      if (modal) modal.onclick = (e) => { if (e.target === modal) this._closeModal(); };

      const nameInput = document.getElementById("new-group-name");
      if (nameInput) nameInput.onkeydown = (e) => { if (e.key === "Enter") this.create(); };
    },

    _openModal() {
      const modal = document.getElementById("create-group-modal");
      const nameEl = document.getElementById("new-group-name");
      const descEl = document.getElementById("new-group-desc");
      if (nameEl) nameEl.value = "";
      if (descEl) descEl.value = "";
      if (modal) modal.classList.remove("hidden");
      if (nameEl) nameEl.focus();
    },

    _closeModal() {
      const modal = document.getElementById("create-group-modal");
      if (modal) modal.classList.add("hidden");
    },

    async load() {
      try {
        const json = await this._api("/api/groups");
        this.groups = json.data || [];
      } catch (_) {
        this.groups = [];
      }
      this._render();
    },

    _render() {
      const grid = document.getElementById("groups-grid");
      const empty = document.getElementById("groups-empty");
      if (!grid) return;

      if (this.groups.length === 0) {
        grid.innerHTML = "";
        if (empty) empty.classList.remove("hidden");
        return;
      }

      if (empty) empty.classList.add("hidden");
      grid.innerHTML = this.groups.map((g) => this._card(g)).join("");
    },

    _card(g) {
      const initial = (g.TenNhom || "N")[0].toUpperCase();
      const memberText = `${g.memberCount || 0}/${g.MaxMembers || 10} thành viên`;
      const percent = Math.min(100, Math.round(((g.memberCount || 0) / (g.MaxMembers || 10)) * 100));
      const desc = g.MoTa ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2">${g.MoTa}</p>` : "";
      const date = g.NgayTao ? new Date(g.NgayTao).toLocaleDateString("vi-VN") : "";

      return `
        <div class="group-card" onclick="GroupListSection.openDetail(${g.GroupID})">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center text-white text-base font-bold flex-shrink-0"
              style="background:var(--accent-gradient, linear-gradient(135deg, #2563EB, #1d4ed8))">${initial}</div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm text-slate-800 truncate">${g.TenNhom}</div>
              <div class="text-xs text-slate-400">${date}</div>
            </div>
          </div>
          ${desc}
          <div class="mt-3">
            <div class="flex justify-between text-xs text-slate-500 mb-1">
              <span><i class="fas fa-users mr-1"></i>${memberText}</span>
            </div>
            <div class="group-progress">
              <div class="group-progress-fill" style="width:${percent}%"></div>
            </div>
          </div>
          <div class="mt-3 flex justify-end">
            <button onclick="event.stopPropagation(); GroupListSection.deleteGroup(${g.GroupID}, '${g.TenNhom.replace(/'/g, "\\'")}')"
              class="text-xs text-slate-400 hover:text-red-500 transition px-2 py-1">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>`;
    },

    async create() {
      const nameEl = document.getElementById("new-group-name");
      const descEl = document.getElementById("new-group-desc");
      const name = nameEl?.value.trim();
      const desc = descEl?.value.trim();

      if (!name) {
        Utils?.showToast?.("Vui lòng nhập tên nhóm", "error");
        nameEl?.focus();
        return;
      }

      try {
        await this._api("/api/groups", {
          method: "POST",
          body: JSON.stringify({ tenNhom: name, moTa: desc || undefined }),
        });
        this._closeModal();
        Utils?.showToast?.("Đã tạo nhóm!", "success");
        await this.load();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    async deleteGroup(id, name) {
      const ok = await Utils?.confirmDanger?.(`Xoá nhóm "${name}"? Thao tác không thể hoàn tác.`, "Xoá nhóm");
      if (!ok) return;
      try {
        await this._api(`/api/groups/${id}`, { method: "DELETE" });
        Utils?.showToast?.("Đã xoá nhóm", "info");
        await this.load();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    },

    openDetail(groupId) {
      document.getElementById("groups-list-view")?.classList.add("hidden");
      document.getElementById("group-detail-view")?.classList.remove("hidden");
      if (window.GroupDetailSection) GroupDetailSection.load(groupId);
    },

    backToList() {
      document.getElementById("group-detail-view")?.classList.add("hidden");
      document.getElementById("groups-list-view")?.classList.remove("hidden");
    },
  };

  window.GroupListSection = GroupListSection;
})();
