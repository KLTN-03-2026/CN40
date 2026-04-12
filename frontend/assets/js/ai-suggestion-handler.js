(() => {
  "use strict";

  if (window.AIHandler) {

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

    async initAIModal() {
      if (this._isModalInitialized) {

        try {
          await this.populateAIModal();
        } catch (error) {
          console.error(" Error reloading tasks:", error);
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
        console.error(" Error initializing AI modal:", error);
        this.showErrorInModal(error.message || "Không thể khởi tạo modal");
      }
    },

    async waitForModalReady() {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 50;

        const check = () => {
          attempts++;

          const modal = document.getElementById("aiSuggestionModal");
          const modalBody = modal?.querySelector(".ai-modal-body");

          if (modal && modalBody) {

            resolve(true);
          } else if (attempts >= maxAttempts) {
            console.error(" Modal check failed:", {
              modal: !!modal,
              modalBody: !!modalBody,
            });
            reject(new Error("Modal not ready after maximum attempts"));
          } else {
            if (attempts % 10 === 0) {

            }
            setTimeout(check, 100);
          }
        };
        check();
      });
    },

    async loadPendingTasks() {
      try {


        if (!Utils?.makeRequest) {
          console.warn("Utils.makeRequest không tồn tại");
          return [];
        }

        const res = await Utils.makeRequest("/api/tasks", "GET");

        if (!res.success || !Array.isArray(res.data)) {
          return [];
        }



        const pendingTasks = res.data.filter((task) => {
          const status = task.TrangThaiThucHien;
          const isPending = status !== 1 && status !== true;

          return isPending;
        });



        const tasks = pendingTasks.map((task) => {
          const priority = task.MucDoUuTien || task.priority || 2;

          const getColorByPriority = (priority) => {
            switch (parseInt(priority)) {
              case 1:
                return "#10B981";
              case 2:
                return "#3B82F6";
              case 3:
                return "#F59E0B";
              case 4:
                return "#EF4444";
              default:
                return "#8B5CF6";
            }
          };

          const timeMap = {
            1: "morning",
            2: "noon",
            3: "afternoon",
            4: "evening",
            5: "anytime",
          };

          return {
            id: task.MaCongViec || task.ID || `task-${Date.now()}`,
            title: task.TieuDe || task.title || "Không tiêu đề",
            estimatedMinutes:
              task.ThoiGianUocTinh || task.estimatedMinutes || 60,
            priority: priority,
            complexity: task.MucDoPhucTap || task.complexity || 2,
            focusLevel: task.MucDoTapTrung || task.focusLevel || 2,
            suitableTime: timeMap[task.ThoiDiemThichHop] || "anytime",
            color: getColorByPriority(priority),
          };
        });

        return tasks;
      } catch (error) {
        console.error(" Error loading pending tasks:", error);
        return [];
      }
    },

    async populateAIModal() {
      try {


        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          console.error(" AI modal not found");
          this.showErrorInModal("Không tìm thấy modal");
          return;
        }

        const modalBody = modal.querySelector(".ai-modal-body");
        if (!modalBody) {
          console.error(" Modal body not found");
          this.showErrorInModal("Không tìm thấy nội dung modal");
          return;
        }

        if (modalBody.querySelector("#aiApplyBtn")) {

          return;
        }

        if (!modalBody.querySelector("#aiSuggestionForm")) {

          await this.resetToFormView();
          return;
        }

        const tasks = await this.loadPendingTasks();


        const taskList = modal.querySelector("#aiTaskList");
        if (taskList) {
          this.renderTasksToModal(tasks, taskList);

        } else {
          console.error("❌ Task list element not found");
          const taskListContainer = modal.querySelector(".task-list-container");
          if (taskListContainer) {
            const newTaskList = document.createElement("div");
            newTaskList.className = "task-list";
            newTaskList.id = "aiTaskList";
            taskListContainer.insertBefore(
              newTaskList,
              taskListContainer.querySelector(".task-stats")
            );
            this.renderTasksToModal(tasks, newTaskList);
          }
        }


      } catch (error) {
        console.error(" Error populating modal:", error);
        this.showErrorInModal(error.message);
      }
    },

    renderTasksToModal(tasks, taskList) {


      if (!taskList) {
        console.error(" Task list element không hợp lệ");
        return;
      }

      if (!tasks || tasks.length === 0) {
        taskList.innerHTML = this.getEmptyStateHTML();
        this.updateTaskStats(0);
        return;
      }

      let html = "";
      tasks.forEach((task) => {
        const priorityClass = `priority-${task.priority}`;
        const duration = task.estimatedMinutes || 60;

        html += `
      <div class="task-item selectable" data-task-id="${
        task.id
      }" data-selected="false">
        <label class="task-checkbox-label">
          <input type="checkbox"
                 class="task-checkbox"
                 value="${task.id}"
                 data-task-id="${task.id}"
                 style="display: none;">
          <span class="checkmark"></span>
        </label>
        <div class="task-content">
          <div class="task-title">${this.escapeHtml(task.title)}</div>
          <div class="task-details">
            <span class="task-priority ${priorityClass}">
              Ưu tiên ${task.priority}
            </span>
            <span class="task-duration">
              &#128336;
              ${duration} phút
            </span>
          </div>
        </div>
        <div class="task-color" style="background-color: ${task.color}"></div>
      </div>
    `;
      });

      taskList.innerHTML = html;
      this.updateTaskStats(tasks.length);

      this.setupTaskItemClickEvents();


    },
    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    },

    getSuitableTimeLabel(timeCode) {
      const timeMap = {
        morning: "Buổi sáng",
        noon: "Buổi trưa",
        afternoon: "Buổi chiều",
        evening: "Buổi tối",
        anytime: "Bất kỳ lúc nào",
      };
      return timeMap[timeCode] || timeCode;
    },

    getFormData() {
      try {


        const selectedItems = document.querySelectorAll(
          "#aiSuggestionModal .task-item[data-selected='true']"
        );

        const selectedTasks = [];
        selectedItems.forEach((item, index) => {
          const taskId = item.dataset.taskId;
          if (taskId) {
            const parsedId = parseInt(taskId);
            if (!isNaN(parsedId) && parsedId > 0) {
              selectedTasks.push(parsedId);

            }
          }
        });




        if (selectedTasks.length === 0) {
          this.showError("Vui lòng chọn ít nhất một công việc!");
          return null;
        }

        const startDate = document.getElementById("aiStartDate")?.value;
        const endDate = document.getElementById("aiEndDate")?.value;

        if (!startDate || !endDate) {
          this.showError("Vui lòng chọn khoảng thời gian!");
          return null;
        }

        const options = {
          avoidConflict:
            document.getElementById("aiOptionAvoidConflict")?.checked !== false,
          considerPriority:
            document.getElementById("aiOptionConsiderPriority")?.checked !==
            false,
          balanceWorkload:
            document.getElementById("aiOptionBalanceWorkload")?.checked !==
            false,
        };

        const formData = {
          tasks: selectedTasks,
          startDate,
          endDate,
          options,
        };


        return formData;
      } catch (error) {
        console.error(" Error getting form data:", error);
        this.showError("Lỗi lấy dữ liệu form: " + error.message);
        return null;
      }
    },

    setupTaskItemClickEvents() {
      const taskItems = document.querySelectorAll(
        "#aiSuggestionModal .task-item.selectable"
      );



      taskItems.forEach((item) => {
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);

        newItem.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleTaskSelection(newItem);
        });
      });


    },

    toggleTaskSelection(taskItem) {


      if (!taskItem) {
        console.error(" Task item is null");
        return;
      }

      const checkbox = taskItem.querySelector(".task-checkbox");


      if (!checkbox) {
        console.error(" Checkbox not found in task item");
        return;
      }

      const isCurrentlySelected = taskItem.dataset.selected === "true";
      const newSelectedState = !isCurrentlySelected;



      checkbox.checked = newSelectedState;

      taskItem.dataset.selected = newSelectedState.toString();

      const selectionIndicator = taskItem.querySelector(".selection-checkbox");
      if (selectionIndicator) {
        if (newSelectedState) {
          taskItem.classList.add("selected");
          selectionIndicator.innerHTML =
            '&#10003;';
        } else {
          taskItem.classList.remove("selected");
          selectionIndicator.innerHTML =
            '&#10003;';
        }
      }

      this.updateSelectedCount();


    },

    updateSelectedCount() {
      const selectedItems = document.querySelectorAll(
        '#aiSuggestionModal .task-item[data-selected="true"]'
      );
      const selectedCount = selectedItems.length;
      const totalCount = document.querySelectorAll(
        "#aiSuggestionModal .task-item"
      ).length;



      const statsElement = document.querySelector(
        "#aiSuggestionModal #aiTaskStats"
      );
      if (statsElement) {
        statsElement.innerHTML = `Đã chọn: <strong>${selectedCount}</strong> / <strong>${totalCount}</strong> công việc`;
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

    setupAllEventListeners() {


      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) return;



      const currentModal = modal;

      const selectAllBtn = currentModal.querySelector("#selectAllTasksBtn");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleSelectAll();
        });

      }

      const submitBtn = currentModal.querySelector("#aiSubmitBtn");
      if (submitBtn) {
        submitBtn.addEventListener("click", (e) => {
          e.preventDefault();

          if (this._isSubmitting) {
            console.warn(" Đang xử lý yêu cầu, vui lòng chờ...");
            return;
          }

          this._isSubmitting = true;
          this.handleFormSubmitAction().finally(() => {
            this._isSubmitting = false;
          });
        });

      }

      const closeBtn = currentModal.querySelector(".modal-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.closeModal();
        });
      }

      const overlay = currentModal.querySelector(".modal-overlay");
      if (overlay) {
        overlay.addEventListener("click", () => {
          this.closeModal();
        });
      }

      this.setupCheckboxListeners();


    },

    async handleFormSubmitAction() {
      try {
        const now = Date.now();
        if (!this._lastSubmitTime) this._lastSubmitTime = 0;
        const timeSinceLastSubmit = now - this._lastSubmitTime;
        this._lastSubmitTime = now;

        const clickCount = (this._submitClickCount =
          (this._submitClickCount || 0) + 1);


        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          this.showError("Không tìm thấy modal AI");
          return;
        }

        const form = modal.querySelector("#aiSuggestionForm");
        if (!form) {
          const previewContainer = modal.querySelector(".ai-preview-container");
          if (previewContainer) {

            return;
          }
          this.showError("Không tìm thấy form. Vui lòng đóng và mở lại modal.");
          return;
        }

        const startDate = modal.querySelector("#aiStartDate")?.value;
        const endDate = modal.querySelector("#aiEndDate")?.value;

        if (!startDate || !endDate) {
          this.showError("Vui lòng chọn ngày bắt đầu và kết thúc");
          return;
        }

        const selectedTasks = [];
        const checkboxes = modal.querySelectorAll(".task-checkbox:checked");

        checkboxes.forEach((checkbox) => {
          const taskId = parseInt(checkbox.value);
          if (!isNaN(taskId) && taskId > 0) {
            selectedTasks.push(taskId);
          }
        });

        if (selectedTasks.length === 0) {
          this.showError("Vui lòng chọn ít nhất một công việc");
          return;
        }

        const payload = {
          tasks: selectedTasks,
          startDate: `${startDate}T00:00:00`,
          endDate: `${endDate}T23:59:59`,
          options: {
            avoidConflict:
              modal.querySelector("#aiOptionAvoidConflict")?.checked ?? true,
            considerPriority:
              modal.querySelector("#aiOptionConsiderPriority")?.checked ?? true,
            balanceWorkload:
              modal.querySelector("#aiOptionBalanceWorkload")?.checked ?? true,
          },
          additionalInstructions:
            modal.querySelector("#aiAdditionalInstructions")?.value || "",
        };



        this.showFormLoading(true);

        const res = await Utils.makeRequest(
          this.API_ENDPOINTS.suggestSchedule,
          "POST",
          payload
        );

        this.showFormLoading(false);

        if (!res.success) {
          throw new Error(res.message || "Lỗi từ server AI");
        }

        const modalBody = modal.querySelector(".ai-modal-body");
        if (modalBody) {
          modalBody.dataset.originalFormData = JSON.stringify(payload);
        }

        this.showAIPreview(
          res.data.suggestions,
          res.data.summary,
          res.data.statistics,
          payload
        );
      } catch (error) {
        console.error(" Lỗi submit form:", error);
        this.showFormLoading(false);
        this.showError(error.message || "Lỗi xử lý yêu cầu AI");
      }
    },
    async showAIPreview(
      suggestions,
      summary,
      statistics,
      originalFormData = null
    ) {
      try {


        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          console.error(" Không tìm thấy modal");
          return;
        }

        const modalBody = modal.querySelector(".ai-modal-body");
        if (!modalBody) {
          console.error(" Không tìm thấy modal body");
          return;
        }

        if (originalFormData) {
          modalBody.dataset.originalFormData = JSON.stringify(originalFormData);
        }

        let taskDetailsMap = {};
        if (originalFormData?.tasks) {
          try {
            const tasks = await this.loadPendingTasks();
            tasks.forEach((task) => {
              if (originalFormData.tasks.includes(parseInt(task.id))) {
                taskDetailsMap[task.id] = task.title;
              }
            });
          } catch (e) {
            console.warn(" Không thể load task details:", e);
          }
        }

        let previewHTML = `
      <div class="ai-preview-container" style="padding: 20px;">
        <!-- Header -->
        <div class="preview-header" style="text-align: center; margin-bottom: 25px;">
          <div style="font-size: 48px; color: #8B5CF6; margin-bottom: 10px;">
            &#129302;
          </div>
          <h3 style="font-size: 24px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
             Lịch Trình AI Đề Xuất
          </h3>
          <p style="color: #6b7280; font-size: 16px;">${
            summary || "Lịch trình được tạo tự động bởi AI"
          }</p>
        </div>

        <!-- Statistics -->
        <div class="preview-stats" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">
          <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: #8B5CF6;">${
              statistics?.totalTasks || suggestions.length
            }</div>
            <div style="font-size: 14px; color: #6b7280;">Công việc</div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: #10B981;">${
              statistics?.totalHours ||
              Math.round(
                suggestions.reduce(
                  (sum, s) => sum + (s.durationMinutes || 60),
                  0
                ) / 60
              )
            }</div>
            <div style="font-size: 14px; color: #6b7280;">Giờ làm việc</div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: #F59E0B;">${
              statistics?.daysUsed ||
              new Set(
                suggestions.map((s) => new Date(s.scheduledTime).toDateString())
              ).size
            }</div>
            <div style="font-size: 14px; color: #6b7280;">Ngày</div>
          </div>
        </div>

        <!-- Suggestions List -->
        <div class="suggestions-list-container" style="max-height: 350px; overflow-y: auto; margin-bottom: 25px; padding-right: 10px;">
          <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #374151;">
            &#9745; Danh sách đề xuất (${
              suggestions.length
            })
          </h4>
    `;

        suggestions.forEach((s, index) => {
          const date = new Date(s.scheduledTime);
          const dateStr = date.toLocaleDateString("vi-VN", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          });
          const timeStr = date.toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          });

          const taskTitle =
            taskDetailsMap[s.taskId] || s.taskTitle || `Công việc #${s.taskId}`;

          previewHTML += `
        <div class="suggestion-item" style="
          background: white;
          border-left: 4px solid ${s.color || "#8B5CF6"};
          border-radius: 6px;
          padding: 15px;
          margin-bottom: 12px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          display: flex;
          align-items: flex-start;
        ">
          <div style="margin-right: 15px;">
            <div style="
              width: 36px;
              height: 36px;
              background: ${s.color || "#8B5CF6"};
              color: white;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 600;
              font-size: 14px;
            ">${index + 1}</div>
          </div>
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
              <strong style="font-size: 16px;">${taskTitle}</strong>
              <span style="font-size: 14px; color: #6b7280;">${
                s.durationMinutes || 60
              } phút</span>
            </div>
            <div style="font-size: 14px; color: #4b5563; margin-bottom: 5px;">
              &#128197;
              ${dateStr} • ${timeStr}
            </div>
            ${
              s.reason
                ? `
              <div style="font-size: 13px; color: #6b7280; background: #f9fafb; padding: 8px; border-radius: 4px; margin-top: 5px;">
                &#128161;
                ${s.reason}
              </div>
            `
                : ""
            }
          </div>
        </div>
      `;
        });

        previewHTML += `
        </div>

        <!-- Actions -->
        <div class="preview-actions" style="display: flex; justify-content: center; gap: 12px; margin-top: 30px;">
          <button id="aiApplyBtn" class="btn btn-success" style="
            padding: 12px 24px;
            background: #10B981;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            &#10003; Áp dụng lịch trình
          </button>

          <button id="aiEditBtn" class="btn btn-secondary" style="
            padding: 12px 24px;
            background: #f3f4f6;
            color: #374151;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            &#9998; Chỉnh sửa yêu cầu
          </button>

          <button id="aiBackBtn" class="btn btn-outline" style="
            padding: 12px 24px;
            background: transparent;
            color: #6b7280;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            &#8592; Quay lại
          </button>
        </div>

        <!-- Edit Section (hidden by default) -->
        <div id="aiEditSection" style="
          display: none;
          margin-top: 30px;
          padding: 20px;
          background: #f9fafb;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        ">
          <h5 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #374151;">
            &#128172; Hướng dẫn chỉnh sửa cho AI
          </h5>
          <p style="font-size: 14px; color: #6b7280; margin-bottom: 15px;">
            Mô tả chi tiết các thay đổi bạn muốn AI điều chỉnh trong lịch trình
          </p>

          <textarea id="aiAdditionalInstructions"
            placeholder="Ví dụ:
• Chuyển công việc sang buổi sáng
• Giảm thời gian công việc xuống 45 phút
• Tránh xếp việc vào thứ 6 chiều
• Ưu tiên công việc quan trọng trước"
            style="
              width: 100%;
              height: 120px;
              padding: 12px;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              font-size: 14px;
              resize: vertical;
              margin-bottom: 15px;
            ">${originalFormData?.additionalInstructions || ""}</textarea>

          <div style="display: flex; gap: 10px;">
            <button id="aiResubmitBtn" class="btn btn-primary" style="
              padding: 10px 20px;
              background: #3B82F6;
              color: white;
              border: none;
              border-radius: 6px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
            ">
              &#8594; Gửi lại cho AI
            </button>

            <button id="aiCancelEditBtn" class="btn btn-outline" style="
              padding: 10px 20px;
              background: transparent;
              color: #6b7280;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              font-weight: 600;
              cursor: pointer;
            ">
              Hủy
            </button>
          </div>
        </div>

        <!-- Note -->
        <div style="
          margin-top: 20px;
          padding: 12px;
          background: #e0e7ff;
          border-radius: 6px;
          border-left: 4px solid #8B5CF6;
          font-size: 14px;
          color: #4f46e5;
        ">
          &#8505;
          Lịch trình sẽ được thêm vào tab Lịch AI và hiển thị trên calendar
        </div>
      </div>
    `;

        modalBody.innerHTML = previewHTML;


        this.setupPreviewEventListeners(originalFormData, suggestions);
      } catch (error) {
        console.error(" Error rendering AI preview:", error);
        this.showError("Lỗi hiển thị preview: " + error.message);
      }
    },

    setupPreviewEventListeners(originalFormData, suggestions) {
      const modalBody = document.querySelector(
        "#aiSuggestionModal .ai-modal-body"
      );
      if (!modalBody) return;

      modalBody.addEventListener("click", (event) => {
        const target = event.target;
        const button = target.closest("button");

        if (!button) return;

        const buttonId = button.id;

        switch (buttonId) {
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
    },

    resetModalForm() {


      try {
        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          console.warn(" Modal không tồn tại");
          return;
        }

        const taskList = modal.querySelector("#aiTaskList");
        if (taskList) {
          taskList.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner">
            ...
          </div>
          <p>Đang tải công việc...</p>
        </div>
      `;
        }

        const statsElement = modal.querySelector("#aiTaskStats");
        if (statsElement) {
          statsElement.innerHTML = `Đã chọn: <strong>0</strong> công việc`;
        }

        this.setDefaultDates();

        const checkboxes = modal.querySelectorAll(".task-checkbox");
        checkboxes.forEach((cb) => {
          cb.checked = false;
        });

        const taskItems = modal.querySelectorAll(".task-item.selectable");
        taskItems.forEach((item) => {
          item.dataset.selected = "false";
          item.classList.remove("selected");
        });

        const form = modal.querySelector("#aiSuggestionForm");
        if (form) {
          form.reset();
        }

        const editSection = modal.querySelector("#aiEditSection");
        if (editSection) {
          editSection.style.display = "none";
        }


      } catch (error) {
        console.error(" Error resetting modal form:", error);
      }
    },

    async resubmitWithInstructions(originalFormData = null) {
      try {
        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          this.showError("Modal không tồn tại");
          return;
        }

        const modalBody = modal.querySelector(".ai-modal-body");
        if (!modalBody) {
          this.showError("Không tìm thấy modal body");
          return;
        }

        if (!originalFormData) {
          const savedData = modalBody.dataset.originalFormData;
          if (savedData) {
            try {
              originalFormData = JSON.parse(savedData);

            } catch (e) {
              console.error(" Lỗi parse form data:", e);
              this.showError("Không thể khôi phục dữ liệu form");
              return;
            }
          } else {
            this.showError(
              "Không tìm thấy dữ liệu form gốc. Vui lòng tạo lại yêu cầu."
            );
            return;
          }
        }

        const instructionsInput = modal.querySelector(
          "#aiAdditionalInstructions"
        );
        const instructions = instructionsInput?.value?.trim() || "";

        if (!instructions.trim()) {
          this.showError("Vui lòng nhập hướng dẫn chỉnh sửa");
          return;
        }

        const payload = {
          ...originalFormData,
          additionalInstructions: instructions,
        };



        const resubmitBtn = modal.querySelector("#aiResubmitBtn");
        const editSection = modal.querySelector("#aiEditSection");
        const originalBtnHTML = resubmitBtn?.innerHTML;

        if (resubmitBtn) {
          resubmitBtn.innerHTML =
            '... Đang xử lý...';
          resubmitBtn.disabled = true;
        }

        try {
          const res = await Utils.makeRequest(
            this.API_ENDPOINTS.suggestSchedule,
            "POST",
            payload
          );

          if (!res.success) {
            throw new Error(res.message || "Lỗi từ server AI");
          }

          if (editSection) {
            editSection.style.display = "none";
          }

          payload.additionalInstructions = instructions;
          modalBody.dataset.originalFormData = JSON.stringify(payload);

          this.showAIPreview(
            res.data.suggestions,
            res.data.summary,
            res.data.statistics,
            payload
          );
        } catch (error) {
          console.error(" Lỗi resubmit:", error);
          this.showError(error.message || "Lỗi gửi lại yêu cầu AI");
        } finally {
          if (resubmitBtn) {
            resubmitBtn.innerHTML =
              originalBtnHTML ||
              '&#8594; Gửi lại cho AI';
            resubmitBtn.disabled = false;
          }
        }
      } catch (error) {
        console.error(" Error resubmitting:", error);
        this.showError("Lỗi gửi lại yêu cầu: " + error.message);
      }
    },

    resetToFormView() {
      try {


        const modal = document.getElementById("aiSuggestionModal");
        if (!modal) {
          console.error(" Không tìm thấy modal");
          this.showError("Modal không tồn tại");
          return;
        }

        const modalBody = modal.querySelector(".ai-modal-body");
        if (!modalBody) {
          console.error(" Không tìm thấy modal body");
          this.showError("Không thể reset form");
          return;
        }

        delete modalBody.dataset.originalFormData;
        delete modalBody.dataset.suggestions;

        modalBody.innerHTML = `
      <form id="aiSuggestionForm">
        <!-- Date Range Section -->
        <div class="form-section">
          <div class="section-title">
            &#128197;
            <span>Chọn Khoảng Thời Gian</span>
          </div>
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

        <!-- Task Selection Section -->
        <div class="form-section">
          <div class="section-header">
            <div class="section-title">
              &#10004;
              <span>Chọn Công Việc</span>
            </div>
            <button type="button" class="btn-select-all" id="selectAllTasksBtn">
              &#10004;&#10004;
              <span>Chọn tất cả</span>
            </button>
          </div>

          <div class="task-list-container">
            <div class="task-list" id="aiTaskList">
              <div class="loading-state">
                <div class="loading-spinner">
                  ...
                </div>
                <p>Đang tải công việc...</p>
              </div>
            </div>

            <div class="task-stats" id="aiTaskStats">
              Đã chọn: <strong>0</strong> công việc
            </div>
          </div>
        </div>

        <!-- AI Options Section -->
        <div class="form-section">
          <div class="section-title">
            &#9881;
            <span>Tùy Chọn AI</span>
          </div>

          <div class="ai-options-grid">
            <label class="ai-option">
              <input type="checkbox" id="aiOptionAvoidConflict" checked />
              <div class="option-content">
                <div class="option-icon">
                  &#128737;
                </div>
                <div class="option-text">
                  <strong>Tránh trùng lịch</strong>
                  <small>Không xếp vào khung giờ đã có</small>
                </div>
              </div>
            </label>

            <label class="ai-option">
              <input type="checkbox" id="aiOptionConsiderPriority" checked />
              <div class="option-content">
                <div class="option-icon">
                  &#9733;
                </div>
                <div class="option-text">
                  <strong>Ưu tiên quan trọng</strong>
                  <small>Xếp việc quan trọng trước</small>
                </div>
              </div>
            </label>

            <label class="ai-option">
              <input type="checkbox" id="aiOptionBalanceWorkload" checked />
              <div class="option-content">
                <div class="option-icon">
                  &#9878;
                </div>
                <div class="option-text">
                  <strong>Cân bằng khối lượng</strong>
                  <small>Phân đều công việc các ngày</small>
                </div>
              </div>
            </label>
          </div>
        </div>
      </form>
    `;

        this.setDefaultDates();

        setTimeout(async () => {
          await this.populateAIModal();
          this.setupAllEventListeners();

        }, 100);
      } catch (error) {
        console.error(" Error resetting to form view:", error);
        this.showError("Lỗi khi reset form: " + error.message);
      }
    },
    async applyAISuggestions(suggestions) {
      try {


        if (!suggestions || suggestions.length === 0) {
          this.showError("Không có đề xuất nào để áp dụng");
          return;
        }

        const applyBtn = document.getElementById("aiApplyBtn");
        if (applyBtn) {
          applyBtn.innerHTML =
            '... Đang áp dụng...';
          applyBtn.disabled = true;
        }


        const saveResult = await this.saveAISuggestionsToDatabase(suggestions);
        if (!saveResult || !saveResult.success) {
          this.showError("Lỗi lưu lịch trình AI");
          return;
        }




        await new Promise((resolve) => setTimeout(resolve, 2000));


        if (window.AIModule && window.AIModule.refreshFromDatabase) {
          try {
            await AIModule.refreshFromDatabase();

          } catch (err) {
            console.error(" Error refreshing calendar:", err);
          }
        } else {
          console.warn(" AIModule not ready, will reload page");
          setTimeout(() => location.reload(), 1000);
          return;
        }

        this.showSuccess(`✅ Đã áp dụng ${suggestions.length} lịch trình AI!`);

        setTimeout(() => {
          this.closeModal();

          setTimeout(() => {
            const aiTabBtn = document.querySelector('[data-tab="ai"]');
            if (aiTabBtn) {
              aiTabBtn.click();
            }
          }, 300);
        }, 1500);
      } catch (error) {
        console.error(" Error applying suggestions:", error);
        this.showError("Lỗi áp dụng lịch trình: " + error.message);

        const applyBtn = document.getElementById("aiApplyBtn");
        if (applyBtn) {
          applyBtn.innerHTML =
            '&#10003; Áp dụng lịch trình';
          applyBtn.disabled = false;
        }
      }
    },

    getFormData() {
      try {


        const selectedItems = document.querySelectorAll(
          '#aiSuggestionModal .task-item[data-selected="true"]'
        );

        const selectedTasks = [];
        selectedItems.forEach((item, index) => {
          const taskId = item.dataset.taskId;
          if (taskId) {
            const parsedId = parseInt(taskId);
            if (!isNaN(parsedId) && parsedId > 0) {
              selectedTasks.push(parsedId);

            }
          }
        });




        if (selectedTasks.length === 0) {
          this.showError("Vui lòng chọn ít nhất một công việc!");
          return null;
        }

        const startDate = document.getElementById("aiStartDate")?.value;
        const endDate = document.getElementById("aiEndDate")?.value;

        if (!startDate || !endDate) {
          this.showError("Vui lòng chọn khoảng thời gian!");
          return null;
        }

        const options = {
          avoidConflict:
            document.getElementById("aiOptionAvoidConflict")?.checked !== false,
          considerPriority:
            document.getElementById("aiOptionConsiderPriority")?.checked !==
            false,
          balanceWorkload:
            document.getElementById("aiOptionBalanceWorkload")?.checked !==
            false,
        };

        const formData = {
          tasks: selectedTasks,
          startDate,
          endDate,
          options,
        };


        return formData;
      } catch (error) {
        console.error(" Error getting form data:", error);
        this.showError("Lỗi lấy dữ liệu form: " + error.message);
        return null;
      }
    },

    validateFormData(formData) {
      if (!formData.tasks || formData.tasks.length === 0) {
        this.showError("Vui lòng chọn ít nhất một công việc!");
        return false;
      }

      if (!formData.startDate || !formData.endDate) {
        this.showError("Vui lòng chọn khoảng thời gian!");
        return false;
      }

      const start = new Date(formData.startDate);
      const end = new Date(formData.endDate);
      if (end <= start) {
        this.showError("Ngày kết thúc phải sau ngày bắt đầu!");
        return false;
      }

      const invalidTasks = formData.tasks.filter((id) => isNaN(id) || id <= 0);
      if (invalidTasks.length > 0) {
        console.error("Invalid task IDs:", invalidTasks);
        this.showError("Có công việc không hợp lệ. Vui lòng thử lại.");
        return false;
      }

      return true;
    },

    async submitToAI(formData) {
      try {



        const token = localStorage.getItem("auth_token");
        if (!token) {
          throw new Error("Không tìm thấy token đăng nhập");
        }

        const response = await fetch("/api/ai/suggest-schedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(formData),
        });



        if (!response.ok) {
          const errorText = await response.text();
          console.error("API Error response:", errorText);
          throw new Error(
            `HTTP ${response.status}: ${errorText.substring(0, 200)}`
          );
        }

        const result = await response.json();


        if (!result.success) {
          throw new Error(result.message || "Lỗi xử lý AI");
        }

        return {
          success: true,
          data: result.data,
          message: result.message || "Thành công",
        };
      } catch (error) {
        console.error(" AI submission error:", error);
        return {
          success: false,
          message: error.message || "Lỗi kết nối AI",
        };
      }
    },

    handleErrorResult(result) {
      console.error(" AI error:", result);
      this.showError(result.message || "Lỗi không xác định từ AI");
    },

    async addEventsToCalendar(suggestions) {
      try {
        if (!suggestions || suggestions.length === 0) return;



        await this.waitForAIModule();

        if (window.AIModule && window.AIModule.loadAISuggestions) {

          await AIModule.loadAISuggestions(suggestions);

        } else {
          console.warn(" AIModule not available for adding events");
          this.showError("Không thể thêm lịch vào AI calendar");
        }
      } catch (error) {
        console.error(" Error adding events to calendar:", error);
        this.showError("Lỗi thêm sự kiện vào lịch: " + error.message);
      }
    },

    async waitForAIModule(timeout = 10000) {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
          if (
            window.AIModule &&
            window.AIModule.isInitialized &&
            window.AIModule.calendar
          ) {

            resolve(true);
          } else if (Date.now() - startTime > timeout) {
            console.error(" AIModule timeout");
            reject(new Error("AIModule không sẵn sàng sau " + timeout + "ms"));
          } else {

            setTimeout(check, 200);
          }
        };

        check();
      });
    },

    async saveAISuggestionsToDatabase(suggestions) {
      try {

        const token = localStorage.getItem("auth_token");
        if (!token) throw new Error("Không có token");

        const res = await fetch("/api/ai/save-ai-suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ suggestions }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        return { success: true, savedCount: data.saved || suggestions.length };
      } catch (err) {
        console.error("Lưu AI thất bại:", err);
        throw err;
      }
    },

    async handleSuccessResult(result, formData) {

      this.displaySuccessResults(result.data);
    },

    setDefaultDates() {
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const startDateInput = document.getElementById("aiStartDate");
      const endDateInput = document.getElementById("aiEndDate");

      if (startDateInput && endDateInput) {
        startDateInput.value = today.toISOString().split("T")[0];
        endDateInput.value = nextWeek.toISOString().split("T")[0];

      }
    },

    setupCheckboxListeners() {
      const taskList = document.querySelector("#aiSuggestionModal #aiTaskList");
      if (!taskList) return;

      taskList.addEventListener("change", (e) => {
        if (e.target.classList.contains("task-checkbox")) {
          this.updateSelectedCount();
        }
      });
    },

    toggleSelectAll() {
      const checkboxes = document.querySelectorAll(
        "#aiSuggestionModal .task-checkbox"
      );
      const taskItems = document.querySelectorAll(
        "#aiSuggestionModal .task-item.selectable"
      );

      if (checkboxes.length === 0 || taskItems.length === 0) {
        console.warn(" No checkboxes or task items found");
        return;
      }

      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
      const newState = !allChecked;



      checkboxes.forEach((cb) => {
        cb.checked = newState;
      });

      taskItems.forEach((item) => {
        item.dataset.selected = newState.toString();
        if (newState) {
          item.classList.add("selected");
        } else {
          item.classList.remove("selected");
        }
      });

      this.updateSelectedCount();
    },

    updateTaskStats(count) {
      const statsElement = document.querySelector(
        "#aiSuggestionModal #aiTaskStats"
      );
      if (statsElement) {
        statsElement.innerHTML = `Đã chọn: <strong>0</strong> / <strong>${count}</strong> công việc`;
      }
    },

    showFormLoading(show) {
      const submitBtn = document.getElementById("aiSubmitBtn");

      if (submitBtn) {
        if (show) {
          submitBtn.disabled = true;
          submitBtn.innerHTML =
            '... Đang xử lý...';

        } else {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '&#10024; Tạo Lịch Trình';

        }
      }
    },

    displaySuccessResults(result) {
      const modalBody = document.querySelector(
        "#aiSuggestionModal .ai-modal-body"
      );
      if (!modalBody) return;

      const successHTML = this.getSuccessHTML(result);
      modalBody.innerHTML = successHTML;

      const modalFooter = document.querySelector(
        "#aiSuggestionModal .ai-modal-footer"
      );
      if (modalFooter) {
        modalFooter.style.display = "none";
      }
    },

    closeModal() {


      this.resetModalForm();

      const modalFooter = document.querySelector(
        "#aiSuggestionModal .ai-modal-footer"
      );
      if (modalFooter) {
        modalFooter.style.display = "flex";
      }

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

    getLoadingHTML() {
      return `
      <div class="loading-state" style="text-align: center; padding: 40px;">
        <div class="loading-spinner" style="display: inline-block;">
          ...
        </div>
        <p style="margin-top: 20px; color: #666;">Đang tải danh sách công việc...</p>
      </div>
    `;
    },

    getEmptyStateHTML() {
      return `
      <div class="empty-state" style="text-align: center; padding: 40px;">
        
        <p style="font-size: 16px; color: #666;">Không có công việc nào chưa hoàn thành</p>
        <p class="text-sm text-gray-500 mt-2">Hãy tạo công việc mới trước khi sử dụng AI</p>
      </div>
    `;
    },

    getSuccessHTML(result) {
      const suggestionCount = result.suggestions?.length || 0;
      const summary = result.summary || `Đã tạo ${suggestionCount} khung giờ`;

      let suggestionsHTML = "";
      const previewSuggestions = result.suggestions?.slice(0, 3) || [];

      previewSuggestions.forEach((suggestion) => {
        const date = new Date(suggestion.scheduledTime);
        const timeStr = date.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateStr = date.toLocaleDateString("vi-VN");

        suggestionsHTML += `
        <div class="suggestion-item" style="padding: 15px; margin: 10px 0; border-left: 3px solid #8B5CF6; background: #f9fafb;">
          &#128197;
          <div class="suggestion-info" style="display: inline-block;">
            <strong>Công việc #${suggestion.taskId}</strong>
            <small style="display: block; color: #666;">${dateStr} lúc ${timeStr} (${
          suggestion.durationMinutes
        } phút)</small>
            <div class="text-xs text-gray-500 mt-1">${
              suggestion.reason || ""
            }</div>
          </div>
        </div>
      `;
      });

      if (suggestionCount > 3) {
        suggestionsHTML += `
        <div class="suggestion-more" style="text-align: center; padding: 15px; color: #666;">
          + ${suggestionCount - 3} đề xuất khác
        </div>
      `;
      }

      const stats = result.statistics || {};

      return `
      <div class="ai-summary-section" style="padding: 20px;">
        <div class="summary-header success" style="text-align: center; margin-bottom: 30px;">
          &#10003;
          <h4 style="font-size: 24px; font-weight: 600; margin: 0;"> AI đã tạo lịch trình thành công!</h4>
        </div>
        <p style="text-align: center; font-size: 16px; margin-bottom: 30px;"><strong>${summary}</strong></p>

        <div class="ai-stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px;">
          <div class="stat-item" style="text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px;">
            
            <div>
              <strong style="display: block; font-size: 24px;">${
                stats.totalTasks || suggestionCount
              }</strong>
              <small style="color: #666;">Công việc</small>
            </div>
          </div>
          <div class="stat-item" style="text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px;">
            &#128336;
            <div>
              <strong style="display: block; font-size: 24px;">${
                stats.totalHours || Math.round(suggestionCount * 1.5)
              }</strong>
              <small style="color: #666;">Giờ</small>
            </div>
          </div>
          <div class="stat-item" style="text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px;">
            &#128197;
            <div>
              <strong style="display: block; font-size: 24px;">${
                stats.daysUsed || 1
              }</strong>
              <small style="color: #666;">Ngày</small>
            </div>
          </div>
        </div>

        <div class="suggestions-preview" style="margin-bottom: 30px;">
          <h5 style="font-size: 18px; font-weight: 600; margin-bottom: 15px;"> Xem trước đề xuất:</h5>
          <div class="suggestions-list">
            ${suggestionsHTML}
          </div>
        </div>

        <div class="summary-note" style="padding: 15px; background: #EEF2FF; border-radius: 8px; margin-bottom: 20px;">
          &#128161;
          Những đề xuất này đã được thêm vào lịch AI của bạn
        </div>

        <div class="mt-6 text-center">
          <button class="btn btn-primary" onclick="location.reload()" style="padding: 12px 30px; background: #8B5CF6; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">
            &#8635;
            Tải lại trang
          </button>
        </div>
      </div>
    `;
    },

    showError(message) {
      console.error(" Error:", message);
      if (window.Utils && Utils.showToast) {
        Utils.showToast(message, "error");
      } else {
        alert(" " + message);
      }
    },

    showSuccess(message) {

      if (window.Utils && Utils.showToast) {
        Utils.showToast(message, "success");
      }
    },

    showErrorInModal(message) {
      const modalBody = document.querySelector(
        "#aiSuggestionModal .ai-modal-body"
      );
      if (modalBody) {
        modalBody.innerHTML = `
        <div class="error-state" style="text-align: center; padding: 40px;">
          
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Không thể tải dữ liệu</p>
          <p style="color: #666; margin-bottom: 20px;">${
            message || "Đã xảy ra lỗi"
          }</p>
          <button class="btn btn-primary" onclick="AIHandler.initAIModal()" style="padding: 10px 20px; background: #3B82F6; color: white; border: none; border-radius: 8px; cursor: pointer;">
            &#8635;
            Thử lại
          </button>
        </div>
      `;
      }
    },

    debugTaskIDs() {


      const taskItems = document.querySelectorAll(
        "#aiSuggestionModal .task-item"
      );


      taskItems.forEach((item, index) => {
        const taskId = item.dataset.taskId;
        const checkbox = item.querySelector(".task-checkbox");


      });

      const checkedBoxes = document.querySelectorAll(
        "#aiSuggestionModal .task-checkbox:checked"
      );


      checkedBoxes.forEach((cb, index) => {

      });
    },
  };

  window.AIHandler = AIHandler;


  document.addEventListener("modalShown", (e) => {
    if (e.detail && e.detail.modalId === "aiSuggestionModal") {

      setTimeout(() => {
        AIHandler.initAIModal();
      }, 300);
    }
  });

  window.debugAIHandler = function () {




    const form = document.getElementById("aiSuggestionForm");


    if (AIHandler.debugTaskIDs) {
      AIHandler.debugTaskIDs();
    }
  };


})();
