(function () {
  "use strict";

  if (window.ComponentLoader) {

    return;
  }

  window.ComponentLoader = {
    loadedComponents: new Set(),
    loadedScripts: new Set(),
    currentSection: null,

    PAGE_MAP: {
      schedule: "pages/calendar-content.html",
      work: "pages/work.html",
      salary: "pages/salary.html",
      profile: "pages/profile.html",
      ai: "pages/ai-content.html",
    },

    async loadComponent(containerId, filePath, options = {}) {
      const { forceReload = false, executeScripts = true } = options;
      const container = document.getElementById(containerId);

      if (!container) {
        console.warn(` Container not found: #${containerId}`);
        return false;
      }

      if (this.loadedComponents.has(containerId) && !forceReload) {

        return true;
      }

      try {

        const response = await fetch(filePath);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${filePath}`);
        }

        const html = await response.text();

        if (containerId === "sidebar-container") {

          try {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = html;


            const styleTag = tempDiv.querySelector("style");
            if (styleTag) {
              const newStyle = document.createElement("style");
              newStyle.innerHTML = styleTag.innerHTML;
              document.head.appendChild(newStyle);


              await new Promise((r) => setTimeout(r, 50));
            }

            const asideElement = tempDiv.querySelector("aside");
            if (!asideElement) {
              throw new Error("No <aside> element found in sidebar.html");
            }


            container.innerHTML = asideElement.outerHTML;


            const settingsModal = tempDiv.querySelector("#settingsModal");
            if (settingsModal) {
              const settingsContainer =
                document.getElementById("settingsModal");
              if (settingsContainer) {
                settingsContainer.outerHTML = settingsModal.outerHTML;

              }
            }

            const scripts = tempDiv.querySelectorAll("script");
            for (let idx = 0; idx < scripts.length; idx++) {
              const newScript = document.createElement("script");
              newScript.innerHTML = scripts[idx].innerHTML;
              document.body.appendChild(newScript);

            }



            // Width is controlled by sidebar.html CSS rules (72px collapsed / 240px expanded).
            // No override needed here — forceSidebarVisibility removed to avoid width conflict.
          } catch (error) {
            console.error(` SIDEBAR LOADING FAILED:`, error);
            container.innerHTML = html;
          }
        } else if (containerId.includes("Modal")) {

          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = html;

          const nestedModal = tempDiv.querySelector(`#${containerId}`);

          if (nestedModal) {


            const nestedInsideNested = nestedModal.querySelector(
              `#${containerId}`
            );
            if (nestedInsideNested) {
              console.warn(` DOUBLE NESTED MODAL DETECTED!`);

              let deepestModal = nestedInsideNested;
              while (deepestModal.querySelector(`#${containerId}`)) {
                deepestModal = deepestModal.querySelector(`#${containerId}`);
              }

              container.innerHTML = deepestModal.outerHTML;
            } else {
              container.innerHTML = nestedModal.outerHTML;
            }

            setTimeout(() => {
              this.fixNestedModals(containerId);
              this.checkModalStructure(containerId);
            }, 50);
          } else {
            container.innerHTML = html;
          }
        } else {
          container.innerHTML = html;
        }

        if (executeScripts) {
          await this.executeScripts(container);
        }

        this.loadedComponents.add(containerId);
        container.dataset.loaded = "true";


        return true;
      } catch (err) {
        console.error(` Error loading ${filePath}:`, err);
        container.innerHTML = `
          <div class="flex items-center justify-center h-96">
            <div class="text-center p-8 bg-red-50 rounded-xl">
              <div class="text-5xl mb-4"></div>
              <h3 class="text-xl font-bold text-red-700 mb-2">Lỗi tải nội dung</h3>
              <p class="text-gray-600">${err.message}</p>
            </div>
          </div>
        `;
        return false;
      }
    },

    async executeScripts(container) {
      const scripts = container.querySelectorAll("script");

      for (const script of scripts) {
        try {
          const newScript = document.createElement("script");

          if (script.src) {
            if (this.loadedScripts.has(script.src)) {

              script.remove();
              continue;
            }

            newScript.src = script.src;

            await new Promise((resolve, reject) => {
              newScript.onload = () => {
                this.loadedScripts.add(script.src);

                resolve();
              };
              newScript.onerror = () => {
                console.error(` Script error: ${script.src}`);
                reject(new Error(`Failed to load: ${script.src}`));
              };
              document.head.appendChild(newScript);
            });
          } else {
            newScript.textContent = script.textContent;
            document.head.appendChild(newScript);
          }

          script.remove();
        } catch (err) {
          console.error("Script execution error:", err);
        }
      }
    },
    async loadPageContent(sectionName) {


      const filePath = this.PAGE_MAP[sectionName];
      if (!filePath) {
        console.error(` Unknown section: ${sectionName}`);
        return false;
      }

      const containerId = `${sectionName}-section`;

      const success = await this.loadComponent(containerId, filePath);
      if (!success) return false;

      await this.loadSectionExtras(sectionName);

      this.currentSection = sectionName;

      setTimeout(() => {
        this.initializeSection(sectionName);
      }, 200);

      return true;
    },
    async loadSectionExtras(sectionName) {
      switch (sectionName) {
        case "schedule":
          await this.loadComponent(
            "calendar-sidebar",
            "components/calendar-sidebar.html"
          );
          break;

        case "ai":

          break;
      }
    },

    initializeSection(sectionName) {


      const initMap = {
        schedule: () => {
          if (window.CalendarModule?.init) {

            CalendarModule.init();
          }
        },

        ai: () => {
          if (window.AIModule?.init) {

            AIModule.init();
          } else {
            console.error(" AIModule not found!");
          }
        },

        work: () => {
          if (window.WorkManager?.init) {

            WorkManager.init();
          }
        },

        salary: () => {
          if (window.SalaryManager?.init) {

            SalaryManager.init();
          }
          if (window.TabManager?.init) {
            TabManager.init();
          }
        },

        profile: () => {
          if (window.ProfileManager?.init) {

            ProfileManager.init();
          }
        },

        settings: () => {
          if (window.ProfileManager?.init) ProfileManager.init();
          if (window.NotificationManager?.init) NotificationManager.init();

        },
      };

      const initFn = initMap[sectionName];
      if (initFn) {
        try {
          initFn();
        } catch (err) {
          console.error(` Error initializing ${sectionName}:`, err);
        }
      } else {

      }
    },

    async init() {


      try {

        await this.loadComponent(
          "sidebar-container",
          "components/sidebar.html"
        );


        const navbarContainer = document.getElementById("navbar-container");
        if (navbarContainer) {

          await this.loadComponent(
            "navbar-container",
            "components/navbar.html"
          );

        } else {

        }


        await this.loadModals();


        const activeSection = document.querySelector(".section.active");
        if (activeSection) {
          const sectionName = activeSection.id.replace("-section", "");

          await this.loadPageContent(sectionName);
        } else {

        }


      } catch (err) {
        console.error(" ComponentLoader initialization failed:", err);
        throw err;
      }
    },

    async loadModals() {


      const modals = [
        {
          id: "createTaskModal",
          path: "components/modals/create-task-modal.html",
        },
        {
          id: "eventDetailModal",
          path: "components/modals/event-detail-modal.html",
        },
        {
          id: "aiSuggestionModal",
          path: "components/modals/ai-suggestion-modal.html",
        },
        {
          id: "createCategoryModal",
          path: "components/modals/create-category-modal.html",
        },
        {
          id: "profileModal",
          path: "components/modals/profile-modal.html",
        },
        {
          id: "notificationModal",
          path: "components/modals/notification-modal.html",
        },
      ];

      for (const modal of modals) {
        try {
          await this.loadComponent(modal.id, modal.path, {
            executeScripts: true,
          });
          setTimeout(() => {
            this.fixNestedModals(modal.id);
          }, 100);
        } catch (err) {
          console.warn(` Failed to load modal: ${modal.id}`, err);
        }
      }
    },

    fixNestedModals(modalId = null) {


      const modalIds = modalId
        ? [modalId]
        : [
            "aiSuggestionModal",
            "createTaskModal",
            "eventDetailModal",
            "createCategoryModal",
            "profileModal",
            "notificationModal",
          ];

      modalIds.forEach((id) => {
        const modals = document.querySelectorAll(`#${id}`);

        if (modals.length > 1) {
          console.warn(` Multiple ${id} modals found: ${modals.length}`);


          const mainModal = modals[0];
          const isHidden = mainModal.classList.contains("hidden");

          for (let i = 1; i < modals.length; i++) {
            const duplicate = modals[i];

            while (duplicate.firstChild) {
              if (duplicate.firstChild.id === id) {
                duplicate.firstChild.remove();
                continue;
              }
              mainModal.appendChild(duplicate.firstChild);
            }

            duplicate.remove();
          }

          if (!isHidden) {
            mainModal.classList.remove("hidden");
            mainModal.style.display = "flex";
            mainModal.style.visibility = "visible";
            mainModal.style.opacity = "1";
          }


        }
      });
    },

    checkModalStructure(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) {
        console.warn(` Modal not found: ${modalId}`);
        return false;
      }

      const nested = modal.querySelector(`#${modalId}`);
      if (nested) {
        console.error(` NESTED MODAL DETECTED: ${modalId} inside itself!`);
        return false;
      }


      return true;
    },

    fixAllModals() {

      this.fixNestedModals();

      document.querySelectorAll(".modal.active.show").forEach((modal) => {
        if (getComputedStyle(modal).display === "none") {
          modal.style.display = "flex";
          modal.style.visibility = "visible";
          modal.style.opacity = "1";
        }
      });


      return true;
    },

    debugModal(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) {
        console.error(` Modal not found: ${modalId}`);
        return;
      }






      const nested = modal.querySelector(`#${modalId}`);


      if (nested) {


      }


    },

    async reloadComponent(containerId, filePath) {
      this.loadedComponents.delete(containerId);
      return await this.loadComponent(containerId, filePath, {
        forceReload: true,
      });
    },

    isLoaded(containerId) {
      return this.loadedComponents.has(containerId);
    },

    reset() {

      this.loadedComponents.clear();
      this.currentSection = null;

    },

    debug() {





    },
  };

  window.debugLoader = () => window.ComponentLoader.debug();

  window.fixModal = function (modalId = "aiSuggestionModal") {
    if (window.ComponentLoader && ComponentLoader.fixNestedModals) {

      ComponentLoader.fixNestedModals(modalId);

      const modal = document.getElementById(modalId);
      if (modal) {
        modal.style.display = "flex";
        modal.style.visibility = "visible";
        modal.style.opacity = "1";

        const content = modal.querySelector(".modal-content");
        if (content) {

        }
      }
    } else {
      console.error(" ComponentLoader not available");
    }
  };

  setTimeout(() => {
    if (window.ComponentLoader) {
      ComponentLoader.fixNestedModals("aiSuggestionModal");
    }
  }, 1000);


})();
