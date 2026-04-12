(function () {
  "use strict";

  const API = {
    stats: "/api/statistics",
  };

  let barChart = null;
  let donutChart = null;

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

  async function loadStatsData(from, to) {
    try {
      const token = getAuthToken();
      const params = new URLSearchParams();
      if (from) params.append("from", from);
      if (to) params.append("to", to);

      const url = `${API.stats}?${params.toString()}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Không thể tải dữ liệu thống kê");
      return await response.json();
    } catch (error) {
      console.error("Error loading stats:", error);
      throw error;
    }
  }

  function renderStatsView(data) {
    const total = data.total || 0;
    const completed = data.completed || 0;
    const pending = data.pending || 0;
    const percent = data.percent || 0;



    // Cập nhật số liệu tổng quan
    const statsTotal = document.getElementById("stats-total");
    const statsCompleted = document.getElementById("stats-completed");
    const statsPending = document.getElementById("stats-pending");

    if (statsTotal) statsTotal.textContent = total;
    if (statsCompleted) statsCompleted.textContent = completed;
    if (statsPending) statsPending.textContent = pending;

    // Cập nhật sidebar stats
    updateSidebarStats({ total, completed, pending, percent });

    // Render biểu đồ
    renderCharts(data);
  }

  function updateSidebarStats(stats) {
    const sideTotal = document.getElementById("side-total");
    const sideCompleted = document.getElementById("side-completed");
    const sidePercent = document.getElementById("side-percent");

    if (sideTotal) sideTotal.textContent = stats.total || 0;
    if (sideCompleted) sideCompleted.textContent = stats.completed || 0;
    if (sidePercent) sidePercent.textContent = (stats.percent || 0) + "%";
  }

  function renderCharts(data) {
    const completed = data.completed || 0;
    const pending = data.pending || 0;
    const dailyData = data.daily || [];

    // Biểu đồ cột - Công việc theo ngày
    renderBarChart(dailyData);

    // Biểu đồ tròn - Tỷ lệ hoàn thành
    renderDonutChart(completed, pending);
  }

  function isDarkMode() {
    return document.body.classList.contains("dark");
  }

  function chartColors() {
    const dark = isDarkMode();
    return {
      gridColor: dark ? "rgba(51,65,85,0.6)" : "rgba(226,232,240,0.6)",
      tickColor: dark ? "#64748b" : "#94a3b8",
      legendColor: dark ? "#cbd5e1" : "#475569",
      tooltipBg: "rgba(15,23,42,0.92)",
      completed: dark ? "rgba(96,165,250,0.9)" : "rgba(37,99,235,0.85)",
      completedHover: dark ? "#60a5fa" : "#2563eb",
      pending: dark ? "rgba(51,65,85,0.7)" : "rgba(226,232,240,0.9)",
      pendingHover: dark ? "#334155" : "#cbd5e1",
      donutCompleted: dark ? ["#60a5fa", "#34d399"] : ["#2563eb", "#10b981"],
      donutPending: dark ? "rgba(51,65,85,0.5)" : "rgba(226,232,240,0.8)",
      centerText: dark ? "#f1f5f9" : "#1e293b",
      centerSub: dark ? "#64748b" : "#94a3b8",
    };
  }

  function renderBarChart(dailyData) {
    const barCtx = document.getElementById("bar-chart");
    if (!barCtx) return;

    if (barChart) barChart.destroy();

    // limit to last 14 days for readability
    const slice = dailyData.slice(-14);
    const labels = slice.map((item) =>
      new Date(item.date).toLocaleDateString("vi-VN", { month: "numeric", day: "numeric" })
    );
    const completedData = slice.map((item) => item.completed || 0);
    const pendingData   = slice.map((item) => (item.total || 0) - (item.completed || 0));
    const c = chartColors();

    barChart = new Chart(barCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Hoàn thành",
            data: completedData,
            backgroundColor: c.completed,
            hoverBackgroundColor: c.completedHover,
            borderRadius: { topLeft: 6, topRight: 6 },
            borderSkipped: false,
            maxBarThickness: 22,
          },
          {
            label: "Chờ xử lý",
            data: pendingData,
            backgroundColor: c.pending,
            hoverBackgroundColor: c.pendingHover,
            borderRadius: { topLeft: 6, topRight: 6 },
            borderSkipped: false,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              pointStyle: "circle",
              padding: 16,
              font: { size: 11, weight: "600" },
              color: c.legendColor,
              boxWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: c.tooltipBg,
            titleColor: "#f1f5f9",
            bodyColor: "#cbd5e1",
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => `Ngày ${items[0].label}`,
              label: (ctx) => `  ${ctx.dataset.label}: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: {
            stacked: false,
            grid: { display: false },
            ticks: { color: c.tickColor, font: { size: 10 }, maxRotation: 45 },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            stacked: false,
            grid: { color: c.gridColor, drawTicks: false },
            ticks: { stepSize: 1, color: c.tickColor, font: { size: 10 }, padding: 6 },
            border: { display: false },
          },
        },
      },
    });
  }

  function renderDonutChart(completed, pending) {
    const donutCtx = document.getElementById("donut-chart");
    if (!donutCtx) return;

    if (donutChart) donutChart.destroy();

    const total = completed + pending;
    const pct   = total > 0 ? Math.round((completed / total) * 100) : 0;
    const c = chartColors();
    const isEmpty = total === 0;

    donutChart = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels: isEmpty ? ["Không có dữ liệu"] : ["Hoàn thành", "Chờ xử lý"],
        datasets: [{
          data: isEmpty ? [1] : [completed, pending || 0.01],
          backgroundColor: isEmpty ? ["rgba(226,232,240,0.4)"] : [c.donutCompleted[0], c.donutPending],
          hoverBackgroundColor: isEmpty ? ["rgba(226,232,240,0.6)"] : [c.donutCompleted[1], c.pendingHover],
          borderWidth: 0,
          hoverOffset: isEmpty ? 0 : 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: {
            display: !isEmpty,
            position: "bottom",
            labels: {
              usePointStyle: true,
              pointStyle: "circle",
              padding: 14,
              font: { size: 11, weight: "600" },
              color: c.legendColor,
              boxWidth: 8,
            },
          },
          tooltip: {
            enabled: !isEmpty,
            backgroundColor: c.tooltipBg,
            titleColor: "#f1f5f9",
            bodyColor: "#cbd5e1",
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed;
                const t   = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const p   = t > 0 ? Math.round((val / t) * 100) : 0;
                return `  ${ctx.label}: ${val} (${p}%)`;
              },
            },
          },
        },
      },
      plugins: [{
        id: "centerText",
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          const col = chartColors();
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (isEmpty) {
            ctx.font = "12px -apple-system,sans-serif";
            ctx.fillStyle = col.centerSub;
            ctx.fillText("Chưa có dữ liệu", cx, cy);
          } else {
            ctx.font = `bold ${Math.min(26, chartArea.width * 0.15)}px -apple-system,sans-serif`;
            ctx.fillStyle = col.centerText;
            ctx.fillText(pct + "%", cx, cy - 9);
            ctx.font = `${Math.min(11, chartArea.width * 0.065)}px -apple-system,sans-serif`;
            ctx.fillStyle = col.centerSub;
            ctx.fillText("hoàn thành", cx, cy + 13);
          }
          ctx.restore();
        },
      }],
    });
  }

  function setupDateFilter() {
    const applyStatsBtn = document.getElementById("apply-stats-btn");
    if (applyStatsBtn) {
      applyStatsBtn.addEventListener("click", handleLoadStats);
    }
  }

  function setupQuickTabs() {
    const quickTabs = document.querySelectorAll("#stats-view .quick-tab");
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
          const result = await loadStatsData(fmt(from), fmt(today));
          if (result.success) {
            updateSidebarStats(result.data);
          }
        } catch (e) {
          console.error("Stats quick tab error:", e);
        }
      });
    });
  }

  async function handleLoadStats() {
    const fromInput = document.getElementById("stats-from");
    const toInput = document.getElementById("stats-to");

    const from = fromInput ? fromInput.value : "";
    const to = toInput ? toInput.value : "";

    try {
      const result = await loadStatsData(from, to);
      if (result.success) {
        renderStatsView(result.data);
      }
    } catch (error) {
      console.error("Error loading stats:", error);
      alert("Lỗi khi tải dữ liệu thống kê: " + error.message);
    }
  }

  function initializeDateInputs() {
    const today = new Date();
    const lastMonth = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    const formatDate = (d) => d.toISOString().split("T")[0];

    const statsFrom = document.getElementById("stats-from");
    const statsTo = document.getElementById("stats-to");

    if (statsFrom) statsFrom.value = formatDate(lastMonth);
    if (statsTo) statsTo.value = formatDate(today);
  }

  async function init() {


    initializeDateInputs();
    setupDateFilter();
    setupQuickTabs();

    // Tự động load dữ liệu khi tab stats được active
    const statsView = document.getElementById("stats-view");
    if (statsView && !statsView.classList.contains("hidden")) {
      await handleLoadStats();
    }


  }

  // Export public methods
  window.StatsManager = {
    init,
    loadStatsData,
    renderStatsView,
    handleLoadStats,
  };


})();