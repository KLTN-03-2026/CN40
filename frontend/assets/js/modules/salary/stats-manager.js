// stats-manager.js — Data loading, sidebar stats, date filters for statistics view.
// Chart rendering delegated to stats-charts.js (window.StatsCharts).
(function () {
  "use strict";

  const API = { stats: "/api/statistics" };

  let cachedData = null;

  function getAuthToken() {
    return localStorage.getItem("auth_token");
  }

  async function loadStatsData(from, to) {
    try {
      const token = getAuthToken();
      if (!token) return { success: true, data: { total: 0, completed: 0, pending: 0, percent: 0, daily: [] }, noAuth: true };
      const params = new URLSearchParams();
      if (from) params.append("from", from);
      if (to) params.append("to", to);

      const response = await fetch(`${API.stats}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Không thể tải dữ liệu thống kê");
      return await response.json();
    } catch (error) {
      console.error("Error loading stats:", error);
      throw error;
    }
  }

  function formatMinutes(m) {
    if (!m) return "0h";
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? (min > 0 ? `${h}h${min}p` : `${h}h`) : `${min}p`;
  }

  function updateSidebarStats(stats) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("side-total", stats.totalTasks || stats.total || 0);
    set("side-completed", stats.completedTasks || stats.completed || 0);
    set("side-percent", (stats.percent || 0) + "%");
    set("side-minutes", formatMinutes(stats.totalMinutes));
    set("side-done-minutes", formatMinutes(stats.doneMinutes));
    set("side-streak", (stats.streak || 0) + " ngày");
  }

  function renderStatsView(data) {
    cachedData = data;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("stats-total", data.total || 0);
    set("stats-completed", data.completed || 0);
    set("stats-pending", data.pending || 0);

    updateSidebarStats(data);

    if (window.StatsCharts) {
      StatsCharts.renderBar(data.daily || []);
      StatsCharts.renderDonut(data.completed || 0, data.pending || 0);
      StatsCharts.renderPriority(data.priority);
      StatsCharts.renderCategory(data.categories);
    }

    if (window.StatsAdvancedCharts) {
      StatsAdvancedCharts.renderStreak(data.streak || 0);
      StatsAdvancedCharts.renderComparison(data.daily || []);
      StatsAdvancedCharts.renderHeatmap(new Date().getFullYear());
    }

    window.StatsExport?.init?.();
  }

  function setupDateFilter() {
    const btn = document.getElementById("apply-stats-btn");
    if (btn) btn.addEventListener("click", handleLoadStats);
  }

  function setupQuickTabs() {
    const tabs = document.querySelectorAll("#stats-view .quick-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", async function () {
        tabs.forEach((t) => t.classList.remove("active"));
        this.classList.add("active");

        const period = this.dataset.period;
        const today = new Date();
        const fmt = (d) => d.toISOString().split("T")[0];
        let from;
        if (period === "week") from = new Date(today.getTime() - 7 * 86400000);
        else if (period === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
        else from = new Date(today.getFullYear(), 0, 1);

        try {
          const result = await loadStatsData(fmt(from), fmt(today));
          if (result.success) updateSidebarStats(result.data);
        } catch (e) {
          console.error("Stats quick tab error:", e);
        }
      });
    });
  }

  async function handleLoadStats() {
    const from = document.getElementById("stats-from")?.value || "";
    const to = document.getElementById("stats-to")?.value || "";

    try {
      const result = await loadStatsData(from, to);
      if (result.success) renderStatsView(result.data);
    } catch (error) {
      if (getAuthToken()) console.error("Error loading stats:", error);
    }
  }

  function initializeDateInputs() {
    const today = new Date();
    const lastMonth = new Date(today.getTime() - 30 * 86400000);
    const fmt = (d) => d.toISOString().split("T")[0];

    const statsFrom = document.getElementById("stats-from");
    const statsTo = document.getElementById("stats-to");
    if (statsFrom) statsFrom.value = fmt(lastMonth);
    if (statsTo) statsTo.value = fmt(today);
  }

  async function init() {
    initializeDateInputs();
    setupDateFilter();
    setupQuickTabs();

    const statsView = document.getElementById("stats-view");
    if (statsView && !statsView.classList.contains("hidden")) {
      await handleLoadStats();
    }
  }

  window.StatsManager = { init, loadStatsData, renderStatsView, handleLoadStats, getCachedData() { return cachedData; } };
})();
