/**
 * ai-reference.js
 * "Tham khảo AI" section endpoints. Separate feature from `/api/ai/*` so
 * that each AI capability can hold its own Gemini API key quota.
 *
 * Mounted at /api/ai-reference by server.js (auth already applied).
 *
 *   POST /api/ai-reference/suggest-schedule
 *     body: { taskIds: number[], dateStart: "YYYY-MM-DD", dateEnd: "YYYY-MM-DD",
 *             additionalInstructions?: string, workingHours?: {start, end} }
 *     → AI proposes time slots that AVOID existing busy slots in the range.
 *       Nothing is written to LichTrinh — proposals live client-side until Apply.
 *
 *   POST /api/ai-reference/apply-proposals
 *     body: { proposals: [{ taskId, title, start, end, note? }] }
 *     → Inserts LichTrinh rows with AI_DeXuat=true, scoped to req.userId.
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
require("dotenv").config();

// Separate Gemini key per feature to split rate-limit pools. Falls back to
// the shared GEMINI_API_KEY so local dev still works when the feature key
// hasn't been set up yet.
const apiKey =
  (process.env.GEMINI_API_KEY_SCHEDULE_SUGGEST || "").trim() ||
  (process.env.GEMINI_API_KEY || "").trim();

let model = null;
if (apiKey) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.6,
        topP: 0.85,
        topK: 40,
        maxOutputTokens: 4096,
      },
    });
    console.log(
      "[ai-reference] Gemini initialized (" +
        (process.env.GEMINI_API_KEY_SCHEDULE_SUGGEST
          ? "dedicated key"
          : "fallback shared key") +
        ")"
    );
  } catch (e) {
    console.error("[ai-reference] Gemini init failed:", e.message);
  }
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dayBounds(dateStart, dateEnd) {
  // Interpret as Asia/Bangkok local days, return UTC ISO window.
  const s = new Date(`${dateStart}T00:00:00+07:00`);
  const e = new Date(`${dateEnd}T23:59:59+07:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) {
    return null;
  }
  return { startIso: s.toISOString(), endIso: e.toISOString() };
}

function extractJson(text) {
  if (!text) return null;
  // Strip fenced code blocks first.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fence ? fence[1] : text;
  const m = body.match(/{[\s\S]*}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function buildPrompt({ tasks, dateStart, dateEnd, busy, workingHours, extra }) {
  const wh = workingHours || { start: "08:00", end: "22:00" };
  // Human-readable labels for enum-like attributes kept on CongViec so the
  // model can reason about them without training on our internal codes.
  // ThoiDiemThichHop is stored as "1"/"2"/"3"/"4" (aligned with create-task-modal).
  const TIME_SLOT_LABEL = {
    "1": "buổi sáng (07-11h)",
    "2": "buổi trưa (11-13h)",
    "3": "buổi chiều (13-17h)",
    "4": "buổi tối (17-22h)",
  };
  const tasksSpec = tasks
    .map((t, i) => {
      const parts = [
        `id=${t.MaCongViec}`,
        `"${t.TieuDe}"`,
        `ưu tiên=${t.MucDoUuTien || 2}`,
        `ước tính=${t.ThoiGianUocTinh || 60} phút`,
      ];
      if (t.MucDoPhucTap) parts.push(`độ phức tạp=${t.MucDoPhucTap}/5`);
      if (t.MucDoTapTrung) parts.push(`độ tập trung cần=${t.MucDoTapTrung}/5`);
      if (t.ThoiDiemThichHop) {
        parts.push(
          `thời điểm phù hợp=${TIME_SLOT_LABEL[t.ThoiDiemThichHop] || t.ThoiDiemThichHop}`
        );
      }
      if (t.CoThoiGianCoDinh) {
        parts.push(`giờ CỐ ĐỊNH ${t.GioBatDauCoDinh} -> ${t.GioKetThucCoDinh}`);
      }
      if (t.TenLoai) parts.push(`danh mục=${t.TenLoai}`);
      if (t.Tag) parts.push(`tag=${t.Tag}`);
      if (t.MoTa) parts.push(`note=${t.MoTa.slice(0, 120)}`);
      return `${i + 1}. ${parts.join(" | ")}`;
    })
    .join("\n");

  const busySpec = busy.length
    ? busy
        .map(
          (b) =>
            `- ${b.GioBatDau} -> ${b.GioKetThuc || b.GioBatDau} (${
              b.TieuDe || "busy"
            })`
        )
        .join("\n")
    : "(không có)";

  return `Bạn là AI sắp xếp lịch trình cá nhân cho người dùng Việt Nam.
Nhiệm vụ: đề xuất time slot cho ${tasks.length} task sau, trong khoảng ${dateStart} đến ${dateEnd} (múi giờ Asia/Bangkok, UTC+07:00).

RÀNG BUỘC BẮT BUỘC:
- Chỉ xếp trong khung giờ làm việc ${wh.start}-${wh.end}.
- KHÔNG overlap với các slot đã bận dưới đây (luôn né).
- Tôn trọng "giờ CỐ ĐỊNH" nếu task đã có — giữ nguyên khung đó, không đổi.
- Mỗi task dùng đúng "ước tính" phút làm thời lượng (start + ước tính = end).
- Task ưu tiên cao (số lớn hơn = cao hơn: 4 Rất cao, 3 Cao, 2 TB, 1 Thấp) nên được xếp sớm hơn trong khoảng thời gian.
- Không lập lịch quá 1 task tại cùng một thời điểm.
- Cân đối khối lượng theo ngày — đừng dồn hết vào một ngày nếu có thể trải đều.
- Nếu task có "độ phức tạp" hoặc "độ tập trung cần" ≥4/5 → ưu tiên xếp vào khung giờ năng suất cao (sáng/đầu giờ chiều), tránh cuối ngày.
- Nếu task có "thời điểm phù hợp" → cố gắng xếp vào khung đó, chỉ lệch khi bị bận.

TASK CẦN XẾP:
${tasksSpec}

SLOT ĐÃ BẬN (tránh):
${busySpec}

${extra ? "YÊU CẦU BỔ SUNG CỦA USER:\n" + extra + "\n" : ""}
TRẢ VỀ DUY NHẤT JSON theo schema sau, KHÔNG markdown, KHÔNG giải thích ngoài JSON:
{
  "proposals": [
    { "taskId": <number>, "title": "<giữ nguyên tiêu đề task>", "start": "<ISO UTC>", "end": "<ISO UTC>", "reason": "<1 câu ngắn lý do chọn slot này>" }
  ]
}`;
}

/**
 * Server-side conflict guard — AI may slip; verify each proposal against
 * both the busy set AND other proposals, reject overlaps.
 */
