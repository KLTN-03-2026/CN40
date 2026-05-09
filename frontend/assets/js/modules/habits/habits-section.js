/**
 * habits-section.js
 * Habit Tracker — today checklist, stats, monthly calendar, yearly heatmap.
 */
window.HabitsSection = {
  habits: [],
  selectedHabitId: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  currentMonthYear: new Date().getFullYear(),
  _heatmapData: [],
  _initialized: false,

  VMONTHS: ["Tháng 1","Tháng 2","Tháng 3","Tháng 4","Tháng 5","Tháng 6",
            "Tháng 7","Tháng 8","Tháng 9","Tháng 10","Tháng 11","Tháng 12"],
  VDAYS: ["T2","T3","T4","T5","T6","T7","CN"],

  async init() {
    if (this._initialized) { this.renderTodayList(); return; }
    this._initialized = true;
    await this.loadHabits();
    this.renderTodayList();
    this.bindEvents();
    if (this.habits.length > 0) {
      this.selectedHabitId = this.habits[0].HabitID;
      this._renderHabitSelector();
      await this._loadAndRenderAll();
    }
  },

  _authHeader() {
    const token = localStorage.getItem("auth_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  },

  async loadHabits() {
    if (!localStorage.getItem("auth_token")) { this.habits = []; return; }
    try {
      const res = await fetch("/api/habits", { headers: this._authHeader() });
      const json = await res.json();
      if (json.success) this.habits = json.data || [];
    } catch (_) { this.habits = []; }
  },

  // ── Today list ──

  renderTodayList() {
    const list = document.getElementById("habit-today-list");
    if (!list) return;
    if (this.habits.length === 0) {
      list.innerHTML = `<div class="habits-empty"><div class="empty-icon"><i class="fas fa-seedling"></i></div><p style="font-weight:600;font-size:15px;color:#64748b;">Chưa có thói quen nào</p><p style="font-size:13px;margin-top:4px;">Nhấn "Thêm thói quen" để bắt đầu hành trình</p></div>`;
      return;
    }
    list.innerHTML = "";
    this.habits.forEach((h) => list.appendChild(this._buildHabitRow(h)));
  },

  _buildHabitRow(h) {
    const row = document.createElement("div");
    row.className = "habit-row" + (h.completedToday ? " done" : "");
    row.dataset.habitId = h.HabitID;

    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "habit-checkbox";
    cb.checked = !!h.completedToday;
    cb.title = h.completedToday ? "Bỏ đánh dấu" : "Hoàn thành hôm nay";
    cb.addEventListener("change", async (e) => {
      e.stopPropagation();
      if (!window.Utils?.requireAuth()) { cb.checked = !cb.checked; return; }
      await this.toggleHabit(h.HabitID, new Date().toISOString().split("T")[0], cb.checked);
    });

    const icon = document.createElement("span");
    icon.className = "habit-icon";
    const ic = h.BieuTuong || "fas fa-bullseye";
    icon.innerHTML = (ic.startsWith("fas ") || ic.startsWith("far ") || ic.startsWith("fab "))
      ? `<i class="${ic}"></i>` : ic;

    const name = document.createElement("span");
    name.className = "habit-name"; name.textContent = h.TenThoiQuen;

    const streak = document.createElement("span");
    streak.className = "streak-badge";
    streak.innerHTML = `<i class="fas fa-fire"></i> ${h.Streak || 0}`;

    const actions = document.createElement("div");
    actions.className = "habit-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "habit-action-btn"; editBtn.title = "Chỉnh sửa";
    editBtn.innerHTML = '<i class="fas fa-pen"></i>';
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openModal(h); });
    const delBtn = document.createElement("button");
    delBtn.className = "habit-action-btn delete"; delBtn.title = "Xóa";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener("click", async (e) => { e.stopPropagation(); await this.deleteHabit(h.HabitID); });
    actions.appendChild(editBtn); actions.appendChild(delBtn);

    row.appendChild(cb); row.appendChild(icon); row.appendChild(name);
    row.appendChild(streak); row.appendChild(actions);

    row.addEventListener("click", async () => {
      if (this.selectedHabitId !== h.HabitID) {
        this.selectedHabitId = h.HabitID;
        this._renderHabitSelector();
        await this._loadAndRenderAll();
      }
    });
    return row;
  },

  async toggleHabit(habitId, date, completed) {
    try {
      let streak = 0;
      if (completed) {
        const r = await fetch(`/api/habits/${habitId}/log`, { method: "POST", headers: this._authHeader(), body: JSON.stringify({ date }) });
        const j = await r.json(); if (j.success) streak = j.data?.streak ?? 0;
      } else {
        const r = await fetch(`/api/habits/${habitId}/log/${date}`, { method: "DELETE", headers: this._authHeader() });
        const j = await r.json(); if (j.success) streak = j.data?.streak ?? 0;
      }
      const habit = this.habits.find((h) => h.HabitID === habitId);
      if (habit) { habit.completedToday = completed; habit.Streak = streak; }
      this.renderTodayList();
      if (this.selectedHabitId === habitId) await this._loadAndRenderAll();
    } catch (err) { console.error("toggleHabit:", err); }
  },

  // ── Data loading ──

  async _loadAndRenderAll() {
    await Promise.all([this._fetchHeatmapData(), this._fetchUnifiedStreak()]);
    this._renderStats();
    this._renderMonthCalendar();
    this._renderHeatmap();
  },

  _unifiedStreak: 0,

  async _fetchUnifiedStreak() {
    try {
      const res = await fetch("/api/gamification/profile", { headers: this._authHeader() });
      const json = await res.json();
      if (json.success) this._unifiedStreak = json.data?.streak || 0;
    } catch (_) {}
  },

  async _fetchHeatmapData() {
    const id = this.selectedHabitId;
    if (!id) { this._heatmapData = []; return; }
    try {
      const res = await fetch(`/api/habits/${id}/heatmap?year=${this.currentYear}`, { headers: this._authHeader() });
      const json = await res.json();
      this._heatmapData = json.success ? (json.data || []) : [];
    } catch (_) { this._heatmapData = []; }
  },

  // ── Stats summary ──

  _renderStats() {
    const container = document.getElementById("habit-stats-row");
    if (!container) return;
    const habit = this.habits.find((h) => h.HabitID === this.selectedHabitId);
    if (!habit) { container.style.display = "none"; return; }

    const today = new Date().toISOString().split("T")[0];
    const completed = this._heatmapData.filter((d) => d.completed).length;
    const pastDays = this._heatmapData.filter((d) => d.date <= today).length;
    const rate = pastDays > 0 ? Math.round((completed / pastDays) * 100) : 0;

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthDone = this._heatmapData.filter((d) => d.completed && d.date >= monthStart).length;

    // Compute longest streak from data
    let longest = 0, cur = 0;
    const sorted = [...this._heatmapData].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].completed) {
        cur++;
        if (cur > longest) longest = cur;
      } else { cur = 0; }
    }

    container.style.display = "grid";
    container.innerHTML = `
      <div class="hb-stat-card"><div class="hb-stat-value">${this._unifiedStreak}</div><div class="hb-stat-label">Chuỗi tổng</div></div>
      <div class="hb-stat-card"><div class="hb-stat-value">${habit.Streak || 0}</div><div class="hb-stat-label">Chuỗi thói quen</div></div>
      <div class="hb-stat-card"><div class="hb-stat-value">${monthDone}</div><div class="hb-stat-label">Tháng này</div></div>
      <div class="hb-stat-card"><div class="hb-stat-value">${rate}%</div><div class="hb-stat-label">Tỷ lệ năm</div></div>`;
  },

  // ── Monthly calendar ──

  _renderMonthCalendar() {
    const grid = document.getElementById("habit-month-grid");
    const label = document.getElementById("month-label");
    if (!grid) return;
    if (label) label.textContent = `${this.VMONTHS[this.currentMonth]} ${this.currentMonthYear}`;

    const completedSet = new Set(
      this._heatmapData.filter((d) => d.completed).map((d) => d.date)
    );
    const today = new Date().toISOString().split("T")[0];

    const firstDay = new Date(this.currentMonthYear, this.currentMonth, 1);
    const daysInMonth = new Date(this.currentMonthYear, this.currentMonth + 1, 0).getDate();
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0

    let html = this.VDAYS.map((d) => `<div class="hb-month-header">${d}</div>`).join("");

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) html += `<div class="hb-day-cell empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${this.currentMonthYear}-${String(this.currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = dateStr === today;
      const isFuture = dateStr > today;
      const isDone = completedSet.has(dateStr);
      const isMissed = !isDone && !isFuture && !isToday;

      let cls = "hb-day-cell";
      if (isDone) cls += " done";
      else if (isToday) cls += " today";
      else if (isFuture) cls += " future";
      else if (isMissed) cls += " missed";

      html += `<div class="${cls}" data-date="${dateStr}" title="${dateStr}">${d}</div>`;
    }

    grid.innerHTML = html;
    grid.className = "hb-month-grid";
  },

  // ── Yearly heatmap ──

  _renderHeatmap() {
    const container = document.getElementById("habit-heatmap");
    if (!container) return;
    const yearLabel = document.getElementById("heatmap-year-label");
    if (yearLabel) yearLabel.textContent = this.currentYear;

    if (!this.selectedHabitId) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted,#94a3b8);font-size:13px;padding:24px;">Chọn một thói quen</p>';
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const data = this._heatmapData.map((d) => ({
      date: d.date,
      value: d.completed ? 1 : (d.date <= today ? 0 : null),
    }));

    const habit = this.habits.find((h) => h.HabitID === this.selectedHabitId);
    window.CalendarHeatmap?.render("habit-heatmap", data, {
      year: this.currentYear,
      binaryMode: true,
      tooltipFn: (date, value) => {
        const name = habit ? habit.TenThoiQuen : "Thói quen";
        if (value === null) return `${date}: Chưa đến`;
        return `${date} — ${name}: ${value === 1 ? "✓ Hoàn thành" : "✗ Bỏ lỡ"}`;
      },
    });
  },

  // ── Habit selector ──

  _renderHabitSelector() {
    const el = document.getElementById("habit-selector-row");
    if (!el) return;
    el.innerHTML = "";
    this.habits.forEach((h) => {
      const btn = document.createElement("button");
      btn.className = "habit-select-btn" + (h.HabitID === this.selectedHabitId ? " active" : "");
      const ic = h.BieuTuong || "fas fa-bullseye";
      const iconHtml = (ic.startsWith("fas ") || ic.startsWith("far ") || ic.startsWith("fab "))
        ? `<i class="${ic}"></i>` : ic;
      btn.innerHTML = `${iconHtml} ${h.TenThoiQuen}`;
      btn.addEventListener("click", async () => {
        this.selectedHabitId = h.HabitID;
        this._renderHabitSelector();
        await this._loadAndRenderAll();
      });
      el.appendChild(btn);
    });
  },

  // ── Modal (simplified: name + icon only) ──

  openModal(habit = null) {
    const existing = document.getElementById("habitModalOverlay");
    if (existing) existing.remove();

    const ICONS = [
      { icon: "fas fa-bullseye", label: "Mục tiêu" }, { icon: "fas fa-dumbbell", label: "Tập luyện" },
      { icon: "fas fa-running", label: "Chạy bộ" }, { icon: "fas fa-book", label: "Đọc sách" },
      { icon: "fas fa-spa", label: "Thiền" }, { icon: "fas fa-tint", label: "Uống nước" },
      { icon: "fas fa-apple-alt", label: "Ăn lành" }, { icon: "fas fa-bed", label: "Ngủ sớm" },
      { icon: "fas fa-pen", label: "Viết" }, { icon: "fas fa-crosshairs", label: "Tập trung" },
      { icon: "fas fa-music", label: "Âm nhạc" }, { icon: "fas fa-leaf", label: "Thiên nhiên" },
      { icon: "fas fa-fire", label: "Streak" }, { icon: "fas fa-broom", label: "Dọn dẹp" },
      { icon: "fas fa-pills", label: "Thuốc" }, { icon: "fas fa-bicycle", label: "Xe đạp" },
      { icon: "fas fa-heartbeat", label: "Sức khỏe" }, { icon: "fas fa-brain", label: "Tư duy" },
      { icon: "fas fa-sun", label: "Dậy sớm" }, { icon: "fas fa-code", label: "Lập trình" },
      { icon: "fas fa-pray", label: "Cầu nguyện" }, { icon: "fas fa-walking", label: "Đi bộ" },
      { icon: "fas fa-guitar", label: "Guitar" }, { icon: "fas fa-palette", label: "Sáng tạo" },
    ];

    let selectedIcon = habit?.BieuTuong || "fas fa-bullseye";
    const overlay = document.createElement("div");
    overlay.id = "habitModalOverlay"; overlay.className = "habit-modal-overlay";
    const panel = document.createElement("div"); panel.className = "habit-modal-panel";

    const header = document.createElement("div");
    header.style.cssText = "background:var(--accent,#2563EB);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;";
    header.innerHTML = `<h3 style="color:#fff;font-size:17px;font-weight:700;margin:0;">${habit ? "Chỉnh sửa thói quen" : "Thêm thói quen mới"}</h3>`;
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.style.cssText = "background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;";
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.style.cssText = "padding:20px 24px;";
    body.innerHTML = `
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary,#64748b);text-transform:uppercase;letter-spacing:.5px;">Tên thói quen</label>
      <input id="hm-name" type="text" maxlength="80" placeholder="VD: Uống đủ nước mỗi ngày"
        value="${habit ? habit.TenThoiQuen.replace(/"/g, "&quot;") : ""}"
        style="width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:16px;background:var(--bg-input,#fff);color:var(--text-primary,#1e293b);" />
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary,#64748b);text-transform:uppercase;letter-spacing:.5px;">Biểu tượng</label>
      <div id="hm-emoji-grid" class="emoji-picker-grid"></div>`;

    setTimeout(() => {
      const grid = document.getElementById("hm-emoji-grid");
      if (!grid) return;
      ICONS.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "emoji-picker-item" + (entry.icon === selectedIcon ? " selected" : "");
        item.title = entry.label;
        item.innerHTML = `<i class="${entry.icon}"></i>`;
        item.addEventListener("click", () => {
          selectedIcon = entry.icon;
          grid.querySelectorAll(".emoji-picker-item").forEach((el) => el.classList.remove("selected"));
          item.classList.add("selected");
        });
        grid.appendChild(item);
      });
    }, 0);

    const footer = document.createElement("div");
    footer.style.cssText = "padding:12px 24px 20px;display:flex;gap:10px;justify-content:flex-end;";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Hủy";
    cancelBtn.style.cssText = "padding:9px 20px;border-radius:10px;border:1px solid var(--border,#e2e8f0);background:var(--bg-card,#fff);cursor:pointer;font-size:14px;color:var(--text-secondary,#475569);";
    cancelBtn.onclick = () => overlay.remove();
    const saveBtn = document.createElement("button");
    saveBtn.textContent = habit ? "Lưu thay đổi" : "Thêm thói quen";
    saveBtn.style.cssText = "padding:9px 20px;border-radius:10px;border:none;background:var(--accent,#2563EB);color:#fff;cursor:pointer;font-size:14px;font-weight:600;";
    saveBtn.onclick = async () => {
      const name = document.getElementById("hm-name")?.value?.trim();
      if (!name) { document.getElementById("hm-name")?.focus(); return; }
      saveBtn.disabled = true; saveBtn.textContent = "Đang lưu...";
      await this.saveHabit({ name, icon: selectedIcon, frequency: "daily", target: 1 }, habit?.HabitID);
      overlay.remove();
    };
    footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    panel.appendChild(header); panel.appendChild(body); panel.appendChild(footer);
    overlay.appendChild(panel); document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const esc = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    setTimeout(() => document.getElementById("hm-name")?.focus(), 50);
  },

  // ── CRUD ──

  async saveHabit(formData, habitId = null) {
    try {
      const url = habitId ? `/api/habits/${habitId}` : "/api/habits";
      const method = habitId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: this._authHeader(), body: JSON.stringify(formData) });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      await this.loadHabits(); this.renderTodayList(); this._renderHabitSelector();
      if (!habitId && json.data?.HabitID) {
        this.selectedHabitId = json.data.HabitID;
        this._renderHabitSelector(); await this._loadAndRenderAll();
      } else if (habitId && this.selectedHabitId === habitId) { await this._loadAndRenderAll(); }
    } catch (err) { console.error("saveHabit:", err); Utils?.alert?.(err.message, "Lỗi", "error"); }
  },

  async deleteHabit(id) {
    if (!await Utils.confirmDanger("Xoá thói quen này?", "Xoá thói quen")) return;
    try {
      const res = await fetch(`/api/habits/${id}`, { method: "DELETE", headers: this._authHeader() });
      const json = await res.json(); if (!json.success) throw new Error(json.message);
      await this.loadHabits(); this.renderTodayList(); this._renderHabitSelector();
      if (this.selectedHabitId === id) {
        this.selectedHabitId = this.habits.length > 0 ? this.habits[0].HabitID : null;
        this._renderHabitSelector(); await this._loadAndRenderAll();
      }
    } catch (err) { console.error("deleteHabit:", err); }
  },

  // ── Events ──

  bindEvents() {
    document.getElementById("habit-add-btn")?.addEventListener("click", () => {
      if (!window.Utils?.requireAuth()) return; this.openModal();
    });
    document.getElementById("heatmap-prev-year")?.addEventListener("click", async () => {
      this.currentYear--; await this._loadAndRenderAll();
    });
    document.getElementById("heatmap-next-year")?.addEventListener("click", async () => {
      this.currentYear++; await this._loadAndRenderAll();
    });
    document.getElementById("month-prev")?.addEventListener("click", () => {
      this.currentMonth--;
      if (this.currentMonth < 0) { this.currentMonth = 11; this.currentMonthYear--; }
      this._renderMonthCalendar();
    });
    document.getElementById("month-next")?.addEventListener("click", () => {
      this.currentMonth++;
      if (this.currentMonth > 11) { this.currentMonth = 0; this.currentMonthYear++; }
      this._renderMonthCalendar();
    });
  },
};
