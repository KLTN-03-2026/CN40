const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

const PRIORITY_COLORS = {
  1: "#34D399",
  2: "#60A5FA",
  3: "#FBBF24",
  4: "#F87171",
};

// ---------------------------------------------------------------------------
// task_instances table availability flag
// Printed once at server start; routes fall back to LichTrinh when missing.
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

// ---------------------------------------------------------------------------
// GET /api/calendar/instances
// New endpoint backed by task_instances table.
// Query params: start? (ISO), end? (ISO)
// Returns FullCalendar-compatible event objects.
// ---------------------------------------------------------------------------
router.get("/instances", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { start, end } = req.query;

    // Default to ±30 days when no range given
    const rangeStart = start
      ? new Date(start).toISOString()
      : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const rangeEnd = end
      ? new Date(end).toISOString()
      : new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

    const { data: instances, error } = await supabase
      .from("task_instances")
      .select("*")
      .eq("user_id", userId)
      .gte("start_at", rangeStart)
      .lte("start_at", rangeEnd)
      .order("start_at", { ascending: true });

    // ---- Graceful fallback: task_instances table not yet migrated ----
    if (isInstancesTableMissing(error)) {
      warnInstancesTableMissing();

      // Fall back to LichTrinh — return same event shape so frontend is unaffected
      const { data: legacy, error: legErr } = await supabase
        .from("LichTrinh")
        .select("MaLichTrinh, TieuDe, GioBatDau, GioKetThuc, GhiChu, DaHoanThanh, AI_DeXuat, MaCongViec, CongViec(TieuDe, MucDoUuTien, MoTa, CoThoiGianCoDinh, MaLoai)")
        .eq("UserID", userId)
        .gte("GioBatDau", rangeStart)
        .lte("GioBatDau", rangeEnd)
        .order("GioBatDau", { ascending: true });

      if (legErr) {
        return res.status(500).json({ success: false, message: legErr.message });
      }

      const fallbackEvents = (legacy || []).map((r) => {
        const task = r.CongViec || {};
        const priorityColor = task.MucDoUuTien
          ? PRIORITY_COLORS[task.MucDoUuTien] || "#60A5FA"
          : "#60A5FA";
        return {
          id: `lt_${r.MaLichTrinh}`,
          instanceId: `lt_${r.MaLichTrinh}`,
          task_id: r.MaCongViec || null,
          title: task.TieuDe || r.TieuDe || "Untitled",
          start: r.GioBatDau,
          end: r.GioKetThuc,
          backgroundColor: priorityColor,
          borderColor: priorityColor,
          textColor: "#FFFFFF",
          status: r.DaHoanThanh ? "completed" : "scheduled",
          is_fixed: task.CoThoiGianCoDinh || false,
          is_ai_suggested: r.AI_DeXuat || false,
          extendedProps: {
            instanceId: `lt_${r.MaLichTrinh}`,
            taskId: r.MaCongViec || null,
            note: r.GhiChu || "",
            completed: r.DaHoanThanh || false,
            cancelled: false,
            aiSuggested: r.AI_DeXuat || false,
            priority: task.MucDoUuTien || null,
            description: task.MoTa || "",
            isFixed: task.CoThoiGianCoDinh || false,
            category: task.MaLoai || null,
          },
        };
      });

      return res.json({ success: true, data: fallbackEvents, _fallback: "lichTrinh" });
    }

    if (error) {
      console.error("Lỗi lấy task_instances:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Batch-fetch linked tasks to avoid N+1
    const taskIds = [...new Set((instances || []).map((i) => i.task_id).filter(Boolean))];
    let taskMap = {};

    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from("CongViec")
        .select("MaCongViec, TieuDe, MoTa, MucDoUuTien, MaLoai, CoThoiGianCoDinh")
        .in("MaCongViec", taskIds)
        .eq("UserID", userId);

      (tasks || []).forEach((t) => { taskMap[t.MaCongViec] = t; });
    }

    const events = (instances || []).map((inst) => {
      const task = inst.task_id ? taskMap[inst.task_id] : null;
      const priorityColor = task?.MucDoUuTien
        ? PRIORITY_COLORS[task.MucDoUuTien] || "#60A5FA"
        : "#60A5FA";
      return {
        id: inst.id,
        instanceId: inst.id,
        task_id: inst.task_id || null,
        title: inst.title || task?.TieuDe || "Untitled",
        start: inst.start_at,
        end: inst.end_at,
        backgroundColor: priorityColor,
        borderColor: priorityColor,
        textColor: "#FFFFFF",
        status: inst.status,
        is_fixed: task?.CoThoiGianCoDinh || false,
        is_ai_suggested: inst.is_ai_suggested,
        extendedProps: {
          instanceId: inst.id,
          taskId: inst.task_id || null,
          note: inst.note || "",
          completed: inst.status === "completed",
          cancelled: inst.status === "cancelled",
          aiSuggested: inst.is_ai_suggested,
          priority: task?.MucDoUuTien || null,
          description: task?.MoTa || "",
          isFixed: task?.CoThoiGianCoDinh || false,
          category: task?.MaLoai || null,
        },
      };
    });

    res.json({ success: true, data: events });
  } catch (err) {
    console.error("Lỗi lấy instances:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/calendar/events
router.get("/events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("*, CongViec(TieuDe, MucDoUuTien)")
      .or(`UserID.eq.${userId}`)
      .gte("GioBatDau", thirtyDaysAgo)
      .order("GioBatDau", { ascending: false });

    if (error) {
      console.error("Lỗi lấy events:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    const events = (records || [])
      .filter((ev) => ev.UserID === userId || ev.CongViec?.UserID === userId)
      .map((ev) => {
        const priorityColor = ev.CongViec?.MucDoUuTien
          ? PRIORITY_COLORS[ev.CongViec.MucDoUuTien] || "#3788d8"
          : "#3788d8";

        return {
          MaLichTrinh: ev.MaLichTrinh,
          MaCongViec: ev.MaCongViec,
          TieuDe: ev.CongViec?.TieuDe || ev.TieuDe,
          GioBatDau: ev.GioBatDau,
          GioKetThuc: ev.GioKetThuc,
          GhiChu: ev.GhiChu,
          MauSac: priorityColor,
          DaHoanThanh: ev.DaHoanThanh,
          MucDoUuTien: ev.CongViec?.MucDoUuTien,
          AI_DeXuat: ev.AI_DeXuat || 0,
        };
      });

    console.log(`Trả về ${events.length} events`);
    res.json({ success: true, data: events });
  } catch (error) {
    console.error("Lỗi lấy events:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/calendar/range
router.get("/range", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số start hoặc end",
      });
    }

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("*, CongViec(TieuDe, MoTa, MucDoUuTien)")
      .eq("UserID", userId)
      .gte("GioBatDau", start)
      .lte("GioBatDau", end)
      .order("GioBatDau", { ascending: true });

    if (error) {
      console.error("Lỗi load lịch theo range:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const events = (records || []).map((event) => {
      const title =
        event.CongViec?.TieuDe || event.TieuDe || "Không có tiêu đề";
      const priorityColor = PRIORITY_COLORS[event.CongViec?.MucDoUuTien] || "#60A5FA";

      return {
        id: event.MaLichTrinh,
        MaLichTrinh: event.MaLichTrinh,
        MaCongViec: event.MaCongViec,
        title: title,
        start: event.GioBatDau,
        end: event.GioKetThuc,
        GioBatDau: event.GioBatDau,
        GioKetThuc: event.GioKetThuc,
        DaHoanThanh: event.DaHoanThanh || false,
        GhiChu: event.GhiChu || "",
        AI_DeXuat: event.AI_DeXuat || false,
        backgroundColor: priorityColor,
        borderColor: priorityColor,
        textColor: "#FFFFFF",
        extendedProps: {
          note: event.GhiChu || "",
          completed: event.DaHoanThanh || false,
          aiSuggested: event.AI_DeXuat || false,
          taskId: event.MaCongViec || null,
          description: event.CongViec?.MoTa || "",
          priority: event.CongViec?.MucDoUuTien || 2,
        },
      };
    });

    res.json({ success: true, data: events });
  } catch (error) {
    console.error("Lỗi load lịch theo range:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// GET /api/calendar/ai-events
router.get("/ai-events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("*, CongViec(TieuDe, MoTa, MucDoUuTien)")
      .eq("UserID", userId)
      .eq("AI_DeXuat", true)
      .order("GioBatDau", { ascending: true });

    if (error) {
      console.error("Lỗi load AI events:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const events = (records || []).map((event) => {
      const title = event.CongViec?.TieuDe || event.TieuDe || "AI Đề xuất";
      const priorityColor = event.CongViec?.MucDoUuTien
        ? PRIORITY_COLORS[event.CongViec.MucDoUuTien] || "#8B5CF6"
        : "#8B5CF6";

      return {
        id: event.MaLichTrinh,
        MaLichTrinh: event.MaLichTrinh,
        MaCongViec: event.MaCongViec,
        title: title,
        start: event.GioBatDau,
        end: event.GioKetThuc,
        GioBatDau: event.GioBatDau,
        GioKetThuc: event.GioKetThuc,
        DaHoanThanh: event.DaHoanThanh || false,
        GhiChu: event.GhiChu || "",
        AI_DeXuat: true,
        backgroundColor: priorityColor,
        borderColor: priorityColor,
        textColor: "#FFFFFF",
        extendedProps: {
          note: event.GhiChu || "",
          completed: event.DaHoanThanh || false,
          aiSuggested: true,
          taskId: event.MaCongViec || null,
          description: event.CongViec?.MoTa || "",
          priority: event.CongViec?.MucDoUuTien || null,
        },
      };
    });

    res.json({ success: true, data: events });
  } catch (error) {
    console.error("Lỗi load AI events:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi tải AI events" });
  }
});

// POST /api/calendar/events
router.post("/events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const d = req.body;

    if (!d.TieuDe || !d.GioBatDau) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc",
      });
    }

    const { data: result, error } = await supabase
      .from("LichTrinh")
      .insert({
        UserID: userId,
        MaCongViec: d.MaCongViec || null,
        TieuDe: d.TieuDe,
        GioBatDau: new Date(d.GioBatDau).toISOString(),
        GioKetThuc: d.GioKetThuc ? new Date(d.GioKetThuc).toISOString() : null,
        DaHoanThanh: d.DaHoanThanh || false,
        GhiChu: d.GhiChu || null,
        AI_DeXuat: d.AI_DeXuat || false,
        NgayTao: new Date().toISOString(),
      })
      .select("MaLichTrinh")
      .single();

    if (error) {
      console.error("Lỗi tạo lịch:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tạo sự kiện",
        error: error.message,
      });
    }

    // Cập nhật trạng thái công việc nếu có MaCongViec
    if (d.MaCongViec) {
      await supabase
        .from("CongViec")
        .update({ TrangThaiThucHien: 1 })
        .eq("MaCongViec", d.MaCongViec)
        .eq("UserID", userId);
    }

    res.json({
      success: true,
      eventId: result.MaLichTrinh,
      message: "Tạo sự kiện thành công",
    });
  } catch (error) {
    console.error("Lỗi tạo lịch:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo sự kiện",
      error: error.message,
    });
  }
});

