// work-manager.js — core WorkManager singleton.
// Defines window.WorkManager with: init, loadTasks, lifecycle helpers.
// Extension files must load AFTER this one:
//   work-manager-render.js   — renderTasks, setupFilters, filterTasks, bulk-bar helpers
//   work-manager-actions.js  — setupTableEvents, updateTaskStatus, deleteTask, editTask, bulk ops
(function () {
  "use strict";

  if (window.WorkManager) {
    return;
  }

  window.WorkManager = {
    initialized: false,
    eventListeners: [],
    _tasksCache: [],
    _sortCtrl: null,
    _sortState: { criterion: null, direction: "asc" },
    showSuccessOverlayTimeout: null,
    hideSuccessOverlayTimeout: null,

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

    async init() {
      if (this.initialized) return;
      this.initialized = true;

      if (!(await this.waitForContainer())) {
        this.showErrorState();
        return;
      }

      await this.loadTasks();
      this.setupGlobalEvents();
    },

    async waitForContainer(retries = 10, delay = 100) {
      return new Promise((resolve) => {
        const check = (attempt = 0) => {
          const container = document.getElementById("work-items-container");
          if (container) {
            this.hideErrorState();
            resolve(true);
          } else if (attempt < retries) {
            setTimeout(() => check(attempt + 1), delay);
          } else {
            resolve(false);
          }
        };
        check();
      });
    },

    showErrorState() {
      const ec = document.getElementById("work-error-container");
      const wc = document.getElementById("work-items-container");
      if (ec) ec.classList.remove("hidden");
      if (wc) wc.style.display = "none";
    },

    hideErrorState() {
      const ec = document.getElementById("work-error-container");
      const wc = document.getElementById("work-items-container");
      if (ec) ec.classList.add("hidden");
      if (wc) wc.style.display = "block";
    },

    // ----------------------------------------------------------------
    // Data loading
    // ----------------------------------------------------------------

    async loadTasks() {
      try {
        if (typeof Utils === "undefined") {
          throw new Error("Utils module not available");
        }
        const result = await Utils.makeRequest("/api/tasks", "GET");
        const tasks = result.data || [];
        this._tasksCache = tasks;
        this.renderTasks(tasks);
        this.mountSortControls();
      } catch (err) {
        console.error("Error loading tasks:", err);
        this.showErrorState();
      }
    },

    reload() {
      this.loadTasks();
    },

    // ----------------------------------------------------------------
    // Sort controls
    // ----------------------------------------------------------------

    mountSortControls() {
      const host = document.getElementById("work-sort-controls");
      if (!host || !window.SortControls) return;
      // Host re-created by componentLoader — remount only when empty.
      if (host.childElementCount > 0) return;
      this._sortCtrl = window.SortControls.mount(host, {
        storageKey: "sort.work",
        onChange: (state) => {
          this._sortState = state;
          this.renderTasks(this._tasksCache);
        },
      });
      this._sortState = this._sortCtrl.getState();
    },

    // ----------------------------------------------------------------
    // Success overlay
    // ----------------------------------------------------------------

    showSuccessOverlay(message = "Thành công!") {
      if (this.showSuccessOverlayTimeout) {
        clearTimeout(this.showSuccessOverlayTimeout);
        this.showSuccessOverlayTimeout = null;
      }
      if (this.hideSuccessOverlayTimeout) {
        clearTimeout(this.hideSuccessOverlayTimeout);
        this.hideSuccessOverlayTimeout = null;
      }

      let overlay = document.getElementById("success-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "success-overlay";
        overlay.className =
          "fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[10060] hidden transition-opacity duration-300";
        overlay.innerHTML = `
          <div class="bg-white rounded-xl p-8 max-w-md mx-4 shadow-2xl transform transition-all duration-300 scale-95 opacity-0">
            <div class="text-center">
              <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-check text-green-600 text-2xl"></i>
              </div>
              <h3 id="overlay-title" class="text-xl font-bold text-gray-800 mb-2">${message}</h3>
              <p id="overlay-description" class="text-gray-600 mb-6">Thao tác đã được thực hiện thành công!</p>
              <button id="close-overlay-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Đóng</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        document.getElementById("close-overlay-btn")
          .addEventListener("click", () => this.hideSuccessOverlay());
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) this.hideSuccessOverlay();
        });
      }

      const titleEl = document.getElementById("overlay-title");
      if (titleEl) titleEl.textContent = message;

      this.hideSuccessOverlayImmediately();

      this.showSuccessOverlayTimeout = setTimeout(() => {
        overlay.classList.remove("hidden");
        this.showSuccessOverlayTimeout = setTimeout(() => {
          const content = overlay.querySelector("div > div");
          if (content) {
            content.classList.remove("scale-95", "opacity-0");
            content.classList.add("scale-100", "opacity-100");
          }
        }, 10);
      }, 10);

      this.hideSuccessOverlayTimeout = setTimeout(() => this.hideSuccessOverlay(), 3000);
    },

    hideSuccessOverlayImmediately() {
      const overlay = document.getElementById("success-overlay");
      if (!overlay) return;
      overlay.classList.add("hidden");
      const content = overlay.querySelector("div > div");
      if (content) {
        content.classList.remove("scale-100", "opacity-100");
        content.classList.add("scale-95", "opacity-0");
      }
    },

    hideSuccessOverlay() {
      const overlay = document.getElementById("success-overlay");
      if (overlay) {
        overlay.classList.add("opacity-0");
        setTimeout(() => overlay.remove(), 300);
      }
    },

    // ----------------------------------------------------------------
    // Global event listeners
    // ----------------------------------------------------------------

    setupGlobalEvents() {
      this.removeEventListeners();

      const refreshBtn = document.getElementById("refresh-tasks-btn");
      if (refreshBtn) {
        const handler = (e) => {
          e.preventDefault();
          this.loadTasks();
        };
        refreshBtn.addEventListener("click", handler);
        this.eventListeners.push({ element: refreshBtn, event: "click", handler });
      }

      this.setupCreateTaskButton();
    },

    setupCreateTaskButton() {
      const createBtn = document.getElementById("create-task-btn");
      if (!createBtn) return;

      if (createBtn._handler) {
        createBtn.removeEventListener("click", createBtn._handler);
      }

      const handler = (e) => {
        e.preventDefault();
        if (!Utils.requireAuth()) return;
        if (window.ModalManager) {
          window.ModalManager.showModalById("createTaskModal");
        }
      };

      createBtn._handler = handler;
      createBtn.addEventListener("click", handler);
      this.eventListeners.push({ element: createBtn, event: "click", handler });
    },

    // Convenience aliases (actions file fills removeEventListeners at load time)
    refresh() {
      this.loadTasks();
    },

    checkAndReload() {
      const ws = document.getElementById("work-section");
      if (ws && ws.classList.contains("active")) this.loadTasks();
    },
  };

  // ------------------------------------------------------------------
  // Document-level event listeners
  // ------------------------------------------------------------------

  document.addEventListener("work-tab-activated", () => {
    if (window.WorkManager) window.WorkManager.loadTasks();
  });

  document.addEventListener("section-changed", (e) => {
    if (e.detail && e.detail.section === "work") {
      setTimeout(() => {
        if (window.WorkManager) window.WorkManager.loadTasks();
      }, 300);
    }
  });

  document.addEventListener("taskCreated", () => {
    setTimeout(() => { if (window.WorkManager) window.WorkManager.loadTasks(); }, 500);
  });
  document.addEventListener("taskUpdated", () => {
    setTimeout(() => { if (window.WorkManager) window.WorkManager.loadTasks(); }, 500);
  });
  document.addEventListener("taskDeleted", () => {
    setTimeout(() => { if (window.WorkManager) window.WorkManager.loadTasks(); }, 500);
  });

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const ws = document.getElementById("work-section");
      if (!ws || !ws.classList.contains("active")) return;
      const WM = window.WorkManager;
      if (!WM) return;
      if (!WM.initialized) WM.init();
      else WM.loadTasks();
    }, 1000);
  });

  console.log("Work Manager Core v1.0 ready");
})();
