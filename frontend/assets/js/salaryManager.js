(function () {
  "use strict";

  const API = {
    salary: "/api/salary",
  };

  function formatCurrency(amount) {
    return new Intl.NumberFormat("vi-VN").format(amount) + " VND";
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    return date.toLocaleDateString("vi-VN");
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getAuthToken() {
    return localStorage.getItem("auth_token");
  }

  async function loadSalaryData(from, to) {
    try {
      const token = getAuthToken();
      const params = new URLSearchParams();
      if (from) params.append("from", from);
      if (to) params.append("to", to);

      const url = `${API.salary}?${params.toString()}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Không thể tải dữ liệu lương");
      return await response.json();
    } catch (error) {
      console.error("Error loading salary:", error);
      throw error;
    }
  }

  function renderSalaryTable(entries) {
    if (!entries || entries.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div>Không có dữ liệu công việc đã hoàn thành</div>
        </div>
      `;
    }

    let tableHTML = `
      <table class="salary-table">
        <thead>
          <tr>
            <th>Công việc</th>
            <th>Ngày hoàn thành</th>
            <th>Đơn giá</th>
            <th>Số giờ</th>
            <th>Ghi chú</th>
            <th>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
    `;

    entries.forEach((entry) => {
      tableHTML += `
        <tr>
          <td>${escapeHtml(entry.title)}</td>
          <td>${formatDate(entry.date)}</td>
          <td>${formatCurrency(entry.rate)}</td>
          <td>${entry.hours} giờ</td>
          <td>${escapeHtml(entry.note) || "-"}</td>
          <td><strong>${formatCurrency(entry.amount)}</strong></td>
        </tr>
      `;
    });

    tableHTML += `</tbody></table>`;
    return tableHTML;
  }

  function renderSalaryView(data) {
    const entries = data.entries || [];
    const totalAmount = entries.reduce((sum, entry) => {
      return sum + (Number(entry.amount) || 0);
    }, 0);

    const tableContainer = document.getElementById("salary-table");
    if (tableContainer) {
      tableContainer.innerHTML = renderSalaryTable(entries);
    }

    const totalAmountEl = document.getElementById("total-amount");
    if (totalAmountEl) {
      totalAmountEl.textContent = formatCurrency(totalAmount);
    }

    updateQuickStats({
      total: entries.length,
      completed: entries.length,
      percent: 100,
    });
  }

  function updateQuickStats(stats) {
    const quickTotal = document.getElementById("quick-total");
    const quickCompleted = document.getElementById("quick-completed");
    const quickPercent = document.getElementById("quick-percent");

    if (quickTotal) quickTotal.textContent = stats.total || 0;
    if (quickCompleted) quickCompleted.textContent = stats.completed || 0;
    if (quickPercent) quickPercent.textContent = (stats.percent || 0) + "%";
  }

  function setupTabSwitching() {
    const tabs = document.querySelectorAll(".salary-page .tab");
    const salaryView = document.getElementById("salary-view");
    const statsView = document.getElementById("stats-view");
    const pageTitle = document.querySelector(".salary-page .header h1");

    tabs.forEach((tab) => {
      tab.addEventListener("click", function () {
        tabs.forEach((t) => t.classList.remove("active"));
        this.classList.add("active");

        const tabType = this.getAttribute("data-tab");
        if (tabType === "salary") {
          salaryView.classList.remove("hidden");
          statsView.classList.add("hidden");
          if (pageTitle) {
            pageTitle.textContent = "Quản lý lương";
          }
          handleLoadSalary();
        } else {
          salaryView.classList.add("hidden");
          statsView.classList.remove("hidden");
          if (pageTitle) {
            pageTitle.textContent = "Thống kê";
          }
          // Gọi StatsManager để load dữ liệu thống kê
          if (window.StatsManager && window.StatsManager.handleLoadStats) {
            window.StatsManager.handleLoadStats();
          }
        }
      });
    });
  }

  function setupDateFilters() {
    const applySalaryBtn = document.getElementById("apply-salary-btn");
    if (applySalaryBtn) {
      applySalaryBtn.addEventListener("click", handleLoadSalary);
    }
  }

  function setupQuickTabs() {
    // Quick tabs in salary-view (Tuần/Tháng/Năm) for quick stats panel
    const quickTabs = document.querySelectorAll("#salary-view .quick-tab");
    quickTabs.forEach((tab) => {
      tab.addEventListener("click", async function () {
        quickTabs.forEach((t) => t.classList.remove("active"));
        this.classList.add("active");

        const period = this.dataset.period;
        const today = new Date();
        const fmt = (d) => d.toISOString().split("T")[0];
        let from;
        if (period === "week") {
          from = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
        } else if (period === "month") {
          from = new Date(today.getFullYear(), today.getMonth(), 1);
        } else {
          from = new Date(today.getFullYear(), 0, 1);
        }

        try {
          const result = await loadSalaryData(fmt(from), fmt(today));
          if (result.success) {
            const entries = result.data.entries || [];
            updateQuickStats({
              total: entries.length,
              completed: entries.length,
              percent: 100,
            });
          }
        } catch (e) {
          console.error("Quick tab error:", e);
        }
      });
    });
  }

  async function handleLoadSalary() {
    const fromInput = document.getElementById("salary-from");
    const toInput = document.getElementById("salary-to");

    const from = fromInput ? fromInput.value : "";
    const to = toInput ? toInput.value : "";

    try {
      const result = await loadSalaryData(from, to);
      if (result.success) {
        renderSalaryView(result.data);
      }
    } catch (error) {
      console.error("Error loading salary:", error);
      const tableContainer = document.getElementById("salary-table");
      if (tableContainer) {
        tableContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon"></div>
            <div>Lỗi: ${escapeHtml(error.message)}</div>
          </div>
        `;
      }
    }
  }

  function initializeDateInputs() {
    const today = new Date();
    const lastMonth = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    const formatDate = (d) => d.toISOString().split("T")[0];

    const salaryFrom = document.getElementById("salary-from");
    const salaryTo = document.getElementById("salary-to");

    if (salaryFrom) salaryFrom.value = formatDate(lastMonth);
    if (salaryTo) salaryTo.value = formatDate(today);
  }

  async function init() {
    initializeDateInputs();
    setupTabSwitching();
    setupDateFilters();
    setupQuickTabs();

    await handleLoadSalary();

    // Lắng nghe sự kiện hoàn thành công việc
    document.addEventListener("eventCompleted", async (e) => {
      if (e.detail.completed) {
        await handleLoadSalary();
      }
    });
  }

  window.SalaryManager = {
    init,
    loadSalaryData,
    renderSalaryView,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();