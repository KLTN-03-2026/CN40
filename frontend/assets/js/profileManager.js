(function () {
  "use strict";

  if (window.getSelection) {
    const originalGetSelection = window.getSelection;
    window.getSelection = function () {
      try {
        const sel = originalGetSelection();
        if (sel && typeof sel.rangeCount === "number") {
          return sel;
        }
        return { rangeCount: 0, getRangeAt: () => null };
      } catch (e) {
        return { rangeCount: 0, getRangeAt: () => null };
      }
    };
  }

  if (window.ProfileManager) {
    return;
  }

  const ProfileManager = {
    initialized: false,
    currentUser: null,

    init() {
      if (this.initialized) {
        return;
      }

      this.loadUserData();

      this.bindEvents();

      this.initialized = true;
    },

    loadUserData() {
      try {
        const userData = localStorage.getItem("user_data");
        if (userData) {
          this.currentUser = JSON.parse(userData);
        }
      } catch (err) {
        console.error("Error loading user data:", err);
      }
    },

    bindEvents() {
      // Save button
      const saveBtn = document.getElementById("saveProfileBtn");
      if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.saveProfile();
        });
      }

      // Close button (X)
      const closeBtn = document.getElementById("closeProfileModal");
      if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.closeModal();
        });
      }

      // Cancel button
      const cancelBtn = document.getElementById("cancelProfileBtn");
      if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.closeModal();
        });
      }

      // Avatar upload
      const avatarInput = document.getElementById("avatarInput");
      if (avatarInput) {
        avatarInput.addEventListener("change", (e) =>
          this.handleAvatarUpload(e)
        );
      }

      // ESC key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          const modal = document.getElementById("profileModal");
          if (modal && !modal.classList.contains("hidden")) {
            this.closeModal();
          }
        }
      });
    },

    waitForModalThenBind() {
      const checkModal = () => {
        const modal = document.getElementById("profileModal");
        if (modal) {
          this.bindEvents();
        } else {
          setTimeout(checkModal, 100);
        }
      };
      checkModal();
    },

    async init() {
      if (this.initialized) {
        return;
      }

      // Load user data từ localStorage hoặc API
      await this.loadUserData();

      // Đợi modal tồn tại rồi mới bind events
      this.waitForModalThenBind();

      this.initialized = true;
    },

    async openProfileModal() {
      // ALWAYS reload data from API to ensure fresh data
      await this.loadUserData();

      const modal = document.getElementById("profileModal");
      if (!modal) {
        return;
      }

      // Fill form with loaded data
      this.fillFormWithUserData();

      // Show modal
      if (window.ModalManager?.showModalById) {
        window.ModalManager.showModalById("profileModal");
      } else {
        modal.classList.remove("hidden");
        modal.classList.add("active", "show");
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
      }
    },

    async loadUserData() {
      try {
        // Thử lấy từ localStorage trước
        let userData = localStorage.getItem("user_data");

        if (userData) {
          try {
            this.currentUser = JSON.parse(userData);
            return;
          } catch (parseError) {
            // Failed to parse localStorage, fetch from API
          }
        }

        // Nếu không có trong localStorage, fetch từ API
        const token = localStorage.getItem("auth_token");

        if (!token) {
          return;
        }

        const response = await fetch("/api/users/profile", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success || !data.data) {
          throw new Error("Invalid API response structure");
        }

        // Lưu vào localStorage và currentUser
        this.currentUser = data.data;
        localStorage.setItem("user_data", JSON.stringify(data.data));
      } catch (err) {
        console.error("Error loading user data:", err);
        this.showStatus(
          `Không thể tải thông tin người dùng: ${err.message}`,
          "error"
        );
      }
    },

    async loadUserDataFromAPI() {
      try {
        const response = await fetch("/api/profile", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data && data.data) {
          this.currentUser = data.data;
          localStorage.setItem("user_data", JSON.stringify(data.data));
        }
      } catch (error) {
        console.error("Error fetching user profile from API:", error);
      }
    },

    fillFormWithUserData() {
      if (!this.currentUser) {
        return;
      }

      const form = document.getElementById("profileForm");
      if (!form) {
        return;
      }

      // Hỗ trợ nhiều naming conventions
      const getValue = (field) => {
        return (
          this.currentUser[field] ||
          this.currentUser[field.toLowerCase()] ||
          this.currentUser[field.charAt(0).toUpperCase() + field.slice(1)] ||
          ""
        );
      };

      // Map các fields
      const fields = {
        hoten:
          getValue("hoten") || getValue("HoTen") || getValue("fullname") || "",
        username: getValue("username") || getValue("Username") || "",
        email: getValue("email") || getValue("Email") || "",
        phone:
          getValue("phone") ||
          getValue("SoDienThoai") ||
          getValue("sodienthoai") ||
          "",
        ngaysinh: getValue("ngaysinh") || getValue("NgaySinh") || "",
        gioitinh: getValue("gioitinh") || getValue("GioiTinh") || "",
        bio: getValue("bio") || getValue("Bio") || "",
      };

      // Fill form
      Object.entries(fields).forEach(([fieldName, value]) => {
        const element = form.elements[fieldName];
        if (element) {
          element.value = value || "";
        }
      });

      // Update avatar
      const userName = fields.hoten || fields.username || "?";
      this.updateAvatarDisplay(userName);
    },

    updateAvatarDisplay(userName) {
      const avatar = document.getElementById("profileAvatar");
      const savedAvatar = localStorage.getItem("user_avatar");
      if (avatar) {
        if (savedAvatar) {
          avatar.innerHTML = "";
          avatar.style.backgroundImage = `url(${savedAvatar})`;
          avatar.style.backgroundSize = "cover";
          avatar.style.backgroundPosition = "center";
        } else {
          const letter = (userName || "?").charAt(0).toUpperCase();
          avatar.textContent = letter;
        }
      }
      // Also update sidebar avatar
      const sidebarAvatar = document.getElementById("sidebarAvatarContainer");
      if (sidebarAvatar && savedAvatar) {
        sidebarAvatar.innerHTML = "";
        sidebarAvatar.style.backgroundImage = `url(${savedAvatar})`;
        sidebarAvatar.style.backgroundSize = "cover";
        sidebarAvatar.style.backgroundPosition = "center";
      }
    },

    handleAvatarUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        this.showStatus(" File quá lớn! Tối đa 5MB", "error");
        return;
      }

      if (!file.type.startsWith("image/")) {
        this.showStatus(" Vui lòng chọn tệp ảnh!", "error");
        return;
      }

      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const img = new Image();
        img.onload = () => {
          const base64 = readerEvent.target.result;
          if (this.currentUser) this.currentUser.avatar = base64;
          localStorage.setItem("user_avatar", base64);

          // Update profile modal avatar
          const profileAvatar = document.getElementById("profileAvatar");
          if (profileAvatar) {
            profileAvatar.innerHTML = "";
            profileAvatar.style.backgroundImage = `url(${base64})`;
            profileAvatar.style.backgroundSize = "cover";
            profileAvatar.style.backgroundPosition = "center";
          }

          // Update sidebar avatar
          const sidebarAvatar = document.getElementById("sidebarAvatarContainer");
          if (sidebarAvatar) {
            sidebarAvatar.innerHTML = "";
            sidebarAvatar.style.backgroundImage = `url(${base64})`;
            sidebarAvatar.style.backgroundSize = "cover";
            sidebarAvatar.style.backgroundPosition = "center";
          }

          Utils.showToast?.("Avatar đã được cập nhật", "success");
        };
        img.src = readerEvent.target.result;
      };
      reader.readAsDataURL(file);
    },

    async saveProfile() {
      const form = document.getElementById("profileForm");
      if (!form) {
        return;
      }

      // Validate
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Lấy userId từ nhiều nguồn
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
        this.showStatus(
          "Không tìm thấy ID người dùng. Vui lòng đăng nhập lại.",
          "error"
        );
        return;
      }

      // Lấy data từ form
      const formData = new FormData(form);
      const updatedUser = {
        HoTen: formData.get("hoten")?.trim() || "",
        Email: formData.get("email")?.trim() || "",
        SoDienThoai: formData.get("phone")?.trim() || "",
      };

      // Chỉ thêm password nếu có nhập
      const password = formData.get("password")?.trim();
      if (password && password.length > 0) {
        updatedUser.Password = password;
      }

      // Disable button
      const saveBtn = document.getElementById("saveProfileBtn");
      if (!saveBtn) return;

      const originalText = saveBtn.innerHTML;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';

      try {
        const token = localStorage.getItem("auth_token");
        if (!token) {
          throw new Error("Không tìm thấy token xác thực");
        }

        const response = await fetch(`/api/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updatedUser),
        });

        const responseData = await response.json();

        if (!response.ok) {
          throw new Error(responseData.message || `HTTP ${response.status}`);
        }

        // Update local data
        const newUserData = responseData.data || {
          ...this.currentUser,
          ...updatedUser,
          hoten: updatedUser.HoTen,
          email: updatedUser.Email,
          phone: updatedUser.SoDienThoai,
        };

        localStorage.setItem("user_data", JSON.stringify(newUserData));
        this.currentUser = newUserData;

        // Update sidebar
        if (window.updateSidebarUser) {
          window.updateSidebarUser(newUserData);
        }

        this.showStatus("✅ Cập nhật thông tin thành công!", "success");

        // Close modal after 1.5s
        setTimeout(() => this.closeModal(), 1500);
      } catch (error) {
        console.error("Save profile error:", error);
        this.showStatus(`Lỗi: ${error.message}`, "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
      }
    },

    closeModal() {
      const modal = document.getElementById("profileModal");
      if (!modal) return;

      if (window.ModalManager && window.ModalManager.close) {
        window.ModalManager.close("profileModal");
      } else {
        modal.classList.add("hidden");
        modal.classList.remove("active", "show");
        modal.style.display = "none";
        document.body.style.overflow = "";
      }
    },

    showStatus(message, type = "info") {
      const statusEl = document.getElementById("profileStatusMessage");
      if (!statusEl) return;

      let bgColor = "bg-red-50";
      let borderColor = "border-red-200";
      let textColor = "text-red-700";

      if (type === "success") {
        bgColor = "bg-green-50";
        borderColor = "border-green-200";
        textColor = "text-green-700";
      } else if (type === "error") {
        bgColor = "bg-red-50";
        borderColor = "border-red-200";
        textColor = "text-red-700";
      }

      statusEl.className = `${bgColor} border ${borderColor} ${textColor} rounded-lg p-4 text-sm`;
      statusEl.innerHTML = message;
      statusEl.classList.remove("hidden");

      setTimeout(() => {
        statusEl.classList.add("hidden");
      }, 5000);
    },

    cleanup() {},
  };

  window.ProfileManager = ProfileManager;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        ProfileManager.init();
      }, 500);
    });
  } else {
    setTimeout(() => {
      ProfileManager.init();
    }, 500);
  }

  window.addEventListener(
    "error",
    (event) => {
      if (event.message && event.message.includes("getRangeAt")) {
        event.preventDefault();
        return true;
      }
    },
    true
  );
})();
