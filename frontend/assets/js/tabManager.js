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
        console.warn(" Salary tab elements not found");
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
      // Active: newspaper accent style
      activeTab.style.background = 'var(--np-bg-card, #faf7f2)';
      activeTab.style.color = 'var(--np-accent, #8b0000)';
      activeTab.style.borderBottom = '3px solid var(--np-accent, #8b0000)';

      // Inactive: muted style
      inactiveTab.style.background = 'transparent';
      inactiveTab.style.color = 'var(--np-text-muted, #6b5f4a)';
      inactiveTab.style.borderBottom = '3px solid transparent';
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
