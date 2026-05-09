// calendar-interactions.js — extends CalendarModule with drag-drop, drop-zone,
// event receive/update/delete, fixed-time choice, and quick-create modal.
// Depends on: calendar-module.js + calendar-events.js (must be loaded first)
(function () {
  "use strict";

  const CM = window.CalendarModule;
  if (!CM) {
    console.error("calendar-interactions.js: CalendarModule not found");
    return;
  }

  // ------------------------------------------------------------------
  // External draggable (task-list → calendar)
  // ------------------------------------------------------------------

  CM.setupTaskDragListeners = function () {
    this.initializeExternalDraggable();
  };

  CM.initializeExternalDraggable = function () {
    const taskList = document.getElementById("task-list");
    if (!taskList) return;
    if (typeof FullCalendar === "undefined" || !FullCalendar.Draggable) return;

    if (this.draggableInstance) {
      try { this.draggableInstance.destroy(); } catch (_) {}
      this.draggableInstance = null;
    }

    const self = this;
    this.draggableInstance = new FullCalendar.Draggable(taskList, {
      itemSelector: ".task-item",
      eventData: (eventEl) => {
        const taskId = eventEl.dataset.taskId;
        const title =
          eventEl.dataset.taskTitle ||
          eventEl.querySelector(".task-item-title")?.textContent?.trim() ||
          "Công việc";
        const priority = parseInt(eventEl.dataset.taskPriority, 10) || 2;
        const description = eventEl.dataset.taskDescription || "";
        const color = self.getPriorityColor(priority);
        return {
          id: `drag-${taskId}`,
          title,
          backgroundColor: "#ffffff",
          borderColor: "#111827",
          textColor: "#0f172a",
          extendedProps: { taskId, priority, description, isFromDrag: true, accent: color },
        };
      },
    });
  };

  // ------------------------------------------------------------------
  // Drop-zone (HTML5 drag-drop fallback)
  // ------------------------------------------------------------------

  CM.setupDropZone = function () {
    const calendarEl = document.getElementById("calendar");
    if (!calendarEl) return;

    try {
      if (this._boundCalendarDragOver) calendarEl.removeEventListener("dragover", this._boundCalendarDragOver);
      if (this._boundCalendarDragLeave) calendarEl.removeEventListener("dragleave", this._boundCalendarDragLeave);
      if (this._boundCalendarDrop) calendarEl.removeEventListener("drop", this._boundCalendarDrop);
    } catch (e) {}

    this._boundCalendarDragOver  = this.handleDragOver.bind(this);
    this._boundCalendarDragLeave = this.handleDragLeave.bind(this);
    this._boundCalendarDrop      = this.handleDrop.bind(this);

    calendarEl.addEventListener("dragover",  this._boundCalendarDragOver);
    calendarEl.addEventListener("dragleave", this._boundCalendarDragLeave);
    calendarEl.addEventListener("drop",      this._boundCalendarDrop);

    const style = document.createElement("style");
    style.textContent = `
      .drop-zone-active { background-color: rgba(239,68,68,0.1) !important; border: 2px dashed #ef4444 !important; }
      .task-item.dragging { opacity: 0.7; transform: scale(0.95); box-shadow: 0 0 20px rgba(59,130,246,0.3); }
    `;
    document.head.appendChild(style);

    try {
      if (this._docDropListener) document.removeEventListener("drop", this._docDropListener);
      this._docDropListener = (e) => {
        const r = calendarEl.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (inside) { e.preventDefault(); this.handleDrop(e); }
      };
      document.addEventListener("drop", this._docDropListener);
    } catch (e) {}
  };

  CM.handleDragOver = function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    document.getElementById("calendar")?.classList.add("drop-zone-active");
  };

  CM.handleDragLeave = function (e) {
    e.preventDefault();
    const calendarEl = document.getElementById("calendar");
    if (calendarEl && !calendarEl.contains(e.relatedTarget)) {
      calendarEl.classList.remove("drop-zone-active");
    }
  };

  CM.handleDrop = async function (e) {
    if (this._handlingDrop) return;
    this._handlingDrop = true;
    try {
      e.preventDefault();
      document.getElementById("calendar")?.classList.remove("drop-zone-active");

      let taskId = e.dataTransfer.getData("text/plain");
      let taskData = {};
      const jsonData = e.dataTransfer.getData("application/json");
      if (jsonData) {
        try { taskData = JSON.parse(jsonData); } catch (err) {}
      }
      if (!taskId) taskId = e.dataTransfer.getData("taskId") || taskData.taskId;
      if (!taskId) return;

      const title = taskData.title || "Công việc mới";
      const color = taskData.color || "#3B82F6";
      const durationMinutes = taskData.duration || 60;
      const priority = taskData.priority || 2;
      const note = taskData.description || taskData.note || "";

      let dropDate = new Date();
      dropDate.setMinutes(0); dropDate.setSeconds(0); dropDate.setMilliseconds(0);

      const startDate = dropDate;
      const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

      const newEvent = {
        id: `temp-${Date.now()}`,
        title,
        start: startDate,
        end: endDate,
        backgroundColor: "#ffffff",
        borderColor: "#111827",
        textColor: "#0f172a",
        editable: true, durationEditable: true, startEditable: true,
        extendedProps: { taskId, isFromDrag: true, color, accent: color, priority },
      };

      const existingEvents = this.calendar.getEvents();
      const hasConflict = existingEvents.some((existing) => {
        if (existing.id?.startsWith("temp-")) return false;
        const s2 = existing.start;
        const e2 = existing.end || new Date(s2.getTime() + 60 * 60 * 1000);
        return startDate < e2 && endDate > s2;
      });

      if (hasConflict) {
        Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
        return;
      }

      this.calendar.addEvent(newEvent);
      await this.saveDroppedEvent(taskId, title, color, startDate, endDate, priority, durationMinutes, note);
    } catch (error) {
      console.error("Drop error:", error);
      Utils.showToast?.("Lỗi khi kéo thả công việc", "error");
    } finally {
      this._handlingDrop = false;
    }
  };

  // ------------------------------------------------------------------
  // FC event callbacks (receive / drop / resize)
  // ------------------------------------------------------------------

  CM._handleEventReceive = async function (info) {
    try {
      const draggedEl = info.draggedEl;
      let taskId, title, color, priority, duration, hasFixedTime, fixedStart, fixedEnd, note;

      if (draggedEl) {
        taskId      = draggedEl.dataset.taskId;
        title       = draggedEl.dataset.taskTitle || "Công việc";
        color       = draggedEl.dataset.taskColor || "#3B82F6";
        priority    = parseInt(draggedEl.dataset.taskPriority) || 2;
        duration    = parseInt(draggedEl.dataset.taskDuration) || 60;
        hasFixedTime = draggedEl.dataset.hasFixedTime === "true";
        fixedStart  = draggedEl.dataset.fixedStart || "";
        fixedEnd    = draggedEl.dataset.fixedEnd || "";
        note        = draggedEl.dataset.taskDescription || "";
      } else {
        taskId = info.jsEvent?.dataTransfer?.getData("text/plain");
        const jsonData = info.jsEvent?.dataTransfer?.getData("application/json");
        if (jsonData) {
          const data = JSON.parse(jsonData);
          title        = data.title || "Công việc";
          color        = data.color || "#3B82F6";
          priority     = data.priority || 2;
          duration     = data.duration || 60;
          hasFixedTime = data.hasFixedTime || false;
          fixedStart   = data.fixedStart || "";
          fixedEnd     = data.fixedEnd || "";
          note         = data.description || data.note || "";
        } else {
          duration = 60; note = "";
        }
      }

      color = this.getPriorityColor(priority);

      if (!taskId) {
        info.event.remove();
        Utils.showToast?.("Lỗi: Không tìm thấy ID công việc", "error");
        return;
      }

      if (hasFixedTime && fixedStart) {
        const useFixed = await this._showFixedTimeChoice(title, fixedStart, fixedEnd);
        if (useFixed) {
          const fStart = new Date(fixedStart);
          const fEnd = fixedEnd ? new Date(fixedEnd) : new Date(fStart.getTime() + duration * 60 * 1000);
          info.event.setStart(fStart);
          info.event.setEnd(fEnd);
          await this.saveDroppedEvent(taskId, title, color, fStart, fEnd, priority, duration, note);
          return;
        }
      }

      const start = info.event.start;
      const end = new Date(start.getTime() + duration * 60 * 1000);
      info.event.setEnd(end);

      const hasConflict = this.calendar.getEvents().some((existingEvent) => {
        if (existingEvent.id === info.event.id) return false;
        if (existingEvent.id?.startsWith("temp-")) return false;
        const s2 = existingEvent.start;
        const e2 = existingEvent.end || new Date(s2.getTime() + duration * 60 * 1000);
        return start < e2 && end > s2;
      });

      if (hasConflict) {
        Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
        info.event.remove();
        return;
      }

      await this.saveDroppedEvent(taskId, title, color, start, end, priority, duration, note);
    } catch (err) {
      console.error("Event receive error:", err);
      info.event.remove();
      Utils.showToast?.("Lỗi kéo thả công việc", "error");
    }
  };

  CM._handleEventUpdate = async function (info) {
    try {
      const eventId = info.event.id;
      if (!eventId) throw new Error("Event không có ID");

      if (info.event.extendedProps.completed) {
        const newStart = info.event.start;
        if (newStart > new Date()) {
          Utils.showToast?.("Không thể kéo công việc đã hoàn thành đến thời gian chưa xảy ra!", "warning");
          info.revert();
          return;
        }
      }

      if (eventId.toString().startsWith("temp-") || eventId.toString().startsWith("drag-")) return;

      const eventIdNum = parseInt(eventId, 10);
      if (isNaN(eventIdNum)) return;

      const newStart = info.event.start;
      const newEnd = info.event.end || new Date(newStart.getTime() + 60 * 60 * 1000);

      if (this.hasTimeConflict(info.event)) {
        Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
        info.revert();
        return;
      }

      Utils.showToast?.("Đang cập nhật thời gian...", "info");
      const result = await Utils.makeRequest(`/api/calendar/events/${eventIdNum}`, "PUT", {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });

      if (!result.success) throw new Error(result.message || "Cập nhật thất bại");

      Utils.showToast?.("Đã cập nhật thời gian sự kiện", "success");

      const eventEl = document.querySelector(`[data-event-id="${eventId}"]`);
      if (eventEl) {
        eventEl.classList.add("bg-green-50", "border-green-200");
        setTimeout(() => eventEl.classList.remove("bg-green-50", "border-green-200"), 1500);
      }

      this.refreshEventsInPlace().catch(() => {});
    } catch (error) {
      console.error("Error in eventUpdate:", error);
      let errorMessage = "Lỗi khi cập nhật thời gian";
      if (error.message.includes("conflict") || error.message.includes("trùng")) {
        errorMessage = "Không thể di chuyển: Thời gian đã có sự kiện khác!";
      } else if (error.message.includes("validation")) {
        errorMessage = "Thời gian không hợp lệ!";
      } else {
        errorMessage = error.message || "Lỗi khi cập nhật thời gian";
      }
      Utils.showToast?.(errorMessage, "error");
      info.revert();
    }
  };

  // ------------------------------------------------------------------
  // Save dropped event to DB
  // ------------------------------------------------------------------

  CM.saveDroppedEvent = async function (taskId, title, color, start, end, priority = 2, duration = 60, note = "") {
    try {
      const eventData = {
        MaCongViec: parseInt(taskId),
        TieuDe: title,
        GioBatDau: start.toISOString(),
        GioKetThuc: end.toISOString(),
        MucDoUuTien: priority,
        AI_DeXuat: 0,
        GhiChu: note || "",
      };

      const res = await Utils.makeRequest("/api/calendar/events", "POST", eventData);

      if (res.success) {
        const newEventId = res.eventId || res.data?.MaLichTrinh || res.data?.id;
        const events = this.calendar.getEvents();
        let tempEvent = events.find((e) => e.id === `drag-${taskId}`) ||
          events.find((e) => e.id?.startsWith("temp-") || e.id?.startsWith("drag-"));

        if (tempEvent) {
          tempEvent.setProp("id", newEventId);
          tempEvent.setStart(start);
          tempEvent.setEnd(end);
          tempEvent.setProp("backgroundColor", "#ffffff");
          tempEvent.setProp("borderColor", "#111827");
          tempEvent.setProp("textColor", "#0f172a");
          tempEvent.setExtendedProp("accent", color);
          tempEvent.setExtendedProp("taskId", taskId);
          tempEvent.setExtendedProp("isFromDrag", true);
          tempEvent.setExtendedProp("priority", priority);
          tempEvent.setExtendedProp("completed", false);
          tempEvent.setExtendedProp("note", note || "");
          tempEvent.setProp("editable", true);
          tempEvent.setProp("durationEditable", true);
          tempEvent.setProp("startEditable", true);
        }

        await Utils.makeRequest(`/api/tasks/${taskId}`, "PUT", { TrangThaiThucHien: 1 });
        Utils.showToast?.("Đã lên lịch thành công!", "success");
        if (window.loadUserTasks) window.loadUserTasks(true);
        this.triggerSidebarRefresh();
        if (window.GroupDetailSection?.current) {
          window.GroupDetailSection.load(window.GroupDetailSection.current.GroupID);
        }
      } else {
        throw new Error(res.message || "Lỗi thêm vào lịch");
      }
    } catch (error) {
      console.error("Error saving dropped event:", error);
      const tempEvent = this.calendar.getEvents().find((e) => e.id?.startsWith("temp-"));
      if (tempEvent) tempEvent.remove();
      Utils.showToast?.(error.message || "Lỗi khi lưu sự kiện", "error");
    }
  };

  // ------------------------------------------------------------------
  // Drag-to-delete
  // ------------------------------------------------------------------

  CM._dragDeleteEvent = async function (event) {
    const id = event.id?.toString() || "";
    if (!id || id.startsWith("temp-") || id.startsWith("drag-")) {
      try { event.remove(); } catch (_) {}
      return;
    }
    const confirmed = await Utils.confirmDanger(`Xóa sự kiện "${event.title}"? Không thể hoàn tác.`, "Xoá sự kiện");
    if (!confirmed) return;
    this._deleteEvent(event);
  };

  // ------------------------------------------------------------------
  // Fixed-time choice dialog
  // ------------------------------------------------------------------

  CM._showFixedTimeChoice = function (title, fixedStart, fixedEnd) {
    return new Promise((resolve) => {
      const fStart = new Date(fixedStart);
      const startLabel = fStart.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const html = `
        <div id="fixedTimeChoiceModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div class="bg-gradient-to-r from-slate-700 to-slate-800 px-5 py-3">
              <h3 class="text-white font-bold text-sm">Xếp lịch: ${title}</h3>
            </div>
            <div class="p-5 space-y-3">
              <p class="text-xs text-gray-500">Công việc này có thời gian cố định: <strong>${startLabel}</strong></p>
              <button id="useFixedTimeBtn" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition">Xếp theo lịch cố định</button>
              <button id="useCustomTimeBtn" class="w-full py-2.5 border-2 border-gray-200 rounded-xl text-gray-600 font-medium text-sm hover:bg-gray-50 transition">Xếp lịch tuỳ chọn</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML("beforeend", html);
      const modal = document.getElementById("fixedTimeChoiceModal");
      document.getElementById("useFixedTimeBtn").onclick  = () => { modal?.remove(); resolve(true); };
      document.getElementById("useCustomTimeBtn").onclick = () => { modal?.remove(); resolve(false); };
      modal.addEventListener("click", (e) => { if (e.target === modal) { modal?.remove(); resolve(false); } });
    });
  };

  // ------------------------------------------------------------------
  // Inline new-category popup (used by quick-create modal)
  // ------------------------------------------------------------------

  CM._showInlineNewCategory = function (reloadCallback) {
    const existing = document.getElementById("inlineNewCatPopup");
    if (existing) { existing.remove(); return; }
    const popup = document.createElement("div");
    popup.id = "inlineNewCatPopup";
    popup.className = "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[10001]";
    popup.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 p-5 space-y-3">
        <h4 class="font-bold text-sm text-gray-800">Tạo danh mục mới</h4>
        <input type="text" id="newCatName" placeholder="Tên danh mục *" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        <input type="text" id="newCatDesc" placeholder="Mô tả (không bắt buộc)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        <div class="flex gap-2">
          <button id="cancelNewCat" class="flex-1 py-2 border border-gray-200 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-50">Hủy</button>
          <button id="saveNewCat" class="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">Tạo</button>
        </div>
      </div>`;
    document.body.appendChild(popup);
    popup.addEventListener("click", (e) => { if (e.target === popup) popup.remove(); });
    document.getElementById("cancelNewCat").onclick = () => popup.remove();
    document.getElementById("saveNewCat").onclick = async () => {
      const name = document.getElementById("newCatName").value.trim();
      if (!name) { document.getElementById("newCatName").style.borderColor = "#ef4444"; return; }
      const desc = document.getElementById("newCatDesc").value.trim();
      try {
        const res = await Utils.makeRequest("/api/categories", "POST", { TenLoai: name, MoTa: desc });
        if (res.success) { Utils.showToast?.("Đã tạo danh mục", "success"); popup.remove(); if (reloadCallback) reloadCallback(); }
        else { Utils.showToast?.(res.message || "Lỗi", "error"); }
      } catch (err) { Utils.showToast?.("Lỗi tạo danh mục", "error"); }
    };
    document.getElementById("newCatName").focus();
  };

  // ------------------------------------------------------------------
  // Quick-create modal (select time range on calendar → new task)
  // ------------------------------------------------------------------

  CM._showQuickCreateModal = function (start, end, allDay) {
    const startISO = start instanceof Date ? start.toISOString() : start;
    const endISO   = end   instanceof Date ? end.toISOString()   : end;
    const startDate = new Date(startISO);
    const endDate   = new Date(endISO);
    const initialDurationMin = Math.max(15, Math.round((endDate - startDate) / 60000) || 60);

    const fmtDate = (d) => d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const fmtTime = (d) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const sameDay = startDate.toDateString() === endDate.toDateString();
    const initialTimeLabel = sameDay
      ? `${fmtDate(startDate)} · ${fmtTime(startDate)} – ${fmtTime(endDate)}`
      : `${fmtDate(startDate)} ${fmtTime(startDate)} → ${fmtDate(endDate)} ${fmtTime(endDate)}`;

    document.getElementById("quickCreateModal")?.remove();

    const priorityLabels = { 1: "Thấp", 2: "Trung bình", 3: "Cao", 4: "Rất cao" };
    const priorityColor = (p) => this.getPriorityColor(p);
    const priorityOptsHtml = [1, 2, 3, 4].map((p) => `
      <label class="cursor-pointer">
        <input type="radio" name="qc-priority" value="${p}" class="hidden"${p === 2 ? " checked" : ""} />
        <div class="priority-opt rounded-xl py-2 text-center text-xs font-semibold border-2 transition-all"
          data-p="${p}"
          style="background:${priorityColor(p)}11;color:${priorityColor(p)};border-color:${p === 2 ? priorityColor(p) : "transparent"}">
          ${priorityLabels[p]}
        </div>
      </label>
    `).join("");

    const html = `
      <div id="quickCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          <div style="background:var(--accent-header, #2563EB)" class="px-6 py-4 flex justify-between items-center">
            <h3 class="text-white font-bold text-lg flex items-center gap-2"><i class="fas fa-plus-circle"></i> Tạo công việc mới</h3>
            <button id="closeQuickCreate" class="text-white/70 hover:text-white text-xl">&times;</button>
          </div>
          <div class="px-6 py-5 space-y-4">
            <div id="qc-time-display" class="rounded-lg px-4 py-2 text-sm flex items-center gap-2" style="background:#eff6ff;color:#1d4ed8">
              <i class="fas fa-clock"></i> <span id="qc-time-label">${initialTimeLabel}</span>
            </div>
            <div>
              <input type="text" id="qc-title" placeholder="Tên công việc *"
                class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-600 focus:outline-none text-gray-800 font-medium" />
            </div>
            <div>
              <textarea id="qc-note" placeholder="Ghi chú (không bắt buộc)" rows="2"
                class="w-full px-4 py-2 border-2 border-gray-200 rounded-xl focus:border-blue-600 focus:outline-none text-gray-700 resize-none"></textarea>
            </div>
            <div>
              <p class="text-sm font-semibold text-gray-600 mb-2">Độ ưu tiên</p>
              <div class="grid grid-cols-4 gap-2" id="qc-priority-group">${priorityOptsHtml}</div>
            </div>
            <div>
              <label class="text-sm font-semibold text-gray-600 mb-2 block flex items-center gap-1">
                <i class="fas fa-tag text-blue-400 text-xs"></i> Loại công việc
              </label>
              <div id="qc-category-chips" class="flex flex-wrap gap-2 min-h-[36px]">
                <span class="text-xs text-gray-400 italic">Đang tải...</span>
              </div>
              <input type="hidden" id="qc-category" value="" />
            </div>
            <div>
              <label class="text-sm font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                <i class="fas fa-clock text-blue-400 text-xs"></i> Thời gian ước tính
              </label>
              <div class="flex items-center gap-2">
                <input type="range" id="qc-duration" value="60" min="15" max="480" step="15" class="flex-1 accent-blue-600" />
                <span id="qc-duration-label" class="text-sm font-bold w-16 text-right" style="color:#2563EB">60 phút</span>
              </div>
            </div>
          </div>
          <div class="px-6 pb-5 flex gap-3">
            <button id="closeQuickCreate2" class="flex-1 py-3 border-2 border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50 transition">Hủy</button>
            <button id="saveQuickCreate" class="flex-1 py-3 text-white rounded-xl font-semibold transition flex items-center justify-center gap-2" style="background:var(--accent, #2563EB)">
              <i class="fas fa-plus"></i> Tạo công việc
            </button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML("beforeend", html);

    // Initial duration slider value
    const durSliderInit = document.getElementById("qc-duration");
    if (durSliderInit) durSliderInit.value = String(Math.min(480, initialDurationMin));
    const durLabelInit = document.getElementById("qc-duration-label");
    if (durLabelInit) durLabelInit.textContent = (durSliderInit?.value || "60") + " phút";

    // Priority selector
    document.querySelectorAll("#qc-priority-group input[type=radio]").forEach((radio) => {
      radio.addEventListener("change", () => {
        document.querySelectorAll("#qc-priority-group .priority-opt").forEach((opt) => {
          opt.style.borderColor = "transparent";
        });
        const hex = priorityColor(parseInt(radio.value, 10));
        radio.closest("label").querySelector(".priority-opt").style.borderColor = hex;
      });
    });

    // Category chips
    const loadQcCategories = () => {
      Utils.makeRequest("/api/categories", "GET").then((res) => {
        const chips = document.getElementById("qc-category-chips");
        const hidden = document.getElementById("qc-category");
        if (!chips) return;
        chips.innerHTML = "";
        const cats = (res.success && res.data?.length) ? res.data : [];
        const colorsList = ["bg-purple-100 text-purple-700","bg-red-100 text-red-700","bg-green-100 text-green-700","bg-amber-100 text-amber-700","bg-pink-100 text-pink-700","bg-cyan-100 text-cyan-700"];
        cats.forEach((c, i) => {
          const id = c.MaLoai || c.id;
          const name = c.TenLoai || c.name || "Không tên";
          const chip = document.createElement("button");
          chip.type = "button";
          chip.dataset.catId = id;
          chip.className = `px-3 py-1 rounded-full text-xs font-semibold border-2 border-transparent transition-all ${colorsList[i % colorsList.length]}`;
          chip.textContent = name;
          chip.onclick = () => {
            chips.querySelectorAll("button:not(.new-cat-btn)").forEach((b) => b.classList.remove("ring-2","ring-offset-1","ring-blue-600","scale-105"));
            if (hidden.value === String(id)) { hidden.value = ""; }
            else { hidden.value = id; chip.classList.add("ring-2","ring-offset-1","ring-blue-600","scale-105"); }
          };
          chips.appendChild(chip);
        });
        const newCatBtn = document.createElement("button");
        newCatBtn.type = "button";
        newCatBtn.className = "new-cat-btn px-3 py-1 rounded-full text-xs font-semibold border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-all";
        newCatBtn.textContent = "+ Mới";
        newCatBtn.onclick = () => this._showInlineNewCategory(loadQcCategories);
        chips.appendChild(newCatBtn);
      }).catch(() => {
        const chips = document.getElementById("qc-category-chips");
        if (chips) chips.innerHTML = '<span class="text-xs text-gray-400 italic">Không tải được</span>';
      });
    };
    loadQcCategories();

    // Duration slider — updates end-time label
    const durSlider  = document.getElementById("qc-duration");
    const durLabel   = document.getElementById("qc-duration-label");
    const timeLabelEl = document.getElementById("qc-time-label");
    const refreshTimeLabel = () => {
      const mins = parseInt(durSlider?.value || String(initialDurationMin), 10);
      const newEnd = new Date(startDate.getTime() + mins * 60000);
      const same = startDate.toDateString() === newEnd.toDateString();
      if (timeLabelEl) {
        timeLabelEl.textContent = same
          ? `${fmtDate(startDate)} · ${fmtTime(startDate)} – ${fmtTime(newEnd)}`
          : `${fmtDate(startDate)} ${fmtTime(startDate)} → ${fmtDate(newEnd)} ${fmtTime(newEnd)}`;
      }
    };
    if (durSlider && durLabel) {
      durSlider.addEventListener("input", () => { durLabel.textContent = durSlider.value + " phút"; refreshTimeLabel(); });
    }

    const close = () => {
      document.removeEventListener("keydown", escHandler);
      document.getElementById("quickCreateModal")?.remove();
    };
    const escHandler = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", escHandler);
    document.getElementById("closeQuickCreate").onclick  = close;
    document.getElementById("closeQuickCreate2").onclick = close;
    document.getElementById("quickCreateModal").addEventListener("click", (e) => { if (e.target.id === "quickCreateModal") close(); });

    document.getElementById("qc-title").focus();

    document.getElementById("saveQuickCreate").onclick = async () => {
      const title = document.getElementById("qc-title").value.trim();
      if (!title) {
        document.getElementById("qc-title").classList.add("border-blue-600");
        document.getElementById("qc-title").placeholder = "Vui lòng nhập tên công việc!";
        return;
      }
      const priority   = parseInt(document.querySelector("#qc-priority-group input[type=radio]:checked")?.value || "2");
      const note       = document.getElementById("qc-note").value.trim();
      const duration   = parseInt(document.getElementById("qc-duration")?.value || "60");
      const categoryId = document.getElementById("qc-category")?.value || undefined;
      const color      = this.getPriorityColor(priority);

      const btn = document.getElementById("saveQuickCreate");
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';

      try {
        const taskRes = await Utils.makeRequest("/api/tasks", "POST", {
          TieuDe: title, MoTa: note, MucDoUuTien: priority, ThoiGianUocTinh: duration,
          ...(categoryId ? { MaLoai: categoryId } : {}), TrangThaiThucHien: 1,
        });
        if (!taskRes.success) throw new Error(taskRes.message || "Lỗi tạo công việc");

        const taskId = taskRes.data?.MaCongViec || taskRes.data?.id || taskRes.taskId;
        const startDateForSave = new Date(startISO);
        const endDateForSave   = new Date(startDateForSave.getTime() + duration * 60000);

        const eventRes = await Utils.makeRequest("/api/calendar/events", "POST", {
          MaCongViec: taskId, TieuDe: title,
          GioBatDau: startDateForSave.toISOString(), GioKetThuc: endDateForSave.toISOString(),
          MucDoUuTien: priority, GhiChu: note, AI_DeXuat: 0,
        });
        if (!eventRes.success) throw new Error(eventRes.message || "Lỗi tạo lịch trình");

        const newEventId = eventRes.eventId || eventRes.data?.MaLichTrinh || eventRes.data?.id;
        this.calendar.addEvent({
          id: newEventId, title, start: startDateForSave, end: endDateForSave,
          backgroundColor: "#ffffff", borderColor: "#111827", textColor: "#0f172a",
          extendedProps: { note, completed: false, taskId, priority, accent: color },
        });

        close();
        Utils.showToast?.("Đã tạo công việc thành công!", "success");
        this.triggerSidebarRefresh();
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> Tạo công việc';
        Utils.showToast?.(err.message || "Lỗi tạo công việc", "error");
      }
    };
  };
})();
