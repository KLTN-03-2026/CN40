/**
 * schedule-image-upload.js
 * Controller for the "Import lịch từ ảnh" modal.
 * Flow: pick/paste/drop image → Canvas resize → POST parse-schedule-image
 *       → render editable items → Save (bulk POST task-instances)
 *       OR Apply (POST /api/schedule/apply with priority override + dry-run preview).
 *
 * Exposes: window.ScheduleImageUpload = { open, close, init }
 */
(function () {
  if (window.ScheduleImageUpload) return;

  const MAX_EDGE = 1600; // client-side resize target (long edge, px)
  const JPEG_QUALITY = 0.85;
  const MODAL_ID = "scheduleImportModal";
  const MODAL_PATH = "components/modals/schedule-import-modal.html";

  const state = {
    type: "study",
    level: "dai_hoc",
    file: null,
    base64: null,
    mimeType: null,
    items: [],    // flat list from API (kept for Apply-flat path + legacy)
    groups: [],   // grouped by course: [{ title, courseCode, sessions: [...] }]
    warnings: [],
    wiredDom: false,
  };

  const $ = (id) => document.getElementById(id);

  // ---- DOM boot (idempotent) -------------------------------------------
  function init() {
    if (state.wiredDom) return;
    if (!$("scheduleImportDropzone")) return; // modal HTML not loaded yet
    wireEvents();
    state.wiredDom = true;
  }

  async function open() {
    if (!document.getElementById("scheduleImportDropzone")) {
      await window.ComponentLoader.loadComponent(MODAL_ID, MODAL_PATH, {
        executeScripts: true,
      });
      init();
    }
    const host = $(MODAL_ID);
    host.classList.remove("hidden");
    host.classList.add("active");
    resetForNextScan();
  }

  function close() {
    const host = $(MODAL_ID);
    if (!host) return;
    host.classList.add("hidden");
    host.classList.remove("active");
  }

  function resetForNextScan() {
    state.file = null;
    state.base64 = null;
    state.mimeType = null;
    state.items = [];
    state.groups = [];
    state.warnings = [];
    $("scheduleImportThumbWrap")?.classList.add("hidden");
    $("scheduleImportPreview")?.classList.add("hidden");
    $("scheduleImportFooter")?.classList.add("hidden");
    hideStatus();
  }

  // ---- Event wiring ----------------------------------------------------
  function wireEvents() {
    const dz = $("scheduleImportDropzone");
    const fi = $("scheduleImportFileInput");

    dz.addEventListener("click", () => fi.click());
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.style.background = "var(--accent-light)";
      dz.style.borderColor = "var(--accent)";
    });
    const resetDzTone = () => {
      dz.style.background = "var(--bg-card-alt)";
      dz.style.borderColor = "var(--border-hover)";
    };
    dz.addEventListener("dragleave", resetDzTone);
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      resetDzTone();
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFilePicked(f);
    });
    fi.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) handleFilePicked(f);
    });

    // Paste anywhere in document while modal is open
    document.addEventListener("paste", (e) => {
      const host = $(MODAL_ID);
      if (!host || host.classList.contains("hidden")) return;
      const item = [...(e.clipboardData?.items || [])].find((i) =>
        i.type.startsWith("image/")
      );
      if (item) {
        const f = item.getAsFile();
        if (f) handleFilePicked(f);
      }
    });

    $("scheduleImportCloseBtn").addEventListener("click", close);
    $("scheduleImportParseBtn").addEventListener("click", parse);
    $("scheduleImportAddBtn").addEventListener("click", () => {
      addBlankRow();
      renderItems();
    });
    $("scheduleImportRescanBtn").addEventListener("click", resetForNextScan);
    $("scheduleImportSaveBtn").addEventListener("click", save);
    $("scheduleImportApplyBtn").addEventListener("click", applyWithPreview);

    // Type + level sync
    document
      .querySelectorAll('input[name="si-type"]')
      .forEach((r) => r.addEventListener("change", (e) => (state.type = e.target.value)));
    $("scheduleImportLevel").addEventListener(
      "change",
      (e) => (state.level = e.target.value)
    );
  }

  // ---- File handling + resize -----------------------------------------
  async function handleFilePicked(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      showStatus("error", "Định dạng ảnh không hỗ trợ (chỉ JPG/PNG/WEBP)");
      return;
    }
    state.file = file;
    const resized = await resizeImage(file);
    state.base64 = resized.base64;
    state.mimeType = resized.mimeType;

    $("scheduleImportThumb").src = `data:${resized.mimeType};base64,${resized.base64}`;
    $("scheduleImportFileName").textContent = file.name;
    $("scheduleImportFileMeta").textContent =
      `${(resized.bytes / 1024).toFixed(0)} KB sau nén — ${resized.width}×${resized.height}`;
    $("scheduleImportThumbWrap").classList.remove("hidden");
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const mimeType = "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, JPEG_QUALITY);
        const base64 = dataUrl.split(",")[1];
        resolve({
          base64,
          mimeType,
          width: w,
          height: h,
          bytes: Math.floor((base64.length * 3) / 4),
        });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- Parse call -----------------------------------------------------
  function weekWindow() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() + 1); // Monday
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
  }

  async function parse() {
    if (!state.base64) {
      showStatus("error", "Vui lòng chọn ảnh trước");
      return;
    }
    showStatus("loading", "Đang phân tích ảnh…");
    setButtonsDisabled(true);

    const { windowStart, windowEnd } = weekWindow();
    const res = await window.Utils.makeRequest(
      "/api/ai/parse-schedule-image",
      "POST",
      {
        imageBase64: state.base64,
        mimeType: state.mimeType,
        type: state.type,
        windowStart,
        windowEnd,
        forceLevel: state.level,
      }
    );

    setButtonsDisabled(false);

    if (!res || !res.success) {
      showStatus("error", res?.message || "Phân tích thất bại");
      return;
    }
    state.items = res.data.items || [];
    state.warnings = res.data.warnings || [];
    state.groups = buildGroups(state.items);
    hideStatus();
    renderItems();
  }

  // ---- Grouping: 1 course = 1 task, many sessions ---------------------
  // Key = courseCode (preferred) or normalized title. Sessions inherit
  // per-day campus/location/note from the flat parse response.
  function groupKey(it) {
    return (it.courseCode || "").trim() || (it.title || "").trim().toLowerCase();
  }
  function buildGroups(items) {
    const byKey = new Map();
    for (const it of items) {
      const k = groupKey(it);
      if (!byKey.has(k)) {
        byKey.set(k, {
          title: it.title || it.courseCode || "(Không rõ tên)",
          courseCode: it.courseCode || null,
          sessions: [],
        });
      }
      byKey.get(k).sessions.push({
        startAt: it.startAt,
        endAt: it.endAt,
        campus: it.campus || null,
        location: it.location || null,
        note: it.note || null,
      });
    }
    return [...byKey.values()];
  }

  // Rebuild flat items[] from groups (used by Apply path which passes items).
  function flattenGroups(groups) {
    const out = [];
    for (const g of groups) {
      for (const s of g.sessions) {
        out.push({
          title: g.title,
          courseCode: g.courseCode,
          startAt: s.startAt,
          endAt: s.endAt,
          campus: s.campus,
          location: s.location,
          note: s.note,
        });
      }
    }
    return out;
  }

  // ---- Preview rendering (grouped) ------------------------------------
  function renderItems() {
    const tbody = $("scheduleImportTbody");
    tbody.innerHTML = "";

    state.groups.forEach((g, gi) => {
      // Course header row — editable task title
      const headTr = document.createElement("tr");
      headTr.style.background = "var(--bg-card-alt)";
      headTr.innerHTML = `
        <td colspan="5" style="padding:8px 10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <i class="fas fa-book" style="color:var(--accent); font-size:12px;"></i>
            <input data-gi="${gi}" data-f="title"
                   style="flex:1; font-weight:600; font-size:13px; color:var(--text-primary);
                          background:transparent; border:1px solid transparent; padding:4px 6px; border-radius:6px;"
                   value="${escapeAttr(g.title)}">
            <span style="font-size:12px; color:var(--text-muted);">${g.sessions.length} buổi</span>
            <button data-del-group="${gi}" title="Xoá cả môn"
                    style="color:var(--danger); font-size:12px; background:transparent; border:0; cursor:pointer;">
              ✕ Xoá môn
            </button>
          </div>
        </td>`;
      tbody.appendChild(headTr);

      // Session rows under this course
      g.sessions.forEach((s, si) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="padding:4px 10px; color:var(--text-muted); font-size:12px;">Buổi ${si + 1}</td>
          <td style="padding:4px 6px;">
            <input data-gi="${gi}" data-si="${si}" data-f="startAt" type="datetime-local"
                   value="${toLocal(s.startAt)}">
          </td>
          <td style="padding:4px 6px;">
            <input data-gi="${gi}" data-si="${si}" data-f="endAt" type="datetime-local"
                   value="${toLocal(s.endAt)}">
          </td>
          <td style="padding:4px 6px;">
            <input data-gi="${gi}" data-si="${si}" data-f="note"
                   value="${escapeAttr(buildDisplayNote(s))}">
          </td>
          <td style="padding:4px 10px; text-align:right;">
            <button data-del-session="${gi}:${si}"
                    style="color:var(--danger); font-size:12px; background:transparent; border:0; cursor:pointer;">✕</button>
          </td>`;
        tbody.appendChild(tr);
      });
    });

    // Wire edits
    tbody.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const gi = Number(e.target.getAttribute("data-gi"));
        const si = e.target.getAttribute("data-si");
        const f = e.target.getAttribute("data-f");
        const v =
          f === "startAt" || f === "endAt" ? fromLocal(e.target.value) : e.target.value;
        if (si == null) state.groups[gi][f] = v;
        else state.groups[gi].sessions[Number(si)][f] = v;
      });
    });
    tbody.querySelectorAll("[data-del-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const gi = Number(btn.getAttribute("data-del-group"));
        state.groups.splice(gi, 1);
        renderItems();
      });
    });
    tbody.querySelectorAll("[data-del-session]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gi, si] = btn.getAttribute("data-del-session").split(":").map(Number);
        state.groups[gi].sessions.splice(si, 1);
        if (state.groups[gi].sessions.length === 0) state.groups.splice(gi, 1);
        renderItems();
      });
    });

    const totalSessions = state.groups.reduce((n, g) => n + g.sessions.length, 0);
    $("scheduleImportCount").textContent = `${state.groups.length} môn / ${totalSessions} buổi`;
    $("scheduleImportPreview").classList.remove("hidden");
    $("scheduleImportFooter").classList.toggle("hidden", totalSessions === 0);

    const wrap = $("scheduleImportWarnings");
    if (state.warnings.length) {
      wrap.innerHTML = state.warnings.map((w) => `• ${w}`).join("<br>");
      wrap.classList.remove("hidden");
    } else wrap.classList.add("hidden");
  }

  function addBlankRow() {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    state.groups.push({
      title: "",
      courseCode: null,
      sessions: [
        { startAt: now.toISOString(), endAt: end.toISOString(), note: "" },
      ],
    });
  }

  // Duration (minutes) of the first session — used as ThoiGianUocTinh on the
  // task template so the task card shows the real length, not the 60-min default.
  function estimateGroupMinutes(g) {
    const s = g.sessions?.[0];
    if (!s?.startAt || !s?.endAt) return 60;
    const mins = Math.round((new Date(s.endAt) - new Date(s.startAt)) / 60000);
    return mins > 0 ? mins : 60;
  }

  // ---- Save (additive, grouped) ---------------------------------------
  // For each course group: POST /api/tasks once → get taskId →
  // POST /api/task-instances per session with task_id = taskId.
  async function save() {
    const totalSessions = state.groups.reduce((n, g) => n + g.sessions.length, 0);
    if (!totalSessions) return;
    setButtonsDisabled(true);
    showStatus("loading", "Đang lưu…");

    let taskOk = 0;
    let instOk = 0;
    let fail = 0;

    for (const g of state.groups) {
      const taskRes = await window.Utils.makeRequest("/api/tasks", "POST", {
        TieuDe: (g.title || "(Không rõ tên)").trim(),
        MoTa: g.courseCode ? `Mã môn: ${g.courseCode}` : "",
        MucDoUuTien: 2,
        CoThoiGianCoDinh: false,
        ThoiGianUocTinh: estimateGroupMinutes(g),
      });
      const taskId = taskRes?.data?.MaCongViec ?? taskRes?.data?.ID;
      if (!taskRes?.success || !taskId) {
        fail += g.sessions.length;
        continue;
      }
      taskOk++;

      for (const s of g.sessions) {
        const r = await window.Utils.makeRequest(
          "/api/task-instances",
          "POST",
          {
            task_id: taskId,
            start_at: s.startAt,
            end_at: s.endAt,
            note: buildDisplayNote({ ...s, courseCode: g.courseCode }),
          }
        );
        if (r && r.success) instOk++;
        else fail++;
      }
    }

    setButtonsDisabled(false);
    showStatus(
      fail ? "error" : "success",
      `Đã lưu ${taskOk} môn (${instOk}/${totalSessions} buổi)${fail ? ` — ${fail} lỗi` : ""}`
    );
    document.dispatchEvent(new CustomEvent("taskCreated"));
    if (!fail) setTimeout(close, 1200);
  }

  // ---- Apply (priority override, grouped) -----------------------------
  // Create the parent CongViec first, then pass task_id on each item so
  // the server-side priority-override insert links them to one task.
  async function applyWithPreview() {
    const totalSessions = state.groups.reduce((n, g) => n + g.sessions.length, 0);
    if (!totalSessions) return;

    const source = state.type === "study" ? "ocr_study" : "ocr_work";
    setButtonsDisabled(true);
    showStatus("loading", "Đang tạo công việc & kiểm tra trùng giờ…");

    // 1. Create one CongViec per group, gather task_ids.
    const withTaskIds = [];
    const createdTaskIds = [];
    for (const g of state.groups) {
      const taskRes = await window.Utils.makeRequest("/api/tasks", "POST", {
        TieuDe: (g.title || "(Không rõ tên)").trim(),
        MoTa: g.courseCode ? `Mã môn: ${g.courseCode}` : "",
        MucDoUuTien: 2,
        CoThoiGianCoDinh: false,
        ThoiGianUocTinh: estimateGroupMinutes(g),
      });
      const taskId = taskRes?.data?.MaCongViec ?? taskRes?.data?.ID;
      if (!taskRes?.success || !taskId) {
        setButtonsDisabled(false);
        showStatus(
          "error",
          `Tạo công việc "${g.title}" thất bại. Không thể áp dụng.`
        );
        return;
      }
      createdTaskIds.push(taskId);
      for (const s of g.sessions) {
        withTaskIds.push({
          task_id: taskId,
          title: g.title,
          courseCode: g.courseCode,
          startAt: s.startAt,
          endAt: s.endAt,
          campus: s.campus,
          location: s.location,
          note: s.note,
        });
      }
    }

    // 2. Dry-run priority-override preview.
    const dry = await window.Utils.makeRequest("/api/schedule/apply", "POST", {
      source,
      items: withTaskIds,
      dryRun: true,
    });
    setButtonsDisabled(false);
    if (!dry || !dry.success) {
      showStatus("error", dry?.message || "Kiểm tra thất bại");
      return;
    }
    const d = dry.data;
    const ok = await Utils.confirm(
      `Áp dụng ${state.groups.length} môn / ${totalSessions} buổi:<br>` +
        `• Thêm ${d.inserted} buổi mới<br>` +
        `• Xoá ${d.deleted} buổi cũ trùng giờ<br>` +
        `• Bỏ qua ${d.skipped} buổi bị chặn`,
      "Xác nhận áp dụng"
    );
    if (!ok) {
      hideStatus();
      return;
    }

    // 3. Real insert.
    setButtonsDisabled(true);
    showStatus("loading", "Đang áp dụng…");
    const r = await window.Utils.makeRequest("/api/schedule/apply", "POST", {
      source,
      items: withTaskIds,
      dryRun: false,
    });
    setButtonsDisabled(false);
    if (!r || !r.success) {
      showStatus("error", r?.message || "Áp dụng thất bại");
      return;
    }
    showStatus(
      "success",
      `Đã áp dụng: +${r.data.inserted} buổi / -${r.data.deleted} / bỏ qua ${r.data.skipped}`
    );
    document.dispatchEvent(new CustomEvent("taskCreated"));
    setTimeout(close, 1500);
  }

  // ---- Helpers --------------------------------------------------------
  function buildDisplayNote(it) {
    if (it.note && !it.courseCode && !it.campus && !it.location) return it.note;
    const parts = [];
    if (it.courseCode) parts.push(`Mã môn: ${it.courseCode}`);
    if (it.campus) parts.push(`Cơ sở: ${it.campus}`);
    if (it.location) parts.push(`Phòng: ${it.location}`);
    if (it.note) parts.push(it.note);
    return parts.join(" | ");
  }

  function toLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocal(s) {
    if (!s) return null;
    return new Date(s).toISOString();
  }
  function escapeAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function showStatus(kind, msg) {
    const el = $("scheduleImportStatus");
    if (!el) return;
    const base =
      "margin-top:12px;padding:10px 12px;border-radius:8px;font-size:14px;line-height:1.4;";
    const tones = {
      loading:
        "background:var(--accent-light);color:var(--accent);border:1px solid rgba(0,113,227,0.25);",
      success:
        "background:rgba(48,209,88,0.12);color:#0a7d32;border:1px solid rgba(48,209,88,0.25);",
      error:
        "background:rgba(255,59,48,0.1);color:#b00020;border:1px solid rgba(255,59,48,0.25);",
    };
    el.style.cssText = base + (tones[kind] || tones.loading);
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function hideStatus() {
    $("scheduleImportStatus")?.classList.add("hidden");
  }
  function setButtonsDisabled(d) {
    [
      "scheduleImportParseBtn",
      "scheduleImportSaveBtn",
      "scheduleImportApplyBtn",
    ].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = d;
      if (b) b.style.opacity = d ? "0.6" : "1";
    });
  }

  window.ScheduleImageUpload = { open, close, init };
})();
