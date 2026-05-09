/**
 * task-crud-service.js
 * Read and delete operations for CongViec (tasks).
 * Write operations (create/update) live in task-write-service.js.
 * Used by task-controller.js.
 */

const { supabase } = require("../config/database");
const { findFullTimeCategory } = require("../lib/salary-validators");

// ---------------------------------------------------------------------------
// Constants (shared with task-write-service.js — keep in sync)
// ---------------------------------------------------------------------------

const STATUS_MAP = {
  pending: 0,
  in_progress: 1,
  "in-progress": 1,
  completed: 2,
  cancelled: 3,
  canceled: 3,
};

const PRIORITY_COLORS = {
  1: "#10B981",
  2: "#3B82F6",
  3: "#F59E0B",
  4: "#DC2626",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the 6 salary-type columns from a DB row to the API response shape. */
function mapSalaryFields(task) {
  return {
    LoaiLuong: task.LoaiLuong || "none",
    LuongThang: task.LuongThang ?? null,
    CauHinhCa: task.CauHinhCa ?? null,
    NgayLamViec: task.NgayLamViec ?? null,
    NgayBatDauHopDong: task.NgayBatDauHopDong ?? null,
    NgayKetThucHopDong: task.NgayKetThucHopDong ?? null,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * List tasks for a user, optionally filtered by status.
 * Batch-fetches tags to avoid N+1.
 */
async function listTasks(userId, query) {
  const { status } = query || {};

  let dbQuery = supabase
    .from("CongViec")
    .select("*, LoaiCongViec(TenLoai)")
    .eq("UserID", userId);

  if (status) {
    const statusNumber = STATUS_MAP[status.toLowerCase()];
    if (statusNumber !== undefined) dbQuery = dbQuery.eq("TrangThaiThucHien", statusNumber);
  }

  dbQuery = dbQuery.order("NgayTao", { ascending: false });
  const { data: tasks, error } = await dbQuery;
  if (error) throw { status: 500, message: "Lỗi server" };

  const taskIds = (tasks || []).map((t) => t.MaCongViec);
  let taskTagsMap = {};

  if (taskIds.length > 0) {
    const { data: taskTagRows } = await supabase
      .from("TaskTags")
      .select("MaCongViec, Tags(TagID, TenTag, MauSac)")
      .in("MaCongViec", taskIds);
    if (taskTagRows) {
      for (const row of taskTagRows) {
        if (!taskTagsMap[row.MaCongViec]) taskTagsMap[row.MaCongViec] = [];
        if (row.Tags) taskTagsMap[row.MaCongViec].push(row.Tags);
      }
    }
  }

  const gtSync = require("./group-task-sync-service");
  const groupInfoMap = await gtSync.getGroupInfoForTasks(taskIds);

  return (tasks || []).map((task) => ({
    ID: task.MaCongViec,
    UserID: task.UserID,
    MaLoai: task.MaLoai,
    TieuDe: task.TieuDe,
    MoTa: task.MoTa,
    Tag: task.Tag,
    CoThoiGianCoDinh: task.CoThoiGianCoDinh,
    GioBatDauCoDinh: task.GioBatDauCoDinh,
    GioKetThucCoDinh: task.GioKetThucCoDinh,
    LapLai: task.LapLai,
    TrangThaiThucHien: task.TrangThaiThucHien,
    NgayTao: task.NgayTao,
    ThoiGianUocTinh: task.ThoiGianUocTinh,
    MucDoUuTien: task.MucDoUuTien,
    MucDoPhucTap: task.MucDoPhucTap,
    MucDoTapTrung: task.MucDoTapTrung,
    ThoiDiemThichHop: task.ThoiDiemThichHop,
    LuongTheoGio: task.LuongTheoGio,
    MauSac: PRIORITY_COLORS[task.MucDoUuTien] || "#3B82F6",
    TenLoai: task.LoaiCongViec?.TenLoai || null,
    tags: taskTagsMap[task.MaCongViec] || [],
    GroupTaskID: groupInfoMap.get(task.MaCongViec)?.GroupTaskID || null,
    GroupName: groupInfoMap.get(task.MaCongViec)?.GroupName || null,
    GroupTaskDeadline: groupInfoMap.get(task.MaCongViec)?.Deadline || null,
    ...mapSalaryFields(task),
  }));
}

/** Get a single task by ID, verifying user ownership. */
async function getTask(taskId, userId) {
  const { data: task, error } = await supabase
    .from("CongViec")
    .select("*")
    .eq("MaCongViec", taskId)
    .eq("UserID", userId)
    .single();

  if (error || !task) throw { status: 404, message: "Không tìm thấy công việc" };

  return {
    ID: task.MaCongViec,
    ...task,
    MauSac: PRIORITY_COLORS[task.MucDoUuTien] || "#3B82F6",
  };
}

/** Fuzzy lookup of a "Full time work" category for the user. */
async function getFullTimeCategory(userId) {
  return await findFullTimeCategory(userId);
}

/**
 * Delete a task. Returns { requireConfirmation, ... } when schedules exist
 * and force !== true. Returns { deleted: true } on success.
 */
async function deleteTask(taskId, userId, force) {
  const { data: task } = await supabase
    .from("CongViec")
    .select("TieuDe, GroupTaskID")
    .eq("MaCongViec", taskId)
    .eq("UserID", userId)
    .single();

  if (!task) throw { status: 404, message: "Không tìm thấy công việc hoặc không có quyền" };
  if (task.GroupTaskID) throw { status: 400, message: "Không thể xoá công việc liên kết nhóm. Hãy xoá từ nhóm." };

  const { count: scheduleCount } = await supabase
    .from("LichTrinh")
    .select("*", { count: "exact", head: true })
    .eq("MaCongViec", taskId);

  if (!scheduleCount || scheduleCount === 0) {
    await supabase.from("CongViec").delete().eq("MaCongViec", taskId).eq("UserID", userId);
    return { deleted: true, scheduleCount: 0 };
  }

  if (!force) {
    return {
      requireConfirmation: true,
      message: `Công việc "${task.TieuDe}" có ${scheduleCount} lịch trình`,
      details: "Xóa công việc sẽ xóa luôn toàn bộ lịch trình liên quan",
      scheduleCount,
      taskTitle: task.TieuDe,
    };
  }

  await supabase.from("LichTrinh").delete().eq("MaCongViec", taskId);
  await supabase.from("CongViec").delete().eq("MaCongViec", taskId).eq("UserID", userId);
  return { deleted: true, scheduleCount };
}

module.exports = { listTasks, getTask, getFullTimeCategory, deleteTask };
