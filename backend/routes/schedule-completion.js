/**
 * schedule-completion.js
 * Bulk-completion endpoints for LichTrinh (calendar events).
 *
 * Mounted at /api/schedule by server.js (auth already applied).
 *
 *   POST /api/schedule/complete-batch   body: { ids: string[] }
 *     → mark given LichTrinh rows as completed (only rows owned by req.userId)
 *
 *   POST /api/schedule/complete-day     body: { date: "YYYY-MM-DD" }
 *     → mark every event that starts on `date` (Asia/Bangkok) for req.userId
 *       as completed. Reusable by Telegram /dailycheck later.
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// Project-wide timezone (same as shift-matcher.js).
const TZ_OFFSET_HOURS = 7;

/**
 * Build UTC start/end ISO strings for a given local date (YYYY-MM-DD) in +07:00.
 * Returns [startIso, endIso] where startIso is inclusive and endIso is exclusive
 * (next day 00:00 in local TZ).
 */
function dayRangeUtc(dateStr) {
  // Local 00:00 +07:00 = UTC (00:00 - 07:00) on the same calendar date.
  // Simplest path: build ISO strings with explicit offset and let Date normalize.
  const startLocal = new Date(`${dateStr}T00:00:00+07:00`);
  if (Number.isNaN(startLocal.getTime())) return null;
  const endLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);
  return [startLocal.toISOString(), endLocal.toISOString()];
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// POST /api/schedule/complete-batch
// body: { ids: string[], completed?: boolean = true }
// completed=false restores rows to not-done (used by multi-select on finished events).
router.post("/complete-batch", async (req, res) => {
  try {
    const userId = req.userId;
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Thiếu danh sách ids",
      });
    }
    const ids = Array.from(new Set(raw.map((x) => String(x).trim()).filter(Boolean)));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids rỗng" });
    }
    if (ids.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Tối đa 500 id mỗi lần",
      });
    }

    const completed = req.body?.completed === false ? false : true;

    const { data, error } = await supabase
      .from("LichTrinh")
      .update({ DaHoanThanh: completed })
      .in("MaLichTrinh", ids)
      .eq("UserID", userId)
      .select("MaLichTrinh");

    if (error) {
      console.error("complete-batch error:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    return res.json({
      success: true,
      completed,
      updated: (data || []).length,
      ids: (data || []).map((r) => r.MaLichTrinh),
    });
  } catch (err) {
    console.error("complete-batch exception:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// POST /api/schedule/complete-day
// body: { date: "YYYY-MM-DD", completed?: boolean = true }
// completed=false restores every event on that date to not-done.
router.post("/complete-day", async (req, res) => {
  try {
    const userId = req.userId;
    const date = req.body?.date;
    if (!isValidDateStr(date)) {
      return res.status(400).json({
        success: false,
        message: "Thiếu hoặc sai định dạng date (YYYY-MM-DD)",
      });
    }
    const range = dayRangeUtc(date);
    if (!range) {
      return res.status(400).json({ success: false, message: "Ngày không hợp lệ" });
    }
    const [startIso, endIso] = range;
    const completed = req.body?.completed === false ? false : true;
    // Optional cap: when completing, only touch events that started at/before
    // `before`. This keeps future events untouched ("chưa tới giờ").
    // Restore ignores the cap so the user can undo accidental marks anywhere.
    const before = typeof req.body?.before === "string" ? req.body.before : null;
    const beforeValid = before && !Number.isNaN(new Date(before).getTime());

    let q = supabase
      .from("LichTrinh")
      .update({ DaHoanThanh: completed })
      .eq("UserID", userId)
      .gte("GioBatDau", startIso)
      .lt("GioBatDau", endIso);

    // Skip rows that already match the target state so the updated count
    // reflects real changes (and we avoid pointless writes).
    if (completed) {
      q = q.or("DaHoanThanh.is.null,DaHoanThanh.eq.false");
      if (beforeValid) {
        // Cap upper bound: only events already started by `before` get marked.
        q = q.lte("GioBatDau", before);
      }
    } else {
      q = q.eq("DaHoanThanh", true);
    }

    const { data, error } = await q.select("MaLichTrinh");

    if (error) {
      console.error("complete-day error:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    return res.json({
      success: true,
      date,
      completed,
      updated: (data || []).length,
      ids: (data || []).map((r) => r.MaLichTrinh),
    });
  } catch (err) {
    console.error("complete-day exception:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
// Exposed for unit testing.
module.exports.__test = { dayRangeUtc, isValidDateStr };
