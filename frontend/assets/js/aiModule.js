(function () {
  "use strict";

  if (window.AIModule && window.AIModule._singleton) {

    return window.AIModule;
  }

  const AIModule = {
    _singleton: true,
    calendar: null,
    isInitialized: false,
    initPromise: null,
    currentView: "timeGridWeek",
    suggestedEvents: [],

    calendarElementId: "ai-calendar",
    titleElementId: "ai-calendar-title",
    prevBtnId: "ai-cal-prev-btn",
    nextBtnId: "ai-cal-next-btn",
    todayBtnId: "ai-cal-today-btn",
    dayBtnId: "ai-cal-day-view",
    weekBtnId: "ai-cal-week-view",
    monthBtnId: "ai-cal-month-view",

    async init() {
      const aiSection = document.getElementById("ai-section");
      const isAISectionActive =
        aiSection &&
        (aiSection.style.display !== "none" ||
          aiSection.classList.contains("active"));

      if (!isAISectionActive) {

        this.shouldInitWhenActivated = true;
        return;
      }

      if (this.isInitialized && this.calendar) {

        await this.refreshFromDatabase();
        this.refreshUI();
        return;
      }

      if (this.initPromise) {

        return this.initPromise;
      }


      this.initPromise = this._initInternal();

      try {
        await this.initPromise;
        this.isInitialized = true;
        this.shouldInitWhenActivated = false;

      } catch (err) {
        console.error(" AI Module initialization failed:", err);
        this.showError(err);
        this.isInitialized = false;
      } finally {
        this.initPromise = null;
      }
    },

    async _initInternal() {
      const calendarEl = await this.waitForElement(
        this.calendarElementId,
        8000
      );
      if (!calendarEl)
        throw new Error(`Không tìm thấy phần tử #${this.calendarElementId}`);

      await Promise.all([this.waitForFullCalendar(), this.waitForUtils()]);

      calendarEl.innerHTML = "";
      calendarEl.style.minHeight = "700px";

      const existingEvents = await this.loadEventsForAI();

      this.renderCalendar(existingEvents);

      this.setupSectionChangeHandler();
      this.preserveCalendarOnNavigation();
      this.setupVisibilityHandler();

      this.setupSectionChangeHandler();

      setTimeout(() => {
        this.initializeNavbarEvents();
        this.setupAIButton();
        this.updateCalendarTitle();
      }, 100);
    },

    setupVisibilityHandler() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const aiSection = document.getElementById("ai-section");
          if (aiSection && aiSection.style.display !== "none") {

            if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
            this.refreshTimeout = setTimeout(() => {
              this.refreshFromDatabase();
            }, 500);
          }
        }
      });

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "style" &&
            mutation.target.id === "ai-section"
          ) {
            const isVisible = mutation.target.style.display !== "none";
            if (isVisible && this.shouldInitWhenActivated) {

              this.init();
            }
          }
        });
      });

      const aiSection = document.getElementById("ai-section");
      if (aiSection) {
        observer.observe(aiSection, { attributes: true });
      }
    },

    async loadEventsForAI() {
      try {


        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return [];
        }


        const res = await Utils.makeRequest("/api/ai/ai-events", "GET");




        if (res.success && Array.isArray(res.data)) {
          const events = res.data;


          if (events.length === 0) {
            console.warn(
              " API returned 0 AI events - check if AI_DeXuat = 1 in database"
            );
            return [];
          }

          const calendarEvents = events.map((ev, idx) => {
            const color =
              ev.Color || this.getPriorityColor(ev.priority) || "#8B5CF6";



            return {
              id: ev.MaLichTrinh || `ai-${Date.now()}-${Math.random()}`,
              title: ev.TieuDe || "AI Đề xuất",
              start: ev.GioBatDau,
              end:
                ev.GioKetThuc ||
                new Date(
                  new Date(ev.GioBatDau).getTime() + 60 * 60000
                ).toISOString(),
              backgroundColor: color,
              borderColor: color,
              classNames: ["event-ai-suggested"],
              extendedProps: {
                taskId: ev.MaCongViec,
                reason: ev.GhiChu || "Đề xuất bởi AI",
                aiSuggested: true,
                priority: ev.priority || 2,
                AI_DeXuat: ev.AI_DeXuat || 1,
                originalColor: color,
              },
            };
          });


          return calendarEvents;
        } else {
          console.warn(" Response not success or data not array:", res);
          return [];
        }
      } catch (error) {
        console.error(" Error loading AI events:", error);
        return [];
      }
    },

    getPriorityColor(priority) {
      const colors = {
        1: "#10B981",
        2: "#3B82F6",
        3: "#F59E0B",
        4: "#EF4444",
      };
      return colors[priority] || "#8B5CF6";
    },

    async loadAISuggestions(suggestions) {
      try {


        if (
          !suggestions ||
          !Array.isArray(suggestions) ||
          suggestions.length === 0
        ) {
          Utils.showToast?.("Không có đề xuất từ AI", "warning");
          return [];
        }

        if (!this.calendar) {
          console.error(" Calendar chưa được khởi tạo");
          throw new Error("Calendar chưa sẵn sàng");
        }

        const existingAIEvents = this.calendar
          .getEvents()
          .filter((event) => event.extendedProps?.aiSuggested === true);


        existingAIEvents.forEach((event) => {
          try {
            event.remove();
          } catch (e) {
            console.warn("Could not remove event:", e);
          }
        });

        const taskTitles = {};
        try {
          const res = await Utils.makeRequest("/api/tasks", "GET");
          if (res.success && Array.isArray(res.data)) {
            res.data.forEach((task) => {
              taskTitles[task.MaCongViec || task.ID || task.id] =
                task.TieuDe ||
                task.title ||
                `Công việc #${task.MaCongViec || task.ID}`;
            });
          }
        } catch (err) {
          console.warn(" Không thể lấy thông tin công việc:", err);
        }

        const aiEvents = suggestions.map((suggestion, index) => {
          const start = new Date(suggestion.scheduledTime);
          const end = new Date(
            start.getTime() + (suggestion.durationMinutes || 60) * 60000
          );

          const taskTitle =
            taskTitles[suggestion.taskId] ||
            suggestion.taskTitle ||
            `Công việc #${suggestion.taskId || index}`;

          return {
            id: `ai-suggestion-${suggestion.taskId || index}-${Date.now()}`,
            title: taskTitle,
            start: start.toISOString(),
            end: end.toISOString(),
            backgroundColor: suggestion.color || "#8B5CF6",
            borderColor: suggestion.color || "#7c3aed",
            classNames: ["event-ai-suggested"],
            extendedProps: {
              taskId: suggestion.taskId,
              taskTitle: taskTitle,
              reason: suggestion.reason || "AI đề xuất",
              aiSuggested: true,
              durationMinutes: suggestion.durationMinutes || 60,
              priority: suggestion.priority || "medium",
              isAISuggestion: true,
            },
          };
        });

        let addedCount = 0;
        aiEvents.forEach((event) => {
          try {
            this.calendar.addEvent(event);
            addedCount++;
          } catch (error) {
            console.error(" Error adding event:", event.title, error);
          }
        });

        this.calendar.render();


        return aiEvents;
      } catch (err) {
        console.error(" Error loading AI suggestions:", err);
        throw err;
      }
    },

    openAiSuggestionModal() {


      try {
        if (window.ModalManager && window.ModalManager.showModalById) {

          window.ModalManager.showModalById("aiSuggestionModal");
        } else {
          console.warn(" ModalManager not available, showing fallback");
          const modal = document.getElementById("aiSuggestionModal");
          if (modal) {
            modal.classList.remove("hidden");
            modal.classList.add("active", "show");
            document.body.style.overflow = "hidden";
          }
        }
      } catch (error) {
        console.error(" Error opening modal:", error);
        alert("Lỗi mở modal: " + error.message);
      }
    },

    async clearOldAISuggestions() {
      try {


        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return false;
        }

        const res = await Utils.makeRequest(
          "/api/ai/clear-old-suggestions",
          "DELETE"
        );

        if (res.success) {

          return true;
        } else {
          console.warn(" Could not clear old AI suggestions:", res.message);
          return false;
        }
      } catch (error) {
        console.error(" Error clearing old AI suggestions:", error);
        return false;
      }
    },

    showModalError(message) {
      const modalBody = document.querySelector(
        "#aiSuggestionModal .ai-modal-body"
      );
      if (modalBody) {
        modalBody.innerHTML = `
      <div class="error-state" style="text-align: center; padding: 40px;">
        <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Không thể tải dữ liệu</p>
        <p style="color: #666; margin-bottom: 20px;">${message}</p>
        <button class="btn btn-primary" onclick="AIModule.openAiSuggestionModal()" style="padding: 10px 20px; background: #3B82F6; color: white; border: none; border-radius: 8px; cursor: pointer;">
          Thử lại
        </button>
      </div>
    `;
      }
    },

    closeModal() {


      if (window.ModalManager && ModalManager.close) {
        ModalManager.close("aiSuggestionModal");

      } else {
        console.warn(" ModalManager not available, using fallback");
        const modal = document.getElementById("aiSuggestionModal");
        if (modal) {
          modal.classList.remove("active", "show");
          modal.classList.add("hidden");
          modal.style.display = "";
          modal.style.opacity = "";
          modal.style.visibility = "";
          document.body.classList.remove("modal-open");

        }
      }
    },

    async initAIModalContent() {
      try {


        await this.waitForModalReady();

        if (window.AIHandler && window.AIHandler.populateAIModal) {

          await AIHandler.populateAIModal();
        } else {
          console.warn(
            " AIHandler not available or missing populateAIModal method"
          );
          this.showModalError("AIHandler không khả dụng");
        }
      } catch (error) {
        console.error(" Error initializing AI modal:", error);
        this.showModalError(error.message);
      }
    },

    async waitForModalReady() {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 20;

        const check = () => {
          attempts++;

          const modal = document.getElementById("aiSuggestionModal");
          const taskList = modal?.querySelector(".task-list");

          if (modal && taskList && window.AIHandler) {

            resolve(true);
          } else if (attempts >= maxAttempts) {
            reject(new Error("Modal not ready after maximum attempts"));
          } else {

            setTimeout(check, 100);
          }
        };

        check();
      });
    },

    showAIModalFallback() {


      const modalHtml = `
        <div class="modal active show" id="aiSuggestionModal" style="display: flex; z-index: 10001;">
          <div class="modal-overlay"></div>
          <div class="modal-content">
            <div class="ai-modal-content">
              <div class="ai-modal-header">
                <div class="modal-header-left">
                  <div class="modal-icon">
                    &#129302;
                  </div>
                  <div class="modal-title">
                    <h3> Trợ lý AI Lập Lịch</h3>
                    <p class="modal-subtitle">AI sẽ giúp bạn sắp xếp công việc thông minh</p>
                  </div>
                </div>
                <button class="modal-close" onclick="document.getElementById('aiSuggestionModal').remove()">
                  &#x2715;
                </button>
              </div>

              <div class="ai-modal-body">
                <div class="loading-state">
                  <div class="loading-spinner">
                    <!-- spinner via CSS animation on .loading-spinner element -->
                  </div>
                  <p>Đang tải danh sách công việc...</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      document.getElementById("aiSuggestionModal")?.remove();

      document.body.insertAdjacentHTML("beforeend", modalHtml);
      document.body.classList.add("modal-open");

      setTimeout(() => {
        if (window.AIHandler && window.AIHandler.populateAIModal) {
          AIHandler.populateAIModal();
        }
      }, 300);
    },

    refreshUI() {
      if (this.calendar) {
        this.calendar.render();
        this.updateCalendarTitle();
        this.initializeNavbarEvents();
        this.setActiveView(this.currentView);
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

    waitForUtils(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (typeof Utils !== "undefined") return resolve();

        const start = Date.now();
        const check = () => {
          if (typeof Utils !== "undefined") resolve();
          else if (Date.now() - start > timeout)
            reject(new Error("Utils timeout"));
          else setTimeout(check, 100);
        };
        check();
      });
    },

    showError(error) {
      const el = document.getElementById(this.calendarElementId);
      if (!el) return;

      el.innerHTML = `
        <div class="flex items-center justify-center h-96">
          <div class="text-center p-10 bg-red-50 rounded-xl">
            <div class="text-6xl mb-4"></div>
            <h3 class="text-2xl font-bold text-red-700 mb-3">Không tải được lịch AI</h3>
            <p class="text-gray-600 mb-6">${error.message || error}</p>
            <button onclick="location.reload()" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              Tải lại trang
            </button>
          </div>
        </div>
      `;
    },

    renderCalendar(events) {
      const containerEl = document.getElementById(this.calendarElementId);

      if (!containerEl) {
        console.error(" AI calendar container not found");
        return;
      }

      if (this.calendar) {


        const existingEvents = this.calendar.getEvents();
        existingEvents.forEach((event) => {
          try {
            event.remove();
          } catch (e) {}
        });

        events.forEach((event) => {
          try {
            this.calendar.addEvent(event);
          } catch (error) {
            console.error("Error adding event:", error);
          }
        });

        this.calendar.render();
        return;
      }



      this.calendar = new FullCalendar.Calendar(containerEl, {
        headerToolbar: false,
        initialView: this.currentView,
        height: "100%",
        editable: false,
        selectable: false,
        events: events,
      });

      this.calendar.render();

    },

    preserveCalendarOnNavigation() {


      const originalNavigation = window.AppNavigation?.navigateToSection;

      if (originalNavigation) {
        window.AppNavigation.navigateToSection = function (sectionId) {


          const currentSection = this.currentSection;
          if (currentSection === "ai-section" && sectionId !== "ai-section") {
            if (window.AIModule?.calendar) {
              window.AIModule.lastView = window.AIModule.currentView;
              window.AIModule.lastDate = window.AIModule.calendar?.getDate();

            }
          }

          return originalNavigation.call(this, sectionId);
        };


      }
    },

    handleEventClick(info) {
      const props = info.event.extendedProps;


      const isAI = props.aiSuggested;
      const modalTitle = isAI ? " Sự kiện do AI đề xuất" : " Sự kiện";

      const startTime = new Date(info.event.start).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const endTime = new Date(info.event.end).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (window.Utils && Utils.showToast) {
        Utils.showToast(
          `${modalTitle}\n${info.event.title}\n${startTime} - ${endTime}\n${
            props.reason || props.note || ""
          }`,
          "info"
        );
      }
    },

    setupAIButton() {


      const trySetup = (attempt = 1) => {
        const btn = document.getElementById("ai-suggest-btn");

        if (!btn) {
          if (attempt < 5) {
            console.warn(
              ` AI button not found yet (attempt ${attempt}/5), retrying in 200ms...`
            );
            setTimeout(() => trySetup(attempt + 1), 200);
          } else {
            console.error(" AI button not found after 5 attempts");
          }
          return;
        }



        const newBtn = btn.cloneNode(true);
        btn.parentNode?.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", (e) => {

          e.preventDefault();
          e.stopPropagation();
          this.openAiSuggestionModal();
        });


      };

      trySetup();
    },

    changeView(view) {
      this.currentView = view;
      if (this.calendar) {
        this.calendar.changeView(view);
        this.updateCalendarTitle();
        this.setActiveView(view);
      }
    },

    setActiveView(view) {
      [this.dayBtnId, this.weekBtnId, this.monthBtnId].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        const isActive =
          (view === "timeGridDay" && id === this.dayBtnId) ||
          (view === "timeGridWeek" && id === this.weekBtnId) ||
          (view === "dayGridMonth" && id === this.monthBtnId);

        if (isActive) {
          btn.classList.add("bg-white", "text-gray-900", "shadow-sm");
          btn.classList.remove("text-gray-700", "hover:bg-white");
        } else {
          btn.classList.remove("bg-white", "text-gray-900", "shadow-sm");
          btn.classList.add("text-gray-700", "hover:bg-white");
        }
      });
    },

    updateCalendarTitle() {
      const titleEl = document.getElementById(this.titleElementId);
      if (titleEl && this.calendar) {
        titleEl.textContent = this.calendar.view.title;
      }
    },

    initializeNavbarEvents() {
      const controls = {
        [this.prevBtnId]: () => {
          this.calendar.prev();
          this.updateCalendarTitle();
        },
        [this.nextBtnId]: () => {
          this.calendar.next();
          this.updateCalendarTitle();
        },
        [this.todayBtnId]: () => {
          this.calendar.today();
          this.updateCalendarTitle();
        },
        [this.dayBtnId]: () => this.changeView("timeGridDay"),
        [this.weekBtnId]: () => this.changeView("timeGridWeek"),
        [this.monthBtnId]: () => this.changeView("dayGridMonth"),
      };

      Object.entries(controls).forEach(([id, handler]) => {
        const btn = document.getElementById(id);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", (e) => {
            e.preventDefault();
            handler();
          });
        }
      });

      this.setActiveView(this.currentView);
    },

    destroy() {
      const isAICalendar =
        this.calendarElementId && this.calendarElementId.includes("ai");

      if (!isAICalendar) {
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

      } else {

      }
    },

    refresh() {
      if (this.calendar && this.isInitialized) {

        this.refreshUI();
      } else {

        this.init();
      }
    },

    async refreshFromDatabase() {
      try {


        if (!this.calendar) {

          await this.init();
          return 0;
        }

        const aiEvents = await this.loadEventsForAI();




        if (aiEvents.length === 0) {


          const existingEvents = this.calendar.getEvents();
          const aiEventsToRemove = existingEvents.filter(
            (event) => event.extendedProps?.aiSuggested === true
          );

          if (aiEventsToRemove.length > 0) {

            aiEventsToRemove.forEach((event) => {
              try {
                event.remove();
              } catch (e) {
                console.warn(` Failed to remove event ${event.id}:`, e.message);
              }
            });
            this.calendar.render();
          }

          return 0;
        }

        const existingEvents = this.calendar.getEvents();
        const aiEventsToRemove = existingEvents.filter(
          (event) => event.extendedProps?.aiSuggested === true
        );


        aiEventsToRemove.forEach((event) => {
          try {
            event.remove();
          } catch (e) {
            console.warn(` Failed to remove event ${event.id}:`, e.message);
          }
        });

        let addedCount = 0;
        aiEvents.forEach((event) => {
          try {
            const existingEvent = this.calendar.getEventById(event.id);
            if (!existingEvent) {
              this.calendar.addEvent(event);
              addedCount++;

            } else {

            }
          } catch (error) {
            console.error(" Error adding AI event:", error, event);
          }
        });

        this.suggestedEvents = aiEvents;

        if (addedCount > 0) {
          this.calendar.render();

        } else {

        }

        this.updateCalendarTitle();

        const allEvents = this.calendar.getEvents();
        const aiEventsCount = allEvents.filter(
          (e) => e.extendedProps?.aiSuggested
        ).length;


        return addedCount;
      } catch (error) {
        console.error(" Error refreshing from database:", error);
        return 0;
      }
    },

    async checkAndRestoreCalendar() {


      const calendarEl = document.getElementById(this.calendarElementId);
      if (!calendarEl) {
        console.error(" AI calendar element not found");
        return false;
      }

      if (!this.calendar) {


        const events = await this.loadEventsForAI();

        this.renderCalendar(events);

        if (this.lastView) {
          setTimeout(() => {
            this.changeView(this.lastView);
          }, 100);
        }

        if (this.lastDate && this.calendar) {
          setTimeout(() => {
            this.calendar.gotoDate(this.lastDate);
          }, 150);
        }


        return true;
      }


      return true;
    },

    setupSectionChangeHandler() {


      document.addEventListener("section-changed", (e) => {
        const sectionId = e.detail?.sectionId;
        const isAISection = sectionId === "ai-section" || sectionId === "ai";

        if (isAISection) {

          this.handleAISectionActivated();
        } else {

          this.handleOtherSectionActivated();
        }
      });

      document.addEventListener("tab-shown", (e) => {
        if (
          e.detail?.tabId === "ai-calendar-tab" ||
          e.detail?.tabId === "ai-tab"
        ) {

          setTimeout(() => {
            this.refreshFromDatabase();
          }, 300);
        }
      });
    },

    handleAISectionActivated() {


      if (!this.calendar) {

        setTimeout(() => {
          this.init();
        }, 100);
      } else {

        setTimeout(() => {
          this.refreshFromDatabase();
          this.refreshUI();
        }, 200);
      }
    },

    handleOtherSectionActivated() {


      if (this.calendar) {
        const calendarEl = document.getElementById(this.calendarElementId);
        if (calendarEl) {
          calendarEl.style.opacity = "0.95";
          calendarEl.style.pointerEvents = "none";
        }
      }
    },

    async loadAISuggestionsFromDB() {
      try {


        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return [];
        }

        const res = await Utils.makeRequest("/api/calendar/ai-events", "GET");

        if (!res.success || !Array.isArray(res.data)) return [];

        const aiEvents = res.data.map((ev) => ({
          id: ev.MaLichTrinh || ev.ID || `ai-${ev.taskId}-${Date.now()}`,
          title: ev.TieuDe || ev.title || `Công việc #${ev.taskId}`,
          start: ev.GioBatDau || ev.start,
          end: ev.GioKetThuc || ev.end,
          backgroundColor: ev.Color || ev.color || "#8B5CF6",
          borderColor: ev.Color || ev.color || "#7c3aed",
          classNames: ["event-ai-suggested"],
          extendedProps: {
            note: ev.GhiChu || ev.reason || "AI đề xuất",
            completed: ev.DaHoanThanh === 1,
            taskId: ev.MaCongViec || ev.taskId,
            aiSuggested: true,
            reason: ev.reason || "",
            durationMinutes: ev.durationMinutes || 60,
            priority: ev.priority || "medium",
            originalColor: ev.Color || ev.color,
          },
        }));


        return aiEvents;
      } catch (err) {
        console.error(" Load AI suggestions error:", err);
        return [];
      }
    },

    async loadAIEventsFromDatabase() {
      try {


        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return [];
        }

        const res = await Utils.makeRequest("/api/calendar/events", "GET");

        if (!res.success || !Array.isArray(res.data)) return [];

        const aiEvents = res.data.filter(
          (ev) =>
            ev.extendedProps?.aiSuggested === true ||
            ev.AI_DeXuat === true ||
            ev.isAISuggestion === true
        );



        const calendarEvents = aiEvents.map((ev) => {
          return {
            id: ev.MaLichTrinh || ev.ID || `ai-${Date.now()}-${Math.random()}`,
            title: ev.TieuDe || ev.title || "AI Đề xuất",
            start: ev.ThoiGianBatDau || ev.start,
            end: ev.ThoiGianKetThuc || ev.end,
            backgroundColor: ev.MaMau || ev.Color || "#8B5CF6",
            borderColor: ev.MaMau || ev.Color || "#7c3aed",
            classNames: ["event-ai-suggested"],
            extendedProps: {
              note: ev.GhiChu || ev.reason || "AI đề xuất",
              completed: ev.DaHoanThanh === 1,
              taskId: ev.MaCongViec || ev.taskId,
              aiSuggested: true,
              reason: ev.reason || "",
              durationMinutes: ev.durationMinutes || 60,
              priority: ev.priority || "medium",
              originalColor: ev.MaMau || ev.Color,
            },
          };
        });

        return calendarEvents;
      } catch (err) {
        console.error(" Error loading AI events from database:", err);
        return [];
      }
    },

    async testAIEventCreation() {
      try {


        const testPayload = {
          MaCongViec: 5015,
          GioBatDau: new Date().toISOString(),
          GioKetThuc: new Date(Date.now() + 60 * 60000).toISOString(),
          GhiChu: "Test AI event",
          AI_DeXuat: true,
        };



        const response = await Utils.makeRequest(
          "/api/calendar/events",
          "POST",
          testPayload
        );


        return response;
      } catch (error) {
        console.error(" Test failed:", error);
        return { success: false, error: error.message };
      }
    },

    async saveAISuggestions(suggestions) {
      try {


        if (window.AIHandler && window.AIHandler.saveAISuggestionsToDatabase) {
          const result = await AIHandler.saveAISuggestionsToDatabase(
            suggestions
          );

          return result;
        }

        console.warn(" AIHandler not available for saving suggestions");
        return { success: false, message: "AIHandler not available" };
      } catch (error) {
        console.error(" Error saving AI suggestions:", error);
        throw error;
      }
    },

    getCalendar() {
      return this.calendar;
    },

    restoreCalendar() {
      if (!this.calendar) return;



      const aiCalendar = document.getElementById(this.calendarElementId);
      if (aiCalendar) {
        aiCalendar.style.opacity = "1";
        aiCalendar.style.pointerEvents = "auto";
        aiCalendar.style.position = "relative";
        aiCalendar.style.left = "0";

        if (this.lastView && this.calendar.view.type !== this.lastView) {
          this.changeView(this.lastView);
        }

        if (this.lastDate) {
          this.calendar.gotoDate(this.lastDate);
        }

        this.refreshUI();
      }
    },

    debugAIModule: function () {






      Utils.makeRequest("/api/ai/ai-events", "GET")
        .then((res) => {

        })
        .catch((err) => {

        });

      Utils.makeRequest("/api/calendar/ai-events", "GET")
        .then((res) => {

        })
        .catch((err) => {

        });
    },

    debugDatabaseAIEvents: async function () {
      try {


        const endpoints = [
          "/api/calendar/events",
          "/api/ai/ai-events",
          "/api/calendar/ai-events",
        ];

        for (const endpoint of endpoints) {
          try {
            const res = await Utils.makeRequest(endpoint, "GET");


            if (res.success && Array.isArray(res.data)) {
              const aiEvents = res.data.filter(
                (ev) =>
                  ev.AI_DeXuat === 1 ||
                  ev.AI_DeXuat === true ||
                  ev.extendedProps?.aiSuggested === true
              );


              if (aiEvents.length > 0) {

              }
            }
          } catch (err) {

          }
        }
      } catch (error) {
        console.error("Debug error:", error);
      }
    },
  };

  window.AIModule = AIModule;

})();
