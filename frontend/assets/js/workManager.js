(function () {
  "use strict";

  if (window.WorkManager) {
    return;
  }

  // ─── Debounced reload — prevents aggressive multi-fire reloads ────────────
  let _reloadTimer = null;
  function debouncedReload() {
    if (_reloadTimer) clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(() => {
      if (window.WorkManager?.loadTasks) {
        const ws = document.getElementById("work-section");
        if (ws?.classList.contains("active")) {
          window.WorkManager.loadTasks();
        }
      }
    }, 800);
  }

  // ─── Priority helpers ──────────────────────────────────────────────────────

  const PRIORITY_MAP = {
    1: { text: "Thấp",      cls: "wk-chip-low",    stripe: "#8a9a5b", filter: "low"    },
    2: { text: "Trung bình", cls: "wk-chip-medium", stripe: "#4a6fa5", filter: "medium" },
    3: { text: "Cao",        cls: "wk-chip-high",   stripe: "#c97b3c", filter: "high"   },
    4: { text: "Khẩn cấp",  cls: "wk-chip-urgent", stripe: "#a83232", filter: "urgent" },
  };

  function getPriority(p) {
    return PRIORITY_MAP[p] || PRIORITY_MAP[2];
  }

  // ─── WorkManager ──────────────────────────────────────────────────────────

  window.WorkManager = {
    initialized: false,
    eventListeners: [],

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
          const el = document.getElementById("work-items-container");
          if (el) {
            this.hideErrorState();
            resolve(true);
          } else if (attempt < retries) {
            setTimeout(() => check(attempt + 1), delay);
          } else {
            console.error("Work container not found");
            resolve(false);
          }
        };
        check();
      });
    },

    showErrorState() {
      document.getElementById("work-error-container")?.classList.remove("hidden");
      const c = document.getElementById("work-items-container");
      if (c) c.style.display = "none";
    },

    hideErrorState() {
      document.getElementById("work-error-container")?.classList.add("hidden");
      const c = document.getElementById("work-items-container");
      if (c) c.style.display = "block";
    },

    async loadTasks() {
      try {
        if (typeof Utils === "undefined") throw new Error("Utils module not available");

        const result = await Utils.makeRequest("/api/tasks", "GET");
        if (!result.success) throw new Error(result.message || "Lỗi tải công việc");

        this.renderTasks(result.data || []);
      } catch (err) {
        console.error("Error loading tasks:", err);
        this.showErrorState();
        Utils?.showToast?.(err.message || "Không thể tải công việc", "error");
      }
    },

    reload() {
      this.loadTasks();
    },

    // ─── Render ──────────────────────────────────────────────────────────────

    renderTasks(tasks) {
      const container = document.getElementById("work-items-container");
      if (!container) return;

      document.getElementById("loading-indicator")?.classList.add("hidden");

      const emptyState = document.getElementById("empty-state-indicator");

      if (tasks.length === 0) {
        emptyState?.classList.remove("hidden");
        container.querySelector(".wk-sections-wrap")?.remove();
        this._hideBulkBar();
        return;
      }

      emptyState?.classList.add("hidden");

      const pending   = tasks.filter((t) => t.TrangThaiThucHien !== 2);
      const completed = tasks.filter((t) => t.TrangThaiThucHien === 2);

      // Build sections wrapper — replace existing if present
      let wrap = container.querySelector(".wk-sections-wrap");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "wk-sections-wrap";
        container.appendChild(wrap);
      }
      wrap.innerHTML = this._buildSections(pending, completed);

      setTimeout(() => {
        this.setupTableEvents();
        this.setupFilters();
        this.setupCreateTaskButton();
        this.setupBulkBar();
      }, 50);
    },

    _buildSections(pending, completed) {
      let html = "";

      // Pending section
      html += `<div class="wk-task-list" id="section-pending">`;
      html += `<p class="wk-section-title">Đang chờ (${pending.length})</p>`;
      if (pending.length === 0) {
        html += `<div class="wk-loading" style="min-height:4rem"><span style="font-style:italic">Không có công việc đang chờ</span></div>`;
      } else {
        html += `<div class="wk-rows" id="rows-pending">`;
        html += `<div class="wk-task-row wk-header-row" style="padding:0.25rem 0.5rem;border-bottom:1px solid var(--np-border)">`;
        html += `<input type="checkbox" id="select-all-pending" class="wk-cb" title="Chọn tất cả">`;
        html += `<span style="font-size:0.7rem;color:var(--np-text-muted);font-family:var(--np-font-ui);letter-spacing:0.08em;text-transform:uppercase">Chọn tất cả</span>`;
        html += `</div>`;
        pending.forEach((t) => { html += this._buildRow(t, false); });
        html += `</div>`;
      }
      html += `</div>`;

      // Completed section
      if (completed.length > 0) {
        html += `<div class="wk-task-list" id="section-completed">`;
        html += `<p class="wk-section-title">Đã hoàn thành (${completed.length})</p>`;
        html += `<div class="wk-rows" id="rows-completed">`;
        html += `<div class="wk-task-row wk-header-row" style="padding:0.25rem 0.5rem;border-bottom:1px solid var(--np-border)">`;
        html += `<input type="checkbox" id="select-all-completed" class="wk-cb" title="Chọn tất cả">`;
        html += `<span style="font-size:0.7rem;color:var(--np-text-muted);font-family:var(--np-font-ui);letter-spacing:0.08em;text-transform:uppercase">Chọn tất cả</span>`;
        html += `</div>`;
        completed.forEach((t) => { html += this._buildRow(t, true); });
        html += `</div>`;
        html += `</div>`;
      }

      return html;
    },

    _buildRow(task, isCompleted) {
      const taskId  = task.ID || task.MaCongViec || 0;
      const pInfo   = getPriority(task.MucDoUuTien || 2);
      const title   = this._esc(task.TieuDe || "");
      const dur     = task.ThoiGianUocTinh ? `${task.ThoiGianUocTinh} phút` : "";
      const group   = isCompleted ? "completed" : "pending";
      const compCls = isCompleted ? " is-completed" : "";

      // Actions differ by state
      const actions = isCompleted
        ? `<button class="wk-act-btn wk-act-btn--complete action-btn-reopen" data-task-id="${taskId}" title="Mở lại">Mở lại</button>
           <button class="wk-act-btn wk-act-btn--edit action-btn-edit" data-task-id="${taskId}" title="Sửa">Sửa</button>
           <button class="wk-act-btn wk-act-btn--delete action-btn-delete" data-task-id="${taskId}" title="Xóa">Xóa</button>`
        : `<button class="wk-act-btn wk-act-btn--complete action-btn-complete" data-task-id="${taskId}" title="Hoàn thành">Xong</button>
           <button class="wk-act-btn wk-act-btn--edit action-btn-edit" data-task-id="${taskId}" title="Sửa">Sửa</button>
           <button class="wk-act-btn wk-act-btn--delete action-btn-delete" data-task-id="${taskId}" title="Xóa">Xóa</button>`;

      return `
        <div id="task-${taskId}"
             class="wk-task-row${compCls}"
             data-task-id="${taskId}"
             data-group="${group}"
             data-priority="${pInfo.filter}">
          <input type="checkbox"
                 class="wk-cb task-checkbox ${group}-checkbox"
                 data-task-id="${taskId}">
          <div class="wk-priority-stripe" style="background:${pInfo.stripe}"></div>
          <div class="wk-task-main">
            <span class="wk-task-title" title="${title}">${title}</span>
            <div class="wk-task-meta">
              <span class="wk-meta-priority ${pInfo.cls}">${pInfo.text}</span>
              ${dur ? `<span class="wk-meta-sep">·</span><span>${dur}</span>` : ""}
            </div>
          </div>
          <div class="wk-task-actions">${actions}</div>
        </div>`;
    },

    _esc(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    // ─── Events ──────────────────────────────────────────────────────────────

    setupGlobalEvents() {
      this.removeEventListeners();
      this.setupCreateTaskButton();

      const refreshBtn = document.getElementById("refresh-tasks-btn");
      if (refreshBtn) {
        const h = (e) => { e.preventDefault(); this.loadTasks(); };
        refreshBtn.addEventListener("click", h);
        this.eventListeners.push({ element: refreshBtn, event: "click", handler: h });
      }
    },

    setupCreateTaskButton() {
      const btn = document.getElementById("create-task-btn");
      if (!btn) return;
      btn.removeEventListener("click", btn._handler);
      const h = (e) => {
        e.preventDefault();
        window.ModalManager?.showModalById?.("createTaskModal");
      };
      btn._handler = h;
      btn.addEventListener("click", h);
      this.eventListeners.push({ element: btn, event: "click", handler: h });
    },

    setupTableEvents() {
      const container = document.getElementById("work-items-container");
      if (!container) return;

      // Remove old delegated handler
      if (container._clickHandler) {
        container.removeEventListener("click", container._clickHandler);
      }

      const clickHandler = (e) => {
        const btn = e.target.closest("[class*='action-btn-']");
        if (!btn || !btn.dataset.taskId) return;
        e.preventDefault();
        e.stopPropagation();

        const id = btn.dataset.taskId;
        if (btn.classList.contains("action-btn-complete")) {
          this.updateTaskStatus(id, true);
        } else if (btn.classList.contains("action-btn-reopen")) {
          this.updateTaskStatus(id, false);
        } else if (btn.classList.contains("action-btn-edit")) {
          this.editTask(id);
        } else if (btn.classList.contains("action-btn-delete")) {
          this.deleteTask(id);
        }
      };

      container._clickHandler = clickHandler;
      container.addEventListener("click", clickHandler);

      // Select-all checkboxes
      this._bindSelectAll("select-all-pending",   ".pending-checkbox");
      this._bindSelectAll("select-all-completed", ".completed-checkbox");

      // Per-row checkboxes → update bulk bar
      container.querySelectorAll(".task-checkbox").forEach((cb) => {
        const h = () => this._updateBulkBar();
        cb.addEventListener("change", h);
        this.eventListeners.push({ element: cb, event: "change", handler: h });
      });
    },

    _bindSelectAll(elId, cbSelector) {
      const el = document.getElementById(elId);
      if (!el) return;
      el.removeEventListener("change", el._handler);
      const h = (e) => {
        document.querySelectorAll(cbSelector).forEach((cb) => (cb.checked = e.target.checked));
        this._updateBulkBar();
      };
      el._handler = h;
      el.addEventListener("change", h);
      this.eventListeners.push({ element: el, event: "change", handler: h });
    },

    setupFilters() {
      const statusF   = document.getElementById("status-filter");
      const priorityF = document.getElementById("priority-filter");
      const search    = document.getElementById("task-search");

      const rebind = (el, event, key) => {
        if (!el) return;
        if (el[key]) el.removeEventListener(event, el[key]);
        const h = () => this.filterTasks();
        el[key] = h;
        el.addEventListener(event, h);
        this.eventListeners.push({ element: el, event, handler: h });
      };

      rebind(statusF,   "change", "_changeHandler");
      rebind(priorityF, "change", "_changeHandler");
      rebind(search,    "input",  "_inputHandler");
    },

    filterTasks() {
      const status   = document.getElementById("status-filter")?.value   || "all";
      const priority = document.getElementById("priority-filter")?.value || "all";
      const q        = document.getElementById("task-search")?.value.toLowerCase() || "";

      const rows = document.querySelectorAll(".wk-task-row:not(.wk-header-row)");
      rows.forEach((row) => {
        const isCompleted = row.classList.contains("is-completed");
        const pVal        = row.dataset.priority || "medium";
        const titleEl     = row.querySelector(".wk-task-title");
        const title       = titleEl?.textContent.toLowerCase() || "";

        const statusOk   = status   === "all" || (status === "pending" ? !isCompleted : isCompleted);
        const priorityOk = priority === "all" || priority === pVal;
        const searchOk   = !q || title.includes(q);

        row.style.display = statusOk && priorityOk && searchOk ? "" : "none";
      });

      // Hide entire section if no visible rows
      ["section-pending", "section-completed"].forEach((id) => {
        const section = document.getElementById(id);
        if (!section) return;
        const hasVisible = Array.from(section.querySelectorAll(".wk-task-row:not(.wk-header-row)"))
          .some((r) => r.style.display !== "none");
        section.style.display = hasVisible ? "" : "none";
      });
    },

    // ─── Bulk Action Bar ─────────────────────────────────────────────────────

    setupBulkBar() {
      const completeBtn = document.getElementById("bulk-complete-btn");
      const deleteBtn   = document.getElementById("bulk-delete-btn");

      if (completeBtn) {
        completeBtn.removeEventListener("click", completeBtn._handler);
        const h = () => this._bulkComplete();
        completeBtn._handler = h;
        completeBtn.addEventListener("click", h);
      }

      if (deleteBtn) {
        deleteBtn.removeEventListener("click", deleteBtn._handler);
        const h = () => this._bulkDelete();
        deleteBtn._handler = h;
        deleteBtn.addEventListener("click", h);
      }
    },

    _getSelectedIds() {
      return Array.from(
        document.querySelectorAll(".task-checkbox:checked")
      ).map((cb) => cb.dataset.taskId).filter(Boolean);
    },

    _updateBulkBar() {
      const ids   = this._getSelectedIds();
      const bar   = document.getElementById("bulk-action-bar");
      const count = document.getElementById("bulk-count");
      if (!bar) return;

      if (ids.length > 0) {
        bar.classList.remove("hidden");
        if (count) count.textContent = `${ids.length} đã chọn`;
      } else {
        this._hideBulkBar();
      }
    },

    _hideBulkBar() {
      const bar = document.getElementById("bulk-action-bar");
      bar?.classList.add("hidden");
    },

    async _bulkComplete() {
      const ids = this._getSelectedIds();
      if (ids.length === 0) return;

      try {
        if (typeof Utils === "undefined") throw new Error("Utils not available");

        // Fire all PATCH/PUT requests in parallel
        const results = await Promise.all(
          ids.map((id) =>
            Utils.makeRequest(`/api/tasks/${id}`, "PUT", { TrangThaiThucHien: 2 })
          )
        );

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
          Utils?.showToast?.(`${failed.length} công việc không thể cập nhật`, "warning");
        } else {
          Utils?.showToast?.(`Đã hoàn thành ${ids.length} công việc`, "success");
        }

        this.triggerSidebarRefresh();
        this._hideBulkBar();
        await this.loadTasks();
      } catch (err) {
        console.error("Bulk complete error:", err);
        Utils?.showToast?.(err.message || "Lỗi cập nhật hàng loạt", "error");
      }
    },

    async _bulkDelete() {
      const ids = this._getSelectedIds();
      if (ids.length === 0) return;

      // Confirm
      const msg = `Bạn có chắc chắn muốn xóa ${ids.length} công việc đã chọn?`;
      let confirmed = false;

      if (typeof Swal !== "undefined") {
        const r = await Swal.fire({
          title: "Xác nhận xóa",
          text: msg,
          icon: "warning",
          showCancelButton: true,
          confirmButtonColor: "#a83232",
          cancelButtonColor: "#4a6fa5",
          confirmButtonText: "Xóa",
          cancelButtonText: "Hủy",
          reverseButtons: true,
        });
        confirmed = r.isConfirmed;
      } else {
        confirmed = confirm(msg);
      }

      if (!confirmed) return;

      try {
        if (typeof Utils === "undefined") throw new Error("Utils not available");

        const results = await Promise.all(
          ids.map((id) => Utils.makeRequest(`/api/tasks/${id}`, "DELETE"))
        );

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
          Utils?.showToast?.(`${failed.length} công việc không thể xóa`, "warning");
        } else {
          Utils?.showToast?.(`Đã xóa ${ids.length} công việc`, "success");
        }

        this.triggerSidebarRefresh();
        this._hideBulkBar();
        await this.loadTasks();

        document.dispatchEvent(new CustomEvent("taskDeleted", { detail: { bulk: true } }));
      } catch (err) {
        console.error("Bulk delete error:", err);
        Utils?.showToast?.(err.message || "Lỗi xóa hàng loạt", "error");
      }
    },

    // ─── Single task operations ──────────────────────────────────────────────

    async updateTaskStatus(taskId, completed) {
      try {
        if (typeof Utils === "undefined") throw new Error("Utils module not available");

        const result = await Utils.makeRequest(`/api/tasks/${taskId}`, "PUT", {
          TrangThaiThucHien: completed ? 2 : 0,
        });

        if (!result.success) throw new Error(result.message || "Cập nhật thất bại");

        this.triggerSidebarRefresh();
        this.showSuccessOverlay(completed ? "Đã hoàn thành công việc" : "Đã mở lại công việc");
        await this.loadTasks();
      } catch (err) {
        console.error("Error updating task:", err);
        Utils?.showToast?.("Cập nhật trạng thái thất bại", "error");
      }
    },

    async deleteTask(taskId) {
      try {
        if (typeof Utils === "undefined") throw new Error("Utils module not available");

        const row = document.getElementById(`task-${taskId}`);
        const taskTitle = row?.querySelector(".wk-task-title")?.textContent || "Công việc này";

        let confirmed = false;

        if (typeof Swal !== "undefined") {
          const r = await Swal.fire({
            title: "Xác nhận xóa",
            html: `Bạn có chắc chắn muốn xóa công việc "<strong>${taskTitle}</strong>"?`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#a83232",
            cancelButtonColor: "#4a6fa5",
            confirmButtonText: "Xóa",
            cancelButtonText: "Hủy",
            reverseButtons: true,
          });
          confirmed = r.isConfirmed;
        } else {
          confirmed = confirm(`Bạn có chắc chắn muốn xóa công việc "${taskTitle}"?`);
        }

        if (!confirmed) {
          Utils?.showToast?.("Đã hủy xóa", "info");
          return;
        }

        const result = await Utils.makeRequest(`/api/tasks/${taskId}`, "DELETE");

        if (!result.success) {
          if (result.requireConfirmation && typeof Swal !== "undefined") {
            const r2 = await Swal.fire({
              title: "Xác nhận thêm",
              html: `${result.message}<br><br>${result.details}<br><br>Bạn vẫn muốn xóa?`,
              icon: "warning",
              showCancelButton: true,
              confirmButtonColor: "#a83232",
              cancelButtonColor: "#4a6fa5",
              confirmButtonText: "Vẫn xóa",
              cancelButtonText: "Hủy",
            });
            if (!r2.isConfirmed) return;
            const r3 = await Utils.makeRequest(`/api/tasks/${taskId}?force=true`, "DELETE");
            if (!r3.success) throw new Error(r3.message || "Xóa thất bại");
          } else {
            throw new Error(result.message || "Xóa thất bại");
          }
        }

        Utils?.showToast?.("Đã xóa công việc thành công", "success");
        await this.loadTasks();
        this.triggerSidebarRefresh();
        document.dispatchEvent(new CustomEvent("taskDeleted", { detail: { taskId } }));
      } catch (err) {
        console.error("Error deleting task:", err);
        Utils?.showToast?.(err.message || "Không thể xóa công việc", "error");
      }
    },

    editTask(taskId) {
      Utils.makeRequest(`/api/tasks/${taskId}`, "GET")
        .then((result) => {
          if (result.success && result.data) {
            if (window.ModalManager?.showModalById) {
              window.ModalManager.showModalById("createTaskModal");
              setTimeout(() => {
                if (window.loadTaskDataIntoForm) {
                  window.loadTaskDataIntoForm(result.data);
                } else {
                  console.error("loadTaskDataIntoForm not found");
                  Utils?.showToast?.("Không thể tải form chỉnh sửa", "error");
                }
              }, 500);
            } else {
              Utils?.showToast?.("Không thể mở chỉnh sửa", "error");
            }
          } else {
            Utils?.showToast?.("Không tìm thấy công việc", "error");
          }
        })
        .catch((err) => {
          console.error("Error loading task for edit:", err);
          Utils?.showToast?.("Lỗi tải công việc: " + err.message, "error");
        });
    },

    // ─── Success overlay ─────────────────────────────────────────────────────

    showSuccessOverlayTimeout: null,
    hideSuccessOverlayTimeout: null,

    showSuccessOverlay(message = "Thành công!") {
      clearTimeout(this.showSuccessOverlayTimeout);
      clearTimeout(this.hideSuccessOverlayTimeout);

      let overlay = document.getElementById("success-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "success-overlay";
        overlay.className =
          "fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[10060] hidden transition-opacity duration-300";
        overlay.innerHTML = `
          <div class="rounded-xl p-8 max-w-md mx-4 shadow-2xl transform transition-all duration-300 scale-95 opacity-0" style="background:var(--np-bg-card,#faf7f2);border:1.5px solid var(--np-border,#1a1a1a);box-shadow:var(--np-shadow,4px 4px 0 #1a1a1a)">
            <div class="text-center">
              <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                &#10003;
              </div>
              <h3 id="overlay-title" class="text-xl font-bold text-gray-800 mb-2">${message}</h3>
              <p class="text-gray-600 mb-6">Thao tác đã được thực hiện thành công!</p>
              <button id="close-overlay-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">Đóng</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        document.getElementById("close-overlay-btn").addEventListener("click", () => this.hideSuccessOverlay());
        overlay.addEventListener("click", (e) => { if (e.target === overlay) this.hideSuccessOverlay(); });
      }

      const title = document.getElementById("overlay-title");
      if (title) title.textContent = message;

      this.hideSuccessOverlayImmediately();

      this.showSuccessOverlayTimeout = setTimeout(() => {
        overlay.classList.remove("hidden");
        this.showSuccessOverlayTimeout = setTimeout(() => {
          overlay.querySelector("div > div")?.classList.replace("scale-95", "scale-100");
          overlay.querySelector("div > div")?.classList.replace("opacity-0", "opacity-100");
        }, 10);
      }, 10);

      this.hideSuccessOverlayTimeout = setTimeout(() => this.hideSuccessOverlay(), 3000);
    },

    hideSuccessOverlayImmediately() {
      const overlay = document.getElementById("success-overlay");
      if (overlay) {
        overlay.classList.add("hidden");
        const c = overlay.querySelector("div > div");
        c?.classList.replace("scale-100", "scale-95");
        c?.classList.replace("opacity-100", "opacity-0");
      }
    },

    hideSuccessOverlay() {
      const overlay = document.getElementById("success-overlay");
      if (overlay) {
        overlay.classList.add("opacity-0");
        setTimeout(() => overlay.remove(), 300);
      }
    },

    // ─── Utility ─────────────────────────────────────────────────────────────

    removeEventListeners() {
      this.eventListeners.forEach(({ element, event, handler }) => {
        element?.removeEventListener?.(event, handler);
      });
      this.eventListeners = [];

      const container = document.getElementById("work-items-container");
      if (container?._clickHandler) {
        container.removeEventListener("click", container._clickHandler);
        container._clickHandler = null;
      }

      const createBtn = document.getElementById("create-task-btn");
      if (createBtn?._handler) {
        createBtn.removeEventListener("click", createBtn._handler);
        createBtn._handler = null;
      }
    },

    triggerSidebarRefresh() {
      document.dispatchEvent(new CustomEvent("task-changed", {
        detail: { action: "refresh", source: "workManager", timestamp: Date.now() },
      }));

      if (typeof window.triggerSidebarRefresh === "function") {
        setTimeout(() => window.triggerSidebarRefresh(), 300);
      }

      try {
        localStorage.setItem("__task_refresh_trigger", Date.now().toString());
        setTimeout(() => localStorage.removeItem("__task_refresh_trigger"), 100);
      } catch (_) {}
    },

    cleanup() {
      clearTimeout(this.showSuccessOverlayTimeout);
      clearTimeout(this.hideSuccessOverlayTimeout);
      this.removeEventListeners();
      this.initialized = false;
    },
  };

  // ─── Document-level listeners ───────────────────────────────────────────────

  document.addEventListener("work-tab-activated", () => { debouncedReload(); });

  document.addEventListener("section-changed", (e) => {
    if (e.detail?.section === "work") debouncedReload();
  });

  ["taskCreated", "taskUpdated", "taskDeleted"].forEach((evt) => {
    document.addEventListener(evt, () => { debouncedReload(); });
  });

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (window.WorkManager && !window.WorkManager.initialized) {
        window.WorkManager.init();
      }
    }, 1000);
  });

  window.WorkManager.refresh = function () { this.loadTasks(); };

  window.WorkManager.checkAndReload = function () {
    const ws = document.getElementById("work-section");
    if (ws?.classList.contains("active")) this.loadTasks();
  };

})();
