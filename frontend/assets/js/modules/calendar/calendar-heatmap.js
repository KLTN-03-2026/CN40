/**
 * calendar-heatmap.js
 * Reusable GitHub-style calendar heatmap component.
 * Usage: CalendarHeatmap.render(containerId, data, options)
 */
window.CalendarHeatmap = {
  DEFAULT_SCALE: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  DARK_SCALE: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  DAYS: ["", "Mon", "", "Wed", "", "Fri", ""],
  MONTHS: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],

  /**
   * @param {string} containerId
   * @param {Array<{date: string, value: number|null}>} data  date='YYYY-MM-DD', value 0-1 or null
   * @param {object} options  { year, colorScale, tooltipFn, cellSize, cellGap }
   */
  render(containerId, data, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const isDark = document.body.classList.contains("dark");
    const scale = options.colorScale || (isDark ? this.DARK_SCALE : this.DEFAULT_SCALE);
    const cellSize = options.cellSize || 12;
    const cellGap = options.cellGap !== undefined ? options.cellGap : 2;
    const year = options.year || new Date().getFullYear();
    const step = cellSize + cellGap;

    // Build date→value map
    const dataMap = new Map();
    (data || []).forEach((d) => dataMap.set(d.date, d.value));

    // Tooltip element (shared, reused on hover)
    let tooltip = container.querySelector(".ch-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ch-tooltip";
      tooltip.style.cssText =
        "position:fixed;background:#1e293b;color:#fff;font-size:11px;" +
        "padding:4px 8px;border-radius:4px;pointer-events:none;display:none;z-index:9999;" +
        "white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
      document.body.appendChild(tooltip);
    }

    // Grid wrapper (scrollable)
    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "overflow-x:auto;padding-bottom:4px;";

    // Outer flex: day-labels + grid columns
    const outerFlex = document.createElement("div");
    outerFlex.style.cssText = "display:flex;gap:4px;";

    // Day labels column
    const dayLabels = document.createElement("div");
    dayLabels.style.cssText =
      `display:flex;flex-direction:column;gap:${cellGap}px;margin-top:${step + 4}px;`;
    this.DAYS.forEach((label) => {
      const el = document.createElement("div");
      el.style.cssText =
        `height:${cellSize}px;font-size:9px;color:#94a3b8;` +
        `line-height:${cellSize}px;text-align:right;padding-right:4px;min-width:24px;`;
      el.textContent = label;
      dayLabels.appendChild(el);
    });
    outerFlex.appendChild(dayLabels);

    // Build weeks grid
    const gridEl = document.createElement("div");
    gridEl.style.cssText = "display:flex;flex-direction:row;gap:2px;";

    // Find first day of year and pad to Monday
    const jan1 = new Date(`${year}-01-01T00:00:00Z`);
    // getUTCDay: 0=Sun,1=Mon,...,6=Sat. We want Mon=0
    const jan1DayOfWeek = (jan1.getUTCDay() + 6) % 7; // Mon-based

    // Determine total weeks needed
    const daysInYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
    const totalWeeks = Math.ceil((daysInYear + jan1DayOfWeek) / 7);

    const monthLabelOffsets = {}; // weekIndex → month label

    // For each week column
    for (let w = 0; w < totalWeeks; w++) {
      const weekCol = document.createElement("div");
      weekCol.style.cssText = `display:flex;flex-direction:column;gap:${cellGap}px;`;

      // Month label above (1 row)
      const monthLabel = document.createElement("div");
      monthLabel.style.cssText =
        `height:${step}px;font-size:9px;color:#94a3b8;line-height:${step}px;` +
        `min-width:${cellSize}px;text-align:center;`;

      // Determine if this week starts a new month
      const firstDayOfWeek = w * 7 - jan1DayOfWeek;
      if (firstDayOfWeek >= 0 && firstDayOfWeek < daysInYear) {
        const d = new Date(jan1);
        d.setUTCDate(d.getUTCDate() + firstDayOfWeek);
        if (d.getUTCDate() <= 7 && !monthLabelOffsets[d.getUTCMonth()]) {
          monthLabel.textContent = this.MONTHS[d.getUTCMonth()];
          monthLabelOffsets[d.getUTCMonth()] = true;
        }
      }
      weekCol.appendChild(monthLabel);

      // 7 day cells
      for (let d = 0; d < 7; d++) {
        const dayIndex = w * 7 + d - jan1DayOfWeek;
        const cell = document.createElement("div");
        cell.style.cssText =
          `width:${cellSize}px;height:${cellSize}px;border-radius:2px;cursor:pointer;` +
          `transition:transform 0.1s;box-sizing:border-box;`;

        if (dayIndex < 0 || dayIndex >= daysInYear) {
          // Out-of-range filler
          cell.style.background = "transparent";
        } else {
          const dateObj = new Date(jan1);
          dateObj.setUTCDate(dateObj.getUTCDate() + dayIndex);
          const dateStr = dateObj.toISOString().split("T")[0];
          const value = dataMap.has(dateStr) ? dataMap.get(dateStr) : null;
          const color = this.getColor(value, scale);
          cell.style.background = color;
          cell.dataset.date = dateStr;
          cell.dataset.value = value !== null ? value : "";

          // Hover interactions
          cell.addEventListener("mouseenter", (e) => {
            cell.style.transform = "scale(1.3)";
            const label = options.tooltipFn
              ? options.tooltipFn(dateStr, value)
              : this._defaultTooltip(dateStr, value);
            tooltip.textContent = label;
            tooltip.style.display = "block";
          });
          cell.addEventListener("mousemove", (e) => {
            tooltip.style.left = e.clientX + 12 + "px";
            tooltip.style.top = e.clientY - 28 + "px";
          });
          cell.addEventListener("mouseleave", () => {
            cell.style.transform = "scale(1)";
            tooltip.style.display = "none";
          });
        }

        weekCol.appendChild(cell);
      }

      gridEl.appendChild(weekCol);
    }

    outerFlex.appendChild(gridEl);
    wrapper.appendChild(outerFlex);
    container.appendChild(wrapper);

    // Legend row — binary mode (habits) or gradient mode (stats)
    const legend = document.createElement("div");
    legend.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-top:8px;justify-content:flex-end;";

    if (options.binaryMode) {
      // Simple two-state legend for habits
      const items = [
        { color: scale[0], label: "Chưa hoàn thành" },
        { color: scale[scale.length - 1], label: "Đã hoàn thành" },
      ];
      items.forEach(({ color, label }) => {
        const sq = document.createElement("div");
        sq.style.cssText =
          `width:${cellSize}px;height:${cellSize}px;border-radius:2px;background:${color};flex-shrink:0;`;
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:10px;color:#94a3b8;";
        lbl.textContent = label;
        legend.appendChild(sq);
        legend.appendChild(lbl);
        // Spacer between pairs
        const spacer = document.createElement("span");
        spacer.style.cssText = "width:8px;";
        legend.appendChild(spacer);
      });
    } else {
      // Gradient legend for stats
      const legendLabel = document.createElement("span");
      legendLabel.style.cssText = "font-size:10px;color:#94a3b8;margin-right:4px;";
      legendLabel.textContent = "Ít";
      legend.appendChild(legendLabel);
      scale.forEach((color) => {
        const sq = document.createElement("div");
        sq.style.cssText =
          `width:${cellSize}px;height:${cellSize}px;border-radius:2px;background:${color};`;
        legend.appendChild(sq);
      });
      const moreLbl = document.createElement("span");
      moreLbl.style.cssText = "font-size:10px;color:#94a3b8;margin-left:4px;";
      moreLbl.textContent = "Nhiều";
      legend.appendChild(moreLbl);
    }
    container.appendChild(legend);
  },

  getColor(value, scale) {
    if (value === null || value === undefined) return scale[0];
    if (value === 0) return scale[0];
    const idx = Math.min(
      Math.ceil(value * (scale.length - 1)),
      scale.length - 1
    );
    return scale[idx];
  },

  _defaultTooltip(dateStr, value) {
    if (value === null || value === undefined) return dateStr + ": Không có dữ liệu";
    return `${dateStr}: ${Math.round(value * 100)}%`;
  },
};
