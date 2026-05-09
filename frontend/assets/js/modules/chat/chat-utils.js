// chat-utils.js — Shared helpers for chat modules (escape, time formatting)
(function () {
  "use strict";

  window.ChatUtils = {
    // HTML-escape a string to prevent XSS
    esc(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },

    // Truncate string to max chars with ellipsis
    truncate(str, max) {
      return str.length > max ? str.slice(0, max) + "…" : str;
    },

    // Human-readable relative time in Vietnamese (short form for sidebar)
    relativeTimeShort(date) {
      const diff = Date.now() - date.getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60) return "vừa xong";
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}p`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      if (d === 1) return "hôm qua";
      if (d < 7) return `${d}d`;
      return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    },

    // Human-readable relative time in Vietnamese (long form for message bubbles)
    relativeTimeLong(date) {
      const diff = Date.now() - date.getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60) return "vừa xong";
      const m = Math.floor(s / 60);
      if (m < 60) return `${m} phút trước`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h} giờ trước`;
      const d = Math.floor(h / 24);
      if (d === 1) return "hôm qua";
      if (d < 7) return `${d} ngày trước`;
      return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    },

    // Date divider label for message thread ("Hôm nay", "Hôm qua", or full date)
    formatDateDivider(date) {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return "Hôm nay";
      if (date.toDateString() === yesterday.toDateString()) return "Hôm qua";
      return date.toLocaleDateString("vi-VN", {
        weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
      });
    },
  };
})();
