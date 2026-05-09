/**
 * salary-manager.js
 * Salary tab inside the "Thống kê" section.
 * Fetches /api/salary (Phase 03 shape with `groups`) and renders
 * one expandable card per job, grouped by LoaiLuong (part_time / full_time).
 *
 * Public API (window.SalaryManager):
 *   init()
 *   loadSalary(from, to)
 *   loadAndRender(from, to)
 */
(function () {
  "use strict";

  // --- State ------------------------------------------------------------
  let _allGroups = [];
  let _totalSalary = 0;
  let _totalHours = 0;
  let _chart = null;
  const _expandedGroups = new Set();

  // --- Utils ------------------------------------------------------------
  const getToken = () => localStorage.getItem("auth_token") || "";
  const fmt = (n, d = 0) =>
    n == null || isNaN(n)
      ? "—"
      : new Intl.NumberFormat("vi-VN", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        }).format(n);
  const fmtVnd = (n) => fmt(n) + " ₫";
  const fmtHours = (n) => fmt(n, 1) + "h";
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("vi-VN");
  };
  const esc = (s) =>
    s == null
      ? ""
      : String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
  const isoDate = (d) => d.toISOString().slice(0, 10);

  // --- Date presets -----------------------------------------------------
  function getPresetRange(preset) {
    const today = new Date();
    let from;
    switch (preset) {
      case "week": {
        const day = today.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        from = new Date(today);
        from.setDate(today.getDate() + diff);
        break;
      }
      case "month":
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "year":
        from = new Date(today.getFullYear(), 0, 1);
        break;
      default:
        from = new Date(today.getTime() - 30 * 86400000);
    }
    return { from: isoDate(from), to: isoDate(today) };
  }

  // --- API --------------------------------------------------------------
  async function loadSalary(from, to) {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const resp = await fetch(`/api/salary?${p}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || "API error");
    return json.data;
  }

  // --- Renderers --------------------------------------------------------
  function renderStats() {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("stat-total-hours", fmtHours(_totalHours));
    set("stat-total-salary", fmtVnd(_totalSalary));
    set("stat-job-count", _allGroups.length);
  }

  function typeBadge(type) {
    if (type === "full_time")
      return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:#dcfce7;color:#166534">FULL-TIME</span>`;
    if (type === "part_time")
      return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:#dbeafe;color:#1e40af">PART-TIME</span>`;
    return "";
  }

  function renderPartTimeBody(g) {
    const rows = (g.entries || [])
      .map(
        (e) => `
        <tr class="border-t border-slate-100">
          <td class="px-2 py-1">${esc(g.title)}</td>
          <td class="px-2 py-1">${fmtDate(e.date)}</td>
          <td class="px-2 py-1 text-right">${fmtVnd(e.rate)}</td>
          <td class="px-2 py-1 text-right">${fmtHours(e.hours)}</td>
          <td class="px-2 py-1">${esc([e.shift_name ? `Ca: ${e.shift_name}` : "", e.note].filter(Boolean).join(" — "))}</td>
          <td class="px-2 py-1 text-right font-semibold">${fmtVnd(e.amount)}</td>
        </tr>`
      )
      .join("");
    return `
      <div class="overflow-x-auto mt-3 border border-slate-200 rounded-lg">
        <table class="w-full text-xs">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="px-2 py-2 text-left">Công việc</th>
              <th class="px-2 py-2 text-left">Ngày hoàn thành</th>
              <th class="px-2 py-2 text-right">Đơn giá</th>
              <th class="px-2 py-2 text-right">Số giờ</th>
              <th class="px-2 py-2 text-left">Ghi chú</th>
              <th class="px-2 py-2 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderFullTimeBody(g) {
    const adjTotal = (g.adjustments || []).reduce((s, a) => s + (a.delta || 0), 0);
    const adjRows = (g.adjustments || [])
      .map(
        (a) => `
        <div class="flex justify-between text-xs py-1 border-t border-slate-100">
          <span>${esc(a.month)} — ${esc(a.reason || "")}</span>
          <span class="font-semibold" style="color:${a.delta < 0 ? "#dc2626" : "#16a34a"}">${a.delta >= 0 ? "+" : ""}${fmtVnd(a.delta)}</span>
        </div>`
      )
      .join("");
    return `
      <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div class="p-3 rounded-lg" style="background:#f8fafc;border:1px solid #e2e8f0">
          <div class="text-slate-500">Lương tháng</div>
          <div class="font-bold text-lg">${fmtVnd(g.LuongThang)}</div>
        </div>
        <div class="p-3 rounded-lg" style="background:#f8fafc;border:1px solid #e2e8f0">
          <div class="text-slate-500">Điều chỉnh</div>
          <div class="font-bold text-lg" style="color:${adjTotal < 0 ? "#dc2626" : "#16a34a"}">${adjTotal >= 0 ? "+" : ""}${fmtVnd(adjTotal)}</div>
        </div>
        <div class="p-3 rounded-lg" style="background:#f0fdf4;border:1px solid #bbf7d0">
          <div class="text-slate-500">Tổng</div>
          <div class="font-bold text-lg" style="color:#166534">${fmtVnd(g.subtotal)}</div>
        </div>
      </div>
      ${adjRows ? `<div class="mt-2 p-2 bg-slate-50 rounded-lg">${adjRows}</div>` : ""}
      <div class="ft-cal-mount mt-3" data-task-id="${g.task_id}"></div>`;
  }

  function renderGroups(groups) {
    const box = document.getElementById("salary-groups");
    if (!box) return;
    if (!groups || groups.length === 0) {
      box.innerHTML = `<div class="text-center p-8 text-slate-400 text-sm">Không có công việc có lương trong khoảng thời gian này.</div>`;
      return;
    }
    box.innerHTML = groups
      .map((g) => {
        const expanded = _expandedGroups.has(g.task_id);
        const summaryRight =
          g.type === "part_time"
            ? `${g.shiftCount || 0} ca · ${fmtVnd(g.subtotal)}`
            : fmtVnd(g.subtotal);
        return `
          <div class="border border-slate-200 rounded-xl mb-2 bg-white" data-group="${g.task_id}">
            <div class="flex items-center justify-between p-3 cursor-pointer" data-toggle="${g.task_id}">
              <div class="flex items-center gap-2">
                <i class="fas fa-chevron-${expanded ? "down" : "right"} text-xs text-slate-400"></i>
                <span class="font-semibold text-sm">${esc(g.title)}</span>
                ${typeBadge(g.type)}
              </div>
              <div class="flex items-center gap-3">
                <span class="text-sm font-semibold">${summaryRight}</span>
                <button class="btn-export-txt px-2 py-1 rounded text-[11px] font-semibold border border-slate-200 bg-white"
                        data-task-id="${g.task_id}" title="Xuất TXT">
                  <i class="fas fa-file-export mr-1"></i>TXT
                </button>
              </div>
            </div>
            ${expanded ? `<div class="px-3 pb-3">${g.type === "part_time" ? renderPartTimeBody(g) : renderFullTimeBody(g)}</div>` : ""}
          </div>`;
      })
      .join("");

    // Bind expand/collapse
    box.querySelectorAll("[data-toggle]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest(".btn-export-txt")) return;
        const id = parseInt(el.getAttribute("data-toggle"), 10);
        if (_expandedGroups.has(id)) {
          _expandedGroups.delete(id);
          if (window.SalaryFullTimeCalendar?.destroyByTaskId)
            window.SalaryFullTimeCalendar.destroyByTaskId(id);
        } else {
          _expandedGroups.add(id);
        }
        renderGroups(_allGroups);
        // Mount full-time calendar lazily after DOM updates
        if (_expandedGroups.has(id)) {
          const g = _allGroups.find((x) => x.task_id === id);
          if (g && g.type === "full_time" && window.SalaryFullTimeCalendar?.render) {
            const mount = box.querySelector(`.ft-cal-mount[data-task-id="${id}"]`);
            if (mount) window.SalaryFullTimeCalendar.render(mount, g);
          }
        }
      })
    );

    // Bind TXT export (delegation)
    box.querySelectorAll(".btn-export-txt").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        exportTxt(parseInt(b.getAttribute("data-task-id"), 10));
      })
    );
  }

  // --- Chart ------------------------------------------------------------
  function renderChart(timeline) {
    const canvas = document.getElementById("salary-chart");
    if (!canvas || typeof Chart === "undefined") return;
    if (_chart) {
      _chart.destroy();
      _chart = null;
    }
    if (!timeline || !timeline.length) return;
    _chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: timeline.map((d) =>
          new Date(d.date).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
          })
        ),
        datasets: [
          {
            label: "Thu nhập",
            data: timeline.map((d) => d.amount),
            borderColor: "#dc2626",
            backgroundColor: "rgba(220,38,38,0.08)",
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmtVnd(ctx.raw)}` } },
        },
        scales: {
          y: { ticks: { callback: (v) => fmt(v) } },
        },
      },
    });
  }

  // --- Filters ----------------------------------------------------------
  function applyFilters() {
    const q = (document.getElementById("filter-search")?.value || "")
      .trim()
      .toLowerCase();
    if (!q) return renderGroups(_allGroups);
    const filtered = _allGroups.filter((g) => {
      if ((g.title || "").toLowerCase().includes(q)) return true;
      return (g.entries || []).some((e) =>
        (e.note || "").toLowerCase().includes(q)
      );
    });
    renderGroups(filtered);
  }

  // --- Export TXT (Phase 09 spec) ---------------------------------------
  function slugify(s) {
    return String(s || "untitled")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function buildTxtContent(g) {
    const lines = [g.title, "=".repeat(Math.min(40, g.title.length))];
    if (g.type === "part_time") {
      (g.entries || []).forEach((e) => {
        const s = new Date(e.start_at || e.date);
        const ed = e.end_at ? new Date(e.end_at) : null;
        const date = s.toISOString().slice(0, 10);
        const opts = { hour: "2-digit", minute: "2-digit", hour12: false };
        const from = s.toLocaleTimeString("vi-VN", opts);
        const to = ed ? ed.toLocaleTimeString("vi-VN", opts) : "";
        const shift = e.shift_name ? ` [${e.shift_name}]` : "";
        const note = e.note ? ` — ${e.note}` : "";
        lines.push(`${date} ${from}${to ? "-" + to : ""}${shift}${note}`);
      });
    } else if (g.type === "full_time") {
      (g.workedDates || []).forEach((d) => lines.push(`${d} (đã đi làm)`));
    }
    return lines.join("\n");
  }

  function exportTxt(taskId) {
    const g = _allGroups.find((x) => x.task_id === taskId);
    if (!g) return;
    const blob = new Blob(["\uFEFF" + buildTxtContent(g)], {
      type: "text/plain;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(g.title)}-${isoDate(new Date())}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Load pipeline ----------------------------------------------------
  async function loadAndRender(from, to) {
    const box = document.getElementById("salary-groups");
    if (box)
      box.innerHTML = `<div class="text-center p-6 text-slate-400 text-sm">Đang tải...</div>`;
    try {
      const data = await loadSalary(from, to);
      _allGroups = data.groups || [];
      _totalSalary = data.totalSalary || 0;
      _totalHours = data.totalHours || 0;
      renderStats();
      applyFilters();
      renderChart(data.timeline || []);
    } catch (err) {
      console.error("[salary] load error:", err);
      if (box)
        box.innerHTML = `<div class="text-center p-6 text-red-500 text-sm">Lỗi: ${esc(err.message)}</div>`;
    }
  }

  // --- Tab switcher (replaces old salaryManager.js responsibility) -----
  function wireTabs() {
    const tabs = document.querySelectorAll(".tab[data-tab]");
    const salaryView = document.getElementById("salary-view");
    const statsView = document.getElementById("stats-view");
    tabs.forEach((tab) =>
      tab.addEventListener("click", function () {
        tabs.forEach((t) => t.classList.remove("active"));
        this.classList.add("active");
        const type = this.getAttribute("data-tab");
        const pageTitle = document.querySelector(".salary-page .header h1");
        if (type === "salary") {
          salaryView?.classList.remove("hidden");
          statsView?.classList.add("hidden");
          if (pageTitle) pageTitle.textContent = "Tính lương";
          const from = document.getElementById("filter-from")?.value;
          const to = document.getElementById("filter-to")?.value;
          loadAndRender(from, to);
        } else {
          salaryView?.classList.add("hidden");
          statsView?.classList.remove("hidden");
          if (pageTitle) pageTitle.textContent = "Thống kê";
          window.StatsManager?.handleLoadStats?.();
        }
      })
    );
  }

  // --- Init -------------------------------------------------------------
  function initDateInputs() {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const fromEl = document.getElementById("filter-from");
    const toEl = document.getElementById("filter-to");
    if (fromEl && !fromEl.value) fromEl.value = isoDate(monthStart);
    if (toEl && !toEl.value) toEl.value = isoDate(today);
  }

  function init() {
    initDateInputs();
    wireTabs();

    document.getElementById("btn-apply")?.addEventListener("click", () => {
      const from = document.getElementById("filter-from")?.value;
      const to = document.getElementById("filter-to")?.value;
      loadAndRender(from, to);
    });

    document.querySelectorAll(".np-preset").forEach((btn) =>
      btn.addEventListener("click", function () {
        document.querySelectorAll(".np-preset").forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        const { from, to } = getPresetRange(this.dataset.preset);
        document.getElementById("filter-from").value = from;
        document.getElementById("filter-to").value = to;
        loadAndRender(from, to);
      })
    );

    let searchTimer = null;
    document.getElementById("filter-search")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 200);
    });

    // Initial load only if Salary tab is visible (default is Stats tab)
    const salaryView = document.getElementById("salary-view");
    if (salaryView && !salaryView.classList.contains("hidden")) {
      const from = document.getElementById("filter-from")?.value;
      const to = document.getElementById("filter-to")?.value;
      loadAndRender(from, to);
    }
  }

  function maybeAutoInit() {
    if (document.getElementById("salary-groups")) init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeAutoInit);
  } else {
    maybeAutoInit();
  }

  window.SalaryManager = { init, loadSalary, loadAndRender };
})();
