// calendar-module.js — FullCalendar integration core.
// Defines window.CalendarModule with init, renderCalendar, navbar, mini-calendar,
// and public API. Heavy methods live in extension files loaded after this one:
//   calendar-events.js        — loadEvents, working hours, helpers
//   calendar-interactions.js  — drag-drop, eventReceive/Update, quick-create
//   calendar-event-detail.js  — _showEventDetails, subtasks, delete, status update
(function () {
  "use strict";

  if (window.CalendarModule) {
    window.CalendarModule.destroy?.();
  }

  const CalendarModule = {
    calendar: null,
    draggableInstance: null,
    isInitialized: false,
    initPromise: null,
    currentView: "timeGridWeek",
    isDragging: false,

    async init() {
      if (this.isInitialized && this.calendar) this.destroy();

      try {
        await this._initInternal();
        this.isInitialized = true;

        setTimeout(() => this.setupDropZone?.(), 500);
        setTimeout(() => this.setupTaskDragListeners?.(), 2000);
      } catch (err) {
        console.error("Calendar initialization failed:", err);
        this.showError(err);
      }
    },

    async _initInternal() {
      const calendarEl = await this.waitForElement("calendar", 8000);
      if (!calendarEl) throw new Error("Không tìm thấy phần tử #calendar");

      await Promise.all([this.waitForFullCalendar(), this.waitForUtils()]);
      calendarEl.style.minHeight = "700px";

      const events = await this.loadEvents();
      this.renderCalendar(events);

      setTimeout(() => { this.initializeNavbarEvents(); }, 200);

      // Defensive re-mount: first render sometimes misses extendedProps.subtasks
      // (FC copies events on init before batch-fetch mutations propagate visually).
      setTimeout(() => this.refreshEventsInPlace().catch(() => {}), 400);
    },

    // ------------------------------------------------------------------
    // Utility waiters
    // ------------------------------------------------------------------

    waitForElement(id, timeout = 8000) {
      return new Promise((resolve) => {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        const observer = new MutationObserver(() => {
          const found = document.getElementById(id);
          if (found) { observer.disconnect(); resolve(found); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
      });
    },

    waitForFullCalendar(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (typeof FullCalendar !== "undefined") return resolve();
        const start = Date.now();
        const check = () => {
          if (typeof FullCalendar !== "undefined") resolve();
          else if (Date.now() - start > timeout) reject(new Error("FullCalendar timeout"));
          else setTimeout(check, 100);
        };
        check();
      });
    },

    waitForUtils() {
      return new Promise((resolve) => {
        if (typeof Utils !== "undefined") return resolve();
        const check = () => typeof Utils !== "undefined" ? resolve() : setTimeout(check, 100);
        check();
      });
    },

    showError(error) {
      const el = document.getElementById("calendar");
      if (!el) return;
      el.innerHTML = `
        <div class="flex items-center justify-center h-96">
          <div class="text-center p-10 bg-red-50 rounded-xl">
            <div class="text-6xl mb-4">Lỗi</div>
            <h3 class="text-2xl font-bold text-red-700 mb-3">Không tải được lịch</h3>
            <p class="text-gray-600 mb-6">${error.message || error}</p>
            <button onclick="location.reload()" class="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
              Tải lại trang
            </button>
          </div>
        </div>`;
    },

    // ------------------------------------------------------------------
    // renderCalendar — creates the FullCalendar instance
    // ------------------------------------------------------------------

    renderCalendar(events) {
      const el = document.getElementById("calendar");
      if (!el) return;

      if (this.calendar) {
        try { this.calendar.destroy(); } catch (e) {}
        this.calendar = null;
      }
      el.innerHTML = "";

      const wh = this.getWorkingHours();

      this.calendar = new FullCalendar.Calendar(el, {
        initialView: this.currentView,
        locale: "vi",
        height: "100%",
        editable: true,
        droppable: true,
        selectable: true,
        selectMirror: true,
        dayMaxEvents: true,
        headerToolbar: false,
        nowIndicator: true,
        events: events,
        dropAccept: ".task-item, [draggable='true'], [data-task-id]",
        allDaySlot: false,
        slotMinTime: wh.start,
        slotMaxTime: wh.end,
        slotDuration: "00:30:00",
        scrollTime: wh.start,
        buttonText: { today: "Hôm nay", month: "Tháng", week: "Tuần", day: "Ngày", list: "Danh sách" },
        allDayText: "Cả ngày",
        moreLinkText: (n) => `+ ${n} thêm`,
        noEventsText: "Không có sự kiện",

        eventReceive: (info) => { this._handleEventReceive?.(info); },

        eventDrop: async (info) => {
          if (!window.Utils?.isLoggedIn()) { info.revert(); return; }
          if (this._handleEventUpdate) await this._handleEventUpdate(info);
          else info.revert();
        },

        eventResize: async (info) => {
          if (!window.Utils?.isLoggedIn()) { info.revert(); return; }
          if (this._handleEventUpdate) await this._handleEventUpdate(info);
          else info.revert();
        },

        select: (info) => {
          if (!window.Utils?.requireAuth()) { this.calendar.unselect(); return; }
          this._showQuickCreateModal?.(info.start, info.end, info.allDay);
          this.calendar.unselect();
        },

        eventDragStart: () => { document.body.classList.add("calendar-dragging"); },

        eventDragStop: (info) => {
          document.body.classList.remove("calendar-dragging");
          const sidebar = document.getElementById("calendar-sidebar");
          if (!sidebar) return;
          const r = sidebar.getBoundingClientRect();
          const x = info.jsEvent?.clientX, y = info.jsEvent?.clientY;
          if (typeof x !== "number" || typeof y !== "number") return;
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            this._dragDeleteEvent?.(info.event);
          }
        },

        eventClick: (info) => {
          info.jsEvent.preventDefault();
          if (!window.Utils?.requireAuth()) return;
          if (window.CalendarBulkComplete?.handleEventClick(info)) return;
          this._showEventDetails?.(info.event);
        },

        datesSet: () => { document.querySelectorAll(".evt-tooltip").forEach((t) => t.remove()); this.updateCalendarTitle(); },

        eventContent: (arg) => {
          const ev = arg.event;
          const timeText = arg.timeText || "";
          const note = ev.extendedProps?.note || "";
          const category = ev.extendedProps?.category || "";
          const title = ev.title || "";
          const isShared = ev.extendedProps?.isShared;
          const ownerName = ev.extendedProps?.ownerName || "";
          const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
          const sharedLabel = isShared && ownerName ? `<span class="shared-event-label"><i class="fas fa-user-friends"></i> ${esc(ownerName)}</span>` : "";
          const metaParts = [];
          if (timeText) metaParts.push(`<span><i class="far fa-clock"></i>${esc(timeText)}</span>`);
          if (category) metaParts.push(`<span><i class="fas fa-folder"></i>${esc(category)}</span>`);
          const metaHtml = metaParts.length ? `<div class="sched-evt-meta">${metaParts.join("")}</div>` : "";
          const noteHtml = note
            ? `<div class="sched-evt-note"><span class="sched-evt-note-label">Note</span><div class="sched-evt-note-body">${esc(note)}</div></div>`
            : "";
          return { html: `${sharedLabel}<div class="sched-evt-title"><span class="sched-evt-title-text">${esc(title)}</span></div>${metaHtml}${noteHtml}` };
        },

        eventDidMount: (info) => {
          const evEl = info.el;
          evEl.style.cursor = "pointer";
          evEl.setAttribute("data-event-id",  info.event.id);
          evEl.setAttribute("data-eventid",   info.event.id);

          // Compute duration in minutes for adaptive content display
          const start = info.event.start;
          const end = info.event.end || new Date(start.getTime() + 3600000);
          const mins = Math.round((end - start) / 60000);
          if (mins <= 30) evEl.setAttribute("data-size", "xs");
          else if (mins <= 60) evEl.setAttribute("data-size", "sm");
          else if (mins <= 90) evEl.setAttribute("data-size", "md");

          const priority = info.event.extendedProps.priority || 2;
          evEl.style.setProperty("--ev-accent", `var(--prio-${priority})`);

          if (priority === 1)      evEl.classList.add("event-priority-low");
          else if (priority === 3) evEl.classList.add("event-priority-medium");
          else if (priority === 4) evEl.classList.add("event-priority-high");

          if (info.event.extendedProps.aiSuggested) evEl.classList.add("event-ai-suggested");
          if (info.event.extendedProps.completed)   evEl.classList.add("event-completed");
          if (info.event.extendedProps.isShared)     evEl.classList.add("shared-event");

          if (window.CalendarBulkComplete?.refreshStyles) {
            queueMicrotask(() => window.CalendarBulkComplete.refreshStyles());
          }

          // Subtask stack overlay
          const subtasks = info.event.extendedProps.subtasks || [];
          if (subtasks.length > 0) {
            if (getComputedStyle(evEl).position === "static") evEl.style.position = "relative";
            const stack = document.createElement("div");
            stack.className = "fc-event-subtask-stack";
            stack.style.cssText = "position:absolute;left:4px;right:4px;bottom:4px;display:flex;flex-direction:column;gap:3px;z-index:4;pointer-events:none;";
            const MAX = 3;
            subtasks.slice(0, MAX).forEach((s) => {
              const chip = document.createElement("div");
              chip.style.cssText = `font-size:10px;line-height:1.3;padding:3px 6px;border-radius:4px;background:rgba(255,255,255,0.94);color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.12);${s.is_done ? "text-decoration:line-through;color:#64748b;" : ""}`;
              let timeLabel = "";
              if (s.start_at && s.end_at) {
                const fmt = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
                timeLabel = `${fmt(s.start_at)}–${fmt(s.end_at)} `;
              }
              chip.textContent = `${s.is_done ? "✓ " : "• "}${timeLabel}${s.title}`;
              chip.title = `${s.title}${timeLabel ? "\n" + timeLabel.trim() : ""}${s.note ? "\n" + s.note : ""}`;
              stack.appendChild(chip);
            });
            if (subtasks.length > MAX) {
              const more = document.createElement("div");
              more.style.cssText = "font-size:10px;padding:2px 6px;color:#fff;font-weight:700;background:rgba(0,0,0,0.25);border-radius:4px;";
              more.textContent = `+${subtasks.length - MAX} minitask nữa`;
              stack.appendChild(more);
            }
            evEl.appendChild(stack);
            evEl.style.overflow = "visible";
          }

          // Rich tooltip — HTML popup on hover for compact events
          evEl.removeAttribute("title");
          this._attachEventTooltip(evEl, info.event);
        },

        views: {
          dayGridMonth: { dayMaxEventRows: 4 },
          timeGridWeek: { slotDuration: "00:30:00" },
          timeGridDay:  { slotDuration: "00:15:00" },
        },
      });

      this.calendar.render();
      window.calendar = this.calendar;
      this.updateCalendarTitle();
      this.initMiniCalendar();
      this.setupDropZone?.();
    },

    // ------------------------------------------------------------------
    // Navbar / view controls
    // ------------------------------------------------------------------

    initializeNavbarEvents() {
      const controls = {
        "cal-prev-btn":    () => this.calendar.prev(),
        "cal-next-btn":    () => this.calendar.next(),
        "cal-today-btn":   () => this.calendar.today(),
        "cal-day-view":    () => this.changeView("timeGridDay"),
        "cal-week-view":   () => this.changeView("timeGridWeek"),
        "cal-month-view":  () => this.changeView("dayGridMonth"),
      };

      Object.entries(controls).forEach(([id, handler]) => {
        const btn = document.getElementById(id);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", (e) => {
            e.preventDefault();
            handler();
            this.updateCalendarTitle();
          });
        }
      });

      this.setActiveView(this.currentView);
    },

    changeView(view) {
      document.querySelectorAll(".evt-tooltip").forEach((t) => t.remove());
      this.currentView = view;
      this.calendar.changeView(view);
      this.updateCalendarTitle();
      this.setActiveView(view);
    },

    setActiveView(view) {
      const map = { "cal-day-view": "timeGridDay", "cal-week-view": "timeGridWeek", "cal-month-view": "dayGridMonth" };
      Object.entries(map).forEach(([id, v]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isActive = v === view;
        btn.classList.toggle("bg-white", isActive);
        btn.style.color     = isActive ? "#1e293b" : "#64748b";
        btn.style.boxShadow = isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "none";
      });
    },

    updateCalendarTitle() {
      const titleEl = document.getElementById("calendar-title");
      if (titleEl && this.calendar) titleEl.textContent = this.calendar.view.title;
    },

    // ------------------------------------------------------------------
    // Mini calendar (sidebar)
    // ------------------------------------------------------------------

    initMiniCalendar() {
      const sidebar = document.getElementById("mini-cal-container") || document.getElementById("calendar-sidebar");
      if (!sidebar) return;

      const today = new Date();
      this._miniDate = new Date(today.getFullYear(), today.getMonth(), 1);

      const render = () => {
        const d = this._miniDate;
        const year = d.getFullYear(), month = d.getMonth();
        const monthNames = ["Tháng 1","Tháng 2","Tháng 3","Tháng 4","Tháng 5","Tháng 6","Tháng 7","Tháng 8","Tháng 9","Tháng 10","Tháng 11","Tháng 12"];
        const days = ["CN","T2","T3","T4","T5","T6","T7"];
        const firstDay    = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayNum    = today.getDate();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

        const eventDates = new Set();
        if (this.calendar) {
          this.calendar.getEvents().forEach((ev) => {
            if (!ev.start) return;
            const d = ev.start;
            if (d.getFullYear() === year && d.getMonth() === month) {
              eventDates.add(d.getDate());
            }
          });
        }

        let cells = "";
        for (let i = 0; i < firstDay; i++) cells += `<div></div>`;
        for (let i = 1; i <= daysInMonth; i++) {
          const isToday = isCurrentMonth && i === todayNum;
          const hasEvent = eventDates.has(i);
          cells += `<button class="mini-cal-day${isToday ? " today-day" : ""}${hasEvent ? " has-event" : ""}" data-date="${year}-${String(month+1).padStart(2,"0")}-${String(i).padStart(2,"0")}">${i}</button>`;
        }

        sidebar.innerHTML = `
          <div class="p-4 select-none">
            <div class="flex items-center justify-between mb-3">
              <button id="mini-prev" class="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-800 transition">
                <i class="fas fa-chevron-left text-xs"></i>
              </button>
              <span class="text-sm font-bold text-gray-800">${monthNames[month]} ${year}</span>
              <button id="mini-next" class="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-800 transition">
                <i class="fas fa-chevron-right text-xs"></i>
              </button>
            </div>
            <div class="grid grid-cols-7 gap-0.5 mb-1">
              ${days.map((dd) => `<div class="text-center text-xs font-semibold text-gray-400 py-1">${dd}</div>`).join("")}
            </div>
            <div class="grid grid-cols-7 gap-0.5">${cells}</div>
            <button id="mini-today" class="mt-3 w-full text-xs font-semibold py-1.5 rounded-lg transition" style="color:var(--accent, #2563EB)"
              onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='transparent'">Hôm nay</button>
          </div>`;

        document.getElementById("mini-prev").onclick = () => { this._miniDate = new Date(year, month - 1, 1); render(); };
        document.getElementById("mini-next").onclick = () => { this._miniDate = new Date(year, month + 1, 1); render(); };
        document.getElementById("mini-today").onclick = () => {
          this._miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
          render();
          this.calendar?.today();
        };
        sidebar.querySelectorAll(".mini-cal-day").forEach((btn) => {
          btn.addEventListener("click", () => {
            const dateStr = btn.dataset.date;
            if (this.calendar) {
              this.calendar.gotoDate(dateStr);
              if (this.currentView === "dayGridMonth") {
                this.calendar.changeView("timeGridDay", dateStr);
                this.currentView = "timeGridDay";
                this.setActiveView("timeGridDay");
              }
            }
          });
        });
      };

      render();
    },

    // ------------------------------------------------------------------
    // Event tooltip (HTML popup, not native title)
    // ------------------------------------------------------------------

    _attachEventTooltip(el, event) {
      let tip = null;
      let hideTimer = null;

      const hide = () => {
        clearTimeout(hideTimer);
        if (!tip) return;
        tip.classList.remove("visible");
        const ref = tip;
        setTimeout(() => ref.remove(), 120);
        tip = null;
      };

      const show = () => {
        document.querySelectorAll(".evt-tooltip").forEach((t) => t.remove());
        if (tip) return;

        const fmt = (d) => d?.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) || "";
        const note = event.extendedProps?.note || "";
        const cat = event.extendedProps?.category || "";
        const subs = event.extendedProps?.subtasks || [];
        const done = subs.filter((s) => s.is_done).length;

        let rows = `<div class="evt-tip-title">${event.title}</div>`;
        rows += `<div class="evt-tip-row"><i class="far fa-clock"></i>${fmt(event.start)} – ${fmt(event.end)}</div>`;
        if (cat) rows += `<div class="evt-tip-row"><i class="far fa-folder"></i>${cat}</div>`;
        if (note) rows += `<div class="evt-tip-row"><i class="far fa-sticky-note"></i>${note}</div>`;
        if (subs.length) rows += `<div class="evt-tip-row"><i class="far fa-check-square"></i>${done}/${subs.length} subtasks</div>`;

        tip = document.createElement("div");
        tip.className = "evt-tooltip";
        tip.innerHTML = rows;
        document.body.appendChild(tip);

        const r = el.getBoundingClientRect();
        const tw = tip.offsetWidth;
        let left = r.right + 8;
        if (left + tw > window.innerWidth - 12) left = r.left - tw - 8;
        tip.style.top = Math.max(4, r.top) + "px";
        tip.style.left = left + "px";
        requestAnimationFrame(() => tip.classList.add("visible"));

        hideTimer = setTimeout(hide, 3000);
      };

      el.addEventListener("mouseenter", show);
      el.addEventListener("mouseleave", hide);
      el.addEventListener("mousedown", hide);
    },

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    destroy() {
      if (this.draggableInstance) {
        try { this.draggableInstance.destroy(); } catch (e) {}
        this.draggableInstance = null;
      }
      if (this.calendar) {
        try { this.calendar.destroy(); } catch (e) {}
        this.calendar = null;
      }
      this.isInitialized = false;
    },

    refresh() { this.init(); },

    getCalendar() { return this.calendar; },
  };

  window.CalendarModule = CalendarModule;
})();
