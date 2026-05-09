// /daily — list today's events with inline ✅ buttons to mark complete.
// Callback data format: "daily_done:{MaLichTrinh}" so the same callback
// handler in bot.js can route by prefix.

const { supabase } = require("../../config/database");

function register(bot) {
  bot.onText(/^\/daily\b/, (msg) => handleDaily(bot, msg));

  bot.on("callback_query", async (query) => {
    if (!query.data || !query.data.startsWith("daily_done:")) return;
    await handleComplete(bot, query);
  });
}

async function handleDaily(bot, msg) {
  const chatId = msg.chat.id;

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

    const { startIso, endIso } = todayBoundsVN();

    const { data: events } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, TieuDe, GioBatDau, GioKetThuc, DaHoanThanh")
      .eq("UserID", conn.UserID)
      .gte("GioBatDau", startIso)
      .lte("GioBatDau", endIso)
      .order("GioBatDau", { ascending: true });

    if (!events?.length) {
      await bot.sendMessage(chatId, "📅 Hôm nay không có công việc nào.");
      return;
    }

    const header = `📅 <b>Công việc hôm nay</b> (${events.length})\n`;
    const lines = events.map((e, i) => {
      const hh = new Date(e.GioBatDau).toLocaleTimeString("vi-VN", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
      });
      const mark = e.DaHoanThanh ? "✅" : "⏳";
      return `${i + 1}. ${mark} <b>${e.TieuDe || "Công việc"}</b> — ${hh}`;
    });

    const keyboard = {
      inline_keyboard: events
        .filter((e) => !e.DaHoanThanh)
        .map((e, i) => [
          {
            text: `✅ Hoàn thành #${i + 1}`,
            callback_data: `daily_done:${e.MaLichTrinh}`,
          },
        ]),
    };

    await bot.sendMessage(chatId, header + "\n" + lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
    });
  } catch (err) {
    console.error("[/daily] failed:", err);
    await bot.sendMessage(chatId, "❌ Lỗi lấy công việc hôm nay.");
  }
}

async function handleComplete(bot, query) {
  const chatId = query.message.chat.id;
  const id = Number(query.data.split(":")[1]);
  if (!id) {
    await bot.answerCallbackQuery(query.id, { text: "❌ ID không hợp lệ" });
    return;
  }

  try {
    const { data: conn } = await supabase
      .from("TelegramConnections")
      .select("UserID")
      .eq("TelegramChatId", chatId.toString())
      .maybeSingle();

    if (!conn) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Chưa kết nối" });
      return;
    }

    const { error } = await supabase
      .from("LichTrinh")
      .update({ DaHoanThanh: true })
      .eq("MaLichTrinh", id)
      .eq("UserID", conn.UserID);

    if (error) throw error;

    await bot.answerCallbackQuery(query.id, { text: "✅ Đã hoàn thành!" });

    // Refresh the list in place.
    const fakeMsg = { chat: { id: chatId } };
    await handleDaily(bot, fakeMsg);
  } catch (err) {
    console.error("[/daily done] failed:", err);
    await bot.answerCallbackQuery(query.id, { text: "❌ Lỗi cập nhật" });
  }
}

function todayBoundsVN() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

module.exports = { register };
