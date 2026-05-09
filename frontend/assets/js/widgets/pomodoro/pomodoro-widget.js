// pomodoro-widget.js — Floating Pomodoro timer widget.
// Depends on: pomodoro-widget-render.js (PomodoroRender must be loaded first).
// Public API: window.PomodoroWidget.start(taskId, taskTitle)

const PomodoroWidget = (() => {
  const DEFAULT_CONFIG = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakAfter: 4 };

  function loadConfig() {
    try { return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem("pomodoroConfig") || "{}")); }
    catch { return { ...DEFAULT_CONFIG }; }
  }

  // Timer state — reset on each start()
  let state = {
    isRunning: false, isPaused: false,
    taskId: null, taskTitle: "",
    phase: "focus",         // 'focus' | 'short_break' | 'long_break'
    pomodoroCount: 0,       // completed focus rounds this session
    timeRemaining: 0,       // seconds
    intervalId: null,
    startTime: null,        // performance.now() when current interval began
    totalDuration: 0,       // total seconds for current phase
    elapsedAtPause: 0,      // seconds elapsed before a pause
  };
  let refs = null; // DOM refs from PomodoroRender.buildWidget

  function phaseDuration(phase) {
    const cfg = loadConfig();
    if (phase === "focus") return cfg.focusMinutes * 60;
    if (phase === "short_break") return cfg.shortBreakMinutes * 60;
    return cfg.longBreakMinutes * 60;
  }

  function nextPhase() {
    if (state.phase !== "focus") return "focus";
    const cfg = loadConfig();
    state.pomodoroCount += 1;
    return state.pomodoroCount % cfg.longBreakAfter === 0 ? "long_break" : "short_break";
  }

  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }

  function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(title, { body, icon: "/assets/img/icon.png" });
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
    } catch (e) { /* Web Audio not supported */ }
  }

  async function recordSession(phase, durationMinutes, completed) {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    try {
      await fetch("/api/pomodoro/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskId: state.taskId, durationMinutes, completed, sessionType: phase }),
      });
    } catch (e) { console.warn("[pomodoro] Failed to record session:", e.message); }
  }

  // Uses performance.now() + elapsedAtPause to avoid setInterval drift.
  function tick() {
    const elapsed = state.elapsedAtPause + (performance.now() - state.startTime) / 1000;
    const remaining = Math.max(0, state.totalDuration - elapsed);
    state.timeRemaining = Math.ceil(remaining);
    updateDisplay();
    if (remaining <= 0) { clearInterval(state.intervalId); state.intervalId = null; onPhaseComplete(); }
  }

  function startInterval() {
    state.startTime = performance.now();
    state.intervalId = setInterval(tick, 500);
  }

  async function onPhaseComplete() {
    playBeep();
    const labels = { focus: "Tập trung", short_break: "Nghỉ ngắn", long_break: "Nghỉ dài" };
    sendNotification("Pomodoro", `${labels[state.phase] || state.phase} đã kết thúc!`);
    await recordSession(state.phase, Math.round(state.totalDuration / 60), true);
    switchPhase(nextPhase());
  }

  function switchPhase(phase) {
    state.phase = phase;
    state.totalDuration = phaseDuration(phase);
    state.elapsedAtPause = 0;
    state.timeRemaining = state.totalDuration;
    state.isPaused = false;
    if (refs) { PomodoroRender.renderPhase(refs.root, refs.phaseLabel, phase); refs.pauseBtn.innerHTML = "&#9646;&#9646;"; }
    updateDisplay();
    startInterval();
  }

  function updateDisplay() {
    if (!refs) return;
    PomodoroRender.renderTime(refs.timeEl, state.timeRemaining);
    const progress = state.totalDuration > 0 ? state.timeRemaining / state.totalDuration : 1;
    PomodoroRender.renderRing(refs.ringProgress, progress);
  }

  function start(taskId, taskTitle) {
    if (!window.Utils?.requireAuth()) return;
    if (state.isRunning) stop(false);
    requestNotificationPermission();
    Object.assign(state, {
      isRunning: true, isPaused: false, taskId: taskId ?? null, taskTitle: taskTitle || "",
      phase: "focus", pomodoroCount: 0, elapsedAtPause: 0,
    });
    state.totalDuration = phaseDuration("focus");
    state.timeRemaining = state.totalDuration;

    const container = document.getElementById("pomodoroWidgetContainer");
    if (!container) { console.error("[pomodoro] #pomodoroWidgetContainer missing"); return; }
    const old = document.getElementById("pomodoroWidgetEl");
    if (old) old.remove();

    refs = PomodoroRender.buildWidget(container);
    refs.taskNameEl.textContent = state.taskTitle || "Không có công việc";
    PomodoroRender.renderPhase(refs.root, refs.phaseLabel, state.phase);
    refs.pauseBtn.addEventListener("click", () => state.isPaused ? resume() : pause());
    refs.stopBtn.addEventListener("click", () => stop(true));
    refs.minimizeBtn.addEventListener("click", () =>
      PomodoroRender.toggleMinimize(refs.root, refs.mainContent, refs.minimizeBtn));

    updateDisplay();
    startInterval();
  }

  function pause() {
    if (!state.isRunning || state.isPaused) return;
    state.isPaused = true;
    state.elapsedAtPause += (performance.now() - state.startTime) / 1000;
    clearInterval(state.intervalId); state.intervalId = null;
    if (refs) refs.pauseBtn.innerHTML = "&#9654;"; // play icon
  }

  function resume() {
    if (!state.isRunning || !state.isPaused) return;
    state.isPaused = false;
    if (refs) refs.pauseBtn.innerHTML = "&#9646;&#9646;";
    startInterval();
  }

  async function stop(recordIt = true) {
    if (!state.isRunning) return;
    clearInterval(state.intervalId); state.intervalId = null;
    state.isRunning = false;
    if (recordIt) {
      const elapsed = state.elapsedAtPause + (state.startTime ? (performance.now() - state.startTime) / 1000 : 0);
      await recordSession(state.phase, Math.max(1, Math.round(elapsed / 60)), false);
    }
    const el = document.getElementById("pomodoroWidgetEl");
    if (el) el.remove();
    refs = null;
  }

  return { start, pause, resume, stop };
})();

window.PomodoroWidget = PomodoroWidget;
