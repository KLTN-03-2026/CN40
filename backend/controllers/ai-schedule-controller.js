/**
 * ai-schedule-controller.js
 * Handles req/res for AI schedule suggestion and event management endpoints.
 * History/stats/image endpoints live in ai-history-controller.js.
 * Used by ai.js router.
 */

const { supabase } = require("../config/database");
const { geminiAvailable } = require("../services/ai-gemini-client");
const {
  getTaskDetailsFromDatabase,
  getExistingEvents,
  callGeminiAI,
  generateSimulatedScheduleWithInstructions,
  saveAiSuggestions,
  getColorByPriority,
} = require("../services/ai-schedule-service");
const { buildGeminiPrompt } = require("../services/ai-prompt-service");

/** POST /api/ai/suggest-schedule */
async function suggestSchedule(req, res) {
  try {
    const userId = req.userId;
    const { tasks: taskIds, startDate, endDate, options = {} } = req.body;
    const additionalInstructions = req.body.additionalInstructions || "";

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, message: "Vui lòng chọn ít nhất một công việc" });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Vui lòng chọn khoảng thời gian" });
    }

    const taskDetails = await getTaskDetailsFromDatabase(taskIds, userId);
    if (taskDetails.length === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy công việc được chọn" });
    }

    let existingEvents = [];
    if (options.avoidConflict) {
      try { existingEvents = await getExistingEvents(userId, startDate, endDate); }
      catch (_) { existingEvents = []; }
    }

    let aiResult;
    let mode = "simulation";

    if (geminiAvailable) {
      try {
        const prompt = buildGeminiPrompt(taskDetails, startDate, endDate, options, existingEvents, additionalInstructions);
        aiResult = await callGeminiAI(prompt);
        mode = "gemini";
      } catch (aiError) {
        console.error("Gemini AI failed:", aiError.message);
        aiResult = await generateSimulatedScheduleWithInstructions(taskDetails, startDate, endDate, options, existingEvents, additionalInstructions);
        mode = "simulation_fallback";
      }
    } else {
      aiResult = await generateSimulatedScheduleWithInstructions(taskDetails, startDate, endDate, options, existingEvents, additionalInstructions);
    }

    if (!aiResult.suggestions || !Array.isArray(aiResult.suggestions)) {
      throw new Error("Invalid response format from AI");
    }

    res.json({
      success: true,
      data: {
        suggestions: aiResult.suggestions.map((s) => ({
          taskId: s.taskId,
          scheduledTime: s.scheduledTime,
          durationMinutes: s.durationMinutes,
          reason: s.reason || "Được xếp tự động",
          color: s.color || "#8B5CF6",
        })),
        summary: aiResult.summary || `Đã tạo ${aiResult.suggestions.length} khung giờ`,
        statistics: aiResult.statistics || {
          totalTasks: aiResult.suggestions.length,
          totalHours: Math.round(aiResult.suggestions.reduce((sum, s) => sum + s.durationMinutes, 0) / 60),
          daysUsed: new Set(aiResult.suggestions.map((s) => new Date(s.scheduledTime).toDateString())).size,
        },
        mode,
      },
      message: mode === "gemini" ? "AI đã tạo lịch trình thành công" : "Đã tạo lịch trình (chế độ mô phỏng)",
    });
  } catch (error) {
    console.error("AI processing failed:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi xử lý AI",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      mode: "error",
    });
  }
}

