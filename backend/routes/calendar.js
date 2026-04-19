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

// GET /api/calendar/events
router.get("/events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("*, CongViec(TieuDe, MucDoUuTien, MauSac)")
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
          MauSac: ev.CongViec?.MauSac || priorityColor,
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

    // Accept both Vietnamese (legacy) and English field names for consistency with PUT.
    const title = d.TieuDe ?? d.title;
    const start = d.GioBatDau ?? d.start;
    const end = d.GioKetThuc ?? d.end;
    const note = d.GhiChu ?? d.note;
    const completed = d.DaHoanThanh ?? d.completed;
    const aiSuggested = d.AI_DeXuat ?? d.aiSuggested;
    const taskId = d.MaCongViec ?? d.taskId;

    if (!title || !start) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc",
      });
    }

    const { data: result, error } = await supabase
      .from("LichTrinh")
      .insert({
        UserID: userId,
        MaCongViec: taskId || null,
        TieuDe: title,
        GioBatDau: new Date(start).toISOString(),
        GioKetThuc: end ? new Date(end).toISOString() : null,
        DaHoanThanh: completed || false,
        GhiChu: note || null,
        AI_DeXuat: aiSuggested || false,
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

    // Cập nhật trạng thái công việc nếu có taskId
    if (taskId) {
      await supabase
        .from("CongViec")
        .update({ TrangThaiThucHien: 1 })
        .eq("MaCongViec", taskId)
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

    // Accept both Vietnamese (legacy) and English field names.
    const title = d.TieuDe ?? d.title;
    const note = d.GhiChu ?? d.note;
    const start = d.GioBatDau ?? d.start;
    const end = d.GioKetThuc ?? d.end;
    const completed = d.DaHoanThanh ?? d.completed;

    if (title !== undefined) updateData.TieuDe = title;
    if (note !== undefined) updateData.GhiChu = note;
    if (start !== undefined) updateData.GioBatDau = new Date(start).toISOString();
    if (end !== undefined) updateData.GioKetThuc = end ? new Date(end).toISOString() : null;
    if (completed !== undefined) updateData.DaHoanThanh = completed ? true : false;

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
