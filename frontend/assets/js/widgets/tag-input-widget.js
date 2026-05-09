/**
 * tag-input-widget.js
 * Reusable tag input widget with autocomplete and inline creation.
 * Usage: TagInputWidget.create('containerId', { onChange, maxTags, existingTags })
 */

window.TagInputWidget = (function () {
  const instances = {};

  function getToken() {
    return localStorage.getItem("auth_token") || "";
  }

  function apiFetch(path, opts = {}) {
    const token = getToken();
    return fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    }).then((r) => r.json());
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function pillHtml(tag) {
    const fg = contrastColor(tag.MauSac || "#3B82F6");
    return `<span class="tag-input-pill" data-tag-id="${tag.TagID}"
      style="background:${tag.MauSac};color:${fg}"
      title="${escHtml(tag.TenTag)}">
      ${escHtml(tag.TenTag)}
      <span class="tag-remove" data-remove-id="${tag.TagID}" aria-label="Xóa tag">×</span>
    </span>`;
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Returns black or white depending on background luminance
  function contrastColor(hex) {
    const c = hex.replace("#", "");
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 160 ? "#1e293b" : "#ffffff";
  }

  function create(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn("[TagInputWidget] Container not found:", containerId);
      return null;
    }

    const maxTags = options.maxTags || 5;
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

    // State
    let selectedTags = []; // [{TagID, TenTag, MauSac}]

    // Build DOM
    container.style.position = "relative";
    container.innerHTML = `
      <div class="tag-input-container" id="${containerId}-input-wrap">
        <input class="tag-input-field" id="${containerId}-field"
          placeholder="Tìm hoặc tạo tag..." autocomplete="off" maxlength="30" />
      </div>
      <div class="tag-autocomplete" id="${containerId}-dropdown"></div>
    `;

    const wrap = container.querySelector(`#${containerId}-input-wrap`);
    const field = container.querySelector(`#${containerId}-field`);
    const dropdown = container.querySelector(`#${containerId}-dropdown`);

    // Click on container → focus input
    wrap.addEventListener("click", (e) => {
      if (!e.target.closest(".tag-remove")) field.focus();
    });

    // Pill remove
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-id]");
      if (!btn) return;
      const id = parseInt(btn.dataset.removeId, 10);
      selectedTags = selectedTags.filter((t) => t.TagID !== id);
      renderPills();
      onChange(getSelectedIds());
    });

    // Autocomplete search (debounced)
    const doSearch = debounce(async (query) => {
      const url = query
        ? `/api/tags?search=${encodeURIComponent(query)}`
        : "/api/tags";
      try {
        const res = await apiFetch(url);
        if (!res.success) return;
        const filtered = (res.data || []).filter(
          (t) => !selectedTags.find((s) => s.TagID === t.TagID)
        );
        renderDropdown(filtered, query);
      } catch (_) {
        hideDropdown();
      }
    }, 200);

    field.addEventListener("input", () => {
      const q = field.value.trim();
      if (q.length === 0) {
        doSearch("");
      } else {
        doSearch(q);
      }
    });

    field.addEventListener("focus", () => doSearch(field.value.trim()));

    field.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = field.value.trim();
        if (!q) return;
        // Try to match existing dropdown item first
        const firstItem = dropdown.querySelector(".tag-autocomplete-item[data-tag-id]");
        if (firstItem) {
          selectTagById(parseInt(firstItem.dataset.tagId, 10), firstItem.dataset.tagName, firstItem.dataset.tagColor);
        } else {
          // Create new tag inline
          await createAndAddTag(q);
        }
      } else if (e.key === "Escape") {
        hideDropdown();
        field.blur();
      } else if (e.key === "Backspace" && field.value === "" && selectedTags.length > 0) {
        selectedTags.pop();
        renderPills();
        onChange(getSelectedIds());
      }
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
      if (!container.contains(e.target)) hideDropdown();
    });

    function renderPills() {
      // Remove existing pills (keep input field)
      wrap.querySelectorAll(".tag-input-pill").forEach((el) => el.remove());
      // Insert pills before input field
      selectedTags.forEach((tag) => {
        field.insertAdjacentHTML("beforebegin", pillHtml(tag));
      });
      // Hide input if at max
      field.style.display = selectedTags.length >= maxTags ? "none" : "";
    }

    function renderDropdown(tags, query) {
      if (!tags.length && !query) {
        hideDropdown();
        return;
      }
      let html = tags
        .map(
          (t) =>
            `<div class="tag-autocomplete-item" data-tag-id="${t.TagID}"
              data-tag-name="${escHtml(t.TenTag)}" data-tag-color="${escHtml(t.MauSac || "#3B82F6")}">
              <span class="tag-color-dot" style="background:${t.MauSac || "#3B82F6"}"></span>
              ${escHtml(t.TenTag)}
            </div>`
        )
        .join("");

      if (query && !tags.find((t) => t.TenTag.toLowerCase() === query.toLowerCase())) {
        html += `<div class="tag-autocomplete-item" data-create-tag="${escHtml(query)}"
          style="color:#dc2626;font-style:italic">
          <span style="font-size:11px;margin-right:4px">+</span> Tạo "<strong>${escHtml(query)}</strong>"
        </div>`;
      }

      dropdown.innerHTML = html;
      dropdown.classList.add("show");

      dropdown.querySelectorAll("[data-tag-id]").forEach((el) => {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectTagById(
            parseInt(el.dataset.tagId, 10),
            el.dataset.tagName,
            el.dataset.tagColor
          );
        });
      });

      dropdown.querySelectorAll("[data-create-tag]").forEach((el) => {
        el.addEventListener("mousedown", async (e) => {
          e.preventDefault();
          await createAndAddTag(el.dataset.createTag);
        });
      });
    }

    function hideDropdown() {
      dropdown.classList.remove("show");
      dropdown.innerHTML = "";
    }

    function selectTagById(id, name, color) {
      if (selectedTags.find((t) => t.TagID === id)) {
        field.value = "";
        hideDropdown();
        return;
      }
      if (selectedTags.length >= maxTags) {
        field.value = "";
        hideDropdown();
        return;
      }
      selectedTags.push({ TagID: id, TenTag: name, MauSac: color || "#3B82F6" });
      field.value = "";
      hideDropdown();
      renderPills();
      onChange(getSelectedIds());
    }

    async function createAndAddTag(name) {
      if (selectedTags.length >= maxTags) return;
      const trimmed = name.trim().slice(0, 30);
      if (!trimmed) return;
      try {
        const res = await apiFetch("/api/tags", {
          method: "POST",
          body: JSON.stringify({ name: trimmed, color: "#3B82F6" }),
        });
        if (res.success && res.data) {
          selectTagById(res.data.TagID, res.data.TenTag, res.data.MauSac);
        } else if (res.success === false && res.message && res.message.includes("tồn tại")) {
          // Tag exists — fetch it and select
          const search = await apiFetch(`/api/tags?search=${encodeURIComponent(trimmed)}`);
          const found = (search.data || []).find(
            (t) => t.TenTag.toLowerCase() === trimmed.toLowerCase()
          );
          if (found) selectTagById(found.TagID, found.TenTag, found.MauSac);
        }
      } catch (err) {
        console.error("[TagInputWidget] createAndAddTag:", err);
      }
    }

    function getSelectedIds() {
      return selectedTags.map((t) => t.TagID);
    }

    function setTags(tagsArray) {
      selectedTags = (tagsArray || [])
        .filter((t) => t && t.TagID)
        .slice(0, maxTags)
        .map((t) => ({ TagID: t.TagID, TenTag: t.TenTag, MauSac: t.MauSac || "#3B82F6" }));
      renderPills();
    }

    function destroy() {
      container.innerHTML = "";
      if (instances[containerId]) delete instances[containerId];
    }

    const api = { getSelectedIds, setTags, destroy };
    instances[containerId] = api;
    return api;
  }

  return { instances, create };
})();
