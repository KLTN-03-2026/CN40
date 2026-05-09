/**
 * event-subtasks.js
 * REST endpoints for subtasks (minitasks) stacked inside a calendar event (LichTrinh).
 *
 * Routes:
 *   GET    /api/event-subtasks?event_id=X   — list subtasks for an event
 *   POST   /api/event-subtasks              — create a subtask
 *   PATCH  /api/event-subtasks/:id          — update title / times / note / is_done
 *   DELETE /api/event-subtasks/:id          — remove a subtask
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

function parseTs(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isTableMissing(err) {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    (err.message && /event_subtasks/i.test(err.message))
  );
}

// -------- GET --------
// Pass event_id to scope to one event; omit to list all subtasks owned by the user
// (used for batch display on calendar events).
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const eventIdRaw = req.query.event_id;
    const eventId = eventIdRaw !== undefined ? parseInt(eventIdRaw, 10) : null;

    let q = supabase
      .from("event_subtasks")
      .select("*")
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (eventIdRaw !== undefined) {
      if (!eventId || isNaN(eventId)) {
        return res.status(400).json({ success: false, message: "event_id không hợp lệ" });
      }
      q = q.eq("event_id", eventId);
    }

    const { data, error } = await q;

    if (error) {
      if (isTableMissing(error)) {
        return res.status(503).json({
          success: false,
          message: "Tính năng chưa sẵn sàng — chạy migration 003_add_event_subtasks.sql",
        });
      }
      return res.status(500).json({ success: false, message: "Không tải được subtask" });
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("GET /event-subtasks:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------- POST --------
router.post("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const { event_id, title, start_at, end_at, note, position } = req.body || {};
    const eventId = parseInt(event_id, 10);
    if (!eventId) return res.status(400).json({ success: false, message: "event_id là bắt buộc" });
    if (!title || !String(title).trim())
      return res.status(400).json({ success: false, message: "Tiêu đề là bắt buộc" });

    const sAt = parseTs(start_at);
    const eAt = parseTs(end_at);
    if ((start_at && !sAt) || (end_at && !eAt)) {
      return res.status(400).json({ success: false, message: "Thời gian không hợp lệ" });
    }
    if (sAt && eAt && new Date(eAt) <= new Date(sAt)) {
      return res.status(400).json({ success: false, message: "Kết thúc phải sau bắt đầu" });
    }

    // Validate: subtask time must fall inside the parent event's time range.
    if (sAt || eAt) {
      const { data: parent } = await supabase
        .from("LichTrinh")
        .select("GioBatDau, GioKetThuc")
        .eq("MaLichTrinh", eventId)
        .eq("UserID", userId)
        .single();
      if (parent?.GioBatDau && parent?.GioKetThuc) {
        const evS = new Date(parent.GioBatDau).getTime();
        const evE = new Date(parent.GioKetThuc).getTime();
        if (sAt && new Date(sAt).getTime() < evS) {
          return res.status(400).json({ success: false, message: "Bắt đầu minitask trước thời gian task chính" });
        }
        if (eAt && new Date(eAt).getTime() > evE) {
          return res.status(400).json({ success: false, message: "Kết thúc minitask sau thời gian task chính" });
        }
      }
    }

    const { data, error } = await supabase
      .from("event_subtasks")
      .insert({
        event_id: eventId,
        user_id: userId,
        title: String(title).trim(),
        start_at: sAt,
        end_at: eAt,
        note: note || null,
        position: Number.isFinite(position) ? position : 0,
      })
      .select()
      .single();

    if (error) {
      if (isTableMissing(error)) {
        return res.status(503).json({
          success: false,
          message: "Tính năng chưa sẵn sàng — chạy migration 003_add_event_subtasks.sql",
        });
      }
      console.error("POST /event-subtasks:", error);
      return res.status(500).json({ success: false, message: "Không tạo được subtask" });
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("POST /event-subtasks:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------- PATCH --------
router.patch("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "id không hợp lệ" });

    const upd = { updated_at: new Date().toISOString() };
    const { title, start_at, end_at, note, is_done, position } = req.body || {};
    if (title !== undefined) upd.title = String(title).trim();
    if (start_at !== undefined) {
      const v = parseTs(start_at);
      if (start_at && !v) return res.status(400).json({ success: false, message: "start_at không hợp lệ" });
      upd.start_at = v;
    }
    if (end_at !== undefined) {
      const v = parseTs(end_at);
      if (end_at && !v) return res.status(400).json({ success: false, message: "end_at không hợp lệ" });
      upd.end_at = v;
    }
    if (note !== undefined) upd.note = note || null;
    if (is_done !== undefined) upd.is_done = !!is_done;
    if (position !== undefined && Number.isFinite(position)) upd.position = position;

    const { data, error } = await supabase
      .from("event_subtasks")
      .update(upd)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      if (isTableMissing(error)) {
        return res.status(503).json({
          success: false,
          message: "Tính năng chưa sẵn sàng — chạy migration 003_add_event_subtasks.sql",
        });
      }
      return res.status(500).json({ success: false, message: "Không cập nhật được" });
    }
    if (!data) return res.status(404).json({ success: false, message: "Không tìm thấy subtask" });
    res.json({ success: true, data });
  } catch (err) {
    console.error("PATCH /event-subtasks/:id:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------- DELETE --------
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "id không hợp lệ" });

    const { error } = await supabase
      .from("event_subtasks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      if (isTableMissing(error)) {
        return res.status(503).json({ success: false, message: "Migration 003 chưa chạy" });
      }
      return res.status(500).json({ success: false, message: "Xoá thất bại" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /event-subtasks/:id:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
