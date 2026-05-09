// frontend/assets/js/utils.js
if (typeof window.Utils === "undefined") {
  window.Utils = {
    API_BASE: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3000"
      : window.API_BASE_URL || "",

    /**
     * Lưu trữ token trong localStorage
     * @param {string} token - JWT token
     */
    setToken(token) {
      if (token) {
        localStorage.setItem("auth_token", token);
      }
    },

    /**
     * Lấy token từ localStorage
     * @returns {string|null} - Token hoặc null
     */
    getToken() {
      return localStorage.getItem("auth_token");
    },

    /**
     * Xóa token và dữ liệu người dùng
     */
    clearAuth() {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user_data");
    },

    /**
     * Kiểm tra xem đã đăng nhập chưa
     * @returns {boolean}
     */
    isLoggedIn() {
      const token = this.getToken();
      if (!token) return false;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return Date.now() < payload.exp * 1000;
      } catch { return false; }
    },

    requireAuth() {
      if (this.isLoggedIn()) return true;
      if (window.AuthModalController) {
        AuthModalController.init();
        AuthModalController.open('login');
      }
      return false;
    },

    /**
     * Thực hiện request API với token tự động
     * @param {string} endpoint - Đường dẫn API
     * @param {string} method - HTTP method
     * @param {object} data - Dữ liệu gửi đi
     * @param {object} customHeaders - Headers tùy chỉnh
     * @returns {Promise<object>} - Kết quả từ server
     */
    async makeRequest(
      endpoint,
      method = "GET",
      data = null,
      customHeaders = {}
    ) {
      const url = endpoint.startsWith("http")
        ? endpoint
        : this.API_BASE + endpoint;

      const token = this.getToken();

      // No token → return empty data silently (guest mode, no errors)
      if (!token && endpoint.startsWith("/api/")) {
        return { success: true, data: [] };
      }

      // Headers mặc định
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...customHeaders,
      };

      // Thêm token nếu có
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const options = {
        method: method.toUpperCase(),
        headers,
        credentials: "include", // Quan trọng cho session/cookie
      };

      // Thêm body cho các method không phải GET/HEAD
      if (data && !["GET", "HEAD"].includes(method.toUpperCase())) {
        options.body = JSON.stringify(data);
      }

      // Thêm query params cho GET request
      if (
        (method.toUpperCase() === "GET" || method.toUpperCase() === "DELETE") &&
        data
      ) {
        const params = new URLSearchParams(data).toString();
        if (params) {
          const separator = url.includes("?") ? "&" : "?";
          options.url = url + separator + params;
        }
      }

      try {
        const response = await fetch(url, options);

        // Xử lý response không có nội dung
        if (response.status === 204) {
          return { success: true, message: "Thành công" };
        }

        // Parse response text thành JSON
        let result = {};
        const text = await response.text();

        if (text && text.trim()) {
          try {
            result = JSON.parse(text);
          } catch (e) {
            return {
              success: false,
              message: "Server trả về dữ liệu không hợp lệ",
              raw: text,
            };
          }
        }

        // Xử lý lỗi token — không redirect, không xóa token
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            message: result.message || "Unauthorized",
            status: response.status,
          };
        }

        // Xử lý lỗi server khác
        if (!response.ok) {
          const errorMessage =
            result.message ||
            result.error ||
            `Lỗi ${response.status}: ${response.statusText}`;

          throw new Error(errorMessage);
        }

        // Thêm thông tin status vào result nếu chưa có
        if (!result.status) {
          result.status = response.status;
        }

        return result;
      } catch (err) {

        // Phân loại lỗi
        let userMessage = err.message;
        if (err.name === "TypeError" && err.message.includes("fetch")) {
          userMessage =
            "Không thể kết nối đến server. Vui lòng kiểm tra kết nối mạng.";
        }

        this.showToast(userMessage, "error");

        // Re-throw để có thể catch ở nơi gọi
        throw {
          success: false,
          message: userMessage,
          error: err,
        };
      }
    },

    /**
     * Shortcut cho GET request
     */
    async get(endpoint, params = null) {
      return this.makeRequest(endpoint, "GET", params);
    },

    /**
     * Shortcut cho POST request
     */
    async post(endpoint, data = null) {
      return this.makeRequest(endpoint, "POST", data);
    },

    /**
     * Shortcut cho PUT request
     */
    async put(endpoint, data = null) {
      return this.makeRequest(endpoint, "PUT", data);
    },

    /**
     * Shortcut cho DELETE request
     */
    async delete(endpoint, data = null) {
      return this.makeRequest(endpoint, "DELETE", data);
    },

    /**
     * Upload file
     * @param {string} endpoint - Đường dẫn API
     * @param {FormData} formData - FormData chứa file
     * @returns {Promise<object>}
     */
    async uploadFile(endpoint, formData) {
      const token = this.getToken();
      const url = endpoint.startsWith("http")
        ? endpoint
        : this.API_BASE + endpoint;

      const headers = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const options = {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      };

      try {
        const response = await fetch(url, options);
        return await response.json();
      } catch (err) {
        this.showToast("Lỗi upload file", "error");
        throw err;
      }
    },

    /**
     * Hiển thị thông báo toast
     * @param {string} message - Nội dung thông báo
     * @param {string} type - Loại thông báo: success, error, warning, info
     * @param {number} duration - Thời gian hiển thị (ms)
     */
    // Cải thiện hàm showToast nếu cần
    showToast: function (message, type = "info") {
      const toastContainer =
        document.getElementById("toast-container") ||
        (() => {
          const container = document.createElement("div");
          container.id = "toast-container";
          container.className = "toast-container";
          document.body.appendChild(container);
          return container;
        })();

      const toastId = "toast-" + Date.now();

      const colors = {
        success: "bg-green-50 border-green-200 text-green-800",
        error: "bg-red-50 border-red-200 text-red-800",
        warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
        info: "bg-gray-50 border-gray-200 text-gray-700",
        loading: "bg-gray-50 border-gray-200 text-gray-700",
      };

      const toast = document.createElement("div");
      toast.id = toastId;
      toast.className = `border ${colors[type]} animate-slide-in`;
      toast.style.cssText = "font-size:12px;padding:6px 12px;border-radius:6px;max-width:280px;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.1);";
      toast.innerHTML = `<span class="font-medium">${message}</span>`;

      toastContainer.appendChild(toast);

      const duration = type === "error" ? 2500 : 1500;
      setTimeout(() => {
        toast.classList.add("animate-fade-out");
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 300);
      }, duration);

      return toastId;
    },

    _createDialog(opts) {
      const { title, message, type, buttons, onResult } = opts;
      const icons = { info: "fa-info-circle", success: "fa-check-circle", warning: "fa-exclamation-triangle", error: "fa-times-circle", confirm: "fa-question-circle" };
      const iconColors = { info: "var(--accent,#2563EB)", success: "#16a34a", warning: "#f59e0b", error: "#dc2626", confirm: "var(--accent,#2563EB)" };

      const overlay = document.createElement("div");
      overlay.className = "util-dialog-overlay";

      const panel = document.createElement("div");
      panel.className = "util-dialog-panel";
      panel.innerHTML = `
        <div class="util-dialog-icon" style="color:${iconColors[type] || iconColors.info}">
          <i class="fas ${icons[type] || icons.info}"></i>
        </div>
        ${title ? `<div class="util-dialog-title">${title}</div>` : ""}
        <div class="util-dialog-msg">${message}</div>
        <div class="util-dialog-btns"></div>`;

      const btnContainer = panel.querySelector(".util-dialog-btns");
      const close = (val) => { overlay.classList.add("closing"); setTimeout(() => overlay.remove(), 200); onResult(val); };

      buttons.forEach((b) => {
        const btn = document.createElement("button");
        btn.className = b.primary ? "util-btn-primary" : "util-btn-secondary";
        if (b.danger) btn.classList.add("util-btn-danger");
        btn.textContent = b.label;
        btn.addEventListener("click", () => close(b.value));
        btnContainer.appendChild(btn);
      });

      overlay.appendChild(panel);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
      document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(false); } });
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("visible"));
    },

    alert(message, title, type = "info") {
      return new Promise((resolve) => {
        this._createDialog({
          title, message, type,
          buttons: [{ label: "OK", value: true, primary: true }],
          onResult: resolve,
        });
      });
    },

    confirm(message, title = "Xác nhận") {
      return new Promise((resolve) => {
        this._createDialog({
          title, message, type: "confirm",
          buttons: [
            { label: "Huỷ", value: false },
            { label: "Xác nhận", value: true, primary: true },
          ],
          onResult: resolve,
        });
      });
    },

    confirmDanger(message, title = "Xác nhận") {
      return new Promise((resolve) => {
        this._createDialog({
          title, message, type: "warning",
          buttons: [
            { label: "Huỷ", value: false },
            { label: "Xoá", value: true, primary: true, danger: true },
          ],
          onResult: resolve,
        });
      });
    },

    /**
     * Định dạng ngày tháng
     * @param {Date|string} date - Ngày cần định dạng
     * @param {string} format - Định dạng (short, medium, long, datetime)
     * @returns {string}
     */
    formatDate(date, format = "medium") {
      if (!date) return "";

      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return "Invalid date";

      const formats = {
        short: d.toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        medium: d.toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        long: d.toLocaleDateString("vi-VN", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
        datetime: d.toLocaleString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        time: d.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      return formats[format] || formats.medium;
    },

    /**
     * Debounce function
     * @param {Function} func - Hàm cần debounce
     * @param {number} wait - Thời gian chờ (ms)
     * @returns {Function}
     */
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    /**
     * Throttle function
     * @param {Function} func - Hàm cần throttle
     * @param {number} limit - Thời gian giới hạn (ms)
     * @returns {Function}
     */
    throttle(func, limit) {
      let inThrottle;
      return function (...args) {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => (inThrottle = false), limit);
        }
      };
    },

    /**
     * Sao chép text vào clipboard
     * @param {string} text - Text cần copy
     * @returns {Promise<boolean>}
     */
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.showToast("Đã sao chép vào clipboard", "success", 2000);
        return true;
      } catch (err) {
        this.showToast("Không thể sao chép", "error");
        return false;
      }
    },

    /**
     * Tải file từ URL
     * @param {string} url - URL file
     * @param {string} filename - Tên file khi tải về
     */
    downloadFile(url, filename) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
  };

}
