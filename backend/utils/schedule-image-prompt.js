// ============================================================
// Prompt builder for Gemini Vision schedule-image parsing.
// Returns a single string prompt given type + user context.
// Phase 03 will refine per-role timing (tiết length, breaks).
// ============================================================

const TIET_TIMING = {
  // Cấp 2 (middle school): 7:00 start, 45 min tiết, 5 min break, 15 min between tiết 2-3
  thcs: {
    label: "Cấp 2",
    start: "07:00",
    tietMinutes: 45,
    notes: "Nghỉ 5 phút giữa các tiết, nghỉ dài 15 phút sau tiết 2.",
  },
  // Cấp 3 (high school): 7:00 start, 45 min, 5 min, 20 min long break
  thpt: {
    label: "Cấp 3",
    start: "07:00",
    tietMinutes: 45,
    notes: "Nghỉ 5 phút giữa các tiết, nghỉ dài 20 phút sau tiết 2.",
  },
  // Đại học: 1 tiết thường 50 phút; Vision prompt ưu tiên đọc giờ ghi trực tiếp trên ảnh
  dai_hoc: {
    label: "Đại học",
    start: null,
    tietMinutes: 50,
    notes:
      "Đọc giờ bắt đầu/kết thúc trực tiếp từ ảnh nếu có. Mỗi môn có thể xuất hiện nhiều buổi/tuần.",
  },
  di_lam: {
    label: "Đi làm",
    start: null,
    tietMinutes: null,
    notes: "Chỉ áp dụng cho lịch làm việc.",
  },
  khac: {
    label: "Khác",
    start: null,
    tietMinutes: null,
    notes: "Đọc giờ trực tiếp từ ảnh.",
  },
};

function tietHint(level) {
  const t = TIET_TIMING[level] || TIET_TIMING.khac;
  const parts = [`Học vấn: ${t.label}.`];
  if (t.start) parts.push(`Tiết 1 bắt đầu ${t.start}.`);
  if (t.tietMinutes) parts.push(`1 tiết = ${t.tietMinutes} phút.`);
  if (t.notes) parts.push(t.notes);
  return parts.join(" ");
}

// ------------------------------------------------------------
// Study prompt: user-owned timetable (no name filtering).
// Fields: title (tên môn), startAt/endAt (ISO), courseCode, campus, location.
// ------------------------------------------------------------
function buildStudyPrompt({ level, windowStart, windowEnd }) {
  return `Bạn là trợ lý đọc ảnh thời khóa biểu. Ảnh đính kèm là lịch học cá nhân.

${tietHint(level)}

NHIỆM VỤ:
- Trích xuất mọi buổi học trong ảnh.
- Mỗi buổi = 1 item trong JSON output.
- Nếu môn học lặp nhiều buổi trong tuần, trả về 1 item cho MỖI buổi (không gộp).
- Mỗi item đặt thời gian trong khoảng: ${windowStart} → ${windowEnd}.

ĐỊNH DẠNG OUTPUT (JSON đúng schema, không thêm bình luận):
{
  "items": [
    {
      "title": "Tên môn học",
      "startAt": "ISO 8601 với timezone",
      "endAt": "ISO 8601 với timezone",
      "courseCode": "Mã môn nếu có, null nếu không",
      "campus": "Cơ sở học nếu có, null nếu không",
      "location": "Phòng học nếu có, null nếu không",
      "note": "Ghi chú thêm hoặc null",
      "confidence": 0.0,
      "sourceRow": "Mô tả ngắn dòng trong ảnh đã trích"
    }
  ],
  "warnings": ["Cảnh báo bằng tiếng Việt nếu có dòng bị bỏ qua"]
}

QUAN TRỌNG:
- Trả VỀ JSON thuần, không markdown, không backtick.
- Nếu không đọc được giờ của 1 dòng → bỏ qua và thêm warning.
- confidence ∈ [0, 1] thể hiện độ chắc chắn.`;
}

// ------------------------------------------------------------
// Work prompt: shared work schedule.
// Vision extracts ALL shifts; backend filters by user.HoTen later.
// ------------------------------------------------------------
function buildWorkPrompt({ windowStart, windowEnd }) {
  return `Bạn là trợ lý đọc ảnh lịch làm việc (bảng phân ca).

NHIỆM VỤ:
- Trích xuất TẤT CẢ ca làm trong ảnh, kèm tên nhân viên.
- Mỗi ca của mỗi người = 1 item riêng (không gộp).
- Thời gian phải nằm trong: ${windowStart} → ${windowEnd}.

ĐỊNH DẠNG OUTPUT (JSON thuần, không markdown):
{
  "items": [
    {
      "title": "Ca làm (ví dụ: Ca sáng, Ca tối)",
      "startAt": "ISO 8601",
      "endAt": "ISO 8601",
      "assignees": ["Tên nhân viên 1", "Tên nhân viên 2"],
      "location": "Vị trí/chi nhánh nếu có",
      "note": "Ghi chú hoặc null",
      "confidence": 0.0,
      "sourceRow": "Mô tả ngắn dòng trích"
    }
  ],
  "warnings": []
}

QUAN TRỌNG:
- assignees là MẢNG TÊN viết nguyên văn như trong ảnh (giữ dấu tiếng Việt, viết hoa chữ cái đầu).
- Nếu một ô ca có nhiều người → tách ra nhiều item HOẶC 1 item với assignees nhiều phần tử.
- Không bịa tên. Không trả người không có trong ảnh.`;
}

/**
 * Main entry.
 * @param {{ type: 'study'|'work', level?: string, windowStart: string, windowEnd: string }} opts
 */
function buildScheduleImagePrompt(opts) {
  if (opts.type === "work") return buildWorkPrompt(opts);
  return buildStudyPrompt({
    level: opts.level || "dai_hoc",
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
  });
}

module.exports = { buildScheduleImagePrompt, TIET_TIMING };
