// AI Chat Advisor — floating widget controller.
// Renders a bubble at bottom-right; clicking expands a chat panel.
// Streams Gemini responses via POST SSE (/api/chat-advisor/stream).
// Persists history to DB so it survives reloads.

(function () {
  "use strict";
  if (window.__chatAdvisorBound) return;
  window.__chatAdvisorBound = true;

  const host = document.getElementById("chatAdvisorWidget");
  if (!host) return;

  // Only render the widget for authenticated users.
  const tokenPresent = () => !!localStorage.getItem("auth_token");
  if (!tokenPresent()) {
    // Re-check after auth.js finishes login redirect.
    window.addEventListener("storage", () => { if (tokenPresent()) boot(); }, { once: true });
    return;
  }
  boot();

  function boot() {
    injectStyles();
    renderShell();
    wire();
    preloadHistory();
  }

  // ---------- DOM ---------------------------------------------------------

  function renderShell() {
    host.innerHTML = `
      <button id="cadv-bubble" class="cadv-bubble" title="Cố vấn Công việc">
        <i class="fas fa-comments"></i>
      </button>
      <div id="cadv-panel" class="cadv-panel cadv-hidden">
        <div class="cadv-header">
          <div class="cadv-head-info">
            <div class="cadv-avatar"><i class="fas fa-comments"></i></div>
            <div>
              <div class="cadv-title">Cố vấn Công việc</div>
              <div class="cadv-sub">Tư vấn công việc & sự nghiệp</div>
            </div>
          </div>
          <div class="cadv-actions">
            <button id="cadv-clear" title="Xoá lịch sử"><i class="fas fa-trash"></i></button>
            <button id="cadv-close" title="Đóng"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div id="cadv-messages" class="cadv-messages"></div>
        <div id="cadv-context-pill" class="cadv-context-pill cadv-hidden">
          <i class="fas fa-paperclip"></i>
          <span>Sẽ đính kèm context công việc hiện tại</span>
          <button id="cadv-ctx-cancel" title="Bỏ">×</button>
        </div>
        <div class="cadv-composer">
          <button id="cadv-ctx-btn" class="cadv-ctx-btn" title="Đính kèm context công việc hiện tại">
            <i class="fas fa-paperclip"></i>
          </button>
          <textarea id="cadv-input" rows="1" placeholder="Bạn đang gặp vấn đề gì trong công việc?"></textarea>
          <button id="cadv-send" class="cadv-send" title="Gửi"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>`;
  }

  function injectStyles() {
    if (document.getElementById("cadv-styles")) return;
    const style = document.createElement("style");
    style.id = "cadv-styles";
    style.textContent = `
      .cadv-hidden { display: none !important; }
      .cadv-bubble {
        position: fixed; right: 24px; bottom: 24px; width: 56px; height: 56px;
        border-radius: 50%; border: none; cursor: pointer; z-index: 9998;
        background: var(--accent-gradient, linear-gradient(135deg,#2563EB,#1d4ed8));
        color: #fff; font-size: 22px; box-shadow: 0 10px 25px rgba(37,99,235,0.35);
        transition: transform .15s;
      }
      .cadv-bubble:hover { transform: scale(1.06); }
      .cadv-panel {
        position: fixed; right: 24px; bottom: 92px; width: 380px; max-width: calc(100vw - 32px);
        height: 560px; max-height: calc(100vh - 120px); z-index: 9999;
        background: #fff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        display: flex; flex-direction: column; overflow: hidden;
      }
      .cadv-header {
        padding: 12px 14px; background: var(--accent-gradient, linear-gradient(135deg,#2563EB,#1d4ed8));
        color: #fff; display: flex; justify-content: space-between; align-items: center;
      }
      .cadv-head-info { display: flex; align-items: center; gap: 10px; }
      .cadv-avatar {
        width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,0.2);
        display: flex; align-items: center; justify-content: center; font-size: 16px;
      }
      .cadv-title { font-weight: 600; font-size: 14px; }
      .cadv-sub { font-size: 11px; opacity: .85; }
      .cadv-actions button {
        background: transparent; border: none; color: #fff; opacity: .8;
        width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 13px;
      }
      .cadv-actions button:hover { background: rgba(255,255,255,0.15); opacity: 1; }
      .cadv-messages { flex: 1; overflow-y: auto; padding: 14px; background: #f8fafc; }
      .cadv-msg { margin-bottom: 10px; display: flex; }
      .cadv-msg.user { justify-content: flex-end; }
      .cadv-bubble-msg {
        max-width: 78%; padding: 10px 12px; border-radius: 14px; font-size: 13px; line-height: 1.5;
        white-space: pre-wrap; word-wrap: break-word;
      }
      .cadv-msg.user .cadv-bubble-msg {
        background: var(--accent-gradient, linear-gradient(135deg,#2563EB,#1d4ed8)); color: #fff; border-bottom-right-radius: 4px;
      }
      .cadv-msg.assistant .cadv-bubble-msg {
        background: #fff; color: #334155; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px;
      }
      .cadv-msg.loading .cadv-bubble-msg { opacity: .7; font-style: italic; }
      .cadv-context-pill {
        display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin: 0 12px 8px;
        background: #eff6ff; color: #2563EB; border-radius: 10px; font-size: 12px;
      }
      .cadv-context-pill button {
        margin-left: auto; background: transparent; border: none; color: #2563EB;
        font-size: 16px; cursor: pointer; line-height: 1;
      }
      .cadv-composer {
        display: flex; gap: 6px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff;
      }
      .cadv-composer textarea {
        flex: 1; resize: none; border: 1px solid #e2e8f0; border-radius: 10px;
        padding: 8px 10px; font-size: 13px; max-height: 100px; font-family: inherit;
      }
      .cadv-composer textarea:focus { outline: none; border-color: #2563EB; }
      .cadv-send, .cadv-ctx-btn {
        border: none; cursor: pointer; border-radius: 10px; width: 38px;
        display: flex; align-items: center; justify-content: center; font-size: 13px;
      }
      .cadv-send { background: var(--accent-gradient, linear-gradient(135deg,#2563EB,#1d4ed8)); color: #fff; }
      .cadv-send:disabled { opacity: .5; cursor: not-allowed; }
      .cadv-ctx-btn { background: #f1f5f9; color: #64748b; }
      .cadv-ctx-btn.active { background: #eff6ff; color: #2563EB; }
    `;
    document.head.appendChild(style);
  }

  // ---------- Wiring ------------------------------------------------------

  let attachContext = null; // populated when user taps 📎 and confirms
  let streaming = false;

  function wire() {
    document.getElementById("cadv-bubble").onclick = togglePanel;
    document.getElementById("cadv-close").onclick = togglePanel;
    document.getElementById("cadv-clear").onclick = onClear;
    document.getElementById("cadv-ctx-btn").onclick = onAttachContext;
    document.getElementById("cadv-ctx-cancel").onclick = onCancelContext;
    document.getElementById("cadv-send").onclick = onSend;

    const input = document.getElementById("cadv-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(100, input.scrollHeight) + "px";
    });
  }

  function togglePanel() {
    if (!window.Utils?.requireAuth()) return;
    const p = document.getElementById("cadv-panel");
    const opening = p.classList.contains("cadv-hidden");
    p.classList.toggle("cadv-hidden");
    if (opening) {
      document.getElementById("cadv-input").focus();
      scrollToBottom();
    }
  }

  // ---------- Data --------------------------------------------------------

  async function api(path, opts = {}) {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json;
  }

  async function preloadHistory() {
    try {
      const res = await api("/api/chat-advisor/history");
      const box = document.getElementById("cadv-messages");
      box.innerHTML = "";
      if (!res?.data?.length) {
        renderMsg("assistant", "Chào bạn 👋 Hôm nay bạn muốn mình giúp gì về công việc?");
        return;
      }
      for (const m of res.data) renderMsg(m.Role, m.Content);
      scrollToBottom();
    } catch (err) {
      console.warn("[cadv] history load failed:", err.message);
    }
  }

  async function onAttachContext() {
    if (attachContext) { onCancelContext(); return; }
    try {
      const res = await api("/api/chat-advisor/context-snapshot");
      attachContext = res.data || {};
      document.getElementById("cadv-ctx-btn").classList.add("active");
      document.getElementById("cadv-context-pill").classList.remove("cadv-hidden");
    } catch (err) {
      Utils?.alert?.(err.message, "Lỗi context", "error");
    }
  }

  function onCancelContext() {
    attachContext = null;
    document.getElementById("cadv-ctx-btn").classList.remove("active");
    document.getElementById("cadv-context-pill").classList.add("cadv-hidden");
  }

  async function onClear() {
    if (!await Utils.confirmDanger("Xoá toàn bộ lịch sử chat?", "Xoá lịch sử")) return;
    await api("/api/chat-advisor/history", { method: "DELETE" });
    preloadHistory();
  }

  async function onSend() {
    if (streaming) return;
    const input = document.getElementById("cadv-input");
    const text = (input.value || "").trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";
    renderMsg("user", text);
    const placeholder = renderMsg("assistant", "…");
    placeholder.classList.add("loading");

    const payload = { message: text };
    if (attachContext) payload.attachContext = attachContext;
    const localCtx = attachContext;
    onCancelContext();

    streaming = true;
    setSendDisabled(true);
    try {
      await streamReply(payload, placeholder);
    } catch (err) {
      placeholder.querySelector(".cadv-bubble-msg").textContent = "❌ " + (err.message || "Lỗi");
    } finally {
      streaming = false;
      setSendDisabled(false);
      attachContext = null; // don't resend on next turn
    }
    if (localCtx) onCancelContext();
  }

  async function streamReply(payload, placeholderEl) {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/chat-advisor/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${txt}`);
    }

    const bubble = placeholderEl.querySelector(".cadv-bubble-msg");
    bubble.textContent = "";
    placeholderEl.classList.remove("loading");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.replace(/^data:\s?/, "").trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.chunk) {
            bubble.textContent += obj.chunk;
            scrollToBottom();
          } else if (obj.error) {
            // Append a visible warning so the user knows why the reply ended.
            const note = document.createElement("div");
            note.style.cssText =
              "margin-top:6px;padding:6px 10px;border-radius:8px;" +
              "background:rgba(255,59,48,0.08);color:#b00020;" +
              "font-size:12px;line-height:1.4;";
            note.textContent = `⚠️ ${obj.error}`;
            bubble.appendChild(note);
            scrollToBottom();
          } else if (obj.done) {
            /* final tick */
          }
        } catch (err) {
          console.warn("[cadv] parse chunk failed:", err.message, line);
        }
      }
    }
  }

  // ---------- Render helpers ----------------------------------------------

  function renderMsg(role, text) {
    const box = document.getElementById("cadv-messages");
    const row = document.createElement("div");
    row.className = `cadv-msg ${role === "assistant" ? "assistant" : "user"}`;
    const bubble = document.createElement("div");
    bubble.className = "cadv-bubble-msg";
    bubble.textContent = text;
    row.appendChild(bubble);
    box.appendChild(row);
    scrollToBottom();
    return row;
  }

  function scrollToBottom() {
    const box = document.getElementById("cadv-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function setSendDisabled(d) {
    document.getElementById("cadv-send").disabled = d;
  }
})();
