window.AuthModalController = {
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.bindTabs();
    this.bindForms();
    this.bindOverlayClose();
  },

  open(tab = 'login') {
    const overlay = document.getElementById('authModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    this.switchTab(tab);
    const firstInput = tab === 'login'
      ? document.getElementById('authLoginUsername')
      : document.getElementById('authRegHoten');
    setTimeout(() => firstInput?.focus(), 100);
  },

  close() {
    const overlay = document.getElementById('authModalOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    this.clearErrors();
    this.clearForms();
  },

  switchTab(tab) {
    document.querySelectorAll('[data-auth-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.authTab === tab);
    });
    const loginPanel = document.getElementById('authTabLogin');
    const registerPanel = document.getElementById('authTabRegister');
    if (loginPanel) loginPanel.classList.toggle('hidden', tab !== 'login');
    if (registerPanel) registerPanel.classList.toggle('hidden', tab !== 'register');
    const headerTitle = document.querySelector('.auth-modal-header h2');
    if (headerTitle) headerTitle.textContent = tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
  },

  bindTabs() {
    document.querySelectorAll('[data-auth-tab]').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.authTab));
    });
  },

  bindForms() {
    const loginForm = document.getElementById('authLoginForm');
    const registerForm = document.getElementById('authRegisterForm');

    loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    registerForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });
  },

  bindOverlayClose() {
    const overlay = document.getElementById('authModalOverlay');
    // Click overlay to close
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    // X button to close
    document.getElementById('authModalCloseBtn')?.addEventListener('click', () => this.close());
    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) this.close();
    });
  },

  async handleLogin() {
    const username = document.getElementById('authLoginUsername')?.value.trim();
    const password = document.getElementById('authLoginPassword')?.value;

    if (!username || !password) {
      this.showError('login', 'Vui lòng nhập đầy đủ thông tin');
      return;
    }

    this.setLoading('login', true);
    this.clearErrors();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Đăng nhập thất bại');
      }

      localStorage.setItem('auth_token', result.data.token);
      localStorage.setItem('user_data', JSON.stringify(result.data.user));

      this.close();
      document.dispatchEvent(new CustomEvent('auth-success', { detail: result.data }));
    } catch (err) {
      this.showError('login', err.message || 'Lỗi kết nối server');
    } finally {
      this.setLoading('login', false);
    }
  },

  async handleRegister() {
    const hoten = document.getElementById('authRegHoten')?.value.trim();
    const username = document.getElementById('authRegUsername')?.value.trim();
    const email = document.getElementById('authRegEmail')?.value.trim();
    const password = document.getElementById('authRegPassword')?.value;

    if (!hoten || !username || !email || !password) {
      this.showError('register', 'Vui lòng nhập đầy đủ thông tin');
      return;
    }

    if (password.length < 6) {
      this.showError('register', 'Mật khẩu tối thiểu 6 ký tự');
      return;
    }

    this.setLoading('register', true);
    this.clearErrors();

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoten, username, email, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Đăng ký thất bại');
      }

      localStorage.setItem('auth_token', result.data.token);
      localStorage.setItem('user_data', JSON.stringify(result.data.user));

      this.close();
      document.dispatchEvent(new CustomEvent('auth-success', { detail: result.data }));
    } catch (err) {
      this.showError('register', err.message || 'Lỗi kết nối server');
    } finally {
      this.setLoading('register', false);
    }
  },

  showError(tab, msg) {
    const el = document.getElementById(tab === 'login' ? 'authLoginError' : 'authRegisterError');
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
    }
  },

  clearErrors() {
    document.querySelectorAll('.auth-error-msg').forEach(el => {
      el.classList.remove('show');
      el.textContent = '';
    });
  },

  clearForms() {
    document.getElementById('authLoginForm')?.reset();
    document.getElementById('authRegisterForm')?.reset();
  },

  setLoading(tab, loading) {
    const btnId = tab === 'login' ? 'authLoginBtn' : 'authRegisterBtn';
    const spinnerId = tab === 'login' ? 'authLoginSpinner' : 'authRegisterSpinner';
    const btn = document.getElementById(btnId);
    const spinner = document.getElementById(spinnerId);

    if (btn) {
      btn.disabled = loading;
      const textEl = btn.querySelector('.auth-btn-text');
      if (textEl) textEl.style.display = loading ? 'none' : 'inline';
    }
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  },

  isAuthenticated() {
    const token = localStorage.getItem('auth_token');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Date.now() < payload.exp * 1000;
    } catch { return false; }
  }
};
