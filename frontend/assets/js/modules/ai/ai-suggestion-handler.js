// ai-suggestion-handler.js — AIHandler core: init, form data, API submit,
// apply suggestions, modal close, utility helpers.
// Heavy rendering lives in ai-suggestion-render.js (loaded after this file).
(() => {
  "use strict";

  if (window.AIHandler) {
    console.log("AIHandler đã tồn tại → bỏ qua load lại");
    return;
  }

  const AIHandler = {
    API_ENDPOINTS: {
      suggestSchedule: "/api/ai/suggest-schedule",
      getTasks: "/api/tasks",
      getCalendarEvents: "/api/calendar/events",
    },

    _isModalInitialized: false,
    _isSubmitting: false,
    _lastTasks: [],
    _lastTaskList: null,
    _sortCtrl: null,
    _sortState: { criterion: null, direction: "asc" },

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    async initAIModal() {
      if (this._isModalInitialized) {
        try { await this.populateAIModal(); } catch (error) {
          console.error("Error reloading tasks:", error);
          this.showErrorInModal(error.message);
        }
        return;
      }

      try {
        await this.waitForModalReady();
        await this.populateAIModal();
        this.setupAllEventListeners();
        this.setDefaultDates();
        this._isModalInitialized = true;
      } catch (error) {
        console.error("Error initializing AI modal:", error);
        this.showErrorInModal(error.message || "Không thể khởi tạo modal");
      }
    },

    async waitForModalReady() {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 50;
        const check = () => {
          attempts++;
          const modal     = document.getElementById("aiSuggestionModal");
          const modalBody = modal?.querySelector(".ai-modal-body");
          if (modal && modalBody) return resolve(true);
          if (attempts >= maxAttempts) return reject(new Error("Modal not ready after maximum attempts"));
          setTimeout(check, 100);
        };
        check();
      });
    },

    // ------------------------------------------------------------------
    // Task loading
    // ------------------------------------------------------------------

    async loadPendingTasks() {
      try {
        if (!Utils?.makeRequest) return [];
        const res = await Utils.makeRequest("/api/tasks", "GET");
        if (!res.success || !Array.isArray(res.data)) return [];

        const pendingTasks = res.data.filter((task) => {
          const status = task.TrangThaiThucHien;
          return status !== 1 && status !== true;
        });

        const getColorByPriority = (priority) => {
          switch (parseInt(priority)) {
            case 1: return "#10B981";
            case 2: return "#3B82F6";
            case 3: return "#F59E0B";
            case 4: return "#EF4444";
            default: return "#8B5CF6";
          }
        };

        const timeMap = { 1: "morning", 2: "noon", 3: "afternoon", 4: "evening", 5: "anytime" };

        return pendingTasks.map((task) => {
          const priority = task.MucDoUuTien || task.priority || 2;
          return {
            id:               task.MaCongViec || task.ID || `task-${Date.now()}`,
            title:            task.TieuDe || task.title || "Không tiêu đề",
            estimatedMinutes: task.ThoiGianUocTinh || task.estimatedMinutes || 60,
            priority,
            complexity:       task.MucDoPhucTap || task.complexity || 2,
            focusLevel:       task.MucDoTapTrung || task.focusLevel || 2,
            suitableTime:     timeMap[task.ThoiDiemThichHop] || "anytime",
            category:         task.TenLoai || task.LoaiCongViec?.TenLoai || null,
            color:            getColorByPriority(priority),
          };
        });
      } catch (error) {
        console.error("Error loading pending tasks:", error);
        return [];
      }
    },

    // ------------------------------------------------------------------
    // Modal populate
    // ------------------------------------------------------------------

    async populateAIModal() {
      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) { this.showErrorInModal("Không tìm thấy modal"); return; }

      const modalBody = modal.querySelector(".ai-modal-body");
      if (!modalBody) { this.showErrorInModal("Không tìm thấy nội dung modal"); return; }

      if (modalBody.querySelector("#aiApplyBtn")) return; // already in preview mode

      if (!modalBody.querySelector("#aiSuggestionForm")) {
        await this.resetToFormView();
        return;
      }

      const tasks = await this.loadPendingTasks();
      this.mountAISortControls(modal);

      const taskList = modal.querySelector("#aiTaskList");
      if (taskList) {
        this.renderTasksToModal(tasks, taskList);
      } else {
        const taskListContainer = modal.querySelector(".task-list-container");
        if (taskListContainer) {
          const newTaskList = document.createElement("div");
          newTaskList.className = "task-list";
          newTaskList.id = "aiTaskList";
          taskListContainer.insertBefore(newTaskList, taskListContainer.querySelector(".task-stats"));
          this.renderTasksToModal(tasks, newTaskList);
        }
      }
    },

    mountAISortControls(modal) {
      if (!modal || !window.SortControls) return;
      const host = modal.querySelector("#aiSortControls");
      if (!host || host.childElementCount > 0) return;
      this._sortCtrl  = window.SortControls.mount(host, {
        storageKey: "sort.ai-modal",
        onChange: (state) => {
          this._sortState = state;
          if (this._lastTaskList) this.renderTasksToModal(this._lastTasks, this._lastTaskList);
        },
      });
      this._sortState = this._sortCtrl.getState();
    },

    // ------------------------------------------------------------------
    // Event listeners
    // ------------------------------------------------------------------

    setupAllEventListeners() {
      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) return;

      const selectAllBtn = modal.querySelector("#selectAllTasksBtn");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.toggleSelectAll(); });
      }

      const submitBtn = modal.querySelector("#aiSubmitBtn");
      if (submitBtn) {
        submitBtn.addEventListener("click", (e) => {
          e.preventDefault();
          if (this._isSubmitting) return;
          this._isSubmitting = true;
          this.handleFormSubmitAction().finally(() => { this._isSubmitting = false; });
        });
      }

      const closeBtn = modal.querySelector(".modal-close");
      if (closeBtn) closeBtn.addEventListener("click", (e) => { e.preventDefault(); this.closeModal(); });

      const overlay = modal.querySelector(".modal-overlay");
      if (overlay) overlay.addEventListener("click", () => { this.closeModal(); });

      this.setupCheckboxListeners();
    },

    setupCheckboxListeners() {
      const taskList = document.querySelector("#aiSuggestionModal #aiTaskList");
      if (!taskList) return;
      taskList.addEventListener("change", (e) => {
        if (e.target.classList.contains("task-checkbox")) this.updateSelectedCount();
      });
    },

    // ------------------------------------------------------------------
    // Form submit
    // ------------------------------------------------------------------

    async handleFormSubmitAction() {
      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) { this.showError("Không tìm thấy modal AI"); return; }

      const form = modal.querySelector("#aiSuggestionForm");
      if (!form) {
        if (modal.querySelector(".ai-preview-container")) return; // already in preview
        this.showError("Không tìm thấy form. Vui lòng đóng và mở lại modal.");
        return;
      }

      const startDate = modal.querySelector("#aiStartDate")?.value;
      const endDate   = modal.querySelector("#aiEndDate")?.value;
      if (!startDate || !endDate) { this.showError("Vui lòng chọn ngày bắt đầu và kết thúc"); return; }

      const selectedTasks = [];
      modal.querySelectorAll(".task-checkbox:checked").forEach((cb) => {
        const taskId = parseInt(cb.value);
        if (!isNaN(taskId) && taskId > 0) selectedTasks.push(taskId);
      });

      if (selectedTasks.length === 0) { this.showError("Vui lòng chọn ít nhất một công việc"); return; }

      const payload = {
        tasks: selectedTasks,
        startDate: `${startDate}T00:00:00`,
        endDate:   `${endDate}T23:59:59`,
        options: {
          avoidConflict:     modal.querySelector("#aiOptionAvoidConflict")?.checked  ?? true,
          considerPriority:  modal.querySelector("#aiOptionConsiderPriority")?.checked ?? true,
          balanceWorkload:   modal.querySelector("#aiOptionBalanceWorkload")?.checked  ?? true,
        },
        additionalInstructions: modal.querySelector("#aiAdditionalInstructions")?.value || "",
      };

      this.showFormLoading(true);
      try {
        const res = await Utils.makeRequest(this.API_ENDPOINTS.suggestSchedule, "POST", payload);
        this.showFormLoading(false);
        if (!res.success) throw new Error(res.message || "Lỗi từ server AI");

        const modalBody = modal.querySelector(".ai-modal-body");
        if (modalBody) modalBody.dataset.originalFormData = JSON.stringify(payload);

        this.showAIPreview(res.data.suggestions, res.data.summary, res.data.statistics, payload);
      } catch (error) {
        console.error("Lỗi submit form:", error);
        this.showFormLoading(false);
        this.showError(error.message || "Lỗi xử lý yêu cầu AI");
      }
    },

    // ------------------------------------------------------------------
    // Apply suggestions
    // ------------------------------------------------------------------

    async applyAISuggestions(suggestions) {
      try {
        if (!suggestions || suggestions.length === 0) { this.showError("Không có đề xuất nào để áp dụng"); return; }

        const applyBtn = document.getElementById("aiApplyBtn");
        if (applyBtn) { applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang áp dụng...'; applyBtn.disabled = true; }

        const saveResult = await this.saveAISuggestionsToDatabase(suggestions);
        if (!saveResult || !saveResult.success) { this.showError("Lỗi lưu lịch trình AI"); return; }

        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (window.AIModule && window.AIModule.refreshFromDatabase) {
          try { await AIModule.refreshFromDatabase(); } catch (err) { console.error("Error refreshing calendar:", err); }
        } else {
          setTimeout(() => location.reload(), 1000);
          return;
        }

        this.showSuccess(`✅ Đã áp dụng ${suggestions.length} lịch trình AI!`);
        setTimeout(() => {
          this.closeModal();
          setTimeout(() => { document.querySelector('[data-tab="ai"]')?.click(); }, 300);
        }, 1500);
      } catch (error) {
        console.error("Error applying suggestions:", error);
        this.showError("Lỗi áp dụng lịch trình: " + error.message);
        const applyBtn = document.getElementById("aiApplyBtn");
        if (applyBtn) { applyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Áp dụng lịch trình'; applyBtn.disabled = false; }
      }
    },

    async saveAISuggestionsToDatabase(suggestions) {
      const token = localStorage.getItem("auth_token");
      if (!token) throw new Error("Không có token");
      const res = await fetch("/api/ai/save-ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ suggestions }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return { success: true, savedCount: data.saved || suggestions.length };
    },

    async addEventsToCalendar(suggestions) {
      try {
        if (!suggestions || suggestions.length === 0) return;
        await this.waitForAIModule();
        if (window.AIModule && window.AIModule.loadAISuggestions) {
          await AIModule.loadAISuggestions(suggestions);
        } else {
          this.showError("Không thể thêm lịch vào AI calendar");
        }
      } catch (error) {
        console.error("Error adding events to calendar:", error);
        this.showError("Lỗi thêm sự kiện vào lịch: " + error.message);
      }
    },

    async waitForAIModule(timeout = 10000) {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
          if (window.AIModule && window.AIModule.isInitialized && window.AIModule.calendar) return resolve(true);
          if (Date.now() - startTime > timeout) return reject(new Error("AIModule không sẵn sàng"));
          setTimeout(check, 200);
        };
        check();
      });
    },

    // ------------------------------------------------------------------
    // Resubmit with instructions
    // ------------------------------------------------------------------

    async resubmitWithInstructions(originalFormData = null) {
      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) { this.showError("Modal không tồn tại"); return; }

      const modalBody = modal.querySelector(".ai-modal-body");
      if (!originalFormData) {
        const savedData = modalBody?.dataset.originalFormData;
        if (!savedData) { this.showError("Không tìm thấy dữ liệu form gốc. Vui lòng tạo lại yêu cầu."); return; }
        try { originalFormData = JSON.parse(savedData); } catch (e) { this.showError("Không thể khôi phục dữ liệu form"); return; }
      }

      const instructions = modal.querySelector("#aiAdditionalInstructions")?.value?.trim() || "";
      if (!instructions) { this.showError("Vui lòng nhập hướng dẫn chỉnh sửa"); return; }

      const payload = { ...originalFormData, additionalInstructions: instructions };

      const resubmitBtn = modal.querySelector("#aiResubmitBtn");
      const editSection = modal.querySelector("#aiEditSection");
      const originalBtnHTML = resubmitBtn?.innerHTML;
      if (resubmitBtn) { resubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...'; resubmitBtn.disabled = true; }

      try {
        const res = await Utils.makeRequest(this.API_ENDPOINTS.suggestSchedule, "POST", payload);
        if (!res.success) throw new Error(res.message || "Lỗi từ server AI");
        if (editSection) editSection.style.display = "none";
        payload.additionalInstructions = instructions;
        if (modalBody) modalBody.dataset.originalFormData = JSON.stringify(payload);
        this.showAIPreview(res.data.suggestions, res.data.summary, res.data.statistics, payload);
      } catch (error) {
        console.error("Lỗi resubmit:", error);
        this.showError(error.message || "Lỗi gửi lại yêu cầu AI");
      } finally {
        if (resubmitBtn) { resubmitBtn.innerHTML = originalBtnHTML || '<i class="fas fa-paper-plane"></i> Gửi lại cho AI'; resubmitBtn.disabled = false; }
      }
    },

    // ------------------------------------------------------------------
    // Task selection helpers
    // ------------------------------------------------------------------

    toggleSelectAll() {
      const checkboxes = document.querySelectorAll("#aiSuggestionModal .task-checkbox");
      const taskItems  = document.querySelectorAll("#aiSuggestionModal .task-item.selectable");
      if (checkboxes.length === 0 || taskItems.length === 0) return;
      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
      const newState = !allChecked;
      checkboxes.forEach((cb) => { cb.checked = newState; });
      taskItems.forEach((item) => {
        item.dataset.selected = newState.toString();
        if (newState) item.classList.add("selected");
        else          item.classList.remove("selected");
      });
      this.updateSelectedCount();
    },

    toggleTaskSelection(taskItem) {
      if (!taskItem) return;
      const checkbox = taskItem.querySelector(".task-checkbox");
      if (!checkbox) return;
      const isCurrentlySelected = taskItem.dataset.selected === "true";
      const newState = !isCurrentlySelected;
      checkbox.checked = newState;
      taskItem.dataset.selected = newState.toString();
      const selectionIndicator = taskItem.querySelector(".selection-checkbox");
      if (selectionIndicator) {
        if (newState) {
          taskItem.classList.add("selected");
          selectionIndicator.innerHTML = '<i class="fas fa-check-circle" style="color: #10B981;"></i>';
        } else {
          taskItem.classList.remove("selected");
          selectionIndicator.innerHTML = '<i class="fas fa-check-circle" style="color: #ccc;"></i>';
        }
      }
      this.updateSelectedCount();
    },

    updateSelectedCount() {
      const selectedItems = document.querySelectorAll('#aiSuggestionModal .task-item[data-selected="true"]');
      const totalCount    = document.querySelectorAll("#aiSuggestionModal .task-item").length;
      const statsElement  = document.querySelector("#aiSuggestionModal #aiTaskStats");
      if (statsElement) {
        statsElement.innerHTML = `Đã chọn: <strong>${selectedItems.length}</strong> / <strong>${totalCount}</strong> công việc`;
      }
    },

    updateTaskStats(count) {
      const statsElement = document.querySelector("#aiSuggestionModal #aiTaskStats");
      if (statsElement) statsElement.innerHTML = `Đã chọn: <strong>0</strong> / <strong>${count}</strong> công việc`;
    },

    // ------------------------------------------------------------------
    // Date defaults
    // ------------------------------------------------------------------

    setDefaultDates() {
      const today    = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const startDateInput = document.getElementById("aiStartDate");
      const endDateInput   = document.getElementById("aiEndDate");
      if (startDateInput && endDateInput) {
        startDateInput.value = today.toISOString().split("T")[0];
        endDateInput.value   = nextWeek.toISOString().split("T")[0];
      }
    },

    // ------------------------------------------------------------------
    // Loading state
    // ------------------------------------------------------------------

    showFormLoading(show) {
      const submitBtn = document.getElementById("aiSubmitBtn");
      if (submitBtn) {
        submitBtn.disabled = show;
        submitBtn.innerHTML = show
          ? '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...'
          : '<i class="fas fa-magic"></i> Tạo Lịch Trình';
      }
    },

    // ------------------------------------------------------------------
    // Modal close / reset
    // ------------------------------------------------------------------

    closeModal() {
      this.resetModalForm();
      const modalFooter = document.querySelector("#aiSuggestionModal .ai-modal-footer");
      if (modalFooter) modalFooter.style.display = "flex";
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

    resetModalForm() {
      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) return;
      const taskList = modal.querySelector("#aiTaskList");
      if (taskList) {
        taskList.innerHTML = `<div class="loading-state"><div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i></div><p>Đang tải công việc...</p></div>`;
      }
      const statsElement = modal.querySelector("#aiTaskStats");
      if (statsElement) statsElement.innerHTML = `Đã chọn: <strong>0</strong> công việc`;
      this.setDefaultDates();
      modal.querySelectorAll(".task-checkbox").forEach((cb) => { cb.checked = false; });
      modal.querySelectorAll(".task-item.selectable").forEach((item) => {
        item.dataset.selected = "false";
        item.classList.remove("selected");
      });
      modal.querySelector("#aiSuggestionForm")?.reset();
      const editSection = modal.querySelector("#aiEditSection");
      if (editSection) editSection.style.display = "none";
    },

    // ------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------

    getPriorityColor(priority) {
      const colors = { 1: "#10B981", 2: "#3B82F6", 3: "#F59E0B", 4: "#EF4444" };
      return colors[priority] || "#8B5CF6";
    },

    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    },

    getSuitableTimeLabel(timeCode) {
      const timeMap = { morning: "Buổi sáng", noon: "Buổi trưa", afternoon: "Buổi chiều", evening: "Buổi tối", anytime: "Bất kỳ lúc nào" };
      return timeMap[timeCode] || timeCode;
    },

    showError(message) {
      console.error("Error:", message);
      if (window.Utils?.showToast) Utils.showToast(message, "error");
      else if (window.Utils?.alert) Utils.alert(message, "Lỗi", "error");
    },

    showSuccess(message) {
      if (window.Utils && Utils.showToast) Utils.showToast(message, "success");
    },

    showErrorInModal(message) {
      const modalBody = document.querySelector("#aiSuggestionModal .ai-modal-body");
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="error-state" style="text-align:center;padding:40px;">
            <i class="fas fa-exclamation-triangle" style="font-size:48px;color:#EF4444;margin-bottom:20px;"></i>
            <p style="font-size:18px;font-weight:600;margin-bottom:10px;">Không thể tải dữ liệu</p>
            <p style="color:#666;margin-bottom:20px;">${message || "Đã xảy ra lỗi"}</p>
            <button class="btn btn-primary" onclick="AIHandler.initAIModal()" style="padding:10px 20px;background:#3B82F6;color:white;border:none;border-radius:8px;cursor:pointer;">
              <i class="fas fa-redo"></i> Thử lại
            </button>
          </div>`;
      }
    },

    debugTaskIDs() {
      const taskItems = document.querySelectorAll("#aiSuggestionModal .task-item");
      console.log(`Found ${taskItems.length} task items`);
      taskItems.forEach((item, index) => {
        const checkbox = item.querySelector(".task-checkbox");
        console.log(`Task ${index}:`, { "data-task-id": item.dataset.taskId, "checkbox.value": checkbox?.value, "checkbox.checked": checkbox?.checked });
      });
      const checkedBoxes = document.querySelectorAll("#aiSuggestionModal .task-checkbox:checked");
      console.log(`${checkedBoxes.length} checkboxes checked`);
    },
  };

  window.AIHandler = AIHandler;
  console.log("AIHandler v9.3 đã sẵn sàng và được gắn vào window!");

  document.addEventListener("modalShown", (e) => {
    if (e.detail && e.detail.modalId === "aiSuggestionModal") {
      setTimeout(() => { AIHandler.initAIModal(); }, 300);
    }
  });

  window.debugAIHandler = function () {
    console.log("=== AI Handler Debug ===");
    console.log("AIHandler available:", !!window.AIHandler);
    console.log("Methods:", Object.keys(AIHandler));
    if (AIHandler.debugTaskIDs) AIHandler.debugTaskIDs();
  };

  console.log("AI Suggestion Handler v9.2 ready");
})();
