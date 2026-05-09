/**
 * ai-history-controller.js
 * Handles req/res for AI history, stats, and schedule-image-import endpoints.
 * Schedule/event endpoints live in ai-schedule-controller.js.
 * Used by ai.js router (via ai-controller.js facade).
 */

const { supabase } = require("../config/database");
const { callGeminiVision } = require("../services/ai-prompt-service");
const { checkRateLimit } = require("../utils/rate-limit");
const { buildScheduleImagePrompt } = require("../utils/schedule-image-prompt");
const { matchUserNameInItems } = require("../utils/name-matcher");

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_TYPES = new Set(["study", "work"]);
const ALLOWED_LEVELS = new Set(["thcs", "thpt", "dai_hoc", "di_lam", "khac"]);
const MAX_BASE64_BYTES = Math.ceil(8 * 1024 * 1024 * 1.37); // ~8 MB binary

/** GET /api/ai/history */
async function getHistory(req, res) {
  try {
    const userId = req.userId;
    const { limit = 20, offset = 0 } = req.query;

    const { data: records, error } = await supabase
      .from("PhienAIDeXuat").select("*").eq("UserID", userId)
      .order("NgayDeXuat", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      console.warn("PhienAIDeXuat table may not exist:", error.message);
      return res.json({
        success: true, data: [],
        stats: { total: 0, totalProposals: 0, appliedCount: 0, pendingCount: 0, appliedPercentage: 0 },
        pagination: { limit: parseInt(limit), offset: parseInt(offset), total: 0 },
      });
    }

    const { count } = await supabase.from("PhienAIDeXuat").select("*", { count: "exact", head: true }).eq("UserID", userId);
    const { data: allRecords } = await supabase.from("PhienAIDeXuat").select("DaApDung").eq("UserID", userId);
    const appliedCount = (allRecords || []).filter((r) => r.DaApDung).length;
    const pendingCount = (allRecords || []).length - appliedCount;
    const total = count || 0;

    res.json({
      success: true,
      data: records || [],
      stats: {
        total, totalProposals: (allRecords || []).length, appliedCount, pendingCount,
        appliedPercentage: (allRecords || []).length ? Math.round((appliedCount / (allRecords || []).length) * 100) : 0,
      },
      pagination: { limit: parseInt(limit), offset: parseInt(offset), total },
    });
  } catch (error) {
    console.error("Error getting AI history:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/** PUT /api/ai/history/:id */
async function updateHistory(req, res) {
  try {
    const userId = req.userId;
    const proposalId = req.params.id;
    const { DaApDung } = req.body;

    const { data: existing } = await supabase.from("PhienAIDeXuat").select("MaPhienDeXuat").eq("MaPhienDeXuat", proposalId).eq("UserID", userId).single();
    if (!existing) return res.status(403).json({ success: false, message: "Không có quyền truy cập proposal này" });

    const updateData = {
      DaApDung: DaApDung ? true : false,
      ThoiGianApDung: DaApDung ? new Date().toISOString() : null,
    };
    await supabase.from("PhienAIDeXuat").update(updateData).eq("MaPhienDeXuat", proposalId);
    res.json({ success: true, message: `Đã cập nhật proposal #${proposalId}` });
  } catch (error) {
    console.error("Error updating proposal:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/** GET /api/ai/stats */
async function getStats(req, res) {
  try {
    const userId = req.userId;
    const { data: records, error } = await supabase.from("PhienAIDeXuat").select("DaApDung, ThoiGianApDung, NgayDeXuat").eq("UserID", userId);

    if (error) {
      return res.json({ success: true, data: { totalRequests: 0, appliedRequests: 0, pendingRequests: 0, appliedPercentage: 0, lastUsed: null } });
    }

    const allRecords = records || [];
    const totalRequests = allRecords.length;
    const appliedRequests = allRecords.filter((r) => r.DaApDung).length;
    const pendingRequests = totalRequests - appliedRequests;
    const appliedPercentage = totalRequests ? Math.round((appliedRequests / totalRequests) * 100) : 0;
    const lastApplied = allRecords.filter((r) => r.DaApDung && r.ThoiGianApDung).sort((a, b) => new Date(b.ThoiGianApDung) - new Date(a.ThoiGianApDung))[0];
    const lastRequested = [...allRecords].sort((a, b) => new Date(b.NgayDeXuat) - new Date(a.NgayDeXuat))[0];

    res.json({ success: true, data: { totalRequests, appliedRequests, pendingRequests, appliedPercentage, lastUsed: lastApplied?.ThoiGianApDung || lastRequested?.NgayDeXuat || null } });
  } catch (error) {
    console.error("Error getting AI stats:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

/** POST /api/ai/parse-schedule-image */
async function parseScheduleImage(req, res) {
  try {
    const { imageBase64, mimeType, type, windowStart, windowEnd, forceLevel } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Thiếu imageBase64" });
    }
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Định dạng ảnh không hỗ trợ (chỉ jpeg/png/webp)" });
    }
    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "type phải là 'study' hoặc 'work'" });
    }
    if (!windowStart || !windowEnd) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "Thiếu windowStart/windowEnd" });
    }
    if (imageBase64.length > MAX_BASE64_BYTES) {
      return res.status(413).json({ success: false, error: "IMAGE_TOO_LARGE", message: "Ảnh quá lớn (tối đa 8MB). Vui lòng nén hoặc chụp lại." });
    }

    const rl = checkRateLimit(req.userId, 10);
    if (!rl.allowed) {
      const minutes = Math.ceil(rl.resetInMs / 60000);
      return res.status(429).json({ success: false, error: "RATE_LIMITED", message: `Bạn đã đạt giới hạn 10 lần quét/giờ. Vui lòng thử lại sau ${minutes} phút.` });
    }

    const { data: user, error: userErr } = await supabase.from("Users").select("HoTen, Username, HocVan").eq("UserID", req.userId).single();
    if (userErr || !user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND", message: "Không tìm thấy user" });

    const level = (forceLevel && ALLOWED_LEVELS.has(forceLevel) && forceLevel) || user.HocVan || "dai_hoc";
    const prompt = buildScheduleImagePrompt({ type, level, windowStart, windowEnd });

    let aiOutput;
    try {
      aiOutput = await callGeminiVision(prompt, imageBase64, mimeType);
    } catch (err) {
      console.error("[parse-schedule-image] vision failed:", err.message);
      const msg = String(err.message || "").toLowerCase();
      const isOverload = msg.includes("503") || msg.includes("overload") || msg.includes("busy") || msg.includes("unavailable") || msg.includes("high demand");
      const isParseFail = msg.includes("expected") || msg.includes("position") || msg.includes("unexpected") || msg.includes("no json");
      return res.status(503).json({
        success: false, error: "AI_UNAVAILABLE",
        message: isOverload ? "Dịch vụ AI đang quá tải. Vui lòng thử lại sau khoảng 1-2 phút."
          : isParseFail ? "AI trả về dữ liệu không hợp lệ. Thử lại lần nữa hoặc chụp ảnh rõ hơn."
          : "Không đọc được nội dung ảnh. Ảnh có thể mờ hoặc không phải lịch — vui lòng thử ảnh khác.",
      });
    }

    const warnings = Array.isArray(aiOutput.warnings) ? [...aiOutput.warnings] : [];
    const items = [];
    for (const raw of aiOutput.items || []) {
      if (!raw || !raw.title || !raw.startAt || !raw.endAt) {
        warnings.push(`Bỏ qua 1 dòng do thiếu dữ liệu: ${raw?.sourceRow || "?"}`);
        continue;
      }
      items.push({
        title: String(raw.title).trim(), startAt: raw.startAt, endAt: raw.endAt,
        courseCode: raw.courseCode || null, campus: raw.campus || null, location: raw.location || null,
        note: raw.note || null, assignees: Array.isArray(raw.assignees) ? raw.assignees : undefined,
        confidence: typeof raw.confidence === "number" ? raw.confidence : null, sourceRow: raw.sourceRow || null,
      });
    }

    if (type === "work") {
      const nameForMatch = user.HoTen || user.Username || "";
      if (!nameForMatch) {
        return res.status(422).json({ success: false, error: "NO_NAME_MATCH", message: "Hồ sơ của bạn chưa có Họ tên. Vui lòng cập nhật trong Hồ sơ trước khi quét lịch làm." });
      }
      const { matched, unmatchedAssignees } = matchUserNameInItems(items, nameForMatch);
      if (matched.length === 0) {
        return res.status(422).json({ success: false, error: "NO_NAME_MATCH", message: `Không tìm thấy "${nameForMatch}" trong lịch làm. Vui lòng chỉnh tên cá nhân trùng với tên trên lịch, hoặc bạn không có ca làm trong tuần này.`, data: { unmatchedAssignees } });
      }
      return res.json({ success: true, data: { type, items: matched, warnings } });
    }

    return res.json({ success: true, data: { type, items, warnings } });
  } catch (error) {
    console.error("[parse-schedule-image] unexpected:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { getHistory, updateHistory, getStats, parseScheduleImage };
