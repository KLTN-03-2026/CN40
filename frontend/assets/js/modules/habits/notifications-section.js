// Notifications section controller.
// Handles Telegram link flow + all pref toggles/time pickers against
// /api/notifications/prefs and /api/notifications/telegram-*.
// Guards against double-bind when the section re-mounts.

(function () {
  "use strict";

  const TOGGLES = [
    { key: "thongBaoNhiemVu",   icon: "fa-tasks",        title: "Nhắc nhở nhiệm vụ hôm nay", hint: "Bot gửi danh sách công việc hàng ngày" },
    { key: "thongBaoHangNgay",  icon: "fa-sun",          title: "Thông báo hàng ngày",        hint: "Tóm tắt lịch trình đầu ngày" },
    { key: "thongBaoTuan",      icon: "fa-chart-bar",    title: "Thống kê cuối tuần",         hint: "Gửi vào Chủ nhật 20:00" },
    { key: "thongBaoCuoiTuan",  icon: "fa-seedling",     title: "Gợi ý cuối tuần (AI)",       hint: "Đề xuất công việc cân bằng dựa trên thống kê" },
    { key: "thongBaoLuong",     icon: "fa-money-bill",   title: "Thông báo lương tháng",      hint: "Gửi vào ngày bạn chọn, chi tiết theo từng công việc" },
  ];

  const $ = (id) => document.getElementById(id);
  let state = null;
  let saveTimer = null;
  let wiredOnce = false;

  // Expose init for componentLoader — called each time the section mounts.
  window.NotificationsSection = { init: boot };

  async function boot() {
    // Guard: only run when the notifications page DOM is actually present.
    if (!$("tg-status-badge") || !$("notif-toggle-list")) return;
    buildToggleRows();
    buildDayOfMonthOptions();
    if (!wiredOnce) { wireButtons(); wiredOnce = true; }
    await refreshAll();
  }

  function buildToggleRows() {
    const host = $("notif-toggle-list");
    if (!host || host.childElementCount > 0) return;
    host.innerHTML = TOGGLES.map(
      (t) => `
        <div class="flex items-center justify-between py-3">
          <div class="flex items-center gap-3">
            <i class="fas ${t.icon} text-slate-400 w-5 text-center"></i>
            <div>
              <div class="text-sm font-medium text-slate-700">${t.title}</div>
              <div class="text-xs text-slate-400">${t.hint}</div>
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" data-pref="${t.key}" class="sr-only peer" />
            <div class="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-indigo-500 transition"></div>
            <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition peer-checked:translate-x-5"></div>
          </label>
        </div>`
    ).join("");
  }

  function buildDayOfMonthOptions() {
    const sel = $("pref-ngay-luong");
    if (!sel || sel.childElementCount > 0) return;
    let html = "";
    for (let d = 1; d <= 28; d++) html += `<option value="${d}">Ngày ${d}</option>`;
    sel.innerHTML = html;
  }

  function wireButtons() {
    $("btn-tg-connect")?.addEventListener("click", onConnect);
    $("btn-tg-disconnect")?.addEventListener("click", onDisconnect);
    $("btn-tg-refresh")?.addEventListener("click", refreshAll);

    document.querySelectorAll('[data-pref]').forEach((el) => {
      el.addEventListener("change", onPrefChange);
    });
    ["time-lich-ngay", "time-nhac-nhiem-vu", "time-tong-ket"].forEach((id) => {
      $(id)?.addEventListener("change", onTimeChange);
    });
    $("pref-ngay-luong")?.addEventListener("change", onDayChange);
    $("pref-thongbao-15phut")?.addEventListener("change", onPreReminderToggle);
    $("pref-phut-nhac-truoc")?.addEventListener("change", onPreReminderMinutes);
  }

  async function refreshAll() {
    await Promise.all([loadTelegramStatus(), loadPrefs()]);
  }

  async function loadTelegramStatus() {
    const badge = $("tg-status-badge");
    const text = $("tg-status-text");
    const connectBtn = $("btn-tg-connect");
    const disconnectBtn = $("btn-tg-disconnect");

    try {
      const res = await api("/api/notifications/telegram-status");
      const connected = !!res?.connected;
      setLocked(!connected);
      badge.textContent = connected ? "Đã kết nối" : "Chưa kết nối";
      badge.className =
        "px-3 py-1 rounded-full text-xs font-semibold " +
        (connected ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700");
      text.textContent = connected
        ? "Bot đang gửi thông báo về Telegram của bạn."
        : "Kết nối tài khoản Telegram để nhận nhắc nhở và thống kê.";
      connectBtn.classList.toggle("hidden", connected);
      disconnectBtn.classList.toggle("hidden", !connected);
      $("tg-link-hint").classList.add("hidden");
    } catch {
      badge.textContent = "Lỗi";
      text.textContent = "Không lấy được trạng thái kết nối.";
    }
  }

  function setLocked(locked) {
    const cards = [$("notif-prefs-card"), $("notif-times-card"), $("notif-prereminder-card")];
    cards.forEach((c) => {
      if (!c) return;
      c.classList.toggle("opacity-60", locked);
      c.classList.toggle("pointer-events-none", locked);
    });
  }

  async function loadPrefs() {
    try {
      const res = await api("/api/notifications/prefs");
      if (!res?.data) return;
      state = res.data;
      applyStateToDOM();
    } catch (err) {
      console.error("loadPrefs:", err);
    }
  }

  function applyStateToDOM() {
    if (!state) return;
    for (const t of TOGGLES) {
      const el = document.querySelector(`[data-pref="${t.key}"]`);
      if (el) el.checked = !!state[t.key];
    }
    if ($("time-lich-ngay"))       $("time-lich-ngay").value       = state.gioLichNgay      || "08:00";
    if ($("time-nhac-nhiem-vu"))   $("time-nhac-nhiem-vu").value   = state.gioNhacNhiemVu   || "14:00";
    if ($("time-tong-ket"))        $("time-tong-ket").value        = state.gioTongKetNgay   || "18:00";
    if ($("pref-ngay-luong"))      $("pref-ngay-luong").value      = String(state.ngayNhanLuong || 1);
    if ($("pref-thongbao-15phut")) $("pref-thongbao-15phut").checked = !!state.thongBao15Phut;
    if ($("pref-phut-nhac-truoc")) $("pref-phut-nhac-truoc").value = String(state.phutNhacTruoc || 15);
  }

  function onPrefChange(e) {
    const key = e.target.dataset.pref;
    scheduleSave({ [key]: e.target.checked });
  }
  function onTimeChange(e) {
    const map = { "time-lich-ngay": "gioLichNgay", "time-nhac-nhiem-vu": "gioNhacNhiemVu", "time-tong-ket": "gioTongKetNgay" };
    const k = map[e.target.id];
    if (k) scheduleSave({ [k]: e.target.value });
  }
  function onDayChange(e) {
    scheduleSave({ ngayNhanLuong: parseInt(e.target.value, 10) });
  }
  function onPreReminderToggle(e) {
    scheduleSave({ thongBao15Phut: e.target.checked });
  }
  function onPreReminderMinutes(e) {
    // Clamp to [1, 180] before saving so server-side validation never trips on slips.
    let n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n)) n = 15;
    n = Math.max(1, Math.min(180, n));
    e.target.value = String(n);
    scheduleSave({ phutNhacTruoc: n });
  }

  let pending = {};
  function scheduleSave(patch) {
    pending = { ...pending, ...patch };
    setSaveState("Đang lưu...");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }
  async function flushSave() {
    const body = pending;
    pending = {};
    try {
      const res = await api("/api/notifications/prefs", { method: "PUT", body });
      if (!res?.success) throw new Error(res?.message || "Lỗi lưu");
      state = { ...state, ...body };
      setSaveState("Đã đồng bộ");
    } catch (err) {
      console.error("save prefs:", err);
      setSaveState("❌ " + (err.message || "Lỗi"));
    }
  }
  function setSaveState(text) {
    const el = $("prefs-save-state");
    if (el) el.textContent = text;
  }

  async function onConnect() {
    const hint = $("tg-link-hint");
    hint.classList.remove("hidden");
    hint.innerHTML = "Đang lấy liên kết...";
    try {
      const res = await api("/api/notifications/telegram-connect-url");
      if (!res?.telegramUrl) throw new Error("Không tạo được liên kết");
      hint.innerHTML =
        `Nhấn <a class="font-semibold underline" target="_blank" rel="noopener" href="${res.telegramUrl}">mở Telegram</a> ` +
        `và chọn <b>Start</b>. Liên kết có hiệu lực 10 phút. ` +
        `Nếu đã mở, gõ <code>/start ${res.code}</code> trong chat với bot.`;
      window.open(res.telegramUrl, "_blank", "noopener");

      // Poll status for 60s after user clicks.
      pollUntilConnected(60);
    } catch (err) {
      hint.innerHTML = "❌ " + err.message;
    }
  }

  async function pollUntilConnected(seconds) {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = await api("/api/notifications/telegram-status");
        if (res?.connected) { await refreshAll(); return; }
      } catch { /* ignore */ }
    }
  }

  async function onDisconnect() {
    if (!await Utils.confirmDanger("Ngắt kết nối Telegram? Bạn sẽ không nhận thông báo nữa.", "Ngắt kết nối")) return;
    try {
      await api("/api/notifications/disconnect", { method: "POST" });
      await refreshAll();
    } catch (err) {
      Utils?.alert?.(err.message || "Không thể ngắt kết nối", "Lỗi", "error");
    }
  }

  async function api(path, opts = {}) {
    const token = localStorage.getItem("auth_token");
    if (!token) return {};
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  }
})();
