(function () {
  "use strict";

  async function waitForModalContent(modalId, timeout = 5000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkContent = () => {
        const modal = document.getElementById(modalId);
        const content = modal?.querySelector(".modal-content");

        if (!modal || !content) {
          console.error(" Modal or content not found");
          reject(new Error("Modal structure missing"));
          return;
        }

        const hasChildren = content.children.length > 0;
        const hasHTML = content.innerHTML.trim().length > 100;



        if (hasChildren && hasHTML) {

          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          console.error(" Timeout waiting for content");
          reject(new Error("Content not populated in time"));
        } else {

          setTimeout(checkContent, 100);
        }
      };

      checkContent();
    });
  }

  async function forceLoadModalContent() {
    try {


      const modal = document.getElementById("aiSuggestionModal");
      if (!modal) {
        throw new Error("Modal not found");
      }

      const existingContent = modal.querySelector(".modal-content");
      if (existingContent && existingContent.children.length > 0) {

        return true;
      }

      const response = await fetch(
        "components/modals/ai-suggestion-modal.html"
      );
      if (!response.ok) {
        throw new Error("Failed to load modal HTML");
      }

      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const newContent = doc.querySelector(".modal-content");
      if (!newContent) {
        throw new Error("No .modal-content in HTML file");
      }

      const oldContent = modal.querySelector(".modal-content");
      if (oldContent) {
        modal.replaceChild(newContent, oldContent);
      } else {
        modal.appendChild(newContent);
      }


      return true;
    } catch (error) {
      console.error(" Error loading modal content:", error);
      return false;
    }
  }

  async function initializeAIModalFull() {
    try {


      const modal = document.getElementById("aiSuggestionModal");
      const content = modal?.querySelector(".modal-content");

      if (!content || content.children.length === 0) {

        await forceLoadModalContent();
      }

      await waitForModalContent("aiSuggestionModal");

      const modalContent = modal.querySelector(".modal-content");
      if (modalContent) {
        modalContent.style.cssText = `
          display: flex !important;
          flex-direction: column !important;
          width: 800px !important;
          max-width: 90vw !important;
          min-width: 600px !important;
          min-height: 400px !important;
          max-height: 90vh !important;
          background: white !important;
          border-radius: 12px !important;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3) !important;
          overflow: hidden !important;
          position: relative !important;
          z-index: 10001 !important;
          opacity: 1 !important;
          visibility: visible !important;
        `;

        void modalContent.offsetHeight;


      }

      if (window.AIHandler && window.AIHandler.initAIModal) {

        await AIHandler.initAIModal();
      }

      setTimeout(() => {
        const finalContent = document.querySelector(
          "#aiSuggestionModal .modal-content"
        );
        if (finalContent) {


          if (finalContent.offsetWidth === 0) {
            console.error(" STILL 0x0 - Check modal HTML file!");
          } else {

          }
        }
      }, 200);

      return true;
    } catch (error) {
      console.error(" Error initializing modal:", error);
      return false;
    }
  }

  const originalShowModalById = window.ModalManager?.showModalById;

  if (originalShowModalById) {
    window.ModalManager.showModalById = function (modalId) {


      const result = originalShowModalById.call(this, modalId);

      if (modalId === "aiSuggestionModal") {


        setTimeout(async () => {
          await initializeAIModalFull();
        }, 100);
      }

      return result;
    };


  }

  window.initAIModalFull = initializeAIModalFull;
  window.forceLoadModalContent = forceLoadModalContent;



})();
