/**
 * badge-display-helper.js
 * Shared utility for rendering equipped badge icons inline next to user names.
 * Uses GamificationBadges for icon/color mappings.
 *
 * Usage: BadgeDisplay.inline(badgeId)        → small inline HTML
 *        BadgeDisplay.storeMyBadge(badgeId)  → persist current user's badge
 *        BadgeDisplay.getMyBadge()           → read current user's badge
 */
(function () {
  "use strict";
  if (window.BadgeDisplay) return;

  const LS_KEY = "equipped_badge";

  window.BadgeDisplay = {
    inline(badgeId, size) {
      if (!badgeId) return "";
      const B = window.GamificationBadges;
      if (!B) return "";
      const icon = B.getIcon(badgeId);
      const color = B.getColor(badgeId);
      const sz = size || 14;
      return `<i class="fas ${icon} equipped-badge-icon" style="color:${color};font-size:${sz}px;margin-left:4px;flex-shrink:0" title="${this._badgeName(badgeId)}"></i>`;
    },

    chip(badgeId) {
      if (!badgeId) return "";
      const B = window.GamificationBadges;
      if (!B) return "";
      const icon = B.getIcon(badgeId);
      const color = B.getColor(badgeId);
      const name = this._badgeName(badgeId);
      return `<span class="equipped-badge-chip" style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:color-mix(in srgb, ${color} 12%, transparent);color:${color};border:1px solid color-mix(in srgb, ${color} 25%, transparent);white-space:nowrap;flex-shrink:0" title="${name}"><i class="fas ${icon}" style="font-size:9px"></i>${name}</span>`;
    },

    storeMyBadge(badgeId) {
      if (badgeId) {
        localStorage.setItem(LS_KEY, badgeId);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    },

    getMyBadge() {
      return localStorage.getItem(LS_KEY) || null;
    },

    _badgeName(badgeId) {
      const NAMES = {
        first_task: "Tân binh", tasks_10: "Chiến binh", tasks_50: "Chuyên gia",
        tasks_100: "Pro", tasks_500: "VIP Huyền thoại",
        streak_3: "Lửa nhỏ", streak_7: "Bền bỉ", streak_14: "Kỷ luật thép", streak_30: "Siêu nhân",
        priority_king: "Vua ưu tiên", early_bird: "Early Bird",
        level_5: "Tay mơ", level_10: "Pro Player", level_15: "Cao thủ", level_20: "Grand Master",
      };
      return NAMES[badgeId] || badgeId;
    },
  };
})();
