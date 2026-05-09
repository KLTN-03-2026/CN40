/**
 * calendar-bulk-complete.js
 *
 * Adds 2 bulk-completion affordances to the main calendar page:
 *   - Multi-select mode (toggle button) + Ctrl/Shift-click shortcut:
 *       clicking events while in mode OR with modifier key adds/removes
 *       them from a selection set. A floating action bar confirms the
 *       bulk complete.
 *   - Daily-check button: confirms + marks every event today as done.
 *
 * Hooks into window.CalendarModule via a public event-click pre-handler
 * (`handleEventClick`) — returns true if the click was consumed so the
 * default detail modal is skipped.
 */
(function () {
  "use strict";
  if (window.CalendarBulkComplete) return;

  const state = {
    selectMode: false,          // toggled by "Chọn nhiều" button
    selected: new Set(),        // event IDs (MaLichTrinh)
    wiredToolbar: false,
  };

  function $(id) { return document.getElementById(id); }

  function setBtnActive(btn, active) {
    if (!btn) return;
    if (active) {
      btn.style.background = "#2563EB";
      btn.style.color = "#fff";
      btn.style.borderColor = "#2563EB";
    } else {
      btn.style.background = "#fff";
      btn.style.color = "#374151";
      btn.style.borderColor = "#e2e8f0";
    }
  }

  function applyElSelectedStyle(el, selected) {
    if (!el) return;
    if (selected) {
      el.classList.add("cal-evt-selected");
      el.style.outline = "3px solid #2563EB";
      el.style.outlineOffset = "1px";
      el.style.boxShadow = "0 0 0 4px rgba(37,99,235,0.2)";
    } else {
      el.classList.remove("cal-evt-selected");
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.style.boxShadow = "";
    }
  }

  function refreshEventStyles() {
    document.querySelectorAll(".fc-event[data-event-id]").forEach((el) => {
      const id = el.getAttribute("data-event-id");
      applyElSelectedStyle(el, state.selected.has(id));
    });
  }

  /**
   * True if every currently-selected event is already completed in FullCalendar's
   * event store. Used to flip the action button between "Hoàn thành" and "Khôi phục".
   */
  function allSelectedAreCompleted() {
    const cal = window.CalendarModule?.calendar;
    if (!cal || state.selected.size === 0) return false;
    for (const id of state.selected) {
      const ev = cal.getEventById(id);
      if (!ev) return false;
      if (!ev.extendedProps?.completed) return false;
    }
    return true;
  }

  function updateBar() {
    const bar = $("cal-bulk-bar");
    const count = $("cal-bulk-count");
    const btn = $("cal-bulk-complete-btn");
    if (!bar || !count) return;
    const n = state.selected.size;
    count.textContent = String(n);
    if (n > 0) {
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
    // Swap action button into restore mode when every selected event is already done.
    if (btn) {
      const restore = n > 0 && allSelectedAreCompleted();
      btn.dataset.mode = restore ? "restore" : "complete";
      btn.style.background = restore ? "#f59e0b" : "#10b981";
      btn.innerHTML = restore
        ? '<i class="fas fa-rotate-left text-xs"></i><span>Khôi phục</span>'
        : '<i class="fas fa-check text-xs"></i><span>Hoàn thành</span>';
    }
  }

  function toggleSelection(eventId, el) {
    if (!eventId) return;
    if (state.selected.has(eventId)) {
      state.selected.delete(eventId);
      applyElSelectedStyle(el, false);
    } else {
      state.selected.add(eventId);
      applyElSelectedStyle(el, true);
    }
    updateBar();
  }

  function clearSelection() {
    state.selected.clear();
    refreshEventStyles();
    updateBar();
  }

  function setSelectMode(on) {
    state.selectMode = !!on;
    const btn = $("cal-multi-toggle");
    setBtnActive(btn, state.selectMode);
    if (btn) {
      btn.title = state.selectMode
        ? "Click công việc để chọn / bỏ chọn · Click lại nút để thoát"
        : "Bật chế độ chọn nhiều";
    }
    if (!state.selectMode) {
      clearSelection();
    }
  }

  // Public: pre-handler called from CalendarModule.eventClick.
  // Returns true if click consumed (skip default modal).
  function handleEventClick(info) {
    const modifier = info?.jsEvent?.ctrlKey || info?.jsEvent?.metaKey || info?.jsEvent?.shiftKey;
    if (!state.selectMode && !modifier) return false;

    const id = info?.event?.id;
    if (!id) return false;
    // Turning on multi mode implicitly when user modifier-clicks for the first time.
    if (modifier && !state.selectMode) {
      setSelectMode(true);
    }
    toggleSelection(id, info.el);
    return true;
  }

  async function refreshCalendar() {
    const cal = window.CalendarModule;
    if (cal?.refreshEventsInPlace) {
      await cal.refreshEventsInPlace();
    } else if (cal?.loadEvents) {
      await cal.loadEvents();
    }
  }

  /**
   * Split selection into [canAct, blockedFuture] for a given direction.
   * When completing, events whose start time is still in the future are
   * blocked ("chưa tới giờ"). When restoring, everything is allowed.
   */
  function partitionSelectionByTime(completed) {
    const cal = window.CalendarModule?.calendar;
    const now = Date.now();
    const canAct = [];
    const blockedFuture = [];
    for (const id of state.selected) {
      if (!completed) {
        canAct.push(id);
        continue;
      }
      const ev = cal?.getEventById(id);
      const t = ev?.start ? ev.start.getTime() : null;
      if (t !== null && t > now) {
        blockedFuture.push(id);
      } else {
        canAct.push(id);
      }
    }
    return { canAct, blockedFuture };
  }

  async function bulkComplete() {
    if (state.selected.size === 0) return;
    const restore = allSelectedAreCompleted();
    const completed = !restore;

    const { canAct, blockedFuture } = partitionSelectionByTime(completed);

    if (canAct.length === 0) {
      Utils.showToast?.(
        "Không có công việc nào có thể hoàn thành (các việc đã chọn chưa tới giờ).",
        "warning"
      );
      return;
    }
    if (blockedFuture.length > 0) {
      Utils.showToast?.(
        `Bỏ qua ${blockedFuture.length} công việc chưa tới giờ.`,
        "warning"
      );
    }

    try {
      const result = await Utils.makeRequest(
        "/api/schedule/complete-batch",
        "POST",
        { ids: canAct, completed }
      );
      if (!result.success) throw new Error(result.message || "Lỗi server");
      const updated = result.data?.updated ?? result.updated ?? canAct.length;
      const verb = completed ? "hoàn thành" : "khôi phục về chưa hoàn thành";
      Utils.showToast?.(`Đã ${verb} ${updated} việc`, "success");
      clearSelection();
      setSelectMode(false);
      await refreshCalendar();
    } catch (err) {
      console.error("bulkComplete error:", err);
      Utils.showToast?.(err.message || "Lỗi khi xử lý", "error");
    }
  }

  /**
   * Scan FullCalendar's current event store for today and decide whether we're
   * in "complete" or "restore" mode.
   *
   *   - pastTotal / pastDone    = events whose start <= now (eligible to complete)
   *   - dayTotal  / dayDone     = all events in today's window (for restore)
   *
   * Complete mode only considers past events (future ones stay untouched).
   * Restore mode considers the entire day (so accidental future marks can be undone).
   */
  function inspectToday() {
    const cal = window.CalendarModule?.calendar;
    const now = Date.now();
    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    let pastTotal = 0;
    let pastDone = 0;
    let dayTotal = 0;
    let dayDone = 0;
    if (cal) {
      for (const ev of cal.getEvents()) {
        const t = ev.start ? ev.start.getTime() : NaN;
        if (!(t >= dayStart && t < dayEnd)) continue;
        dayTotal++;
        const done = !!ev.extendedProps?.completed;
        if (done) dayDone++;
        if (t <= now) {
          pastTotal++;
          if (done) pastDone++;
        }
      }
    }
    return { pastTotal, pastDone, dayTotal, dayDone };
  }

  async function dailyCheck() {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    const { pastTotal, pastDone, dayTotal, dayDone } = inspectToday();

    // Restore = entire day is already done (safe to unmark everything, including future).
    // Complete = only affects past events (future ones are never marked by daily check).
    const restore = dayTotal > 0 && dayDone === dayTotal;
    const completed = !restore;

    let confirmTitle;
    if (restore) {
      confirmTitle = `Khôi phục ${dayTotal} công việc hôm nay?`;
    } else if (pastTotal === 0) {
      // Nothing to do yet — warn and bail.
      if (window.Swal) {
        await Swal.fire({
          icon: "info",
          title: "Chưa có việc nào đã qua giờ",
          text: "Daily check chỉ đánh dấu các công việc đã qua thời gian hiện tại.",
          confirmButtonColor: "#2563EB",
        });
      } else {
        Utils.showToast?.("Chưa có việc nào đã qua giờ", "warning");
      }
      return;
    } else {
      const remainingNote = pastTotal - pastDone;
      confirmTitle = `Đánh dấu ${remainingNote} công việc đã qua giờ hôm nay là hoàn thành?`;
    }

    const confirmIcon = restore ? "warning" : "question";
    const confirmBtnText = restore ? "Khôi phục" : "Đánh dấu";
    const confirmBtnColor = restore ? "#f59e0b" : "#10b981";

    let confirmed = false;
    if (window.Swal) {
      const r = await Swal.fire({
        title: "Xác nhận",
        html: `${confirmTitle} <br><span style="color:#64748b;font-size:13px">(${dateStr})</span>`,
        icon: confirmIcon,
        showCancelButton: true,
        confirmButtonText: confirmBtnText,
        cancelButtonText: "Huỷ",
        confirmButtonColor: confirmBtnColor,
      });
      confirmed = !!r.isConfirmed;
    } else {
      confirmed = await (window.Utils?.confirm?.(`${confirmTitle} (${dateStr})`) ?? Promise.resolve(window.confirm(`${confirmTitle} (${dateStr})`)));
    }
    if (!confirmed) return;

    try {
      const body = { date: dateStr, completed };
      // Cap upper bound at "now" so future events stay untouched on mark.
      if (completed) body.before = new Date().toISOString();
      const result = await Utils.makeRequest(
        "/api/schedule/complete-day",
        "POST",
        body
      );
      if (!result.success) throw new Error(result.message || "Lỗi server");
      const updated = result.data?.updated ?? result.updated ?? 0;
      const verb = completed ? "hoàn thành" : "khôi phục";
      if (window.Swal) {
        Swal.fire({
          icon: "success",
          title: completed ? "Hoàn thành" : "Đã khôi phục",
          text: updated > 0
            ? `Đã ${verb} ${updated} việc hôm nay.`
            : `Không có việc nào cần ${verb}.`,
          confirmButtonColor: confirmBtnColor,
        });
      } else {
        Utils.showToast?.(`Đã ${verb} ${updated} việc`, "success");
      }
      await refreshCalendar();
    } catch (err) {
      console.error("dailyCheck error:", err);
      Utils.showToast?.(err.message || "Lỗi khi daily check", "error");
    }
  }

  function showHelp() {
    const html = `
      <div style="text-align:left;font-size:14px;line-height:1.6">
        <p><strong>Chọn nhiều công việc:</strong></p>
        <ul style="padding-left:18px;list-style:disc">
          <li>Bấm <em>"Chọn nhiều"</em> → click từng việc trong lịch để chọn / bỏ chọn</li>
          <li>Hoặc giữ <kbd>Ctrl</kbd> (Windows) / <kbd>⌘</kbd> (Mac) rồi click để chọn nhanh</li>
          <li>Hoặc giữ <kbd>Shift</kbd> rồi click (cùng tác dụng Ctrl)</li>
          <li>Thanh hành động sẽ hiện bên dưới → bấm <em>"Hoàn thành"</em> để đánh dấu cả loạt</li>
        </ul>
        <p style="margin-top:10px"><strong>Hôm nay:</strong> đánh dấu 1 lần tất cả công việc trong ngày.</p>
      </div>
    `;
    if (window.Swal) {
      Swal.fire({ title: "Hướng dẫn", html, icon: "info", confirmButtonColor: "#2563EB" });
    } else {
      Utils?.alert?.("Bật nút hoặc giữ Ctrl/Shift rồi click việc cần chọn.", "Hướng dẫn chọn nhiều", "info");
    }
  }

  function wireToolbar() {
    if (state.wiredToolbar) return;
    const toggle = $("cal-multi-toggle");
    const help = $("cal-multi-help");
    const daily = $("cal-daily-check");
    const completeBtn = $("cal-bulk-complete-btn");
    const cancelBtn = $("cal-bulk-cancel-btn");

    // All five must be present; if the page hasn't rendered yet, bail — caller retries.
    if (!toggle || !help || !daily || !completeBtn || !cancelBtn) return;

    toggle.addEventListener("click", () => { if (!window.Utils?.requireAuth()) return; setSelectMode(!state.selectMode); });
    help.addEventListener("click", showHelp);
    daily.addEventListener("click", () => { if (!window.Utils?.requireAuth()) return; dailyCheck(); });
    completeBtn.addEventListener("click", () => { if (!window.Utils?.requireAuth()) return; bulkComplete(); });
    cancelBtn.addEventListener("click", () => {
      clearSelection();
      setSelectMode(false);
    });

    state.wiredToolbar = true;
  }

  // Init with retry — calendar-content.html is dynamically injected.
  function init() {
    let tries = 0;
    const tick = () => {
      wireToolbar();
      if (!state.wiredToolbar && tries++ < 50) {
        setTimeout(tick, 100);
      }
    };
    tick();
  }

  // Expose + auto-init on DOM ready / section change.
  window.CalendarBulkComplete = {
    handleEventClick,
    init,
    getSelection: () => Array.from(state.selected),
    isSelectMode: () => state.selectMode,
    refreshStyles: refreshEventStyles,
  };

  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("section-changed", (e) => {
    if (e?.detail?.section === "schedule") {
      state.wiredToolbar = false;
      init();
    }
  });
})();
