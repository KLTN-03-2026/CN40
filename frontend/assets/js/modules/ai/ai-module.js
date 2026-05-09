// ai-module.js — AIModule core: init, calendar lifecycle, section handling,
// public API (refresh, destroy, getCalendar).
// UI rendering helpers live in ai-module-render.js (loaded after this file).
(function () {
  "use strict";

  if (window.AIModule && window.AIModule._singleton) {
    console.log("AIModule singleton already exists, reusing...");
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
    titleElementId:    "ai-calendar-title",
    prevBtnId:         "ai-cal-prev-btn",
    nextBtnId:         "ai-cal-next-btn",
    todayBtnId:        "ai-cal-today-btn",
    dayBtnId:          "ai-cal-day-view",
    weekBtnId:         "ai-cal-week-view",
    monthBtnId:        "ai-cal-month-view",

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    async init() {
      const aiSection       = document.getElementById("ai-section");
      const isAISectionActive = aiSection && (aiSection.style.display !== "none" || aiSection.classList.contains("active"));

      if (!isAISectionActive) {
        this.shouldInitWhenActivated = true;
        return;
      }

      if (this.isInitialized && this.calendar) {
        await this.refreshFromDatabase();
        this.refreshUI();
        return;
      }

      if (this.initPromise) return this.initPromise;

      console.log("Khởi tạo AIModule v2.1...");
      this.initPromise = this._initInternal();
      try {
        await this.initPromise;
        this.isInitialized           = true;
        this.shouldInitWhenActivated = false;
        console.log("AIModule khởi tạo thành công!");
      } catch (err) {
        console.error("AI Module initialization failed:", err);
        this.showError(err);
        this.isInitialized = false;
      } finally {
        this.initPromise = null;
      }
    },

    async _initInternal() {
      const calendarEl = await this.waitForElement(this.calendarElementId, 8000);
      if (!calendarEl) throw new Error(`Không tìm thấy phần tử #${this.calendarElementId}`);

      await Promise.all([this.waitForFullCalendar(), this.waitForUtils()]);

      calendarEl.innerHTML    = "";
      calendarEl.style.minHeight = "700px";

      const existingEvents = await this.loadEventsForAI();
      this.renderCalendar(existingEvents);

      this.setupSectionChangeHandler();
      this.preserveCalendarOnNavigation();
      this.setupVisibilityHandler();

      setTimeout(() => {
        this.initializeNavbarEvents();
        this.setupAIButton();
        this.updateCalendarTitle();
      }, 100);
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

    waitForUtils(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (typeof Utils !== "undefined") return resolve();
        const start = Date.now();
        const check = () => {
          if (typeof Utils !== "undefined") resolve();
          else if (Date.now() - start > timeout) reject(new Error("Utils timeout"));
          else setTimeout(check, 100);
        };
        check();
      });
    },

    // ------------------------------------------------------------------
    // Event loading
    // ------------------------------------------------------------------

    async loadEventsForAI() {
      try {
        if (!Utils?.makeRequest) return [];
        const res = await Utils.makeRequest("/api/ai/ai-events", "GET");

        if (res.success && Array.isArray(res.data)) {
          if (res.data.length === 0) return [];
          return res.data.map((ev) => {
            const color = ev.Color || this.getPriorityColor(ev.priority) || "#2563EB";
            return {
              id:              ev.MaLichTrinh || `ai-${Date.now()}-${Math.random()}`,
              title:           ev.TieuDe || "AI Đề xuất",
              start:           ev.GioBatDau,
              end:             ev.GioKetThuc || new Date(new Date(ev.GioBatDau).getTime() + 60 * 60000).toISOString(),
              backgroundColor: color,
              borderColor:     color,
              classNames:      ["event-ai-suggested"],
              extendedProps: {
                taskId:       ev.MaCongViec,
                reason:       ev.GhiChu || "Đề xuất bởi AI",
                aiSuggested:  true,
                priority:     ev.priority || 2,
                AI_DeXuat:    ev.AI_DeXuat || 1,
                originalColor: color,
              },
            };
          });
        }
        return [];
      } catch (error) {
        console.error("Error loading AI events:", error);
        return [];
      }
    },

    async loadAISuggestions(suggestions) {
      if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
        Utils.showToast?.("Không có đề xuất từ AI", "warning");
        return [];
      }
      if (!this.calendar) throw new Error("Calendar chưa sẵn sàng");

      // Remove old AI events from DOM
      this.calendar.getEvents()
        .filter((e) => e.extendedProps?.aiSuggested)
        .forEach((e) => { try { e.remove(); } catch (_) {} });

      // Fetch task titles
      const taskTitles = {};
      try {
        const res = await Utils.makeRequest("/api/tasks", "GET");
        if (res.success && Array.isArray(res.data)) {
          res.data.forEach((task) => {
            taskTitles[task.MaCongViec || task.ID || task.id] =
              task.TieuDe || task.title || `Công việc #${task.MaCongViec || task.ID}`;
          });
        }
      } catch (_) {}

      const aiEvents = suggestions.map((suggestion, index) => {
        const start      = new Date(suggestion.scheduledTime);
        const end        = new Date(start.getTime() + (suggestion.durationMinutes || 60) * 60000);
        const taskTitle  = taskTitles[suggestion.taskId] || suggestion.taskTitle || `Công việc #${suggestion.taskId || index}`;
        return {
          id:              `ai-suggestion-${suggestion.taskId || index}-${Date.now()}`,
          title:           taskTitle,
          start:           start.toISOString(),
          end:             end.toISOString(),
          backgroundColor: suggestion.color || "#2563EB",
          borderColor:     suggestion.color || "#1d4ed8",
          classNames:      ["event-ai-suggested"],
          extendedProps: {
            taskId:          suggestion.taskId,
            taskTitle,
            reason:          suggestion.reason || "AI đề xuất",
            aiSuggested:     true,
            durationMinutes: suggestion.durationMinutes || 60,
            priority:        suggestion.priority || "medium",
            isAISuggestion:  true,
          },
        };
      });

      let addedCount = 0;
      aiEvents.forEach((event) => {
        try { this.calendar.addEvent(event); addedCount++; } catch (_) {}
      });
      this.calendar.render();
      return aiEvents;
    },

    async loadAISuggestionsFromDB() {
      try {
        if (!Utils?.makeRequest) return [];
        const res = await Utils.makeRequest("/api/calendar/ai-events", "GET");
        if (!res.success || !Array.isArray(res.data)) return [];
        return res.data.map((ev) => ({
          id:              ev.MaLichTrinh || ev.ID || `ai-${ev.taskId}-${Date.now()}`,
          title:           ev.TieuDe || ev.title || `Công việc #${ev.taskId}`,
          start:           ev.GioBatDau || ev.start,
          end:             ev.GioKetThuc || ev.end,
          backgroundColor: ev.Color || ev.color || "#2563EB",
          borderColor:     ev.Color || ev.color || "#1d4ed8",
          classNames:      ["event-ai-suggested"],
          extendedProps: {
            note:            ev.GhiChu || ev.reason || "AI đề xuất",
            completed:       ev.DaHoanThanh === 1,
            taskId:          ev.MaCongViec || ev.taskId,
            aiSuggested:     true,
            reason:          ev.reason || "",
            durationMinutes: ev.durationMinutes || 60,
            priority:        ev.priority || "medium",
            originalColor:   ev.Color || ev.color,
          },
        }));
      } catch (err) {
        console.error("Load AI suggestions error:", err);
        return [];
      }
    },

    // ------------------------------------------------------------------
    // Calendar rendering
    // ------------------------------------------------------------------

    renderCalendar(events) {
      const containerEl = document.getElementById(this.calendarElementId);
      if (!containerEl) return;

      if (this.calendar) {
        // Reuse existing instance — just swap events
        this.calendar.getEvents().forEach((e) => { try { e.remove(); } catch (_) {} });
        events.forEach((e) => { try { this.calendar.addEvent(e); } catch (_) {} });
        this.calendar.render();
        return;
      }

      this.calendar = new FullCalendar.Calendar(containerEl, {
        headerToolbar: false,
        initialView:   this.currentView,
        height:        "100%",
        editable:      false,
        selectable:    false,
        events,
      });
      this.calendar.render();
    },

    // ------------------------------------------------------------------
    // Refresh
    // ------------------------------------------------------------------

    async refreshFromDatabase() {
      try {
        if (!this.calendar) { await this.init(); return 0; }

        const aiEvents = await this.loadEventsForAI();

        // Remove stale AI events
        const toRemove = this.calendar.getEvents().filter((e) => e.extendedProps?.aiSuggested);
        toRemove.forEach((e) => { try { e.remove(); } catch (_) {} });

        if (aiEvents.length === 0) { this.calendar.render(); return 0; }

        let addedCount = 0;
        aiEvents.forEach((event) => {
          try {
            if (!this.calendar.getEventById(event.id)) {
              this.calendar.addEvent(event);
              addedCount++;
            }
          } catch (_) {}
        });

        this.suggestedEvents = aiEvents;
        if (addedCount > 0) this.calendar.render();
        this.updateCalendarTitle();
        return addedCount;
      } catch (error) {
        console.error("Error refreshing from database:", error);
        return 0;
      }
    },

    refreshUI() {
      if (this.calendar) {
        this.calendar.render();
        this.updateCalendarTitle();
        this.initializeNavbarEvents();
        this.setActiveView(this.currentView);
      }
    },

    async checkAndRestoreCalendar() {
      const calendarEl = document.getElementById(this.calendarElementId);
      if (!calendarEl) return false;
      if (!this.calendar) {
        const events = await this.loadEventsForAI();
        this.renderCalendar(events);
        if (this.lastView) setTimeout(() => { this.changeView(this.lastView); }, 100);
        if (this.lastDate && this.calendar) setTimeout(() => { this.calendar.gotoDate(this.lastDate); }, 150);
        return true;
      }
      return true;
    },

    restoreCalendar() {
      if (!this.calendar) return;
      const aiCalendar = document.getElementById(this.calendarElementId);
      if (aiCalendar) {
        aiCalendar.style.opacity       = "1";
        aiCalendar.style.pointerEvents = "auto";
        aiCalendar.style.position      = "relative";
        aiCalendar.style.left          = "0";
        if (this.lastView && this.calendar.view.type !== this.lastView) this.changeView(this.lastView);
        if (this.lastDate) this.calendar.gotoDate(this.lastDate);
        this.refreshUI();
      }
    },

    // ------------------------------------------------------------------
    // Section / visibility handlers
    // ------------------------------------------------------------------

    setupVisibilityHandler() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const aiSection = document.getElementById("ai-section");
          if (aiSection && aiSection.style.display !== "none") {
            if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
            this.refreshTimeout = setTimeout(() => { this.refreshFromDatabase(); }, 500);
          }
        }
      });

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "attributes" && mutation.attributeName === "style" && mutation.target.id === "ai-section") {
            const isVisible = mutation.target.style.display !== "none";
            if (isVisible && this.shouldInitWhenActivated) this.init();
          }
        });
      });
      const aiSection = document.getElementById("ai-section");
      if (aiSection) observer.observe(aiSection, { attributes: true });
    },

    setupSectionChangeHandler() {
      document.addEventListener("section-changed", (e) => {
        const sectionId    = e.detail?.sectionId;
        const isAISection  = sectionId === "ai-section" || sectionId === "ai";
        if (isAISection) this.handleAISectionActivated();
        else             this.handleOtherSectionActivated();
      });

      document.addEventListener("tab-shown", (e) => {
        if (e.detail?.tabId === "ai-calendar-tab" || e.detail?.tabId === "ai-tab") {
          setTimeout(() => { this.refreshFromDatabase(); }, 300);
        }
      });
    },

    handleAISectionActivated() {
      if (!this.calendar) {
        setTimeout(() => { this.init(); }, 100);
      } else {
        setTimeout(() => { this.refreshFromDatabase(); this.refreshUI(); }, 200);
      }
    },

    handleOtherSectionActivated() {
      if (this.calendar) {
        const calendarEl = document.getElementById(this.calendarElementId);
        if (calendarEl) {
          calendarEl.style.opacity       = "0.95";
          calendarEl.style.pointerEvents = "none";
        }
      }
    },

    preserveCalendarOnNavigation() {
      const originalNavigation = window.AppNavigation?.navigateToSection;
      if (!originalNavigation) return;

      window.AppNavigation.navigateToSection = function (sectionId) {
        if (this.currentSection === "ai-section" && sectionId !== "ai-section") {
          if (window.AIModule?.calendar) {
            window.AIModule.lastView = window.AIModule.currentView;
            window.AIModule.lastDate = window.AIModule.calendar?.getDate();
          }
        }
        return originalNavigation.call(this, sectionId);
      };
    },

    // ------------------------------------------------------------------
    // Navbar / view
    // ------------------------------------------------------------------

    initializeNavbarEvents() {
      const controls = {
        [this.prevBtnId]:  () => { this.calendar.prev(); this.updateCalendarTitle(); },
        [this.nextBtnId]:  () => { this.calendar.next(); this.updateCalendarTitle(); },
        [this.todayBtnId]: () => { this.calendar.today(); this.updateCalendarTitle(); },
        [this.dayBtnId]:   () => this.changeView("timeGridDay"),
        [this.weekBtnId]:  () => this.changeView("timeGridWeek"),
        [this.monthBtnId]: () => this.changeView("dayGridMonth"),
      };

      Object.entries(controls).forEach(([id, handler]) => {
        const btn = document.getElementById(id);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", (e) => { e.preventDefault(); handler(); });
        }
      });
      this.setActiveView(this.currentView);
    },

    changeView(view) {
      this.currentView = view;
      if (this.calendar) { this.calendar.changeView(view); this.updateCalendarTitle(); this.setActiveView(view); }
    },

    setActiveView(view) {
      [this.dayBtnId, this.weekBtnId, this.monthBtnId].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isActive = (view === "timeGridDay"   && id === this.dayBtnId)  ||
                         (view === "timeGridWeek"  && id === this.weekBtnId) ||
                         (view === "dayGridMonth"  && id === this.monthBtnId);
        btn.classList.toggle("bg-white", isActive);
        btn.classList.toggle("text-gray-900", isActive);
        btn.classList.toggle("shadow-sm", isActive);
      });
    },

    updateCalendarTitle() {
      const titleEl = document.getElementById(this.titleElementId);
      if (titleEl && this.calendar) titleEl.textContent = this.calendar.view.title;
    },

    // ------------------------------------------------------------------
    // AI button
    // ------------------------------------------------------------------

    setupAIButton() {
      const trySetup = (attempt = 1) => {
        const btn = document.getElementById("ai-suggest-btn");
        if (!btn) {
          if (attempt < 5) setTimeout(() => trySetup(attempt + 1), 200);
          return;
        }
        const newBtn = btn.cloneNode(true);
        btn.parentNode?.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.openAiSuggestionModal(); });
      };
      trySetup();
    },

    // ------------------------------------------------------------------
    // Modal helpers
    // ------------------------------------------------------------------

    openAiSuggestionModal() {
      try {
        if (window.ModalManager && window.ModalManager.showModalById) {
          window.ModalManager.showModalById("aiSuggestionModal");
        } else {
          const modal = document.getElementById("aiSuggestionModal");
          if (modal) {
            modal.classList.remove("hidden");
            modal.classList.add("active", "show");
            document.body.style.overflow = "hidden";
          }
        }
      } catch (error) {
        console.error("Error opening modal:", error);
        Utils?.alert?.(error.message, "Lỗi mở modal", "error");
      }
    },

    closeModal() {
      if (window.ModalManager && ModalManager.close) {
        ModalManager.close("aiSuggestionModal");
      } else {
        const modal = document.getElementById("aiSuggestionModal");
        if (modal) {
          modal.classList.remove("active", "show");
          modal.classList.add("hidden");
          modal.style.display = modal.style.opacity = modal.style.visibility = "";
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
          this.showModalError("AIHandler không khả dụng");
        }
      } catch (error) {
        console.error("Error initializing AI modal:", error);
        this.showModalError(error.message);
      }
    },

    async waitForModalReady() {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          attempts++;
          const modal    = document.getElementById("aiSuggestionModal");
          const taskList = modal?.querySelector(".task-list");
          if (modal && taskList && window.AIHandler) return resolve(true);
          if (attempts >= 20) return reject(new Error("Modal not ready after maximum attempts"));
          setTimeout(check, 100);
        };
        check();
      });
    },

    // ------------------------------------------------------------------
    // Save helpers
    // ------------------------------------------------------------------

    async saveAISuggestions(suggestions) {
      try {
        if (window.AIHandler && window.AIHandler.saveAISuggestionsToDatabase) {
          return await AIHandler.saveAISuggestionsToDatabase(suggestions);
        }
        return { success: false, message: "AIHandler not available" };
      } catch (error) {
        console.error("Error saving AI suggestions:", error);
        throw error;
      }
    },

    async clearOldAISuggestions() {
      try {
        if (!Utils?.makeRequest) return false;
        const res = await Utils.makeRequest("/api/ai/clear-old-suggestions", "DELETE");
        return res.success || false;
      } catch (error) {
        console.error("Error clearing old AI suggestions:", error);
        return false;
      }
    },

    // ------------------------------------------------------------------
    // Utility
    // ------------------------------------------------------------------

    getPriorityColor(priority) {
      const colors = { 1: "#10B981", 2: "#3B82F6", 3: "#F59E0B", 4: "#EF4444" };
      return colors[priority] || "#2563EB";
    },

    getCalendar() { return this.calendar; },

    destroy() {
      // AI calendar is intentionally NOT destroyed on section navigation —
      // only clean up when truly leaving (e.g. full page unload).
      const isAICalendar = this.calendarElementId?.includes("ai");
      if (!isAICalendar) {
        if (this.calendar) { try { this.calendar.destroy(); } catch (_) {} this.calendar = null; }
        this.isInitialized = false;
      }
    },

    refresh() {
      if (this.calendar && this.isInitialized) this.refreshUI();
      else this.init();
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
            <button onclick="location.reload()" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Tải lại trang</button>
          </div>
        </div>`;
    },

    showModalError(message) {
      const modalBody = document.querySelector("#aiSuggestionModal .ai-modal-body");
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="error-state" style="text-align:center;padding:40px;">
            <i class="fas fa-exclamation-triangle" style="font-size:48px;color:#EF4444;margin-bottom:20px;"></i>
            <p style="font-size:18px;font-weight:600;margin-bottom:10px;">Không thể tải dữ liệu</p>
            <p style="color:#666;margin-bottom:20px;">${message}</p>
            <button class="btn btn-primary" onclick="AIModule.openAiSuggestionModal()" style="padding:10px 20px;background:#3B82F6;color:white;border:none;border-radius:8px;cursor:pointer;">
              <i class="fas fa-redo"></i> Thử lại
            </button>
          </div>`;
      }
    },

    debugAIModule() {
      console.log("=== AI Module Debug ===");
      console.log("Calendar exists:", !!this.calendar);
      console.log("Is initialized:", this.isInitialized);
      console.log("Suggested events count:", this.suggestedEvents.length);
    },
  };

  window.AIModule = AIModule;
  console.log("AIModule v2.1 (Integrated with AIHandler) đã sẵn sàng!");
})();
