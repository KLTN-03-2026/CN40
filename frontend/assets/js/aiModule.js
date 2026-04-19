(function () {
  "use strict";

  if (window.AIModule && window.AIModule._singleton) {
    console.log(" AIModule singleton already exists, reusing...");
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
        console.log("⏭️ Not in AI section, delaying initialization...");
        this.shouldInitWhenActivated = true;
        return;
      }

      if (this.isInitialized && this.calendar) {
        console.log(" AIModule already initialized, refreshing UI...");
        await this.refreshFromDatabase();
        this.refreshUI();
        return;
      }

      if (this.initPromise) {
        console.log(" Waiting for existing init promise...");
        return this.initPromise;
      }

      console.log(" Khởi tạo AIModule v2.1...");
      this.initPromise = this._initInternal();

      try {
        await this.initPromise;
        this.isInitialized = true;
        this.shouldInitWhenActivated = false;
        console.log(" AIModule khởi tạo thành công!");
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
            console.log("👀 Tab visible, refreshing AI calendar...");
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
              console.log("🎯 AI section became visible, initializing...");
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
        console.log(" Đang tải lịch AI từ database...");

        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return [];
        }

        console.log("📡 Gọi /api/ai/ai-events...");
        const res = await Utils.makeRequest("/api/ai/ai-events", "GET");

        console.log(" Response object keys:", Object.keys(res));
        console.log(" AI events response:", {
          success: res.success,
          count: res.data?.length || 0,
          data: res.data,
        });

        if (res.success && Array.isArray(res.data)) {
          const events = res.data;

          console.log(` Got ${events.length} AI events from API`);
          if (events.length === 0) {
            console.warn(
              " API returned 0 AI events - check if AI_DeXuat = 1 in database"
            );
            return [];
          }

          const calendarEvents = events.map((ev, idx) => {
            const color =
              ev.Color || this.getPriorityColor(ev.priority) || "#8B5CF6";

            console.log(
              `   [${idx}] "${ev.TieuDe}" | ${ev.GioBatDau} | color: ${color}`
            );

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

          console.log(` Converted ${calendarEvents.length} AI events`);
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
        console.log(" Loading AI suggestions:", suggestions);

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

        console.log(
          `🗑️ Removing ${existingAIEvents.length} old AI events from calendar DOM...`
        );
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

        console.log(` Added ${addedCount} new AI suggestions with task titles`);
        return aiEvents;
      } catch (err) {
        console.error(" Error loading AI suggestions:", err);
        throw err;
      }
    },

    openAiSuggestionModal() {
      console.log(" Opening AI suggestion modal...");

      try {
        if (window.ModalManager && window.ModalManager.showModalById) {
          console.log(" Using ModalManager to show modal");
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
        console.log("🗑️ Clearing old AI suggestions from database...");

        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return false;
        }

        const res = await Utils.makeRequest(
          "/api/ai/clear-old-suggestions",
          "DELETE"
        );

        if (res.success) {
          console.log(` Cleared ${res.clearedCount || 0} old AI suggestions`);
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
        <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #EF4444; margin-bottom: 20px;"></i>
        <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Không thể tải dữ liệu</p>
        <p style="color: #666; margin-bottom: 20px;">${message}</p>
        <button class="btn btn-primary" onclick="AIModule.openAiSuggestionModal()" style="padding: 10px 20px; background: #3B82F6; color: white; border: none; border-radius: 8px; cursor: pointer;">
          <i class="fas fa-redo"></i>
          Thử lại
        </button>
      </div>
    `;
      }
    },

    closeModal() {
      console.log(" AIModule.closeModal() called");

      if (window.ModalManager && ModalManager.close) {
        ModalManager.close("aiSuggestionModal");
        console.log(" Modal closed via ModalManager");
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
          console.log(" Modal closed (fallback)");
        }
      }
    },

    async initAIModalContent() {
      try {
        console.log("🔄 Initializing AI modal content...");

        await this.waitForModalReady();

        if (window.AIHandler && window.AIHandler.populateAIModal) {
          console.log(" Calling AIHandler.populateAIModal...");
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
            console.log(" Modal and dependencies ready");
            resolve(true);
          } else if (attempts >= maxAttempts) {
            reject(new Error("Modal not ready after maximum attempts"));
          } else {
            console.log(` Waiting for modal... (${attempts}/${maxAttempts})`);
            setTimeout(check, 100);
          }
        };

        check();
      });
    },

    showAIModalFallback() {
      console.log("🔄 Using fallback method to show AI modal");

      const modalHtml = `
        <div class="modal active show" id="aiSuggestionModal" style="display: flex; z-index: 10001;">
          <div class="modal-overlay"></div>
          <div class="modal-content">
            <div class="ai-modal-content">
              <div class="ai-modal-header">
                <div class="modal-header-left">
                  <div class="modal-icon">
                    <i class="fas fa-robot"></i>
                  </div>
                  <div class="modal-title">
                    <h3> Trợ lý AI Lập Lịch</h3>
                    <p class="modal-subtitle">AI sẽ giúp bạn sắp xếp công việc thông minh</p>
                  </div>
                </div>
                <button class="modal-close" onclick="document.getElementById('aiSuggestionModal').remove()">
                  <i class="fas fa-times"></i>
                </button>
              </div>

              <div class="ai-modal-body">
                <div class="loading-state">
                  <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
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
        console.log("🔄 Updating existing AI calendar with new events");

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

      console.log("🆕 Creating new AI calendar");

      this.calendar = new FullCalendar.Calendar(containerEl, {
        headerToolbar: false,
        initialView: this.currentView,
        height: "100%",
        editable: false,
        selectable: false,
        events: events,
      });

      this.calendar.render();
      console.log(" AI Calendar rendered");
    },

    preserveCalendarOnNavigation() {
      console.log(" Setting up calendar preservation...");

      const originalNavigation = window.AppNavigation?.navigateToSection;

      if (originalNavigation) {
        window.AppNavigation.navigateToSection = function (sectionId) {
          console.log(
            `🧭 Navigating to ${sectionId}, preserving AI calendar...`
          );

          const currentSection = this.currentSection;
          if (currentSection === "ai-section" && sectionId !== "ai-section") {
            if (window.AIModule?.calendar) {
              window.AIModule.lastView = window.AIModule.currentView;
              window.AIModule.lastDate = window.AIModule.calendar?.getDate();
              console.log("💾 Saved AI calendar state:", {
                view: window.AIModule.lastView,
                date: window.AIModule.lastDate,
              });
            }
          }

          return originalNavigation.call(this, sectionId);
        };

        console.log(" Calendar preservation setup complete");
      }
    },

    handleEventClick(info) {
      const props = info.event.extendedProps;
      console.log("Event clicked:", info.event.title, props);

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
      console.log("🎯 Setting up AI button...");

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

        console.log(" AI button found, setting up listener...");

        const newBtn = btn.cloneNode(true);
        btn.parentNode?.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", (e) => {
          console.log("🖱️ AI button clicked!");
          e.preventDefault();
          e.stopPropagation();
          this.openAiSuggestionModal();
        });

        console.log(" AI button listener setup complete");
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
        console.log("CalendarModule đã được destroy");
      } else {
        console.log(" Không destroy AI calendar khi chuyển section");
      }
    },

    refresh() {
      if (this.calendar && this.isInitialized) {
        console.log(" Refreshing AI calendar...");
        this.refreshUI();
      } else {
        console.log(" AIModule not initialized, calling init()...");
        this.init();
      }
    },

    async refreshFromDatabase() {
      try {
        console.log("🔄 Refreshing AI calendar from database...");

        if (!this.calendar) {
          console.log("Calendar not ready, calling init()...");
          await this.init();
          return 0;
        }

        const aiEvents = await this.loadEventsForAI();

        console.log(` AI events loaded: ${aiEvents.length}`);
        console.log(" Detailed events:", aiEvents);

        if (aiEvents.length === 0) {
          console.log("📭 Không có AI events để hiển thị");

          const existingEvents = this.calendar.getEvents();
          const aiEventsToRemove = existingEvents.filter(
            (event) => event.extendedProps?.aiSuggested === true
          );

          if (aiEventsToRemove.length > 0) {
            console.log(
              `🗑️ Removing ${aiEventsToRemove.length} old AI events...`
            );
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

        console.log(`🗑️ Removing ${aiEventsToRemove.length} old AI events...`);
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
              console.log(`➕ Added AI event: ${event.title} (${event.id})`);
            } else {
              console.log(
                `⏭️ Event already exists: ${event.title} (${event.id})`
              );
            }
          } catch (error) {
            console.error(" Error adding AI event:", error, event);
          }
        });

        this.suggestedEvents = aiEvents;

        if (addedCount > 0) {
          this.calendar.render();
          console.log(` Added ${addedCount} AI events to calendar`);
        } else {
          console.log("📭 Không có AI events mới để thêm");
        }

        this.updateCalendarTitle();

        const allEvents = this.calendar.getEvents();
        const aiEventsCount = allEvents.filter(
          (e) => e.extendedProps?.aiSuggested
        ).length;
        console.log(
          ` Total events in calendar: ${allEvents.length}, AI events: ${aiEventsCount}`
        );

        return addedCount;
      } catch (error) {
        console.error(" Error refreshing from database:", error);
        return 0;
      }
    },

    async checkAndRestoreCalendar() {
      console.log(" Checking AI calendar state...");

      const calendarEl = document.getElementById(this.calendarElementId);
      if (!calendarEl) {
        console.error(" AI calendar element not found");
        return false;
      }

      if (!this.calendar) {
        console.log("🔄 AI calendar bị mất, restoring...");

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

        console.log(" AI calendar restored");
        return true;
      }

      console.log(" AI calendar is intact");
      return true;
    },

    setupSectionChangeHandler() {
      console.log(" Setting up section change handler for AI...");

      document.addEventListener("section-changed", (e) => {
        const sectionId = e.detail?.sectionId;
        const isAISection = sectionId === "ai-section" || sectionId === "ai";

        if (isAISection) {
          console.log("🎯 AI section activated, checking calendar...");
          this.handleAISectionActivated();
        } else {
          console.log(`📌 Switching to ${sectionId}, preserving AI calendar`);
          this.handleOtherSectionActivated();
        }
      });

      document.addEventListener("tab-shown", (e) => {
        if (
          e.detail?.tabId === "ai-calendar-tab" ||
          e.detail?.tabId === "ai-tab"
        ) {
          console.log("🔔 AI tab shown, refreshing...");
          setTimeout(() => {
            this.refreshFromDatabase();
          }, 300);
        }
      });
    },

    handleAISectionActivated() {
      console.log(" AI section activated");

      if (!this.calendar) {
        console.log(" AI calendar chưa được init, initializing...");
        setTimeout(() => {
          this.init();
        }, 100);
      } else {
        console.log("🔄 Refreshing existing AI calendar...");
        setTimeout(() => {
          this.refreshFromDatabase();
          this.refreshUI();
        }, 200);
      }
    },

    handleOtherSectionActivated() {
      console.log("📌 Other section activated, preserving AI calendar");

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
        console.log(" Loading AI suggestions from database...");

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

        console.log(` Loaded ${aiEvents.length} AI events from database`);
        return aiEvents;
      } catch (err) {
        console.error(" Load AI suggestions error:", err);
        return [];
      }
    },

    async loadAIEventsFromDatabase() {
      try {
        console.log(" Loading AI events from database (AI_DeXuat = 1)...");

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

        console.log(` Found ${aiEvents.length} AI events in database`);

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
        console.log("🧪 Testing AI event creation...");

        const testPayload = {
          MaCongViec: 5015,
          GioBatDau: new Date().toISOString(),
          GioKetThuc: new Date(Date.now() + 60 * 60000).toISOString(),
          GhiChu: "Test AI event",
          AI_DeXuat: true,
        };

        console.log("Test payload:", testPayload);

        const response = await Utils.makeRequest(
          "/api/calendar/events",
          "POST",
          testPayload
        );
        console.log("Test response:", response);

        return response;
      } catch (error) {
        console.error(" Test failed:", error);
        return { success: false, error: error.message };
      }
    },

    async saveAISuggestions(suggestions) {
      try {
        console.log(`💾 Saving ${suggestions.length} AI suggestions...`);

        if (window.AIHandler && window.AIHandler.saveAISuggestionsToDatabase) {
          const result = await AIHandler.saveAISuggestionsToDatabase(
            suggestions
          );
          console.log(" AI suggestions saved:", result);
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

      console.log(" Restoring AI calendar...");

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
      console.log("=== AI Module Debug ===");
      console.log("Calendar exists:", !!this.calendar);
      console.log(
        "Calendar element:",
        document.getElementById(this.calendarElementId)
      );
      console.log("Is initialized:", this.isInitialized);
      console.log("Suggested events count:", this.suggestedEvents.length);

      Utils.makeRequest("/api/ai/ai-events", "GET")
        .then((res) => {
          console.log("AI events API response:", res);
        })
        .catch((err) => {
          console.log("AI events API error:", err);
        });

      Utils.makeRequest("/api/calendar/ai-events", "GET")
        .then((res) => {
          console.log("Calendar AI events API response:", res);
        })
        .catch((err) => {
          console.log("Calendar AI events API error:", err);
        });
    },

    debugDatabaseAIEvents: async function () {
      try {
        console.log(" Debugging AI events in database...");

        const endpoints = [
          "/api/calendar/events",
          "/api/ai/ai-events",
          "/api/calendar/ai-events",
        ];

        for (const endpoint of endpoints) {
          try {
            const res = await Utils.makeRequest(endpoint, "GET");
            console.log(`📡 ${endpoint}:`, {
              success: res.success,
              count: Array.isArray(res.data) ? res.data.length : "N/A",
              data: Array.isArray(res.data) ? res.data.slice(0, 2) : res.data,
            });

            if (res.success && Array.isArray(res.data)) {
              const aiEvents = res.data.filter(
                (ev) =>
                  ev.AI_DeXuat === 1 ||
                  ev.AI_DeXuat === true ||
                  ev.extendedProps?.aiSuggested === true
              );
              console.log(`   AI events in response: ${aiEvents.length}`);

              if (aiEvents.length > 0) {
                console.log("   Sample AI event:", {
                  id: aiEvents[0].MaLichTrinh || aiEvents[0].ID,
                  title: aiEvents[0].TieuDe || aiEvents[0].title,
                  AI_DeXuat: aiEvents[0].AI_DeXuat,
                  start: aiEvents[0].GioBatDau || aiEvents[0].start,
                });
              }
            }
          } catch (err) {
            console.log(` ${endpoint} error:`, err.message);
          }
        }
      } catch (error) {
        console.error("Debug error:", error);
      }
    },
  };

  window.AIModule = AIModule;
  console.log(" AIModule v2.1 (Integrated with AIHandler) đã sẵn sàng!");
})();
