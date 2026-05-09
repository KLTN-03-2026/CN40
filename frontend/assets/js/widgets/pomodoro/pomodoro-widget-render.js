// pomodoro-widget-render.js — DOM construction helpers for PomodoroWidget.
// Consumed exclusively by pomodoro-widget.js (same page scope).

const PomodoroRender = (() => {
  const CIRCUMFERENCE = 2 * Math.PI * 36; // r=36 on 80x80 viewBox

  // Build the full widget DOM and append to container.
  // Returns refs object { root, timeEl, taskNameEl, ringProgress, phaseLabel, pauseBtn }.
  function buildWidget(container) {
    const root = document.createElement("div");
    root.className = "pomodoro-widget";
    root.id = "pomodoroWidgetEl";
    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span class="pomodoro-phase-label" style="font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;"></span>
        <button class="pomodoro-btn-minimize" title="Thu nhỏ" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:14px;padding:2px 4px;line-height:1;">&#8211;</button>
      </div>
      <div class="pomodoro-main-content">
        <div style="display:flex;justify-content:center;position:relative;">
          <svg class="pomodoro-ring-svg" viewBox="0 0 80 80">
            <circle class="pomodoro-ring-bg" cx="40" cy="40" r="36"/>
            <circle class="pomodoro-ring-progress" cx="40" cy="40" r="36"
              stroke-dasharray="${CIRCUMFERENCE}"
              stroke-dashoffset="0"/>
          </svg>
          <span class="pomodoro-time" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">25:00</span>
        </div>
        <div class="pomodoro-task-name"></div>
        <div class="pomodoro-controls">
          <button class="pomodoro-btn-pause" title="Tạm dừng / Tiếp tục">&#9646;&#9646;</button>
          <button class="pomodoro-btn-stop" title="Dừng">&#9632;</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    return {
      root,
      timeEl: root.querySelector(".pomodoro-time"),
      taskNameEl: root.querySelector(".pomodoro-task-name"),
      ringProgress: root.querySelector(".pomodoro-ring-progress"),
      phaseLabel: root.querySelector(".pomodoro-phase-label"),
      pauseBtn: root.querySelector(".pomodoro-btn-pause"),
      stopBtn: root.querySelector(".pomodoro-btn-stop"),
      minimizeBtn: root.querySelector(".pomodoro-btn-minimize"),
      mainContent: root.querySelector(".pomodoro-main-content"),
    };
  }

  // Update the countdown text (MM:SS).
  function renderTime(timeEl, seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    timeEl.textContent = `${m}:${s}`;
  }

  // Update the SVG progress ring.
  // progress: 0.0 (empty) → 1.0 (full).
  function renderRing(ringProgress, progress) {
    const offset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress)));
    ringProgress.style.strokeDashoffset = offset;
  }

  // Update phase label text and ring colour class.
  function renderPhase(root, phaseLabel, phase) {
    const labels = { focus: "Tập trung", short_break: "Nghỉ ngắn", long_break: "Nghỉ dài" };
    phaseLabel.textContent = labels[phase] || phase;
    // Colour: red for focus, green for breaks (via CSS .phase-break class).
    if (phase === "focus") {
      root.classList.remove("phase-break");
    } else {
      root.classList.add("phase-break");
    }
  }

  // Toggle minimized state — show/hide main content, update minimize button label.
  function toggleMinimize(root, mainContent, minimizeBtn) {
    const isMin = root.classList.toggle("minimized");
    mainContent.style.display = isMin ? "none" : "";
    minimizeBtn.innerHTML = isMin ? "&#9633;" : "&#8211;";
  }

  return { buildWidget, renderTime, renderRing, renderPhase, toggleMinimize, CIRCUMFERENCE };
})();
