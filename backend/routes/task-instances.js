/**
 * task-instances.js
 * REST endpoints for task_instances — individual scheduled occurrences of a task template.
 * Modifying an instance never touches the parent CongViec (task template) row.
 *
 * Routes:
 *   POST   /api/task-instances          — schedule a new instance
 *   GET    /api/task-instances          — list instances (optional: ?task_id=, ?start=, ?end=)
 *   PATCH  /api/task-instances/:id      — update start_at / end_at / status / note
 *   DELETE /api/task-instances/:id      — remove a single scheduling
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// Priority → color mapping (mirrors tasks.js)
const PRIORITY_COLORS = {
  1: "#10B981",
  2: "#3B82F6",
  3: "#F59E0B",
  4: "#DC2626",
};

// Allowed status values
const VALID_STATUSES = new Set(["scheduled", "completed", "cancelled"]);

// ---------------------------------------------------------------------------
// task_instances table availability guard
// ---------------------------------------------------------------------------
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

/** Parse & validate an ISO timestamp string. Returns null if invalid. */
function parseTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Build the joined event shape returned to the frontend. */
function buildEventShape(instance, task) {
  const priorityColor = task?.MucDoUuTien
    ? PRIORITY_COLORS[task.MucDoUuTien] || "#3B82F6"
    : "#60A5FA";

  return {
    // Core identity
    id: instance.id,
    task_id: instance.task_id || null,

    // Display
    title: instance.title || task?.TieuDe || "Untitled",
    start: instance.start_at,
    end: instance.end_at,
    start_at: instance.start_at,
    end_at: instance.end_at,

    // Status & flags
    status: instance.status,
    is_ai_suggested: instance.is_ai_suggested,
    is_fixed: task?.CoThoiGianCoDinh || false,

    // Task template metadata (null when no linked task)
    priority: task?.MucDoUuTien || null,
    category: task?.MaLoai || null,
    color: priorityColor,
    backgroundColor: priorityColor,
    borderColor: priorityColor,
    textColor: "#FFFFFF",

    // Note / description
    note: instance.note || "",

    // Timestamps
    created_at: instance.created_at,
    updated_at: instance.updated_at,

    // Extended props for FullCalendar
    extendedProps: {
      instanceId: instance.id,
      taskId: instance.task_id || null,
      note: instance.note || "",
      completed: instance.status === "completed",
      cancelled: instance.status === "cancelled",
      aiSuggested: instance.is_ai_suggested,
      priority: task?.MucDoUuTien || null,
      description: task?.MoTa || "",
      isFixed: task?.CoThoiGianCoDinh || false,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/task-instances
// Create a new scheduled instance for a task.
// Body: { task_id?, start_at, end_at, title?, note?, is_ai_suggested? }
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    console.log('[task-instances] POST: userId =', userId, 'type:', typeof userId);
    const { task_id, start_at, end_at, title, note, is_ai_suggested } = req.body;

    const parsedStart = parseTimestamp(start_at);
    const parsedEnd = parseTimestamp(end_at);

    if (!parsedStart) {
      return res.status(400).json({ success: false, message: "start_at is required and must be a valid ISO timestamp" });
    }
    if (!parsedEnd) {
      return res.status(400).json({ success: false, message: "end_at is required and must be a valid ISO timestamp" });
    }
    if (parsedEnd <= parsedStart) {
      return res.status(400).json({ success: false, message: "end_at must be after start_at" });
    }

    // Coerce userId to integer to handle type mismatch between JWT string and DB integer column
    const numericUserId = parseInt(userId, 10) || userId;

    // If task_id supplied, parse to integer and verify ownership
    let taskRow = null;
    let parsedTaskId = null;
    if (task_id !== undefined && task_id !== null && task_id !== "") {
      parsedTaskId = parseInt(task_id, 10);
      if (isNaN(parsedTaskId) || parsedTaskId <= 0) {
        return res.status(400).json({ success: false, message: "task_id must be a positive integer" });
      }

      console.log('[task-instances] Looking up task_id:', parsedTaskId, 'for UserID:', userId, '(numeric:', numericUserId, ')');

      const { data: t, error: taskErr } = await supabase
        .from("CongViec")
        .select("MaCongViec, TieuDe, MoTa, MucDoUuTien, MaLoai, CoThoiGianCoDinh, GioBatDauCoDinh, GioKetThucCoDinh")
        .eq("MaCongViec", parsedTaskId)
        .eq("UserID", numericUserId)
        .single();

      if (taskErr || !t) {
        console.error('[task-instances] Task lookup failed:', { parsedTaskId, userId, numericUserId, taskErr });
        // Diagnostic: check if task exists regardless of owner
        const { data: anyTask } = await supabase
          .from("CongViec")
          .select("MaCongViec, UserID")
          .eq("MaCongViec", parsedTaskId)
          .single();
        console.error('[task-instances] Task without UserID filter:', anyTask);
        return res.status(404).json({ success: false, message: "Task not found or not owned by user" });
      }
      taskRow = t;
    }

    const { data: instance, error: insertErr } = await supabase
      .from("task_instances")
      .insert({
        task_id: parsedTaskId,    // integer or null — matches CongViec.MaCongViec FK
        user_id: numericUserId,
        start_at: parsedStart,
        end_at: parsedEnd,
        title: title || null,
        note: note || null,
        status: "scheduled",
        is_ai_suggested: is_ai_suggested === true,
      })
      .select()
      .single();

    if (insertErr) {
      if (isInstancesTableMissing(insertErr)) {
        warnInstancesTableMissing();
        return res.status(503).json({
          success: false,
          message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql",
        });
      }
      console.error("Error creating task_instance:", insertErr);
      return res.status(500).json({ success: false, message: "Failed to create instance", error: insertErr.message });
    }

    res.status(201).json({
      success: true,
      message: "Instance created",
      data: buildEventShape(instance, taskRow),
    });
  } catch (err) {
    console.error("POST /api/task-instances error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/task-instances
// Query params: task_id?, start? (ISO), end? (ISO), status?
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { task_id, start, end, status } = req.query;

    let query = supabase
      .from("task_instances")
      .select("*")
      .eq("user_id", userId)
      .order("start_at", { ascending: true });

    if (task_id) {
      const tid = parseInt(task_id, 10);
      if (!isNaN(tid) && tid > 0) query = query.eq("task_id", tid);
    }
    if (start)   query = query.gte("start_at", new Date(start).toISOString());
    if (end)     query = query.lte("start_at", new Date(end).toISOString());
    if (status && VALID_STATUSES.has(status)) query = query.eq("status", status);

    const { data: instances, error } = await query;

    if (error) {
      if (isInstancesTableMissing(error)) {
        warnInstancesTableMissing();
        return res.json({ success: true, data: [], _fallback: "lichTrinh" });
      }
      console.error("Error fetching task_instances:", error);
      return res.status(500).json({ success: false, message: "Failed to load instances" });
    }

    // Batch-fetch linked tasks to avoid N+1
    const taskIds = [...new Set((instances || []).map((i) => i.task_id).filter(Boolean))];
    let taskMap = {};

    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from("CongViec")
        .select("MaCongViec, TieuDe, MoTa, MucDoUuTien, MaLoai, CoThoiGianCoDinh, GioBatDauCoDinh, GioKetThucCoDinh")
        .in("MaCongViec", taskIds)
        .eq("UserID", userId);

      (tasks || []).forEach((t) => { taskMap[t.MaCongViec] = t; });
    }

    const events = (instances || []).map((inst) =>
      buildEventShape(inst, inst.task_id ? taskMap[inst.task_id] : null)
    );

    res.json({ success: true, data: events });
  } catch (err) {
    console.error("GET /api/task-instances error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/task-instances/:id
// Update start_at, end_at, status, note, title ONLY.
// Never touches the parent CongViec row.
// ---------------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const instanceId = req.params.id;
    const { start_at, end_at, status, note, title } = req.body;

    // Confirm ownership
    const { data: existing, error: fetchErr } = await supabase
      .from("task_instances")
      .select("id, start_at, end_at, status, task_id")
      .eq("id", instanceId)
      .eq("user_id", userId)
      .single();

    if (fetchErr && isInstancesTableMissing(fetchErr)) {
      warnInstancesTableMissing();
      return res.status(503).json({
        success: false,
        message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql",
      });
    }

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, message: "Instance not found" });
    }

    const updateData = { updated_at: new Date().toISOString() };

    if (start_at !== undefined) {
      const parsed = parseTimestamp(start_at);
      if (!parsed) return res.status(400).json({ success: false, message: "Invalid start_at" });
      updateData.start_at = parsed;
    }

    if (end_at !== undefined) {
      const parsed = parseTimestamp(end_at);
      if (!parsed) return res.status(400).json({ success: false, message: "Invalid end_at" });
      updateData.end_at = parsed;
    }

    // Validate ordering after potential partial update
    const finalStart = updateData.start_at || existing.start_at;
    const finalEnd   = updateData.end_at   || existing.end_at;
    if (new Date(finalEnd) <= new Date(finalStart)) {
      return res.status(400).json({ success: false, message: "end_at must be after start_at" });
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ success: false, message: `status must be one of: ${[...VALID_STATUSES].join(", ")}` });
      }
      updateData.status = status;
    }

    if (note !== undefined) updateData.note = note;
    if (title !== undefined) updateData.title = title;

    const { data: updated, error: updateErr } = await supabase
      .from("task_instances")
      .update(updateData)
      .eq("id", instanceId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateErr) {
      console.error("Error updating task_instance:", updateErr);
      return res.status(500).json({ success: false, message: "Failed to update instance" });
    }

    res.json({ success: true, message: "Instance updated", data: updated });
  } catch (err) {
    console.error("PATCH /api/task-instances/:id error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/task-instances/:id
// Removes a single scheduled occurrence. Parent task is untouched.
// ---------------------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const instanceId = req.params.id;

    // Confirm existence + ownership before delete
    const { data: existing, error: fetchErr } = await supabase
      .from("task_instances")
      .select("id")
      .eq("id", instanceId)
      .eq("user_id", userId)
      .single();

    if (fetchErr && isInstancesTableMissing(fetchErr)) {
      warnInstancesTableMissing();
      return res.status(503).json({
        success: false,
        message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql",
      });
    }

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, message: "Instance not found" });
    }

    const { error: deleteErr } = await supabase
      .from("task_instances")
      .delete()
      .eq("id", instanceId)
      .eq("user_id", userId);

    if (deleteErr) {
      console.error("Error deleting task_instance:", deleteErr);
      return res.status(500).json({ success: false, message: "Failed to delete instance" });
    }

    res.json({ success: true, message: "Instance deleted" });
  } catch (err) {
    console.error("DELETE /api/task-instances/:id error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
