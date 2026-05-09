const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const { matchShift } = require("../lib/shift-matcher");

// --- Helpers --------------------------------------------------------------
function parseDateRange(query) {
  const end = query.to ? new Date(query.to) : new Date();
  const start = query.from
    ? new Date(query.from)
    : new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  return { start, end };
}

function hoursBetween(startIso, endIso) {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round(((e - s) / 3600000) * 100) / 100; // 2 decimals
}

function monthKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

// --- GET /api/salary?from=YYYY-MM-DD&to=YYYY-MM-DD -----------------------
// Groups completed instances by task, classifies by LoaiLuong, excludes
// zero-amount part-time entries and all 'none' tasks (those belong in Stats).
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { start, end } = parseDateRange(req.query);

    // 1. Completed schedule rows in range (LichTrinh is the active table;
    //    task_instances is optional and may lag behind completion writes).
    const { data: schedules, error: instErr } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, GhiChu, DaHoanThanh")
      .eq("UserID", userId)
      .eq("DaHoanThanh", true)
      .gte("GioKetThuc", start.toISOString())
      .lte("GioKetThuc", end.toISOString())
      .order("GioKetThuc", { ascending: false });

    if (instErr) {
      console.error("[salary] LichTrinh query failed:", instErr);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    // Normalize to a uniform row shape downstream expects
    const rows = (schedules || []).map((r) => ({
      id: r.MaLichTrinh,
      task_id: r.MaCongViec,
      start_at: r.GioBatDau,
      end_at: r.GioKetThuc,
      note: r.GhiChu || "",
    }));
    const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];

    // 2. Batch-fetch parent CongViec rows (salary columns incl. CauHinhCa)
    let taskMap = {};
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from("CongViec")
        .select(
          "MaCongViec, TieuDe, LuongTheoGio, LoaiLuong, LuongThang, CauHinhCa, NgayLamViec, NgayBatDauHopDong, NgayKetThucHopDong"
        )
        .in("MaCongViec", taskIds)
        .eq("UserID", userId);
      (tasks || []).forEach((t) => {
        taskMap[t.MaCongViec] = t;
      });
    }

    // 3. Adjustments for any full-time task, per month in range
    const fullTimeIds = Object.values(taskMap)
      .filter((t) => t.LoaiLuong === "full_time")
      .map((t) => t.MaCongViec);
    const monthsInRange = new Set();
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      monthsInRange.add(monthKey(d.toISOString()));
    }
    const adjByKey = {};
    if (fullTimeIds.length > 0 && monthsInRange.size > 0) {
      const { data: adj } = await supabase
        .from("DieuChinhLuong")
        .select("MaDieuChinh, MaCongViec, Thang, SoTien, LyDo")
        .in("MaCongViec", fullTimeIds)
        .in("Thang", Array.from(monthsInRange));
      (adj || []).forEach((a) => {
        const k = `${a.MaCongViec}|${a.Thang}`;
        (adjByKey[k] ??= []).push(a);
      });
    }

    // 4. Group instances by task
    const groups = new Map();
    let totalHours = 0;

    for (const inst of rows) {
      if (!inst.task_id) continue;
      const task = taskMap[inst.task_id];
      if (!task) continue;

      const loai = task.LoaiLuong || "none";
      if (loai === "none") continue; // excluded from salary view

      let g = groups.get(inst.task_id);
      if (!g) {
        g = {
          task_id: inst.task_id,
          title: task.TieuDe,
          type: loai,
          rate: Number(task.LuongTheoGio) || 0,
          LuongThang: Number(task.LuongThang) || 0,
          CauHinhCa: task.CauHinhCa || null,
          NgayLamViec: task.NgayLamViec || null,
          NgayBatDauHopDong: task.NgayBatDauHopDong || null,
          NgayKetThucHopDong: task.NgayKetThucHopDong || null,
          entries: [],
          workedDates: new Set(),
          adjustments: [],
          subtotal: 0,
          shiftCount: 0,
        };
        groups.set(inst.task_id, g);
      }

      const h = hoursBetween(inst.start_at, inst.end_at);
      const amount =
        loai === "part_time" ? Math.round(h * g.rate) : 0; // full-time uses LuongThang

      // Filter zero-amount part-time entries (per spec)
      if (loai === "part_time" && amount <= 0) continue;

      // Compute shift_name on the fly for part-time (LichTrinh has no meta column)
      const shiftName =
        loai === "part_time" && Array.isArray(g.CauHinhCa)
          ? matchShift(inst.start_at, g.CauHinhCa)
          : null;

      g.entries.push({
        id: inst.id,
        date: dateKey(inst.end_at),
        start_at: inst.start_at,
        end_at: inst.end_at,
        hours: h,
        rate: g.rate,
        shift_name: shiftName,
        note: inst.note || "",
        amount,
      });
      g.workedDates.add(dateKey(inst.end_at));
      if (loai === "part_time") {
        g.subtotal += amount;
        g.shiftCount += 1;
      }
      totalHours += h;
    }

    // 5. Finalize full-time groups (LuongThang + adjustments per month)
    for (const g of groups.values()) {
      if (g.type !== "full_time") continue;
      const monthSubtotals = {};
      for (const m of monthsInRange) {
        const deltas = adjByKey[`${g.task_id}|${m}`] || [];
        const delta = deltas.reduce((s, a) => s + Number(a.SoTien || 0), 0);
        monthSubtotals[m] = g.LuongThang + delta;
        g.adjustments.push(
          ...deltas.map((a) => ({
            id: a.MaDieuChinh,
            month: a.Thang,
            delta: Number(a.SoTien),
            reason: a.LyDo || "",
          }))
        );
      }
      g.monthSubtotals = monthSubtotals;
      g.subtotal = Object.values(monthSubtotals).reduce((s, v) => s + v, 0);
    }

    // 6. Finalize: sets → arrays, drop empty part-time groups
    const groupList = [];
    for (const g of groups.values()) {
      g.workedDates = Array.from(g.workedDates).sort();
      if (g.type === "part_time" && g.entries.length === 0) continue;
      groupList.push(g);
    }

    const totalSalary = groupList.reduce((s, g) => s + g.subtotal, 0);

    // 7. Timeline: daily sum of part-time amounts (for charts)
    const timeline = {};
    for (const g of groupList) {
      if (g.type !== "part_time") continue;
      for (const e of g.entries) {
        timeline[e.date] = (timeline[e.date] || 0) + e.amount;
      }
    }

    res.json({
      success: true,
      data: {
        groups: groupList,
        totalSalary,
        totalHours: Math.round(totalHours * 100) / 100,
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        timeline: Object.entries(timeline)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([date, amount]) => ({ date, amount })),
      },
    });
  } catch (err) {
    console.error("[salary] error:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
