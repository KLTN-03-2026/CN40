// ai-module-render.js — extends AIModule with UI rendering helpers:
// showAIModalFallback, handleEventClick.
// Depends on: ai-module.js (must be loaded first)
(function () {
  "use strict";

  const AM = window.AIModule;
  if (!AM) {
    console.error("ai-module-render.js: AIModule not found");
    return;
  }

  // ------------------------------------------------------------------
  // Fallback modal HTML (when ModalManager is unavailable)
  // ------------------------------------------------------------------

  AM.showAIModalFallback = function () {
    document.getElementById("aiSuggestionModal")?.remove();

    const modalHtml = `
      <div class="modal active show" id="aiSuggestionModal" style="display:flex;z-index:10001;">
        <div class="modal-overlay"></div>
        <div class="modal-content">
          <div class="ai-modal-content">
            <div class="ai-modal-header">
              <div class="modal-header-left">
                <div class="modal-icon"><i class="fas fa-robot"></i></div>
                <div class="modal-title">
                  <h3>Trợ lý AI Lập Lịch</h3>
                  <p class="modal-subtitle">AI sẽ giúp bạn sắp xếp công việc thông minh</p>
                </div>
              </div>
              <button class="modal-close" onclick="document.getElementById('aiSuggestionModal').remove()">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="ai-modal-body">
              <div class="loading-state">
                <div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i></div>
                <p>Đang tải danh sách công việc...</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
    document.body.classList.add("modal-open");

    setTimeout(() => {
      if (window.AIHandler && window.AIHandler.populateAIModal) {
        AIHandler.populateAIModal();
      }
    }, 300);
  };

  // ------------------------------------------------------------------
  // Event click handler (AI calendar — read-only toast)
  // ------------------------------------------------------------------

  AM.handleEventClick = function (info) {
    const props       = info.event.extendedProps;
    const isAI        = props.aiSuggested;
    const modalTitle  = isAI ? "Sự kiện do AI đề xuất" : "Sự kiện";
    const startTime   = new Date(info.event.start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const endTime     = new Date(info.event.end).toLocaleTimeString("vi-VN",   { hour: "2-digit", minute: "2-digit" });

    if (window.Utils && Utils.showToast) {
      Utils.showToast(
        `${modalTitle}\n${info.event.title}\n${startTime} - ${endTime}\n${props.reason || props.note || ""}`,
        "info"
      );
    }
  };

  console.log("AI Module Render v1.0 ready");
})();
