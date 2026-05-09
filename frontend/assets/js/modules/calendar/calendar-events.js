// calendar-events.js — extends CalendarModule with event loading and rendering
// Depends on: calendar-module.js (must be loaded first)
(function () {
  "use strict";

  const CM = window.CalendarModule;
  if (!CM) {
    console.error("calendar-events.js: CalendarModule not found");
    return;
  }

  CM.getPriorityColor = function (priority) {
    return window.PriorityTheme ? PriorityTheme.getColor(priority) : "#3B82F6";
  };

  /**
   * Read the user-customized working-hour window from localStorage.
   * Returns "HH:MM:SS" strings safe to pass to FullCalendar's slotMin/MaxTime.
   */
  CM.getWorkingHours = function () {
    const DEFAULTS = { start: "07:00:00", end: "22:00:00" };
    try {
      const raw = localStorage.getItem("cal_working_hours_v1");
      if (!raw) return DEFAULTS;
      const p = JSON.parse(raw);
      const toHMS = (v) => {
        if (typeof v !== "string") return null;
        const m = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(v.trim());
        if (!m) return null;
        const hh = Math.min(24, Math.max(0, parseInt(m[1], 10)));
        const mm = Math.min(59, Math.max(0, parseInt(m[2] || "0", 10)));
        const ss = Math.min(59, Math.max(0, parseInt(m[3] || "0", 10)));
        return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      };
      const start = toHMS(p.start) || DEFAULTS.start;
      const end = toHMS(p.end) || DEFAULTS.end;
      return start >= end ? DEFAULTS : { start, end };
    } catch (_) {
      return DEFAULTS;
    }
  };

  /** Persist new working hours and live-apply to the mounted calendar. */
  CM.setWorkingHours = function (start, end) {
    const toHMS = (v) => {
      const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(String(v).trim());
      if (!m) return null;
      const hh = Math.min(24, Math.max(0, parseInt(m[1], 10)));
      const mm = Math.min(59, Math.max(0, parseInt(m[2] || "0", 10)));
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
    };
    const s = toHMS(start), e = toHMS(end);
    if (!s || !e || s >= e) {
      Utils?.showToast?.("Giờ bắt đầu phải nhỏ hơn giờ kết thúc", "error");
      return false;
    }
    localStorage.setItem("cal_working_hours_v1", JSON.stringify({ start: s, end: e }));
    if (this.calendar) {
      this.calendar.setOption("slotMinTime", s);
      this.calendar.setOption("slotMaxTime", e);
      this.calendar.scrollToTime(s);
    }
    return true;
  };

  CM.loadEvents = async function () {
    if (!Utils?.makeRequest) return [];

    try {
      const res = await Utils.makeRequest("/api/calendar/events", "GET");
      if (!res.success || !Array.isArray(res.data)) return [];

      const normalEvents = res.data
        .filter((ev) => {
          const isAI = ev.AI_DeXuat === 1 || ev.AI_DeXuat === "1" || ev.AI_DeXuat === true;
          return !isAI;
        })
        .map((ev) => {
          const color = this.getPriorityColor(ev.MucDoUuTien);
          const completed =
            ev.DaHoanThanh === true || ev.DaHoanThanh === 1 || ev.DaHoanThanh === "1" ||
            ev.extendedProps?.completed === true || false;

          const startTime = new Date(ev.start || ev.GioBatDau || new Date().toISOString());
          let endTime = null;
          if (ev.end || ev.GioKetThuc) {
            endTime = new Date(ev.end || ev.GioKetThuc);
          } else {
            endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
          }

          return {
            id: ev.id || ev.MaLichTrinh || 0,
            title: ev.title || ev.TieuDe || "Không tiêu đề",
            start: startTime,
            end: endTime,
            backgroundColor: "#ffffff",
            borderColor: "#111827",
            textColor: "#0f172a",
            allDay: ev.allDay || false,
            extendedProps: {
              note: ev.GhiChu || ev.extendedProps?.note || "",
              completed: completed,
              taskId: ev.MaCongViec || ev.extendedProps?.taskId || null,
              isFromDrag: ev.isFromDrag || false,
              isAIEvent: false,
              priority: ev.MucDoUuTien || 2,
              category: ev.TenLoai || ev.extendedProps?.category || null,
              accent: color,
              originalColor: color,
            },
          };
        });

      // Batch-attach subtasks — ownership is time-slot based.
      try {
        const subRes = await Utils.makeRequest(`/api/event-subtasks?t=${Date.now()}`, "GET");
        if (subRes?.success && Array.isArray(subRes.data)) {
          const timedSubs = [];
          const untimedByEvent = new Map();
          for (const s of subRes.data) {
            if (s.start_at && s.end_at) {
              timedSubs.push(s);
            } else {
              const k = String(s.event_id);
              if (!untimedByEvent.has(k)) untimedByEvent.set(k, []);
              untimedByEvent.get(k).push(s);
            }
          }
          for (const ev of normalEvents) {
            const evS = new Date(ev.start).getTime();
            const evE = new Date(ev.end).getTime();
            const subs = [];
            if (Number.isFinite(evS) && Number.isFinite(evE)) {
              for (const s of timedSubs) {
                const sS = new Date(s.start_at).getTime();
                const sE = new Date(s.end_at).getTime();
                if (Number.isFinite(sS) && Number.isFinite(sE) && sS >= evS && sE <= evE) {
                  subs.push(s);
                }
              }
            }
            const fallback = untimedByEvent.get(String(ev.id)) || [];
            subs.push(...fallback);
            ev.extendedProps.subtasks = subs;
            ev.extendedProps.subtaskCount = subs.length;
          }
        }
      } catch (_) {
        // Subtask fetch optional — silent on failure (migration 003 not run yet).
      }

      // Fetch shared calendar events and group task events, then merge
      const [sharedEvents, groupTaskEvents] = await Promise.all([
        this._loadSharedEvents(),
        this._loadGroupTaskEvents(),
      ]);
      return normalEvents.concat(sharedEvents, groupTaskEvents);
    } catch (err) {
      console.error("Load events error:", err);
      return [];
    }
  };

  CM._loadSharedEvents = async function () {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      const to = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
      const res = await Utils.makeRequest(`/api/calendar/shared-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, "GET");
      if (!res?.success || !Array.isArray(res.data)) return [];

      return res.data.map((ev) => ({
        id: ev.id,
        title: ev.title,
        start: new Date(ev.start),
        end: ev.end ? new Date(ev.end) : undefined,
        backgroundColor: ev.backgroundColor || "#94a3b8",
        borderColor: ev.borderColor || "#94a3b8",
        textColor: ev.textColor || "#FFFFFF",
        classNames: ev.classNames || ["shared-event"],
        editable: ev.extendedProps?.permission === "editor",
        extendedProps: {
          ...ev.extendedProps,
          isShared: true,
        },
      }));
    } catch (_) {
      return [];
    }
  };

  CM._loadGroupTaskEvents = async function () {
    try {
      const res = await Utils.makeRequest("/api/group-tasks/my-calendar", "GET");
      if (!res?.success || !Array.isArray(res.data)) return [];
      return res.data.map((ev) => ({
        ...ev,
        editable: false,
        extendedProps: { ...ev.extendedProps, isGroupTask: true },
      }));
    } catch (_) {
      return [];
    }
  };

  /** Force re-render of all events — used to guarantee subtask chips show after init. */
  CM.refreshEventsInPlace = async function () {
    if (!this.calendar) return;
    let fresh;
    try {
      fresh = await this.loadEvents();
    } catch (_) {
      return;
    }
    const existing = this.calendar.getEvents();
    if (!Array.isArray(fresh) || (existing.length > 0 && fresh.length === 0)) {
      return;
    }
    this.calendar.removeAllEvents();
    fresh.forEach((e) => this.calendar.addEvent(e));
  };

  CM.hasTimeConflict = function (newEvent, excludeTempEvents = true) {
    const events = this.calendar.getEvents();
    const s1 = newEvent.start;
    const e1 = newEvent.end || new Date(s1.getTime() + 3600000);

    for (const ev of events) {
      if (ev.id === newEvent.id) continue;
      if (excludeTempEvents && ev.id?.startsWith("temp-")) continue;
      const s2 = ev.start;
      const e2 = ev.end || new Date(s2.getTime() + 3600000);
      if (s1 < e2 && e1 > s2) return true;
    }
    return false;
  };

  CM.formatDate = function (date) {
    if (!date) return "N/A";
    return date.toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  CM.triggerSidebarRefresh = function () {
    document.dispatchEvent(new CustomEvent("task-scheduled", { detail: { action: "refresh" } }));
    if (window.loadUserTasks && typeof window.loadUserTasks === "function") {
      setTimeout(() => { window.loadUserTasks(true); }, 500);
    }
    try {
      localStorage.setItem("__calendar_refresh", Date.now().toString());
      setTimeout(() => { localStorage.removeItem("__calendar_refresh"); }, 100);
    } catch (e) {}
  };

  document.addEventListener("priority-colors-changed", () => {
    if (!CM.calendar || !CM.isInitialized) return;
    document.querySelectorAll(".fc-event[data-event-id]").forEach((el) => {
      const evId = el.getAttribute("data-event-id");
      const fcEvent = CM.calendar.getEventById(evId);
      if (fcEvent) {
        const p = fcEvent.extendedProps?.priority || 2;
        el.style.setProperty("--ev-accent", `var(--prio-${p})`);
      }
    });
  });

  CM.linkWorkTasksToCalendar = function () {
    const workTasks = document.querySelectorAll("#work-items-container .work-item");
    workTasks.forEach((task) => {
      const taskId = task.dataset.taskId;
      if (taskId) {
        if (!task.hasAttribute("draggable")) task.setAttribute("draggable", "true");
        if (!task.dataset.taskTitle) {
          const titleEl = task.querySelector("h4");
          if (titleEl) task.dataset.taskTitle = titleEl.textContent.trim();
        }
        if (!task.dataset.taskColor) {
          const borderLeft = task.style.borderLeftColor || getComputedStyle(task).borderLeftColor;
          task.dataset.taskColor = borderLeft || "#3B82F6";
        }
      }
    });
  };
})();
