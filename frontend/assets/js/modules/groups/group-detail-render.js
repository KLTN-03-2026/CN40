// group-detail-render.js — Pure render helpers for group detail view
(function () {
  "use strict";

  const PRIO = { 1: ["Khẩn cấp", "#ef4444", "#fef2f2"], 2: ["Bình thường", "#f59e0b", "#fffbeb"], 3: ["Thấp", "#3b82f6", "#eff6ff"], 4: ["Rất thấp", "#94a3b8", "#f8fafc"] };
  const STATUS = {
    pending: ["Chờ xử lý", "far fa-clock", "#a16207", "#fef9c3"],
    in_progress: ["Đang làm", "fas fa-spinner", "#1d4ed8", "#dbeafe"],
    completed: ["Hoàn thành", "fas fa-check-circle", "#15803d", "#dcfce7"],
    cancelled: ["Đã huỷ", "fas fa-ban", "#64748b", "#f1f5f9"],
  };

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function relDate(d) {
    if (!d) return "";
    const now = new Date(), dt = new Date(d);
    const diff = Math.floor((dt - now) / 86400000);
    if (diff < -1) return `${Math.abs(diff)} ngày trước`;
    if (diff === -1) return "Hôm qua";
    if (diff === 0) return "Hôm nay";
    if (diff === 1) return "Ngày mai";
    if (diff <= 7) return `${diff} ngày nữa`;
    return dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }

  function isOverdue(t) {
    return t.HanChot && t.TrangThai !== "completed" && t.TrangThai !== "cancelled" && new Date(t.HanChot) < new Date();
  }

  function avatar(name, size = 7) {
    const ini = (name || "?")[0].toUpperCase();
    return `<div class="w-${size} h-${size} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style="background:var(--accent,#2563EB)">${ini}</div>`;
  }

  window.GroupDetailRender = {

    detailHeader(g, members) {
      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-5">
          <div class="flex items-start gap-4">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
              style="background:var(--accent-gradient, linear-gradient(135deg,#2563EB,#1d4ed8))">
              ${(g.TenNhom || "N")[0].toUpperCase()}
            </div>
            <div class="flex-1">
              <h2 class="text-xl font-bold text-slate-800">${esc(g.TenNhom)}</h2>
              ${g.MoTa ? `<p class="text-sm text-slate-500 mt-0.5">${esc(g.MoTa)}</p>` : ""}
              <div class="flex gap-4 mt-2 text-xs text-slate-400">
                <span><i class="fas fa-users mr-1"></i>${members.length}/${g.MaxMembers || 10} thành viên</span>
                <span><i class="fas fa-calendar mr-1"></i>${new Date(g.NgayTao).toLocaleDateString("vi-VN")}</span>
              </div>
            </div>
          </div>
        </div>`;
    },

    membersPanel(members, canManage) {
      const addBtn = canManage
        ? `<button onclick="GroupDetailSection.showAddMember()" class="text-xs px-3 py-1.5 rounded-lg font-semibold text-white" style="background:var(--accent,#2563EB)"><i class="fas fa-user-plus mr-1"></i>Thêm</button>`
        : "";
      const addForm = canManage ? `
        <div id="add-member-form" class="hidden mb-3">
          <p class="text-xs text-slate-500 mb-2"><i class="fas fa-user-friends mr-1"></i>Chọn bạn bè để thêm vào nhóm</p>
          <div id="add-member-friends-list" class="space-y-1 max-h-48 overflow-y-auto"></div>
        </div>` : "";
      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-5">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm font-semibold text-slate-800"><i class="fas fa-users mr-1" style="color:var(--accent,#2563EB)"></i>Thành viên</p>
            ${addBtn}
          </div>
          ${addForm}
          <div class="group-members-list space-y-2">${this._memberRows(members, canManage)}</div>
        </div>`;
    },

    _memberRows(members, canManage) {
      if (!members.length) return `<p class="text-xs text-slate-400 text-center py-4">Chưa có thành viên</p>`;
      return members.map((m) => {
        const roleLabel = m.VaiTro === "owner" ? "Chủ nhóm" : m.VaiTro === "admin" ? "Quản trị" : "Thành viên";
        const roleClass = m.VaiTro === "owner" ? "role-owner" : m.VaiTro === "admin" ? "role-admin" : "role-member";
        const removeBtn = (canManage && m.VaiTro !== "owner")
          ? `<button onclick="GroupDetailSection.removeMember(${m.UserID},'${esc(m.HoTen || m.Email || "")}')" class="text-xs text-slate-300 hover:text-red-500 transition"><i class="fas fa-times"></i></button>`
          : "";
        return `
          <div class="flex items-center gap-2 p-2 rounded-xl bg-slate-50">
            ${avatar(m.HoTen || m.Email, 8)}
            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold text-slate-800 truncate">${esc(m.HoTen || "Người dùng")}${window.BadgeDisplay?.inline(m.EquippedBadge, 10) || ""}</div>
              <div class="text-xs text-slate-400 truncate">${esc(m.Email || "")}</div>
            </div>
            <span class="role-badge ${roleClass}">${roleLabel}</span>
            ${removeBtn}
          </div>`;
      }).join("");
    },

    tasksPanel(members, filteredTasks, allTasks, statusFilter, assigneeFilter, canManage) {
      const memberOpts = members.map((m) => `<option value="${m.UserID}">${esc(m.HoTen || m.Email)}</option>`).join("");
      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-5">
          <div class="flex items-center justify-between mb-4">
            <p class="text-base font-bold text-slate-800"><i class="fas fa-clipboard-list mr-1.5" style="color:var(--accent,#2563EB)"></i>Công việc nhóm</p>
            ${canManage ? `<button onclick="GroupDetailSection.showAddTask()" class="text-xs px-3.5 py-2 rounded-xl font-semibold text-white flex items-center gap-1.5" style="background:var(--accent,#2563EB)"><i class="fas fa-plus"></i>Giao việc mới</button>` : ""}
          </div>
          ${this._statsBar(allTasks)}
          ${this._filterBar(members, statusFilter, assigneeFilter, allTasks)}
          <div id="add-task-form" class="hidden mb-4">${this._addTaskForm(memberOpts)}</div>
          <div class="gt-list space-y-3">${this._taskCards(filteredTasks, canManage)}</div>
        </div>`;
    },

    _statsBar(tasks) {
      if (!tasks.length) return "";
      const t = tasks.length;
      const d = tasks.filter((x) => x.TrangThai === "completed").length;
      const ip = tasks.filter((x) => x.TrangThai === "in_progress").length;
      const p = tasks.filter((x) => x.TrangThai === "pending").length;
      const c = tasks.filter((x) => x.TrangThai === "cancelled").length;
      const od = tasks.filter(isOverdue).length;
      const pct = Math.round((d / t) * 100);

      return `
        <div class="gt-stats flex items-center gap-4 mb-4 p-3 rounded-xl bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-100">
          <div class="gt-stats-ring flex-shrink-0" style="--pct:${pct}">
            <span class="text-sm font-bold text-slate-700">${pct}%</span>
          </div>
          <div class="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div class="gt-stat-item"><span class="gt-stat-num" style="color:#a16207">${p}</span><span class="gt-stat-label">Chờ</span></div>
            <div class="gt-stat-item"><span class="gt-stat-num" style="color:#1d4ed8">${ip}</span><span class="gt-stat-label">Đang làm</span></div>
            <div class="gt-stat-item"><span class="gt-stat-num" style="color:#15803d">${d}</span><span class="gt-stat-label">Xong</span></div>
            ${od > 0 ? `<div class="gt-stat-item"><span class="gt-stat-num" style="color:#ef4444">${od}</span><span class="gt-stat-label">Quá hạn</span></div>` : `<div class="gt-stat-item"><span class="gt-stat-num" style="color:#64748b">${c}</span><span class="gt-stat-label">Huỷ</span></div>`}
          </div>
        </div>`;
    },

    _filterBar(members, sf, af, allTasks) {
      const counts = { all: allTasks.length, pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
      allTasks.forEach((t) => { if (counts[t.TrangThai] !== undefined) counts[t.TrangThai]++; });

      const filters = [
        ["all", "Tất cả", "#475569", counts.all],
        ["pending", "Chờ", "#a16207", counts.pending],
        ["in_progress", "Đang làm", "#1d4ed8", counts.in_progress],
        ["completed", "Xong", "#15803d", counts.completed],
        ["cancelled", "Huỷ", "#64748b", counts.cancelled],
      ];
      const btns = filters.map(([v, l, c, n]) => {
        const active = sf === v;
        return `<button onclick="GroupDetailSection.filterByStatus('${v}')" class="gt-filter-btn ${active ? "active" : ""}" style="${active ? `background:${c};color:#fff` : `color:${c}`}">${l}<span class="gt-filter-count">${n}</span></button>`;
      }).join("");

      const assigneeOpts = [`<option value="all">Tất cả thành viên</option>`]
        .concat(members.map((m) => `<option value="${m.UserID}" ${String(af) === String(m.UserID) ? "selected" : ""}>${esc(m.HoTen || m.Email)}</option>`))
        .join("");

      return `
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <div class="flex gap-1 flex-wrap">${btns}</div>
          <select onchange="GroupDetailSection.filterByAssignee(this.value)" class="gt-assignee-select">${assigneeOpts}</select>
        </div>`;
    },

    _addTaskForm(memberOpts) {
      return `
        <div class="p-4 rounded-xl border border-blue-100 bg-blue-50/50 space-y-3">
          <p class="text-xs font-semibold text-slate-600"><i class="fas fa-plus-circle mr-1 text-blue-500"></i>Giao việc mới</p>
          <input id="task-title-input" type="text" placeholder="Tiêu đề công việc *" class="gt-form-input" />
          <textarea id="task-desc-input" placeholder="Mô tả chi tiết (tuỳ chọn)" rows="2" class="gt-form-input resize-none"></textarea>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="gt-form-label">Giao cho *</label>
              <select id="task-assignee-input" class="gt-form-input"><option value="">-- Chọn thành viên --</option>${memberOpts}</select>
            </div>
            <div>
              <label class="gt-form-label">Hạn chót</label>
              <input id="task-deadline-input" type="date" class="gt-form-input" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="gt-form-label">Mức độ ưu tiên</label>
              <select id="task-priority-input" class="gt-form-input">
                <option value="1">🔴 Khẩn cấp</option>
                <option value="2" selected>🟡 Bình thường</option>
                <option value="3">🔵 Thấp</option>
              </select>
            </div>
          </div>
          <div class="flex gap-2 justify-end pt-1">
            <button onclick="GroupDetailSection.hideAddTask()" class="gt-btn-cancel">Huỷ</button>
            <button onclick="GroupDetailSection.addTask()" class="gt-btn-primary">Tạo công việc</button>
          </div>
        </div>`;
    },

    _taskCards(tasks, canManage) {
      if (!tasks.length) return `
        <div class="flex flex-col items-center justify-center py-10 text-slate-300">
          <i class="fas fa-inbox text-4xl mb-3"></i>
          <p class="text-sm text-slate-400">Không có công việc nào</p>
        </div>`;

      return tasks.map((t) => {
        const [sLabel, sIcon, sColor, sBg] = STATUS[t.TrangThai] || STATUS.pending;
        const prio = PRIO[t.MucDoUuTien] || PRIO[2];
        const assignee = t.Assignee?.HoTen || t.assigneeName || "";
        const dl = t.HanChot ? relDate(t.HanChot) : "";
        const od = isOverdue(t);
        const done = t.TrangThai === "completed";
        const cancelled = t.TrangThai === "cancelled";

        const statusOpts = Object.entries(STATUS).map(([k, [label]]) =>
          `<option value="${k}" ${k === t.TrangThai ? "selected" : ""}>${label}</option>`
        ).join("");

        const actions = canManage ? `
          <div class="flex items-center gap-1 flex-shrink-0 ml-auto">
            <button onclick="GroupDetailSection.showEditTask(${t.GroupTaskID})" class="gt-action-btn" title="Sửa"><i class="fas fa-pen"></i></button>
            <button onclick="GroupDetailSection.deleteTask(${t.GroupTaskID})" class="gt-action-btn gt-action-danger" title="Xoá"><i class="fas fa-trash-alt"></i></button>
          </div>` : "";

        return `
          <div class="gt-card ${done ? "gt-card-done" : ""} ${cancelled ? "gt-card-cancelled" : ""} ${od ? "gt-card-overdue" : ""}" data-task-id="${t.GroupTaskID}">
            <div class="gt-card-prio" style="background:${prio[1]}"></div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start gap-2">
                <div class="flex-1 min-w-0">
                  <div class="gt-card-title ${done ? "line-through opacity-50" : ""}">${esc(t.TieuDe)}</div>
                  ${t.MoTa ? `<div class="gt-card-desc">${esc(t.MoTa)}</div>` : ""}
                </div>
                ${actions}
              </div>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                ${assignee ? `<div class="gt-card-tag">${avatar(assignee, 5)}<span>${esc(assignee)}</span></div>` : ""}
                ${dl ? `<div class="gt-card-tag ${od ? "gt-tag-overdue" : ""}"><i class="far fa-calendar-alt"></i><span>${dl}</span></div>` : ""}
                <div class="gt-card-tag" style="background:${sBg};color:${sColor}"><i class="${sIcon}"></i><span>${sLabel}</span></div>
                <div class="gt-card-tag" style="background:${prio[2]};color:${prio[1]}"><span>${prio[0]}</span></div>
              </div>
              <div class="flex items-center gap-3 mt-2">
                <select onchange="GroupDetailSection.changeStatus(${t.GroupTaskID},this.value)" class="gt-status-select" style="color:${sColor}">
                  ${statusOpts}
                </select>
                ${t.SessionCount > 0 ? `<div class="flex items-center gap-2 flex-1"><div class="group-progress flex-1"><div class="group-progress-fill" style="width:${t.SessionPercent}%"></div></div><span class="text-xs font-semibold" style="color:${t.SessionPercent >= 100 ? "#15803d" : "#64748b"}">${t.SessionDone}/${t.SessionCount} buổi · ${t.SessionPercent}%</span></div>` : t.HasPersonalTask ? `<span class="text-xs text-slate-400"><i class="fas fa-calendar-plus mr-1"></i>Chưa lên lịch</span>` : ""}
              </div>
            </div>
          </div>`;
      }).join("");
    },

    memberProgressPanel(progress) {
      if (!progress || !progress.length) return "";
      const sorted = [...progress].sort((a, b) => b.percent - a.percent);
      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-5 mt-5">
          <p class="text-sm font-semibold text-slate-800 mb-3"><i class="fas fa-chart-bar mr-1" style="color:var(--accent,#2563EB)"></i>Tiến độ thành viên</p>
          <div class="space-y-2.5">${sorted.map((m) => `
            <div class="flex items-center gap-3">
              ${avatar(m.hoTen, 7)}
              <div class="flex-1 min-w-0">
                <div class="flex justify-between text-xs mb-0.5">
                  <span class="font-semibold text-slate-700 truncate">${esc(m.hoTen || "Người dùng")}</span>
                  <span class="text-slate-400">${m.completed}/${m.total} · ${m.percent}%</span>
                </div>
                <div class="group-progress"><div class="group-progress-fill" style="width:${m.percent}%"></div></div>
              </div>
            </div>`).join("")}</div>
        </div>`;
    },
  };
})();
