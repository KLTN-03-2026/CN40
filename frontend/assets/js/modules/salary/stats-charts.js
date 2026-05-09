// stats-charts.js — Chart rendering for statistics view.
// Exports window.StatsCharts with render methods for bar, donut, priority, category charts.
(function () {
  "use strict";

  let barChart = null;
  let donutChart = null;
  let priorityChart = null;
  let categoryChart = null;

  function isDarkMode() {
    return document.body.classList.contains("dark");
  }

  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2563EB";
  }

  function accentRgba(alpha) {
    const hex = getAccent();
    const num = parseInt(hex.replace("#", ""), 16);
    return `rgba(${num >> 16}, ${(num >> 8) & 0xFF}, ${num & 0xFF}, ${alpha})`;
  }

  function colors() {
    const dark = isDarkMode();
    const accent = getAccent();
    return {
      gridColor: dark ? "rgba(51,65,85,0.6)" : "rgba(226,232,240,0.6)",
      tickColor: dark ? "#64748b" : "#94a3b8",
      legendColor: dark ? "#cbd5e1" : "#475569",
      tooltipBg: "rgba(15,23,42,0.92)",
      completed: accentRgba(dark ? 0.9 : 0.85),
      completedHover: accent,
      pending: dark ? "rgba(51,65,85,0.7)" : "rgba(226,232,240,0.9)",
      pendingHover: dark ? "#334155" : "#cbd5e1",
      donutCompleted: dark ? [accent, "#34d399"] : [accent, "#10b981"],
      donutPending: dark ? "rgba(51,65,85,0.5)" : "rgba(226,232,240,0.8)",
      centerText: dark ? "#f1f5f9" : "#1e293b",
      centerSub: dark ? "#64748b" : "#94a3b8",
    };
  }

  function legendOpts(c) {
    return { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 11, weight: "600" }, color: c.legendColor, boxWidth: 8 } };
  }

  function tooltipOpts(c) {
    return { backgroundColor: c.tooltipBg, titleColor: "#f1f5f9", bodyColor: "#cbd5e1", padding: 10, cornerRadius: 8 };
  }

  function renderBar(dailyData) {
    const ctx = document.getElementById("bar-chart");
    if (!ctx) return;
    if (barChart) barChart.destroy();

    const slice = dailyData.slice(-14);
    const labels = slice.map((item) => new Date(item.date).toLocaleDateString("vi-VN", { month: "numeric", day: "numeric" }));
    const c = colors();

    barChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Hoàn thành", data: slice.map((i) => i.completed || 0), backgroundColor: c.completed, hoverBackgroundColor: c.completedHover, borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: false, maxBarThickness: 22 },
          { label: "Chờ xử lý", data: slice.map((i) => (i.total || 0) - (i.completed || 0)), backgroundColor: c.pending, hoverBackgroundColor: c.pendingHover, borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: false, maxBarThickness: 22 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: legendOpts(c), tooltip: { ...tooltipOpts(c), callbacks: { title: (items) => `Ngày ${items[0].label}`, label: (ctx) => `  ${ctx.dataset.label}: ${ctx.parsed.y}` } } },
        scales: {
          x: { stacked: false, grid: { display: false }, ticks: { color: c.tickColor, font: { size: 10 }, maxRotation: 45 }, border: { display: false } },
          y: { beginAtZero: true, stacked: false, grid: { color: c.gridColor, drawTicks: false }, ticks: { stepSize: 1, color: c.tickColor, font: { size: 10 }, padding: 6 }, border: { display: false } },
        },
      },
    });
  }

  function renderDonut(completed, pending) {
    const ctx = document.getElementById("donut-chart");
    if (!ctx) return;
    if (donutChart) donutChart.destroy();

    const total = completed + pending;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const c = colors();
    const empty = total === 0;

    donutChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: empty ? ["Không có dữ liệu"] : ["Hoàn thành", "Chờ xử lý"],
        datasets: [{ data: empty ? [1] : [completed, pending || 0.01], backgroundColor: empty ? ["rgba(226,232,240,0.4)"] : [c.donutCompleted[0], c.donutPending], hoverBackgroundColor: empty ? ["rgba(226,232,240,0.6)"] : [c.donutCompleted[1], c.pendingHover], borderWidth: 0, hoverOffset: empty ? 0 : 5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "72%",
        plugins: { legend: { display: !empty, ...legendOpts(c) }, tooltip: { enabled: !empty, ...tooltipOpts(c), callbacks: { label: (ctx) => { const v = ctx.parsed; const t = ctx.dataset.data.reduce((a, b) => a + b, 0); return `  ${ctx.label}: ${v} (${t > 0 ? Math.round((v / t) * 100) : 0}%)`; } } } },
      },
      plugins: [{
        id: "centerText",
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          const cl = colors();
          ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
          if (empty) { ctx.font = "12px -apple-system,sans-serif"; ctx.fillStyle = cl.centerSub; ctx.fillText("Chưa có dữ liệu", cx, cy); }
          else { ctx.font = `bold ${Math.min(26, chartArea.width * 0.15)}px -apple-system,sans-serif`; ctx.fillStyle = cl.centerText; ctx.fillText(pct + "%", cx, cy - 9); ctx.font = `${Math.min(11, chartArea.width * 0.065)}px -apple-system,sans-serif`; ctx.fillStyle = cl.centerSub; ctx.fillText("hoàn thành", cx, cy + 13); }
          ctx.restore();
        },
      }],
    });
  }

  function renderPriority(priorityData) {
    const ctx = document.getElementById("priority-chart");
    if (!ctx || !priorityData) return;
    if (priorityChart) priorityChart.destroy();

    const labels = ["Thấp", "Trung bình", "Cao", "Rất cao"];
    const pColors = [1, 2, 3, 4].map((p) => window.PriorityTheme ? PriorityTheme.getColor(p) : "#3B82F6");
    const c = colors();

    priorityChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Hoàn thành", data: [1, 2, 3, 4].map((p) => priorityData[p]?.done || 0), backgroundColor: pColors.map((cl) => cl + "CC"), borderRadius: 6, maxBarThickness: 28 },
          { label: "Tổng", data: [1, 2, 3, 4].map((p) => priorityData[p]?.total || 0), backgroundColor: pColors.map((cl) => cl + "33"), borderRadius: 6, maxBarThickness: 28 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { legend: legendOpts(c), tooltip: tooltipOpts(c) },
        scales: {
          x: { beginAtZero: true, grid: { color: c.gridColor, drawTicks: false }, ticks: { stepSize: 1, color: c.tickColor, font: { size: 10 } }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: c.tickColor, font: { size: 11, weight: "600" } }, border: { display: false } },
        },
      },
    });
  }

  function renderCategory(categories) {
    const ctx = document.getElementById("category-chart");
    if (!ctx || !categories || categories.length === 0) return;
    if (categoryChart) categoryChart.destroy();

    const sorted = [...categories].sort((a, b) => b.total - a.total).slice(0, 8);
    const palette = ["#14B8A6", "#F59E0B", "#E11D48", "#8B5CF6", "#06B6D4", "#84CC16", "#F97316", getAccent()];
    const c = colors();

    const total = sorted.reduce((s, x) => s + x.total, 0);
    const labelsWithPct = sorted.map((x) => {
      const pct = total > 0 ? Math.round((x.total / total) * 100) : 0;
      return `${x.name} (${pct}%)`;
    });

    categoryChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labelsWithPct,
        datasets: [{ data: sorted.map((x) => x.total), backgroundColor: sorted.map((_, i) => palette[i % palette.length]), borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 10, font: { size: 10, weight: "600" }, color: c.legendColor, boxWidth: 8 } },
          tooltip: { ...tooltipOpts(c), callbacks: { label: (ctx) => { const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0; return ` ${ctx.label}: ${ctx.parsed} công việc (${pct}%)`; } } },
        },
      },
    });
  }

  window.StatsCharts = { renderBar, renderDonut, renderPriority, renderCategory };
})();
