/**
 * connections-section.js
 * Tab controller for the Connections (Liên kết) section.
 * Manages tab switching between Telegram and Google Calendar panels,
 * and delegates initialization to NotificationsSection for Telegram logic.
 */

window.ConnectionsSection = {
  activeTab: "telegram",

  init() {
    this.bindTabs();
    // Ensure the active tab panel is visible on first load
    this.switchTab(this.activeTab);
    // Delegate Telegram init to existing NotificationsSection
    if (window.NotificationsSection?.init) {
      NotificationsSection.init();
    }
  },

  bindTabs() {
    const buttons = document.querySelectorAll("[data-conn-tab]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabName = btn.getAttribute("data-conn-tab");
        this.switchTab(tabName);
      });
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;

    // Update button active state
    document.querySelectorAll("[data-conn-tab]").forEach((btn) => {
      const isActive = btn.getAttribute("data-conn-tab") === tabName;
      btn.classList.toggle("is-active", isActive);
    });

    // Toggle panel visibility
    document.querySelectorAll("[data-conn-panel]").forEach((panel) => {
      const isActive = panel.getAttribute("data-conn-panel") === tabName;
      panel.classList.toggle("hidden", !isActive);
    });

    // Delegate tab-specific init
    if (tabName === "google-calendar" && window.GoogleCalendarConnection?.init) {
      GoogleCalendarConnection.init();
    }
  },
};
