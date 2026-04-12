(function () {
  "use strict";

  if (window.AppNavigation) {

    return;
  }

  const AppNavigation = {
    currentSection: null,
    initialized: false,
    navButtons: null,
    sections: null,

    init() {
      if (this.initialized) {

        return;
      }



      this.navButtons = document.querySelectorAll("[data-section]");
      this.sections = document.querySelectorAll(".section");

      if (this.navButtons.length === 0) {
        console.error(" No navigation buttons found with [data-section]!");
        return;
      }

      if (this.sections.length === 0) {
        console.error(" No sections found with .section class!");
        return;
      }




      this.bindEvents();
      this.ensureSingleActiveSection();
      this.initialized = true;



    },

    async cleanupCurrentSection() {
      if (!this.currentSection) return;



      const cleanupMap = {
        schedule: () => {
          // Don't destroy - keep calendar alive for instant re-entry

        },
        work: () => {
          if (window.WorkManager && WorkManager.cleanup) {
            WorkManager.cleanup();
          }
        },
        salary: () => {
          if (window.SalaryManager && SalaryManager.cleanup) {
            SalaryManager.cleanup();
          }
        },
        profile: () => {
          if (window.ProfileManager && ProfileManager.cleanup) {
            ProfileManager.cleanup();
          }
        },
        ai: () => {


          const aiCalendar = document.getElementById("ai-calendar");
          if (aiCalendar && window.AIModule && AIModule.calendar) {
            if (AIModule.calendar) {
              AIModule.lastView = AIModule.currentView;
              AIModule.lastDate = AIModule.calendar.getDate();
            }

            aiCalendar.style.opacity = "0";
            aiCalendar.style.pointerEvents = "none";
            aiCalendar.style.position = "absolute";
            aiCalendar.style.left = "-9999px";
          }
        },
      };

      if (cleanupMap[this.currentSection]) {
        cleanupMap[this.currentSection]();
      }
    },

    ensureSingleActiveSection() {
      let activeFound = false;
      this.sections.forEach((section) => {
        if (section.classList.contains("active")) {
          if (activeFound) {
            section.classList.remove("active");

          } else {
            activeFound = true;
            this.currentSection = section.id.replace("-section", "");

          }
        }
      });

      if (!activeFound && this.sections.length > 0) {
        const scheduleSection = document.getElementById("schedule-section");
        if (scheduleSection) {
          scheduleSection.classList.add("active");
          this.currentSection = "schedule";

        }
      }
    },

    bindEvents() {


      this.navButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.handleNavigation(btn);
        });

      });


    },

    async handleNavigation(btn) {
      const targetSection = btn.dataset.section;



      if (targetSection === this.currentSection) {

        return;
      }

      await this.navigateToSection(targetSection);
    },

    async navigateToSection(sectionName) {
      try {


        const previousSection = this.currentSection;

        await this.cleanupCurrentSection();
        this.updateNavButtons(sectionName);
        this.toggleSections(sectionName);
        await this.loadAndInitSection(sectionName);

        this.currentSection = sectionName;

        const event = new CustomEvent("section-changed", {
          detail: {
            section: sectionName,
            previousSection: previousSection,
            timestamp: new Date().toISOString(),
          },
        });
        document.dispatchEvent(event);



      } catch (error) {
        console.error(` Navigation to ${sectionName} failed:`, error);

        const errorEvent = new CustomEvent("section-change-error", {
          detail: {
            section: sectionName,
            error: error.message,
            timestamp: new Date().toISOString(),
          },
        });
        document.dispatchEvent(errorEvent);
      }
    },

    updateNavButtons(targetSection) {


      this.navButtons.forEach((btn) => {
        btn.classList.remove("bg-gray-300", "text-gray-900", "bg-gray-200");
        btn.classList.add("text-gray-600", "hover:bg-gray-100");
        btn.removeAttribute("aria-current");
      });

      const targetBtn = document.querySelector(
        `[data-section="${targetSection}"]`
      );
      if (targetBtn) {
        targetBtn.classList.add("bg-gray-200", "text-gray-900");
        targetBtn.classList.remove("text-gray-600", "hover:bg-gray-100");
        targetBtn.setAttribute("aria-current", "page");

      }
    },

    toggleSections(targetSection) {


      this.sections.forEach((section) => {
        section.classList.remove("active");
      });

      const targetSectionEl = document.getElementById(
        `${targetSection}-section`
      );
      if (targetSectionEl) {
        targetSectionEl.classList.add("active");

      } else {
        console.error(` Section not found: ${targetSection}-section`);
      }
    },

    async loadAndInitSection(sectionName) {
      const containerId = `${sectionName}-section`;
      const container = document.getElementById(containerId);

      if (!container) {
        console.error(` Container not found: ${containerId}`);
        return;
      }

      // If section content already loaded, just update size
      if (container._sectionLoaded && container.children.length > 0) {

        if (sectionName === 'schedule' && window.CalendarModule?.calendar) {
          requestAnimationFrame(() => {
            window.CalendarModule.calendar.updateSize();
          });
        }
        if (sectionName === 'ai' && window.AIModule?.calendar) {
          const aiCal = document.getElementById('ai-calendar');
          if (aiCal) {
            aiCal.style.position = '';
            aiCal.style.left = '';
            aiCal.style.opacity = '1';
            aiCal.style.pointerEvents = '';
          }
          requestAnimationFrame(() => {
            window.AIModule.calendar.updateSize();
          });
        }
        return;
      }
      container._sectionLoaded = true;



      if (window.ComponentLoader && ComponentLoader.loadPageContent) {

        await ComponentLoader.loadPageContent(sectionName);
      } else {
        console.error(
          ` ComponentLoader not available or missing loadPageContent`
        );
        return;
      }

      if (window.ModalManager) {
        setTimeout(() => {
          if (window.ModalManager.reinitializeEventHandlers) {
            ModalManager.reinitializeEventHandlers();
          }
        }, 100);
      }

      if (window.App && window.App.updateUserInfo) {
        setTimeout(() => window.App.updateUserInfo(), 100);
      }

      setTimeout(() => {
        if (sectionName === "schedule" && window.CalendarModule) {

          CalendarModule.refreshEvents && CalendarModule.refreshEvents();
          CalendarModule.refreshDragDrop && CalendarModule.refreshDragDrop();
        } else if (sectionName === "work") {


          const workEvent = new CustomEvent("work-tab-activated");
          document.dispatchEvent(workEvent);

          if (window.WorkManager) {
            if (!WorkManager.initialized && WorkManager.init) {

              WorkManager.init();
            } else if (WorkManager.loadTasks) {

              WorkManager.loadTasks();
            }
          }

          if (CalendarModule && CalendarModule.setupNativeDragDrop) {
            setTimeout(() => {
              CalendarModule.setupNativeDragDrop();
              CalendarModule.setupExternalDraggable();
            }, 800);
          }
        } else if (sectionName === "ai" && window.AIModule) {

          AIModule.refreshSuggestions && AIModule.refreshSuggestions();

          if (AIModule.restoreCalendar) {
            setTimeout(() => {
              AIModule.restoreCalendar();
            }, 200);
          }
        }
      }, 200);

      window.scrollTo(0, 0);


    },

    async refreshCurrentSection() {
      if (this.currentSection) {
        await this.loadAndInitSection(this.currentSection);
      }
    },
  };

  window.AppNavigation = AppNavigation;



})();
