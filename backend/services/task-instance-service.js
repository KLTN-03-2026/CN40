/**
 * task-instance-service.js
 * Pure business logic for task_instances table — no req/res.
 * Used by task-instance-controller.js.
 */

const { supabase } = require("../config/database");
const { matchShift } = require("../lib/shift-matcher");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_COLORS = {
  1: "#10B981",
  2: "#3B82F6",
  3: "#F59E0B",
  4: "#DC2626",
};

const VALID_STATUSES = new Set(["scheduled", "completed", "cancelled"]);

// ---------------------------------------------------------------------------
// Table availability guard
// ---------------------------------------------------------------------------

let _instancesTableMissingWarned = false;

function isInstancesTableMissing(error) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
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
    id: instance.id,
    task_id: instance.task_id || null,
    title: instance.title || task?.TieuDe || "Untitled",
    start: instance.start_at,
    end: instance.end_at,
    start_at: instance.start_at,
    end_at: instance.end_at,
    status: instance.status,
    is_ai_suggested: instance.is_ai_suggested,
    is_fixed: task?.CoThoiGianCoDinh || false,
    priority: task?.MucDoUuTien || null,
    category: task?.MaLoai || null,
    color: priorityColor,
    backgroundColor: priorityColor,
    borderColor: priorityColor,
    textColor: "#FFFFFF",
    note: instance.note || "",
    created_at: instance.created_at,
    updated_at: instance.updated_at,
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
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new task instance.
 * Throws { status, message } on validation or DB error.
 * Throws { status: 503, migration: true } when table is missing.
 */
