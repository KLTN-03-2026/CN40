// group-detail-section.js — Group detail controller: data loading, member/task actions
(function () {
  "use strict";

  const GroupDetailSection = {
    current: null,  // { group, members[] }
    tasks: [],
    currentUser: null,
    _statusFilter: "all",
    _assigneeFilter: "all",
    _memberProgress: [],

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

    _currentUserId() {
      try {
        const token = localStorage.getItem("auth_token");
        return JSON.parse(atob(token.split(".")[1])).id;
      } catch { return null; }
    },

    _isOwnerOrAdmin() {
      const role = this.current?.myRole;
      return role === "owner" || role === "admin";
    },

    async load(groupId) {
      this.currentUser = this._currentUserId();

      // Wire back button once
      const backBtn = document.getElementById("back-to-groups");
      if (backBtn) backBtn.onclick = () => GroupListSection.backToList();

      const el = document.getElementById("group-detail-content");
      if (el) el.innerHTML = `<p class="text-slate-400 text-sm text-center py-10">Đang tải...</p>`;

      try {
        const [detailRes, tasksRes, progressRes] = await Promise.all([
          this._api(`/api/groups/${groupId}`),
          this._api(`/api/group-tasks?groupId=${groupId}`),
          this._api(`/api/group-tasks/progress?groupId=${groupId}`),
        ]);
        this.current = detailRes.data;
        this.tasks = tasksRes.data || [];
        this._memberProgress = progressRes.data?.members || [];
      } catch (err) {
        if (el) el.innerHTML = `<p class="text-red-500 text-sm text-center py-10">${err.message}</p>`;
        return;
      }
      this._render();
    },

    _render() {
      const el = document.getElementById("group-detail-content");
      if (!el || !this.current) return;

      const R = window.GroupDetailRender;
      const g = this.current;
      const members = (this.current.members || []).map((m) => ({
        UserID: m.Users?.UserID || m.UserID,
        HoTen: m.Users?.HoTen || m.HoTen || "",
        Email: m.Users?.Email || m.Email || "",
        AvatarUrl: m.Users?.AvatarUrl || m.AvatarUrl || "",
        EquippedBadge: m.Users?.EquippedBadge || m.EquippedBadge || null,
        VaiTro: m.VaiTro,
        NgayThamGia: m.NgayThamGia,
      }));
      const canManage = this._isOwnerOrAdmin();

      const filteredTasks = this._getFilteredTasks();
      el.innerHTML = `
        ${R.detailHeader(g, members)}
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
          <div class="lg:col-span-1 space-y-5">
            ${R.membersPanel(members, canManage)}
            ${R.memberProgressPanel(this._memberProgress)}
          </div>
          <div class="lg:col-span-2">
            ${R.tasksPanel(members, filteredTasks, this.tasks, this._statusFilter, this._assigneeFilter, canManage)}
          </div>
        </div>`;
    },

    // ── Member actions ──

    async showAddMember() {
      const form = document.getElementById("add-member-form");
      if (!form) return;
      const isHidden = form.classList.contains("hidden");
      form.classList.toggle("hidden");
      if (!isHidden) return;

      const list = document.getElementById("add-member-friends-list");
      if (!list) return;
      list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">Đang tải...</p>`;

      try {
        const friendsRes = await this._api("/api/friends");
        const friends = friendsRes.data || [];
        const memberIds = new Set((this.current.members || []).map((m) => m.Users?.UserID || m.UserID));
        const available = friends.filter((f) => !memberIds.has(f.UserID));

        if (!available.length) {
          list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">Không có bạn bè nào để thêm</p>`;
          return;
        }
        list.innerHTML = available.map((f) => {
          const initial = (f.HoTen || f.Email || "?")[0].toUpperCase();
          return `
            <div class="add-member-item flex items-center gap-2 p-2 rounded-xl cursor-pointer hover:bg-slate-100 transition"
              onclick="GroupDetailSection.addMemberById(${f.UserID}, '${(f.HoTen || "").replace(/'/g, "\\'")}')">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style="background:var(--accent,#2563EB)">${initial}</div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold text-slate-800 truncate">${f.HoTen || "Người dùng"}</div>
                <div class="text-xs text-slate-400 truncate">${f.Email || ""}</div>
              </div>
              <button class="text-xs px-2.5 py-1 rounded-lg font-semibold text-white flex-shrink-0" style="background:var(--accent,#2563EB)">
                <i class="fas fa-plus"></i>
              </button>
            </div>`;
        }).join("");
      } catch (err) {
        list.innerHTML = `<p class="text-xs text-red-500 text-center py-3">${err.message}</p>`;
      }
    },

    async addMemberById(userId, name) {
      try {
        await this._api(`/api/groups/${this.current.GroupID}/members`, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        Utils?.showToast?.(`Đã thêm ${name}!`, "success");
        await this.load(this.current.GroupID);
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },

    async removeMember(userId, name) {
      const ok = await Utils?.confirmDanger?.(`Xoá "${name}" khỏi nhóm?`, "Xoá thành viên");
      if (!ok) return;
      try {
        await this._api(`/api/groups/${this.current.GroupID}/members/${userId}`, { method: "DELETE" });
        Utils?.showToast?.("Đã xoá thành viên", "info");
        await this.load(this.current.GroupID);
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },

    // ── Task actions ──

    showAddTask() { document.getElementById("add-task-form")?.classList.remove("hidden"); },
    hideAddTask() { document.getElementById("add-task-form")?.classList.add("hidden"); },

    async addTask() {
      const title = document.getElementById("task-title-input")?.value.trim();
      const desc = document.getElementById("task-desc-input")?.value.trim();
      const assignedTo = document.getElementById("task-assignee-input")?.value;
      const priority = parseInt(document.getElementById("task-priority-input")?.value || "2", 10);
      const deadline = document.getElementById("task-deadline-input")?.value || null;
      if (!title) { Utils?.showToast?.("Nhập tiêu đề công việc", "error"); return; }
      if (!assignedTo) { Utils?.showToast?.("Chọn người thực hiện", "error"); return; }
      try {
        await this._api("/api/group-tasks", {
          method: "POST",
          body: JSON.stringify({
            groupId: this.current.GroupID,
            tieuDe: title,
            moTa: desc || undefined,
            assignedTo: parseInt(assignedTo, 10),
            mucDoUuTien: priority,
            hanChot: deadline || undefined,
          }),
        });
        this.hideAddTask();
        Utils?.showToast?.("Đã tạo công việc!", "success");
        await this.load(this.current.GroupID);
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },

    _getFilteredTasks() {
      return this.tasks.filter((t) => {
        if (this._statusFilter !== "all" && t.TrangThai !== this._statusFilter) return false;
        if (this._assigneeFilter !== "all" && String(t.AssignedTo) !== String(this._assigneeFilter)) return false;
        return true;
      });
    },

    filterByStatus(status) {
      this._statusFilter = status;
      this._render();
    },

    filterByAssignee(userId) {
      this._assigneeFilter = userId;
      this._render();
    },

    async changeStatus(taskId, newStatus) {
      try {
        await this._api(`/api/group-tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify({ trangThai: newStatus }),
        });
        const task = this.tasks.find((t) => t.GroupTaskID === taskId);
        if (task) {
          task.TrangThai = newStatus;
          this._render();
        } else {
          await this.load(this.current.GroupID);
        }
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },

    showEditTask(taskId) {
      const t = this.tasks.find((x) => x.GroupTaskID === taskId);
      if (!t) return;
      const form = document.getElementById("edit-task-form");
      if (form) form.remove();

      const card = document.querySelector(`[data-task-id="${taskId}"]`);
      if (!card) return;

      const members = (this.current.members || []).map((m) => ({
        UserID: m.Users?.UserID || m.UserID,
        HoTen: m.Users?.HoTen || m.HoTen || "",
      }));
      const memberOpts = members.map((m) => `<option value="${m.UserID}" ${m.UserID === t.AssignedTo ? "selected" : ""}>${m.HoTen}</option>`).join("");
      const deadlineVal = t.HanChot ? t.HanChot.slice(0, 10) : "";

      card.insertAdjacentHTML("afterend", `
        <div id="edit-task-form" class="p-3 rounded-xl bg-white border border-slate-200 space-y-2 mt-1">
          <input id="edit-task-title" type="text" value="${(t.TieuDe || "").replace(/"/g, "&quot;")}" class="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-1" />
          <textarea id="edit-task-desc" rows="2" class="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-1 resize-none">${t.MoTa || ""}</textarea>
          <select id="edit-task-assignee" class="w-full px-3 py-2 rounded-xl text-xs border border-slate-200">${memberOpts}</select>
          <div class="grid grid-cols-2 gap-2">
            <select id="edit-task-priority" class="w-full px-3 py-2 rounded-xl text-xs border border-slate-200">
              <option value="1" ${t.MucDoUuTien === 1 ? "selected" : ""}>Khẩn cấp</option>
              <option value="2" ${t.MucDoUuTien === 2 ? "selected" : ""}>Bình thường</option>
              <option value="3" ${t.MucDoUuTien === 3 ? "selected" : ""}>Thấp</option>
            </select>
            <input id="edit-task-deadline" type="date" value="${deadlineVal}" class="w-full px-3 py-2 rounded-xl text-xs border border-slate-200" />
          </div>
          <div class="flex gap-2 justify-end">
            <button onclick="document.getElementById('edit-task-form')?.remove()" class="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-500">Huỷ</button>
            <button onclick="GroupDetailSection.saveEditTask(${taskId})" class="px-3 py-1.5 rounded-xl text-xs font-semibold text-white" style="background:var(--accent,#2563EB)">Lưu</button>
          </div>
        </div>`);
    },

    async saveEditTask(taskId) {
      const title = document.getElementById("edit-task-title")?.value.trim();
      if (!title) { Utils?.showToast?.("Tiêu đề không được trống", "error"); return; }
      try {
        await this._api(`/api/group-tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify({
            tieuDe: title,
            moTa: document.getElementById("edit-task-desc")?.value.trim() || null,
            assignedTo: parseInt(document.getElementById("edit-task-assignee")?.value, 10),
            mucDoUuTien: parseInt(document.getElementById("edit-task-priority")?.value, 10),
            hanChot: document.getElementById("edit-task-deadline")?.value || null,
          }),
        });
        Utils?.showToast?.("Đã cập nhật!", "success");
        await this.load(this.current.GroupID);
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },

    async deleteTask(taskId) {
      const ok = await Utils?.confirmDanger?.("Xoá công việc này?", "Xoá công việc");
      if (!ok) return;
      try {
        await this._api(`/api/group-tasks/${taskId}`, { method: "DELETE" });
        Utils?.showToast?.("Đã xoá công việc", "info");
        await this.load(this.current.GroupID);
      } catch (err) { Utils?.showToast?.(err.message, "error"); }
    },
  };

  window.GroupDetailSection = GroupDetailSection;
})();
