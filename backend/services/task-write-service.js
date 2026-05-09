/**
 * task-write-service.js
 * Create and update operations for CongViec (tasks).
 * Read/delete operations live in task-crud-service.js.
 * Used by task-controller.js (via task-service.js facade).
 */

const { supabase } = require("../config/database");
const {
  validateSalaryFields,
  findOverlappingFullTime,
} = require("../lib/salary-validators");

// ---------------------------------------------------------------------------
// Constants (mirrors task-crud-service.js)
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

/** Sync TaskTags for a task: delete existing then insert new (max 5). */
async function syncTaskTags(taskId, tagIds) {
  if (!Array.isArray(tagIds)) return;
  const validIds = tagIds.map((id) => parseInt(id, 10)).filter(Number.isFinite).slice(0, 5);
  await supabase.from("TaskTags").delete().eq("MaCongViec", taskId);
  if (validIds.length > 0) {
    const rows = validIds.map((tagId) => ({ MaCongViec: taskId, TagID: tagId }));
    const { error } = await supabase.from("TaskTags").insert(rows);
    if (error) console.error("[tasks] syncTaskTags insert:", error.message);
  }
}

/**
 * Reuse (or lazily create) a per-user default "Chưa phân loại" category.
 * DB schema has NOT NULL on CongViec.MaLoai.
 */
