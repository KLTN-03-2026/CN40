(function () {
  "use strict";

  // Badge icon (Font Awesome 6 solid class) and color definitions
  window.GamificationBadges = {
    ICONS: {
      first_task: "fa-star",
      tasks_10: "fa-medal",
      tasks_50: "fa-award",
      tasks_100: "fa-trophy",
      tasks_500: "fa-crown",
      streak_3: "fa-fire",
      streak_7: "fa-fire-flame-curved",
      streak_14: "fa-bolt",
      streak_30: "fa-dragon",
      priority_king: "fa-chess-king",
      early_bird: "fa-sun",
      level_5: "fa-shield",
      level_10: "fa-shield-halved",
      level_15: "fa-hat-wizard",
      level_20: "fa-infinity",
    },

    COLORS: {
      first_task: "#F59E0B",
      tasks_10: "#8B5CF6",
      tasks_50: "#06B6D4",
      tasks_100: "#F97316",
      tasks_500: "#EC4899",
      streak_3: "#EF4444",
      streak_7: "#DC2626",
      streak_14: "#4F46E5",
      streak_30: "#7C3AED",
      priority_king: "#0EA5E9",
      early_bird: "#FBBF24",
      level_5: "#10B981",
      level_10: "#14B8A6",
      level_15: "#6366F1",
      level_20: "#A855F7",
    },

    /** Returns the FA icon class for a badge id, fallback to circle */
    getIcon(id) {
      return this.ICONS[id] || "fa-circle";
    },

    /** Returns the accent color for a badge id, fallback to gray */
    getColor(id) {
      return this.COLORS[id] || "#6B7280";
    },

    /**
     * Render a badge card HTML string.
     * @param {Object} badge  - badge object { id, name, desc, earnedAt? }
     * @param {boolean} earned - whether the user has earned this badge
     */
    renderCard(badge, earned) {
      const icon = this.getIcon(badge.id);
      const color = this.getColor(badge.id);
      const lockedCls = earned ? "" : "locked";
      const iconColor = earned ? color : "#9CA3AF";
      const dateStr =
        earned && badge.earnedAt
          ? new Date(badge.earnedAt).toLocaleDateString("vi-VN")
          : "";
      const subtitle = earned ? dateStr : badge.desc;

      return `<div class="badge-card ${lockedCls}" title="${badge.name}: ${badge.desc}">
        <i class="fas ${icon}" style="color:${iconColor};font-size:24px"></i>
        <div class="badge-name">${badge.name}</div>
        <div class="badge-desc">${subtitle}</div>
      </div>`;
    },
  };
})();
