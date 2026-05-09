// calendar-event-detail.js — extends CalendarModule with the event-detail modal,
// subtask CRUD, delete event, and update-status logic.
// Depends on: calendar-module.js + calendar-events.js (must be loaded first)
(function () {
  "use strict";

  const CM = window.CalendarModule;
  if (!CM) {
    console.error("calendar-event-detail.js: CalendarModule not found");
    return;
  }

  // ------------------------------------------------------------------
  // Show event-details modal
  // ------------------------------------------------------------------

  CM._showEventDetails = function (event) {
    const p = event.extendedProps;
    if (p.isGroupTask) return this._showGroupTaskDetail(event);
    const now = new Date();
    const eventStart = event.start || now;
    const isFuture = eventStart > now;

    const dateStr = event.start ? event.start.toLocaleDateString("vi-VN") : "";
    const timeStr = event.start
      ? event.start.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      : "";

    const priorityTexts = { 1: "Thấp", 2: "Trung bình", 3: "Cao", 4: "Rất cao" };
    const pri = p.priority || 2;
    const dotColor = window.PriorityTheme ? PriorityTheme.getColor(pri) : "#3B82F6";

    const isSharedViewer = p.isShared && p.permission !== "editor";
    const canComplete = (!isFuture || p.completed) && !isSharedViewer;
    const completeDisabledAttr = canComplete ? "" : "disabled";
    const completeTitle = isSharedViewer ? "Lịch được chia sẻ (chỉ xem)" : isFuture ? "Chưa đến thời gian làm việc" : "";

    const modalHtml = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9998]" id="eventDetailModal">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 rounded-t-2xl flex items-start justify-between gap-3" style="background:var(--accent-header, linear-gradient(135deg,#334155,#1e293b))">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${dotColor}"></span>
            <h3 class="text-white font-bold text-lg leading-tight truncate">${event.title}</h3>
          </div>
          <button id="closeEventDetail" class="text-white/60 hover:text-white text-2xl leading-none flex-shrink-0">&times;</button>
        </div>

        <div class="p-6 space-y-4">
          <div class="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div class="flex items-center gap-2 text-gray-700">
              <i class="fas fa-calendar-alt w-4" style="color:#2563EB"></i>
              <span class="font-medium">${dateStr}</span>
              <span class="text-gray-400">|</span>
              <span>${timeStr} — ${event.end ? event.end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
            ${p.note ? `<div class="flex items-start gap-2 text-gray-600"><i class="fas fa-sticky-note text-amber-400 w-4 mt-0.5"></i><span>${p.note}</span></div>` : ""}
            <div class="flex items-center gap-2">
              <i class="fas fa-flag w-4" style="color:${dotColor}"></i>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full" style="background:${dotColor}22;color:${dotColor}">${priorityTexts[pri]}</span>
            </div>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-semibold text-gray-500" for="eventNoteInput">Ghi chú</label>
            <textarea id="eventNoteInput" rows="2"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none"
              placeholder="Thêm ghi chú..." ${isSharedViewer ? "readonly" : ""}>${p.note || ""}</textarea>
          </div>

          <div class="rounded-xl border-2 p-4 ${p.completed ? "border-green-200 bg-green-50" : isFuture ? "border-gray-200 bg-gray-50 opacity-60" : "border-blue-100 bg-blue-50"}">
            <label class="flex items-center gap-3 ${canComplete ? "cursor-pointer" : "cursor-not-allowed"}">
              <input type="checkbox" id="eventCompletedCheckbox"
                     class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                     ${p.completed ? "checked" : ""} ${completeDisabledAttr}
                     title="${completeTitle}" />
              <div>
                <p class="font-semibold text-gray-800">${p.completed ? "Đã hoàn thành" : "Đánh dấu hoàn thành"}</p>
                ${isFuture && !p.completed ? '<p class="text-xs text-gray-500 mt-0.5">Chưa đến thời gian làm việc</p>' : ""}
              </div>
            </label>
          </div>

          <div class="rounded-xl border p-3" style="border-color:#e2e8f0">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2 text-sm font-semibold" style="color:#1e293b">
                <i class="fas fa-layer-group" style="color:${dotColor}"></i>
                Minitask
                <span id="subtaskCountBadge" class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background:${dotColor}22;color:${dotColor}">0</span>
              </div>
              ${isSharedViewer ? "" : `<button id="toggleAddSubtaskBtn" class="text-xs font-semibold px-2 py-1 rounded-lg" style="color:${dotColor};background:${dotColor}11">
                <i class="fas fa-plus mr-1"></i>Thêm
              </button>`}
            </div>
            <div id="subtaskList" class="space-y-2">
              <div class="text-xs italic" style="color:#94a3b8">Đang tải...</div>
            </div>
            <div id="addSubtaskForm" class="hidden mt-3 rounded-lg p-3" style="background:#f8fafc;border:1px dashed #cbd5e1">
              <input type="text" id="subtaskTitleInput" placeholder="Tên minitask *" class="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" style="border-color:#e2e8f0;background:#fff" />
              <div class="grid grid-cols-2 gap-2 mt-2">
                <input type="time" step="60" id="subtaskStartInput" class="px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-blue-600" style="border-color:#e2e8f0;background:#fff" />
                <input type="time" step="60" id="subtaskEndInput" class="px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-blue-600" style="border-color:#e2e8f0;background:#fff" />
              </div>
              <p class="text-[10px] mt-1" style="color:#94a3b8">
                <i class="fas fa-info-circle mr-1"></i>Giờ và phút. Phải nằm trong thời gian task chính.
              </p>
              <textarea id="subtaskNoteInput" rows="2" placeholder="Ghi chú (không bắt buộc)" class="w-full mt-2 px-3 py-2 rounded-lg border text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-600" style="border-color:#e2e8f0;background:#fff"></textarea>
              <div class="flex justify-end gap-2 mt-2">
                <button id="cancelAddSubtaskBtn" class="px-3 py-1.5 text-xs font-semibold rounded-lg" style="background:#f1f5f9;color:#64748b">Huỷ</button>
                <button id="saveAddSubtaskBtn" class="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style="background:${dotColor}">Thêm</button>
              </div>
            </div>
          </div>

          ${isSharedViewer ? `
          <div class="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700 flex items-center gap-2">
            <i class="fas fa-user-friends"></i>
            <span>Lịch của <strong>${p.ownerName || "người khác"}</strong> (chỉ xem)</span>
          </div>` : `
          <div class="flex gap-3 pt-2">
            <button id="saveEventStatus" class="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition flex items-center justify-center gap-2">
              <i class="fas fa-save"></i> Lưu
            </button>
            <button id="deleteEventBtn" class="py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-semibold border border-red-200 transition flex items-center gap-2">
              <i class="fas fa-trash"></i> Xóa
            </button>
          </div>`}
        </div>
      </div>
    </div>`;

    document.getElementById("eventDetailModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    // Close handlers
    document.getElementById("closeEventDetail").onclick = () => document.getElementById("eventDetailModal")?.remove();
    document.getElementById("eventDetailModal").addEventListener("click", (e) => {
      if (e.target.id === "eventDetailModal") document.getElementById("eventDetailModal")?.remove();
    });
    const evtEsc = (e) => {
      if (e.key === "Escape") {
        document.getElementById("eventDetailModal")?.remove();
        document.removeEventListener("keydown", evtEsc);
      }
    };
    document.addEventListener("keydown", evtEsc);

    // Save / complete / delete (hidden for shared viewer events)
    const saveBtn = document.getElementById("saveEventStatus");
    if (saveBtn) saveBtn.onclick = () => this._updateEventStatus(event);
    const completionCheckbox = document.getElementById("eventCompletedCheckbox");
    if (completionCheckbox && !completionCheckbox.disabled) {
      completionCheckbox.addEventListener("change", () => this._updateEventStatus(event));
    }
    const deleteBtn = document.getElementById("deleteEventBtn");
    if (deleteBtn) deleteBtn.onclick = async () => {
      const confirmed = await Utils.confirmDanger(`Xóa sự kiện "${event.title}"? Thao tác này không thể hoàn tác.`, "Xoá sự kiện");
      if (confirmed) this._deleteEvent(event);
    };

    // Subtasks
    const eventIdForSubtasks = parseInt(event.id, 10);
    if (Number.isFinite(eventIdForSubtasks)) {
      this._bindSubtaskUi(eventIdForSubtasks, event);
    } else {
      const list = document.getElementById("subtaskList");
      if (list) list.innerHTML = `<div class="text-xs italic" style="color:#94a3b8">Sự kiện chưa được lưu — lưu trước rồi mới thêm minitask.</div>`;
      document.getElementById("toggleAddSubtaskBtn")?.setAttribute("disabled", "true");
    }
  };

  // ------------------------------------------------------------------
  // Subtask helpers
  // ------------------------------------------------------------------

  CM._loadSubtasks = async function (eventId) {
    try {
      const r = await Utils.makeRequest(`/api/event-subtasks?event_id=${eventId}&t=${Date.now()}`, "GET");
      return r?.success ? (r.data || []) : [];
    } catch (_) {
      return [];
    }
  };

  CM._renderSubtaskList = function (items, eventId, event) {
    const list  = document.getElementById("subtaskList");
    const badge = document.getElementById("subtaskCountBadge");
    if (!list) return;
    if (badge) badge.textContent = items.length;

    if (items.length === 0) {
      list.innerHTML = `<div class="text-xs italic" style="color:#94a3b8">Chưa có minitask.</div>`;
      return;
    }

    const fmtHM = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    list.innerHTML = items.map((s) => {
      const timeStr = (s.start_at || s.end_at)
        ? `${fmtHM(s.start_at) || "--:--"} – ${fmtHM(s.end_at) || "--:--"}`
        : "";
      return `
        <div class="subtask-card rounded-lg p-2.5 flex items-start gap-2" data-subtask-id="${s.id}"
          style="background:#fff;border:1px solid #e2e8f0;${s.is_done ? "opacity:0.6" : ""}">
          <input type="checkbox" class="subtask-done mt-0.5" data-subtask-id="${s.id}" ${s.is_done ? "checked" : ""}
            style="accent-color:#2563EB;flex-shrink:0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold" style="color:#1e293b;${s.is_done ? "text-decoration:line-through" : ""}">${s.title}</div>
            ${timeStr ? `<div class="text-[11px] mt-0.5" style="color:#64748b"><i class="far fa-clock mr-1"></i>${timeStr}</div>` : ""}
            ${s.note ? `<div class="text-[11px] mt-0.5" style="color:#64748b">${s.note}</div>` : ""}
          </div>
          <button class="subtask-delete text-gray-400 hover:text-red-600" data-subtask-id="${s.id}" title="Xóa">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>`;
    }).join("");
  };

  CM._bindSubtaskUi = function (eventId, event) {
    const self = this;
    this._loadSubtasks(eventId).then((items) => this._renderSubtaskList(items, eventId, event));

    const list      = document.getElementById("subtaskList");
    const form      = document.getElementById("addSubtaskForm");
    const toggleBtn = document.getElementById("toggleAddSubtaskBtn");
    const cancelBtn = document.getElementById("cancelAddSubtaskBtn");
    const saveBtn   = document.getElementById("saveAddSubtaskBtn");

    toggleBtn?.addEventListener("click", () => {
      form?.classList.toggle("hidden");
      document.getElementById("subtaskTitleInput")?.focus();
    });
    cancelBtn?.addEventListener("click", () => form?.classList.add("hidden"));

    // Pre-fill time inputs with event's own bounds
    if (event.start && event.end) {
      const evStart = new Date(event.start);
      const evEnd   = new Date(event.end);
      const toHM = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const si = document.getElementById("subtaskStartInput");
      const ei = document.getElementById("subtaskEndInput");
      if (si) { si.min = toHM(evStart); si.max = toHM(evEnd); si.value = toHM(evStart); }
      if (ei) { ei.min = toHM(evStart); ei.max = toHM(evEnd); ei.value = toHM(evEnd); }
    }

    saveBtn?.addEventListener("click", async () => {
      const title = document.getElementById("subtaskTitleInput").value.trim();
      if (!title) { Utils.showToast?.("Nhập tên minitask", "error"); return; }

      const baseDay = event.start ? new Date(event.start) : new Date();
      const combine = (hm) => {
        if (!hm) return null;
        const [h, m] = hm.split(":").map((v) => parseInt(v, 10));
        const d = new Date(baseDay);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const sAtStr = combine(document.getElementById("subtaskStartInput").value);
      const eAtStr = combine(document.getElementById("subtaskEndInput").value);

      if (sAtStr && eAtStr && event.start && event.end) {
        const sAt = new Date(sAtStr), eAt = new Date(eAtStr);
        const evStart = new Date(event.start), evEnd = new Date(event.end);
        if (sAt < evStart || eAt > evEnd) {
          Utils.showToast?.("Thời gian minitask phải nằm trong thời gian task chính", "error");
          return;
        }
        if (eAt <= sAt) { Utils.showToast?.("Kết thúc phải sau bắt đầu", "error"); return; }
      }

      const payload = {
        event_id: eventId, title, start_at: sAtStr, end_at: eAtStr,
        note: document.getElementById("subtaskNoteInput").value.trim() || null,
      };
      saveBtn.disabled = true;
      try {
        const r = await Utils.makeRequest("/api/event-subtasks", "POST", payload);
        if (!r.success) throw new Error(r.message || "Lỗi tạo");
        document.getElementById("subtaskTitleInput").value = "";
        document.getElementById("subtaskStartInput").value = "";
        document.getElementById("subtaskEndInput").value   = "";
        document.getElementById("subtaskNoteInput").value  = "";
        form?.classList.add("hidden");
        const items = await self._loadSubtasks(eventId);
        self._renderSubtaskList(items, eventId, event);
        event.setExtendedProp("subtasks",     items);
        event.setExtendedProp("subtaskCount", items.length);
      } catch (err) {
        Utils.showToast?.(err.message || "Lỗi", "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Toggle done
    list?.addEventListener("change", async (e) => {
      const cb = e.target.closest(".subtask-done");
      if (!cb) return;
      const id = cb.dataset.subtaskId;
      try {
        await Utils.makeRequest(`/api/event-subtasks/${id}`, "PATCH", { is_done: cb.checked });
        const items = await self._loadSubtasks(eventId);
        self._renderSubtaskList(items, eventId, event);
        event.setExtendedProp("subtasks",     items);
        event.setExtendedProp("subtaskCount", items.length);
      } catch (_) {}
    });

    // Delete subtask
    list?.addEventListener("click", async (e) => {
      const del = e.target.closest(".subtask-delete");
      if (!del) return;
      if (!await Utils.confirmDanger("Xoá minitask này?", "Xoá")) return;
      const id = del.dataset.subtaskId;
      try {
        await Utils.makeRequest(`/api/event-subtasks/${id}`, "DELETE");
        const items = await self._loadSubtasks(eventId);
        self._renderSubtaskList(items, eventId, event);
        event.setExtendedProp("subtasks",     items);
        event.setExtendedProp("subtaskCount", items.length);
      } catch (_) {}
    });
  };

  // ------------------------------------------------------------------
  // Delete event
  // ------------------------------------------------------------------

  CM._deleteEvent = async function (event) {
    const eventId = event.id;

    if (!eventId || eventId.toString().startsWith("temp-")) {
      Utils.showToast?.("Sự kiện chưa được lưu vào database", "warning");
      document.getElementById("eventDetailModal")?.remove();
      event.remove();
      return;
    }

    const busyBtn = document.getElementById("confirmDeleteBtn") || document.getElementById("deleteEventBtn");
    const originalHtml = busyBtn?.innerHTML;
    if (busyBtn) {
      busyBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Đang xóa...';
      busyBtn.disabled  = true;
    }

    try {
      const result = await Utils.makeRequest(`/api/calendar/events/${eventId}`, "DELETE");

      if (!result.success) {
        const msg = result.message || "";
        if (msg.includes("liên quan") || msg.includes("task")) {
          throw new Error("Sự kiện đang liên kết với công việc. Vui lòng kiểm tra lại.");
        }
        throw new Error(msg || "Xóa sự kiện thất bại");
      }

      const modal = document.getElementById("eventDetailModal");
      if (modal) {
        modal.style.animation = "fadeOut 0.3s ease forwards";
        setTimeout(() => modal.remove(), 300);
      }

      const eventEl =
        document.querySelector(`[data-event-id="${eventId}"]`) ||
        document.querySelector(`.fc-event[title*="${event.title.substring(0, 20)}"]`);

      if (eventEl) {
        eventEl.style.animation = "shrinkOut 0.5s ease forwards";
        eventEl.style.transformOrigin = "center";
        setTimeout(() => { event.remove(); }, 500);
      } else {
        event.remove();
      }

      Utils.showToast?.("Đã xóa sự kiện thành công!", "success");
      document.dispatchEvent(new CustomEvent("eventDeleted", {
        detail: { eventId, eventTitle: event.title },
      }));
    } catch (error) {
      console.error("Error deleting event:", error);
      if (busyBtn) { busyBtn.innerHTML = originalHtml || '<i class="fas fa-trash mr-2"></i> Xóa'; busyBtn.disabled = false; }

      let errorMessage = error.message || "Lỗi khi xóa sự kiện";
      if (error.message.includes("liên kết") || error.message.includes("task")) {
        errorMessage = "⛔ " + error.message;
      } else if (error.message.includes("database") || error.message.includes("ID hợp lệ")) {
        errorMessage = "⚠️ " + error.message;
      }
      Utils.showToast?.(errorMessage, "error");
    }
  };

  // ------------------------------------------------------------------
  // Group task event detail
  // ------------------------------------------------------------------

  CM._showGroupTaskDetail = function (event) {
    const p = event.extendedProps;
    const statusMap = {
      pending: ["Chờ xử lý", "#a16207", "#fef9c3"],
      in_progress: ["Đang làm", "#1d4ed8", "#dbeafe"],
      completed: ["Hoàn thành", "#15803d", "#dcfce7"],
      cancelled: ["Đã huỷ", "#64748b", "#f1f5f9"],
    };
    const [statusLabel, statusColor, statusBg] = statusMap[p.status] || statusMap.pending;
    const prioTexts = { 1: "Khẩn cấp", 2: "Bình thường", 3: "Thấp", 4: "Rất thấp" };
    const prioColors = { 1: "#ef4444", 2: "#60A5FA", 3: "#FBBF24", 4: "#94a3b8" };
    const dotColor = prioColors[p.priority] || "#60A5FA";
    const deadline = p.deadline ? new Date(p.deadline).toLocaleDateString("vi-VN") : "";
    const isOverdue = p.deadline && p.status !== "completed" && new Date(p.deadline) < new Date();

    const modalHtml = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9998]" id="eventDetailModal">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 rounded-t-2xl flex items-start justify-between gap-3" style="background:var(--accent-header, linear-gradient(135deg,#334155,#1e293b))">
          <div class="flex items-center gap-3 min-w-0">
            <i class="fas fa-users-cog text-white/80 flex-shrink-0"></i>
            <h3 class="text-white font-bold text-lg leading-tight truncate">${event.title}</h3>
          </div>
          <button id="closeEventDetail" class="text-white/60 hover:text-white text-2xl leading-none flex-shrink-0">&times;</button>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-2 text-xs">
            <span class="px-2 py-1 rounded-full font-semibold" style="background:#dbeafe;color:#1d4ed8"><i class="fas fa-users mr-1"></i>${p.groupName}</span>
            <span class="px-2 py-1 rounded-full font-semibold" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
            <span class="px-2 py-1 rounded-full font-semibold" style="background:${dotColor}22;color:${dotColor}">${prioTexts[p.priority] || "Bình thường"}</span>
          </div>
          ${p.description ? `<div class="text-sm text-gray-600 bg-gray-50 rounded-xl p-3"><i class="fas fa-align-left mr-2 text-gray-400"></i>${p.description}</div>` : ""}
          <div class="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            ${deadline ? `<div class="flex items-center gap-2 ${isOverdue ? "text-red-600 font-semibold" : "text-gray-700"}"><i class="fas fa-calendar-alt w-4"></i><span>Hạn chót: ${deadline}${isOverdue ? " (quá hạn)" : ""}</span></div>` : ""}
          </div>
          <div class="space-y-2">
            <p class="text-xs font-semibold text-gray-500">Đổi trạng thái</p>
            <div class="flex gap-2 flex-wrap" id="gtStatusBtns">
              ${["pending", "in_progress", "completed", "cancelled"].map((s) => {
                const [label, c, bg] = statusMap[s];
                const active = s === p.status;
                return `<button data-status="${s}" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${active ? "ring-2 ring-offset-1" : "opacity-60 hover:opacity-100"}" style="background:${bg};color:${c};${active ? `ring-color:${c}` : ""}">${label}</button>`;
              }).join("")}
            </div>
          </div>
          <button id="gtOpenGroup" class="w-full py-2.5 rounded-xl text-sm font-semibold transition border border-slate-200 hover:bg-slate-50 text-slate-700">
            <i class="fas fa-external-link-alt mr-2"></i>Mở nhóm "${p.groupName}"
          </button>
        </div>
      </div>
    </div>`;

    document.getElementById("eventDetailModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    document.getElementById("closeEventDetail").onclick = () => document.getElementById("eventDetailModal")?.remove();
    document.getElementById("eventDetailModal").addEventListener("click", (e) => {
      if (e.target.id === "eventDetailModal") document.getElementById("eventDetailModal")?.remove();
    });

    // Status change buttons
    document.getElementById("gtStatusBtns")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-status]");
      if (!btn || btn.dataset.status === p.status) return;
      try {
        const token = localStorage.getItem("auth_token");
        const res = await fetch(`/api/group-tasks/${p.groupTaskId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ trangThai: btn.dataset.status }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Lỗi");
        Utils?.showToast?.("Đã cập nhật trạng thái!", "success");
        document.getElementById("eventDetailModal")?.remove();
        this.refreshEventsInPlace();
      } catch (err) {
        Utils?.showToast?.(err.message, "error");
      }
    });

    // Open group
    document.getElementById("gtOpenGroup")?.addEventListener("click", () => {
      document.getElementById("eventDetailModal")?.remove();
      const groupsNav = document.querySelector('[data-section="groups"]');
      if (groupsNav) groupsNav.click();
      setTimeout(() => {
        if (window.GroupListSection) GroupListSection.openDetail(p.groupId);
      }, 300);
    });
  };

  // ------------------------------------------------------------------
  // Update event status (complete + note save)
  // ------------------------------------------------------------------

  CM._updateEventStatus = async function (event) {
    try {
      const checkbox = document.getElementById("eventCompletedCheckbox");
      if (!checkbox) return;

      const completed    = checkbox.checked;
      const wasCompleted = event.extendedProps.completed;

      const saveBtn = document.getElementById("saveEventStatus");
      const originalBtnText = saveBtn.innerHTML;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Đang cập nhật...';

      const eventEls = document.querySelectorAll(
        `[data-event-id="${event.id}"], .fc-event[title*="${event.title.substring(0, 20)}"]`
      );
      const eventEl = document.querySelector(`[data-event-id="${event.id}"]`);

      if (eventEl) {
        if (completed) { eventEl.classList.add("event-completed", "completing"); }
        else           { eventEl.classList.remove("event-completed", "completing"); }
        eventEl.style.opacity = "";
        eventEl.style.textDecoration = "";
      }

      const noteInput = document.getElementById("eventNoteInput");
      const note = noteInput ? noteInput.value.trim() : (event.extendedProps.note || "");

      const res = await Utils.makeRequest(`/api/calendar/events/${event.id}`, "PUT", {
        completed, note,
      });

      if (res.success) {
        event.setExtendedProp("completed", completed);
        event.setExtendedProp("note", note);

        const calendar = this.getCalendar();
        if (calendar) {
          event.remove();
          calendar.addEvent(event.toPlainObject());
        }

        const statusEl = document.querySelector('[class*="text-green-600"], [class*="text-orange-600"]');
        if (statusEl) {
          if (completed) {
            statusEl.className = "text-green-600 font-semibold flex items-center gap-2";
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Đã hoàn thành';
          } else {
            statusEl.className = "text-orange-600 font-semibold flex items-center gap-2";
            statusEl.innerHTML = '<i class="fas fa-clock"></i> Chưa hoàn thành';
          }
        }

        Utils.showToast?.(completed ? "Đã hoàn thành công việc!" : "Bỏ đánh dấu hoàn thành", "success");
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
        if (window.GroupDetailSection?.current) {
          window.GroupDetailSection.load(window.GroupDetailSection.current.GroupID);
        }
        setTimeout(() => { document.getElementById("eventDetailModal")?.remove(); }, 600);
      } else {
        // Revert optimistic UI
        eventEls.forEach((el) => {
          if (wasCompleted) { el.classList.add("event-completed"); }
          else              { el.classList.remove("event-completed"); }
          el.style.textDecoration = "";
          el.style.opacity = "";
          el.style.background = "";
          el.style.filter = "";
        });
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
        checkbox.checked = wasCompleted;
        throw new Error(res.message || "Cập nhật trạng thái thất bại");
      }
    } catch (err) {
      console.error("Cập nhật trạng thái lỗi:", err);
      Utils.showToast?.("" + (err.message || "Lỗi cập nhật trạng thái"), "error");

      const saveBtn = document.getElementById("saveEventStatus");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i> Lưu thay đổi'; }

      const checkbox = document.getElementById("eventCompletedCheckbox");
      if (checkbox) checkbox.checked = event.extendedProps.completed;
    }
  };
})();
