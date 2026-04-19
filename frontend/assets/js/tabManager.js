(function () {
  "use strict";

  if (window.TabManager) {
    return;
  }

  window.TabManager = {
    init() {
      this.initSalaryTabs();
    },

    initSalaryTabs() {
      const salaryTab = document.getElementById("salary-tab");
      const salaryStatsTab = document.getElementById("salary-stats-tab");
      const salaryContent = document.getElementById("salary-content");
      const salaryStatsContent = document.getElementById("stats-content");

      if (
        !salaryTab ||
        !salaryStatsTab ||
        !salaryContent ||
        !salaryStatsContent
      ) {
        return;
      }

      salaryTab.addEventListener("click", () => {
        this.activateTab(salaryTab, salaryStatsTab);
        this.showContent(salaryContent, salaryStatsContent);
      });

      salaryStatsTab.addEventListener("click", () => {
        this.activateTab(salaryStatsTab, salaryTab);
        this.showContent(salaryStatsContent, salaryContent);
      });
    },

    activateTab(activeTab, inactiveTab) {
      activeTab.classList.remove("text-gray-700", "bg-gray-200");
      activeTab.classList.add("text-white", "bg-red-600");

      inactiveTab.classList.remove("text-white", "bg-red-600");
      inactiveTab.classList.add("text-gray-700", "bg-gray-200");
    },

    showContent(activeContent, inactiveContent) {
      if (window.Utils) {
        Utils.showElement(activeContent);
        Utils.hideElement(inactiveContent);
      } else {
        activeContent?.classList.remove("hidden");
        inactiveContent?.classList.add("hidden");
      }
    },
  };
})();
