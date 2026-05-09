// work-manager-render.js — extends WorkManager with renderTasks, filters,
// bulk action bar, and category filter loading.
// Depends on: work-manager.js (must be loaded first)
(function () {
  "use strict";

  const WM = window.WorkManager;
  if (!WM) {
    console.error("work-manager-render.js: WorkManager not found");
    return;
  }

  // ------------------------------------------------------------------
  // Priority helpers (local — avoid global pollution)
  // ------------------------------------------------------------------

  function getPriorityColor(priority) {
    return window.PriorityTheme ? PriorityTheme.getColor(priority) : "#3B82F6";
  }

  function getPriorityClass(priority) {
    return { 1: "low", 2: "medium", 3: "high", 4: "very-high" }[priority] || "medium";
  }

  function getPriorityText(priority) {
    return { 1: "Thấp", 2: "Trung bình", 3: "Cao", 4: "Rất cao" }[priority] || "Trung bình";
  }

  function groupBadgeHtml(task) {
    if (!task.GroupTaskID) return "";
    const name = task.GroupName || "Nhóm";
    let dl = "";
    if (task.GroupTaskDeadline) {
      const d = new Date(task.GroupTaskDeadline);
      const overdue = d < new Date() && task.TrangThaiThucHien !== 2;
      const label = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
      const st = overdue ? "background:#fef2f2;color:#dc2626" : "background:#f0fdf4;color:#15803d";
      dl = ` <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium" style="${st}"><i class="far fa-calendar-alt" style="font-size:9px"></i>Hạn: ${label}${overdue ? " (quá hạn)" : ""}</span>`;
    }
    return `<div class="flex items-center gap-1.5 mt-1"><span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium" style="background:#dbeafe;color:#1d4ed8"><i class="fas fa-users" style="font-size:9px"></i>Từ nhóm ${name}</span>${dl}</div>`;
  }

  // ------------------------------------------------------------------
  // Render task table
  // ------------------------------------------------------------------

  WM.renderTasks = function (tasks) {
    const container = document.getElementById("work-items-container");
    if (!container) return;

    document.getElementById("loading-indicator")?.classList.add("hidden");
    const emptyState = document.getElementById("empty-state-indicator");

    if (tasks.length === 0) {
      emptyState?.classList.remove("hidden");
      container.querySelector(".work-table-container")?.remove();
      return;
    }
    emptyState?.classList.add("hidden");

    let pendingTasks   = tasks.filter((t) => t.TrangThaiThucHien !== 2);
    let completedTasks = tasks.filter((t) => t.TrangThaiThucHien === 2);

    if (window.TaskSorter && this._sortState?.criterion) {
      const { criterion, direction } = this._sortState;
      pendingTasks   = window.TaskSorter.sortTasks(pendingTasks,   criterion, direction, "cv");
      completedTasks = window.TaskSorter.sortTasks(completedTasks, criterion, direction, "cv");
    }

    // ---- pending section ----
    let html = `
      <div class="mb-10">
        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
          <i class="fas fa-clock mr-2 text-yellow-500"></i>
          Công việc đang chờ (${pendingTasks.length})
        </h3>
        <div class="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">`;

    if (pendingTasks.length === 0) {
      html += `<div class="text-center py-8"><i class="fas fa-check-circle text-4xl text-green-400 mb-2"></i><p class="text-gray-500">Không có công việc đang chờ</p></div>`;
    } else {
      html += `
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                <input type="checkbox" id="select-all-pending" class="rounded">
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Công việc</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Danh mục</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Ưu tiên</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Thời gian</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Thao tác</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">`;

      pendingTasks.forEach((task) => {
        const taskId        = task.ID || task.MaCongViec || 0;
        const priority      = task.MucDoUuTien || 2;
        const priorityText  = getPriorityText(priority);
        const categoryColor = getPriorityColor(priority);
        const categoryName  = task.TenLoai || task.LoaiCongViec?.TenLoai;

        html += `
          <tr id="task-${taskId}" class="task-row" data-task-id="${taskId}" data-priority="${priority}" data-category-id="${task.MaLoai || ''}">
            <td class="px-6 py-4 whitespace-nowrap">
              <input type="checkbox" class="task-checkbox pending-checkbox rounded" data-task-id="${taskId}">
            </td>
            <td class="px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="flex-shrink-0 w-1 h-10 rounded-full" style="background-color:${categoryColor}"></div>
                <div class="min-w-0">
                  <div class="font-medium text-gray-900">${task.TieuDe || ""}</div>
                  ${task.MoTa ? `<div class="text-sm text-gray-500 mt-0.5 truncate max-w-xs">${task.MoTa}</div>` : ""}
                  ${groupBadgeHtml(task)}
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              ${categoryName
                ? `<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0"><i class="fas fa-folder text-[10px]" style="color:#94a3b8"></i>${categoryName}</span>`
                : `<span class="text-xs text-gray-400 italic">—</span>`}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full priority-badge" data-priority="${priority}" style="background:${categoryColor}22;color:${categoryColor}">
                ${priorityText}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
              <i class="fas fa-clock mr-1"></i>${task.ThoiGianUocTinh || 60} phút
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <button type="button" class="action-btn-complete text-green-600 hover:text-green-900 mr-3" data-task-id="${taskId}" title="Hoàn thành">
                <i class="fas fa-check"></i> Hoàn thành
              </button>
              ${!task.GroupTaskID ? `<button type="button" class="action-btn-edit text-red-600 hover:text-red-900 mr-3" data-task-id="${taskId}" title="Sửa"><i class="fas fa-edit"></i> Sửa</button>` : ""}
              ${!task.GroupTaskID ? `<button type="button" class="action-btn-delete text-red-600 hover:text-red-900" data-task-id="${taskId}" title="Xóa"><i class="fas fa-trash"></i> Xóa</button>` : ""}
            </td>
          </tr>`;
      });

      html += `</tbody></table>`;
    }
    html += `</div></div>`;

    // ---- completed section ----
    if (completedTasks.length > 0) {
      html += `
        <div>
          <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <i class="fas fa-check-circle mr-2 text-green-500"></i>
            Công việc đã hoàn thành (${completedTasks.length})
          </h3>
          <div class="bg-gray-50 rounded-lg shadow border border-gray-200 overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                    <input type="checkbox" id="select-all-completed" class="rounded">
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Công việc</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Danh mục</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Ưu tiên</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Thời gian</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Thao tác</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">`;

      completedTasks.forEach((task) => {
        const taskId        = task.ID || task.MaCongViec || 0;
        const priority      = task.MucDoUuTien || 2;
        const priorityText  = getPriorityText(priority);
        const categoryColor = getPriorityColor(priority);
        const categoryName  = task.TenLoai || task.LoaiCongViec?.TenLoai;

        html += `
          <tr id="task-${taskId}" class="task-row completed-row" data-task-id="${taskId}" data-priority="${priority}" data-category-id="${task.MaLoai || ''}">
            <td class="px-6 py-4 whitespace-nowrap">
              <input type="checkbox" class="task-checkbox completed-checkbox rounded" data-task-id="${taskId}">
            </td>
            <td class="px-6 py-4">
              <div class="flex items-center">
                <div class="flex-shrink-0 w-1 h-10 rounded-full mr-3" style="background-color:${categoryColor}"></div>
                <div>
                  <div class="font-medium text-gray-500 line-through">${task.TieuDe || ""}</div>
                  ${task.MoTa ? `<div class="text-sm text-gray-400 mt-1 line-through">${task.MoTa}</div>` : ""}
                  ${groupBadgeHtml(task)}
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              ${categoryName
                ? `<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0"><i class="fas fa-folder text-[10px]" style="color:#94a3b8"></i>${categoryName}</span>`
                : `<span class="text-xs text-gray-400 italic">—</span>`}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full priority-badge" data-priority="${priority}" style="background:${categoryColor}22;color:${categoryColor}">
                ${priorityText}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              <i class="fas fa-clock mr-1"></i>${task.ThoiGianUocTinh || 60} phút
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <button type="button" class="action-btn-reopen text-yellow-600 hover:text-yellow-900 mr-3" data-task-id="${taskId}" title="Mở lại">
                <i class="fas fa-undo"></i> Mở lại
              </button>
              ${!task.GroupTaskID ? `<button type="button" class="action-btn-edit text-red-600 hover:text-red-900 mr-3" data-task-id="${taskId}" title="Sửa"><i class="fas fa-edit"></i> Sửa</button>` : ""}
              ${!task.GroupTaskID ? `<button type="button" class="action-btn-delete text-red-600 hover:text-red-900" data-task-id="${taskId}" title="Xóa"><i class="fas fa-trash"></i> Xóa</button>` : ""}
            </td>
          </tr>`;
      });

      html += `</tbody></table></div></div>`;
    }

    container.innerHTML = html;

    setTimeout(() => {
      this.setupTableEvents();
      this.setupFilters();
      this.setupCreateTaskButton();
      this.setupBulkActionBar();
      this.loadCategoriesIntoFilter();
      this.updateBulkBar();
    }, 50);
  };

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  WM.setupFilters = function () {
    const statusFilter   = document.getElementById("status-filter");
    const priorityFilter = document.getElementById("priority-filter");
    const searchInput    = document.getElementById("task-search");
    const categoryFilter = document.getElementById("category-filter");

    const rebind = (el, event, key, handler) => {
      if (!el) return;
      if (el[key]) el.removeEventListener(event, el[key]);
      el[key] = handler;
      el.addEventListener(event, handler);
      this.eventListeners.push({ element: el, event, handler });
    };

    rebind(statusFilter,   "change", "_changeHandler", () => this.filterTasks());
    rebind(priorityFilter, "change", "_changeHandler", () => this.filterTasks());
    rebind(categoryFilter, "change", "_changeHandler", () => this.filterTasks());
    rebind(searchInput,    "input",  "_inputHandler",  () => this.filterTasks());
  };

  WM.filterTasks = function () {
    const statusFilter   = document.getElementById("status-filter")?.value   || "all";
    const priorityFilter = document.getElementById("priority-filter")?.value || "all";
    const categoryFilter = document.getElementById("category-filter")?.value || "all";
    const searchText     = document.getElementById("task-search")?.value.toLowerCase() || "";

    document.querySelectorAll(".task-row").forEach((row) => {
      const isCompleted = row.classList.contains("completed-row");
      const priority    = row.dataset.priority || "2";
      const categoryId  = row.dataset.categoryId || "";
      const title       = (row.querySelector(".font-medium")?.textContent || "").toLowerCase();
      const description = (row.querySelector(".text-sm")?.textContent   || "").toLowerCase();

      let ok = true;
      if (statusFilter === "pending")   ok = ok && !isCompleted;
      if (statusFilter === "completed") ok = ok && isCompleted;
      if (priorityFilter !== "all")     ok = ok && priority === priorityFilter;
      if (categoryFilter !== "all")     ok = ok && categoryId === categoryFilter;
      if (searchText)                   ok = ok && (title.includes(searchText) || description.includes(searchText));

      row.style.display = ok ? "" : "none";
    });

    // Hide section headings when their tables are fully filtered out
    const pendingRows   = document.querySelectorAll(".task-row:not(.completed-row)");
    const completedRows = document.querySelectorAll(".task-row.completed-row");
    const pendingSection   = document.querySelector(".mb-10");
    const completedSection = document.querySelector("div:not(.mb-10)");
    if (pendingSection)   pendingSection.style.display   = Array.from(pendingRows).some((r)   => r.style.display !== "none") ? "" : "none";
    if (completedSection) completedSection.style.display = Array.from(completedRows).some((r) => r.style.display !== "none") ? "" : "none";

    this.updateBulkBar();
  };

  WM.loadCategoriesIntoFilter = async function () {
    const sel = document.getElementById("category-filter");
    if (!sel) return;
    try {
      const token = localStorage.getItem("auth_token");
      const r = await fetch("/api/categories", { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!j?.success) return;
      const current = sel.value;
      sel.innerHTML = `<option value="all">Tất cả danh mục</option>` +
        (j.data || []).map((c) => `<option value="${c.MaLoai}">${c.TenLoai}</option>`).join("");
      sel.value = current || "all";
    } catch (_) {}
  };

  // ------------------------------------------------------------------
  // Bulk action bar
  // ------------------------------------------------------------------

  WM.getSelectedTaskIds = function () {
    return Array.from(document.querySelectorAll(".task-checkbox:checked"))
      .map((cb) => cb.dataset.taskId).filter(Boolean);
  };

  WM.getSelectedByStatus = function () {
    const pending = [], completed = [];
    document.querySelectorAll(".task-checkbox:checked").forEach((cb) => {
      const id  = cb.dataset.taskId;
      if (!id) return;
      const row = cb.closest(".task-row");
      if (row?.classList.contains("completed-row")) completed.push(id);
      else pending.push(id);
    });
    return { pending, completed };
  };

  WM.updateBulkBar = function () {
    const bar = document.getElementById("bulk-action-bar");
    if (!bar) return;
    const ids      = this.getSelectedTaskIds();
    const countEl  = document.getElementById("bulk-selected-count");
    if (countEl) countEl.textContent = ids.length;
    if (ids.length > 0) { bar.classList.remove("hidden"); bar.style.display = "flex"; }
    else                { bar.classList.add("hidden");    bar.style.display = "none"; }

    const { pending, completed } = this.getSelectedByStatus();
    document.getElementById("bulk-complete-btn")?.classList.toggle("hidden", pending.length   === 0);
    document.getElementById("bulk-restore-btn")?.classList.toggle("hidden",  completed.length === 0);
  };

  WM.setupBulkActionBar = function () {
    const bar = document.getElementById("bulk-action-bar");
    if (!bar || bar._bound) return;
    bar._bound = true;
    document.getElementById("bulk-complete-btn")?.addEventListener("click", () => this.bulkComplete());
    document.getElementById("bulk-restore-btn")?.addEventListener("click",  () => this.bulkRestore());
    document.getElementById("bulk-delete-btn")?.addEventListener("click",   () => this.bulkDelete());
    document.getElementById("bulk-clear-btn")?.addEventListener("click",    () => this.clearBulkSelection());
  };

  WM.clearBulkSelection = function () {
    document.querySelectorAll(".task-checkbox").forEach((cb) => (cb.checked = false));
    const sa1 = document.getElementById("select-all-pending");
    const sa2 = document.getElementById("select-all-completed");
    if (sa1) sa1.checked = false;
    if (sa2) sa2.checked = false;
    this.updateBulkBar();
  };

  console.log("Work Manager Render v1.0 ready");
})();
