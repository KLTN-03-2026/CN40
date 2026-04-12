(function () {
  "use strict";

  function forceModalContentDisplay(modalId) {


    const modal = document.getElementById(modalId);
    if (!modal) {
      console.error(` Modal ${modalId} not found`);
      return false;
    }

    const content = modal.querySelector(".modal-content");
    if (!content) {
      console.error(` .modal-content not found in ${modalId}`);
      return false;
    }



    content.style.cssText = `
      display: flex !important;
      flex-direction: column !important;
      width: 800px !important;
      max-width: 90vw !important;
      min-width: 600px !important;
      min-height: 400px !important;
      max-height: 90vh !important;
      background: var(--np-bg-card, #faf7f2) !important;
      border: 1.5px solid var(--np-border, #1a1a1a) !important;
      border-radius: var(--np-radius, 2px) !important;
      box-shadow: var(--np-shadow, 4px 4px 0 #1a1a1a) !important;
      overflow: hidden !important;
      position: relative !important;
      z-index: 10001 !important;
      opacity: 1 !important;
      visibility: visible !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      margin: 0 auto !important;
    `;

    const header = content.querySelector(".ai-modal-header");
    const body = content.querySelector(".ai-modal-body");
    const footer = content.querySelector(".ai-modal-footer");

    if (header) {
      header.style.cssText = `
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        min-height: 80px !important;
        padding: 20px 24px !important;
        width: 100% !important;
        flex-shrink: 0 !important;
      `;
    }

    if (body) {
      body.style.cssText = `
        display: block !important;
        flex: 1 !important;
        min-height: 300px !important;
        padding: 24px !important;
        width: 100% !important;
        overflow-y: auto !important;
      `;
    }

    if (footer) {
      footer.style.cssText = `
        display: flex !important;
        justify-content: space-between !important;
        min-height: 80px !important;
        padding: 20px 24px !important;
        width: 100% !important;
        flex-shrink: 0 !important;
      `;
    }

    void content.offsetHeight;

    setTimeout(() => {


      if (content.offsetWidth === 0 || content.offsetHeight === 0) {
        console.error(" STILL 0x0! Last resort...");

        const parent = content.parentElement;
        const clone = content.cloneNode(true);
        clone.style.cssText = content.style.cssText;
        parent.replaceChild(clone, content);


      } else {

      }
    }, 100);

    return true;
  }

  window.addEventListener("modalOpened", (e) => {
    if (e.detail?.modalId === "aiSuggestionModal") {


      setTimeout(() => forceModalContentDisplay("aiSuggestionModal"), 50);
      setTimeout(() => forceModalContentDisplay("aiSuggestionModal"), 200);
      setTimeout(() => forceModalContentDisplay("aiSuggestionModal"), 500);
    }
  });

  window.addEventListener("modalShown", (e) => {
    if (e.detail?.modalId === "aiSuggestionModal") {

      setTimeout(() => forceModalContentDisplay("aiSuggestionModal"), 50);
    }
  });

  window.forceAIModalDisplay = () => {
    return forceModalContentDisplay("aiSuggestionModal");
  };



  window.addEventListener("load", () => {
    setTimeout(() => {
      const modal = document.getElementById("aiSuggestionModal");
      if (modal && !modal.classList.contains("hidden")) {

        forceModalContentDisplay("aiSuggestionModal");
      }
    }, 1000);
  });
})();
