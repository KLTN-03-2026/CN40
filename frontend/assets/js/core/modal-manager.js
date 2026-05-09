(function () {
  "use strict";

  if (window.ModalManager) {
    delete window.ModalManager;
  }

  const ModalManager = {
    activeModal: null,
    modalStack: [], // stack of open modal IDs; top = currently active
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
        return false;
      }

      modal.classList.remove("hidden");
      modal.classList.add("active", "show");

      document.body.style.overflow = "hidden";

      // Push onto stack: parent modals remain open underneath; close() pops back.
      if (this.activeModal && this.activeModal !== modalId) {
        this.modalStack.push(this.activeModal);
      }
      this.activeModal = modalId;

      window.dispatchEvent(
        new CustomEvent("modalShown", {
          detail: { modalId },
        })
      );

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

      const computed = window.getComputedStyle(modal);

      if (computed.display === "none") {
        modal.style.display = "flex";
      }

      if (parseFloat(computed.opacity) < 1) {
        modal.style.opacity = "1";
      }

      const content = modal.querySelector(".modal-content");
      if (content) {
        const contentRect = content.getBoundingClientRect();
        if (contentRect.height > window.innerHeight) {
          modal.style.overflow = "auto";
        }
      }
    },

    close(modalId) {
      const targetModal = modalId || this.activeModal;
      const modal = document.getElementById(targetModal);

      if (!modal) {
        return;
      }

      modal.classList.remove("active", "show");
      modal.classList.add("hidden");

      modal.style.display = "";
      modal.style.opacity = "";
      modal.style.visibility = "";

      // Pop stack: if there's a parent modal underneath, restore it as active.
      if (this.activeModal === targetModal) {
        this.activeModal = this.modalStack.pop() || null;
      } else {
        // Closing a non-top modal (rare): filter it out of the stack.
        this.modalStack = this.modalStack.filter((id) => id !== targetModal);
      }

      // Only release body scroll lock if no modal is still open.
      if (!this.activeModal) {
        document.body.style.overflow = "";
      }

      window.dispatchEvent(
        new CustomEvent("modalClosed", {
          detail: { modalId: targetModal },
        })
      );
    },

    /** Is this click on the active modal's backdrop (not its content)? */
    _isBackdropClick(e) {
      if (!this.activeModal) return false;
      const modal = document.getElementById(this.activeModal);
      if (!modal) return false;
      const t = e.target;
      // Direct click on the .modal container or its .modal-overlay.
      if (t === modal) return true;
      if (t.classList && t.classList.contains("modal-overlay") && modal.contains(t)) return true;
      if (t.hasAttribute && t.hasAttribute("data-modal-close")) return true;
      return false;
    },

    setupGlobalEventListeners() {
      document.addEventListener("click", (e) => {
        if (!this.activeModal) return;
        if (this._isBackdropClick(e)) {
          this.close(this.activeModal);
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.activeModal) {
          this.close(this.activeModal);
        }
      });
    },

    reinitializeModalHandlers(modal) {
      // Modal-specific scripts bind their own X / cancel / overlay handlers on DOM load.
      // Global listeners (ESC + backdrop click) in setupGlobalEventListeners cover the rest.
      // Intentionally empty to avoid destructive cloneNode that dropped per-modal handlers
      // (e.g., form-reset on close in create-task-modal.html).
    },

    showCreateTaskModal(taskData = null) {
      const modal = document.getElementById("createTaskModal");
      if (!modal) {
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
      // Debug utility — intentionally kept without console output
    },
  };

  window.ModalManager = ModalManager;

  window.testModal = (modalId = "createTaskModal") => {
    ModalManager.showModalById(modalId);
  };

  window.debugModals = () => ModalManager.debug();
})();
