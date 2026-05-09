(function () {
  "use strict";

  const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const BD = () => window.BadgeDisplay;

  const CACHE_TTL = 30_000;

  const GamificationSection = {
    initialized: false,
    profile: null,
    _lastLoad: 0,

    _authHeader() {
      const token = localStorage.getItem("auth_token");
      return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
    },

    async _api(path) {
      const res = await fetch(path, { headers: this._authHeader() });
      const json = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Lỗi khi tải dữ liệu");
      }
      return json.data;
    },

    async init() {
      if (this.initialized && Date.now() - this._lastLoad < CACHE_TTL) return;
      this.initialized = true;
      await this.loadProfile();
    },

    async loadProfile() {
      try {
        this._lastLoad = Date.now();
        this.profile = await this._api("/api/gamification/profile");
        BD()?.storeMyBadge(this.profile.equippedBadge);
        this.renderProfile(this.profile);
        this.renderStreakStats(this.profile.streakStats);
        this.renderBadges(
          this.profile.badges || [],
          this.profile.availableBadges || []
        );
        await this.loadLeaderboard();
      } catch (e) {
        this._showError(e.message);
      }
    },

    async loadLeaderboard() {
      try {
        const data = await this._api("/api/gamification/leaderboard");
        this.renderLeaderboard(data);
      } catch (err) {
        console.warn("[Gamification] leaderboard:", err.message);
      }
    },

    _esc(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },

    _avatarHtml(url, name, size) {
      const sz = size || 32;
      if (url) {
        return `<img src="${this._esc(url)}" alt="" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <span style="display:none;width:${sz}px;height:${sz}px;border-radius:50%;background:var(--bg-card-alt, #e2e8f0);align-items:center;justify-content:center;font-size:${Math.round(sz * 0.4)}px;color:var(--text-muted, #94a3b8)">
                  <i class="fas fa-user"></i>
                </span>`;
      }
      return `<span style="display:flex;width:${sz}px;height:${sz}px;border-radius:50%;background:var(--bg-card-alt, #e2e8f0);align-items:center;justify-content:center;font-size:${Math.round(sz * 0.4)}px;color:var(--text-muted, #94a3b8)">
                <i class="fas fa-user"></i>
              </span>`;
    },

    renderProfile(p) {
      const container = document.querySelector(
        "#gamification-view .gamification-header"
      );
      if (!container) return;

      const pct = Math.round((p.progress || 0) * 100);
      const badgeHtml = BD()?.chip(p.equippedBadge) || "";

      container.innerHTML = `
        <div class="gam-profile-avatar">${this._avatarHtml(p.avatar, p.name, 52)}</div>
        <div class="level-circle"><span>${p.level}</span></div>
        <div class="xp-info">
          <div class="xp-text">${this._esc(p.name || "Bạn")} ${badgeHtml} · Cấp ${p.level}</div>
          <div class="xp-bar"><div class="xp-bar-fill" style="width:${pct}%"></div></div>
          <div class="xp-sub">${p.xp} / ${p.nextLevelXP} XP (${pct}%)</div>
        </div>
        <div class="streak-badge${p.streak >= 7 ? " streak-hot" : ""}">
          <i class="fas fa-fire"></i>
          <span class="streak-count">${p.streak}</span>
          <span class="streak-label">ngày</span>
        </div>
        <button onclick="GamificationSection.refresh()" class="btn-refresh" title="Làm mới">
          <i class="fas fa-sync-alt"></i>
        </button>
      `;
    },

    renderStreakStats(ss) {
      const container = document.querySelector("#gamification-view .gamification-streaks");
      if (!container) return;
      if (!ss) { container.innerHTML = ""; return; }

      const items = [
        { icon: "fa-fire", label: "Chuỗi tổng", current: ss.current, longest: ss.longest },
        { icon: "fa-calendar-check", label: "Lịch trình", current: ss.schedule?.current || 0, longest: ss.schedule?.longest || 0 },
        { icon: "fa-tasks", label: "Công việc", current: ss.tasks?.current || 0, longest: ss.tasks?.longest || 0 },
        { icon: "fa-leaf", label: "Thói quen", current: ss.habits?.current || 0, longest: ss.habits?.longest || 0 },
      ];

      container.innerHTML = `
        <h3 class="section-title">Thống kê chuỗi</h3>
        <div class="gam-streak-grid">
          ${items.map((it) => `
            <div class="gam-streak-card">
              <div class="gam-streak-icon"><i class="fas ${it.icon}"></i></div>
              <div class="gam-streak-info">
                <div class="gam-streak-name">${it.label}</div>
                <div class="gam-streak-nums">
                  <span class="gam-streak-current">${it.current}</span>
                  <span class="gam-streak-sep">·</span>
                  <span class="gam-streak-longest">Dài nhất: ${it.longest}</span>
                </div>
              </div>
            </div>
          `).join("")}
        </div>`;
    },

    renderBadges(earned, available) {
      const container = document.querySelector(
        "#gamification-view .gamification-badges"
      );
      if (!container) return;

      const Badges = window.GamificationBadges;
      if (!Badges) return;

      const earnedIds = new Set(earned.map((b) => b.id));
      const locked = available.filter((b) => !earnedIds.has(b.id));
      const total = earned.length + locked.length;
      const equipped = this.profile?.equippedBadge;

      const earnedHtml = earned
        .map((b) => this._renderBadgeCard(b, true, b.id === equipped))
        .join("");
      const lockedHtml = locked
        .map((b) => this._renderBadgeCard(b, false, false))
        .join("");

      container.innerHTML = `
        <h3 class="section-title">
          Huy hiệu
          <span class="badge-counter">${earned.length}/${total}</span>
        </h3>
        <div class="badge-grid">${earnedHtml}${lockedHtml}</div>
      `;

      // Bind equip click events
      container.querySelectorAll(".badge-card[data-badge-id]").forEach((card) => {
        card.addEventListener("click", () => {
          const id = card.dataset.badgeId;
          if (card.classList.contains("locked")) return;
          const newBadge = id === equipped ? null : id;
          this.equipBadge(newBadge);
        });
      });
    },

    _renderBadgeCard(badge, earned, isEquipped) {
      const B = window.GamificationBadges;
      const icon = B.getIcon(badge.id);
      const color = B.getColor(badge.id);
      const lockedCls = earned ? "" : "locked";
      const equippedCls = isEquipped ? "equipped" : "";
      const iconColor = earned ? color : "#9CA3AF";
      const dateStr =
        earned && badge.earnedAt
          ? new Date(badge.earnedAt).toLocaleDateString("vi-VN")
          : "";
      const subtitle = earned ? dateStr : badge.desc;
      const equipLabel = isEquipped
        ? '<div class="badge-equipped-tag">Đang trang bị</div>'
        : earned
          ? '<div class="badge-equip-hint">Bấm để trang bị</div>'
          : "";

      return `<div class="badge-card ${lockedCls} ${equippedCls}" data-badge-id="${badge.id}" title="${badge.name}: ${badge.desc}${earned ? " — Bấm để trang bị/gỡ" : ""}">
        <i class="fas ${icon}" style="color:${iconColor};font-size:24px"></i>
        <div class="badge-name">${badge.name}</div>
        <div class="badge-desc">${subtitle}</div>
        ${equipLabel}
      </div>`;
    },

    async equipBadge(badgeId) {
      try {
        const res = await fetch("/api/gamification/equip-badge", {
          method: "PUT",
          headers: this._authHeader(),
          body: JSON.stringify({ badgeId }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        this.profile.equippedBadge = badgeId;
        BD()?.storeMyBadge(badgeId);
        this.renderProfile(this.profile);
        this.renderBadges(
          this.profile.badges || [],
          this.profile.availableBadges || []
        );
        // Update sidebar badge display
        this._updateSidebarBadge(badgeId);
        window.Utils?.showToast?.(
          badgeId ? "Đã trang bị huy hiệu" : "Đã gỡ huy hiệu",
          "success"
        );
      } catch (err) {
        console.error("[Gamification] equip error:", err.message);
        window.Utils?.showToast?.(err.message || "Lỗi", "error");
      }
    },

    _updateSidebarBadge(badgeId) {
      const nameEl = document.querySelector(".sidebar .user-name");
      if (!nameEl) return;
      const existing = nameEl.querySelector(".equipped-badge-icon");
      if (existing) existing.remove();
      if (badgeId && BD()) {
        nameEl.insertAdjacentHTML("beforeend", BD().inline(badgeId, 12));
      }
    },

    renderLeaderboard(entries) {
      const container = document.querySelector(
        "#gamification-view .gamification-leaderboard"
      );
      if (!container) return;

      const userId = parseInt(localStorage.getItem("user_id"), 10);

      if (!entries?.length) {
        container.innerHTML =
          '<p class="text-center text-sm text-gray-400 py-4">Thêm bạn bè để so sánh!</p>';
        return;
      }

      const rows = entries
        .map((e) => {
          const isSelf = e.userId === userId;
          const rankCls = e.rank <= 3 ? `rank-${e.rank}` : "";
          const medal = MEDAL[e.rank] || "";
          const rankDisplay = medal || `#${e.rank}`;
          const badgeHtml = BD()?.inline(e.equippedBadge, 12) || "";

          return `<div class="leaderboard-row${isSelf ? " self" : ""} ${rankCls}">
          <span class="rank-num">${rankDisplay}</span>
          <div class="lb-avatar">${this._avatarHtml(e.avatar, e.name, 32)}</div>
          <div class="lb-info">
            <div class="lb-name">${this._esc(e.name || "Ẩn danh")}${badgeHtml}${isSelf ? ' <span class="lb-you">(bạn)</span>' : ""}</div>
            <div class="lb-meta">Lv.${e.level} · ${e.xp} XP${e.streak > 0 ? ` · <i class="fas fa-fire" style="color:#f59e0b;font-size:10px"></i> ${e.streak}` : ""}</div>
          </div>
        </div>`;
        })
        .join("");

      container.innerHTML = `<h3 class="section-title">Bảng xếp hạng bạn bè</h3>${rows}`;
    },

    async refresh() {
      try {
        const res = await fetch("/api/gamification/refresh", {
          method: "POST",
          headers: this._authHeader(),
        });
        const json = await res.json().catch(() => ({ success: false }));
        if (!json.success) throw new Error(json.message || "Lỗi làm mới");
        this.profile = json.data;
        BD()?.storeMyBadge(this.profile.equippedBadge);
        this.renderProfile(this.profile);
        this.renderStreakStats(this.profile.streakStats);
        this.renderBadges(
          this.profile.badges || [],
          this.profile.availableBadges || []
        );
        await this.loadLeaderboard();
      } catch (e) {
        console.error("[GamificationSection] refresh error:", e.message);
      }
    },

    _showError(msg) {
      const container = document.querySelector(
        "#gamification-view .gamification-header"
      );
      if (!container) return;
      container.innerHTML = `<p class="text-sm text-red-500 py-2">Không tải được dữ liệu: ${msg}</p>`;
    },
  };

  window.GamificationSection = GamificationSection;
})();