async function ensureDefaultCategory(userId) {
  const DEFAULT_NAME = "Chưa phân loại";
  const { data: existing } = await supabase.from("LoaiCongViec").select("MaLoai").eq("UserID", userId).eq("TenLoai", DEFAULT_NAME).limit(1).maybeSingle();
  if (existing?.MaLoai) return existing.MaLoai;

  const { data: anyCat } = await supabase.from("LoaiCongViec").select("MaLoai").eq("UserID", userId).order("MaLoai", { ascending: true }).limit(1).maybeSingle();
  if (anyCat?.MaLoai) return anyCat.MaLoai;

  const { data: created, error } = await supabase.from("LoaiCongViec").insert({ UserID: userId, TenLoai: DEFAULT_NAME, MoTa: "Danh mục mặc định" }).select("MaLoai").single();
  if (error) throw error;
  return created.MaLoai;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/** Create a new task. Returns the created task row with colour + empty tags. */
async function createTask(userId, d) {
  if (!d.TieuDe?.trim()) throw { status: 400, message: "Tiêu đề là bắt buộc" };

  let gioBatDauCoDinh = null;
  let gioKetThucCoDinh = null;
  let thoiGianUocTinh = parseInt(d.ThoiGianUocTinh) || 60;

  if (d.CoThoiGianCoDinh && d.GioBatDauCoDinh) {
    gioBatDauCoDinh = new Date(d.GioBatDauCoDinh);
    if (isNaN(gioBatDauCoDinh.getTime())) throw { status: 400, message: "Ngày giờ bắt đầu không hợp lệ" };

    if (d.GioKetThucCoDinh) {
      gioKetThucCoDinh = new Date(d.GioKetThucCoDinh);
      if (isNaN(gioKetThucCoDinh.getTime())) throw { status: 400, message: "Giờ kết thúc không hợp lệ" };
    } else {
      const dur = d.ThoiGianUocTinh ? parseInt(d.ThoiGianUocTinh) : 60;
      gioKetThucCoDinh = new Date(gioBatDauCoDinh.getTime() + dur * 60000);
      thoiGianUocTinh = dur;
    }
    gioBatDauCoDinh = gioBatDauCoDinh.toISOString();
    gioKetThucCoDinh = gioKetThucCoDinh.toISOString();
  }

  const salary = validateSalaryFields(d);
  if (!salary.ok) throw { status: 400, message: salary.errors.join("; ") };

  if (salary.sanitized.LoaiLuong === "full_time") {
    const conflict = await findOverlappingFullTime(userId, salary.sanitized.NgayBatDauHopDong, salary.sanitized.NgayKetThucHopDong, null);
    if (conflict) throw { status: 409, code: "FULL_TIME_OVERLAP", message: `Thời gian hợp đồng trùng với công việc full-time đang có: "${conflict.TieuDe}". Vui lòng xoá hoặc chỉnh công việc cũ trước.`, existing_task: conflict };
  }

  let maLoai = d.MaLoai ? parseInt(d.MaLoai, 10) : null;
  if (!maLoai || Number.isNaN(maLoai)) maLoai = await ensureDefaultCategory(userId);

  const { data: createdTask, error } = await supabase.from("CongViec").insert({
    UserID: userId, MaLoai: maLoai, TieuDe: d.TieuDe.trim(), MoTa: d.MoTa || "", Tag: d.Tag || "",
    CoThoiGianCoDinh: d.CoThoiGianCoDinh ? true : false, GioBatDauCoDinh: gioBatDauCoDinh, GioKetThucCoDinh: gioKetThucCoDinh,
    LapLai: d.LapLai || null, TrangThaiThucHien: 0, NgayTao: new Date().toISOString(),
    ThoiGianUocTinh: thoiGianUocTinh, MucDoUuTien: parseInt(d.MucDoUuTien) || 2,
    MucDoPhucTap: parseInt(d.MucDoPhucTap) || null, MucDoTapTrung: parseInt(d.MucDoTapTrung) || null,
    ThoiDiemThichHop: d.ThoiDiemThichHop || null, LuongTheoGio: parseFloat(d.LuongTheoGio) || 0,
    LoaiLuong: salary.sanitized.LoaiLuong, LuongThang: salary.sanitized.LuongThang, CauHinhCa: salary.sanitized.CauHinhCa,
    NgayLamViec: salary.sanitized.NgayLamViec, NgayBatDauHopDong: salary.sanitized.NgayBatDauHopDong, NgayKetThucHopDong: salary.sanitized.NgayKetThucHopDong,
  }).select().single();

  if (error) {
    console.error("Lỗi tạo công việc:", error);
    throw { status: 500, message: "Lỗi server khi tạo công việc", devDetail: error.message };
  }

  if (Array.isArray(d.tagIds) && d.tagIds.length > 0) await syncTaskTags(createdTask.MaCongViec, d.tagIds);

  return { ...createdTask, MauSac: PRIORITY_COLORS[createdTask.MucDoUuTien] || "#3B82F6", tags: [] };
}

/** Update an existing task. Throws on validation or DB errors. */
async function updateTask(taskId, userId, d) {
  const updateData = {};

  if (d.CoThoiGianCoDinh !== undefined) {
    updateData.CoThoiGianCoDinh = d.CoThoiGianCoDinh ? true : false;
    if (d.GioBatDauCoDinh) {
      const start = new Date(d.GioBatDauCoDinh);
      if (isNaN(start.getTime())) throw { status: 400, message: "Giờ bắt đầu không hợp lệ" };
      updateData.GioBatDauCoDinh = start.toISOString();
      if (!d.GioKetThucCoDinh && d.ThoiGianUocTinh) {
        updateData.GioKetThucCoDinh = new Date(start.getTime() + (parseInt(d.ThoiGianUocTinh) || 60) * 60000).toISOString();
      }
    }
    if (d.GioKetThucCoDinh) {
      const end = new Date(d.GioKetThucCoDinh);
      if (!isNaN(end.getTime())) updateData.GioKetThucCoDinh = end.toISOString();
    }
    if (d.LapLai !== undefined) updateData.LapLai = d.LapLai || null;
  }

  if (d.TieuDe) updateData.TieuDe = d.TieuDe;
  if (d.MoTa !== undefined) updateData.MoTa = d.MoTa;
  if (d.MaLoai !== undefined) {
    let maLoai = d.MaLoai ? parseInt(d.MaLoai, 10) : null;
    if (!maLoai || Number.isNaN(maLoai)) {
      try { maLoai = await ensureDefaultCategory(userId); } catch (_) { maLoai = null; }
    }
    if (maLoai) updateData.MaLoai = maLoai;
  }
  if (d.Tag !== undefined) updateData.Tag = d.Tag;
  if (d.ThoiGianUocTinh !== undefined) updateData.ThoiGianUocTinh = d.ThoiGianUocTinh;
  if (d.MucDoUuTien !== undefined) updateData.MucDoUuTien = d.MucDoUuTien;
  if (d.TrangThaiThucHien !== undefined) {
    updateData.TrangThaiThucHien =
      typeof d.TrangThaiThucHien === "string"
        ? STATUS_MAP[d.TrangThaiThucHien.toLowerCase()] ?? 0
        : d.TrangThaiThucHien;
  }

  const touchesSalary = ["LoaiLuong", "LuongThang", "CauHinhCa", "NgayLamViec", "NgayBatDauHopDong", "NgayKetThucHopDong"].some((k) => d[k] !== undefined);
  if (touchesSalary) {
    const salary = validateSalaryFields(d);
    if (!salary.ok) throw { status: 400, message: salary.errors.join("; ") };
    if (salary.sanitized.LoaiLuong === "full_time") {
      const conflict = await findOverlappingFullTime(userId, salary.sanitized.NgayBatDauHopDong, salary.sanitized.NgayKetThucHopDong, parseInt(taskId, 10));
      if (conflict) throw { status: 409, code: "FULL_TIME_OVERLAP", message: `Thời gian hợp đồng trùng với công việc full-time đang có: "${conflict.TieuDe}". Vui lòng xoá hoặc chỉnh công việc cũ trước.`, existing_task: conflict };
    }
    Object.assign(updateData, salary.sanitized);
  }

  if (Object.keys(updateData).length === 0) throw { status: 400, message: "Không có dữ liệu để cập nhật" };

  const { data, error } = await supabase.from("CongViec").update(updateData).eq("MaCongViec", taskId).eq("UserID", userId).select();
  if (error) { console.error("Lỗi cập nhật công việc:", error); throw { status: 500, message: "Lỗi server" }; }
  if (!data || data.length === 0) throw { status: 404, message: "Không tìm thấy công việc" };

  if (Array.isArray(d.tagIds)) await syncTaskTags(parseInt(taskId, 10), d.tagIds);

  if (updateData.TrangThaiThucHien !== undefined) {
    const gtSync = require("./group-task-sync-service");
    await gtSync.syncStatusToGroupTask(parseInt(taskId, 10), updateData.TrangThaiThucHien);
    if (updateData.TrangThaiThucHien === 2) {
      await supabase.from("LichTrinh").update({ DaHoanThanh: true }).eq("MaCongViec", parseInt(taskId, 10));
    }
  }
}

module.exports = { createTask, updateTask };
