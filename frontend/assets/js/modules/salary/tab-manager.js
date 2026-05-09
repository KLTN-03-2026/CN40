(function () {
  "use strict";

  if (window.TabManager) return;

  // Maps data-tab attribute values to their corresponding view element IDs
  const TAB_VIEWS = {
    stats: "stats-view",
    salary: "salary-view",
    gamification: "gamification-view",
  };

  window.TabManager = {
    init() {
      const tabs = document.querySelectorAll(".tabs .tab[data-tab]");
      if (!tabs.length) return;

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => this.switchTab(tab.dataset.tab, tabs));
      });
    },

    /**
     * Activate the named tab and show its corresponding view.
     * Triggers lazy-init for the gamification section on first open.
     * @param {string} name  - value of data-tab attribute
     * @param {NodeList} tabs - all sibling tab buttons
     */
    switchTab(name, tabs) {
      // Toggle active class — CSS handles all visual styling
      tabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === name);
      });

      // Show/hide view panels
      Object.entries(TAB_VIEWS).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (key === name) {
          el.classList.remove("hidden");
        } else {
          el.classList.add("hidden");
        }
      });

      // Lazy-init gamification data on first open
      if (name === "gamification" && window.GamificationSection?.init) {
        GamificationSection.init();
      }
    },
  };
})();
