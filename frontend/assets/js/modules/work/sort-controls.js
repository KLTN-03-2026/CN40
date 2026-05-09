/**
 * Sort-controls: renders a row of 3 chips (Danh mục / Ưu tiên / Thời gian).
 *
 * Interaction model (option B — single criterion at a time):
 *   - Click inactive chip  -> activate with its DEFAULT direction
 *   - Click active chip    -> flip direction (asc <-> desc)
 *   - Click while holding  -> (future) multi-criterion; not implemented
 *
 * Defaults per criterion:
 *   - category: asc   (A -> Z)
 *   - priority: desc  (4 Cao -> 1 Thấp)
 *   - duration: asc   (ngắn -> dài)
 *
 * State persistence: localStorage under opts.storageKey.
 *
 * Usage:
 *   const ctrl = SortControls.mount(containerEl, {
 *     storageKey: "sort.work",
 *     onChange: (state) => rerender(state),
 *   });
 *   ctrl.getState(); // { criterion: "priority" | null, direction: "asc" | "desc" }
 *   ctrl.destroy();
 */
(function () {
  "use strict";
  if (window.SortControls) return;

  const CRITERIA = [
    { key: "category", label: "Danh mục", short: "Loại", icon: "fa-folder", defaultDir: "asc" },
    { key: "priority", label: "Ưu tiên", short: "Ưu tiên", icon: "fa-flag", defaultDir: "desc" },
    { key: "duration", label: "Thời gian", short: "Giờ", icon: "fa-clock", defaultDir: "asc" },
  ];

  function readState(storageKey) {
    if (!storageKey) return { criterion: null, direction: "asc" };
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { criterion: null, direction: "asc" };
      const parsed = JSON.parse(raw);
      const valid = CRITERIA.some((c) => c.key === parsed.criterion);
      return {
        criterion: valid ? parsed.criterion : null,
        direction: parsed.direction === "desc" ? "desc" : "asc",
      };
    } catch {
      return { criterion: null, direction: "asc" };
    }
  }

  function writeState(storageKey, state) {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage full / disabled — silently ignore */
    }
  }

  function chipHTML(c, active, direction, compact) {
    const dirIcon =
      active && direction === "desc"
        ? "fa-arrow-down-wide-short"
        : active
        ? "fa-arrow-up-short-wide"
        : null;
    const bg = active ? "#2563EB" : "#fff";
    const color = active ? "#fff" : "#374151";
    const border = active ? "#2563EB" : "#e2e8f0";
    const label = compact ? c.short : c.label;
    const pad = compact ? "px-2 py-1" : "px-3 py-1.5";
    const gap = compact ? "gap-1" : "gap-1.5";
    const iconSize = compact ? "text-[10px]" : "text-[11px]";
    const dirSpan = dirIcon
      ? `<i class="fas ${dirIcon} text-[9px] opacity-80"></i>`
      : "";
    return `
      <button type="button"
        class="sort-chip flex items-center ${gap} ${pad} rounded-md border text-[11px] font-semibold transition-all select-none"
        data-sort-key="${c.key}"
        aria-pressed="${active ? "true" : "false"}"
        title="${c.label}"
        style="background:${bg};color:${color};border-color:${border};white-space:nowrap">
        <i class="fas ${c.icon} ${iconSize}"></i>
        <span>${label}</span>
        ${dirSpan}
      </button>
    `;
  }

  function rootHTML(state, compact) {
    const chips = CRITERIA.map((c) =>
      chipHTML(c, c.key === state.criterion, state.direction, compact)
    ).join("");
    const resetVisible = state.criterion ? "" : "hidden";
    if (compact) {
      const clearBtn = `
        <button type="button"
          class="sort-clear ${resetVisible} flex items-center justify-center w-6 h-6 rounded-md border"
          style="border-color:#e2e8f0;color:#94a3b8;background:#fff"
          title="Bỏ sắp xếp">
          <i class="fas fa-times text-[10px]"></i>
        </button>`;
      return `
        <div class="sort-controls flex items-center gap-1 flex-nowrap overflow-x-auto">
          ${chips}
          ${clearBtn}
        </div>
      `;
    }
    return `
      <div class="sort-controls flex items-center gap-2 flex-wrap">
        <span class="text-xs font-medium" style="color:#64748b">
          <i class="fas fa-arrow-down-wide-short mr-1"></i>Sắp xếp:
        </span>
        ${chips}
        <button type="button"
          class="sort-clear text-xs underline ${resetVisible}"
          style="color:#64748b"
          title="Bỏ sắp xếp">Mặc định</button>
      </div>
    `;
  }

  function mount(container, opts) {
    if (!container) return null;
    opts = opts || {};
    const storageKey = opts.storageKey || null;
    const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
    const compact = opts.compact === true;

    let state = readState(storageKey);
    container.innerHTML = rootHTML(state, compact);

    function rerender() {
      container.innerHTML = rootHTML(state, compact);
      wire();
    }

    function commit(next) {
      state = next;
      writeState(storageKey, state);
      rerender();
      if (onChange) onChange({ ...state });
    }

    function wire() {
      container.querySelectorAll(".sort-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-sort-key");
          const def = CRITERIA.find((c) => c.key === key);
          if (!def) return;
          if (state.criterion === key) {
            commit({ criterion: key, direction: state.direction === "asc" ? "desc" : "asc" });
          } else {
            commit({ criterion: key, direction: def.defaultDir });
          }
        });
      });
      const clearBtn = container.querySelector(".sort-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          commit({ criterion: null, direction: "asc" });
        });
      }
    }

    wire();

    return {
      getState: () => ({ ...state }),
      setState: (s) => commit({
        criterion: CRITERIA.some((c) => c.key === s?.criterion) ? s.criterion : null,
        direction: s?.direction === "desc" ? "desc" : "asc",
      }),
      destroy: () => { container.innerHTML = ""; },
    };
  }

  window.SortControls = { mount };
})();
