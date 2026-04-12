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
      return !!this.getToken();
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
            console.warn("Không parse được JSON:", text);
            return {
              success: false,
              message: "Server trả về dữ liệu không hợp lệ",
              raw: text,
            };
          }
        }

        // Xử lý lỗi token
        if (response.status === 401 || response.status === 403) {
          this.clearAuth();

          // Chỉ redirect nếu không phải trang login
          if (!window.location.pathname.includes("login.html")) {
            this.showToast(
              response.status === 401
                ? "Phiên đăng nhập đã hết hạn"
                : "Không có quyền truy cập",
              "warning"
            );
            setTimeout(() => {
              window.location.href = "/login.html";
            }, 1500);
          }

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
        console.error("❌ Request failed:", err.message, err);

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
        console.error("Upload failed:", err);
        this.showToast("Lỗi upload file", "error");
        throw err;
      }
    },

    /**
     * Compact newspaper-style toast notification.
     * @param {string} message - Toast body text
     * @param {string} type    - "success" | "error" | "warning" | "info"
     * @param {number} duration - Auto-dismiss ms (default 2500)
     */
    showToast: function (message, type = "info", duration = 2500) {
      // Normalise alias "warning" → "warn" for internal key lookup
      const variant = type === "warning" ? "warn" : type;

      // Left-bar accent colours per variant
      const barColors = {
        success: "#8a9a5b",
        error:   "#a83232",
        info:    "#4a6fa5",
        warn:    "#c97b3c",
      };
      const barColor = barColors[variant] || barColors.info;

      // Lazy-create the stack container (bottom-right, newest on top via flex-col-reverse)
      let container = document.getElementById("np-toast-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "np-toast-container";
        document.body.appendChild(container);
      }

      const el = document.createElement("div");
      el.className = "np-toast";
      el.style.setProperty("--toast-bar", barColor);
      el.textContent = message;

      // Click to dismiss immediately
      el.addEventListener("click", () => dismissToast(el));

      // Prepend so newest appears on top
      container.insertBefore(el, container.firstChild);

      // Trigger slide-in on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add("np-toast--visible"));
      });

      function dismissToast(node) {
        if (node._dismissing) return;
        node._dismissing = true;
        node.classList.remove("np-toast--visible");
        node.classList.add("np-toast--out");
        setTimeout(() => {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 320);
      }

      const timer = setTimeout(() => dismissToast(el), duration);
      el._dismissing = false;
      // Clear timer if user clicks before auto-dismiss fires
      el.addEventListener("click", () => clearTimeout(timer), { once: true });

      return el;
    },

    /**
     * Hiển thị confirm dialog
     * @param {string} message - Nội dung confirm
     * @param {string} title - Tiêu đề (optional)
     * @returns {Promise<boolean>}
     */
    confirm(message, title = "Xác nhận") {
      return new Promise((resolve) => {
        // Tạo modal confirm
        const modal = document.createElement("div");
        modal.className =
          "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4";
        modal.innerHTML = `
          <div class="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div class="p-6">
              ${
                title
                  ? `<h3 class="text-lg font-semibold mb-2">${title}</h3>`
                  : ""
              }
              <p class="text-gray-700 mb-6">${message}</p>
              <div class="flex justify-end gap-3">
                <button class="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition" id="confirm-cancel">
                  Hủy
                </button>
                <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition" id="confirm-ok">
                  OK
                </button>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(modal);

        const handleConfirm = (result) => {
          modal.remove();
          resolve(result);
        };

        modal.querySelector("#confirm-ok").onclick = () => handleConfirm(true);
        modal.querySelector("#confirm-cancel").onclick = () =>
          handleConfirm(false);

        // Đóng khi click ra ngoài
        modal.onclick = (e) => {
          if (e.target === modal) handleConfirm(false);
        };
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
        console.error("Copy failed:", err);
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

    showElement(el) {
      if (el) el.classList.remove("hidden");
    },

    hideElement(el) {
      if (el) el.classList.add("hidden");
    },
  };

  // ── Global toast API ──────────────────────────────────────────────────────
  // window.toast.success(msg) / .error / .info / .warn
  // window.showToast(msg, type) — legacy alias maintained for call-site compat
  window.toast = {
    success: (msg, duration) => Utils.showToast(msg, "success", duration),
    error:   (msg, duration) => Utils.showToast(msg, "error",   duration),
    info:    (msg, duration) => Utils.showToast(msg, "info",    duration),
    warn:    (msg, duration) => Utils.showToast(msg, "warn",    duration),
    // "warning" spelled out variant for safety
    warning: (msg, duration) => Utils.showToast(msg, "warn",    duration),
  };

  // Legacy global alias so standalone callers (auth.js, profile.js, etc.) keep working
  window.showToast = (msg, type, duration) => Utils.showToast(msg, type, duration);

}
