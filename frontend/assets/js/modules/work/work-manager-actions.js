// work-manager-actions.js — extends WorkManager with task action handlers:
// setupTableEvents, updateTaskStatus, deleteTask, editTask,
// bulkComplete, bulkRestore, bulkDelete,
// removeEventListeners, triggerSidebarRefresh, cleanup.
// Depends on: work-manager.js (must be loaded first)
(function () {
  "use strict";

  const WM = window.WorkManager;
  if (!WM) {
    console.error("work-manager-actions.js: WorkManager not found");
    return;
  }

  // ------------------------------------------------------------------
  // Table event delegation (action buttons + select-all checkboxes)
  // ------------------------------------------------------------------

  WM.setupTableEvents = function () {
    const container = document.getElementById("work-items-container");
    if (!container) return;

    if (container._clickHandler) {
      container.removeEventListener("click", container._clickHandler);
    }

    const clickHandler = (e) => {
      const actionBtn = e.target.closest('[class*="action-btn-"]');
      if (actionBtn && actionBtn.dataset.taskId) {
        const taskId = actionBtn.dataset.taskId;
        e.preventDefault();
        e.stopPropagation();

        if (actionBtn.classList.contains("action-btn-complete")) {
          this.updateTaskStatus(taskId, true);
        } else if (actionBtn.classList.contains("action-btn-reopen")) {
          this.updateTaskStatus(taskId, false);
        } else if (actionBtn.classList.contains("action-btn-edit")) {
          this.editTask(taskId);
        } else if (actionBtn.classList.contains("action-btn-delete")) {
          this.deleteTask(taskId);
        }
        return;
      }

      if (e.target.closest("button, input, a, label")) return;

      const row = e.target.closest(".task-row");
      if (row && row.dataset.taskId) {
        const isCompleted = row.classList.contains("completed-row");
        this.updateTaskStatus(row.dataset.taskId, !isCompleted);
      }
    };

    container._clickHandler = clickHandler;
    container.addEventListener("click", clickHandler);

    const selectAllPending = document.getElementById("select-all-pending");
    if (selectAllPending) {
      const selectAllHandler = (e) => {
        document.querySelectorAll(".pending-checkbox").forEach((cb) => (cb.checked = e.target.checked));
        this.updateBulkBar();
      };
      selectAllPending._handler = selectAllHandler;
      selectAllPending.addEventListener("change", selectAllHandler);
      this.eventListeners.push({ element: selectAllPending, event: "change", handler: selectAllHandler });
    }

    const selectAllCompleted = document.getElementById("select-all-completed");
    if (selectAllCompleted) {
      const selectAllHandler = (e) => {
        document.querySelectorAll(".completed-checkbox").forEach((cb) => (cb.checked = e.target.checked));
        this.updateBulkBar();
      };
      selectAllCompleted._handler = selectAllHandler;
      selectAllCompleted.addEventListener("change", selectAllHandler);
      this.eventListeners.push({ element: selectAllCompleted, event: "change", handler: selectAllHandler });
    }

    // Individual checkbox → refresh bulk bar.
    container.addEventListener("change", (e) => {
      if (e.target.classList?.contains("task-checkbox")) {
        this.updateBulkBar();
      }
    });
  };

  // ------------------------------------------------------------------
  // Status update
  // ------------------------------------------------------------------

  WM.updateTaskStatus = async function (taskId, completed, opts = {}) {
    const { silent = false } = opts;
    try {
      if (typeof Utils === "undefined") throw new Error("Utils module not available");

      const result = await Utils.makeRequest(`/api/tasks/${taskId}`, "PUT", {
        TrangThaiThucHien: completed ? 2 : 0,
      });

      if (!result.success) throw new Error(result.message || "Cập nhật thất bại");

      this.triggerSidebarRefresh();
      if (window.GroupDetailSection?.current) {
        window.GroupDetailSection.load(window.GroupDetailSection.current.GroupID);
      }

      if (!silent) {
        const msg = completed ? "Đã hoàn thành công việc" : "Đã mở lại công việc";
        this.showSuccessOverlay(msg);
        await this.loadTasks();
      }
    } catch (err) {
      console.error("Error updating task:", err);
      if (!silent && typeof Utils !== "undefined" && Utils.showToast) {
        Utils.showToast("Cập nhật trạng thái thất bại", "error");
      }
    }
  };

  // ------------------------------------------------------------------
  // Delete task (with SweetAlert2 if available, native confirm fallback)
  // ------------------------------------------------------------------

  WM.deleteTask = async function (taskId, opts = {}) {
    const { silent = false } = opts;
    try {
      if (typeof Utils === "undefined") throw new Error("Utils module not available");

      const taskRow = document.getElementById(`task-${taskId}`);
      const taskTitle = taskRow?.querySelector("td:nth-child(2) .font-medium")?.textContent || "Công việc này";

      if (typeof Swal === "undefined") {
        // Fallback: native confirm (skip in silent/bulk mode).
        if (!silent) {
          if (!await Utils.confirmDanger(`Xoá công việc "${taskTitle}"?`, "Xoá công việc")) {
            Utils?.showToast?.("Đã hủy xóa", "info");
            return;
          }
        }

        const result = await Utils.makeRequest(`/api/tasks/${taskId}`, "DELETE");
        if (result.success) {
          if (!silent) Utils?.showToast?.("Đã xóa công việc thành công", "success");
          if (!silent) await this.loadTasks();
          document.dispatchEvent(new CustomEvent("taskDeleted", { detail: { taskId } }));
          this.triggerSidebarRefresh();
        } else {
          throw new Error(result.message || "Xóa thất bại");
        }
        return;
      }

      // SweetAlert2 path.
      const confirmation = await Swal.fire({
        title: "Xác nhận xóa",
        html: `Bạn có chắc chắn muốn xóa công việc "<strong>${taskTitle}</strong>"?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Xóa",
        cancelButtonText: "Hủy",
        reverseButtons: true,
      });

      if (!confirmation.isConfirmed) {
        Utils?.showToast?.("Đã hủy xóa", "info");
        return;
      }

      const result = await Utils.makeRequest(`/api/tasks/${taskId}`, "DELETE");

      if (result.success) {
        await Swal.fire({ title: "Đã xóa!", text: result.message || "Công việc đã được xóa thành công.", icon: "success", timer: 1500, showConfirmButton: false });
        const row = document.getElementById(`task-${taskId}`);
        if (row) {
          row.style.animation = "fadeOut 0.3s ease-out forwards";
          setTimeout(() => row.remove(), 300);
        }
        await this.loadTasks();
        document.dispatchEvent(new CustomEvent("taskDeleted", { detail: { taskId } }));
      } else if (result.requireConfirmation) {
        const force = await Swal.fire({
          title: "Xác nhận thêm",
          html: `${result.message}<br><br>${result.details}<br><br>Bạn vẫn muốn xóa?`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonColor: "#d33",
          cancelButtonColor: "#3085d6",
          confirmButtonText: "Vẫn xóa",
          cancelButtonText: "Hủy",
        });

        if (force.isConfirmed) {
          const forceResult = await Utils.makeRequest(`/api/tasks/${taskId}?force=true`, "DELETE");
          if (forceResult.success) {
            await Swal.fire({ title: "Đã xóa!", text: forceResult.message || "Công việc đã được xóa thành công.", icon: "success", timer: 2000, showConfirmButton: false });
            await this.loadTasks();
            document.dispatchEvent(new CustomEvent("taskDeleted", { detail: { taskId } }));
          } else {
            throw new Error(forceResult.message || "Xóa thất bại");
          }
        }
      } else {
        throw new Error(result.message || "Xóa thất bại");
      }
    } catch (err) {
      console.error("Error deleting task:", err);
      if (typeof Swal !== "undefined") {
        await Swal.fire({ title: "Lỗi!", text: err.message || "Không thể xóa công việc.", icon: "error", confirmButtonText: "Đóng" });
      } else {
        Utils?.showToast?.(err.message || "Không thể xóa công việc", "error");
      }
    }
  };

  // ------------------------------------------------------------------
  // Edit task (open createTaskModal pre-filled)
  // ------------------------------------------------------------------

  WM.editTask = function (taskId) {
    Utils.makeRequest(`/api/tasks/${taskId}`, "GET")
      .then((result) => {
        if (result.success && result.data) {
          if (window.ModalManager?.showModalById) {
            window.ModalManager.showModalById("createTaskModal");
            setTimeout(() => {
              if (window.loadTaskDataIntoForm) {
                window.loadTaskDataIntoForm(result.data);
              } else {
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
        console.error("Error loading task:", err);
        Utils?.showToast?.("Lỗi tải công việc: " + err.message, "error");
      });
  };

  // ------------------------------------------------------------------
  // Bulk operations
  // ------------------------------------------------------------------

  WM.bulkComplete = async function () {
    const { pending } = this.getSelectedByStatus();
    if (pending.length === 0) return;
    if (!await Utils.confirm(`Đánh dấu ${pending.length} công việc là đã hoàn thành?`)) return;
    await Promise.all(pending.map((id) => this.updateTaskStatus(id, true, { silent: true })));
    Utils?.showToast?.(`Đã hoàn thành ${pending.length} công việc`, "success");
    await this.loadTasks();
    this.updateBulkBar();
  };

  WM.bulkRestore = async function () {
    const { completed } = this.getSelectedByStatus();
    if (completed.length === 0) return;
    if (!await Utils.confirm(`Khôi phục ${completed.length} công việc về danh sách đang làm?`)) return;
    await Promise.all(completed.map((id) => this.updateTaskStatus(id, false, { silent: true })));
    Utils?.showToast?.(`Đã khôi phục ${completed.length} công việc`, "success");
    await this.loadTasks();
    this.updateBulkBar();
  };

  WM.bulkDelete = async function () {
    const ids = this.getSelectedTaskIds();
    if (ids.length === 0) return;
    if (!await Utils.confirmDanger(`Xoá ${ids.length} công việc? Hành động không thể khôi phục.`, "Xoá hàng loạt")) return;
    await Promise.all(ids.map((id) => this.deleteTask(id, { silent: true })));
    Utils?.showToast?.(`Đã xoá ${ids.length} công việc`, "success");
    await this.loadTasks();
    this.updateBulkBar();
  };

  // ------------------------------------------------------------------
  // Event listener cleanup
  // ------------------------------------------------------------------

  WM.removeEventListeners = function () {
    this.eventListeners.forEach(({ element, event, handler }) => {
      if (element?.removeEventListener) element.removeEventListener(event, handler);
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

    const selectAllPending = document.getElementById("select-all-pending");
    if (selectAllPending?._handler) {
      selectAllPending.removeEventListener("change", selectAllPending._handler);
      selectAllPending._handler = null;
    }

    const selectAllCompleted = document.getElementById("select-all-completed");
    if (selectAllCompleted?._handler) {
      selectAllCompleted.removeEventListener("change", selectAllCompleted._handler);
      selectAllCompleted._handler = null;
    }
  };

  // ------------------------------------------------------------------
  // Sidebar refresh trigger
  // ------------------------------------------------------------------

  WM.triggerSidebarRefresh = function () {
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
  };

  // ------------------------------------------------------------------
  // Cleanup (clear timeouts + remove listeners + reset state)
  // ------------------------------------------------------------------

  WM.cleanup = function () {
    if (this.showSuccessOverlayTimeout) {
      clearTimeout(this.showSuccessOverlayTimeout);
      this.showSuccessOverlayTimeout = null;
    }
    if (this.hideSuccessOverlayTimeout) {
      clearTimeout(this.hideSuccessOverlayTimeout);
      this.hideSuccessOverlayTimeout = null;
    }
    this.removeEventListeners();
    this.initialized = false;
  };

  console.log("Work Manager Actions v1.0 ready");
})();
