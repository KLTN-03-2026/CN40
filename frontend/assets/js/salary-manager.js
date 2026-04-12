/**
 * salary-manager.js
 * Newspaper-style salary page — fetch, render, filter, export.
 *
 * Public API (window.SalaryManager):
 *   init()
 *   loadSalary(fromDate, toDate)
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let _allEntries = [];      // raw entries from last API response
  let _fullData = null;      // full response data object
  let _chart = null;         // Chart.js instance

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function getAuthToken() {
    return localStorage.getItem("auth_token") || "";
  }

  function fmt(n, decimals = 0) {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }

  function fmtCurrency(n) {
    return fmt(n);
  }

  function fmtHours(n) {
    return fmt(n, 2);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("vi-VN");
  }

  function esc(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Return YYYY-MM-DD string for a Date object. */
  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Date preset helpers
  // ---------------------------------------------------------------------------

  function getPresetRange(preset) {
    const today = new Date();
    let from;
    switch (preset) {
      case "week": {
        const day = today.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        from = new Date(today);
        from.setDate(today.getDate() + diff);
        break;
      }
      case "month":
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "quarter": {
        const q = Math.floor(today.getMonth() / 3);
        from = new Date(today.getFullYear(), q * 3, 1);
        break;
      }
      case "year":
        from = new Date(today.getFullYear(), 0, 1);
        break;
      default:
        from = new Date(today.getTime() - 30 * 86_400_000);
    }
    return { from: isoDate(from), to: isoDate(today) };
  }

  // ---------------------------------------------------------------------------
  // API fetch
  // ---------------------------------------------------------------------------

  async function loadSalary(fromDate, toDate) {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const resp = await fetch(`/api/salary?${params}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${txt}`);
    }

    const json = await resp.json();
    if (!json.success) throw new Error(json.message || "API error");
    return json.data;
  }

  // ---------------------------------------------------------------------------
  // Category dropdown population
  // ---------------------------------------------------------------------------

  function populateCategoryFilter(entries) {
    const sel = document.getElementById("filter-category");
    if (!sel) return;

    const seen = new Map();
    entries.forEach((e) => {
      if (e.categoryId && !seen.has(e.categoryId)) {
        seen.set(e.categoryId, e.categoryName || e.categoryId);
      }
    });

    // Remove old options except first ("Tất cả")
    while (sel.options.length > 1) sel.remove(1);

    seen.forEach((name, id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  // ---------------------------------------------------------------------------
  // Render — stat cards
  // ---------------------------------------------------------------------------

  function renderStats(data) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set("stat-total-hours", fmtHours(data.totalHours));
    set("stat-total-salary", fmtCurrency(data.totalSalary));
    set("stat-avg-day", fmtCurrency(data.avgPerDay));

    if (data.topTask) {
      set("stat-top-task", data.topTask.title);
      set("stat-top-task-hours", `${fmtHours(data.topTask.hours)} giờ`);
    } else {
      set("stat-top-task", "—");
      set("stat-top-task-hours", "");
    }
  }

  // ---------------------------------------------------------------------------
  // Render — masthead subtitle
  // ---------------------------------------------------------------------------

  function renderMasthead(fromDate, toDate) {
    const el = document.getElementById("masthead-subtitle");
    if (!el) return;
    const f = fromDate
      ? new Date(fromDate).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "";
    const t = toDate
      ? new Date(toDate).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "";
    el.textContent = f && t ? `${f} — ${t}` : "";
  }

  // ---------------------------------------------------------------------------
  // Render — main table (from filtered entries)
  // ---------------------------------------------------------------------------

  function renderTable(entries) {
    const wrap = document.getElementById("salary-table-wrap");
    if (!wrap) return;

    if (!entries || entries.length === 0) {
      wrap.innerHTML = `<div class="np-empty">Không có dữ liệu công việc đã hoàn thành trong khoảng thời gian này.</div>`;
      return;
    }

    const totalHours = entries.reduce((s, e) => s + (e.hours || 0), 0);
    const totalSalary = entries.reduce((s, e) => s + (e.amount || 0), 0);

    const rows = entries
      .map(
        (e, i) => `
      <tr class="${i % 2 === 0 ? "np-tr-even" : "np-tr-odd"}">
        <td class="np-td np-td--title">${esc(e.title)}</td>
        <td class="np-td np-td--cat">${esc(e.categoryName || "—")}</td>
        <td class="np-td np-td--num">${fmtHours(e.hours)}</td>
        <td class="np-td np-td--num">${fmtCurrency(e.rate)}</td>
        <td class="np-td np-td--num np-td--amount">${fmtCurrency(e.amount)}</td>
        <td class="np-td np-td--date">${fmtDate(e.date)}</td>
      </tr>`
      )
      .join("");

    wrap.innerHTML = `
      <table class="np-table">
        <thead>
          <tr>
            <th class="np-th">Công việc</th>
            <th class="np-th">Danh mục</th>
            <th class="np-th np-th--num">Số giờ</th>
            <th class="np-th np-th--num">Lương / giờ</th>
            <th class="np-th np-th--num">Tổng lương</th>
            <th class="np-th">Ngày hoàn thành</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td class="np-tf" colspan="2">Tổng cộng (${entries.length} công việc)</td>
            <td class="np-tf np-tf--num">${fmtHours(totalHours)} giờ</td>
            <td class="np-tf np-tf--num"></td>
            <td class="np-tf np-tf--num np-tf--total">${fmtCurrency(totalSalary)}</td>
            <td class="np-tf"></td>
          </tr>
        </tfoot>
      </table>`;
  }

  // ---------------------------------------------------------------------------
  // Render — Chart.js line chart (monochrome)
  // ---------------------------------------------------------------------------

  function renderChart(timeline) {
    const canvas = document.getElementById("salary-chart");
    if (!canvas) return;

    const labels = (timeline || []).map((d) =>
      new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })
    );
    const salaryData = (timeline || []).map((d) => d.salary);

    const isDark = document.body.classList.contains("dark");
    const lineColor = isDark ? "#e5e5e5" : "#1a1a1a";
    const bgColor = isDark ? "rgba(229,229,229,0.08)" : "rgba(26,26,26,0.06)";
    const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    const textColor = isDark ? "#aaa" : "#555";
    const fontFamily = "'Playfair Display', Georgia, serif";

    if (_chart) {
      _chart.destroy();
      _chart = null;
    }

    if (!labels.length) {
      canvas.parentElement.innerHTML = `<div class="np-empty">Không có dữ liệu biểu đồ.</div>`;
      return;
    }

    _chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Thu nhập (VND)",
            data: salaryData,
            borderColor: lineColor,
            backgroundColor: bgColor,
            borderWidth: 1.5,
            pointRadius: 3,
            pointBackgroundColor: lineColor,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmtCurrency(ctx.raw)} VND`,
            },
            bodyFont: { family: fontFamily },
            titleFont: { family: fontFamily },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: fontFamily, size: 11 } },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: fontFamily, size: 11 },
              callback: (v) => fmtCurrency(v),
            },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Filter — apply category + search to _allEntries
  // ---------------------------------------------------------------------------

  function applyFilters() {
    const catVal = (document.getElementById("filter-category")?.value || "").trim();
    const searchVal = (document.getElementById("filter-search")?.value || "").trim().toLowerCase();

    let filtered = _allEntries;

    if (catVal) {
      filtered = filtered.filter(
        (e) => String(e.categoryId) === catVal
      );
    }

    if (searchVal) {
      filtered = filtered.filter((e) =>
        (e.title || "").toLowerCase().includes(searchVal)
      );
    }

    renderTable(filtered);
  }

  // ---------------------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------------------

  function exportCsv() {
    if (!_allEntries.length) return;

    const catVal = (document.getElementById("filter-category")?.value || "").trim();
    const searchVal = (document.getElementById("filter-search")?.value || "").trim().toLowerCase();
    let rows = _allEntries;
    if (catVal) rows = rows.filter((e) => String(e.categoryId) === catVal);
    if (searchVal) rows = rows.filter((e) => (e.title || "").toLowerCase().includes(searchVal));

    const cols = ["Công việc", "Danh mục", "Số giờ", "Lương/giờ", "Tổng lương", "Ngày hoàn thành"];
    const lines = [
      cols.join(","),
      ...rows.map((e) =>
        [
          `"${(e.title || "").replace(/"/g, '""')}"`,
          `"${(e.categoryName || "").replace(/"/g, '""')}"`,
          e.hours,
          e.rate,
          e.amount,
          fmtDate(e.date),
        ].join(",")
      ),
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bang-luong-${isoDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Core load + render pipeline
  // ---------------------------------------------------------------------------

  async function loadAndRender(fromDate, toDate) {
    const wrap = document.getElementById("salary-table-wrap");
    if (wrap) wrap.innerHTML = `<div class="np-loading">Đang tải dữ liệu...</div>`;

    try {
      const data = await loadSalary(fromDate, toDate);
      _fullData = data;
      _allEntries = data.entries || [];

      renderMasthead(fromDate, toDate);
      renderStats(data);
      populateCategoryFilter(_allEntries);
      applyFilters();
      renderChart(data.timeline || []);
    } catch (err) {
      console.error("Salary load error:", err);
      if (wrap) {
        wrap.innerHTML = `<div class="np-empty np-empty--error">Lỗi tải dữ liệu: ${esc(err.message)}</div>`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function initDateInputs() {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const fromEl = document.getElementById("filter-from");
    const toEl = document.getElementById("filter-to");
    if (fromEl && !fromEl.value) fromEl.value = isoDate(monthStart);
    if (toEl && !toEl.value) toEl.value = isoDate(today);
  }

  function getDateRange() {
    const from = document.getElementById("filter-from")?.value || "";
    const to = document.getElementById("filter-to")?.value || "";
    return { from, to };
  }

  function init() {
    initDateInputs();

    // Apply button
    document.getElementById("btn-apply")?.addEventListener("click", () => {
      const { from, to } = getDateRange();
      loadAndRender(from, to);
    });

    // Preset buttons
    document.querySelectorAll(".np-preset").forEach((btn) => {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".np-preset").forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        const { from, to } = getPresetRange(this.dataset.preset);
        const fromEl = document.getElementById("filter-from");
        const toEl = document.getElementById("filter-to");
        if (fromEl) fromEl.value = from;
        if (toEl) toEl.value = to;
        loadAndRender(from, to);
      });
    });

    // Category filter (client-side)
    document.getElementById("filter-category")?.addEventListener("change", applyFilters);

    // Search filter (client-side, debounced)
    let searchTimer = null;
    document.getElementById("filter-search")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 250);
    });

    // CSV export
    document.getElementById("btn-export-csv")?.addEventListener("click", exportCsv);

    // Initial load — current month
    const { from, to } = getDateRange();
    loadAndRender(from, to);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  // Only auto-init when the salary page elements are present in the DOM
  // (standalone load via salary.html). In SPA mode, componentLoader calls
  // SalaryManager.init() after injecting the HTML.
  function maybeAutoInit() {
    if (document.getElementById("salary-table-wrap")) {
      init();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeAutoInit);
  } else {
    maybeAutoInit();
  }

  window.SalaryManager = { init, loadSalary, loadAndRender };
})();
