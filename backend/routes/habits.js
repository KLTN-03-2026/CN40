/**
 * habits.js
 * Express router for /api/habits — CRUD + log + heatmap endpoints.
 * Streak logic delegated to habits-streak-helper.js
 */
const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const { recalculateStreak } = require("../lib/habits-streak-helper");

// ── GET /api/habits — list active habits with today's completion status ──
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const todayStr = new Date().toISOString().split("T")[0];

    const { data: habits, error } = await supabase
      .from("Habits")
      .select("*")
      .eq("UserID", userId)
      .eq("DangHoatDong", true)
      .order("NgayTao", { ascending: true });

    if (error) {
      console.error("Lỗi load habits:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    if (!habits || habits.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const habitIds = habits.map((h) => h.HabitID);
    const { data: todayLogs } = await supabase
      .from("HabitLogs")
      .select("HabitID")
      .in("HabitID", habitIds)
      .eq("NgayHoanThanh", todayStr)
      .eq("DaHoanThanh", true);

    const completedToday = new Set((todayLogs || []).map((l) => l.HabitID));
    const result = habits.map((h) => ({
      ...h,
      completedToday: completedToday.has(h.HabitID),
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Lỗi GET /habits:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── GET /api/habits/stats ──
router.get("/stats", async (req, res) => {
  try {
    const userId = req.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().split("T")[0];

    const { data: habits } = await supabase
      .from("Habits")
      .select("HabitID, Streak")
      .eq("UserID", userId)
      .eq("DangHoatDong", true);

    const totalHabits = (habits || []).length;
    const longestStreak = (habits || []).reduce(
      (max, h) => Math.max(max, h.Streak || 0), 0
    );

    const habitIds = (habits || []).map((h) => h.HabitID);
    let totalCompletionsMonth = 0;
    if (habitIds.length > 0) {
      const { count } = await supabase
        .from("HabitLogs")
        .select("LogID", { count: "exact", head: true })
        .in("HabitID", habitIds)
        .eq("DaHoanThanh", true)
        .gte("NgayHoanThanh", monthStart)
        .lte("NgayHoanThanh", monthEnd);
      totalCompletionsMonth = count || 0;
    }

    res.json({ success: true, data: { totalHabits, totalCompletionsMonth, longestStreak } });
  } catch (err) {
    console.error("Lỗi GET /habits/stats:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── GET /api/habits/:id/heatmap?year=2026 ──
router.get("/:id/heatmap", async (req, res) => {
  try {
    const userId = req.userId;
    const habitId = parseInt(req.params.id);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { data: habit, error: habitErr } = await supabase
      .from("Habits").select("HabitID")
      .eq("HabitID", habitId).eq("UserID", userId).single();

    if (habitErr || !habit) {
      return res.status(404).json({ success: false, message: "Không tìm thấy" });
    }

    const { data: logs, error } = await supabase
      .from("HabitLogs")
      .select("NgayHoanThanh, DaHoanThanh")
      .eq("HabitID", habitId)
      .gte("NgayHoanThanh", `${year}-01-01`)
      .lte("NgayHoanThanh", `${year}-12-31`);

    if (error) {
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const logMap = new Map();
    (logs || []).forEach((l) => logMap.set(l.NgayHoanThanh, l.DaHoanThanh));

    const entries = [];
    const cursor = new Date(`${year}-01-01T00:00:00Z`);
    const limit = new Date(`${year + 1}-01-01T00:00:00Z`);
    while (cursor < limit) {
      const dateStr = cursor.toISOString().split("T")[0];
      entries.push({ date: dateStr, completed: logMap.get(dateStr) ?? false });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({ success: true, data: entries });
  } catch (err) {
    console.error("Lỗi GET /habits/:id/heatmap:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── POST /api/habits — create ──
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { name, icon, frequency, target } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Tên thói quen không được để trống" });
    }

    const freq = ["daily", "weekly"].includes(frequency) ? frequency : "daily";
    const mucTieu = Math.max(1, parseInt(target) || 1);

    const { data, error } = await supabase
      .from("Habits")
      .insert({
        UserID: userId,
        TenThoiQuen: name.trim(),
        BieuTuong: icon || "📌",
        TanSuat: freq,
        MucTieu: mucTieu,
        Streak: 0,
        DangHoatDong: true,
      })
      .select().single();

    if (error) {
      console.error("Lỗi tạo habit:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("Lỗi POST /habits:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── PUT /api/habits/:id — update ──
router.put("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const habitId = parseInt(req.params.id);
    const { name, icon, frequency, target } = req.body;

    const updates = {};
    if (name !== undefined) updates.TenThoiQuen = name.trim();
    if (icon !== undefined) updates.BieuTuong = icon;
    if (frequency !== undefined && ["daily", "weekly"].includes(frequency)) {
      updates.TanSuat = frequency;
    }
    if (target !== undefined) updates.MucTieu = Math.max(1, parseInt(target) || 1);

    const { data, error } = await supabase
      .from("Habits").update(updates)
      .eq("HabitID", habitId).eq("UserID", userId)
      .select().single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Không tìm thấy hoặc lỗi cập nhật" });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi PUT /habits/:id:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── DELETE /api/habits/:id — soft delete ──
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const habitId = parseInt(req.params.id);

    const { error } = await supabase
      .from("Habits").update({ DangHoatDong: false })
      .eq("HabitID", habitId).eq("UserID", userId);

    if (error) {
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    res.json({ success: true, message: "Đã xóa thói quen" });
  } catch (err) {
    console.error("Lỗi DELETE /habits/:id:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── POST /api/habits/:id/log — upsert log + recalc streak ──
router.post("/:id/log", async (req, res) => {
  try {
    const userId = req.userId;
    const habitId = parseInt(req.params.id);
    const { date } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: "Ngày không hợp lệ (YYYY-MM-DD)" });
    }

    const { data: habit, error: habitErr } = await supabase
      .from("Habits").select("HabitID, TenThoiQuen, BieuTuong")
      .eq("HabitID", habitId).eq("UserID", userId).single();

    if (habitErr || !habit) {
      return res.status(404).json({ success: false, message: "Không tìm thấy" });
    }

    const { error: logErr } = await supabase
      .from("HabitLogs")
      .upsert(
        { HabitID: habitId, NgayHoanThanh: date, DaHoanThanh: true },
        { onConflict: "HabitID,NgayHoanThanh" }
      );

    if (logErr) {
      console.error("Lỗi upsert HabitLog:", logErr);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const streak = await recalculateStreak(habitId);
    await supabase.from("Habits").update({ Streak: streak }).eq("HabitID", habitId);

    // Sync with LichTrinh: mark matching schedule event as completed
    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;
    const { data: scheduleEvents } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh")
      .eq("UserID", userId)
      .eq("DaHoanThanh", false)
      .ilike("TieuDe", `%${habit.TenThoiQuen}%`)
      .gte("GioBatDau", startOfDay)
      .lte("GioBatDau", endOfDay);

    if (scheduleEvents?.length > 0) {
      const ids = scheduleEvents.map((e) => e.MaLichTrinh);
      await supabase
        .from("LichTrinh")
        .update({ DaHoanThanh: true })
        .in("MaLichTrinh", ids);
    }

    res.json({ success: true, data: { streak } });
  } catch (err) {
    console.error("Lỗi POST /habits/:id/log:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ── DELETE /api/habits/:id/log/:date — remove log + recalc streak ──
router.delete("/:id/log/:date", async (req, res) => {
  try {
    const userId = req.userId;
    const habitId = parseInt(req.params.id);
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: "Ngày không hợp lệ" });
    }

    const { data: habit, error: habitErr } = await supabase
      .from("Habits").select("HabitID, TenThoiQuen")
      .eq("HabitID", habitId).eq("UserID", userId).single();

    if (habitErr || !habit) {
      return res.status(404).json({ success: false, message: "Không tìm thấy" });
    }

    const { error } = await supabase
      .from("HabitLogs").delete()
      .eq("HabitID", habitId).eq("NgayHoanThanh", date);

    if (error) {
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const streak = await recalculateStreak(habitId);
    await supabase.from("Habits").update({ Streak: streak }).eq("HabitID", habitId);

    // Reverse sync: unmark matching schedule events
    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;
    const { data: scheduleEvents } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh")
      .eq("UserID", userId)
      .eq("DaHoanThanh", true)
      .ilike("TieuDe", `%${habit.TenThoiQuen}%`)
      .gte("GioBatDau", startOfDay)
      .lte("GioBatDau", endOfDay);

    if (scheduleEvents?.length > 0) {
      const ids = scheduleEvents.map((e) => e.MaLichTrinh);
      await supabase
        .from("LichTrinh")
        .update({ DaHoanThanh: false })
        .in("MaLichTrinh", ids);
    }

    res.json({ success: true, data: { streak } });
  } catch (err) {
    console.error("Lỗi DELETE /habits/:id/log/:date:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
