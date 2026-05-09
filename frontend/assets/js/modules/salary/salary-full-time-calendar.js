/**
 * salary-full-time-calendar.js
 * Mini-calendar rendered inside each expanded full-time job in the Salary tab.
 *
 * Two tabs:
 *   "Đã đi làm" — green highlight on dates the user actually clocked in
 *                 (worked_dates from backend = completed task_instances).
 *   "Dự kiến"   — gray stripe on every day matching the job's NgayLamViec
 *                 bitmap (fallback: Mon–Fri), bounded by the contract's
 *                 NgayBatDauHopDong / NgayKetThucHopDong if set.
 *
 * Depends on FullCalendar v6 (already loaded by index.html).
 *
 * Public API (window.SalaryFullTimeCalendar):
 *   render(containerEl, group)
 *   destroy(containerEl)
 *   destroyByTaskId(taskId)
 */
(function () {
  "use strict";
  if (window.SalaryFullTimeCalendar) return;

  // task_id -> { calendar, container, activeTab }
  const instances = new Map();

  // ISO day-of-week (1..7, Mon..Sun) from JS Date.getDay() (0..6, Sun..Sat)
  const isoDow = (d) => (d.getDay() === 0 ? 7 : d.getDay());

  function buildWorkedEvents(workedDates) {
    return (workedDates || []).map((d) => ({
      start: d,
      allDay: true,
      display: "background",
      color: "#10B981",
    }));
  }

  function buildExpectedEvents(viewStart, viewEnd, workingDays, contractStart, contractEnd) {
    const allowed = Array.isArray(workingDays) && workingDays.length
      ? new Set(workingDays.map((n) => parseInt(n, 10)))
      : new Set([1, 2, 3, 4, 5]); // default Mon–Fri
    const cStart = contractStart ? new Date(contractStart) : null;
    const cEnd = contractEnd ? new Date(contractEnd) : null;

    const events = [];
    const cur = new Date(viewStart);
    while (cur < viewEnd) {
      if (allowed.has(isoDow(cur))) {
        if ((!cStart || cur >= cStart) && (!cEnd || cur <= cEnd)) {
          events.push({
            start: cur.toISOString().slice(0, 10),
            allDay: true,
            display: "background",
            color: "rgba(148,163,184,0.45)",
          });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return events;
  }

  function swapSource(cal, events) {
    cal.removeAllEventSources();
    cal.addEventSource(events);
  }

  function render(containerEl, group) {
    if (!containerEl || !window.FullCalendar) return;
    // Clean any existing calendar for this task (toggling re-entry)
    destroyByTaskId(group.task_id);

    containerEl.innerHTML = `
      <div class="ft-cal-tabs flex gap-1 mb-2">
        <button class="ft-cal-tab px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                data-ft-tab="worked"
                style="background:#10b981;color:#fff;border-color:#10b981">
          Đã đi làm
        </button>
        <button class="ft-cal-tab px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                data-ft-tab="expected"
                style="background:#fff;color:#475569;border-color:#cbd5e1">
          Dự kiến
        </button>
      </div>
      <div class="ft-cal-mount-inner" style="min-height:320px"></div>`;

    const mount = containerEl.querySelector(".ft-cal-mount-inner");
    const calendar = new FullCalendar.Calendar(mount, {
      initialView: "dayGridMonth",
      height: 340,
      locale: "vi",
      firstDay: 1,
      headerToolbar: { left: "prev", center: "title", right: "next" },
      editable: false,
      selectable: false,
      events: buildWorkedEvents(group.workedDates),
      datesSet: (info) => {
        const state = instances.get(group.task_id);
        if (!state) return;
        if (state.activeTab === "expected") {
          swapSource(
            state.calendar,
            buildExpectedEvents(
              info.start,
              info.end,
              group.NgayLamViec,
              group.NgayBatDauHopDong,
              group.NgayKetThucHopDong
            )
          );
        }
      },
    });
    calendar.render();

    instances.set(group.task_id, {
      calendar,
      container: containerEl,
      activeTab: "worked",
    });

    // Tab click
    containerEl.querySelectorAll(".ft-cal-tab").forEach((btn) =>
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-ft-tab");
        const state = instances.get(group.task_id);
        if (!state) return;
        state.activeTab = tab;
        // Update active styling
        containerEl.querySelectorAll(".ft-cal-tab").forEach((b) => {
          const active = b.getAttribute("data-ft-tab") === tab;
          b.style.background = active ? "#10b981" : "#fff";
          b.style.color = active ? "#fff" : "#475569";
          b.style.borderColor = active ? "#10b981" : "#cbd5e1";
        });
        if (tab === "worked") {
          swapSource(state.calendar, buildWorkedEvents(group.workedDates));
        } else {
          const view = state.calendar.view;
          swapSource(
            state.calendar,
            buildExpectedEvents(
              view.currentStart,
              view.currentEnd,
              group.NgayLamViec,
              group.NgayBatDauHopDong,
              group.NgayKetThucHopDong
            )
          );
        }
      })
    );
  }

  function destroy(containerEl) {
    for (const [id, state] of instances.entries()) {
      if (state.container === containerEl) {
        state.calendar.destroy();
        instances.delete(id);
      }
    }
  }

  function destroyByTaskId(taskId) {
    const state = instances.get(taskId);
    if (state) {
      state.calendar.destroy();
      instances.delete(taskId);
    }
  }

  window.SalaryFullTimeCalendar = { render, destroy, destroyByTaskId };
})();
