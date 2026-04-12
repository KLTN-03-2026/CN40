require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { supabase } = require("../config/database");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing in .env file!");
  process.exit(1);
}

// Suppress verbose telegram polling errors BEFORE creating bot
// node-telegram-bot-api logs full response objects to stderr — override console.error temporarily
const _origConsoleError = console.error;
const _telegramErrorFilter = (...args) => {
  const msg = args[0];
  if (typeof msg === "string" && (msg.includes("Polling error") || msg.includes("ETELEGRAM"))) return;
  if (msg && typeof msg === "object" && msg.code === "ETELEGRAM") return;
  _origConsoleError.apply(console, args);
};

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Intercept polling_error to show clean 1-line message
let _telegramConflictWarned = false;
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message?.includes("409")) {
    if (!_telegramConflictWarned) {
      _telegramConflictWarned = true;
      _origConsoleError("[Telegram] Bot conflict — stop the other server instance first.");
    }
  } else {
    _origConsoleError("[Telegram] Polling error:", err.message || err);
  }
});

// Apply the filter to suppress library-level verbose dumps
console.error = _telegramErrorFilter;

const pendingConnections = new Map();

// /start
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || "bạn";
  const username = msg.from.username || "";
  const code = match && match[1] ? match[1].trim() : null;

  if (code) {
    await autoConnectUser(code, chatId, username, firstName);
    return;
  }

  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("ThongBaoNhiemVu, ThongBaoSuKien, ThongBaoGoiY")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (data) {
      const taskStatus = data.ThongBaoNhiemVu ? "✅" : "❌";
      const aiStatus = data.ThongBaoGoiY ? "✅" : "❌";
      await bot.sendMessage(chatId,
        `✅ <b>Kết nối Telegram thành công!</b>\n\nTài khoản của bạn đã được kết nối.\n\nBạn đang nhận:\n${taskStatus} Lịch trình hàng ngày (8:00 AM)\n${taskStatus} Nhắc nhở nhiệm vụ (2:00 PM)\n${aiStatus} Tổng kết cuối ngày (6:00 PM)\n\nGõ /help để xem các lệnh khác.`,
        { parse_mode: "HTML" }
      );
    } else {
      await bot.sendMessage(chatId,
        `🎉 <b>Chào mừng ${firstName}!</b>\n\nBạn chưa kết nối với bot lịch trình.\n\nVui lòng truy cập website để kết nối tài khoản.\n\nGõ /help để xem các lệnh khác.`,
        { parse_mode: "HTML" }
      );
    }
  } catch (error) {
    console.error("❌ Error in /start:", error);
    await bot.sendMessage(chatId, `🎉 <b>Chào mừng ${firstName}!</b>\n\nGõ /help để xem các lệnh khác.`, { parse_mode: "HTML" });
  }
});