// PUT /api/calendar/events/:id
router.put("/events/:id", authenticateToken, async (req, res) => {
  try {
    const d = req.body;
    const updateData = {};

    if (d.title !== undefined) updateData.TieuDe = d.title;
    if (d.note !== undefined) updateData.GhiChu = d.note;
    if (d.start !== undefined) updateData.GioBatDau = new Date(d.start).toISOString();
    if (d.end !== undefined) updateData.GioKetThuc = d.end ? new Date(d.end).toISOString() : null;
    if (d.completed !== undefined) updateData.DaHoanThanh = d.completed ? true : false;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Không có gì để cập nhật" });
    }

    await supabase
      .from("LichTrinh")
      .update(updateData)
      .eq("MaLichTrinh", req.params.id)
      .eq("UserID", req.userId);

    res.json({ success: true, message: "Cập nhật sự kiện thành công" });
  } catch (error) {
    console.error("Lỗi cập nhật:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi cập nhật sự kiện" });
  }
});

// DELETE /api/calendar/events/:id
router.delete("/events/:id", authenticateToken, async (req, res) => {
  try {
    await supabase
      .from("LichTrinh")
      .delete()
      .eq("MaLichTrinh", req.params.id)
      .eq("UserID", req.userId);

    res.json({ success: true, message: "Xóa sự kiện thành công" });
  } catch (error) {
    console.error("Lỗi xóa:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi xóa sự kiện" });
  }
});

module.exports = router;
