// Weekend AI digest — runs Sunday 20:30 VN time (just after weekly-stats).
// For each opted-in user, summarize their category activity over the last
// 14 days and ask Gemini to suggest 2-3 balancing tasks (e.g. if low on
// physical activity, propose walks / exercise). Falls back to a generic
// suggestion set when Gemini is unavailable.
//
// Uses GEMINI_API_KEY_TELEGRAM (separate rate-limit pool from task-creation
// and schedule-suggest). Falls back to GEMINI_API_KEY for dev convenience.

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
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 1024 },
    });
    console.log(
      "[weekend-ai] Gemini ready (" +
        (process.env.GEMINI_API_KEY_TELEGRAM ? "dedicated" : "shared fallback") +
        ")"
    );
  } catch (e) {
    console.error("[weekend-ai] Gemini init failed:", e.message);
  }
}

module.exports = {
  kind: "weekend",
  cronExpr: "30 20 * * 0", // Sunday 20:30

  async run({ supabase, getBot, logSent, alreadySent }) {
    const { data: users } = await supabase
      .from("TelegramConnections")
      .select("UserID, TrangThaiKetNoi, ThongBaoCuoiTuan")
      .eq("TrangThaiKetNoi", true)
      .eq("ThongBaoCuoiTuan", true);

    if (!users?.length) return;

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const bot = getBot();

    for (const u of users) {
      if (await alreadySent(u.UserID, 0, "weekend", 24 * 60)) continue;

      const profile = await loadCategoryActivity(
        supabase,
        u.UserID,
        fourteenDaysAgo.toISOString(),
        now.toISOString()
      );

      const suggestions = await generateSuggestions(profile);

      const msg = renderMessage(profile, suggestions);
      try {
        await bot.sendMessageToUser(u.UserID, msg);
        await logSent(u.UserID, 0, "weekend");
      } catch (err) {
        console.error(`[weekend-ai] send failed user ${u.UserID}:`, err.message);
      }
    }
  },
};

// -------------------------------------------------------------------------

async function loadCategoryActivity(supabase, userId, startIso, endIso) {
  const { data: rows } = await supabase
    .from("LichTrinh")
    .select("MaCongViec, GioBatDau, GioKetThuc, DaHoanThanh")
    .eq("UserID", userId)
    .eq("DaHoanThanh", true)
    .gte("GioBatDau", startIso)
    .lte("GioBatDau", endIso);

  const taskIds = [...new Set((rows || []).map((r) => r.MaCongViec).filter(Boolean))];

  let categoryByTask = new Map();
  if (taskIds.length) {
    const { data: tasks } = await supabase
      .from("CongViec")
      .select("MaCongViec, LoaiCongViec(TenLoai)")
      .in("MaCongViec", taskIds);
    for (const t of tasks || []) {
      categoryByTask.set(t.MaCongViec, t.LoaiCongViec?.TenLoai || "Khác");
    }
  }

  const perCat = new Map();
  for (const r of rows || []) {
    const cat = categoryByTask.get(r.MaCongViec) || "Khác";
    const s = new Date(r.GioBatDau).getTime();
    const e = new Date(r.GioKetThuc || r.GioBatDau).getTime();
    const hrs = Math.max(0, (e - s) / 3600000);
    perCat.set(cat, (perCat.get(cat) || 0) + hrs);
  }

  const list = [...perCat.entries()].map(([name, hours]) => ({ name, hours }));
  list.sort((a, b) => b.hours - a.hours);
  return { totalEvents: (rows || []).length, categories: list };
}

async function generateSuggestions(profile) {
  // Gemini disabled → deterministic fallback.
  if (!model) return fallbackSuggestions(profile);

  const prompt =
    "Bạn là trợ lý lịch trình. Dựa vào thống kê 14 ngày qua, gợi ý 2-3 công việc " +
    "giúp người dùng cân bằng lại (vd: ít vận động → đề xuất đi bộ/tập thể dục). " +
    "Trả về JSON thuần, KHÔNG giải thích, KHÔNG markdown.\n\n" +
    `Dữ liệu: ${JSON.stringify(profile)}\n\n` +
    `Format: {"suggestions":[{"title":"...","reason":"...","durationMin":30}]}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const json = JSON.parse((m ? m[1] : text).trim());
    if (Array.isArray(json?.suggestions) && json.suggestions.length > 0) {
      return json.suggestions.slice(0, 3);
    }
  } catch (err) {
    console.warn("[weekend-ai] Gemini failed, using fallback:", err.message);
  }
  return fallbackSuggestions(profile);
}

function fallbackSuggestions(profile) {
  const names = new Set(profile.categories.map((c) => c.name.toLowerCase()));
  const out = [];
  if (!names.has("thể thao") && !names.has("vận động")) {
    out.push({ title: "Đi bộ 30 phút", reason: "Tuần qua ít vận động", durationMin: 30 });
  }
  if (!names.has("học tập")) {
    out.push({ title: "Đọc sách 20 phút", reason: "Bổ sung kiến thức", durationMin: 20 });
  }
  out.push({ title: "Thiền / giãn cơ", reason: "Thư giãn đầu tuần", durationMin: 15 });
  return out.slice(0, 3);
}

function renderMessage(profile, suggestions) {
  const topCats = profile.categories
    .slice(0, 3)
    .map((c) => `• ${c.name}: ${c.hours.toFixed(1)}h`)
    .join("\n") || "(chưa có dữ liệu)";

  const sugLines = suggestions
    .map((s, i) => `${i + 1}. <b>${s.title}</b> (~${s.durationMin || 30}' ) — ${s.reason}`)
    .join("\n");

  return (
    `🌿 <b>Gợi ý cuối tuần</b>\n\n` +
    `Thống kê 2 tuần qua:\n${topCats}\n\n` +
    `Đề xuất tuần tới:\n${sugLines}\n\n` +
    `Dùng /taocongviec để tạo nhanh công việc từ Telegram.`
  );
}
