// /taocongviec <natural language>
// Parses a short Vietnamese sentence via Gemini into a task spec, then
// creates a CongViec row and a matching LichTrinh entry.
//
// Uses GEMINI_API_KEY_TELEGRAM to split rate-limit from the web task
// creator. When Gemini is unavailable, falls back to a crude parser so
// users aren't blocked entirely.

const { supabase } = require("../../config/database");

const apiKey =
  (process.env.GEMINI_API_KEY_TELEGRAM || "").trim() ||
  (process.env.GEMINI_API_KEY || "").trim();

let model = null;
if (apiKey) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    });
    console.log("[/taocongviec] Gemini ready");
  } catch (e) {
    console.error("[/taocongviec] Gemini init failed:", e.message);
  }
}

function register(bot) {
  bot.onText(/^\/taocongviec(?:\s+([\s\S]+))?/i, (msg, match) => {
    handleCreate(bot, msg, (match && match[1]) || "");
  });
}

async function handleCreate(bot, msg, text) {
  const chatId = msg.chat.id;

  if (!text.trim()) {
    await bot.sendMessage(
      chatId,
      "Cú pháp: <code>/taocongviec &lt;mô tả&gt; [-note: ghi chú]</code>\n\n" +
        "Ví dụ:\n" +
        "• <code>/taocongviec họp team 3h chiều mai 1 tiếng</code>\n" +
        "• <code>/taocongviec học React 8h sáng 2 tiếng -note: đọc chương 3</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  try {
    const { data: conn } = await supabase
      .from("TelegramConnections")
      .select("UserID")
      .eq("TelegramChatId", chatId.toString())
      .maybeSingle();
    if (!conn) {
      await bot.sendMessage(chatId, "❌ Bạn chưa kết nối. Gõ /start.");
      return;
    }

    // Extract "-note: ..." section before parsing so Gemini sees only the schedule phrase.
    const { schedulePart, userNote } = splitUserNote(text);

    const parsed = await parseTask(schedulePart);
    if (!parsed?.title) {
      await bot.sendMessage(chatId, "❌ Không hiểu yêu cầu. Thử lại với mô tả rõ hơn.");
      return;
    }

    const defaultCat = await ensureDefaultCategory(conn.UserID);

    const start = parsed.startIso ? new Date(parsed.startIso) : null;
    const durationMin = Number(parsed.durationMin) || 30;
    const end =
      start
        ? new Date(start.getTime() + durationMin * 60 * 1000)
        : null;

    // Combine Gemini-extracted description with user's explicit -note text.
    const description = [parsed.description, userNote].filter(Boolean).join("\n").trim();

    const { data: created, error: taskErr } = await supabase
      .from("CongViec")
      .insert({
        UserID: conn.UserID,
        MaLoai: defaultCat,
        TieuDe: parsed.title.slice(0, 120),
        MoTa: description,
        CoThoiGianCoDinh: !!start,
        GioBatDauCoDinh: start ? start.toISOString() : null,
        GioKetThucCoDinh: end ? end.toISOString() : null,
        TrangThaiThucHien: 0,
        ThoiGianUocTinh: durationMin,
        MucDoUuTien: 2,
        NgayTao: new Date().toISOString(),
        LuongTheoGio: 0,
      })
      .select("MaCongViec, TieuDe")
      .single();

    if (taskErr) throw taskErr;

    if (start && end) {
      await supabase.from("LichTrinh").insert({
        UserID: conn.UserID,
        MaCongViec: created.MaCongViec,
        TieuDe: created.TieuDe,
        GioBatDau: start.toISOString(),
        GioKetThuc: end.toISOString(),
        GhiChu: userNote || null,
        DaHoanThanh: false,
        AI_DeXuat: true,
        NgayTao: new Date().toISOString(),
      });
    }

    const whenLine =
      start
        ? `\n⏰ ${start.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} (${durationMin} phút)`
        : "";
    const noteLine = description ? `\n📝 ${esc(description)}` : "";
    const hint = userNote
      ? ""
      : "\n\n💡 Mẹo: thêm <code>-note: ...</code> vào cuối để ghi chú chi tiết.";
    await bot.sendMessage(
      chatId,
      `✅ <b>Đã tạo công việc</b>\n\n<b>${esc(created.TieuDe)}</b>${whenLine}${noteLine}${hint}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[/taocongviec] failed:", err);
    await bot.sendMessage(chatId, "❌ Lỗi tạo công việc: " + (err.message || "unknown"));
  }
}

// HTML-escape for Telegram parse_mode: "HTML".
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split input on the first `-note:` marker (case-insensitive, flexible spacing).
// Returns { schedulePart, userNote } — both trimmed.
function splitUserNote(text) {
  const m = text.match(/\s[-–—]\s*note\s*[:：]\s*/i);
  if (!m) return { schedulePart: text.trim(), userNote: "" };
  const idx = m.index;
  return {
    schedulePart: text.slice(0, idx).trim(),
    userNote: text.slice(idx + m[0].length).trim(),
  };
}

async function ensureDefaultCategory(userId) {
  const { data: existing } = await supabase
    .from("LoaiCongViec")
    .select("MaLoai")
    .eq("UserID", userId)
    .limit(1);
  if (existing?.length) return existing[0].MaLoai;

  const { data: created, error } = await supabase
    .from("LoaiCongViec")
    .insert({ UserID: userId, TenLoai: "Khác", MoTa: "Danh mục mặc định" })
    .select("MaLoai")
    .single();
  if (error) throw error;
  return created.MaLoai;
}

async function parseTask(text) {
  if (model) {
    try {
      const todayIso = new Date().toISOString();
      const prompt =
        "Bạn trích xuất thông tin công việc từ 1 câu tiếng Việt và trả về JSON thuần (KHÔNG markdown, KHÔNG giải thích).\n\n" +
        `Hôm nay là ${todayIso} (múi giờ Asia/Ho_Chi_Minh, UTC+7).\n\n` +
        "Schema:\n" +
        "{\n" +
        '  "title": "Tên hoạt động, viết hoa chữ đầu, KHÔNG chứa thời gian/ngày/thời lượng",\n' +
        '  "description": "Chi tiết bổ sung người dùng nêu (ngoài tên + thời gian). Để \\"\\" nếu không có",\n' +
        '  "startIso": "ISO8601 có offset +07:00 nếu suy ra được thời điểm bắt đầu, null nếu không rõ",\n' +
        '  "durationMin": số phút (mặc định 30 nếu không rõ)\n' +
        "}\n\n" +
        "QUY TẮC title — RẤT QUAN TRỌNG:\n" +
        '• CHỈ lấy danh động từ mô tả hoạt động. Ví dụ: "họp team 3h chiều mai 1 tiếng" → title = "Họp team".\n' +
        '• BỎ mọi cụm thời gian: "3h chiều", "mai", "hôm nay", "8h sáng", "tối nay", "thứ 3", "ngày 20/5"...\n' +
        '• BỎ mọi cụm thời lượng: "1 tiếng", "30 phút", "2h", "trong 45 phút"...\n' +
        '• BỎ từ nối dư: "vào", "lúc", "từ", "đến", "trong"...\n\n' +
        "Ví dụ:\n" +
        'Câu: "họp team 3h chiều mai 1 tiếng"\n' +
        '→ {"title":"Họp team","description":"","startIso":"<ngày mai>T15:00:00+07:00","durationMin":60}\n\n' +
        'Câu: "học React 8h sáng thứ 2 2 tiếng xem chương 3"\n' +
        '→ {"title":"Học React","description":"xem chương 3","startIso":"<thứ 2 kế tiếp>T08:00:00+07:00","durationMin":120}\n\n' +
        `Câu cần phân tích: "${text}"`;
      const res = await model.generateContent(prompt);
      const raw = res.response.text();
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const json = JSON.parse((m ? m[1] : raw).trim());
      if (json?.title) {
        json.title = cleanTitle(json.title);
        return json;
      }
    } catch (err) {
      console.warn("[/taocongviec] Gemini parse failed:", err.message);
    }
  }
  return fallbackParse(text);
}

// Last-line defence: strip any time/duration phrases Gemini may have left in the title.
// Order matters — match longer/specific patterns BEFORE shorter generic ones.
function cleanTitle(title) {
  let t = String(title).trim();
  // 1. Clock time with period: "3h chiều", "8h sáng", "6h tối" (must run before plain-duration rule).
  t = t.replace(/\b\d{1,2}\s*(?:h|giờ)\s*\d{0,2}\s*(?:sáng|trưa|chiều|tối|đêm)\b/gi, "");
  // 2. Clock time HH:MM
  t = t.replace(/\b\d{1,2}:\d{2}\b/g, "");
  // 3. Duration: "1 tiếng", "30 phút", "2h", "1h30".
  t = t.replace(/\b\d+\s*(?:tiếng|giờ|h|phút|p)\b\s*\d*/gi, "");
  // 4. Bare period words ("tối", "sáng"…) left over from "8h sáng" → "sáng".
  t = t.replace(/\b(?:sáng|trưa|chiều|tối|đêm)\b/gi, "");
  // 5. Relative day words.
  t = t.replace(/\b(?:hôm nay|ngày mai|hôm qua|mai|tối nay|sáng mai|chiều mai|tối mai)\b/gi, "");
  t = t.replace(/\b(?:thứ\s*[2-7]|chủ nhật|cn)\b/gi, "");
  // 6. Filler connectors.
  t = t.replace(/\b(?:vào|lúc|từ|đến|trong|khoảng)\b/gi, "");
  // 7. Collapse whitespace and trim trailing punctuation.
  t = t.replace(/\s{2,}/g, " ").replace(/[\s,.;-]+$/g, "").trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.slice(0, 120);
}

// Fallback when Gemini is unavailable: just clean the title, no time extraction.
function fallbackParse(text) {
  return {
    title: cleanTitle(text) || text.trim().slice(0, 120),
    description: "",
    startIso: null,
    durationMin: 30,
  };
}

module.exports = { register };
