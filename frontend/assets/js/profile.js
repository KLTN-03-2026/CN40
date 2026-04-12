(function () {
  "use strict";

  if (window.ProfileManager) {

    return;
  }

  window.ProfileManager = {
    initialized: false,
    eventListeners: [],

    init() {
      if (this.initialized) {

        return;
      }


      this.initialized = true;

      this.loadUserProfile();
      this.bindEvents();


    },

    loadUserProfile() {
      const user = JSON.parse(localStorage.getItem("user_data") || "{}");

      if (!user.ID) {
        console.warn(" No user ID found in localStorage");
        return;
      }



      const fields = {
        hoten: user.hoten || "",
        username: user.username || "",
        email: user.email || "",
        phone: user.SoDienThoai || "",
        address: user.DiaChi || "",
      };

      Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
          element.value = value;
        }
      });

      const avatar = document.querySelector(".avatar-letter");
      if (avatar) {
        avatar.textContent = (user.hoten || user.username || "?")
          .charAt(0)
          .toUpperCase();
      }


    },

    bindEvents() {
      const saveButton = document.getElementById("save-profile");
      if (saveButton) {
        const handler = () => this.saveProfile();
        saveButton.addEventListener("click", handler);
        this.eventListeners.push({
          element: saveButton,
          event: "click",
          handler,
        });
      }

      const logoutButton = document.getElementById("logout-btn");
      if (logoutButton) {
        const handler = () => this.handleLogout();
        logoutButton.addEventListener("click", handler);
        this.eventListeners.push({
          element: logoutButton,
          event: "click",
          handler,
        });
      }


    },

    async saveProfile() {
      try {
        const formData = {
          hoten: document.getElementById("hoten")?.value || "",
          SoDienThoai: document.getElementById("phone")?.value || "",
          DiaChi: document.getElementById("address")?.value || "",
        };



        if (typeof Utils === "undefined") {
          throw new Error("Utils module not available");
        }

        const result = await Utils.makeRequest(
          "/api/profile/update",
          "PUT",
          formData
        );

        if (result.success) {
          Utils.showToast("Cập nhật thông tin thành công", "success");

          const user = JSON.parse(localStorage.getItem("user_data") || "{}");
          const updatedUser = { ...user, ...formData };
          localStorage.setItem("user_data", JSON.stringify(updatedUser));

          if (window.App && App.updateUserInfo) {
            App.updateUserInfo();
          }


        } else {
          throw new Error(result.message || "Không thể cập nhật");
        }
      } catch (error) {
        console.error(" Error saving profile:", error);
        if (typeof Utils !== "undefined" && Utils.showToast) {
          Utils.showToast("Lỗi cập nhật: " + error.message, "error");
        }
      }
    },

    handleLogout() {
      if (confirm("Bạn có chắc muốn đăng xuất?")) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user_data");
        window.location.href = "/login.html";
      }
    },

    cleanup() {


      this.eventListeners.forEach(({ element, event, handler }) => {
        if (element && element.removeEventListener) {
          element.removeEventListener(event, handler);
        }
      });

      this.eventListeners = [];
      this.initialized = false;


    },
  };


})();