async function createInstance(userId, body) {
  const { task_id, start_at, end_at, title, note, is_ai_suggested } = body;

  const parsedStart = parseTimestamp(start_at);
  const parsedEnd = parseTimestamp(end_at);

  if (!parsedStart) {
    throw { status: 400, message: "start_at is required and must be a valid ISO timestamp" };
  }
  if (!parsedEnd) {
    throw { status: 400, message: "end_at is required and must be a valid ISO timestamp" };
  }
  if (parsedEnd <= parsedStart) {
    throw { status: 400, message: "end_at must be after start_at" };
  }

  const numericUserId = parseInt(userId, 10) || userId;

  let taskRow = null;
  let parsedTaskId = null;
  if (task_id !== undefined && task_id !== null && task_id !== "") {
    parsedTaskId = parseInt(task_id, 10);
    if (isNaN(parsedTaskId) || parsedTaskId <= 0) {
      throw { status: 400, message: "task_id must be a positive integer" };
    }

    const { data: t, error: taskErr } = await supabase
      .from("CongViec")
      .select("MaCongViec, TieuDe, MoTa, MucDoUuTien, MaLoai, CoThoiGianCoDinh, GioBatDauCoDinh, GioKetThucCoDinh, LoaiLuong, CauHinhCa")
      .eq("MaCongViec", parsedTaskId)
      .eq("UserID", numericUserId)
      .single();

    if (taskErr || !t) {
      // Diagnostic log for debugging ownership mismatches
      const { data: anyTask } = await supabase
        .from("CongViec")
        .select("MaCongViec, UserID")
        .eq("MaCongViec", parsedTaskId)
        .single();
      console.error("[instances] Task lookup failed:", { parsedTaskId, userId, numericUserId, taskErr });
      console.error("[instances] Task without UserID filter:", anyTask);
      throw { status: 404, message: "Task not found or not owned by user" };
    }
    taskRow = t;
  }

  let { data: instance, error: insertErr } = await supabase
    .from("task_instances")
    .insert({
      task_id: parsedTaskId,
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
      throw { status: 503, migration: true, message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql" };
    }
    console.error("Error creating task_instance:", insertErr);
    throw { status: 500, message: "Failed to create instance", devDetail: insertErr.message };
  }

  // Shift auto-assign for part-time tasks
  if (taskRow?.LoaiLuong === "part_time" && Array.isArray(taskRow.CauHinhCa)) {
    const shiftName = matchShift(parsedStart, taskRow.CauHinhCa);
    if (shiftName) {
      const meta = { ...(instance.meta || {}), shift_name: shiftName };
      const { data: updated } = await supabase
        .from("task_instances")
        .update({ meta, updated_at: new Date().toISOString() })
        .eq("id", instance.id)
        .select()
        .single();
      if (updated) instance = updated;
    }
  }

  return buildEventShape(instance, taskRow);
}

/**
 * List task instances for a user.
 * Returns [] with _fallback flag when table is missing (graceful degradation).
 */
async function listInstances(userId, query) {
  const { task_id, start, end, status } = query || {};

  let dbQuery = supabase
    .from("task_instances")
    .select("*")
    .eq("user_id", userId)
    .order("start_at", { ascending: true });

  if (task_id) {
    const tid = parseInt(task_id, 10);
    if (!isNaN(tid) && tid > 0) dbQuery = dbQuery.eq("task_id", tid);
  }
  if (start) dbQuery = dbQuery.gte("start_at", new Date(start).toISOString());
  if (end)   dbQuery = dbQuery.lte("start_at", new Date(end).toISOString());
  if (status && VALID_STATUSES.has(status)) dbQuery = dbQuery.eq("status", status);

  const { data: instances, error } = await dbQuery;

  if (error) {
    if (isInstancesTableMissing(error)) {
      warnInstancesTableMissing();
      return { data: [], _fallback: "lichTrinh" };
    }
    console.error("Error fetching task_instances:", error);
    throw { status: 500, message: "Failed to load instances" };
  }

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

  return { data: events };
}

/**
 * Update an instance's mutable fields (start_at, end_at, status, note, title).
 * Never touches the parent CongViec row.
 */
async function updateInstance(instanceId, userId, body) {
  const { start_at, end_at, status, note, title } = body;

  const { data: existing, error: fetchErr } = await supabase
    .from("task_instances")
    .select("id, start_at, end_at, status, task_id, meta")
    .eq("id", instanceId)
    .eq("user_id", userId)
    .single();

  if (fetchErr && isInstancesTableMissing(fetchErr)) {
    warnInstancesTableMissing();
    throw { status: 503, migration: true, message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql" };
  }

  if (fetchErr || !existing) {
    throw { status: 404, message: "Instance not found" };
  }

  const updateData = { updated_at: new Date().toISOString() };

  if (start_at !== undefined) {
    const parsed = parseTimestamp(start_at);
    if (!parsed) throw { status: 400, message: "Invalid start_at" };
    updateData.start_at = parsed;
  }

  if (end_at !== undefined) {
    const parsed = parseTimestamp(end_at);
    if (!parsed) throw { status: 400, message: "Invalid end_at" };
    updateData.end_at = parsed;
  }

  const finalStart = updateData.start_at || existing.start_at;
  const finalEnd   = updateData.end_at   || existing.end_at;
  if (new Date(finalEnd) <= new Date(finalStart)) {
    throw { status: 400, message: "end_at must be after start_at" };
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      throw { status: 400, message: `status must be one of: ${[...VALID_STATUSES].join(", ")}` };
    }
    updateData.status = status;
  }

  if (note !== undefined) updateData.note = note;
  if (title !== undefined) updateData.title = title;

  let { data: updated, error: updateErr } = await supabase
    .from("task_instances")
    .update(updateData)
    .eq("id", instanceId)
    .eq("user_id", userId)
    .select()
    .single();

  if (updateErr) {
    console.error("Error updating task_instance:", updateErr);
    throw { status: 500, message: "Failed to update instance" };
  }

  // Shift re-match when start_at changed and parent task is part_time
  if (updateData.start_at && updated?.task_id) {
    const { data: parent } = await supabase
      .from("CongViec")
      .select("LoaiLuong, CauHinhCa")
      .eq("MaCongViec", updated.task_id)
      .eq("UserID", userId)
      .single();
    if (parent?.LoaiLuong === "part_time" && Array.isArray(parent.CauHinhCa)) {
      const shiftName = matchShift(updated.start_at, parent.CauHinhCa);
      const baseMeta = updated.meta || {};
      const nextMeta = shiftName
        ? { ...baseMeta, shift_name: shiftName }
        : (() => { const { shift_name, ...rest } = baseMeta; return rest; })();
      const { data: reupdated } = await supabase
        .from("task_instances")
        .update({ meta: nextMeta, updated_at: new Date().toISOString() })
        .eq("id", instanceId)
        .eq("user_id", userId)
        .select()
        .single();
      if (reupdated) updated = reupdated;
    }
  }

  return updated;
}

/** Delete a single task instance. Throws 404 if not found or not owned. */
async function deleteInstance(instanceId, userId) {
  const { data: existing, error: fetchErr } = await supabase
    .from("task_instances")
    .select("id")
    .eq("id", instanceId)
    .eq("user_id", userId)
    .single();

  if (fetchErr && isInstancesTableMissing(fetchErr)) {
    warnInstancesTableMissing();
    throw { status: 503, migration: true, message: "Feature not available — migration pending. Run migrations/001_add_task_instances.sql" };
  }

  if (fetchErr || !existing) {
    throw { status: 404, message: "Instance not found" };
  }

  const { error: deleteErr } = await supabase
    .from("task_instances")
    .delete()
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (deleteErr) {
    console.error("Error deleting task_instance:", deleteErr);
    throw { status: 500, message: "Failed to delete instance" };
  }
}

module.exports = {
  createInstance,
  listInstances,
  updateInstance,
  deleteInstance,
  // Expose for testing
  isInstancesTableMissing,
  buildEventShape,
};
