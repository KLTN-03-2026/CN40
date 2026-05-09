/**
 * calendar-service.js
 * Pure business logic for LichTrinh (calendar/schedule) endpoints — no req/res.
 * Used by calendar-controller.js.
 */

const { supabase } = require("../config/database");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_COLORS = {
  1: "#34D399",
  2: "#60A5FA",
  3: "#FBBF24",
  4: "#F87171",
};

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * GET /api/calendar/events
 * Returns all events from the last 30 days for a user.
 */
async function getEvents(userId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: records, error } = await supabase
    .from("LichTrinh")
    .select("*, CongViec(TieuDe, MucDoUuTien, MauSac, LoaiCongViec(TenLoai))")
    .or(`UserID.eq.${userId}`)
    .gte("GioBatDau", thirtyDaysAgo)
    .order("GioBatDau", { ascending: false });

  if (error) {
    console.error("Lỗi lấy events:", error);
    throw { status: 500, message: error.message };
  }

  return (records || [])
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
        TenLoai: ev.CongViec?.LoaiCongViec?.TenLoai || null,
        AI_DeXuat: ev.AI_DeXuat || 0,
      };
    });
}

/**
 * GET /api/calendar/range
 * Returns events within a date range.
 */
async function getEventsInRange(userId, start, end) {
  if (!start || !end) {
    throw { status: 400, message: "Thiếu tham số start hoặc end" };
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
    throw { status: 500, message: "Lỗi server" };
  }

  return (records || []).map((event) => {
    const title = event.CongViec?.TieuDe || event.TieuDe || "Không có tiêu đề";
    const priorityColor = PRIORITY_COLORS[event.CongViec?.MucDoUuTien] || "#60A5FA";
    return {
      id: event.MaLichTrinh,
      MaLichTrinh: event.MaLichTrinh,
      MaCongViec: event.MaCongViec,
      title,
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
}

/**
 * GET /api/calendar/ai-events
 * Returns AI-suggested events for a user.
 */
async function getAiEvents(userId) {
  const { data: records, error } = await supabase
    .from("LichTrinh")
    .select("*, CongViec(TieuDe, MoTa, MucDoUuTien)")
    .eq("UserID", userId)
    .eq("AI_DeXuat", true)
    .order("GioBatDau", { ascending: true });

  if (error) {
    console.error("Lỗi load AI events:", error);
    throw { status: 500, message: "Lỗi server" };
  }

  return (records || []).map((event) => {
    const title = event.CongViec?.TieuDe || event.TieuDe || "AI Đề xuất";
    const priorityColor = event.CongViec?.MucDoUuTien
      ? PRIORITY_COLORS[event.CongViec.MucDoUuTien] || "#8B5CF6"
      : "#8B5CF6";
    return {
      id: event.MaLichTrinh,
      MaLichTrinh: event.MaLichTrinh,
      MaCongViec: event.MaCongViec,
      title,
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
}

/**
 * POST /api/calendar/events
 * Creates a new calendar event and optionally marks the linked task in-progress.
 * Returns { eventId }.
 */
async function createEvent(userId, body) {
  const title = body.TieuDe ?? body.title;
  const start = body.GioBatDau ?? body.start;
  const end = body.GioKetThuc ?? body.end;
  const note = body.GhiChu ?? body.note;
  const completed = body.DaHoanThanh ?? body.completed;
  const aiSuggested = body.AI_DeXuat ?? body.aiSuggested;
  const taskId = body.MaCongViec ?? body.taskId;

  if (!title || !start) {
    throw { status: 400, message: "Thiếu thông tin bắt buộc" };
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
    throw { status: 500, message: "Lỗi server khi tạo sự kiện", devDetail: error.message };
  }

  if (taskId) {
    await supabase
      .from("CongViec")
      .update({ TrangThaiThucHien: 1 })
      .eq("MaCongViec", taskId)
      .eq("UserID", userId);
  }

  return result.MaLichTrinh;
}

/**
 * PUT /api/calendar/events/:id
 * Updates mutable fields on a calendar event.
 */
async function updateEvent(eventId, userId, body) {
  const updateData = {};

  const title = body.TieuDe ?? body.title;
  const note = body.GhiChu ?? body.note;
  const start = body.GioBatDau ?? body.start;
  const end = body.GioKetThuc ?? body.end;
  const completed = body.DaHoanThanh ?? body.completed;

  if (title !== undefined) updateData.TieuDe = title;
  if (note !== undefined) updateData.GhiChu = note;
  if (start !== undefined) updateData.GioBatDau = new Date(start).toISOString();
  if (end !== undefined) updateData.GioKetThuc = end ? new Date(end).toISOString() : null;
  if (completed !== undefined) updateData.DaHoanThanh = completed ? true : false;

  if (Object.keys(updateData).length === 0) {
    throw { status: 400, message: "Không có gì để cập nhật" };
  }

  const { error } = await supabase
    .from("LichTrinh")
    .update(updateData)
    .eq("MaLichTrinh", eventId)
    .eq("UserID", userId);

  if (error) {
    console.error("[updateEvent] Supabase error:", error.message);
    throw { status: 500, message: error.message || "Lỗi cập nhật sự kiện" };
  }

  if (updateData.DaHoanThanh === true) {
    const { data: ev } = await supabase.from("LichTrinh").select("MaCongViec").eq("MaLichTrinh", eventId).maybeSingle();
    if (ev?.MaCongViec) {
      const sync = require("./group-task-sync-service");
      await sync.autoCompleteIfAllSessionsDone(ev.MaCongViec);
    }
  }
}

/**
 * DELETE /api/calendar/events/:id
 * Removes a calendar event.
 */
async function deleteEvent(eventId, userId) {
  await supabase
    .from("LichTrinh")
    .delete()
    .eq("MaLichTrinh", eventId)
    .eq("UserID", userId);
}

module.exports = {
  getEvents,
  getEventsInRange,
  getAiEvents,
  createEvent,
  updateEvent,
  deleteEvent,
};
