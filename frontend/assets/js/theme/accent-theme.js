/**
 * accent-theme.js
 * Manages user-customizable accent color.
 * Default: #2563EB (Blue-600). Stored in localStorage, applied via CSS variables.
 */
window.AccentTheme = {
  STORAGE_KEY: 'accent_color',
  DEFAULT: '#2563EB',

  PRESETS: [
    { name: 'Xanh dương', hex: '#2563EB' },
    { name: 'Tím', hex: '#7C3AED' },
    { name: 'Đỏ', hex: '#DC2626' },
    { name: 'Cam', hex: '#EA580C' },
    { name: 'Xanh lá', hex: '#16A34A' },
    { name: 'Xanh ngọc', hex: '#0D9488' },
    { name: 'Hồng', hex: '#DB2777' },
    { name: 'Chàm', hex: '#4F46E5' },
  ],

  get() {
    return localStorage.getItem(this.STORAGE_KEY) || this.DEFAULT;
  },

  set(hex) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
    localStorage.setItem(this.STORAGE_KEY, hex);
    this.apply(hex);
    document.dispatchEvent(new CustomEvent('accent-changed', { detail: hex }));
  },

  apply(hex) {
    const h = hex || this.get();
    const root = document.documentElement;
    root.style.setProperty('--accent', h);
    root.style.setProperty('--apple-blue', h);
    root.style.setProperty('--apple-link', h);
    root.style.setProperty('--accent-hover', this.darken(h, 15));
    root.style.setProperty('--accent-dark', this.darken(h, 30));
    root.style.setProperty('--accent-light', this.toRgba(h, 0.08));
    root.style.setProperty('--accent-light-bg', this.toRgba(h, 0.06));
    root.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${h}, ${this.darken(h, 15)})`);
    root.style.setProperty('--accent-header', `linear-gradient(135deg, ${this.darken(h, 25)} 0%, ${this.darken(h, 40)} 100%)`);
  },

  headerGradient() {
    const h = this.get();
    return `linear-gradient(135deg, ${this.darken(h, 25)} 0%, ${this.darken(h, 40)} 100%)`;
  },

  darken(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
    const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  },

  toRgba(hex, alpha) {
    const num = parseInt(hex.slice(1), 16);
    return `rgba(${num >> 16}, ${(num >> 8) & 0xFF}, ${num & 0xFF}, ${alpha})`;
  },

  init() {
    this.apply();
  }
};

AccentTheme.init();
