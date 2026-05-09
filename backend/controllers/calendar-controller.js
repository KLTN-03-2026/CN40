/**
 * calendar-controller.js
 * Handles req/res for LichTrinh (calendar/schedule) endpoints.
 * Delegates business logic to calendar-service.js.
 */

const calendarService = require("../services/calendar-service");

/** GET /api/calendar/events */
async function getEvents(req, res) {
  try {
    const data = await calendarService.getEvents(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi lấy events:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });
  }
}

/** GET /api/calendar/range */
async function getEventsInRange(req, res) {
  try {
    const data = await calendarService.getEventsInRange(
      req.userId,
      req.query.start,
      req.query.end
    );
    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi load lịch theo range:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });
  }
}

/** GET /api/calendar/ai-events */
async function getAiEvents(req, res) {
  try {
    const data = await calendarService.getAiEvents(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi load AI events:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server khi tải AI events" });
  }
}

/** POST /api/calendar/events */
async function createEvent(req, res) {
  try {
    const eventId = await calendarService.createEvent(req.userId, req.body);
    res.json({ success: true, eventId, message: "Tạo sự kiện thành công" });
  } catch (err) {
    console.error("Lỗi tạo lịch:", err);
    const body = { success: false, message: err.message || "Lỗi server khi tạo sự kiện" };
    if (err.devDetail && process.env.NODE_ENV === "development") body.error = err.devDetail;
    res.status(err.status || 500).json(body);
  }
}

/** PUT /api/calendar/events/:id */
async function updateEvent(req, res) {
  try {
    await calendarService.updateEvent(req.params.id, req.userId, req.body);
    res.json({ success: true, message: "Cập nhật sự kiện thành công" });
  } catch (err) {
    console.error("Lỗi cập nhật:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server khi cập nhật sự kiện" });
  }
}

/** DELETE /api/calendar/events/:id */
async function deleteEvent(req, res) {
  try {
    await calendarService.deleteEvent(req.params.id, req.userId);
    res.json({ success: true, message: "Xóa sự kiện thành công" });
  } catch (err) {
    console.error("Lỗi xóa:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server khi xóa sự kiện" });
  }
}

module.exports = { getEvents, getEventsInRange, getAiEvents, createEvent, updateEvent, deleteEvent };
