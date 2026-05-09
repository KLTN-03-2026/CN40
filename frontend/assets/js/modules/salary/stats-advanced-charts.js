// stats-advanced-charts.js — Advanced chart renders: streak, comparison bar, heatmap.
// Exports window.StatsAdvancedCharts. Requires Chart.js 4.x and optionally CalendarHeatmap.
(function () {
  "use strict";

  let comparisonChart = null;
  let currentMode = "weekly";  // 'weekly' | 'monthly'
  let cachedDaily = [];

  // ─── Theme helpers ──────────────────────────────────────────────────────────

  function isDark() { return document.body.classList.contains("dark"); }
  function accent() { return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2563eb"; }
  function themeColors() {
    return {
      grid: isDark() ? "rgba(51,65,85,0.6)" : "rgba(226,232,240,0.6)",
      tick: isDark() ? "#64748b" : "#94a3b8",
      legend: isDark() ? "#cbd5e1" : "#475569",
    };
  }

  // ─── Streak ─────────────────────────────────────────────────────────────────

  function renderStreak(count) {
    const el = document.getElementById("streak-count");
    if (el) el.textContent = count;
  }

  // ─── Comparison chart ───────────────────────────────────────────────────────

  /**
   * Group daily records by ISO week (Monday key) or calendar month.
   * @returns {Array<{label, total, completed}>}
   */
  function groupPeriods(dailyData, mode) {
    const map = {};
    dailyData.forEach((d) => {
      let key, label;
      if (mode === "monthly") {
        key = d.date.slice(0, 7);
        const [y, m] = key.split("-");
        label = `T${parseInt(m)}/${y}`;
      } else {
        const date = new Date(d.date);
        const ws = new Date(date);
        ws.setDate(date.getDate() - date.getDay() + 1); // Monday
        key = ws.toISOString().split("T")[0];
        label = key.slice(5); // MM-DD
      }
      if (!map[key]) map[key] = { label, total: 0, completed: 0 };
      map[key].total += d.total;
      map[key].completed += d.completed;
    });
    return Object.values(map);
  }

  function renderComparison(dailyData, mode) {
    cachedDaily = dailyData || [];
    currentMode = mode || "weekly";

    const canvas = document.getElementById("comparison-chart");
    if (!canvas) return;
    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }

    const periods = groupPeriods(cachedDaily, currentMode);
    const c = themeColors();

    comparisonChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: periods.map((p) => p.label),
        datasets: [
          { label: "Kế hoạch", data: periods.map((p) => p.total), backgroundColor: "#94a3b8", borderRadius: 5, maxBarThickness: 24 },
          { label: "Hoàn thành", data: periods.map((p) => p.completed), backgroundColor: accent(), borderRadius: 5, maxBarThickness: 24 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { usePointStyle: true, pointStyle: "circle", padding: 12, font: { size: 11, weight: "600" }, color: c.legend, boxWidth: 8 } },
          tooltip: { backgroundColor: "rgba(15,23,42,0.92)", titleColor: "#f1f5f9", bodyColor: "#cbd5e1", padding: 10, cornerRadius: 8 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.tick, font: { size: 10 } }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: c.grid, drawTicks: false }, ticks: { stepSize: 1, color: c.tick, font: { size: 10 }, padding: 6 }, border: { display: false } },
        },
      },
    });

    // Sync toggle button active state
    document.querySelectorAll(".comparison-toggle").forEach((btn) => {
      const active = btn.dataset.mode === currentMode;
      btn.classList.toggle("active", active);
      btn.classList.toggle("bg-blue-100", active);
      btn.classList.toggle("text-blue-700", active);
      btn.classList.toggle("bg-gray-100", !active);
      btn.classList.toggle("text-gray-600", !active);
    });
  }

  // ─── Heatmap ────────────────────────────────────────────────────────────────

  /** CSS-grid fallback when CalendarHeatmap is not available. */
  function buildFallbackHeatmap(container, entries) {
    container.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;";
    entries.forEach((e) => {
      const cell = document.createElement("div");
      cell.title = `${e.date}: ${e.completed}/${e.total}`;
      const v = e.value;
      let bg;
      if (v === null || v === undefined || e.total === 0) bg = isDark() ? "#1e293b" : "#e2e8f0";
      else if (v < 0.25) bg = "#bbf7d0";
      else if (v < 0.5) bg = "#4ade80";
      else if (v < 0.75) bg = "#16a34a";
      else bg = "#14532d";
      cell.style.cssText = `width:10px;height:10px;border-radius:2px;background:${bg};flex-shrink:0;`;
      grid.appendChild(cell);
    });
    container.appendChild(grid);
  }

  /** Populate year selector once, then fetch + render heatmap for given year. */
  async function renderHeatmap(year) {
    const containerId = "stats-heatmap";
    const container = document.getElementById(containerId);
    if (!container) return;

    const sel = document.getElementById("heatmap-year-select");
    if (sel && sel.options.length === 0) {
      const cur = new Date().getFullYear();
      for (let y = cur; y >= cur - 3; y--) {
        const opt = document.createElement("option");
        opt.value = y; opt.textContent = y;
        sel.appendChild(opt);
      }
      sel.value = year || cur;
      sel.addEventListener("change", () => renderHeatmap(parseInt(sel.value)));
    }

    const token = localStorage.getItem("auth_token");
    if (!token) return;

    try {
      const res = await fetch(`/api/statistics/heatmap?year=${year || new Date().getFullYear()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Heatmap fetch failed");
      const json = await res.json();
      const data = json.success ? json.data : [];
      if (window.CalendarHeatmap) {
        CalendarHeatmap.render(containerId, data, { year });
      } else {
        buildFallbackHeatmap(container, data);
      }
    } catch (err) {
      console.error("StatsAdvancedCharts.renderHeatmap:", err);
    }
  }

  // ─── Toggle binding (event delegation) ─────────────────────────────────────

  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".comparison-toggle");
    if (btn && btn.dataset.mode && btn.dataset.mode !== currentMode) {
      renderComparison(cachedDaily, btn.dataset.mode);
    }
  });

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  function destroy() {
    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
  }

  window.StatsAdvancedCharts = { renderStreak, renderComparison, renderHeatmap, destroy };
})();
