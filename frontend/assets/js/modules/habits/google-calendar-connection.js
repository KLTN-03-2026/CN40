/**
 * google-calendar-connection.js
 * UI controller for the Google Calendar tab in the Connections section.
 * Manages OAuth connect/disconnect flow and manual sync trigger.
 */

window.GoogleCalendarConnection = {
  connected: false,
  googleEmail: null,
  lastSyncAt: null,

  async init() {
    if (!localStorage.getItem('auth_token')) { this.render(); return; }
    await this.loadStatus();
    this.render();
    this._checkRedirectParams();
  },

  async loadStatus() {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch('/api/google-calendar/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.connected = data.connected || false;
      this.googleEmail = data.googleEmail || null;
      this.lastSyncAt = data.updatedAt || null;
    } catch (err) {
      console.error('GC loadStatus error:', err.message);
      this.connected = false;
      this.googleEmail = null;
    }
  },

  async connect() {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/google-calendar/auth-url', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { this._showMessage(data.message || 'Không thể tạo URL kết nối', 'error'); return; }
      window.location.href = data.url;
    } catch (err) {
      console.error('GC connect error:', err.message);
      this._showMessage('Lỗi kết nối server', 'error');
    }
  },

  async disconnect() {
    if (!await Utils.confirmDanger("Ngắt kết nối Google Calendar?", "Ngắt kết nối")) return;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/google-calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { this._showMessage(data.message || 'Ngắt kết nối thất bại', 'error'); return; }
      this.connected = false;
      this.googleEmail = null;
      this.render();
      this._showMessage('Đã ngắt kết nối Google Calendar', 'success');
    } catch (err) {
      console.error('GC disconnect error:', err.message);
      this._showMessage('Lỗi server khi ngắt kết nối', 'error');
    }
  },

  async syncNow() {
    const btn = document.getElementById('gc-btn-sync');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Đang đồng bộ...'; }
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/google-calendar/sync-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { this._showMessage(data.message || 'Đồng bộ thất bại', 'error'); return; }
      this.lastSyncAt = new Date().toISOString();
      this._showMessage(data.message || 'Đồng bộ thành công', 'success');
      this._updateSyncInfo();
    } catch (err) {
      console.error('GC syncNow error:', err.message);
      this._showMessage('Lỗi server khi đồng bộ', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync mr-1"></i>Đồng bộ ngay'; }
    }
  },

  render() {
    const panel = document.querySelector('[data-conn-panel="google-calendar"]');
    if (!panel) return;

    const badge = this.connected
      ? `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700"><i class="fas fa-check-circle mr-1"></i>Đã kết nối</span>`
      : `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">Chưa kết nối</span>`;

    const statusText = this.connected
      ? `<div class="font-semibold text-slate-800">Google Calendar</div><div class="text-sm text-green-600">${this.googleEmail || ''}</div>`
      : `<div class="font-semibold text-slate-800">Google Calendar</div><div class="text-sm text-slate-500">Chưa kết nối tài khoản Google</div>`;

    const actionBtn = this.connected
      ? `<button onclick="GoogleCalendarConnection.disconnect()" class="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 border border-red-200 bg-white hover:bg-red-50"><i class="fas fa-unlink mr-1"></i>Ngắt kết nối</button>`
      : `<button onclick="GoogleCalendarConnection.connect()" class="px-4 py-2 rounded-lg text-sm font-semibold text-white" style="background:linear-gradient(135deg,#4285F4,#34A853)"><i class="fab fa-google mr-1"></i>Kết nối Google Calendar</button>`;

    const syncSection = this.connected ? `
      <section class="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
        <h2 class="font-semibold text-slate-800 mb-1">Đồng bộ lịch trình</h2>
        <p class="text-sm text-slate-500 mb-4">Tự động đồng bộ lịch trình tuần hiện tại sang Google Calendar.</p>
        <div class="flex items-center gap-3 flex-wrap">
          <button id="gc-btn-sync" onclick="GoogleCalendarConnection.syncNow()"
            class="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style="background:linear-gradient(135deg,#4285F4,#34A853)">
            <i class="fas fa-sync mr-1"></i>Đồng bộ ngay
          </button>
          <span id="gc-sync-info" class="text-xs text-slate-400">${this._formatSyncInfo()}</span>
        </div>
      </section>` : '';

    panel.innerHTML = `
      <section class="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl"
                 style="background:linear-gradient(135deg,#4285F4,#34A853)">
              <i class="fab fa-google"></i>
            </div>
            <div>${statusText}</div>
          </div>
          ${badge}
        </div>
        <div class="mt-4 flex gap-2">${actionBtn}</div>
        <div id="gc-status-msg" class="hidden mt-3 p-3 rounded-lg text-sm"></div>
      </section>
      ${syncSection}`;
  },

  _updateSyncInfo() {
    const el = document.getElementById('gc-sync-info');
    if (el) el.textContent = this._formatSyncInfo();
  },

  _formatSyncInfo() {
    if (!this.lastSyncAt) return 'Chưa đồng bộ lần nào';
    return `Lần cuối: ${new Date(this.lastSyncAt).toLocaleString('vi-VN')}`;
  },

  _showMessage(text, type) {
    const el = document.getElementById('gc-status-msg');
    if (!el) return;
    const cls = type === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700';
    el.className = `mt-3 p-3 rounded-lg text-sm ${cls}`;
    el.textContent = text;
    setTimeout(() => { el.className = 'hidden mt-3 p-3 rounded-lg text-sm'; }, 5000);
  },

  _checkRedirectParams() {
    const hash = window.location.hash || '';
    if (hash.includes('gc_connected=1')) {
      this._showMessage('Kết nối Google Calendar thành công!', 'success');
      history.replaceState(null, '', window.location.pathname + '#connections');
    } else if (hash.includes('gc_error=')) {
      const match = hash.match(/gc_error=([^&]*)/);
      const msg = match ? decodeURIComponent(match[1]) : 'Lỗi kết nối';
      this._showMessage(`Lỗi: ${msg}`, 'error');
      history.replaceState(null, '', window.location.pathname + '#connections');
    }
  },
};
