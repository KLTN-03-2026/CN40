// Pomodoro Sessions API — record and retrieve focus/break sessions.
// All routes under /api/pomodoro, authenticated via authenticateToken middleware.
//   POST /sessions   — record a completed or abandoned session
//   GET  /sessions   — list recent sessions (optional ?taskId= filter), limit 50
//   GET  /stats      — aggregate stats: today focus minutes, today session count, all-time count

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// Helper: extract userId from request (auth middleware sets req.user or req.userId)
function getUserId(req) {
  return req.user?.UserID ?? req.userId;
}

// Helper: start of today in UTC (ISO string)
function todayStartUTC() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

// POST /sessions — record a Pomodoro session
// Body: { taskId?, durationMinutes, completed, sessionType }
router.post("/sessions", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { taskId, durationMinutes, completed, sessionType } = req.body || {};

    // Validate required fields
    if (typeof durationMinutes !== "number" || durationMinutes < 1 || durationMinutes > 120) {
      return res.status(400).json({ success: false, message: "durationMinutes phải là số từ 1–120." });
    }
    const validTypes = ["focus", "short_break", "long_break"];
    if (!validTypes.includes(sessionType)) {
      return res.status(400).json({ success: false, message: `sessionType không hợp lệ. Phải là: ${validTypes.join(", ")}` });
    }

    const row = {
      UserID: userId,
      ThoiLuongPhut: durationMinutes,
      DaHoanThanh: completed === true,
      LoaiPhien: sessionType,
    };
    // Only attach task FK when provided and is a valid integer
    if (taskId != null) {
      const parsed = parseInt(taskId, 10);
      if (!isNaN(parsed)) row.MaCongViec = parsed;
    }

    const { data, error } = await supabase
      .from("PomodoroSessions")
      .insert(row)
      .select("SessionID, BatDau")
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("POST /pomodoro/sessions:", err);
    res.status(500).json({ success: false, message: "Lỗi lưu phiên Pomodoro." });
  }
});

// GET /sessions — list recent sessions for authenticated user
// Query: ?taskId=<number> (optional filter by task)
router.get("/sessions", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { taskId } = req.query;

    let query = supabase
      .from("PomodoroSessions")
      .select("SessionID, MaCongViec, BatDau, ThoiLuongPhut, DaHoanThanh, LoaiPhien")
      .eq("UserID", userId)
      .order("BatDau", { ascending: false })
      .limit(50);

    if (taskId != null) {
      const parsed = parseInt(taskId, 10);
      if (!isNaN(parsed)) {
        query = query.eq("MaCongViec", parsed);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("GET /pomodoro/sessions:", err);
    res.status(500).json({ success: false, message: "Lỗi tải danh sách phiên." });
  }
});

// GET /stats — aggregate Pomodoro stats for current user
// Returns: { todayFocusMinutes, todaySessionCount, allTimeSessionCount }
router.get("/stats", async (req, res) => {
  try {
    const userId = getUserId(req);
    const todayStart = todayStartUTC();

    // Run today query and all-time count in parallel
    const [todayResult, allTimeResult] = await Promise.all([
      supabase
        .from("PomodoroSessions")
        .select("ThoiLuongPhut, LoaiPhien")
        .eq("UserID", userId)
        .eq("DaHoanThanh", true)
        .gte("BatDau", todayStart),
      supabase
        .from("PomodoroSessions")
        .select("SessionID", { count: "exact", head: true })
        .eq("UserID", userId),
    ]);

    if (todayResult.error) throw todayResult.error;
    if (allTimeResult.error) throw allTimeResult.error;

    const todaySessions = todayResult.data || [];
    const focusSessions = todaySessions.filter((s) => s.LoaiPhien === "focus");
    const todayFocusMinutes = focusSessions.reduce((sum, s) => sum + (s.ThoiLuongPhut || 0), 0);

    res.json({
      success: true,
      data: {
        todayFocusMinutes,
        todaySessionCount: focusSessions.length,
        allTimeSessionCount: allTimeResult.count ?? 0,
      },
    });
  } catch (err) {
    console.error("GET /pomodoro/stats:", err);
    res.status(500).json({ success: false, message: "Lỗi tải thống kê Pomodoro." });
  }
});

module.exports = router;
