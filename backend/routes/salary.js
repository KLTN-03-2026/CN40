/**
 * salary.js
 * GET /api/salary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Sources hours from task_instances (status='completed') with fallback to legacy LichTrinh.
 * Returns: { totalHours, totalSalary, perTask, perCategory, timeline, entries }
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// Module-level flag: warn once about missing task_instances table
let _instancesTableMissingWarned = false;

function isInstancesTableMissing(error) {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    (error.message && error.message.includes("task_instances"))
  );
}

function warnInstancesTableMissing() {
  if (!_instancesTableMissingWarned) {
    _instancesTableMissingWarned = true;
    console.warn(
      "[instances] table missing — using LichTrinh fallback; run migrations/001_add_task_instances.sql"
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTwo(n) {
  return Math.round(n * 100) / 100;
}

/** Compute hours from two ISO timestamps. Returns 0 if invalid. */
function computeHours(startIso, endIso, fallbackMinutes) {
  if (startIso && endIso) {
    const diff = new Date(endIso) - new Date(startIso);
    if (!isNaN(diff) && diff > 0) return roundTwo(diff / 3_600_000);
  }
  if (fallbackMinutes > 0) return roundTwo(fallbackMinutes / 60);
  return 0;
}

/** YYYY-MM-DD from an ISO string. */
function toDateStr(iso) {
  return iso ? iso.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// GET /api/salary
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { from, to } = req.query;

    const endDate = to ? new Date(to + "T23:59:59Z") : new Date();
    const startDate = from
      ? new Date(from + "T00:00:00Z")
      : new Date(endDate.getTime() - 30 * 24 * 3_600_000);

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    // -----------------------------------------------------------------------
    // 1. task_instances (primary source, Phase 03)
    // -----------------------------------------------------------------------
    const { data: instances, error: instErr } = await supabase
      .from("task_instances")
      .select(
        "id, task_id, start_at, end_at, note, status, " +
          "CongViec:task_id(MaCongViec, TieuDe, LuongTheoGio, ThoiGianUocTinh, MaLoai, LoaiCongViec(TenLoai))"
      )
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("end_at", startIso)
      .lte("end_at", endIso)
      .order("end_at", { ascending: false });

    if (instErr && isInstancesTableMissing(instErr)) {
      // Silent fallback — table not yet migrated, no scary log
      warnInstancesTableMissing();
    } else if (instErr) {
      console.error("Salary task_instances error:", instErr);
    }

    // -----------------------------------------------------------------------
    // 2. Legacy LichTrinh fallback
    //    Used when: table missing (PGRST205) OR no instance rows found
    // -----------------------------------------------------------------------
    let legacyRecords = [];
    if (instErr || (!instances || instances.length === 0)) {
      const { data: legacy, error: legErr } = await supabase
        .from("LichTrinh")
        .select(
          "MaLichTrinh, GioBatDau, GioKetThuc, GhiChu, MaCongViec, " +
            "CongViec(MaCongViec, TieuDe, LuongTheoGio, ThoiGianUocTinh, MaLoai, LoaiCongViec(TenLoai))"
        )
        .eq("UserID", userId)
        .eq("DaHoanThanh", true)
        .gte("GioKetThuc", startIso)
        .lte("GioKetThuc", endIso)
        .order("GioKetThuc", { ascending: false });

      if (!legErr) legacyRecords = legacy || [];
    }

    // -----------------------------------------------------------------------
    // 3. Normalize to unified entry shape
    // -----------------------------------------------------------------------
    const entries = [];

    (instances || []).forEach((inst) => {
      const cv = inst.CongViec || {};
      const rate = cv.LuongTheoGio ? parseFloat(cv.LuongTheoGio) : 0;
      const hours = computeHours(inst.start_at, inst.end_at, cv.ThoiGianUocTinh);
      const amount = roundTwo(hours * rate);
      const categoryId = cv.MaLoai || null;
      const categoryName = cv.LoaiCongViec?.TenLoai || null;

      entries.push({
        id: `ti_${inst.id}`,
        taskId: inst.task_id || null,
        title: cv.TieuDe || "(Không có tiêu đề)",
        date: inst.end_at || inst.start_at,
        rate,
        hours,
        amount,
        note: inst.note || "",
        categoryId,
        categoryName,
        source: "task_instances",
      });
    });

    legacyRecords.forEach((r) => {
      const cv = r.CongViec || {};
      const rate = cv.LuongTheoGio ? parseFloat(cv.LuongTheoGio) : 0;
      const hours = computeHours(r.GioBatDau, r.GioKetThuc, cv.ThoiGianUocTinh);
      const amount = roundTwo(hours * rate);
      const categoryId = cv.MaLoai || null;
      const categoryName = cv.LoaiCongViec?.TenLoai || null;

      entries.push({
        id: `lt_${r.MaLichTrinh}`,
        taskId: r.MaCongViec || null,
        title: cv.TieuDe || "(Không có tiêu đề)",
        date: r.GioKetThuc || r.GioBatDau,
        rate,
        hours,
        amount,
        note: r.GhiChu || "",
        categoryId,
        categoryName,
        source: "lichTrinh",
      });
    });

    // -----------------------------------------------------------------------
    // 4. Aggregations
    // -----------------------------------------------------------------------
    const totalHours = roundTwo(entries.reduce((s, e) => s + e.hours, 0));
    const totalSalary = roundTwo(entries.reduce((s, e) => s + e.amount, 0));

    // Days between start and end (inclusive, minimum 1)
    const dayCount = Math.max(
      1,
      Math.round((endDate - startDate) / (24 * 3_600_000))
    );
    const avgPerDay = roundTwo(totalSalary / dayCount);

    // Per-task rollup (deduplicate by taskId + title)
    const taskMap = new Map();
    entries.forEach((e) => {
      const key = e.taskId ? `task_${e.taskId}` : `title_${e.title}`;
      if (!taskMap.has(key)) {
        taskMap.set(key, {
          taskId: e.taskId,
          title: e.title,
          categoryId: e.categoryId,
          categoryName: e.categoryName,
          hours: 0,
          salary: 0,
          rate: e.rate,
          count: 0,
        });
      }
      const t = taskMap.get(key);
      t.hours = roundTwo(t.hours + e.hours);
      t.salary = roundTwo(t.salary + e.amount);
      t.count += 1;
    });
    const perTask = [...taskMap.values()].sort((a, b) => b.hours - a.hours);

    // Top task by hours
    const topTask = perTask.length > 0 ? perTask[0] : null;

    // Per-category rollup
    const catMap = new Map();
    entries.forEach((e) => {
      const key = e.categoryId || "none";
      if (!catMap.has(key)) {
        catMap.set(key, {
          categoryId: e.categoryId,
          categoryName: e.categoryName || "Chưa phân loại",
          hours: 0,
          salary: 0,
        });
      }
      const c = catMap.get(key);
      c.hours = roundTwo(c.hours + e.hours);
      c.salary = roundTwo(c.salary + e.amount);
    });
    const perCategory = [...catMap.values()].sort((a, b) => b.hours - a.hours);

    // Daily timeline
    const dayMap = new Map();
    entries.forEach((e) => {
      const d = toDateStr(e.date);
      if (!d) return;
      if (!dayMap.has(d)) dayMap.set(d, { date: d, hours: 0, salary: 0 });
      const day = dayMap.get(d);
      day.hours = roundTwo(day.hours + e.hours);
      day.salary = roundTwo(day.salary + e.amount);
    });
    const timeline = [...dayMap.values()].sort((a, b) =>
      a.date < b.date ? -1 : 1
    );

    res.json({
      success: true,
      data: {
        totalHours,
        totalSalary,
        avgPerDay,
        topTask,
        perTask,
        perCategory,
        timeline,
        entries,
      },
    });
  } catch (err) {
    console.error("Salary route error:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
