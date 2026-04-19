/**
 * priority-theme.js — single source of truth for priority colors.
 * Reads CSS variables --prio-1..4 from :root. User-customization (W2) writes
 * the variables and persists to localStorage; this module applies them on load.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "priority_colors_v1";
  // Harmonized palette — distinct hues evenly spaced across the wheel for quick scanning.
  // Thấp → Rất cao: teal (calm) → indigo (neutral) → amber (warning) → rose (critical).
  const DEFAULTS = {
    1: "#14B8A6",
    2: "#6366F1",
    3: "#F59E0B",
    4: "#E11D48",
  };
  const LABELS = {
    1: "Thấp",
    2: "Trung bình",
    3: "Cao",
    4: "Rất cao",
  };
  const CLASS_NAMES = {
    1: "low",
    2: "medium",
    3: "high",
    4: "very-high",
  };

  function readVar(priority) {
    const name = `--prio-${priority}`;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || DEFAULTS[priority] || DEFAULTS[2];
  }

  function writeVar(priority, hex) {
    document.documentElement.style.setProperty(`--prio-${priority}`, hex);
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function applyStored() {
    const stored = loadStored();
    if (!stored) return;
    [1, 2, 3, 4].forEach((p) => {
      if (stored[p] && /^#[0-9A-Fa-f]{6}$/.test(stored[p])) {
        writeVar(p, stored[p]);
      }
    });
  }

  function applyAll(colors) {
    if (!colors) return;
    [1, 2, 3, 4].forEach((p) => {
      if (colors[p] && /^#[0-9A-Fa-f]{6}$/.test(colors[p])) {
        writeVar(p, colors[p]);
      }
    });
  }

  function persistLocal(colors) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    } catch (_) {}
  }

  async function fetchFromServer() {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return null;
      const r = await fetch("/api/users/priority-colors", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.success ? j.data : null;
    } catch (_) {
      return null;
    }
  }

  async function saveToServer(colors) {
    try {
      const token = localStorage.getItem("auth_token");
      if (!token) return { ok: false, message: "Chưa đăng nhập" };
      const r = await fetch("/api/users/priority-colors", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(colors),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        return { ok: false, message: j?.message || "Lưu thất bại" };
      }
      return { ok: true, data: j.data };
    } catch (e) {
      return { ok: false, message: "Lỗi kết nối" };
    }
  }

  const PriorityTheme = {
    getColor(priority) {
      const p = parseInt(priority, 10);
      return readVar(p || 2);
    },

    getLabel(priority) {
      const p = parseInt(priority, 10);
      return LABELS[p] || LABELS[2];
    },

    getClassName(priority) {
      const p = parseInt(priority, 10);
      return CLASS_NAMES[p] || CLASS_NAMES[2];
    },

    /** Apply + persist locally. Does NOT sync to server — use saveAll for that. */
    setColor(priority, hex) {
      const p = parseInt(priority, 10);
      if (!DEFAULTS[p]) return false;
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false;

      writeVar(p, hex);
      const stored = loadStored() || {};
      stored[p] = hex;
      persistLocal(stored);
      document.dispatchEvent(
        new CustomEvent("priority-colors-changed", { detail: { priority: p, hex } })
      );
      return true;
    },

    /**
     * Save full palette to server + local. Caller decides whether to reload page.
     * @param {{1:string,2:string,3:string,4:string}} colors
     */
    async saveAll(colors) {
      // Apply immediately for instant feedback.
      applyAll(colors);
      persistLocal(colors);
      document.dispatchEvent(
        new CustomEvent("priority-colors-changed", { detail: { bulk: true } })
      );
      // Sync to server (per-user, cross-device).
      return await saveToServer(colors);
    },

    resetAll() {
      localStorage.removeItem(STORAGE_KEY);
      [1, 2, 3, 4].forEach((p) => writeVar(p, DEFAULTS[p]));
      document.dispatchEvent(new CustomEvent("priority-colors-changed", { detail: { reset: true } }));
    },

    getAll() {
      return { 1: this.getColor(1), 2: this.getColor(2), 3: this.getColor(3), 4: this.getColor(4) };
    },

    getDefaults() {
      return { ...DEFAULTS };
    },

    /** Called by app bootstrap after login is known. Refreshes from server. */
    async syncFromServer() {
      const remote = await fetchFromServer();
      if (remote) {
        applyAll(remote);
        persistLocal(remote);
        document.dispatchEvent(new CustomEvent("priority-colors-changed", { detail: { synced: true } }));
      }
    },
  };

  // Apply local storage immediately so first paint uses user colors.
  applyAll(loadStored());

  /**
   * Always-available entry point to open the Priority Manager modal.
   * Works regardless of whether the modal HTML has finished loading: lazy-loads it first.
   */
  window.__openPriorityManager = async function () {
    const container = document.getElementById("priorityManagerModal");
    const isEmpty = !container || container.children.length === 0;

    if (isEmpty && window.ComponentLoader?.loadComponent) {
      try {
        await window.ComponentLoader.loadComponent(
          "priorityManagerModal",
          "components/modals/priority-manager-modal.html",
          { executeScripts: true }
        );
        await new Promise((r) => setTimeout(r, 80));
      } catch (e) {
        console.error("Không load được Priority Manager modal:", e);
      }
    }

    if (typeof window.openPriorityManager === "function") {
      window.openPriorityManager();
    } else if (window.ModalManager?.showModalById) {
      window.ModalManager.showModalById("priorityManagerModal");
    } else {
      alert("Không mở được Quản lý độ ưu tiên. Xem console.");
    }
  };

  // Sync from server after DOM loads (token available after login redirects).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => PriorityTheme.syncFromServer());
  } else {
    setTimeout(() => PriorityTheme.syncFromServer(), 0);
  }

  window.PriorityTheme = PriorityTheme;
})();
