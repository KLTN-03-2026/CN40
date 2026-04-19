(function () {
  "use strict";

  function absoluteFixModalDimensions() {
    const modal = document.getElementById("aiSuggestionModal");
    if (!modal) {
      return false;
    }

    const content = modal.querySelector(".modal-content");
    if (!content) {
      return false;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const modalWidth = Math.min(800, viewportWidth * 0.9);
    const modalHeight = Math.min(600, viewportHeight * 0.9);

    content.style.width = `${modalWidth}px`;
    content.style.height = `${modalHeight}px`;
    content.style.maxWidth = "none";
    content.style.maxHeight = "none";
    content.style.minWidth = "0";
    content.style.minHeight = "0";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.overflow = "hidden";
    content.style.background = "white";
    content.style.borderRadius = "12px";
    content.style.boxShadow = "0 20px 60px rgba(0, 0, 0, 0.3)";
    content.style.position = "relative";
    content.style.zIndex = "10001";

    const header = content.querySelector(".ai-modal-header");
    const body = content.querySelector(".ai-modal-body");
    const footer = content.querySelector(".ai-modal-footer");

    if (header) {
      header.style.height = "80px";
      header.style.minHeight = "80px";
      header.style.maxHeight = "80px";
      header.style.flexShrink = "0";
      header.style.display = "flex";
      header.style.width = "100%";
    }

    if (footer) {
      footer.style.height = "80px";
      footer.style.minHeight = "80px";
      footer.style.maxHeight = "80px";
      footer.style.flexShrink = "0";
      footer.style.display = "flex";
      footer.style.width = "100%";
    }

    if (body) {
      const bodyHeight = modalHeight - 80 - 80;
      body.style.height = `${bodyHeight}px`;
      body.style.minHeight = `${bodyHeight}px`;
      body.style.flex = "none";
      body.style.display = "block";
      body.style.overflowY = "auto";
      body.style.width = "100%";
      body.style.padding = "24px";
    }

    void content.offsetHeight;

    return true;
  }

  window.addEventListener("modalOpened", (e) => {
    if (e.detail?.modalId === "aiSuggestionModal") {
      setTimeout(() => absoluteFixModalDimensions(), 100);
      setTimeout(() => absoluteFixModalDimensions(), 300);
      setTimeout(() => absoluteFixModalDimensions(), 500);
    }
  });

  window.addEventListener("modalShown", (e) => {
    if (e.detail?.modalId === "aiSuggestionModal") {
      setTimeout(() => absoluteFixModalDimensions(), 100);
    }
  });

  window.absoluteFixModalDimensions = absoluteFixModalDimensions;
})();