// /help
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📋 <b>Danh sách lệnh</b>\n\n/start - Lấy mã kết nối mới\n/help - Xem hướng dẫn\n/status - Kiểm tra kết nối\n/schedule - Lịch trình hôm nay\n/settings - Cài đặt thông báo\n/disconnect - Ngắt kết nối\n\n💡 Bạn có thể tùy chỉnh thông báo trên web hoặc dùng /settings`,
    { parse_mode: "HTML" }
  );
});

// /status
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("UserID, TelegramChatId, TelegramUsername, TrangThaiKetNoi, ThongBaoNhiemVu, ThongBaoSuKien, ThongBaoGoiY, NgayKetNoi")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (data) {
      const taskStatus = data.ThongBaoNhiemVu ? "✅" : "❌";
      const eventStatus = data.ThongBaoSuKien ? "✅" : "❌";
      const aiStatus = data.ThongBaoGoiY ? "✅" : "❌";
      await bot.sendMessage(chatId,
        `✅ <b>Kết nối đang hoạt động</b>\n\n💬 Chat ID: <code>${chatId}</code>\n📅 Kết nối từ: ${new Date(data.NgayKetNoi).toLocaleDateString("vi-VN")}\n\n<b>Cài đặt thông báo:</b>\n${taskStatus} Nhiệm vụ\n${eventStatus} Sự kiện\n${aiStatus} Gợi ý AI\n\nDùng /settings để thay đổi cài đặt.`,
        { parse_mode: "HTML" }
      );
    } else {
      await bot.sendMessage(chatId, "❌ Bạn chưa kết nối.\n\nGõ /start để kết nối.");
    }
  } catch (error) {
    console.error("❌ Error checking status:", error);
    await bot.sendMessage(chatId, "❌ Lỗi kiểm tra trạng thái.");
  }
});

// /settings
bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("UserID, ThongBaoNhiemVu, ThongBaoSuKien, ThongBaoGoiY")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (!data) {
      await bot.sendMessage(chatId, "❌ Bạn chưa kết nối.\n\nGõ /start để kết nối.");
      return;
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: `${data.ThongBaoNhiemVu ? "✅" : "☐"} Nhiệm vụ`, callback_data: "toggle_tasks" }],
        [{ text: `${data.ThongBaoSuKien ? "✅" : "☐"} Sự kiện`, callback_data: "toggle_events" }],
        [{ text: `${data.ThongBaoGoiY ? "✅" : "☐"} Gợi ý AI`, callback_data: "toggle_ai" }],
      ],
    };

    await bot.sendMessage(chatId, "⚙️ <b>Cài đặt thông báo</b>\n\nChọn loại thông báo bạn muốn nhận:", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("❌ Error in settings:", error);
    await bot.sendMessage(chatId, "❌ Lỗi lấy cài đặt.");
  }
});

// Callback inline keyboard
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  try {
    const { data: conn } = await supabase
      .from("TelegramConnections")
      .select("UserID, ThongBaoNhiemVu, ThongBaoSuKien, ThongBaoGoiY")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (!conn) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Không tìm thấy kết nối" });
      return;
    }

    const updateData = {
      ThongBaoNhiemVu: conn.ThongBaoNhiemVu,
      ThongBaoSuKien: conn.ThongBaoSuKien,
      ThongBaoGoiY: conn.ThongBaoGoiY,
    };

    if (action === "toggle_tasks") updateData.ThongBaoNhiemVu = !conn.ThongBaoNhiemVu;
    else if (action === "toggle_events") updateData.ThongBaoSuKien = !conn.ThongBaoSuKien;
    else if (action === "toggle_ai") updateData.ThongBaoGoiY = !conn.ThongBaoGoiY;

    await supabase.from("TelegramConnections").update(updateData).eq("UserID", conn.UserID);

    const keyboard = {
      inline_keyboard: [
        [{ text: `${updateData.ThongBaoNhiemVu ? "✅" : "☐"} Nhiệm vụ`, callback_data: "toggle_tasks" }],
        [{ text: `${updateData.ThongBaoSuKien ? "✅" : "☐"} Sự kiện`, callback_data: "toggle_events" }],
        [{ text: `${updateData.ThongBaoGoiY ? "✅" : "☐"} Gợi ý AI`, callback_data: "toggle_ai" }],
      ],
    };

    await bot.editMessageReplyMarkup(keyboard, { chat_id: chatId, message_id: query.message.message_id });
    await bot.answerCallbackQuery(query.id, { text: "✅ Đã cập nhật" });
  } catch (error) {
    console.error("❌ Error handling callback:", error);
    await bot.answerCallbackQuery(query.id, { text: "❌ Lỗi cập nhật" });
  }
});

// /disconnect
bot.onText(/\/disconnect/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("UserID")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (!data) {
      await bot.sendMessage(chatId, "❌ Không tìm thấy kết nối.");
      return;
    }

    await supabase.from("TelegramConnections").update({ TrangThaiKetNoi: false }).eq("UserID", data.UserID);
    await bot.sendMessage(chatId, "✅ Đã ngắt kết nối.\n\nGõ /start nếu muốn kết nối lại.");
  } catch (error) {
    console.error("❌ Error disconnecting:", error);
    await bot.sendMessage(chatId, "❌ Lỗi ngắt kết nối.");
  }
});

// /schedule
bot.onText(/\/schedule/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const { data: conn } = await supabase
      .from("TelegramConnections")
      .select("UserID")
      .eq("TelegramChatId", chatId.toString())
      .single();

    if (!conn) {
      await bot.sendMessage(chatId, "❌ Bạn chưa kết nối.\n\nGõ /start.");
      return;
    }

    await sendTodaySchedule(conn.UserID, chatId);
  } catch (error) {
    console.error("❌ Error getting schedule:", error);
    await bot.sendMessage(chatId, "❌ Lỗi lấy lịch trình.");
  }
});

// verifyToken
async function verifyToken(token, userId) {
  const connection = pendingConnections.get(token);
  if (!connection) return { success: false, message: "Mã kết nối không hợp lệ hoặc đã hết hạn" };

  if (Date.now() - connection.timestamp > 10 * 60 * 1000) {
    pendingConnections.delete(token);
    return { success: false, message: "Mã kết nối đã hết hạn. Vui lòng tạo mã mới." };
  }

  try {
    await supabase.from("TelegramConnections").upsert({
      UserID: userId,
      TelegramChatId: connection.chatId.toString(),
      TelegramUsername: connection.username || null,
      TelegramFirstName: connection.firstName || null,
      TrangThaiKetNoi: true,
      ThongBaoNhiemVu: true,
      NgayKetNoi: new Date().toISOString(),
    }, { onConflict: "UserID" });

    pendingConnections.delete(token);

    await bot.sendMessage(connection.chatId,
      `✅ <b>Kết nối thành công!</b>\n\nTài khoản của bạn đã được kết nối.\n\nBạn sẽ nhận:\n• Lịch trình hàng ngày\n• Nhắc nhở nhiệm vụ\n• Thông báo sự kiện\n\nGõ /help để xem các lệnh.`,
      { parse_mode: "HTML" }
    );

    return { success: true, message: "Kết nối thành công!", chatId: connection.chatId, username: connection.username };
  } catch (error) {
    console.error("❌ Error saving connection:", error);
    return { success: false, message: "Lỗi lưu kết nối: " + error.message };
  }
}

// sendMessageToUser
async function sendMessageToUser(userId, message, options = {}) {
  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("TelegramChatId, TrangThaiKetNoi")
      .eq("UserID", userId)
      .single();

    if (!data || !data.TrangThaiKetNoi) return { success: false, message: "User chưa kết nối Telegram" };

    await bot.sendMessage(data.TelegramChatId, message, { parse_mode: "HTML", ...options });

    await supabase.from("TelegramConnections").update({ NgayCapNhat: new Date().toISOString() }).eq("UserID", userId);

    return { success: true };
  } catch (error) {
    console.error(`❌ Error sending to user ${userId}:`, error.message);
    return { success: false, message: error.message };
  }
}

// sendSchedule
async function sendSchedule(userId, schedule) {
  const { date, tasks } = schedule;
  let message = `📅 <b>Lịch trình ngày ${date}</b>\n\n`;
  tasks.forEach((task) => {
    message += `⏰ <b>${task.time}</b> - ${task.title}\n`;
    if (task.description) message += `   ${task.description}\n`;
    message += "\n";
  });
  message += "Chúc bạn một ngày làm việc hiệu quả! 💪";
  return await sendMessageToUser(userId, message);
}

// sendTodaySchedule
async function sendTodaySchedule(userId, chatId) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const { data: records } = await supabase
      .from("LichTrinh")
      .select("GioBatDau, GioKetThuc, CongViec(TieuDe, MoTa)")
      .eq("UserID", userId)
      .gte("GioBatDau", todayStart.toISOString())
      .lte("GioBatDau", todayEnd.toISOString())
      .order("GioBatDau", { ascending: true });

    if (!records || records.length === 0) {
      await bot.sendMessage(chatId, "📅 <b>Lịch trình hôm nay</b>\n\nBạn không có công việc nào hôm nay.", { parse_mode: "HTML" });
      return { success: true };
    }

    let message = `📅 <b>Lịch trình ngày hôm nay</b>\n\n`;
    records.forEach((task, index) => {
      const startTime = new Date(task.GioBatDau).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const endTime = task.GioKetThuc ? new Date(task.GioKetThuc).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
      message += `${index + 1}. <b>${task.CongViec?.TieuDe || "Không có tiêu đề"}</b>\n`;
      message += `   ⏰ ${startTime}${endTime ? ` → ${endTime}` : ""}\n`;
      if (task.CongViec?.MoTa) message += `   📝 ${task.CongViec.MoTa}\n`;
      message += "\n";
    });
    message += "Chúc bạn một ngày làm việc hiệu quả! 💪";

    await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    return { success: true };
  } catch (error) {
    console.error("❌ Error sending schedule:", error);
    return { success: false, message: error.message };
  }
}

// autoConnectUser
async function autoConnectUser(code, chatId, username, firstName) {
  try {
    global.pendingWebConnections = global.pendingWebConnections || new Map();
    const pending = global.pendingWebConnections.get(code);

    if (!pending) {
      await bot.sendMessage(chatId, "❌ Mã kết nối không hợp lệ hoặc đã hết hạn.\n\nVui lòng thử lại từ website.");
      return { success: false, message: "Mã kết nối không hợp lệ" };
    }

    if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
      global.pendingWebConnections.delete(code);
      await bot.sendMessage(chatId, "❌ Mã kết nối đã hết hạn (10 phút).\n\nVui lòng tạo mã mới từ website.");
      return { success: false, message: "Mã kết nối đã hết hạn" };
    }

    const userId = pending.userId;

    // Xóa chat_id cũ nếu đã tồn tại
    await supabase.from("TelegramConnections").delete().eq("TelegramChatId", chatId.toString()).neq("UserID", userId);

    // Upsert connection
    await supabase.from("TelegramConnections").upsert({
      UserID: userId,
      TelegramChatId: chatId.toString(),
      TelegramUsername: username || null,
      TelegramFirstName: firstName || null,
      TrangThaiKetNoi: true,
      ThongBaoNhiemVu: true,
      NgayKetNoi: new Date().toISOString(),
      NgayCapNhat: new Date().toISOString(),
    }, { onConflict: "UserID" });

    const { data: settings } = await supabase
      .from("TelegramConnections")
      .select("ThongBaoNhiemVu, ThongBaoSuKien, ThongBaoGoiY")
      .eq("UserID", userId)
      .single();

    const taskStatus = settings?.ThongBaoNhiemVu ? "✅" : "❌";
    const aiStatus = settings?.ThongBaoGoiY ? "✅" : "❌";

    await bot.sendMessage(chatId,
      `🎉 <b>Chào mừng ${firstName}!</b>\n\nBạn đã kết nối với bot lịch trình.\n\nBạn sẽ nhận:\n${taskStatus} Lịch trình hàng ngày (8:00 AM)\n${taskStatus} Nhắc nhở nhiệm vụ (2:00 PM)\n${aiStatus} Tổng kết cuối ngày (6:00 PM)\n\nGõ /help để xem các lệnh khác.`,
      { parse_mode: "HTML" }
    );

    global.pendingWebConnections.delete(code);
    await sendTodaySchedule(userId, chatId);

    return { success: true, message: "Kết nối thành công!", chatId: chatId.toString(), username, firstName };
  } catch (error) {
    console.error("❌ Error auto-connecting:", error);
    await bot.sendMessage(chatId, "❌ Lỗi kết nối: " + error.message);
    return { success: false, message: "Lỗi kết nối: " + error.message };
  }
}

// broadcastMessage
async function broadcastMessage(message, options = {}) {
  try {
    const { data: users } = await supabase
      .from("TelegramConnections")
      .select("UserID, TelegramChatId")
      .eq("TrangThaiKetNoi", true);

    let successCount = 0, failCount = 0;
    for (const user of (users || [])) {
      try {
        await bot.sendMessage(user.TelegramChatId, message, { parse_mode: "HTML", ...options });
        successCount++;
      } catch (error) {
        console.error(`❌ Failed for user ${user.UserID}:`, error.message);
        failCount++;
      }
    }
    return { successCount, failCount, total: (users || []).length };
  } catch (error) {
    console.error("❌ Broadcast error:", error);
    throw error;
  }
}

// isUserConnected
async function isUserConnected(userId) {
  try {
    const { data } = await supabase
      .from("TelegramConnections")
      .select("TrangThaiKetNoi")
      .eq("UserID", userId)
      .single();
    return data?.TrangThaiKetNoi === true;
  } catch {
    return false;
  }
}

async function initializeSchedules() {
  try {
    const scheduleUpdater = require("./schedule-updater");
    setTimeout(async () => { await scheduleUpdater.restartAllSchedules(); }, 5000);
  } catch (error) {
    console.error("❌ Error initializing schedules:", error);
  }
}

// Cleanup expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, connection] of pendingConnections.entries()) {
    if (now - connection.timestamp > 10 * 60 * 1000) pendingConnections.delete(token);
  }
}, 5 * 60 * 1000);

bot.on("polling_error", (error) => console.error("❌ Polling error:", error));
bot.on("webhook_error", (error) => console.error("❌ Webhook error:", error));

module.exports = { bot, verifyToken, autoConnectUser, sendMessageToUser, sendSchedule, sendTodaySchedule, broadcastMessage, isUserConnected, initializeSchedules };
