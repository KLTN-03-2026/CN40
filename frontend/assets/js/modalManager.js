(function () {
  "use strict";

  if (window.ModalManager) {

    delete window.ModalManager;
  }

  const ModalManager = {
    activeModal: null,
    initialized: false,
    cachedContent: new Map(),

    init() {
      if (this.initialized) {

        return;
      }


      this.fixNestedModals();
      this.setupGlobalEventListeners();
      this.initialized = true;

    },

    fixNestedModals() {
      const allModals = document.querySelectorAll("#aiSuggestionModal");
      if (allModals.length > 1) {


        const modalsArray = Array.from(allModals);

        const parentModal = modalsArray.find(
          (m) => m.classList.contains("active") && m.classList.contains("show")
        );
        const childModal = modalsArray.find((m) =>
          m.classList.contains("hidden")
        );

        if (parentModal && childModal && parentModal !== childModal) {


          while (childModal.firstChild) {
            parentModal.appendChild(childModal.firstChild);
          }

          childModal.remove();


        }
      }
    },

    showModalById(modalId) {


      const modal = document.getElementById(modalId);
      if (!modal) {
        console.error(` Modal not found: ${modalId}`);
        return false;
      }



      modal.classList.remove("hidden");
      modal.classList.add("active", "show");

      document.body.style.overflow = "hidden";

      this.activeModal = modalId;



      window.dispatchEvent(
        new CustomEvent("modalShown", {
          detail: { modalId },
        })
      );

      setTimeout(() => {
        const computed = window.getComputedStyle(modal);



      }, 0);

      window.dispatchEvent(
        new CustomEvent("modalOpened", {
          detail: { modalId },
        })
      );

      this.reinitializeModalHandlers(modal);

      setTimeout(() => this.verifyModalVisibility(modalId), 100);

      return true;
    },

    verifyModalVisibility(modalId) {
      const modal = document.getElementById(modalId);
      if (!modal) return;

      const rect = modal.getBoundingClientRect();
      const computed = window.getComputedStyle(modal);








      if (computed.display === "none") {
        console.error(" Modal display is NONE! Forcing flex...");
        modal.style.display = "flex";
      }

      if (parseFloat(computed.opacity) < 1) {
        console.warn(" Modal opacity < 1, forcing 1");
        modal.style.opacity = "1";
      }

      const content = modal.querySelector(".modal-content");
      if (content) {
        const contentRect = content.getBoundingClientRect();


        if (contentRect.height > window.innerHeight) {
          console.warn(" Modal content taller than viewport, enabling scroll");
          modal.style.overflow = "auto";
        }
      }
    },
    close(modalId) {
      const targetModal = modalId || this.activeModal;
      const modal = document.getElementById(targetModal);

      if (!modal) {
        console.warn(` Modal not found for closing: ${targetModal}`);
        return;
      }



      modal.classList.remove("active", "show");

      modal.classList.add("hidden");

      modal.style.display = "";
      modal.style.opacity = "";
      modal.style.visibility = "";

      document.body.style.overflow = "";
      this.activeModal = null;
      window.dispatchEvent(
        new CustomEvent("modalClosed", {
          detail: { modalId: targetModal },
        })
      );


    },

    setupGlobalEventListeners() {
      // ESC key: close any active modal
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        // Find topmost visible modal
        const visibleModal = this._getTopmostVisibleModal();
        if (visibleModal) {
          this.close(visibleModal.id);
        }
      });

      // Backdrop click: close when clicking the modal overlay itself (not content inside)
      document.addEventListener("click", (e) => {
        const target = e.target;

        // 1. Click on backdrop (.modal element directly, not a child)
        if (target.classList.contains("modal") && !target.classList.contains("hidden")) {
          this.close(target.id);
          return;
        }

        // 2. Close buttons: .modal-close, .np-modal-close, [data-close-modal],
        //    [data-modal-close], [aria-label="Đóng"], button containing ×/✕
        const closeSelectors = [
          '.modal-close',
          '.np-modal-close',
          '[data-close-modal]',
          '[data-modal-close]',
          '[aria-label="Đóng"]',
          '[aria-label="Close"]',
        ];
        for (const sel of closeSelectors) {
          if (target.closest(sel)) {
            const modal = target.closest('.modal');
            if (modal && !modal.classList.contains('hidden')) {
              this.close(modal.id);
              return;
            }
          }
        }

        // 3. Button containing × or ✕ text inside a modal
        const btn = target.closest('button');
        if (btn) {
          const txt = btn.textContent.trim();
          if (txt === '×' || txt === '✕' || txt === '✖') {
            const modal = btn.closest('.modal');
            if (modal && !modal.classList.contains('hidden')) {
              this.close(modal.id);
              return;
            }
          }
          // icon-only close buttons by id pattern
          if (/close|cancel/i.test(btn.id || '')) {
            const modal = btn.closest('.modal');
            if (modal && !modal.classList.contains('hidden')) {
              // guard: don't close createCategoryModal via stray id matches
              const categoryModal = document.getElementById('createCategoryModal');
              const isCatOpen = categoryModal && !categoryModal.classList.contains('hidden');
              if (!isCatOpen || modal.id !== 'createCategoryModal') {
                this.close(modal.id);
                return;
              }
            }
          }
        }

        // Legacy: direct .modal backdrop check (kept for compat)
        if (!this.activeModal) return;
        const categoryModal = document.getElementById("createCategoryModal");
        const isCategoryModalOpen =
          categoryModal &&
          !categoryModal.classList.contains("hidden") &&
          categoryModal.style.display !== "none";
        if (isCategoryModalOpen) return;
        if (target.classList.contains("modal") && this.activeModal) {
          this.close(this.activeModal);
        }
      });
    },

    /** Returns the topmost visible .modal element (highest z-index or last in DOM) */
    _getTopmostVisibleModal() {
      const modals = Array.from(document.querySelectorAll('.modal:not(.hidden)'));
      if (modals.length === 0) return null;
      // Pick the one with the highest computed z-index, fallback to last in DOM
      return modals.reduce((top, el) => {
        const z = parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
        const topZ = parseInt(window.getComputedStyle(top).zIndex, 10) || 0;
        return z >= topZ ? el : top;
      });
    },
    reinitializeModalHandlers(modal) {
      if (!modal) return;

      // Broad selector: covers all close button patterns
      const closeButtons = modal.querySelectorAll(
        ".modal-close, .np-modal-close, [data-modal-close], [data-close-modal]," +
        " [id*='cancel'], [id*='close'], [id*='Cancel'], [id*='Close']," +
        " [aria-label='Đóng'], [aria-label='Close']"
      );

      closeButtons.forEach((btn) => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode?.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close(modal.id);
        });
      });
    },

    showCreateTaskModal(taskData = null) {


      const modal = document.getElementById("createTaskModal");
      if (!modal) {
        console.error(" Create task modal not found");
        return false;
      }

      // Clear any lingering inline display styles that closeMainModal may have set
      const content = document.getElementById("createTaskModalContent");
      if (content) { content.style.display = ""; content.style.visibility = ""; }
      const overlay = modal.querySelector(".modal-overlay");
      if (overlay) { overlay.style.display = ""; }

      const success = this.showModalById("createTaskModal");

      // Re-initialize form handlers (function guards itself against duplicate init)
      setTimeout(() => {
        if (window.initCreateTaskModal) window.initCreateTaskModal();
        if (window.loadCategoriesForModal) window.loadCategoriesForModal();
      }, 150);

      if (taskData && window.loadTaskDataIntoForm) {
        setTimeout(() => {
          window.loadTaskDataIntoForm(taskData);
        }, 400);
      }

      return success;
    },

    hideModal(modalId) {
      this.close(modalId);
    },

    hideModalById(modalId) {
      this.close(modalId);
    },

    debug() {




      const modals = document.querySelectorAll(".modal");


      modals.forEach((modal) => {
        const computed = window.getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();









      });


    },
  };

  window.ModalManager = ModalManager;

  window.testModal = (modalId = "createTaskModal") => {

    ModalManager.showModalById(modalId);
  };

  window.debugModals = () => ModalManager.debug();


})();
