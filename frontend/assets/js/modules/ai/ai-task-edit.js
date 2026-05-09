/**
 * ai-task-edit.js
 * Modal controller for the "Tinh chỉnh công việc cho AI" popup in the
 * AI-reference section. Lazy-loads the modal HTML, renders chip groups
 * for enum-like fields, and PUTs updates to /api/tasks/:id.
 *
 * Exposes: window.AITaskEdit = { open(task, onSaved) }
 */
(function () {
  if (window.AITaskEdit) return;

  const MODAL_ID = "aiTaskEditModal";
  const MODAL_PATH = "components/modals/ai-task-edit-modal.html";

  const PRIORITY_OPTIONS = [
    { value: 1, label: "Thấp" },
    { value: 2, label: "Trung bình" },
    { value: 3, label: "Cao" },
    { value: 4, label: "Rất cao" },
  ];
  const LEVEL_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
  const TIME_SLOT_OPTIONS = [
    { value: "1", label: "Sáng" },
    { value: "2", label: "Trưa" },
    { value: "3", label: "Chiều" },
    { value: "4", label: "Tối" },
  ];

  const state = { task: null, onSaved: null, wired: false };

  const $ = (id) => document.getElementById(id);

  async function ensureModalLoaded() {
    let host = document.getElementById(MODAL_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = MODAL_ID;
      host.className = "modal hidden";
      document.body.appendChild(host);
    }
    // Placeholder may exist (index.html) but be empty — load the component
    // content unless already injected. ComponentLoader internally dedupes.
    if (host.dataset.loaded === "true") return;
    await window.ComponentLoader.loadComponent(MODAL_ID, MODAL_PATH, {
      executeScripts: true,
    });
  }

  // Build a chip-group inside `host`. `selected` is compared loosely (String()).
  function renderChipGroup(host, options, selected, onPick) {
    host.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-chip";
      btn.textContent = opt.label;
      btn.dataset.value = String(opt.value);
      if (String(opt.value) === String(selected ?? "")) btn.classList.add("active");
      btn.addEventListener("click", () => {
        // Toggle off if clicking the active chip (= clear the field).
        const wasActive = btn.classList.contains("active");
        host.querySelectorAll(".ai-chip").forEach((c) => c.classList.remove("active"));
        if (!wasActive) btn.classList.add("active");
        onPick(wasActive ? null : opt.value);
      });
      host.appendChild(btn);
    });
  }

  function readChipValue(host) {
    const active = host.querySelector(".ai-chip.active");
    return active ? active.dataset.value : null;
  }

  function wireModalOnce() {
    if (state.wired) return;
    $("aiTaskEditCloseBtn")?.addEventListener("click", close);
    $("aiTaskEditCancelBtn")?.addEventListener("click", close);
    $("aiTaskEditSaveBtn")?.addEventListener("click", save);
    const modal = $(MODAL_ID);
    modal?.querySelector(".modal-overlay")?.addEventListener("click", close);
    state.wired = true;
  }

  function populateForm(task) {
    $("aiTaskEditTitle").value = task.TieuDe || "";
    $("aiTaskEditSubtitle").textContent =
      "Điều chỉnh giúp AI xếp lịch chính xác hơn";
    $("aiTaskEditDuration").value = parseInt(task.ThoiGianUocTinh || 60, 10);
    $("aiTaskEditTag").value = task.Tag || "";
    const picks = {
      priority: task.MucDoUuTien ?? 2,
      complexity: task.MucDoPhucTap ?? null,
      focus: task.MucDoTapTrung ?? null,
      timeslot: task.ThoiDiemThichHop ?? null,
    };
    renderChipGroup($("aiTaskEditPriority"), PRIORITY_OPTIONS, picks.priority, () => {});
    renderChipGroup($("aiTaskEditComplexity"), LEVEL_OPTIONS, picks.complexity, () => {});
    renderChipGroup($("aiTaskEditFocus"), LEVEL_OPTIONS, picks.focus, () => {});
    renderChipGroup($("aiTaskEditTimeSlot"), TIME_SLOT_OPTIONS, picks.timeslot, () => {});
  }

  async function open(task, onSaved) {
    state.task = task;
    state.onSaved = onSaved;
    await ensureModalLoaded();
    wireModalOnce();
    populateForm(task);
    const host = $(MODAL_ID);
    host.classList.remove("hidden");
    host.classList.add("active");
  }

  function close() {
    const host = $(MODAL_ID);
    if (!host) return;
    host.classList.add("hidden");
    host.classList.remove("active");
  }

  async function save() {
    const task = state.task;
    if (!task) return close();
    const taskId = task.MaCongViec || task.ID || task.id;
    const body = {
      TieuDe: $("aiTaskEditTitle").value.trim() || task.TieuDe,
      ThoiGianUocTinh: parseInt($("aiTaskEditDuration").value, 10) || 60,
      MucDoUuTien: parseInt(readChipValue($("aiTaskEditPriority")) || 2, 10),
      MucDoPhucTap: readChipValue($("aiTaskEditComplexity"))
        ? parseInt(readChipValue($("aiTaskEditComplexity")), 10)
        : null,
      MucDoTapTrung: readChipValue($("aiTaskEditFocus"))
        ? parseInt(readChipValue($("aiTaskEditFocus")), 10)
        : null,
      ThoiDiemThichHop: readChipValue($("aiTaskEditTimeSlot")) || null,
      Tag: $("aiTaskEditTag").value.trim(),
    };

    const btn = $("aiTaskEditSaveBtn");
    if (btn) { btn.disabled = true; btn.style.opacity = "0.7"; }
    try {
      const res = await window.Utils.makeRequest(
        `/api/tasks/${taskId}`,
        "PUT",
        body
      );
      if (!res?.success) throw new Error(res?.message || "Không lưu được");
      window.Utils.showToast?.("Đã lưu thay đổi", "success");
      close();
      if (typeof state.onSaved === "function") state.onSaved({ ...task, ...body });
    } catch (err) {
      window.Utils.showToast?.(err.message || "Lưu thất bại", "error");
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
    }
  }

  window.AITaskEdit = { open, close };
})();
