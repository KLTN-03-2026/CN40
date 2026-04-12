(function () {
  "use strict";

  if (window.App) {

    return;
  }

  window.App = {
    initialized: false,

    async init() {
      if (this.initialized) {

        return;
      }

      this.initialized = true;


      if (!this.isAuthenticated()) {
        console.warn(" Not authenticated, redirecting to login...");
        window.location.href = "/login.html";
        return;
      }


      try {
        await ComponentLoader.init();


        const sidebarContainer = document.getElementById("sidebar-container");
        if (sidebarContainer && sidebarContainer.children.length > 0) {

        } else {
          console.warn(" Sidebar loaded but may be empty");
        }
      } catch (err) {
        console.error(" Component loading failed:", err);
        throw err;
      }


      this.updateUserInfo();



      if (window.AppNavigation) {
        if (typeof AppNavigation.init === "function") {
          AppNavigation.init();




        } else {
          console.error(" Navigation.init is not a function!");
        }
      } else {
        console.error(" Navigation object not found!");
      }


      if (window.ModalManager?.init) {
        ModalManager.init();

      } else {
        console.warn(" ModalManager not available");
      }


      if (window.StatsManager?.init) {
        try {
          await StatsManager.init();

        } catch (err) {
          console.warn(" StatsManager initialization error:", err);
        }
      } else {
        console.warn(" StatsManager not available");
      }

      const authLoading = document.getElementById("auth-loading");
      const mainApp = document.getElementById("main-app");

      if (authLoading) {
        authLoading.style.display = "none";

      }

      if (mainApp) {
        mainApp.classList.add("ready");

      }

      // refreshIcons removed (Font Awesome removed from project)

      this.verifyInitialization();


    },

    // waitForFontAwesome and refreshIcons removed — Font Awesome removed from project.

    verifyInitialization() {


      const sections = document.querySelectorAll(".section");
      const activeSection = document.querySelector(".section.active");


      const navButtons = document.querySelectorAll("[data-section]");


      // FA icon checks removed


      if (window.AppNavigation) {

      } else {
        console.error("  Navigation object missing!");
      }

      sections.forEach((section) => {
        const isActive = section.classList.contains("active");
        const display = window.getComputedStyle(section).display;

      });

      if (navButtons.length > 0) {

        navButtons.forEach((btn) => {

        });
      }
    },

    isAuthenticated() {
      const token = localStorage.getItem("auth_token");
      if (!token) return false;

      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const isValid = Date.now() < payload.exp * 1000;
        if (!isValid) {
          console.warn(" Token expired");
        }
        return isValid;
      } catch (err) {
        console.error(" Token validation error:", err);
        return false;
      }
    },

    updateUserInfo() {
      const user = JSON.parse(localStorage.getItem("user_data") || "{}");

      const userName    = user.hoten || user.username || "Người dùng";
      const userEmail   = user.email || "";
      const avatarLetter = userName.charAt(0).toUpperCase();
      const avatarUrl   = user.avatarUrl || user.AvatarUrl || null;

      document
        .querySelectorAll(".user-name, [data-user-name], #nav-user-name")
        .forEach((el) => { el.textContent = userName; });

      document
        .querySelectorAll(".user-email, [data-user-email]")
        .forEach((el) => { el.textContent = userEmail; });

      // Update letter fallbacks
      document.querySelectorAll(".avatar-letter").forEach((el) => {
        el.textContent = avatarLetter;
      });

      // Update any .avatar-img elements alongside their letter spans
      if (avatarUrl && (avatarUrl.startsWith("data:") || avatarUrl.startsWith("http"))) {
        document.querySelectorAll(".avatar-img").forEach((img) => {
          img.src = avatarUrl;
          img.style.display = "block";
          const letter = img.parentElement.querySelector(".avatar-letter");
          if (letter) letter.style.display = "none";
        });
      } else {
        document.querySelectorAll(".avatar-img").forEach((img) => {
          img.src = "";
          img.style.display = "none";
          const letter = img.parentElement.querySelector(".avatar-letter");
          if (letter) letter.style.display = "";
        });
      }
    },

    testNavigation(sectionName) {

      if (window.AppNavigation && AppNavigation.navigateToSection) {
        AppNavigation.navigateToSection(sectionName);
      } else {
        console.error(" Navigation not available for testing");
      }
    },

    getState() {
      return {
        initialized: this.initialized,
        authenticated: this.isAuthenticated(),
        navigationReady: !!window.AppNavigation?.initialized,
        currentSection: window.AppNavigation?.currentSection,
        sectionsCount: document.querySelectorAll(".section").length,
        navButtonsCount: document.querySelectorAll("[data-section]").length,
        activeSection: document.querySelector(".section.active")?.id,
        // FA icon state removed — Font Awesome removed from project
      };
    },
  };

  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", () => {

      App.init();
    });
  } else {

    setTimeout(() => App.init(), 100);
  }


})();

window.debugApp = function () {

  const state = window.App?.getState();
  console.table(state);




};

window.refreshUI = function () {


  if (window.App && window.App.updateUserInfo) {
    window.App.updateUserInfo();
  }

  if (window.CalendarModule && CalendarModule.refreshDragDrop) {
    CalendarModule.refreshDragDrop();
  }

  if (window.WorkManager && WorkManager.loadTasks) {
    WorkManager.loadTasks();
  }

  // Font Awesome removed


};

window.testNav = function (section) {
  window.App?.testNavigation(section);
};

// debugIcons removed — Font Awesome removed from project

// fixIcons removed — Font Awesome removed from project
