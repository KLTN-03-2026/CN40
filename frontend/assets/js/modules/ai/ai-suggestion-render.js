// ai-suggestion-render.js — extends AIHandler with HTML rendering methods:
// renderTasksToModal, showAIPreview, resetToFormView, setupPreviewEventListeners,
// and static HTML helpers (getEmptyStateHTML, getSuccessHTML, etc.)
// Depends on: ai-suggestion-handler.js (must be loaded first)
(function () {
  "use strict";

  const AH = window.AIHandler;
  if (!AH) {
    console.error("ai-suggestion-render.js: AIHandler not found");
    return;
  }

  // ------------------------------------------------------------------
  // Task list rendering
  // ------------------------------------------------------------------

  AH.renderTasksToModal = function (tasks, taskList) {
    if (!taskList) return;

    this._lastTasks    = Array.isArray(tasks) ? tasks.slice() : [];
    this._lastTaskList = taskList;

    if (!tasks || tasks.length === 0) {
      taskList.innerHTML = this.getEmptyStateHTML();
      this.updateTaskStats(0);
      return;
    }

    let rendered = tasks;
    if (window.TaskSorter && this._sortState.criterion) {
      rendered = window.TaskSorter.sortTasks(tasks, this._sortState.criterion, this._sortState.direction, "ai");
    }

    let html = "";
    rendered.forEach((task) => {
      const priorityClass = `priority-${task.priority}`;
      const duration = task.estimatedMinutes || 60;
      html += `
        <div class="task-item selectable" data-task-id="${task.id}" data-selected="false">
          <label class="task-checkbox-label">
            <input type="checkbox" class="task-checkbox" value="${task.id}" data-task-id="${task.id}" style="display:none;">
            <span class="checkmark"></span>
          </label>
          <div class="task-content">
            <div class="task-title">${this.escapeHtml(task.title)}</div>
            <div class="task-details">
              <span class="task-priority ${priorityClass}">Ưu tiên ${task.priority}</span>
              <span class="task-duration"><i class="far fa-clock"></i>${duration} phút</span>
            </div>
          </div>
          <div class="task-color" style="background-color:${task.color}"></div>
        </div>`;
    });

    taskList.innerHTML = html;
    this.updateTaskStats(tasks.length);
    this.setupTaskItemClickEvents();
  };

  AH.setupTaskItemClickEvents = function () {
    const taskItems = document.querySelectorAll("#aiSuggestionModal .task-item.selectable");
    taskItems.forEach((item) => {
      const newItem = item.cloneNode(true);
      item.parentNode.replaceChild(newItem, item);
      newItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleTaskSelection(newItem);
      });
    });
  };

  // ------------------------------------------------------------------
  // AI preview rendering
  // ------------------------------------------------------------------

  AH.showAIPreview = async function (suggestions, summary, statistics, originalFormData = null) {
    const modal = document.getElementById("aiSuggestionModal");
    if (!modal) return;
    const modalBody = modal.querySelector(".ai-modal-body");
    if (!modalBody) return;

    if (originalFormData) modalBody.dataset.originalFormData = JSON.stringify(originalFormData);

    let taskDetailsMap = {};
    if (originalFormData?.tasks) {
      try {
        const tasks = await this.loadPendingTasks();
        tasks.forEach((task) => {
          if (originalFormData.tasks.includes(parseInt(task.id))) {
            taskDetailsMap[task.id] = task.title;
          }
        });
      } catch (e) { /* non-critical */ }
    }

    let previewHTML = `
      <div class="ai-preview-container" style="padding:20px;">
        <div class="preview-header" style="text-align:center;margin-bottom:25px;">
          <div style="font-size:48px;color:#8B5CF6;margin-bottom:10px;"><i class="fas fa-robot"></i></div>
          <h3 style="font-size:24px;font-weight:600;color:#1f2937;margin-bottom:8px;">Lịch Trình AI Đề Xuất</h3>
          <p style="color:#6b7280;font-size:16px;">${summary || "Lịch trình được tạo tự động bởi AI"}</p>
        </div>

        <div class="preview-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:30px;">
          <div style="background:white;padding:15px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;">
            <div style="font-size:32px;font-weight:700;color:#8B5CF6;">${statistics?.totalTasks || suggestions.length}</div>
            <div style="font-size:14px;color:#6b7280;">Công việc</div>
          </div>
          <div style="background:white;padding:15px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;">
            <div style="font-size:32px;font-weight:700;color:#10B981;">${statistics?.totalHours || Math.round(suggestions.reduce((sum, s) => sum + (s.durationMinutes || 60), 0) / 60)}</div>
            <div style="font-size:14px;color:#6b7280;">Giờ làm việc</div>
          </div>
          <div style="background:white;padding:15px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;">
            <div style="font-size:32px;font-weight:700;color:#F59E0B;">${statistics?.daysUsed || new Set(suggestions.map((s) => new Date(s.scheduledTime).toDateString())).size}</div>
            <div style="font-size:14px;color:#6b7280;">Ngày</div>
          </div>
        </div>

        <div class="suggestions-list-container" style="max-height:350px;overflow-y:auto;margin-bottom:25px;padding-right:10px;">
          <h4 style="font-size:18px;font-weight:600;margin-bottom:15px;color:#374151;">
            <i class="fas fa-list-check"></i> Danh sách đề xuất (${suggestions.length})
          </h4>`;

    suggestions.forEach((s, index) => {
      const date    = new Date(s.scheduledTime);
      const dateStr = date.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
      const timeStr = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const taskTitle = taskDetailsMap[s.taskId] || s.taskTitle || `Công việc #${s.taskId}`;

      previewHTML += `
        <div class="suggestion-item" style="background:white;border-left:4px solid ${s.color || "#8B5CF6"};border-radius:6px;padding:15px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,0.05);display:flex;align-items:flex-start;">
          <div style="margin-right:15px;">
            <div style="width:36px;height:36px;background:${s.color || "#8B5CF6"};color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;">${index + 1}</div>
          </div>
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <strong style="font-size:16px;">${taskTitle}</strong>
              <span style="font-size:14px;color:#6b7280;">${s.durationMinutes || 60} phút</span>
            </div>
            <div style="font-size:14px;color:#4b5563;margin-bottom:5px;">
              <i class="far fa-calendar" style="margin-right:5px;"></i>${dateStr} • ${timeStr}
            </div>
            ${s.reason ? `<div style="font-size:13px;color:#6b7280;background:#f9fafb;padding:8px;border-radius:4px;margin-top:5px;"><i class="fas fa-lightbulb" style="margin-right:5px;color:#F59E0B;"></i>${s.reason}</div>` : ""}
          </div>
        </div>`;
    });

    previewHTML += `
        </div>

        <div class="preview-actions" style="display:flex;justify-content:center;gap:12px;margin-top:30px;">
          <button id="aiApplyBtn" class="btn btn-success" style="padding:12px 24px;background:#10B981;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-check-circle"></i> Áp dụng lịch trình
          </button>
          <button id="aiEditBtn" class="btn btn-secondary" style="padding:12px 24px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-edit"></i> Chỉnh sửa yêu cầu
          </button>
          <button id="aiBackBtn" class="btn btn-outline" style="padding:12px 24px;background:transparent;color:#6b7280;border:1px solid #d1d5db;border-radius:8px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-arrow-left"></i> Quay lại
          </button>
        </div>

        <div id="aiEditSection" style="display:none;margin-top:30px;padding:20px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
          <h5 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#374151;">
            <i class="fas fa-comment-dots"></i> Hướng dẫn chỉnh sửa cho AI
          </h5>
          <p style="font-size:14px;color:#6b7280;margin-bottom:15px;">Mô tả chi tiết các thay đổi bạn muốn AI điều chỉnh trong lịch trình</p>
          <textarea id="aiAdditionalInstructions"
            placeholder="Ví dụ:&#10;• Chuyển công việc sang buổi sáng&#10;• Giảm thời gian công việc xuống 45 phút&#10;• Tránh xếp việc vào thứ 6 chiều&#10;• Ưu tiên công việc quan trọng trước"
            style="width:100%;height:120px;padding:12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;resize:vertical;margin-bottom:15px;">${originalFormData?.additionalInstructions || ""}</textarea>
          <div style="display:flex;gap:10px;">
            <button id="aiResubmitBtn" class="btn btn-primary" style="padding:10px 20px;background:#3B82F6;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
              <i class="fas fa-paper-plane"></i> Gửi lại cho AI
            </button>
            <button id="aiCancelEditBtn" class="btn btn-outline" style="padding:10px 20px;background:transparent;color:#6b7280;border:1px solid #d1d5db;border-radius:6px;font-weight:600;cursor:pointer;">Hủy</button>
          </div>
        </div>

        <div style="margin-top:20px;padding:12px;background:#e0e7ff;border-radius:6px;border-left:4px solid #8B5CF6;font-size:14px;color:#4f46e5;">
          <i class="fas fa-info-circle" style="margin-right:8px;"></i>
          Lịch trình sẽ được thêm vào tab Lịch AI và hiển thị trên calendar
        </div>
      </div>`;

    modalBody.innerHTML = previewHTML;
    this.setupPreviewEventListeners(originalFormData, suggestions);
  };

  AH.setupPreviewEventListeners = function (originalFormData, suggestions) {
    const modalBody = document.querySelector("#aiSuggestionModal .ai-modal-body");
    if (!modalBody) return;

    modalBody.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      switch (button.id) {
        case "aiApplyBtn":
          event.preventDefault();
          this.applyAISuggestions(suggestions);
          break;
        case "aiEditBtn":
          event.preventDefault();
          document.getElementById("aiEditSection").style.display = "block";
          break;
        case "aiBackBtn":
          event.preventDefault();
          this.resetToFormView();
          break;
        case "aiResubmitBtn":
          event.preventDefault();
          this.resubmitWithInstructions(originalFormData);
          break;
        case "aiCancelEditBtn":
          event.preventDefault();
          document.getElementById("aiEditSection").style.display = "none";
          break;
      }
    });
  };

  // ------------------------------------------------------------------
  // Reset to form view (rebuild form HTML from scratch)
  // ------------------------------------------------------------------

  AH.resetToFormView = function () {
    const modal = document.getElementById("aiSuggestionModal");
    if (!modal) { this.showError("Modal không tồn tại"); return; }
    const modalBody = modal.querySelector(".ai-modal-body");
    if (!modalBody) { this.showError("Không thể reset form"); return; }

    delete modalBody.dataset.originalFormData;
    delete modalBody.dataset.suggestions;

    modalBody.innerHTML = `
      <form id="aiSuggestionForm">
        <div class="form-section">
          <div class="section-title"><i class="fas fa-calendar-alt"></i><span>Chọn Khoảng Thời Gian</span></div>
          <div class="date-range-grid">
            <div class="form-group">
              <label class="form-label">Từ ngày</label>
              <input type="date" id="aiStartDate" class="date-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Đến ngày</label>
              <input type="date" id="aiEndDate" class="date-input" required />
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="section-header">
            <div class="section-title"><i class="fas fa-tasks"></i><span>Chọn Công Việc</span></div>
            <button type="button" class="btn-select-all" id="selectAllTasksBtn">
              <i class="fas fa-check-double"></i><span>Chọn tất cả</span>
            </button>
          </div>
          <div id="aiSortControls" class="mb-2"></div>
          <div class="task-list-container">
            <div class="task-list" id="aiTaskList">
              <div class="loading-state">
                <div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i></div>
                <p>Đang tải công việc...</p>
              </div>
            </div>
            <div class="task-stats" id="aiTaskStats">Đã chọn: <strong>0</strong> công việc</div>
          </div>
        </div>

        <div class="form-section">
          <div class="section-title"><i class="fas fa-sliders-h"></i><span>Tùy Chọn AI</span></div>
          <div class="ai-options-grid">
            <label class="ai-option">
              <input type="checkbox" id="aiOptionAvoidConflict" checked />
              <div class="option-content">
                <div class="option-icon"><i class="fas fa-shield-alt"></i></div>
                <div class="option-text"><strong>Tránh trùng lịch</strong><small>Không xếp vào khung giờ đã có</small></div>
              </div>
            </label>
            <label class="ai-option">
              <input type="checkbox" id="aiOptionConsiderPriority" checked />
              <div class="option-content">
                <div class="option-icon"><i class="fas fa-star"></i></div>
                <div class="option-text"><strong>Ưu tiên quan trọng</strong><small>Xếp việc quan trọng trước</small></div>
              </div>
            </label>
            <label class="ai-option">
              <input type="checkbox" id="aiOptionBalanceWorkload" checked />
              <div class="option-content">
                <div class="option-icon"><i class="fas fa-balance-scale"></i></div>
                <div class="option-text"><strong>Cân bằng khối lượng</strong><small>Phân đều công việc các ngày</small></div>
              </div>
            </label>
          </div>
        </div>
      </form>`;

    this.setDefaultDates();
    setTimeout(async () => {
      await this.populateAIModal();
      this.setupAllEventListeners();
    }, 100);
  };

  // ------------------------------------------------------------------
  // Static HTML helpers
  // ------------------------------------------------------------------

  AH.getLoadingHTML = function () {
    return `
      <div class="loading-state" style="text-align:center;padding:40px;">
        <div class="loading-spinner" style="display:inline-block;">
          <i class="fas fa-spinner fa-spin" style="font-size:32px;color:#8B5CF6;"></i>
        </div>
        <p style="margin-top:20px;color:#666;">Đang tải danh sách công việc...</p>
      </div>`;
  };

  AH.getEmptyStateHTML = function () {
    return `
      <div class="empty-state" style="text-align:center;padding:40px;">
        <i class="fas fa-tasks" style="font-size:48px;color:#ccc;margin-bottom:20px;"></i>
        <p style="font-size:16px;color:#666;">Không có công việc nào chưa hoàn thành</p>
        <p class="text-sm text-gray-500 mt-2">Hãy tạo công việc mới trước khi sử dụng AI</p>
      </div>`;
  };

  AH.getSuccessHTML = function (result) {
    const suggestionCount  = result.suggestions?.length || 0;
    const summary          = result.summary || `Đã tạo ${suggestionCount} khung giờ`;
    const stats            = result.statistics || {};
    const previewSuggestions = result.suggestions?.slice(0, 3) || [];

    let suggestionsHTML = "";
    previewSuggestions.forEach((suggestion) => {
      const date    = new Date(suggestion.scheduledTime);
      const timeStr = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const dateStr = date.toLocaleDateString("vi-VN");
      suggestionsHTML += `
        <div class="suggestion-item" style="padding:15px;margin:10px 0;border-left:3px solid #8B5CF6;background:#f9fafb;">
          <i class="far fa-calendar-check" style="color:#8B5CF6;margin-right:10px;"></i>
          <div class="suggestion-info" style="display:inline-block;">
            <strong>Công việc #${suggestion.taskId}</strong>
            <small style="display:block;color:#666;">${dateStr} lúc ${timeStr} (${suggestion.durationMinutes} phút)</small>
            <div class="text-xs text-gray-500 mt-1">${suggestion.reason || ""}</div>
          </div>
        </div>`;
    });
    if (suggestionCount > 3) {
      suggestionsHTML += `<div style="text-align:center;padding:15px;color:#666;">+ ${suggestionCount - 3} đề xuất khác</div>`;
    }

    return `
      <div class="ai-summary-section" style="padding:20px;">
        <div class="summary-header success" style="text-align:center;margin-bottom:30px;">
          <i class="fas fa-check-circle" style="font-size:64px;color:#10B981;margin-bottom:20px;"></i>
          <h4 style="font-size:24px;font-weight:600;margin:0;">AI đã tạo lịch trình thành công!</h4>
        </div>
        <p style="text-align:center;font-size:16px;margin-bottom:30px;"><strong>${summary}</strong></p>
        <div class="ai-stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:30px;">
          <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:8px;">
            <i class="fas fa-tasks" style="font-size:32px;color:#8B5CF6;margin-bottom:10px;"></i>
            <strong style="display:block;font-size:24px;">${stats.totalTasks || suggestionCount}</strong>
            <small style="color:#666;">Công việc</small>
          </div>
          <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:8px;">
            <i class="fas fa-clock" style="font-size:32px;color:#3B82F6;margin-bottom:10px;"></i>
            <strong style="display:block;font-size:24px;">${stats.totalHours || Math.round(suggestionCount * 1.5)}</strong>
            <small style="color:#666;">Giờ</small>
          </div>
          <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:8px;">
            <i class="fas fa-calendar-days" style="font-size:32px;color:#10B981;margin-bottom:10px;"></i>
            <strong style="display:block;font-size:24px;">${stats.daysUsed || 1}</strong>
            <small style="color:#666;">Ngày</small>
          </div>
        </div>
        <div class="suggestions-preview" style="margin-bottom:30px;">
          <h5 style="font-size:18px;font-weight:600;margin-bottom:15px;">Xem trước đề xuất:</h5>
          <div class="suggestions-list">${suggestionsHTML}</div>
        </div>
        <div style="padding:15px;background:#EEF2FF;border-radius:8px;margin-bottom:20px;">
          <i class="fas fa-lightbulb" style="color:#8B5CF6;margin-right:10px;"></i>
          Những đề xuất này đã được thêm vào lịch AI của bạn
        </div>
        <div class="mt-6 text-center">
          <button class="btn btn-primary" onclick="location.reload()" style="padding:12px 30px;background:#8B5CF6;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;">
            <i class="fas fa-redo"></i> Tải lại trang
          </button>
        </div>
      </div>`;
  };

  AH.displaySuccessResults = function (result) {
    const modalBody = document.querySelector("#aiSuggestionModal .ai-modal-body");
    if (!modalBody) return;
    modalBody.innerHTML = this.getSuccessHTML(result);
    const modalFooter = document.querySelector("#aiSuggestionModal .ai-modal-footer");
    if (modalFooter) modalFooter.style.display = "none";
  };

  console.log("AI Suggestion Render v1.0 ready");
})();