function filterNonOverlapping(proposals, busy) {
  const toMs = (iso) => new Date(iso).getTime();
  const busyIntervals = busy
    .filter((b) => b.GioBatDau && b.GioKetThuc)
    .map((b) => [toMs(b.GioBatDau), toMs(b.GioKetThuc)]);

  const kept = [];
  const skipped = [];

  for (const p of proposals) {
    const s = toMs(p.start);
    const e = toMs(p.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      skipped.push({ ...p, reason: "invalid time" });
      continue;
    }
    const hitsBusy = busyIntervals.some(([bs, be]) => s < be && bs < e);
    const hitsKept = kept.some((k) => {
      const ks = toMs(k.start);
      const ke = toMs(k.end);
      return s < ke && ks < e;
    });
    if (hitsBusy || hitsKept) {
      skipped.push({ ...p, reason: hitsBusy ? "overlap busy" : "overlap sibling" });
      continue;
    }
    kept.push(p);
  }
  return { kept, skipped };
}

// POST /api/ai-reference/suggest-schedule
router.post("/suggest-schedule", async (req, res) => {
  try {
    const userId = req.userId;
    const { taskIds, dateStart, dateEnd, additionalInstructions, workingHours } =
      req.body || {};

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, message: "Thiếu taskIds" });
    }
    if (!isValidDateStr(dateStart) || !isValidDateStr(dateEnd)) {
      return res
        .status(400)
        .json({ success: false, message: "dateStart/dateEnd phải YYYY-MM-DD" });
    }
    const bounds = dayBounds(dateStart, dateEnd);
    if (!bounds) {
      return res
        .status(400)
        .json({ success: false, message: "Khoảng ngày không hợp lệ" });
    }
    if (!model) {
      return res.status(503).json({
        success: false,
        message:
          "Gemini chưa được cấu hình cho tính năng này (thiếu GEMINI_API_KEY_SCHEDULE_SUGGEST).",
      });
    }

    // Fetch tasks by id, scoped to user for safety.
    const normalizedIds = Array.from(
      new Set(taskIds.map((x) => parseInt(x, 10)).filter(Number.isFinite))
    );
    if (normalizedIds.length === 0) {
      return res.status(400).json({ success: false, message: "taskIds rỗng" });
    }
    const { data: tasks, error: tErr } = await supabase
      .from("CongViec")
      .select(
        "MaCongViec, TieuDe, MoTa, MucDoUuTien, ThoiGianUocTinh, MucDoPhucTap, MucDoTapTrung, ThoiDiemThichHop, Tag, CoThoiGianCoDinh, GioBatDauCoDinh, GioKetThucCoDinh, LoaiCongViec(TenLoai)"
      )
      .in("MaCongViec", normalizedIds)
      .eq("UserID", userId);
    if (tErr) {
      console.error("[ai-reference] load tasks:", tErr);
      return res.status(500).json({ success: false, message: "Lỗi tải task" });
    }
    if (!tasks || tasks.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Không tìm thấy task" });
    }
    const shapedTasks = tasks.map((t) => ({
      ...t,
      TenLoai: t.LoaiCongViec?.TenLoai || null,
    }));

    // Fetch busy slots in range (every LichTrinh row for this user).
    const { data: busyRows, error: bErr } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, TieuDe, GioBatDau, GioKetThuc")
      .eq("UserID", userId)
      .gte("GioBatDau", bounds.startIso)
      .lte("GioBatDau", bounds.endIso);
    if (bErr) {
      console.error("[ai-reference] load busy:", bErr);
      return res.status(500).json({ success: false, message: "Lỗi tải lịch" });
    }
    const busy = busyRows || [];

    const prompt = buildPrompt({
      tasks: shapedTasks,
      dateStart,
      dateEnd,
      busy,
      workingHours,
      extra: typeof additionalInstructions === "string" ? additionalInstructions.trim() : "",
    });

    let parsed = null;
    try {
      const geminiPromise = model.generateContent(prompt).then(async (result) => {
        return (await result.response).text();
      });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini timeout (30s)")), 30000)
      );
      const text = await Promise.race([geminiPromise, timeout]);
      parsed = extractJson(text);
    } catch (e) {
      console.error("[ai-reference] Gemini call:", e.message);
      return res
        .status(502)
        .json({ success: false, message: `Gemini không phản hồi: ${e.message}` });
    }

    if (!parsed || !Array.isArray(parsed.proposals)) {
      return res.status(502).json({
        success: false,
        message: "AI trả định dạng không hợp lệ, thử lại hoặc thu hẹp danh sách.",
      });
    }

    // Normalise + verify: only keep proposals whose taskId was actually asked for.
    const askedSet = new Set(normalizedIds);
    const normalized = parsed.proposals
      .map((p) => ({
        taskId: parseInt(p.taskId, 10),
        title: String(p.title || "").trim(),
        start: String(p.start || "").trim(),
        end: String(p.end || "").trim(),
        reason: String(p.reason || "").trim(),
      }))
      .filter((p) => askedSet.has(p.taskId) && p.start && p.end && p.title);

    // Server-side conflict filter — AI can slip, we enforce the hard rule.
    const { kept, skipped } = filterNonOverlapping(normalized, busy);

    return res.json({
      success: true,
      data: {
        proposals: kept,
        skipped,
        stats: {
          requested: normalizedIds.length,
          proposed: normalized.length,
          applied: kept.length,
          droppedForConflict: skipped.length,
        },
      },
    });
  } catch (err) {
    console.error("[ai-reference] suggest exception:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// POST /api/ai-reference/apply-proposals
router.post("/apply-proposals", async (req, res) => {
  try {
    const userId = req.userId;
    const { proposals } = req.body || {};
    if (!Array.isArray(proposals) || proposals.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu proposals" });
    }
    if (proposals.length > 200) {
      return res
        .status(400)
        .json({ success: false, message: "Tối đa 200 proposal mỗi lần" });
    }

    const rows = [];
    for (const p of proposals) {
      const taskId = parseInt(p?.taskId, 10);
      const start = typeof p?.start === "string" ? p.start : null;
      const end = typeof p?.end === "string" ? p.end : null;
      const title = typeof p?.title === "string" ? p.title.trim() : "";
      if (!Number.isFinite(taskId) || !start || !end || !title) continue;
      rows.push({
        MaCongViec: taskId,
        UserID: userId,
        TieuDe: title,
        GhiChu: typeof p?.note === "string" ? p.note : null,
        GioBatDau: start,
        GioKetThuc: end,
        DaHoanThanh: false,
        AI_DeXuat: true,
      });
    }
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Không có proposal hợp lệ",
      });
    }

    const { data, error } = await supabase
      .from("LichTrinh")
      .insert(rows)
      .select("MaLichTrinh");
    if (error) {
      console.error("[ai-reference] apply insert:", error);
      return res.status(500).json({ success: false, message: "Lỗi lưu" });
    }
    return res.json({
      success: true,
      data: {
        applied: data?.length || 0,
        ids: (data || []).map((r) => r.MaLichTrinh),
      },
    });
  } catch (err) {
    console.error("[ai-reference] apply exception:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
module.exports.__test = { isValidDateStr, dayBounds, extractJson, filterNonOverlapping };
