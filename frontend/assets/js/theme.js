(function () {
  'use strict';

  const ThemeManager = {
    STORAGE_KEY: 'app-theme',

    init() {
      const saved = localStorage.getItem(this.STORAGE_KEY) || 'light';
      this.apply(saved);
    },

    apply(theme) {
      if (theme === 'dark') {
        document.body.classList.add('dark');
      } else {
        document.body.classList.remove('dark');
      }
      localStorage.setItem(this.STORAGE_KEY, theme);
      document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
    },

    toggle() {
      const current = document.body.classList.contains('dark') ? 'dark' : 'light';
      this.apply(current === 'dark' ? 'light' : 'dark');
    },

    isDark() {
      return document.body.classList.contains('dark');
    },

    get current() {
      return document.body.classList.contains('dark') ? 'dark' : 'light';
    }
  };

  // Apply saved theme immediately (before DOM loads to prevent flash)
  const savedTheme = localStorage.getItem('app-theme') || 'light';
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-preload-theme', 'dark');

  window.ThemeManager = ThemeManager;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
  } else {
    ThemeManager.init();
  }
})();
