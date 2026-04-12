(function () {
  "use strict";

  if (window.CalendarModule) {
    console.warn("CalendarModule already exists → destroying old instance");
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

    setupTaskDragListeners() {


      this.initializeExternalDraggable();

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) {
                if (node.classList && node.classList.contains("task-item")) {
                  this.makeTaskDraggable(node);
                }
                const taskItems = node.querySelectorAll
                  ? node.querySelectorAll(".task-item")
                  : [];

                taskItems.forEach((item) => {
                  this.makeTaskDraggable(item);
                });
              }
            });
          }
        });
      });
      const taskList = document.getElementById("task-list");
      if (taskList) {
        observer.observe(taskList, {
          childList: true,
          subtree: true,
        });
      }


    },

    initializeExternalDraggable() {


      const taskList = document.getElementById("task-list");
      if (!taskList) {
        console.warn(" task-list container not found");
        return;
      }

      const taskItems = taskList.querySelectorAll(".task-item");


      taskItems.forEach((item) => {
        this.makeTaskDraggable(item);
      });
    },

    makeTaskDraggable(element) {
      if (element.hasAttribute("data-draggable-init")) return;
      const taskId = element.dataset.taskId;
      const title = element.dataset.taskTitle || element.textContent.trim();
      const priority = parseInt(element.dataset.taskPriority) || 2;
      const description = element.dataset.taskDescription || "";
      const color = this.getPriorityColor(priority);

      if (!taskId) {
        console.warn(" Task element missing taskId");
        return;
      }
      try {
        if (typeof FullCalendar !== "undefined" && FullCalendar.Draggable) {
          const draggable = new FullCalendar.Draggable(element, {
            eventData: {
              id: `drag-${taskId}`,
              title: title,
              backgroundColor: color,
              borderColor: color,

              extendedProps: {
                taskId: taskId,
                priority: priority,
                description: description,
                isFromDrag: true,
              },
            },
          });

          element.setAttribute("data-draggable-init", "true");

        } else {
          this.bindHTML5DragEvents(element);
        }
      } catch (err) {
        console.warn(
          " Error creating FullCalendar.Draggable, using HTML5 fallback:",
          err
        );
        this.bindHTML5DragEvents(element);
      }
    },

    bindHTML5DragEvents(element) {
      if (element.hasAttribute("data-html5-drag-bound")) return;

      element.setAttribute("draggable", "true");
      element.setAttribute("data-html5-drag-bound", "true");

      element.addEventListener("dragstart", (e) => {
        const taskId = element.dataset.taskId;
        const title = element.dataset.taskTitle || element.textContent.trim();
        const color = element.dataset.taskColor || "#3B82F6";
        const priority = parseInt(element.dataset.taskPriority) || 2;

        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", taskId);
        e.dataTransfer.setData("taskId", taskId);
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({ taskId, title, color, priority })
        );

        element.classList.add("dragging");

      });

      element.addEventListener("dragend", () => {
        element.classList.remove("dragging");

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

      // Phase 05: refresh calendar when full create-task modal creates a fixed task
      document.addEventListener("calendar:reload", () => {
        setTimeout(() => this._reloadCalendarEvents(), 400);
      });
      document.addEventListener("taskCreated", (e) => {
        if (e.detail?.task?.is_fixed) {
          setTimeout(() => this._reloadCalendarEvents(), 600);
        }
      });
    },

    // Re-fetch all events and refresh the FullCalendar instance
    async _reloadCalendarEvents() {
      if (!this.calendar) return;
      try {
        const events = await this.loadEvents();
        this.calendar.removeAllEvents();
        events.forEach(ev => this.calendar.addEvent(ev));
      } catch (err) {
        console.warn("calendar reload failed:", err);
      }
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
            <button onclick="location.reload()" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              Tải lại trang
            </button>
          </div>
        </div>
      `;
    },

    async loadEvents() {
      if (!Utils?.makeRequest) {
        console.warn("Utils.makeRequest không tồn tại → trả về mảng rỗng");
        return [];
      }

      try {
        // Load calendar events from backend (uses LichTrinh)
        const now = new Date();
        const rangeStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
        const rangeEnd = new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString();
        const res = await Utils.makeRequest(
          `/api/calendar/instances?start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`,
          "GET"
        );
        if (!res.success || !Array.isArray(res.data)) {
          console.warn("Invalid response from /api/calendar/instances");
          return [];
        }

        const normalEvents = res.data
          .map((ev) => {
            const priority = ev.extendedProps?.priority || 2;
            const completed = ev.extendedProps?.completed || false;
            const color = ev.backgroundColor || this.getPriorityColor(priority);

            const startTime = new Date(ev.start || new Date().toISOString());
            const endTime = ev.end
              ? new Date(ev.end)
              : new Date(startTime.getTime() + 60 * 60 * 1000);

            // All events from LichTrinh are editable (no fixed concept without migration)
            return {
              id: ev.id,
              title: ev.title || "Không tiêu đề",
              start: startTime,
              end: endTime,
              backgroundColor: color,
              borderColor: color,
              allDay: false,
              editable: !completed,
              startEditable: !completed,
              durationEditable: !completed,
              extendedProps: {
                instanceId: ev.extendedProps?.instanceId || ev.id,
                note: ev.extendedProps?.note || "",
                completed: completed,
                taskId: ev.extendedProps?.taskId || null,
                isFromDrag: false,
                isAIEvent: ev.extendedProps?.aiSuggested || false,
                priority: priority,
                isFixed: false,
                originalColor: color,
              },
            };
          });



        return normalEvents;
      } catch (err) {
        console.error("Load events error:", err);
        return [];
      }
    },

    getPriorityColor(priority) {
      // Phase 04: Newspaper palette
      const colors = {
        1: "#8a9a5b", // low – olive green
        2: "#4a6fa5", // medium – ink blue
        3: "#c97b3c", // high – burnt sienna
        4: "#a83232", // urgent – press red
      };
      return colors[priority] || "#4a6fa5";
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

        // Phase 04: Remove all-day slot entirely
        allDaySlot: false,

        dropAccept: ".task-item, [draggable='true'], [data-task-id]",

        slotMinTime: "00:00:00",
        slotMaxTime: "24:00:00",
        slotDuration: "00:30:00",
        scrollTime: "07:00:00",

        buttonText: {
          today: "Hôm nay",
          month: "Tháng",
          week: "Tuần",
          day: "Ngày",
          list: "Danh sách",
        },
        moreLinkText: (n) => `+ ${n} thêm`,
        noEventsText: "Không có sự kiện",

        eventReceive: (info) => {
          this._handleEventReceive(info);
        },

        eventDrop: async (info) => {
          // Phase 04: Block drag on fixed events
          if (info.event.extendedProps?.isFixed) {
            Utils.showToast?.("Sự kiện cố định không thể di chuyển", "warning");
            info.revert();
            return;
          }
          await this._handleInstanceUpdate(info);
        },

        eventResize: async (info) => {
          // Phase 04: Block resize on fixed events
          if (info.event.extendedProps?.isFixed) {
            Utils.showToast?.("Sự kiện cố định không thể thay đổi thời gian", "warning");
            info.revert();
            return;
          }
          await this._handleInstanceUpdate(info);
        },

        select: (info) => {
          // Phase 04: Wire drag-to-create with exact times
          this._handleDateSelect(info.start, info.end);
          this.calendar.unselect();
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
          const isFixed = info.event.extendedProps.isFixed || false;

          // Phase 04: Newspaper priority classes
          if (priority === 1) el.classList.add("event-priority-low");
          else if (priority === 2) el.classList.add("event-priority-medium");
          else if (priority === 3) el.classList.add("event-priority-high");
          else if (priority === 4) el.classList.add("event-priority-urgent");

          if (info.event.extendedProps.aiSuggested) {
            el.classList.add("event-ai-suggested");
          }

          // Phase 04: Fixed event visual indicator
          if (isFixed) {
            el.classList.add("event-fixed");
            const fixedBadge = document.createElement("span");
            fixedBadge.className = "event-fixed-badge";
            fixedBadge.textContent = "cố định";
            el.appendChild(fixedBadge);
          }

          // Apply completed CSS
          if (info.event.extendedProps.completed) {
            el.classList.add("event-completed");
            el.style.opacity = "0.6";
            el.style.textDecoration = "line-through";
            el.style.filter = "grayscale(50%)";

            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) {
              titleEl.style.textDecoration = "line-through";
              titleEl.style.textDecorationThickness = "2px";
            }

            const timeEl = el.querySelector(".fc-event-time");
            if (timeEl) timeEl.style.opacity = "0.6";
          }

          // Show note as small text inside event
          const note = info.event.extendedProps.note;
          if (note) {
            const noteEl = document.createElement("div");
            noteEl.className = "fc-event-note";
            noteEl.textContent = note;
            noteEl.style.cssText = "font-size:10px;font-style:italic;opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-family:var(--np-font-ui,'Inter',sans-serif);color:var(--np-text-muted,#6b5f4a);";
            // Append after title
            const mainFrame = el.querySelector(".fc-event-main") || el.querySelector(".fc-event-title-container") || el;
            mainFrame.appendChild(noteEl);
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
          el.title = `${info.event.title}\n${start} - ${end}${note ? "\n" + note : ""}`;
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
        let taskId, title, color, priority, duration;

        if (draggedEl) {
          taskId = draggedEl.dataset.taskId;
          title = draggedEl.dataset.taskTitle || "Công việc";
          priority = parseInt(draggedEl.dataset.taskPriority) || 2;
          duration = parseInt(draggedEl.dataset.taskDuration) || 60;
          color = this.getPriorityColor(priority);
        } else {
          taskId = info.jsEvent?.dataTransfer?.getData("text/plain");
          const jsonData = info.jsEvent?.dataTransfer?.getData("application/json");
          if (jsonData) {
            const data = JSON.parse(jsonData);
            title = data.title || "Công việc";
            priority = data.priority || 2;
            duration = data.duration || 60;
          } else {
            duration = 60;
            priority = 2;
          }
          color = this.getPriorityColor(priority);
        }

        if (!taskId) {
          console.error("No taskId found in drag data");
          info.event.remove();
          Utils.showToast?.("Lỗi: Không tìm thấy ID công việc", "error");
          return;
        }

        const start = info.event.start;
        const end = new Date(start.getTime() + duration * 60 * 1000);
        info.event.setEnd(end);

        // Phase 04: Check if task is fixed → show options popup
        await this._handleTaskDrop(taskId, title, color, start, end, priority, duration, info.event);
      } catch (err) {
        console.error("Event receive error:", err);
        info.event.remove();
        Utils.showToast?.("Lỗi kéo thả công việc", "error");
      }
    },

    // Handle task drop — remove temp event from eventReceive then save to LichTrinh
    async _handleTaskDrop(taskId, title, color, start, end, priority, duration, calEvent) {
      try {
        // Remove the temp event created by FullCalendar's eventReceive
        if (calEvent) calEvent.remove();
        await this.saveTaskInstance(taskId, title, color, start, end, priority);
      } catch (err) {
        console.error("Error in _handleTaskDrop:", err);
        if (calEvent) calEvent.remove();
        Utils.showToast?.("Lỗi xử lý kéo thả", "error");
      }
    },

    // Phase 04: Small inline popup for fixed task drop choice
    _showFixedTaskDropPopup(task, dropInfo, onChoice, onCancel) {
      document.getElementById("np-fixed-drop-popup")?.remove();

      const html = `
      <div id="np-fixed-drop-popup" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999]">
        <div class="bg-white border-2 border-gray-800 shadow-[4px_4px_0_#1a1a1a] rounded-sm max-w-sm w-full mx-4 p-5">
          <p class="font-bold text-gray-900 mb-1" style="font-family:'Playfair Display',serif">Xếp lịch công việc cố định</p>
          <p class="text-sm text-gray-600 mb-4">"${task.TieuDe || "Công việc"}" có lịch cố định. Chọn cách xếp:</p>
          <div class="flex flex-col gap-2">
            <button id="np-drop-custom" class="py-2 px-4 border-2 border-gray-800 text-sm font-semibold text-gray-800 hover:bg-gray-800 hover:text-white transition-colors">
              Xếp lịch tuỳ chọn (dùng thời điểm kéo thả)
            </button>
            <button id="np-drop-fixed" class="py-2 px-4 bg-gray-800 text-sm font-semibold text-white hover:bg-gray-900 transition-colors">
              Xếp theo lịch cố định
            </button>
            <button id="np-drop-cancel" class="py-1 text-xs text-gray-400 hover:text-gray-600">Huỷ</button>
          </div>
        </div>
      </div>`;

      document.body.insertAdjacentHTML("beforeend", html);

      const close = () => document.getElementById("np-fixed-drop-popup")?.remove();

      document.getElementById("np-drop-custom").onclick = () => { close(); onChoice(false); };
      document.getElementById("np-drop-fixed").onclick  = () => { close(); onChoice(true); };
      document.getElementById("np-drop-cancel").onclick = () => { close(); onCancel(); };
      document.getElementById("np-fixed-drop-popup").addEventListener("click", (e) => {
        if (e.target.id === "np-fixed-drop-popup") { close(); onCancel(); }
      });
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
          console.warn(` Event ID ${eventId} không hợp lệ, chỉ cập nhật local`);
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
        console.error(" Calendar element not found");
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
      background-color: rgba(59, 130, 246, 0.1) !important;
      border: 2px dashed #3b82f6 !important;
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
      } catch (e) {
        console.warn("Could not attach document-level drop listener:", e);
      }


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
          } catch (err) {
            console.warn("Could not parse JSON drag data:", err);
          }
        }

        if (!taskId) {
          taskId = e.dataTransfer.getData("taskId") || taskData.taskId;
        }

        if (!taskId) {
          console.error("❌ No task ID found in drop data");

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
        } catch (err) {
          console.warn(
            "Could not calculate drop position, using current time:",
            err
          );
        }

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
        console.error("❌ Drop error:", error);
        Utils.showToast?.("Lỗi khi kéo thả công việc", "error");
      } finally {
        this._handlingDrop = false;
      }
    },

    // Save task to calendar via LichTrinh
    async saveTaskInstance(taskId, title, color, start, end, priority = 2) {
      try {
        const res = await Utils.makeRequest('/api/calendar/events', 'POST', {
          MaCongViec: parseInt(taskId),
          TieuDe: title,
          GioBatDau: start.toISOString(),
          GioKetThuc: end.toISOString(),
          GhiChu: '',
          AI_DeXuat: false,
        });

        if (res.success) {
          const newEventId = res.eventId || `evt-${Date.now()}`;

          // Remove any temp placeholder before adding real event
          this.calendar.getEvents()
            .filter((e) => e.id?.startsWith('temp-') || e.id?.startsWith('drag-'))
            .forEach((e) => e.remove());

          this.calendar.addEvent({
            id: newEventId,
            title: title,
            start: start,
            end: end,
            backgroundColor: color,
            borderColor: color,
            allDay: false,
            editable: true,
            extendedProps: {
              instanceId: newEventId,
              taskId: parseInt(taskId),
              priority: priority,
              completed: false,
              isFromDrag: true,
            },
          });

          Utils.showToast?.("Đã lên lịch thành công!", "success");
          this.triggerSidebarRefresh();
        } else {
          throw new Error(res.message || "Lỗi thêm vào lịch");
        }
      } catch (error) {
        console.error("Error saving task instance:", error);
        this.calendar?.getEvents()
          .filter((e) => e.id?.startsWith("temp-") || e.id?.startsWith("drag-"))
          .forEach((e) => e.remove());
        Utils.showToast?.(error.message || "Lỗi khi lưu sự kiện", "error");
      }
    },

    // Legacy alias kept for handleDrop compatibility
    async saveDroppedEvent(taskId, title, color, start, end, priority = 2, duration = 60) {
      return this.saveTaskInstance(taskId, title, color, start, end, priority);
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
      } catch (e) {

      }
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
    // Phase 04/05: Drag-to-create date select handler
    // Stores prefill in window.__pendingTaskPrefill & dispatches event.
    // Opens full create-task modal (Phase 05) with prefilled times.
    // ==========================================================
    _handleDateSelect(start, end) {
      // Always use simple quick-create modal from calendar
      this._showQuickCreateModal(start, end, false);
    },

    // Update event time on drag/resize via LichTrinh
    async _handleInstanceUpdate(info) {
      try {
        const event = info.event;
        const eventId = event.extendedProps?.instanceId || event.id;

        if (!eventId) {
          throw new Error("Sự kiện không có ID");
        }

        // Skip temp events (not yet persisted)
        if (String(eventId).startsWith("temp-") || String(eventId).startsWith("drag-") || String(eventId).startsWith("evt-")) {
          return;
        }

        const newStart = event.start;
        const newEnd = event.end || new Date(newStart.getTime() + 60 * 60 * 1000);

        // Extract numeric ID from "lt_123" format used by LichTrinh fallback
        const numericId = String(eventId).startsWith("lt_") ? eventId.slice(3) : eventId;

        Utils.showToast?.("Đang cập nhật thời gian...", "info");

        const result = await Utils.makeRequest(
          `/api/calendar/events/${numericId}`,
          "PUT",
          {
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
          }
        );

        if (!result.success) {
          throw new Error(result.message || "Cập nhật thất bại");
        }

        Utils.showToast?.("Đã cập nhật thời gian", "success");
      } catch (error) {
        console.error("Error updating event:", error);
        Utils.showToast?.(error.message || "Lỗi cập nhật", "error");
        info.revert();
      }
    },

    // ==========================================================
    // QUICK CREATE MODAL — newspaper-themed, simple task creation
    // ==========================================================
    _showQuickCreateModal(start, end, allDay) {
      const startISO = start instanceof Date ? start.toISOString() : start;
      const endISO = end instanceof Date ? end.toISOString() : end;
      const startLabel = start instanceof Date
        ? start.toLocaleString("vi-VN", { weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })
        : startISO;
      const endLabel = end instanceof Date
        ? end.toLocaleTimeString("vi-VN", { hour:"2-digit", minute:"2-digit" })
        : "";

      document.getElementById("quickCreateModal")?.remove();

      const html = `
      <div id="quickCreateModal" class="fixed inset-0 flex items-center justify-center z-[9999]"
           style="background:rgba(0,0,0,0.5)">
        <div style="background:var(--np-bg-card,#faf7f2);border:1.5px solid var(--np-border,#1a1a1a);
                    border-radius:var(--np-radius,2px);box-shadow:var(--np-shadow,4px 4px 0 #1a1a1a);
                    width:100%;max-width:420px;margin:0 1rem;">

          <!-- Header -->
          <div style="padding:0.75rem 1rem;border-bottom:2px solid var(--np-border,#1a1a1a);
                      display:flex;justify-content:space-between;align-items:center;">
            <h3 style="font-family:var(--np-font-heading,'Playfair Display',serif);font-size:1.1rem;
                       font-weight:700;color:var(--np-text,#1a1a1a);margin:0;">Tạo công việc</h3>
            <button id="closeQuickCreate" style="background:none;border:none;cursor:pointer;
                    font-size:1.2rem;color:var(--np-text-muted,#6b5f4a)">&times;</button>
          </div>

          <!-- Body -->
          <div style="padding:1rem;display:flex;flex-direction:column;gap:0.75rem;">
            <!-- Time info -->
            <div style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.75rem;
                        color:var(--np-text-muted,#6b5f4a);letter-spacing:0.05em;
                        padding:0.4rem 0;border-bottom:1px solid var(--np-border-muted,#c8b99a);">
              ${startLabel}${endLabel ? ' — ' + endLabel : ''}
            </div>

            <!-- Title -->
            <input type="text" id="qc-title" placeholder="Tên công việc *"
              style="font-family:var(--np-font-body,'Merriweather',serif);font-size:0.9rem;
                     padding:0.5rem 0.25rem;border:none;border-bottom:1.5px solid var(--np-border-muted,#c8b99a);
                     background:transparent;color:var(--np-text,#1a1a1a);outline:none;width:100%;" />

            <!-- Note -->
            <textarea id="qc-note" placeholder="Ghi chú" rows="2"
              style="font-family:var(--np-font-body,'Merriweather',serif);font-size:0.85rem;
                     padding:0.4rem 0.25rem;border:none;border-bottom:1.5px solid var(--np-border-muted,#c8b99a);
                     background:transparent;color:var(--np-text,#1a1a1a);outline:none;width:100%;resize:none;"></textarea>

            <!-- Priority -->
            <div>
              <span style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.65rem;
                           font-weight:500;letter-spacing:0.1em;text-transform:uppercase;
                           color:var(--np-text-muted,#6b5f4a);">Ưu tiên</span>
              <div style="display:flex;gap:0.4rem;margin-top:0.3rem;" id="qc-priority-group">
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="qc-priority" value="1" style="display:none" />
                  <div class="priority-opt" style="text-align:center;padding:0.3rem;font-size:0.7rem;
                       font-weight:500;border:1px solid #8a9a5b;color:#8a9a5b;border-radius:2px;">Thấp</div>
                </label>
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="qc-priority" value="2" style="display:none" checked />
                  <div class="priority-opt" style="text-align:center;padding:0.3rem;font-size:0.7rem;
                       font-weight:500;border:2px solid #4a6fa5;color:#4a6fa5;background:rgba(74,111,165,0.08);border-radius:2px;">TB</div>
                </label>
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="qc-priority" value="3" style="display:none" />
                  <div class="priority-opt" style="text-align:center;padding:0.3rem;font-size:0.7rem;
                       font-weight:500;border:1px solid #c97b3c;color:#c97b3c;border-radius:2px;">Cao</div>
                </label>
                <label style="flex:1;cursor:pointer">
                  <input type="radio" name="qc-priority" value="4" style="display:none" />
                  <div class="priority-opt" style="text-align:center;padding:0.3rem;font-size:0.7rem;
                       font-weight:500;border:1px solid #a83232;color:#a83232;border-radius:2px;">Khẩn</div>
                </label>
              </div>
            </div>

            <!-- Duration -->
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <span style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.65rem;
                           font-weight:500;letter-spacing:0.1em;text-transform:uppercase;
                           color:var(--np-text-muted,#6b5f4a);flex-shrink:0;">Thời gian</span>
              <input type="range" id="qc-duration" value="60" min="15" max="480" step="15"
                style="flex:1;accent-color:var(--np-accent,#8b0000);" />
              <span id="qc-duration-label" style="font-family:var(--np-font-ui,'Inter',sans-serif);
                    font-size:0.75rem;font-weight:600;color:var(--np-accent,#8b0000);min-width:50px;
                    text-align:right;">60 phút</span>
            </div>

            <!-- Fixed time toggle -->
            <div>
              <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                <input type="checkbox" id="qc-fixed" style="accent-color:var(--np-accent,#8b0000);" />
                <span style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.75rem;
                             color:var(--np-text,#1a1a1a);">Thời gian cố định</span>
              </label>
              <div id="qc-fixed-times" style="display:none;margin-top:0.4rem;gap:0.5rem;align-items:center;">
                <input type="time" id="qc-fixed-start" style="font-size:0.8rem;padding:0.25rem;
                       border:1px solid var(--np-border-muted,#c8b99a);background:transparent;
                       color:var(--np-text,#1a1a1a);border-radius:2px;" />
                <span style="color:var(--np-text-muted,#6b5f4a);font-size:0.8rem;">—</span>
                <input type="time" id="qc-fixed-end" style="font-size:0.8rem;padding:0.25rem;
                       border:1px solid var(--np-border-muted,#c8b99a);background:transparent;
                       color:var(--np-text,#1a1a1a);border-radius:2px;" />
              </div>
            </div>

            <!-- Category -->
            <div>
              <span style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.65rem;
                           font-weight:500;letter-spacing:0.1em;text-transform:uppercase;
                           color:var(--np-text-muted,#6b5f4a);">Danh mục</span>
              <div id="qc-category-chips" style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.3rem;min-height:24px;">
                <span style="font-size:0.7rem;color:var(--np-text-muted,#6b5f4a);font-style:italic;">Đang tải...</span>
              </div>
              <input type="hidden" id="qc-category" value="" />
            </div>
          </div>

          <!-- Footer -->
          <div style="padding:0.75rem 1rem;border-top:1px solid var(--np-border-muted,#c8b99a);
                      display:flex;gap:0.5rem;">
            <button id="closeQuickCreate2" style="flex:1;padding:0.5rem;border:1.5px solid var(--np-border,#1a1a1a);
                    background:transparent;color:var(--np-text,#1a1a1a);cursor:pointer;border-radius:2px;
                    font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.8rem;font-weight:500;
                    letter-spacing:0.05em;text-transform:uppercase;">Hủy</button>
            <button id="saveQuickCreate" style="flex:1;padding:0.5rem;border:1.5px solid var(--np-accent,#8b0000);
                    background:var(--np-accent,#8b0000);color:#fff;cursor:pointer;border-radius:2px;
                    font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.8rem;font-weight:500;
                    letter-spacing:0.05em;text-transform:uppercase;box-shadow:var(--np-shadow-sm,2px 2px 0 #1a1a1a);">
              Tạo công việc
            </button>
          </div>
        </div>
      </div>`;

      document.body.insertAdjacentHTML("beforeend", html);

      // Fixed time toggle
      const fixedCb = document.getElementById("qc-fixed");
      const fixedTimes = document.getElementById("qc-fixed-times");
      if (fixedCb && fixedTimes) {
        fixedCb.addEventListener("change", () => {
          fixedTimes.style.display = fixedCb.checked ? "flex" : "none";
        });
      }

      // Priority selector — newspaper colors
      const priorityColors = { "1":"#8a9a5b","2":"#4a6fa5","3":"#c97b3c","4":"#a83232" };
      document.querySelectorAll("#qc-priority-group input[type=radio]").forEach(radio => {
        radio.addEventListener("change", () => {
          document.querySelectorAll("#qc-priority-group .priority-opt").forEach(opt => {
            opt.style.borderWidth = "1px";
            opt.style.background = "transparent";
          });
          const opt = radio.closest("label").querySelector(".priority-opt");
          const c = priorityColors[radio.value] || "#4a6fa5";
          opt.style.borderWidth = "2px";
          opt.style.borderColor = c;
          opt.style.background = c + "14";
        });
      });

      // Load categories as chips
      Utils.makeRequest("/api/categories", "GET").then(res => {
        const chips = document.getElementById("qc-category-chips");
        const hidden = document.getElementById("qc-category");
        if (!chips || !res.success || !res.data?.length) {
          if (chips) chips.innerHTML = '<span class="text-xs text-gray-400 italic">Không có danh mục</span>';
          return;
        }
        chips.innerHTML = "";
        res.data.forEach((c, i) => {
          const id = c.MaLoai || c.id;
          const name = c.TenLoai || c.name || "Không tên";
          const chip = document.createElement("button");
          chip.type = "button";
          chip.dataset.catId = id;
          chip.style.cssText = "padding:0.15rem 0.5rem;font-size:0.7rem;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;border:1px solid var(--np-border-muted,#c8b99a);border-radius:2px;background:transparent;color:var(--np-text-muted,#6b5f4a);cursor:pointer;font-family:var(--np-font-ui,'Inter',sans-serif);transition:all 0.12s;";
          chip.textContent = name;
          chip.onclick = () => {
            chips.querySelectorAll("button").forEach(b => {
              b.style.background = "transparent";
              b.style.borderColor = "var(--np-border-muted,#c8b99a)";
              b.style.color = "var(--np-text-muted,#6b5f4a)";
            });
            if (hidden.value === String(id)) {
              hidden.value = "";
            } else {
              hidden.value = id;
              chip.style.background = "var(--np-accent,#8b0000)";
              chip.style.borderColor = "var(--np-accent,#8b0000)";
              chip.style.color = "#fff";
            }
          };
          chips.appendChild(chip);
        });
      }).catch(() => {
        const chips = document.getElementById("qc-category-chips");
        if (chips) chips.innerHTML = '<span class="text-xs text-gray-400 italic">Không tải được danh mục</span>';
      });

      // Duration slider
      const durSlider = document.getElementById("qc-duration");
      const durLabel = document.getElementById("qc-duration-label");
      if (durSlider && durLabel) {
        durSlider.addEventListener("input", () => { durLabel.textContent = durSlider.value + " phút"; });
      }

      const close = () => document.getElementById("quickCreateModal")?.remove();
      document.getElementById("closeQuickCreate").onclick = close;
      document.getElementById("closeQuickCreate2").onclick = close;
      document.getElementById("quickCreateModal").addEventListener("click", e => { if (e.target.id === "quickCreateModal") close(); });

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
        btn.innerHTML = '... Đang tạo...';

        try {
          // Build task data with optional fixed time
          const isFixed = document.getElementById("qc-fixed")?.checked || false;
          const taskData = {
            TieuDe: title,
            MoTa: note,
            MucDoUuTien: priority,
            ThoiGianUocTinh: duration,
            ...(categoryId ? { MaLoai: categoryId } : {}),
            TrangThaiThucHien: 1,
          };
          if (isFixed) {
            taskData.CoThoiGianCoDinh = true;
            const fixedStart = document.getElementById("qc-fixed-start")?.value;
            const fixedEnd = document.getElementById("qc-fixed-end")?.value;
            if (fixedStart) {
              const d = new Date(startISO);
              const [h, m] = fixedStart.split(":");
              d.setHours(parseInt(h), parseInt(m), 0, 0);
              taskData.GioBatDauCoDinh = d.toISOString();
            }
            if (fixedEnd) {
              const d = new Date(startISO);
              const [h, m] = fixedEnd.split(":");
              d.setHours(parseInt(h), parseInt(m), 0, 0);
              taskData.GioKetThucCoDinh = d.toISOString();
            }
          }

          const taskRes = await Utils.makeRequest("/api/tasks", "POST", taskData);
          if (!taskRes.success) throw new Error(taskRes.message || "Lỗi tạo công việc");

          const taskId = taskRes.data?.MaCongViec || taskRes.data?.id || taskRes.taskId;

          // 2. Tạo lịch trình
          const startDate = new Date(startISO);
          const endDate = new Date(endISO);
          const eventRes = await Utils.makeRequest("/api/calendar/events", "POST", {
            MaCongViec: taskId,
            TieuDe: title,
            GioBatDau: startDate.toISOString(),
            GioKetThuc: endDate.toISOString(),
            MauSac: color,
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
            start: startDate,
            end: endDate,
            backgroundColor: color,
            borderColor: color,
            extendedProps: { note, completed: false, taskId, priority },
          });

          close();
          Utils.showToast?.("Đã tạo công việc thành công!", "success");
          this.triggerSidebarRefresh();
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = 'Tạo công việc';
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

      const priorityColors = { 1:"#34d399", 2:"#60a5fa", 3:"#fbbf24", 4:"#f87171" };
      const priorityTexts = { 1:"Thấp", 2:"Trung bình", 3:"Cao", 4:"Rất cao" };
      const pri = p.priority || 2;
      const dotColor = priorityColors[pri] || "#60a5fa";

      const canComplete = !isFuture || p.completed;
      const completeDisabledAttr = canComplete ? "" : "disabled";
      const completeTitle = isFuture ? "Chưa đến thời gian làm việc" : "";

      const endTimeStr = event.end ? event.end.toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}) : "";
      const npPriorityColors = { 1:"#8a9a5b", 2:"#4a6fa5", 3:"#c97b3c", 4:"#a83232" };
      const npPriColor = npPriorityColors[pri] || "#4a6fa5";

      const modalHtml = `
    <div class="fixed inset-0 flex items-center justify-center z-[9998]" id="eventDetailModal"
         style="background:rgba(0,0,0,0.5)">
      <div style="background:var(--np-bg-card,#faf7f2);border:1.5px solid var(--np-border,#1a1a1a);
                  border-radius:var(--np-radius,2px);box-shadow:var(--np-shadow,4px 4px 0 #1a1a1a);
                  width:100%;max-width:420px;margin:0 1rem;max-height:90vh;overflow-y:auto;">

        <!-- Header -->
        <div style="padding:0.75rem 1rem;border-bottom:2px solid var(--np-border,#1a1a1a);
                    display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span style="width:10px;height:10px;border-radius:50%;background:${npPriColor};flex-shrink:0;"></span>
            <h3 style="font-family:var(--np-font-heading,'Playfair Display',serif);font-size:1.1rem;
                       font-weight:700;color:var(--np-text,#1a1a1a);margin:0;overflow:hidden;
                       text-overflow:ellipsis;white-space:nowrap;">${event.title}</h3>
          </div>
          <button id="closeEventDetail" style="background:none;border:none;cursor:pointer;
                  font-size:1.2rem;color:var(--np-text-muted,#6b5f4a);flex-shrink:0;">&times;</button>
        </div>

        <!-- Body -->
        <div style="padding:1rem;display:flex;flex-direction:column;gap:0.75rem;">
          <!-- Time info -->
          <div style="padding:0.5rem 0;border-bottom:1px solid var(--np-border-muted,#c8b99a);">
            <div style="font-family:var(--np-font-body,'Merriweather',serif);font-size:0.85rem;
                        color:var(--np-text,#1a1a1a);font-weight:600;">${dateStr}</div>
            <div style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.8rem;
                        color:var(--np-text-muted,#6b5f4a);margin-top:2px;">${timeStr} — ${endTimeStr}</div>
          </div>

          <!-- Priority -->
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.7rem;
                         font-weight:500;letter-spacing:0.08em;text-transform:uppercase;
                         color:var(--np-text-muted,#6b5f4a);">Ưu tiên:</span>
            <span style="font-size:0.75rem;font-weight:600;padding:0.15rem 0.5rem;
                         border:1px solid ${npPriColor};color:${npPriColor};border-radius:2px;">
              ${priorityTexts[pri]}</span>
          </div>

          <!-- Note -->
          <div>
            <label style="font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.65rem;
                          font-weight:500;letter-spacing:0.1em;text-transform:uppercase;
                          color:var(--np-text-muted,#6b5f4a);display:block;margin-bottom:0.25rem;">Ghi chú</label>
            <textarea id="eventNoteInput" rows="2" placeholder="Thêm ghi chú..."
              style="width:100%;padding:0.4rem 0.25rem;border:none;
                     border-bottom:1.5px solid var(--np-border-muted,#c8b99a);
                     background:transparent;color:var(--np-text,#1a1a1a);
                     font-family:var(--np-font-body,'Merriweather',serif);font-size:0.85rem;
                     outline:none;resize:none;">${p.note || ""}</textarea>
          </div>

          <!-- Complete toggle -->
          <label style="display:flex;align-items:center;gap:8px;cursor:${canComplete ? "pointer" : "not-allowed"};
                        padding:0.5rem;border:1px solid var(--np-border-muted,#c8b99a);border-radius:2px;
                        background:${p.completed ? "rgba(138,154,91,0.1)" : "transparent"};">
            <input type="checkbox" id="eventCompletedCheckbox"
                   style="accent-color:var(--np-accent,#8b0000);width:16px;height:16px;"
                   ${p.completed ? "checked" : ""} ${completeDisabledAttr} title="${completeTitle}" />
            <span style="font-family:var(--np-font-body,'Merriweather',serif);font-size:0.85rem;
                         font-weight:600;color:var(--np-text,#1a1a1a);">
              ${p.completed ? "Đã hoàn thành" : "Đánh dấu hoàn thành"}</span>
          </label>
        </div>

        <!-- Footer -->
        <div style="padding:0.75rem 1rem;border-top:1px solid var(--np-border-muted,#c8b99a);
                    display:flex;gap:0.5rem;">
          <button id="saveEventStatus" style="flex:1;padding:0.5rem;
                  border:1.5px solid var(--np-accent,#8b0000);background:var(--np-accent,#8b0000);
                  color:#fff;cursor:pointer;border-radius:2px;font-family:var(--np-font-ui,'Inter',sans-serif);
                  font-size:0.8rem;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;
                  box-shadow:var(--np-shadow-sm,2px 2px 0 #1a1a1a);">Lưu</button>
          <button id="deleteEventBtn" style="padding:0.5rem 1rem;
                  border:1.5px solid var(--np-accent,#8b0000);background:transparent;
                  color:var(--np-accent,#8b0000);cursor:pointer;border-radius:2px;
                  font-family:var(--np-font-ui,'Inter',sans-serif);font-size:0.8rem;font-weight:500;
                  letter-spacing:0.05em;text-transform:uppercase;">Xóa</button>
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
    },

    async _deleteEvent(event) {
      const rawId = event.id;

      if (!rawId || rawId.toString().startsWith("temp-") || rawId.toString().startsWith("evt-")) {
        Utils.showToast?.("Sự kiện chưa được lưu vào database", "warning");
        document.getElementById("eventDetailModal")?.remove();
        event.remove();
        return;
      }

      // Strip "lt_" prefix from LichTrinh IDs
      const eventId = String(rawId).startsWith("lt_") ? rawId.slice(3) : rawId;

      try {
        // Disable delete button if it exists
        const deleteBtn = document.getElementById("deleteEventBtn");
        if (deleteBtn) {
          deleteBtn.textContent = "Đang xóa...";
          deleteBtn.disabled = true;
        }

        const result = await Utils.makeRequest(
          `/api/calendar/events/${eventId}`,
          "DELETE"
        );

        if (!result.success) {
          throw new Error(result.message || "Xóa sự kiện thất bại");
        }

        // Close modal
        document.getElementById("eventDetailModal")?.remove();

        // Remove event from calendar
        event.remove();

        Utils.showToast?.("Đã xóa sự kiện", "success");

        document.dispatchEvent(
          new CustomEvent("eventDeleted", {
            detail: { eventId, eventTitle: event.title },
          })
        );
      } catch (error) {
        console.error("Error deleting event:", error);

        const deleteBtn = document.getElementById("deleteEventBtn");
        if (deleteBtn) {
          deleteBtn.textContent = "Xóa";
          deleteBtn.disabled = false;
        }

        Utils.showToast?.(error.message || "Lỗi khi xóa sự kiện", "error");
      }
    },

    async _updateEventStatus(event) {
      try {


        const checkbox = document.getElementById("eventCompletedCheckbox");
        if (!checkbox) {
          console.error("❌ Checkbox not found");
          return;
        }

        const completed = checkbox.checked;


        const wasCompleted = event.extendedProps.completed;

        const saveBtn = document.getElementById("saveEventStatus");
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML =
          'Đang cập nhật...';
        const eventEls = document.querySelectorAll(
          `[data-event-id="${
            event.id
          }"], .fc-event[title*="${event.title.substring(0, 20)}"]`
        );
        // ✅ CHỈ TÌM EVENT CỤ THỂ THEO ID - KHÔNG DÙNG TITLE
        const eventEl = document.querySelector(`[data-event-id="${event.id}"]`);

        if (!eventEl) {
          console.warn(`⚠️ Could not find event element with ID ${event.id}`);
        } else {


          // Apply visual changes immediately
          if (completed) {
            eventEl.classList.add("event-completed", "completing");
            eventEl.style.textDecoration = "line-through";
            eventEl.style.opacity = "0.6";
          } else {
            eventEl.classList.remove("event-completed", "completing");
            eventEl.style.textDecoration = "none";
            eventEl.style.opacity = "1";
          }
        }

        // Include note from textarea
        const noteInput = document.getElementById("eventNoteInput");
        const note = noteInput ? noteInput.value.trim() : undefined;

        const updateData = { completed: completed };
        if (note !== undefined) updateData.note = note;

        // Strip lt_ prefix for LichTrinh IDs
        const evId = String(event.id).startsWith("lt_") ? event.id.slice(3) : event.id;

        const res = await Utils.makeRequest(
          `/api/calendar/events/${evId}`,
          "PUT",
          updateData
        );



        if (res.success) {
          event.setExtendedProp("completed", completed);
          if (note !== undefined) event.setExtendedProp("note", note);

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
                'Đã hoàn thành';
            } else {
              statusEl.className =
                "text-orange-600 font-semibold flex items-center gap-2";
              statusEl.innerHTML =
                'Chưa hoàn thành';
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
              el.style.textDecoration = "line-through";
              el.style.opacity = "0.6";
            } else {
              el.classList.remove("event-completed");
              el.style.textDecoration = "none";
              el.style.opacity = "1";
            }
          });

          saveBtn.disabled = false;
          saveBtn.innerHTML = originalBtnText;
          checkbox.checked = wasCompleted;

          throw new Error(res.message || "Cập nhật trạng thái thất bại");
        }
      } catch (err) {
        console.error("❌ Cập nhật trạng thái lỗi:", err);

        Utils.showToast?.(
          "" + (err.message || "Lỗi cập nhật trạng thái"),
          "error"
        );

        const saveBtn = document.getElementById("saveEventStatus");
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = 'Lưu thay đổi';
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
      const viewMap = {
        "timeGridDay": "cal-day-view",
        "timeGridWeek": "cal-week-view",
        "dayGridMonth": "cal-month-view",
      };
      ["cal-day-view", "cal-week-view", "cal-month-view"].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (viewMap[view] === id) {
          // Active: newspaper paper bg + dark border
          btn.style.background = "var(--np-bg-card, #faf7f2)";
          btn.style.color = "var(--np-text, #1a1a1a)";
          btn.style.boxShadow = "var(--np-shadow-sm, 2px 2px 0 #1a1a1a)";
        } else {
          btn.style.background = "transparent";
          btn.style.color = "var(--np-text-muted, #6b5f4a)";
          btn.style.boxShadow = "none";
        }
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
                &#8249;
              </button>
              <span class="text-sm font-bold text-gray-800">${monthNames[month]} ${year}</span>
              <button id="mini-next" class="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-800 transition">
                &#8250;
              </button>
            </div>
            <div class="grid grid-cols-7 gap-0.5 mb-1">
              ${days.map(d => `<div class="text-center text-xs font-semibold text-gray-400 py-1">${d}</div>`).join("")}
            </div>
            <div class="grid grid-cols-7 gap-0.5">${cells}</div>
            <button id="mini-today" class="mt-3 w-full text-xs text-blue-600 font-semibold hover:bg-blue-50 py-1.5 rounded-lg transition">
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

    // Methods referenced by AppNavigation
    async refreshEvents() {
      if (!this.calendar) return;
      this.calendar.removeAllEvents();
      const events = await this.loadEvents();
      events.forEach(ev => this.calendar.addEvent(ev));
    },

    refreshDragDrop() {
      this.setupDropZone();
      this.setupTaskDragListeners();
    },

    setupExternalDraggable() {
      this.initializeExternalDraggable();
    },

    setupNativeDragDrop() {
      this.setupDropZone();
    },
  };

  window.CalendarModule = CalendarModule;

})();
