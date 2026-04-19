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

        setTimeout(() => {
          this.setupDropZone();
          this.setupTaskDragListeners();
        }, 1000);
      } catch (err) {
        console.error("Calendar initialization failed:", err);
        this.showError(err);
      }
    },

    /**
     * Set up ONE FullCalendar.Draggable on the task-list container using event
     * delegation. Previously we attached a per-item Draggable via a MutationObserver
     * which accumulated instances on every reload (innerHTML rebuild → new elements →
     * new Draggables, old ones never destroyed) → drag lag after a few drops.
     * FC.Draggable with itemSelector handles added/removed children automatically.
     */
    setupTaskDragListeners() {
      this.initializeExternalDraggable();
    },

    initializeExternalDraggable() {
      const taskList = document.getElementById("task-list");
      if (!taskList) return;
      if (typeof FullCalendar === "undefined" || !FullCalendar.Draggable) return;

      // Idempotent: destroy any prior instance before re-creating.
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
            backgroundColor: color,
            borderColor: color,
            extendedProps: {
              taskId,
              priority,
              description,
              isFromDrag: true,
            },
          };
        },
      });
    },
    async _initInternal() {
      const calendarEl = await this.waitForElement("calendar", 8000);
      if (!calendarEl) throw new Error("Không tìm thấy phần tử #calendar");

      await Promise.all([this.waitForFullCalendar(), this.waitForUtils()]);
      calendarEl.style.minHeight = "700px";

      const events = await this.loadEvents();
      this.renderCalendar(events);

      setTimeout(() => {
        this.initializeNavbarEvents();
      }, 200);

      // Defensive re-mount: first render sometimes misses extendedProps.subtasks
      // (FC copies events on init before batch-fetch mutations propagate visually).
      // Re-adding events triggers eventDidMount with fresh data, guaranteeing subtask chips appear.
      setTimeout(() => this.refreshEventsInPlace().catch(() => {}), 400);
    },

    /** Force re-render of all events — used to guarantee subtask chips show after init. */
    async refreshEventsInPlace() {
      if (!this.calendar) return;
      let fresh;
      try {
        fresh = await this.loadEvents();
      } catch (_) {
        return; // API blip — keep current events instead of wiping to empty.
      }
      // Defensive: if load returned empty but we currently have events, treat as a
      // silent failure (loadEvents catches errors and returns []). Wiping would make
      // the just-dragged event appear to vanish.
      const existing = this.calendar.getEvents();
      if (!Array.isArray(fresh) || (existing.length > 0 && fresh.length === 0)) {
        return;
      }
      this.calendar.removeAllEvents();
      fresh.forEach((e) => this.calendar.addEvent(e));
    },
    waitForElement(id, timeout = 8000) {
      return new Promise((resolve) => {
        const el = document.getElementById(id);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
          const el = document.getElementById(id);
          if (el) {
            observer.disconnect();
            resolve(el);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      });
    },

    waitForFullCalendar(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (typeof FullCalendar !== "undefined") return resolve();

        const start = Date.now();
        const check = () => {
          if (typeof FullCalendar !== "undefined") resolve();
          else if (Date.now() - start > timeout)
            reject(new Error("FullCalendar timeout"));
          else setTimeout(check, 100);
        };
        check();
      });
    },

    waitForUtils() {
      return new Promise((resolve) => {
        if (typeof Utils !== "undefined") return resolve();
        const check = () =>
          typeof Utils !== "undefined" ? resolve() : setTimeout(check, 100);
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
        </div>
      `;
    },

    async loadEvents() {
      if (!Utils?.makeRequest) {
        return [];
      }

      try {
        const res = await Utils.makeRequest("/api/calendar/events", "GET");
        if (!res.success || !Array.isArray(res.data)) {
          return [];
        }

        const aiEvents = res.data.filter(
          (ev) =>
            ev.AI_DeXuat === 1 || ev.AI_DeXuat === "1" || ev.AI_DeXuat === true
        );

        const normalEvents = res.data
          .filter((ev) => {
            const isAI =
              ev.AI_DeXuat === 1 ||
              ev.AI_DeXuat === "1" ||
              ev.AI_DeXuat === true;
            return !isAI;
          })
          .map((ev) => {
            // Always derive from priority so user-customized palette applies uniformly
            // across every event (old records with stale MauSac won't drift off-palette).
            const color = this.getPriorityColor(ev.MucDoUuTien);

            const completed =
              ev.DaHoanThanh === true ||
              ev.DaHoanThanh === 1 ||
              ev.DaHoanThanh === "1" ||
              ev.extendedProps?.completed === true ||
              false;

            // Tính toán start và end time
            const startTime = new Date(
              ev.start || ev.GioBatDau || new Date().toISOString()
            );
            let endTime = null;

            if (ev.end || ev.GioKetThuc) {
              endTime = new Date(ev.end || ev.GioKetThuc);
            } else {
              // Nếu không có end time, mặc định là start + 1 giờ
              endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
            }

            return {
              id: ev.id || ev.MaLichTrinh || 0,
              title: ev.title || ev.TieuDe || "Không tiêu đề",
              start: startTime,
              end: endTime,
              backgroundColor: color,
              borderColor: color,
              allDay: ev.allDay || false,
              extendedProps: {
                note: ev.GhiChu || ev.extendedProps?.note || "",
                completed: completed,
                taskId: ev.MaCongViec || ev.extendedProps?.taskId || null,
                isFromDrag: ev.isFromDrag || false,
                isAIEvent: false,
                priority: ev.MucDoUuTien || 2,
                originalColor: color,
              },
            };
          });

        // Batch-attach subtasks. Ownership is time-slot based:
        // a minitask with [start_at, end_at] belongs to whatever event fully covers
        // that absolute window. When the parent event is dragged elsewhere, the
        // minitask detaches visually (its slot no longer sits inside that event)
        // and re-attaches to any event that now covers the slot. Untimed
        // minitasks fall back to their original event_id.
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
                  // Must fit fully inside this event's window (same day/hour scope).
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
          // Subtask fetch optional — silent on failure (e.g. migration 003 not run yet).
        }

        return normalEvents;
      } catch (err) {
        console.error("Load events error:", err);
        return [];
      }
    },

    getPriorityColor(priority) {
      return window.PriorityTheme ? PriorityTheme.getColor(priority) : "#3B82F6";
    },

    /**
     * Read the user-customized working-hour window from localStorage.
     * Returns "HH:MM:SS" strings safe to pass to FullCalendar's slotMin/MaxTime.
     */
    getWorkingHours() {
      const DEFAULTS = { start: "07:00:00", end: "22:00:00" };
      try {
        const raw = localStorage.getItem("cal_working_hours_v1");
        if (!raw) return DEFAULTS;
        const p = JSON.parse(raw);
        const toHMS = (v) => {
          if (typeof v !== "string") return null;
          // Accept "H", "HH", "HH:MM", "HH:MM:SS"; normalize to HH:MM:SS.
          const m = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(v.trim());
          if (!m) return null;
          const hh = Math.min(24, Math.max(0, parseInt(m[1], 10)));
          const mm = Math.min(59, Math.max(0, parseInt(m[2] || "0", 10)));
          const ss = Math.min(59, Math.max(0, parseInt(m[3] || "0", 10)));
          return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        };
        const start = toHMS(p.start) || DEFAULTS.start;
        const end = toHMS(p.end) || DEFAULTS.end;
        // Guard: end must exceed start.
        return start >= end ? DEFAULTS : { start, end };
      } catch (_) {
        return DEFAULTS;
      }
    },

    /** Persist new working hours and live-apply to the mounted calendar. */
    setWorkingHours(start, end) {
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
    },

    renderCalendar(events) {
      const el = document.getElementById("calendar");
      if (!el) return;

      if (this.calendar) {
        try {
          this.calendar.destroy();
        } catch (e) {}
        this.calendar = null;
      }
      el.innerHTML = "";

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

        // Drop the all-day row — this app only schedules timed tasks.
        allDaySlot: false,

        // Working hours are user-customizable via #cal-hours-btn (persisted in localStorage).
        slotMinTime: this.getWorkingHours().start,
        slotMaxTime: this.getWorkingHours().end,
        slotDuration: "00:30:00",
        scrollTime: this.getWorkingHours().start,

        buttonText: {
          today: "Hôm nay",
          month: "Tháng",
          week: "Tuần",
          day: "Ngày",
          list: "Danh sách",
        },
        allDayText: "Cả ngày",
        moreLinkText: (n) => `+ ${n} thêm`,
        noEventsText: "Không có sự kiện",

        eventReceive: (info) => {
          this._handleEventReceive(info);
        },

        eventDrop: async (info) => {
          await this._handleEventUpdate(info);
        },

        eventResize: async (info) => {
          await this._handleEventUpdate(info);
        },

        select: (info) => {
          this._showQuickCreateModal(info.start, info.end, info.allDay);
          this.calendar.unselect();
        },

        // Drag-to-delete: dropping an event onto the task-list sidebar removes it.
        // Visual feedback toggles via body.calendar-dragging class.
        eventDragStart: () => {
          document.body.classList.add("calendar-dragging");
        },
        eventDragStop: (info) => {
          document.body.classList.remove("calendar-dragging");
          const sidebar = document.getElementById("calendar-sidebar");
          if (!sidebar) return;
          const r = sidebar.getBoundingClientRect();
          const x = info.jsEvent?.clientX;
          const y = info.jsEvent?.clientY;
          if (typeof x !== "number" || typeof y !== "number") return;
          const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          if (inside) this._dragDeleteEvent(info.event);
        },

        eventClick: (info) => {
          info.jsEvent.preventDefault();
          this._showEventDetails(info.event);
        },

        datesSet: () => this.updateCalendarTitle(),

        eventDidMount: (info) => {
          const el = info.el;
          el.style.cursor = "pointer";

          el.setAttribute("data-event-id", info.event.id);
          el.setAttribute("data-eventid", info.event.id);

          const priority = info.event.extendedProps.priority || 2;
          if (priority === 1) {
            el.classList.add("event-priority-low");
          } else if (priority === 3) {
            el.classList.add("event-priority-medium");
          } else if (priority === 4) {
            el.classList.add("event-priority-high");
          }
          if (info.event.extendedProps.aiSuggested) {
            el.classList.add("event-ai-suggested");
          }

          // Apply completed CSS class on mount. Let the stylesheet own the
          // visual treatment — using inline `background` shorthand wipes the
          // priority-color tint set by FullCalendar. See calendar.css
          // `.fc-event.event-completed` (uses background-image overlay).
          if (info.event.extendedProps.completed) {
            el.classList.add("event-completed");
          }

          // Show note under title if exists
          const noteText = info.event.extendedProps.note;
          if (noteText) {
            const noteEl = document.createElement("div");
            noteEl.style.cssText = "font-size:9px;opacity:0.8;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:relative;z-index:2;margin-top:1px;";
            noteEl.textContent = noteText;
            const titleEl = el.querySelector(".fc-event-title") || el.querySelector(".fc-event-main");
            if (titleEl) titleEl.appendChild(noteEl);
          }

          // Subtask overlay — unified chip style, anchored to bottom of event.
          // Single size/position for all subtasks so the parent title + time stay visible.
          const subtasks = info.event.extendedProps.subtasks || [];
          if (subtasks.length > 0) {
            if (getComputedStyle(el).position === "static") el.style.position = "relative";

            const stack = document.createElement("div");
            stack.className = "fc-event-subtask-stack";
            stack.style.cssText = "position:absolute;left:4px;right:4px;bottom:4px;display:flex;flex-direction:column;gap:3px;z-index:4;pointer-events:none;";

            const MAX = 3;
            subtasks.slice(0, MAX).forEach((s) => {
              const chip = document.createElement("div");
              chip.style.cssText = `font-size:10px;line-height:1.3;padding:3px 6px;border-radius:4px;background:rgba(255,255,255,0.94);color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.12);${s.is_done ? "text-decoration:line-through;color:#64748b;" : ""}`;
              let timeLabel = "";
              if (s.start_at && s.end_at) {
                const fmt = (iso) => {
                  const d = new Date(iso);
                  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                };
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
            el.appendChild(stack);
            el.style.overflow = "visible";
          }

          // Tooltip
          const start =
            info.event.start?.toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }) || "";
          const end =
            info.event.end?.toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }) || "";
          el.title = `${info.event.title}${noteText ? "\n" + noteText : ""}\n${start} - ${end}`;
        },
        views: {
          dayGridMonth: { dayMaxEventRows: 4 },
          timeGridWeek: { slotDuration: "00:30:00" },
          timeGridDay: { slotDuration: "00:15:00" },
        },
      });

      this.calendar.render();
      window.calendar = this.calendar;
      this.updateCalendarTitle();
      this.initMiniCalendar();

      this.setupDropZone();
    },

    hasTimeConflict(newEvent, excludeTempEvents = true) {
      const events = this.calendar.getEvents();
      const s1 = newEvent.start;
      const e1 = newEvent.end || new Date(s1.getTime() + 3600000);

      for (const ev of events) {
        if (ev.id === newEvent.id) continue;

        if (excludeTempEvents && ev.id?.startsWith("temp-")) continue;

        const s2 = ev.start;
        const e2 = ev.end || new Date(s2.getTime() + 3600000);

        if (s1 < e2 && e1 > s2) {
          return true;
        }
      }
      return false;
    },

    formatDate(date) {
      if (!date) return "N/A";
      return date.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    async _handleEventReceive(info) {
      try {
        const draggedEl = info.draggedEl;
        let taskId, title, color, priority, duration, hasFixedTime, fixedStart, fixedEnd;

        if (draggedEl) {
          taskId = draggedEl.dataset.taskId;
          title = draggedEl.dataset.taskTitle || "Công việc";
          color = draggedEl.dataset.taskColor || "#3B82F6";
          priority = parseInt(draggedEl.dataset.taskPriority) || 2;
          duration = parseInt(draggedEl.dataset.taskDuration) || 60;
          hasFixedTime = draggedEl.dataset.hasFixedTime === "true";
          fixedStart = draggedEl.dataset.fixedStart || "";
          fixedEnd = draggedEl.dataset.fixedEnd || "";
        } else {
          taskId = info.jsEvent?.dataTransfer?.getData("text/plain");
          const jsonData = info.jsEvent?.dataTransfer?.getData("application/json");
          if (jsonData) {
            const data = JSON.parse(jsonData);
            title = data.title || "Công việc";
            color = data.color || "#3B82F6";
            priority = data.priority || 2;
            duration = data.duration || 60;
            hasFixedTime = data.hasFixedTime || false;
            fixedStart = data.fixedStart || "";
            fixedEnd = data.fixedEnd || "";
          } else {
            duration = 60;
          }
        }

        // Priority is the single source of truth — ensures dropped task matches existing events.
        color = this.getPriorityColor(priority);

        if (!taskId) {
          info.event.remove();
          Utils.showToast?.("Lỗi: Không tìm thấy ID công việc", "error");
          return;
        }

        // If task has fixed time, show choice dialog
        if (hasFixedTime && fixedStart) {
          const useFixed = await this._showFixedTimeChoice(title, fixedStart, fixedEnd);
          if (useFixed) {
            // Use fixed time instead of drop position
            const fStart = new Date(fixedStart);
            const fEnd = fixedEnd ? new Date(fixedEnd) : new Date(fStart.getTime() + duration * 60 * 1000);
            info.event.setStart(fStart);
            info.event.setEnd(fEnd);

            await this.saveDroppedEvent(taskId, title, color, fStart, fEnd, priority, duration);
            return;
          }
        }

        const start = info.event.start;
        const end = new Date(start.getTime() + duration * 60 * 1000);
        info.event.setEnd(end);

        const existingEvents = this.calendar.getEvents();
        const hasConflict = existingEvents.some((existingEvent) => {
          if (existingEvent.id === info.event.id) return false;
          if (existingEvent.id?.startsWith("temp-")) return false;

          const s1 = start;
          const e1 = end;
          const s2 = existingEvent.start;
          const e2 = existingEvent.end || new Date(s2.getTime() + duration * 60 * 1000);

          return s1 < e2 && e1 > s2;
        });

        if (hasConflict) {
          Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
          info.event.remove();
          return;
        }

        await this.saveDroppedEvent(taskId, title, color, start, end, priority, duration);
      } catch (err) {
        console.error(" Event receive error:", err);
        info.event.remove();
        Utils.showToast?.("Lỗi kéo thả công việc", "error");
      }
    },

    async _handleEventUpdate(info) {
      try {
        const eventId = info.event.id;
        if (!eventId) {
          throw new Error("Event không có ID");
        }

        // Chặn kéo thả công việc đã hoàn thành đến thời gian tương lai
        if (info.event.extendedProps.completed) {
          const newStart = info.event.start;
          const now = new Date();
          if (newStart > now) {
            Utils.showToast?.("Không thể kéo công việc đã hoàn thành đến thời gian chưa xảy ra!", "warning");
            info.revert();
            return;
          }
        }

        if (
          eventId.toString().startsWith("temp-") ||
          eventId.toString().startsWith("drag-")
        ) {
          return;
        }

        const eventIdNum = parseInt(eventId, 10);
        if (isNaN(eventIdNum)) {
          return;
        }

        const newStart = info.event.start;
        const newEnd =
          info.event.end || new Date(newStart.getTime() + 60 * 60 * 1000);
        if (this.hasTimeConflict(info.event)) {
          Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
          info.revert();
          return;
        }
        Utils.showToast?.("Đang cập nhật thời gian...", "info");

        const updateData = {
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        };

        const result = await Utils.makeRequest(
          `/api/calendar/events/${eventIdNum}`,
          "PUT",
          updateData
        );

        if (!result.success) {
          throw new Error(result.message || "Cập nhật thất bại");
        }

        Utils.showToast?.("Đã cập nhật thời gian sự kiện", "success");
        const eventElement = document.querySelector(
          `[data-event-id="${eventId}"]`
        );
        if (eventElement) {
          eventElement.classList.add("bg-green-50", "border-green-200");
          setTimeout(() => {
            eventElement.classList.remove("bg-green-50", "border-green-200");
          }, 1500);
        }

        // Minitask ownership is time-slot based: after the event moves, any
        // minitask whose absolute [start_at,end_at] now falls outside this
        // event should detach, and minitasks whose slot is now inside this
        // (or any other) event should attach. Rebuild from fresh data.
        this.refreshEventsInPlace().catch(() => {});

      } catch (error) {
        console.error(" Error in eventUpdate:", error);

        let errorMessage = "Lỗi khi cập nhật thời gian";
        if (
          error.message.includes("conflict") ||
          error.message.includes("trùng")
        ) {
          errorMessage = "Không thể di chuyển: Thời gian đã có sự kiện khác!";
        } else if (error.message.includes("validation")) {
          errorMessage = " Thời gian không hợp lệ!";
        } else {
          errorMessage = error.message || "Lỗi khi cập nhật thời gian";
        }

        Utils.showToast?.(errorMessage, "error");
        info.revert();
      }
    },

    setupDropZone() {
      const calendarEl = document.getElementById("calendar");
      if (!calendarEl) {
        return;
      }

      try {
        if (this._boundCalendarDragOver) {
          calendarEl.removeEventListener(
            "dragover",
            this._boundCalendarDragOver
          );
        }
        if (this._boundCalendarDragLeave) {
          calendarEl.removeEventListener(
            "dragleave",
            this._boundCalendarDragLeave
          );
        }
        if (this._boundCalendarDrop) {
          calendarEl.removeEventListener("drop", this._boundCalendarDrop);
        }
      } catch (e) {}

      this._boundCalendarDragOver = this.handleDragOver.bind(this);
      this._boundCalendarDragLeave = this.handleDragLeave.bind(this);
      this._boundCalendarDrop = this.handleDrop.bind(this);

      calendarEl.addEventListener("dragover", this._boundCalendarDragOver);
      calendarEl.addEventListener("dragleave", this._boundCalendarDragLeave);
      calendarEl.addEventListener("drop", this._boundCalendarDrop);

      const style = document.createElement("style");
      style.textContent = `
    .drop-zone-active {
      background-color: rgba(239, 68, 68, 0.1) !important;
      border: 2px dashed #ef4444 !important;
    }
    .task-item.dragging {
      opacity: 0.7;
      transform: scale(0.95);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
    }
  `;
      document.head.appendChild(style);

      try {
        if (this._docDropListener) {
          document.removeEventListener("drop", this._docDropListener);
        }

        this._docDropListener = (e) => {
          const calendarRect = calendarEl.getBoundingClientRect();
          const isOverCalendar =
            e.clientX >= calendarRect.left &&
            e.clientX <= calendarRect.right &&
            e.clientY >= calendarRect.top &&
            e.clientY <= calendarRect.bottom;

          if (isOverCalendar) {
            e.preventDefault();
            this.handleDrop(e);
          }
        };

        document.addEventListener("drop", this._docDropListener);
      } catch (e) {}
    },

    handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const calendarEl = document.getElementById("calendar");
      if (calendarEl) {
        calendarEl.classList.add("drop-zone-active");
      }
    },

    handleDragLeave(e) {
      e.preventDefault();

      const calendarEl = document.getElementById("calendar");
      if (calendarEl && !calendarEl.contains(e.relatedTarget)) {
        calendarEl.classList.remove("drop-zone-active");
      }
    },

    async handleDrop(e) {
      if (this._handlingDrop) {
        return;
      }
      this._handlingDrop = true;

      try {
        e.preventDefault();

        const calendarEl = document.getElementById("calendar");
        if (calendarEl) {
          calendarEl.classList.remove("drop-zone-active");
        }

        let taskId = e.dataTransfer.getData("text/plain");
        let taskData = {};

        const jsonData = e.dataTransfer.getData("application/json");
        if (jsonData) {
          try {
            taskData = JSON.parse(jsonData);
          } catch (err) {}
        }

        if (!taskId) {
          taskId = e.dataTransfer.getData("taskId") || taskData.taskId;
        }

        if (!taskId) {
          return;
        }

        const title = taskData.title || "Công việc mới";
        const color = taskData.color || "#3B82F6";
        const durationMinutes = taskData.duration || 60;
        const priority = taskData.priority || 2;

        const calendar = this.calendar;

        const point = {
          clientX: e.clientX,
          clientY: e.clientY,
        };

        let dropDate = new Date();

        try {
          const calendarApi = calendar;
          const calendarElRect = calendar.el.getBoundingClientRect();

          const relativeX = point.clientX - calendarElRect.left;
          const relativeY = point.clientY - calendarElRect.top;

          const dateStr = calendarApi.currentData.viewApi.dateEnv
            .toDate(new Date())
            .toISOString();

          dropDate = new Date();
          dropDate.setMinutes(0);
          dropDate.setSeconds(0);
          dropDate.setMilliseconds(0);
        } catch (err) {}

        // ✅ TẠO endDate NGAY TỪ ĐẦU
        const startDate = dropDate;
        const endDate = new Date(
          startDate.getTime() + durationMinutes * 60 * 1000
        );

        const newEvent = {
          id: `temp-${Date.now()}`,
          title: title,
          start: startDate,
          end: endDate, // ✅ SỬ DỤNG endDate ĐÃ TÍNH
          backgroundColor: color,
          borderColor: color,
          editable: true,
          durationEditable: true,
          startEditable: true,
          extendedProps: {
            taskId: taskId,
            isFromDrag: true,
            color: color,
            priority: priority,
          },
        };

        const existingEvents = calendar.getEvents();
        const hasConflict = existingEvents.some((existingEvent) => {
          if (existingEvent.id?.startsWith("temp-")) return false;

          const s1 = newEvent.start;
          const e1 = newEvent.end;
          const s2 = existingEvent.start;
          const e2 =
            existingEvent.end || new Date(s2.getTime() + 60 * 60 * 1000);

          return s1 < e2 && e1 > s2;
        });

        if (hasConflict) {
          Utils.showToast?.("Thời gian này đã có sự kiện khác!", "error");
          return;
        }

        calendar.addEvent(newEvent);

        // ✅ TRUYỀN ĐẦY ĐỦ THAM SỐ
        await this.saveDroppedEvent(
          taskId,
          title,
          color,
          startDate,
          endDate,
          priority,
          durationMinutes
        );
      } catch (error) {
        console.error("Drop error:", error);
        Utils.showToast?.("Lỗi khi kéo thả công việc", "error");
      } finally {
        this._handlingDrop = false;
      }
    },

    async saveDroppedEvent(
      taskId,
      title,
      color,
      start,
      end,
      priority = 2,
      duration = 60
    ) {
      try {
        // Color is derived from priority at render time — no need to persist MauSac.
        const eventData = {
          MaCongViec: parseInt(taskId),
          TieuDe: title,
          GioBatDau: start.toISOString(),
          GioKetThuc: end.toISOString(),
          MucDoUuTien: priority,
          AI_DeXuat: 0,
        };

        const res = await Utils.makeRequest(
          "/api/calendar/events",
          "POST",
          eventData
        );

        if (res.success) {
          const newEventId =
            res.eventId || res.data?.MaLichTrinh || res.data?.id;

          const events = this.calendar.getEvents();
          let tempEvent = events.find((e) => e.id === `drag-${taskId}`);

          if (!tempEvent) {
            tempEvent = events.find(
              (e) => e.id?.startsWith(`temp-`) || e.id?.startsWith(`drag-`)
            );
          }

          if (tempEvent) {
            // ✅ SỬ DỤNG setStart/setEnd THAY VÌ setProp
            tempEvent.setProp("id", newEventId);
            tempEvent.setStart(start);
            tempEvent.setEnd(end);
            tempEvent.setProp("backgroundColor", color);
            tempEvent.setProp("borderColor", color);
            tempEvent.setExtendedProp("taskId", taskId);
            tempEvent.setExtendedProp("isFromDrag", true);
            tempEvent.setExtendedProp("priority", priority);
            tempEvent.setExtendedProp("completed", false);

            tempEvent.setProp("editable", true);
            tempEvent.setProp("durationEditable", true);
            tempEvent.setProp("startEditable", true);

          }

          await Utils.makeRequest(`/api/tasks/${taskId}`, "PUT", {
            TrangThaiThucHien: 1,
          });

          Utils.showToast?.("Đã lên lịch thành công!", "success");

          if (window.loadUserTasks) {
            window.loadUserTasks(true);
          }

          this.triggerSidebarRefresh();
        } else {
          throw new Error(res.message || "Lỗi thêm vào lịch");
        }
      } catch (error) {
        console.error("Error saving dropped event:", error);

        const events = this.calendar.getEvents();
        const tempEvent = events.find((e) => e.id?.startsWith(`temp-`));
        if (tempEvent) {
          tempEvent.remove();
        }

        Utils.showToast?.(error.message || "Lỗi khi lưu sự kiện", "error");
      }
    },

    _showInlineNewCategory(reloadCallback) {
      const existing = document.getElementById("inlineNewCatPopup");
      if (existing) { existing.remove(); return; }
      const popup = document.createElement("div");
      popup.id = "inlineNewCatPopup";
      popup.className = "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[10001]";
      popup.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-xs mx-4 p-5 space-y-3">
          <h4 class="font-bold text-sm text-gray-800">Tạo danh mục mới</h4>
          <input type="text" id="newCatName" placeholder="Tên danh mục *" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          <input type="text" id="newCatDesc" placeholder="Mô tả (không bắt buộc)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          <div class="flex gap-2">
            <button id="cancelNewCat" class="flex-1 py-2 border border-gray-200 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-50">Hủy</button>
            <button id="saveNewCat" class="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold">Tạo</button>
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
          if (res.success) {
            Utils.showToast?.("Đã tạo danh mục", "success");
            popup.remove();
            if (reloadCallback) reloadCallback();
          } else { Utils.showToast?.(res.message || "Lỗi", "error"); }
        } catch (err) { Utils.showToast?.("Lỗi tạo danh mục", "error"); }
      };
      document.getElementById("newCatName").focus();
    },

    _showFixedTimeChoice(title, fixedStart, fixedEnd) {
      return new Promise((resolve) => {
        const fStart = new Date(fixedStart);
        const startLabel = fStart.toLocaleString("vi-VN", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
        const html = `
        <div id="fixedTimeChoiceModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div class="bg-gradient-to-r from-slate-700 to-slate-800 px-5 py-3">
              <h3 class="text-white font-bold text-sm">Xếp lịch: ${title}</h3>
            </div>
            <div class="p-5 space-y-3">
              <p class="text-xs text-gray-500">Công việc này có thời gian cố định: <strong>${startLabel}</strong></p>
              <button id="useFixedTimeBtn" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition">
                Xếp theo lịch cố định
              </button>
              <button id="useCustomTimeBtn" class="w-full py-2.5 border-2 border-gray-200 rounded-xl text-gray-600 font-medium text-sm hover:bg-gray-50 transition">
                Xếp lịch tuỳ chọn
              </button>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML("beforeend", html);
        document.getElementById("useFixedTimeBtn").onclick = () => {
          document.getElementById("fixedTimeChoiceModal")?.remove();
          resolve(true);
        };
        document.getElementById("useCustomTimeBtn").onclick = () => {
          document.getElementById("fixedTimeChoiceModal")?.remove();
          resolve(false);
        };
        document.getElementById("fixedTimeChoiceModal").addEventListener("click", (e) => {
          if (e.target.id === "fixedTimeChoiceModal") {
            document.getElementById("fixedTimeChoiceModal")?.remove();
            resolve(false);
          }
        });
      });
    },

    triggerSidebarRefresh() {

      document.dispatchEvent(
        new CustomEvent("task-scheduled", {
          detail: { action: "refresh" },
        })
      );

      if (window.loadUserTasks && typeof window.loadUserTasks === "function") {
        setTimeout(() => {
          window.loadUserTasks(true);
        }, 500);
      }

      try {
        localStorage.setItem("__calendar_refresh", Date.now().toString());
        setTimeout(() => {
          localStorage.removeItem("__calendar_refresh");
        }, 100);
      } catch (e) {}
    },

    linkWorkTasksToCalendar() {

      const workTasks = document.querySelectorAll(
        "#work-items-container .work-item"
      );

      workTasks.forEach((task) => {
        const taskId = task.dataset.taskId;
        if (taskId) {
          if (!task.hasAttribute("draggable")) {
            task.setAttribute("draggable", "true");
          }

          if (!task.dataset.taskTitle) {
            const titleEl = task.querySelector("h4");
            if (titleEl) {
              task.dataset.taskTitle = titleEl.textContent.trim();
            }
          }

          if (!task.dataset.taskColor) {
            const borderLeft =
              task.style.borderLeftColor ||
              getComputedStyle(task).borderLeftColor;
            task.dataset.taskColor = borderLeft || "#3B82F6";
          }
        }
      });
    },

    // ==========================================================
    // QUICK CREATE MODAL - Kéo thả trên lịch để tạo công việc
    // ==========================================================
    _showQuickCreateModal(start, end, allDay) {
      const startISO = start instanceof Date ? start.toISOString() : start;
      const endISO = end instanceof Date ? end.toISOString() : end;
      const startDate = new Date(startISO);
      const endDate = new Date(endISO);
      const initialDurationMin = Math.max(15, Math.round((endDate - startDate) / 60000) || 60);

      const fmtDate = (d) => d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
      const fmtTime = (d) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const sameDay = startDate.toDateString() === endDate.toDateString();
      const initialTimeLabel = sameDay
        ? `${fmtDate(startDate)} · ${fmtTime(startDate)} – ${fmtTime(endDate)}`
        : `${fmtDate(startDate)} ${fmtTime(startDate)} → ${fmtDate(endDate)} ${fmtTime(endDate)}`;

      document.getElementById("quickCreateModal")?.remove();

      // Priority options — rendered dynamically from PriorityTheme so user colors apply.
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
          <div class="bg-gradient-to-r from-red-600 to-indigo-600 px-6 py-4 flex justify-between items-center">
            <h3 class="text-white font-bold text-lg flex items-center gap-2">
              <i class="fas fa-plus-circle"></i> Tạo công việc mới
            </h3>
            <button id="closeQuickCreate" class="text-white/70 hover:text-white text-xl">&times;</button>
          </div>
          <div class="px-6 py-5 space-y-4">
            <div id="qc-time-display" class="bg-red-50 rounded-lg px-4 py-2 text-sm text-red-700 flex items-center gap-2">
              <i class="fas fa-clock"></i> <span id="qc-time-label">${initialTimeLabel}</span>
            </div>

            <div>
              <input type="text" id="qc-title" placeholder="Tên công việc *"
                class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-red-500 focus:outline-none text-gray-800 font-medium" />
            </div>

            <div>
              <textarea id="qc-note" placeholder="Ghi chú (không bắt buộc)" rows="2"
                class="w-full px-4 py-2 border-2 border-gray-200 rounded-xl focus:border-red-500 focus:outline-none text-gray-700 resize-none"></textarea>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-600 mb-2">Độ ưu tiên</p>
              <div class="grid grid-cols-4 gap-2" id="qc-priority-group">
                ${priorityOptsHtml}
              </div>
            </div>

            <div>
              <label class="text-sm font-semibold text-gray-600 mb-2 block flex items-center gap-1">
                <i class="fas fa-tag text-purple-400 text-xs"></i> Loại công việc
              </label>
              <div id="qc-category-chips" class="flex flex-wrap gap-2 min-h-[36px]">
                <span class="text-xs text-gray-400 italic">Đang tải...</span>
              </div>
              <input type="hidden" id="qc-category" value="" />
            </div>

            <div>
              <label class="text-sm font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                <i class="fas fa-clock text-red-400 text-xs"></i> Thời gian ước tính
              </label>
              <div class="flex items-center gap-2">
                <input type="range" id="qc-duration" value="60" min="15" max="480" step="15"
                  class="flex-1 accent-red-500" />
                <span id="qc-duration-label" class="text-sm font-bold text-red-600 w-16 text-right">60 phút</span>
              </div>
            </div>
          </div>
          <div class="px-6 pb-5 flex gap-3">
            <button id="closeQuickCreate2" class="flex-1 py-3 border-2 border-gray-200 rounded-xl text-gray-600 font-medium hover:bg-gray-50 transition">Hủy</button>
            <button id="saveQuickCreate" class="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition flex items-center justify-center gap-2">
              <i class="fas fa-plus"></i> Tạo công việc
            </button>
          </div>
        </div>
      </div>`;

      document.body.insertAdjacentHTML("beforeend", html);

      // Initial duration slider value (uses the selection length, clamped to slider range).
      const durSliderInit = document.getElementById("qc-duration");
      if (durSliderInit) durSliderInit.value = String(Math.min(480, initialDurationMin));
      const durLabelInit = document.getElementById("qc-duration-label");
      if (durLabelInit) durLabelInit.textContent = (durSliderInit?.value || "60") + " phút";

      // Priority selector — uses PriorityTheme so colors follow user customization.
      document.querySelectorAll("#qc-priority-group input[type=radio]").forEach((radio) => {
        radio.addEventListener("change", () => {
          document.querySelectorAll("#qc-priority-group .priority-opt").forEach((opt) => {
            opt.style.borderColor = "transparent";
          });
          const hex = priorityColor(parseInt(radio.value, 10));
          radio.closest("label").querySelector(".priority-opt").style.borderColor = hex;
        });
      });

      // Load categories as chips + add new category button
      const loadQcCategories = () => {
        Utils.makeRequest("/api/categories", "GET").then(res => {
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
              chips.querySelectorAll("button:not(.new-cat-btn)").forEach(b => b.classList.remove("ring-2","ring-offset-1","ring-red-500","scale-105"));
              if (hidden.value === String(id)) { hidden.value = ""; }
              else { hidden.value = id; chip.classList.add("ring-2","ring-offset-1","ring-red-500","scale-105"); }
            };
            chips.appendChild(chip);
          });
          // Add "new category" button
          const newCatBtn = document.createElement("button");
          newCatBtn.type = "button";
          newCatBtn.className = "new-cat-btn px-3 py-1 rounded-full text-xs font-semibold border-2 border-dashed border-gray-300 text-gray-400 hover:border-red-400 hover:text-red-500 transition-all";
          newCatBtn.textContent = "+ Mới";
          newCatBtn.onclick = () => this._showInlineNewCategory(loadQcCategories);
          chips.appendChild(newCatBtn);
        }).catch(() => {
          const chips = document.getElementById("qc-category-chips");
          if (chips) chips.innerHTML = '<span class="text-xs text-gray-400 italic">Không tải được</span>';
        });
      };
      loadQcCategories();

      // Duration slider — also updates the displayed end time so user sees what they're committing to.
      const durSlider = document.getElementById("qc-duration");
      const durLabel = document.getElementById("qc-duration-label");
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
        durSlider.addEventListener("input", () => {
          durLabel.textContent = durSlider.value + " phút";
          refreshTimeLabel();
        });
      }

      const close = () => {
        document.removeEventListener("keydown", escHandler);
        document.getElementById("quickCreateModal")?.remove();
      };
      const escHandler = (e) => { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", escHandler);
      document.getElementById("closeQuickCreate").onclick = close;
      document.getElementById("closeQuickCreate2").onclick = close;
      document.getElementById("quickCreateModal").addEventListener("click", (e) => {
        if (e.target.id === "quickCreateModal") close();
      });

      document.getElementById("qc-title").focus();

      document.getElementById("saveQuickCreate").onclick = async () => {
        const title = document.getElementById("qc-title").value.trim();
        if (!title) {
          document.getElementById("qc-title").classList.add("border-red-500");
          document.getElementById("qc-title").placeholder = "Vui lòng nhập tên công việc!";
          return;
        }
        const priority = parseInt(document.querySelector("#qc-priority-group input[type=radio]:checked")?.value || "2");
        const note = document.getElementById("qc-note").value.trim();
        const duration = parseInt(document.getElementById("qc-duration")?.value || "60");
        const categoryId = document.getElementById("qc-category")?.value || undefined;
        const color = this.getPriorityColor(priority);

        const btn = document.getElementById("saveQuickCreate");
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';

        try {
          // 1. Tạo công việc mới
          const taskRes = await Utils.makeRequest("/api/tasks", "POST", {
            TieuDe: title,
            MoTa: note,
            MucDoUuTien: priority,
            ThoiGianUocTinh: duration,
            ...(categoryId ? { MaLoai: categoryId } : {}),
            TrangThaiThucHien: 1,
          });
          if (!taskRes.success) throw new Error(taskRes.message || "Lỗi tạo công việc");

          const taskId = taskRes.data?.MaCongViec || taskRes.data?.id || taskRes.taskId;

          // 2. Tạo lịch trình — end time honors the duration user set in the modal.
          const startDateForSave = new Date(startISO);
          const endDateForSave = new Date(startDateForSave.getTime() + duration * 60000);
          const eventRes = await Utils.makeRequest("/api/calendar/events", "POST", {
            MaCongViec: taskId,
            TieuDe: title,
            GioBatDau: startDateForSave.toISOString(),
            GioKetThuc: endDateForSave.toISOString(),
            MucDoUuTien: priority,
            GhiChu: note,
            AI_DeXuat: 0,
          });

          if (!eventRes.success) throw new Error(eventRes.message || "Lỗi tạo lịch trình");

          // 3. Thêm event lên calendar
          const newEventId = eventRes.eventId || eventRes.data?.MaLichTrinh || eventRes.data?.id;
          this.calendar.addEvent({
            id: newEventId,
            title,
            start: startDateForSave,
            end: endDateForSave,
            backgroundColor: color,
            borderColor: color,
            extendedProps: { note, completed: false, taskId, priority },
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
    },

    // ==========================================================
    // SHOW EVENT DETAILS MODAL
    // ==========================================================
    _showEventDetails(event) {
      const p = event.extendedProps;
      const now = new Date();
      const eventStart = event.start || now;
      const isFuture = eventStart > now;

      const startStr = event.start ? event.start.toLocaleString("vi-VN") : "N/A";
      const endStr = event.end ? event.end.toLocaleString("vi-VN") : "N/A";
      const dateStr = event.start ? event.start.toLocaleDateString("vi-VN") : "";
      const timeStr = event.start
        ? event.start.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
        : "";

      const priorityTexts = { 1:"Thấp", 2:"Trung bình", 3:"Cao", 4:"Rất cao" };
      const pri = p.priority || 2;
      const dotColor = window.PriorityTheme ? PriorityTheme.getColor(pri) : "#3B82F6";

      const canComplete = !isFuture || p.completed;
      const completeDisabledAttr = canComplete ? "" : "disabled";
      const completeTitle = isFuture ? "Chưa đến thời gian làm việc" : "";

      const modalHtml = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9998]" id="eventDetailModal">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 rounded-t-2xl flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${dotColor}"></span>
            <h3 class="text-white font-bold text-lg leading-tight truncate">${event.title}</h3>
          </div>
          <button id="closeEventDetail" class="text-white/60 hover:text-white text-2xl leading-none flex-shrink-0">&times;</button>
        </div>

        <div class="p-6 space-y-4">
          <!-- Thông tin thời gian -->
          <div class="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div class="flex items-center gap-2 text-gray-700">
              <i class="fas fa-calendar-alt text-red-500 w-4"></i>
              <span class="font-medium">${dateStr}</span>
              <span class="text-gray-400">|</span>
              <span>${timeStr} — ${event.end ? event.end.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}) : ""}</span>
            </div>
            ${p.note ? `<div class="flex items-start gap-2 text-gray-600"><i class="fas fa-sticky-note text-amber-400 w-4 mt-0.5"></i><span>${p.note}</span></div>` : ""}
            <div class="flex items-center gap-2">
              <i class="fas fa-flag w-4" style="color:${dotColor}"></i>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full" style="background:${dotColor}22;color:${dotColor}">${priorityTexts[pri]}</span>
            </div>
          </div>

          <!-- Ghi chú -->
          <div class="space-y-1">
            <label class="text-xs font-semibold text-gray-500" for="eventNoteInput">Ghi chú</label>
            <textarea id="eventNoteInput" rows="2"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              placeholder="Thêm ghi chú...">${p.note || ""}</textarea>
          </div>

          <!-- Đánh dấu hoàn thành -->
          <div class="rounded-xl border-2 p-4 ${p.completed ? "border-green-200 bg-green-50" : isFuture ? "border-gray-200 bg-gray-50 opacity-60" : "border-red-100 bg-red-50"}">
            <label class="flex items-center gap-3 ${canComplete ? "cursor-pointer" : "cursor-not-allowed"}">
              <input type="checkbox" id="eventCompletedCheckbox"
                     class="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                     ${p.completed ? "checked" : ""} ${completeDisabledAttr}
                     title="${completeTitle}" />
              <div>
                <p class="font-semibold text-gray-800">${p.completed ? "Đã hoàn thành" : "Đánh dấu hoàn thành"}</p>
                ${isFuture && !p.completed ? '<p class="text-xs text-gray-500 mt-0.5">Chưa đến thời gian làm việc</p>' : ""}
              </div>
            </label>
          </div>

          <!-- Subtasks (minitask) section — stacked cards -->
          <div class="rounded-xl border p-3" style="border-color:#e2e8f0">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2 text-sm font-semibold" style="color:#1e293b">
                <i class="fas fa-layer-group" style="color:${dotColor}"></i>
                Minitask
                <span id="subtaskCountBadge" class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background:${dotColor}22;color:${dotColor}">0</span>
              </div>
              <button id="toggleAddSubtaskBtn" class="text-xs font-semibold px-2 py-1 rounded-lg" style="color:${dotColor};background:${dotColor}11">
                <i class="fas fa-plus mr-1"></i>Thêm
              </button>
            </div>
            <div id="subtaskList" class="space-y-2">
              <div class="text-xs italic" style="color:#94a3b8">Đang tải...</div>
            </div>

            <!-- Inline add form (hidden by default) -->
            <div id="addSubtaskForm" class="hidden mt-3 rounded-lg p-3" style="background:#f8fafc;border:1px dashed #cbd5e1">
              <input type="text" id="subtaskTitleInput" placeholder="Tên minitask *" class="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-red-500" style="border-color:#e2e8f0;background:#fff" />
              <div class="grid grid-cols-2 gap-2 mt-2">
                <input type="time" step="60" id="subtaskStartInput" class="px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-red-500" style="border-color:#e2e8f0;background:#fff" />
                <input type="time" step="60" id="subtaskEndInput" class="px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-red-500" style="border-color:#e2e8f0;background:#fff" />
              </div>
              <p class="text-[10px] mt-1" style="color:#94a3b8">
                <i class="fas fa-info-circle mr-1"></i>Giờ và phút. Phải nằm trong thời gian task chính.
              </p>
              <textarea id="subtaskNoteInput" rows="2" placeholder="Ghi chú (không bắt buộc)" class="w-full mt-2 px-3 py-2 rounded-lg border text-xs resize-none focus:outline-none focus:ring-2 focus:ring-red-500" style="border-color:#e2e8f0;background:#fff"></textarea>
              <div class="flex justify-end gap-2 mt-2">
                <button id="cancelAddSubtaskBtn" class="px-3 py-1.5 text-xs font-semibold rounded-lg" style="background:#f1f5f9;color:#64748b">Huỷ</button>
                <button id="saveAddSubtaskBtn" class="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style="background:${dotColor}">Thêm</button>
              </div>
            </div>
          </div>

          <!-- Buttons -->
          <div class="flex gap-3 pt-2">
            <button id="saveEventStatus"
                    class="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition flex items-center justify-center gap-2">
              <i class="fas fa-save"></i> Lưu
            </button>
            <button id="deleteEventBtn"
                    class="py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-semibold border border-red-200 transition flex items-center gap-2">
              <i class="fas fa-trash"></i> Xóa
            </button>
          </div>
        </div>
      </div>
    </div>`;

      document.getElementById("eventDetailModal")?.remove();
      document.body.insertAdjacentHTML("beforeend", modalHtml);

      document.getElementById("closeEventDetail").onclick = () =>
        document.getElementById("eventDetailModal")?.remove();

      document.getElementById("eventDetailModal").addEventListener("click", (e) => {
        if (e.target.id === "eventDetailModal")
          document.getElementById("eventDetailModal")?.remove();
      });

      document.getElementById("saveEventStatus").onclick = () =>
        this._updateEventStatus(event);

      const completionCheckbox = document.getElementById("eventCompletedCheckbox");
      if (completionCheckbox && !completionCheckbox.disabled) {
        completionCheckbox.addEventListener("change", () => this._updateEventStatus(event));
      }

      document.getElementById("deleteEventBtn").onclick = async () => {
        const confirmed = confirm(`Xóa sự kiện "${event.title}"?\nThao tác này không thể hoàn tác.`);
        if (confirmed) this._deleteEvent(event);
      };

      // Subtasks — load + bind UI. Skip when event has no persisted id (temp-...).
      const eventIdForSubtasks = parseInt(event.id, 10);
      if (Number.isFinite(eventIdForSubtasks)) {
        this._bindSubtaskUi(eventIdForSubtasks, event);
      } else {
        const list = document.getElementById("subtaskList");
        if (list) list.innerHTML = `<div class="text-xs italic" style="color:#94a3b8">Sự kiện chưa được lưu — lưu trước rồi mới thêm minitask.</div>`;
        document.getElementById("toggleAddSubtaskBtn")?.setAttribute("disabled", "true");
      }
    },

    // ---------------------------------------------------------
    // Subtask UI
    // ---------------------------------------------------------

    async _loadSubtasks(eventId) {
      try {
        // Cache-bust: without `t` param, browser 304s and returns a stale empty list.
        const r = await Utils.makeRequest(`/api/event-subtasks?event_id=${eventId}&t=${Date.now()}`, "GET");
        return r?.success ? (r.data || []) : [];
      } catch (_) {
        return [];
      }
    },

    _renderSubtaskList(items, eventId, event) {
      const list = document.getElementById("subtaskList");
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
              style="accent-color:#dc2626;flex-shrink:0" />
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
    },

    _bindSubtaskUi(eventId, event) {
      const self = this;

      // Load initial list.
      this._loadSubtasks(eventId).then((items) => this._renderSubtaskList(items, eventId, event));

      const list = document.getElementById("subtaskList");
      const form = document.getElementById("addSubtaskForm");
      const toggleBtn = document.getElementById("toggleAddSubtaskBtn");
      const cancelBtn = document.getElementById("cancelAddSubtaskBtn");
      const saveBtn = document.getElementById("saveAddSubtaskBtn");

      toggleBtn?.addEventListener("click", () => {
        form?.classList.toggle("hidden");
        document.getElementById("subtaskTitleInput")?.focus();
      });
      cancelBtn?.addEventListener("click", () => form?.classList.add("hidden"));

      // Hint time input bounds — browser shows picker limits, user sees valid range.
      if (event.start && event.end) {
        const evStart = new Date(event.start);
        const evEnd = new Date(event.end);
        const toHM = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const si = document.getElementById("subtaskStartInput");
        const ei = document.getElementById("subtaskEndInput");
        if (si) { si.min = toHM(evStart); si.max = toHM(evEnd); si.value = toHM(evStart); }
        if (ei) { ei.min = toHM(evStart); ei.max = toHM(evEnd); ei.value = toHM(evEnd); }
      }

      saveBtn?.addEventListener("click", async () => {
        const title = document.getElementById("subtaskTitleInput").value.trim();
        if (!title) {
          Utils.showToast?.("Nhập tên minitask", "error");
          return;
        }
        // Combine event's date with picked HH:MM so backend gets full ISO.
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

        // Client-side validation: subtask must fit inside parent event's time range.
        if (sAtStr && eAtStr && event.start && event.end) {
          const sAt = new Date(sAtStr);
          const eAt = new Date(eAtStr);
          const evStart = new Date(event.start);
          const evEnd = new Date(event.end);
          if (sAt < evStart || eAt > evEnd) {
            Utils.showToast?.("Thời gian minitask phải nằm trong thời gian task chính", "error");
            return;
          }
          if (eAt <= sAt) {
            Utils.showToast?.("Kết thúc phải sau bắt đầu", "error");
            return;
          }
        }

        const payload = {
          event_id: eventId,
          title,
          start_at: sAtStr,
          end_at: eAtStr,
          note: document.getElementById("subtaskNoteInput").value.trim() || null,
        };
        saveBtn.disabled = true;
        try {
          const r = await Utils.makeRequest("/api/event-subtasks", "POST", payload);
          if (!r.success) throw new Error(r.message || "Lỗi tạo");
          // Reset form + reload list.
          document.getElementById("subtaskTitleInput").value = "";
          document.getElementById("subtaskStartInput").value = "";
          document.getElementById("subtaskEndInput").value = "";
          document.getElementById("subtaskNoteInput").value = "";
          form?.classList.add("hidden");
          const items = await self._loadSubtasks(eventId);
          self._renderSubtaskList(items, eventId, event);
          // Also nudge the event card to refresh its count badge.
          // Update both count and full list so the stacked preview on the calendar card re-renders.
          event.setExtendedProp("subtasks", items);
          event.setExtendedProp("subtaskCount", items.length);
        } catch (err) {
          Utils.showToast?.(err.message || "Lỗi", "error");
        } finally {
          saveBtn.disabled = false;
        }
      });

      // Delegation on list: toggle done + delete.
      list?.addEventListener("change", async (e) => {
        const cb = e.target.closest(".subtask-done");
        if (!cb) return;
        const id = cb.dataset.subtaskId;
        try {
          await Utils.makeRequest(`/api/event-subtasks/${id}`, "PATCH", { is_done: cb.checked });
          const items = await self._loadSubtasks(eventId);
          self._renderSubtaskList(items, eventId, event);
          event.setExtendedProp("subtasks", items);
          event.setExtendedProp("subtaskCount", items.length);
        } catch (_) {}
      });

      list?.addEventListener("click", async (e) => {
        const del = e.target.closest(".subtask-delete");
        if (!del) return;
        if (!confirm("Xóa minitask này?")) return;
        const id = del.dataset.subtaskId;
        try {
          await Utils.makeRequest(`/api/event-subtasks/${id}`, "DELETE");
          const items = await self._loadSubtasks(eventId);
          self._renderSubtaskList(items, eventId, event);
          // Update both count and full list so the stacked preview on the calendar card re-renders.
          event.setExtendedProp("subtasks", items);
          event.setExtendedProp("subtaskCount", items.length);
        } catch (_) {}
      });
    },

    /** Drag-to-delete entry point: confirm + delegate to _deleteEvent. */
    _dragDeleteEvent(event) {
      // Temp/drag events aren't persisted — just remove from UI without confirm.
      const id = event.id?.toString() || "";
      if (!id || id.startsWith("temp-") || id.startsWith("drag-")) {
        try { event.remove(); } catch (_) {}
        return;
      }
      const confirmed = confirm(
        `Xóa sự kiện "${event.title}"?\nKéo thả vào danh sách công việc để xóa. Không thể hoàn tác.`
      );
      if (!confirmed) return;
      this._deleteEvent(event);
    },

    async _deleteEvent(event) {
      const eventId = event.id;

      if (!eventId || eventId.toString().startsWith("temp-")) {
        Utils.showToast?.("Sự kiện chưa được lưu vào database", "warning");
        document.getElementById("eventDetailModal")?.remove();
        event.remove();
        return;
      }

      // Legacy modal had #confirmDeleteBtn; current modal uses native confirm() +
      // #deleteEventBtn. Guard so the button's absence doesn't crash the delete flow.
      const busyBtn =
        document.getElementById("confirmDeleteBtn") ||
        document.getElementById("deleteEventBtn");
      const originalHtml = busyBtn?.innerHTML;
      if (busyBtn) {
        busyBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Đang xóa...';
        busyBtn.disabled = true;
      }

      try {
        const result = await Utils.makeRequest(
          `/api/calendar/events/${eventId}`,
          "DELETE"
        );

        if (!result.success) {
          const msg = result.message || "";
          if (msg.includes("liên quan") || msg.includes("task")) {
            throw new Error(
              "Sự kiện đang liên kết với công việc. Vui lòng kiểm tra lại."
            );
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
          document.querySelector(
            `.fc-event[title*="${event.title.substring(0, 20)}"]`
          );

        if (eventEl) {
          eventEl.style.animation = "shrinkOut 0.5s ease forwards";
          eventEl.style.transformOrigin = "center";
          setTimeout(() => {
            event.remove();
          }, 500);
        } else {
          event.remove();
        }

        Utils.showToast?.("Đã xóa sự kiện thành công!", "success");

        document.dispatchEvent(
          new CustomEvent("eventDeleted", {
            detail: { eventId, eventTitle: event.title },
          })
        );
      } catch (error) {
        console.error("Error deleting event:", error);

        if (busyBtn) {
          busyBtn.innerHTML = originalHtml || '<i class="fas fa-trash mr-2"></i> Xóa';
          busyBtn.disabled = false;
        }

        let errorMessage = "Lỗi khi xóa sự kiện";
        if (
          error.message.includes("liên kết") ||
          error.message.includes("task")
        ) {
          errorMessage = "⛔ " + error.message;
        } else if (
          error.message.includes("database") ||
          error.message.includes("ID hợp lệ")
        ) {
          errorMessage = "⚠️ " + error.message;
        } else {
          errorMessage = error.message || "Lỗi khi xóa sự kiện";
        }

        Utils.showToast?.(errorMessage, "error");
      }
    },

    async _updateEventStatus(event) {
      try {
        const checkbox = document.getElementById("eventCompletedCheckbox");
        if (!checkbox) {
          return;
        }

        const completed = checkbox.checked;

        const wasCompleted = event.extendedProps.completed;

        const saveBtn = document.getElementById("saveEventStatus");
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin mr-2"></i> Đang cập nhật...';
        const eventEls = document.querySelectorAll(
          `[data-event-id="${
            event.id
          }"], .fc-event[title*="${event.title.substring(0, 20)}"]`
        );
        // ✅ CHỈ TÌM EVENT CỤ THỂ THEO ID - KHÔNG DÙNG TITLE
        const eventEl = document.querySelector(`[data-event-id="${event.id}"]`);

        if (eventEl) {
          // Let CSS (.event-completed) own the visual treatment. Previously
          // inline opacity:0.6 overrode the CSS value and wiped the priority tint.
          if (completed) {
            eventEl.classList.add("event-completed", "completing");
          } else {
            eventEl.classList.remove("event-completed", "completing");
          }
          eventEl.style.opacity = "";
          eventEl.style.textDecoration = "";
        }

        const noteInput = document.getElementById("eventNoteInput");
        const note = noteInput ? noteInput.value.trim() : (event.extendedProps.note || "");

        // Backend PUT expects `note` (see backend/routes/calendar.js). Previous
        // `GhiChu` key was silently dropped → note vanished after F5.
        const updateData = {
          completed: completed,
          note: note,
        };

        const res = await Utils.makeRequest(
          `/api/calendar/events/${event.id}`,
          "PUT",
          updateData
        );

        if (res.success) {
          event.setExtendedProp("completed", completed);
          event.setExtendedProp("note", note);

          // Re-render the event to apply CSS changes
          const calendar = this.getCalendar();
          if (calendar) {
            event.remove();
            calendar.addEvent(event.toPlainObject());
          }

          // Update modal status text
          const statusEl = document.querySelector(
            '[class*="text-green-600"], [class*="text-orange-600"]'
          );
          if (statusEl) {
            if (completed) {
              statusEl.className =
                "text-green-600 font-semibold flex items-center gap-2";
              statusEl.innerHTML =
                '<i class="fas fa-check-circle"></i> Đã hoàn thành';
            } else {
              statusEl.className =
                "text-orange-600 font-semibold flex items-center gap-2";
              statusEl.innerHTML =
                '<i class="fas fa-clock"></i> Chưa hoàn thành';
            }
          }
          Utils.showToast?.(
            completed
              ? "Đã hoàn thành công việc!"
              : "Bỏ đánh dấu hoàn thành",
            "success"
          );

          saveBtn.disabled = false;
          saveBtn.innerHTML = originalBtnText;
          setTimeout(() => {
            document.getElementById("eventDetailModal")?.remove();
          }, 600);
        } else {
          eventEls.forEach((el) => {
            if (wasCompleted) {
              el.classList.add("event-completed");
            } else {
              el.classList.remove("event-completed");
            }
            // Clear any stray inline styles so CSS (priority tint + stripes) wins
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

        Utils.showToast?.(
          "" + (err.message || "Lỗi cập nhật trạng thái"),
          "error"
        );

        const saveBtn = document.getElementById("saveEventStatus");
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i> Lưu thay đổi';
        }

        // Restore checkbox
        const checkbox = document.getElementById("eventCompletedCheckbox");
        if (checkbox) {
          checkbox.checked = event.extendedProps.completed;
        }
      }
    },

    initializeNavbarEvents() {
      const controls = {
        "cal-prev-btn": () => this.calendar.prev(),
        "cal-next-btn": () => this.calendar.next(),
        "cal-today-btn": () => this.calendar.today(),
        "cal-day-view": () => this.changeView("timeGridDay"),
        "cal-week-view": () => this.changeView("timeGridWeek"),
        "cal-month-view": () => this.changeView("dayGridMonth"),
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
      this.currentView = view;
      this.calendar.changeView(view);
      this.updateCalendarTitle();
      this.setActiveView(view);
    },

    setActiveView(view) {
      const map = {
        "cal-day-view": "timeGridDay",
        "cal-week-view": "timeGridWeek",
        "cal-month-view": "dayGridMonth",
      };
      Object.entries(map).forEach(([id, v]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isActive = v === view;
        btn.classList.toggle("bg-white", isActive);
        btn.style.color = isActive ? "#1e293b" : "#64748b";
        btn.style.boxShadow = isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "none";
      });
    },

    updateCalendarTitle() {
      const titleEl = document.getElementById("calendar-title");
      if (titleEl && this.calendar)
        titleEl.textContent = this.calendar.view.title;
    },

    initMiniCalendar() {
      // Prefer the dedicated mini-cal container so the task list below is preserved
      const sidebar = document.getElementById("mini-cal-container") || document.getElementById("calendar-sidebar");
      if (!sidebar) return;

      const today = new Date();
      this._miniDate = new Date(today.getFullYear(), today.getMonth(), 1);

      const render = () => {
        const d = this._miniDate;
        const year = d.getFullYear();
        const month = d.getMonth();
        const monthNames = ["Tháng 1","Tháng 2","Tháng 3","Tháng 4","Tháng 5","Tháng 6","Tháng 7","Tháng 8","Tháng 9","Tháng 10","Tháng 11","Tháng 12"];
        const days = ["CN","T2","T3","T4","T5","T6","T7"];
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayNum = today.getDate();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

        let cells = "";
        for (let i = 0; i < firstDay; i++) cells += `<div></div>`;
        for (let i = 1; i <= daysInMonth; i++) {
          const isToday = isCurrentMonth && i === todayNum;
          cells += `<button class="mini-cal-day${isToday ? " today-day" : ""}"
            data-date="${year}-${String(month+1).padStart(2,"0")}-${String(i).padStart(2,"0")}">${i}</button>`;
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
              ${days.map(d => `<div class="text-center text-xs font-semibold text-gray-400 py-1">${d}</div>`).join("")}
            </div>
            <div class="grid grid-cols-7 gap-0.5">${cells}</div>
            <button id="mini-today" class="mt-3 w-full text-xs text-red-600 font-semibold hover:bg-red-50 py-1.5 rounded-lg transition">
              Hôm nay
            </button>
          </div>`;

        document.getElementById("mini-prev").onclick = () => {
          this._miniDate = new Date(year, month - 1, 1);
          render();
        };
        document.getElementById("mini-next").onclick = () => {
          this._miniDate = new Date(year, month + 1, 1);
          render();
        };
        document.getElementById("mini-today").onclick = () => {
          this._miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
          render();
          this.calendar?.today();
        };
        sidebar.querySelectorAll(".mini-cal-day").forEach(btn => {
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

    destroy() {
      if (this.draggableInstance) {
        try {
          this.draggableInstance.destroy();
        } catch (e) {}
        this.draggableInstance = null;
      }
      if (this.calendar) {
        try {
          this.calendar.destroy();
        } catch (e) {}
        this.calendar = null;
      }
      this.isInitialized = false;
    },

    refresh() {
      this.init();
    },

    getCalendar() {
      return this.calendar;
    },
  };

  window.CalendarModule = CalendarModule;
})();