/** POST /api/ai/save-ai-suggestions */
async function saveAiSuggestionsHandler(req, res) {
  const { suggestions } = req.body;
  const userId = req.userId;

  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    return res.status(400).json({ success: false, message: "Danh sách rỗng" });
  }

  const uniqueKey = `${userId}_${suggestions.map((s) => s.taskId).sort().join("_")}`;
  if (global.lastAISaveKey === uniqueKey && Date.now() - global.lastAISaveTime < 5000) {
    return res.json({ success: true, saved: 0, message: "Đã lưu rồi, không lưu lại" });
  }
  global.lastAISaveKey = uniqueKey;
  global.lastAISaveTime = Date.now();

  try {
    const { savedIds, deletedCount } = await saveAiSuggestions(userId, suggestions);
    res.json({ success: true, saved: savedIds.length, savedIds, deletedOld: deletedCount });
  } catch (err) {
    console.error("Lỗi lưu AI suggestions:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/** GET /api/ai/ai-events */
async function getAiEvents(req, res) {
  try {
    const userId = req.userId;
    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, GhiChu, AI_DeXuat, CongViec(TieuDe, MucDoUuTien, MauSac)")
      .eq("UserID", userId).eq("AI_DeXuat", true).order("GioBatDau", { ascending: false });

    if (error) {
      console.error("Error fetching AI events:", error);
      return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }

    const eventMap = new Map();
    (records || []).forEach((r) => {
      const key = `${r.MaCongViec}_${new Date(r.GioBatDau).getTime()}`;
      if (!eventMap.has(key)) eventMap.set(key, r);
    });

    const events = Array.from(eventMap.values()).map((ev) => ({
      MaLichTrinh: ev.MaLichTrinh,
      MaCongViec: ev.MaCongViec,
      TieuDe: ev.CongViec?.TieuDe || "Lịch trình AI",
      GioBatDau: ev.GioBatDau,
      GioKetThuc: ev.GioKetThuc,
      GhiChu: ev.GhiChu || "Được AI tối ưu",
      Color: ev.CongViec?.MauSac || getColorByPriority(ev.CongViec?.MucDoUuTien || 2),
      priority: ev.CongViec?.MucDoUuTien,
      AI_DeXuat: ev.AI_DeXuat,
    }));

    res.json({ success: true, data: events });
  } catch (error) {
    console.error("Error fetching AI events:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
}

/** GET /api/ai/test */
function testAi(req, res) {
  res.json({
    success: true,
    geminiAvailable,
    model: "gemini-2.5-flash",
    message: geminiAvailable ? "Gemini AI is ready to use" : "Gemini AI is not available (check GEMINI_API_KEY in .env)",
    timestamp: new Date().toISOString(),
  });
}

/** DELETE /api/ai/clear-old-suggestions */
async function clearOldSuggestions(req, res) {
  try {
    const userId = req.userId;
    const { data: countData } = await supabase
      .from("LichTrinh").select("MaLichTrinh", { count: "exact" }).eq("UserID", userId).eq("AI_DeXuat", true);
    const oldCount = countData?.length || 0;
    await supabase.from("LichTrinh").delete().eq("UserID", userId).eq("AI_DeXuat", true);
    res.json({ success: true, clearedCount: oldCount, message: `Đã xóa ${oldCount} lịch trình AI cũ` });
  } catch (error) {
    console.error("Error clearing old AI suggestions:", error);
    res.status(500).json({ success: false, message: "Lỗi khi xóa lịch trình AI cũ", error: error.message });
  }
}

/** GET /api/ai/events/ai */
async function getEventsAi(req, res) {
  try {
    const userId = req.userId;
    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, GhiChu, CongViec!inner(TieuDe, MucDoUuTien, MauSac)")
      .eq("UserID", userId).eq("AI_DeXuat", true).order("GioBatDau", { ascending: false });
    if (error) { console.error("Lỗi lấy lịch AI:", error); return res.status(500).json({ success: false, message: error.message }); }
    const events = (records || []).map((ev) => ({
      MaLichTrinh: ev.MaLichTrinh, MaCongViec: ev.MaCongViec, TieuDe: ev.CongViec?.TieuDe,
      GioBatDau: ev.GioBatDau, GioKetThuc: ev.GioKetThuc, GhiChu: ev.GhiChu || "AI đề xuất",
      Color: ev.CongViec?.MauSac || getColorByPriority(ev.CongViec?.MucDoUuTien || 2),
      priority: ev.CongViec?.MucDoUuTien, AI_DeXuat: 1,
    }));
    res.json({ success: true, data: events });
  } catch (err) { console.error("Lỗi lấy lịch AI:", err); res.status(500).json({ success: false, message: err.message }); }
}

/** GET /api/ai/debug-ai-events */
async function debugAiEvents(req, res) {
  try {
    const userId = req.userId;
    const { data: countData } = await supabase.from("LichTrinh").select("MaLichTrinh", { count: "exact" }).eq("UserID", userId).eq("AI_DeXuat", true);
    const { data: detailData } = await supabase.from("LichTrinh").select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat, CongViec(TieuDe, UserID)").eq("UserID", userId).eq("AI_DeXuat", true).order("GioBatDau", { ascending: false });
    res.json({ success: true, debug: { totalAIEvents: countData?.length || 0, events: detailData || [], queryConditions: { userId, AI_DeXuat: true } } });
  } catch (error) { console.error("Debug error:", error); res.status(500).json({ success: false, message: error.message }); }
}

/** GET /api/ai/test-database-ai */
async function testDatabaseAi(req, res) {
  try {
    const userId = req.userId;
    const { data: allEvents } = await supabase.from("LichTrinh").select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat, UserID").eq("UserID", userId).order("GioBatDau", { ascending: false });
    const { data: recentEvents } = await supabase.from("LichTrinh").select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat").eq("UserID", userId).order("MaLichTrinh", { ascending: false }).limit(10);
    res.json({ success: true, data: { totalEvents: (allEvents || []).length, allEvents: allEvents || [], recentEvents: recentEvents || [], userInfo: { userId, hasAIEvents: (allEvents || []).some((e) => e.AI_DeXuat === true) } } });
  } catch (error) { console.error("Test database error:", error); res.status(500).json({ success: false, message: error.message }); }
}

module.exports = {
  suggestSchedule,
  saveAiSuggestionsHandler,
  getAiEvents,
  testAi,
  clearOldSuggestions,
  getEventsAi,
  debugAiEvents,
  testDatabaseAi,
};
