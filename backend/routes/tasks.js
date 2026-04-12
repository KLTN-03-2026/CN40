const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

// Mapping trạng thái
const STATUS_MAP = {
  pending: 0,
  in_progress: 1,
  "in-progress": 1,
  completed: 2,
  cancelled: 3,
  canceled: 3,
};

// Mapping màu theo độ ưu tiên
const PRIORITY_COLORS = {
  1: "#34D399",
  2: "#60A5FA",
  3: "#FBBF24",
  4: "#F87171",
};

// Middleware xác thực JWT
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "Không có token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res
      .status(403)
      .json({ success: false, message: "Token không hợp lệ" });
  }
};

// GET /api/tasks
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { status } = req.query;

    let query = supabase
      .from("CongViec")
      .select("*, LoaiCongViec(TenLoai)")
      .eq("UserID", userId);

    if (status) {
      const statusNumber = STATUS_MAP[status.toLowerCase()];
      if (statusNumber !== undefined) {
        query = query.eq("TrangThaiThucHien", statusNumber);
      }
    }

    query = query.order("NgayTao", { ascending: false });

    const { data: tasks, error } = await query;

    if (error) {
      console.error("Lỗi lấy công việc:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const result = (tasks || []).map((task) => ({
      ID: task.MaCongViec,
      UserID: task.UserID,
      MaLoai: task.MaLoai,
      TieuDe: task.TieuDe,
      MoTa: task.MoTa,
      Tag: task.Tag,
      // Legacy fixed-time fields (kept for backward compat)
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
      MauSac: PRIORITY_COLORS[task.MucDoUuTien] || "#60A5FA",
      TenLoai: task.LoaiCongViec?.TenLoai || null,
      // Derived fixed-time fields (from legacy columns — no migration needed)
      is_fixed: task.CoThoiGianCoDinh || false,
      fixed_start: task.GioBatDauCoDinh || null,
      fixed_end: task.GioKetThucCoDinh || null,
      default_duration_minutes: task.ThoiGianUocTinh || null,
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Lỗi lấy công việc:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// ---------------------------------------------------------------------------
// Helpers for fixed-time normalization (used by POST and PUT)
// ---------------------------------------------------------------------------

/**
 * Parse a timestamp string; return ISO string or null.
 * @param {string|undefined} value
 * @returns {string|null}
 */
function parseTs(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Derive fixed_end from fixed_start + duration when end is omitted.
 * @param {string} startIso  — ISO start
 * @param {number} minutes   — fallback duration in minutes (default 60)
 * @returns {string}         — ISO end
 */
function deriveEnd(startIso, minutes) {
  return new Date(new Date(startIso).getTime() + (minutes || 60) * 60000).toISOString();
}

// Module-level flag: warn once when task_instances table is missing
let _autoInstanceTableMissingWarned = false;

/**
 * Create a task_instances row for a fixed-time task.
 * Failures are logged but do NOT abort the task creation response.
 * PGRST205 (table missing) is swallowed silently after a one-time warning.
 * @param {object} task  — created task row from Supabase
 * @param {string} userId
 */
async function autoCreateFixedInstance(task, userId) {
  if (!task.CoThoiGianCoDinh || !task.GioBatDauCoDinh || !task.GioKetThucCoDinh) return;

  const { error } = await supabase.from("task_instances").insert({
    task_id: task.MaCongViec,
    user_id: userId,
    start_at: task.GioBatDauCoDinh,
    end_at: task.GioKetThucCoDinh,
    status: "scheduled",
    is_ai_suggested: false,
  });

  if (error) {
    const isMissing =
      error.code === "PGRST205" ||
      (error.message && error.message.includes("task_instances"));

    if (isMissing) {
      if (!_autoInstanceTableMissingWarned) {
        _autoInstanceTableMissingWarned = true;
        console.warn(
          "[instances] table missing — using LichTrinh fallback; run migrations/001_add_task_instances.sql"
        );
      }
      // Swallow — task was created successfully, instance is just not persisted yet
    } else {
      console.error("Warning: failed to auto-create task_instance for fixed task:", error.message);
    }
  }
}

// POST /api/tasks
router.post("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const d = req.body;

    if (!d.TieuDe?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tiêu đề là bắt buộc",
      });
    }

    // ---- Legacy fixed-time fields (CoThoiGianCoDinh / GioBatDauCoDinh / GioKetThucCoDinh) ----
    let gioBatDauCoDinh = null;
    let gioKetThucCoDinh = null;
    let thoiGianUocTinh = parseInt(d.ThoiGianUocTinh) || 60;

    if (d.CoThoiGianCoDinh && d.GioBatDauCoDinh) {
      gioBatDauCoDinh = new Date(d.GioBatDauCoDinh);

      if (isNaN(gioBatDauCoDinh.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Ngày giờ bắt đầu không hợp lệ",
        });
      }

      if (d.GioKetThucCoDinh) {
        gioKetThucCoDinh = new Date(d.GioKetThucCoDinh);
        if (isNaN(gioKetThucCoDinh.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Giờ kết thúc không hợp lệ",
          });
        }
      } else {
        const durationMinutes = d.ThoiGianUocTinh
          ? parseInt(d.ThoiGianUocTinh)
          : 60;
        gioKetThucCoDinh = new Date(
          gioBatDauCoDinh.getTime() + durationMinutes * 60000
        );
        thoiGianUocTinh = durationMinutes;
      }

      gioBatDauCoDinh = gioBatDauCoDinh.toISOString();
      gioKetThucCoDinh = gioKetThucCoDinh.toISOString();
    }

    // ---- New normalized fixed-time fields ----
    // Accept both camelCase (is_fixed) and legacy (CoThoiGianCoDinh) so both
    // old frontend and new frontend work simultaneously.
    const isFixed = d.is_fixed === true || d.is_fixed === "true" || d.CoThoiGianCoDinh === true;

    // Prefer new fields; fall back to legacy fields
    const rawFixedStart = d.fixed_start || d.GioBatDauCoDinh || null;
    const rawFixedEnd   = d.fixed_end   || d.GioKetThucCoDinh || null;
    const defaultDuration = parseInt(d.default_duration_minutes) || parseInt(d.ThoiGianUocTinh) || 60;

    let fixedStart = parseTs(rawFixedStart);
    let fixedEnd   = parseTs(rawFixedEnd);

    if (isFixed && fixedStart && !fixedEnd) {
      fixedEnd = deriveEnd(fixedStart, defaultDuration);
    }

    if (isFixed && fixedStart && !parseTs(rawFixedStart)) {
      return res.status(400).json({ success: false, message: "fixed_start is invalid" });
    }

    const { data: createdTask, error } = await supabase
      .from("CongViec")
      .insert({
        UserID: userId,
        MaLoai: d.MaLoai || null,
        TieuDe: d.TieuDe.trim(),
        MoTa: d.MoTa || "",
        Tag: d.Tag || "",
        // Legacy columns (keep in sync)
        CoThoiGianCoDinh: isFixed,
        GioBatDauCoDinh: fixedStart || gioBatDauCoDinh,
        GioKetThucCoDinh: fixedEnd   || gioKetThucCoDinh,
        LapLai: d.LapLai || null,
        TrangThaiThucHien: 0,
        NgayTao: new Date().toISOString(),
        ThoiGianUocTinh: thoiGianUocTinh,
        MucDoUuTien: parseInt(d.MucDoUuTien) || 2,
        MucDoPhucTap: parseInt(d.MucDoPhucTap) || null,
        MucDoTapTrung: parseInt(d.MucDoTapTrung) || null,
        ThoiDiemThichHop: d.ThoiDiemThichHop || null,
        LuongTheoGio: parseFloat(d.LuongTheoGio) || 0,
      })
      .select()
      .single();

    if (error) {
      console.error("Lỗi tạo công việc:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tạo công việc",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Auto-create a task_instance when task has fixed times
    await autoCreateFixedInstance(createdTask, userId);

    const responseTask = {
      ...createdTask,
      MauSac: PRIORITY_COLORS[createdTask.MucDoUuTien] || "#60A5FA",
    };

    res.status(201).json({
      success: true,
      data: responseTask,
      message: "Tạo công việc thành công",
    });
  } catch (error) {
    console.error("Lỗi tạo công việc:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo công việc",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET /api/tasks/:id
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const taskId = parseInt(req.params.id);

    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, message: "ID không hợp lệ" });
    }

    const { data: task, error } = await supabase
      .from("CongViec")
      .select("*")
      .eq("MaCongViec", taskId)
      .eq("UserID", userId)
      .single();

    if (error || !task) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy công việc",
      });
    }

    res.json({
      success: true,
      data: {
        ID: task.MaCongViec,
        ...task,
        MauSac: PRIORITY_COLORS[task.MucDoUuTien] || "#60A5FA",
      },
    });
  } catch (error) {
    console.error("Lỗi lấy chi tiết công việc:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// PUT /api/tasks/:id
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const taskId = req.params.id;
    const d = req.body;

    const updateData = {};

    // ---- Legacy fixed-time block ----
    if (d.CoThoiGianCoDinh !== undefined) {
      updateData.CoThoiGianCoDinh = d.CoThoiGianCoDinh ? true : false;

      if (d.GioBatDauCoDinh) {
        const start = new Date(d.GioBatDauCoDinh);
        if (isNaN(start.getTime())) {
          return res
            .status(400)
            .json({ success: false, message: "Giờ bắt đầu không hợp lệ" });
        }
        updateData.GioBatDauCoDinh = start.toISOString();

        if (!d.GioKetThucCoDinh && d.ThoiGianUocTinh) {
          const end = new Date(
            start.getTime() + (parseInt(d.ThoiGianUocTinh) || 60) * 60000
          );
          updateData.GioKetThucCoDinh = end.toISOString();
        }
      }

      if (d.GioKetThucCoDinh) {
        const end = new Date(d.GioKetThucCoDinh);
        if (!isNaN(end.getTime())) {
          updateData.GioKetThucCoDinh = end.toISOString();
        }
      }

      if (d.LapLai !== undefined) {
        updateData.LapLai = d.LapLai || null;
      }
    }

    // ---- New normalized fixed-time fields → map to legacy columns ----
    if (d.is_fixed !== undefined) {
      updateData.CoThoiGianCoDinh = d.is_fixed === true || d.is_fixed === "true";
    }

    if (d.fixed_start !== undefined) {
      const parsed = parseTs(d.fixed_start);
      if (d.fixed_start && !parsed) {
        return res.status(400).json({ success: false, message: "fixed_start is invalid" });
      }
      updateData.GioBatDauCoDinh = parsed;
    }

    if (d.fixed_end !== undefined) {
      const parsed = parseTs(d.fixed_end);
      if (d.fixed_end && !parsed) {
        return res.status(400).json({ success: false, message: "fixed_end is invalid" });
      }
      updateData.GioKetThucCoDinh = parsed;
    }

    // ---- Standard task fields ----
    if (d.TieuDe) updateData.TieuDe = d.TieuDe;
    if (d.MoTa !== undefined) updateData.MoTa = d.MoTa;
    if (d.MaLoai !== undefined) updateData.MaLoai = d.MaLoai;
    if (d.Tag !== undefined) updateData.Tag = d.Tag;
    if (d.ThoiGianUocTinh !== undefined) updateData.ThoiGianUocTinh = d.ThoiGianUocTinh;
    if (d.MucDoUuTien !== undefined) updateData.MucDoUuTien = d.MucDoUuTien;
    if (d.TrangThaiThucHien !== undefined) {
      let status =
        typeof d.TrangThaiThucHien === "string"
          ? STATUS_MAP[d.TrangThaiThucHien.toLowerCase()] ?? 0
          : d.TrangThaiThucHien;
      updateData.TrangThaiThucHien = status;
    }

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Không có dữ liệu để cập nhật" });
    }

    const { data, error } = await supabase
      .from("CongViec")
      .update(updateData)
      .eq("MaCongViec", taskId)
      .eq("UserID", userId)
      .select();

    if (error) {
      console.error("Lỗi cập nhật công việc:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    if (!data || data.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy công việc" });
    }

    res.json({ success: true, message: "Cập nhật thành công" });
  } catch (error) {
    console.error("Lỗi cập nhật công việc:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// DELETE /api/tasks/:id
router.delete("/:id", authenticateToken, async (req, res) => {
  const userId = req.userId;
  const taskId = parseInt(req.params.id);

  if (isNaN(taskId)) {
    return res.status(400).json({ success: false, message: "ID không hợp lệ" });
  }

  try {
    // Kiểm tra công việc
    const { data: task } = await supabase
      .from("CongViec")
      .select("TieuDe")
      .eq("MaCongViec", taskId)
      .eq("UserID", userId)
      .single();

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy công việc hoặc không có quyền",
      });
    }

    // Đếm lịch trình
    const { count: scheduleCount } = await supabase
      .from("LichTrinh")
      .select("*", { count: "exact", head: true })
      .eq("MaCongViec", taskId);

    if (!scheduleCount || scheduleCount === 0) {
      await supabase
        .from("CongViec")
        .delete()
        .eq("MaCongViec", taskId)
        .eq("UserID", userId);

      return res.json({ success: true, message: "Xóa thành công" });
    }

    const force = req.query.force === "true" || req.body?.force === true;
    if (!force) {
      return res.status(200).json({
        success: false,
        requireConfirmation: true,
        message: `Công việc "${task.TieuDe}" có ${scheduleCount} lịch trình`,
        details: "Xóa công việc sẽ xóa luôn toàn bộ lịch trình liên quan",
        scheduleCount,
        taskTitle: task.TieuDe,
      });
    }

    // Xóa cascade: lịch trình trước, rồi công việc
    await supabase
      .from("LichTrinh")
      .delete()
      .eq("MaCongViec", taskId);

    await supabase
      .from("CongViec")
      .delete()
      .eq("MaCongViec", taskId)
      .eq("UserID", userId);

    return res.json({
      success: true,
      message: `Đã xóa công việc và ${scheduleCount} lịch trình`,
      deletedSchedules: scheduleCount,
    });
  } catch (error) {
    console.error("Lỗi xóa công việc:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa công việc",
    });
  }
});

module.exports = router;
