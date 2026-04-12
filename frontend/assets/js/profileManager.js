(function () {
  "use strict";

  // Suppress browser-extension selection errors (getRangeAt)
  if (window.getSelection) {
    const _origGetSelection = window.getSelection;
    window.getSelection = function () {
      try {
        const sel = _origGetSelection();
        if (sel && typeof sel.rangeCount === "number") return sel;
        return { rangeCount: 0, getRangeAt: () => null };
      } catch (e) {
        return { rangeCount: 0, getRangeAt: () => null };
      }
    };
  }

  // Singleton guard
  if (window.ProfileManager) return;

  const ProfileManager = {
    initialized: false,
    currentUser: null,

    // ─── Init ─────────────────────────────────────────────────────────────────

    async init() {
      if (this.initialized) return;

      await this.loadUserData();
      this.waitForModalThenBind();
      this.initialized = true;
    },

    waitForModalThenBind() {
      const check = () => {
        if (document.getElementById("profileModal")) {
          this.bindEvents();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    },

    // ─── Load user data ───────────────────────────────────────────────────────

    async loadUserData() {
      try {
        // Try localStorage first
        const raw = localStorage.getItem("user_data");
        if (raw) {
          this.currentUser = JSON.parse(raw);
          return;
        }

        // Fallback: fetch from API
        const token = localStorage.getItem("auth_token");
        if (!token) return;

        const res = await fetch("/api/users/profile", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success || !data.data) throw new Error("Invalid API response");

        this.currentUser = data.data;
        localStorage.setItem("user_data", JSON.stringify(data.data));
      } catch (err) {
        console.error("ProfileManager: error loading user data:", err);
      }
    },

    // ─── Open modal ───────────────────────────────────────────────────────────

    async openProfileModal() {
      // Always refresh from localStorage (may have been updated elsewhere)
      await this.loadUserData();

      const modal = document.getElementById("profileModal");
      if (!modal) {
        console.error("ProfileManager: profileModal element not found");
        return;
      }

      this.fillFormWithUserData();

      if (window.ModalManager?.showModalById) {
        window.ModalManager.showModalById("profileModal");
      } else {
        modal.classList.remove("hidden");
        modal.classList.add("active", "show");
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
      }
    },

    // ─── Fill form ────────────────────────────────────────────────────────────

    fillFormWithUserData() {
      if (!this.currentUser) return;

      const form = document.getElementById("profileForm");
      if (!form) return;

      const u = this.currentUser;

      // Helper: try multiple casing variants
      const pick = (...keys) => {
        for (const k of keys) {
          if (u[k] !== undefined && u[k] !== null && u[k] !== "") return u[k];
        }
        return "";
      };

      const map = {
        hoten:    pick("hoten", "HoTen", "fullname"),
        username: pick("username", "Username"),
        email:    pick("email", "Email"),
        phone:    pick("phone", "Phone", "SoDienThoai", "sodienthoai"),
      };

      Object.entries(map).forEach(([name, value]) => {
        const el = form.elements[name];
        if (el) el.value = value;
      });

      // Render avatar (image or letter)
      const avatarUrl = pick("avatarUrl", "AvatarUrl", "avatar");
      const name = map.hoten || map.username || "?";
      this._renderAvatar(avatarUrl, name);
    },

    // ─── Avatar rendering ─────────────────────────────────────────────────────

    /**
     * Render avatar in the profile modal.
     * Delegates to profile-modal.html's exposed helper if available,
     * otherwise does it inline.
     */
    _renderAvatar(avatarUrl, name) {
      if (window.ProfileModalRenderAvatar) {
        window.ProfileModalRenderAvatar(avatarUrl, name);
        return;
      }

      // Inline fallback
      const imgEl    = document.getElementById("avatarImg");
      const letterEl = document.getElementById("avatarLetter");
      const legacyEl = document.getElementById("profileAvatar");

      if (imgEl && letterEl) {
        if (avatarUrl && (avatarUrl.startsWith("data:") || avatarUrl.startsWith("http"))) {
          imgEl.src = avatarUrl;
          imgEl.style.display = "block";
          letterEl.style.display = "none";
        } else {
          imgEl.src = "";
          imgEl.style.display = "none";
          letterEl.style.display = "";
          letterEl.textContent = (name || "?").charAt(0).toUpperCase();
        }
      } else if (legacyEl) {
        // Very old markup fallback
        legacyEl.textContent = (name || "?").charAt(0).toUpperCase();
      }
    },

    // ─── Bind events (called once modal exists) ───────────────────────────────

    bindEvents() {
      // Clone-replace pattern removes duplicate listeners added by other scripts
      const replace = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener("click", handler);
      };

      replace("saveProfileBtn", (e) => {
        e.preventDefault();
        this.saveProfile();
      });

      replace("closeProfileModal", (e) => {
        e.preventDefault();
        this.closeModal();
      });

      replace("cancelProfileBtn", (e) => {
        e.preventDefault();
        this.closeModal();
      });

      // Avatar file input (the profile-modal.html script handles the full
      // upload flow; here we just keep legacy compatibility)
      const avatarInput = document.getElementById("avatarInput");
      if (avatarInput && !avatarInput._pmBound) {
        avatarInput._pmBound = true;
        // profile-modal.html already handles this; no duplicate binding needed.
      }
    },

    // ─── Save profile ─────────────────────────────────────────────────────────

    async saveProfile() {
      const form = document.getElementById("profileForm");
      if (!form) return;

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Resolve userId
      let userId = null;
      if (this.currentUser) {
        userId =
          this.currentUser.id ||
          this.currentUser.UserID ||
          this.currentUser.userid ||
          this.currentUser.userId ||
          this.currentUser._id;
      }

      if (!userId) {
        this._showStatus("Không tìm thấy ID người dùng. Vui lòng đăng nhập lại.", "error");
        return;
      }

      const token = localStorage.getItem("auth_token");
      if (!token) {
        this._showStatus("Chưa đăng nhập", "error");
        return;
      }

      const formData = new FormData(form);
      const payload = {
        hoten: (formData.get("hoten") || "").trim(),
        email: (formData.get("email") || "").trim(),
        phone: (formData.get("phone") || "").trim() || null,
      };

      const password = (formData.get("password") || "").trim();
      if (password) payload.password = password;

      // UI: disable save button
      const saveBtn = document.getElementById("saveProfileBtn");
      const origText = saveBtn ? saveBtn.textContent : "";
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Đang lưu..."; }

      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

        // Merge updated data (preserve avatarUrl from current state)
        const newData = {
          ...(this.currentUser || {}),
          ...(json.data || payload),
        };

        // Ensure avatarUrl is not lost on profile save
        if (!newData.avatarUrl && this.currentUser?.avatarUrl) {
          newData.avatarUrl = this.currentUser.avatarUrl;
        }

        localStorage.setItem("user_data", JSON.stringify(newData));
        this.currentUser = newData;

        // Update sidebar
        if (window.updateSidebarUser) window.updateSidebarUser(newData);
        if (window.App?.updateUserInfo) window.App.updateUserInfo();

        // Update sidebar avatar image if present
        if (window.ProfileModalUpdateSidebarAvatar) {
          const name = newData.hoten || newData.username || "?";
          window.ProfileModalUpdateSidebarAvatar(newData.avatarUrl || null, name);
        }

        this._showStatus("Cập nhật thông tin thành công!", "success");
        setTimeout(() => this.closeModal(), 1500);
      } catch (err) {
        console.error("ProfileManager.saveProfile error:", err);
        this._showStatus(`Lỗi: ${err.message}`, "error");
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText; }
      }
    },

    // ─── Close modal ──────────────────────────────────────────────────────────

    closeModal() {
      if (window.ModalManager?.close) {
        window.ModalManager.close("profileModal");
      } else {
        const modal = document.getElementById("profileModal");
        if (modal) {
          modal.classList.add("hidden");
          modal.classList.remove("active", "show");
          modal.style.display = "none";
          document.body.style.overflow = "";
        }
      }
    },

    // ─── Status message ───────────────────────────────────────────────────────

    _showStatus(message, type) {
      // Delegate to modal-scoped helper if available
      if (window.ProfileModalShowStatus) {
        window.ProfileModalShowStatus(message, type);
        return;
      }

      const el = document.getElementById("profileStatusMessage");
      if (!el) return;

      el.textContent = message;
      el.style.display = "block";

      if (type === "success") {
        el.style.borderLeftColor = "#27ae60";
        el.style.color = "#27ae60";
      } else if (type === "error") {
        el.style.borderLeftColor = "#c0392b";
        el.style.color = "#c0392b";
      } else {
        el.style.borderLeftColor = "var(--np-accent, #8b0000)";
        el.style.color = "var(--np-text, #1a1a1a)";
      }

      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => { el.style.display = "none"; }, 5000);
    },

    // Legacy alias used by old modal HTML inline scripts
    showStatus(message, type) {
      this._showStatus(message, type);
    },
  };

  window.ProfileManager = ProfileManager;

  // Boot
  const boot = () => setTimeout(() => ProfileManager.init(), 300);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Suppress getRangeAt extension errors globally
  window.addEventListener("error", (ev) => {
    if (ev.message && ev.message.includes("getRangeAt")) {
      ev.preventDefault();
      return true;
    }
  }, true);
})();
