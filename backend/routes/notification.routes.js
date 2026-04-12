const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { supabase } = require("../config/database");
const {
  verifyToken,
  autoConnectUser,
  sendMessageToUser,
  sendSchedule,
  broadcastMessage,
  isUserConnected,
} = require("../telegram/bot");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, message: "Token không được cung cấp" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Token không hợp lệ" });
    }
    req.userId = decoded.userId;
    next();
  });
};

// POST /api/notifications/connect-telegram
router.post("/connect-telegram", authenticateToken, async (req, res) => {
  try {
    const { telegramCode } = req.body;
    const userId = req.userId;

    if (!telegramCode) {
      return res.status(400).json({ success: false, message: "Vui lòng cung cấp mã kết nối" });
    }

    if (!/^[A-Z0-9]{8}$/.test(telegramCode)) {
      return res.status(400).json({ success: false, message: "Mã kết nối không đúng định dạng" });
    }

    const result = await verifyToken(telegramCode, userId);
    if (!result.success) return res.status(400).json(result);

    const { data: connection, error } = await supabase
      .from("TelegramConnections")
      .select("UserID, TelegramChatId, TelegramUsername, TelegramFirstName, TrangThaiKetNoi, GioLichNgay, GioNhacNhiemVu, GioTongKetNgay")
      .eq("UserID", userId)
      .single();

    if (error || !connection) {
      return res.status(400).json({ success: false, message: "Lỗi: Kết nối không được lưu" });
    }

    const { sendTodaySchedule } = require("../telegram/bot");
    await sendTodaySchedule(userId, connection.TelegramChatId);

    res.json({
      success: true,
      message: "Kết nối Telegram thành công!",
      data: {
        userId,
        chatId: connection.TelegramChatId,
        username: connection.TelegramUsername,
        firstName: connection.TelegramFirstName,
        isConnected: connection.TrangThaiKetNoi === true,
        scheduleSettings: {
          morningScheduleTime: connection.GioLichNgay,
          taskReminderTime: connection.GioNhacNhiemVu,
          eveningSummaryTime: connection.GioTongKetNgay,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in connect-telegram:", error);
    res.status(500).json({ success: false, message: "Lỗi kết nối Telegram", error: error.message });
  }
});

// GET /api/notifications/telegram-connect-url
router.get("/telegram-connect-url", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

    global.pendingWebConnections = global.pendingWebConnections || new Map();
    global.pendingWebConnections.set(code, { userId, timestamp: Date.now() });

    setTimeout(() => {
      if (global.pendingWebConnections?.has(code)) global.pendingWebConnections.delete(code);
    }, 10 * 60 * 1000);

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "your_bot_username";
    const telegramUrl = `https://t.me/${botUsername}?start=${code}`;

    res.json({ success: true, telegramUrl, code });
  } catch (error) {
    console.error("❌ Error generating telegram URL:", error);
    res.status(500).json({ success: false, message: "Lỗi tạo URL kết nối", error: error.message });
  }
});

// GET /api/notifications/telegram-status
router.get("/telegram-status", authenticateToken, async (req, res) => {
  try {
    const connected = await isUserConnected(req.userId);
    res.json({ success: true, connected, message: connected ? "Đã kết nối" : "Chưa kết nối" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi kiểm tra trạng thái", error: error.message });
  }
});

// POST /api/notifications/send-message
router.post("/send-message", authenticateToken, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ success: false, message: "Thiếu userId hoặc message" });
    }
    const result = await sendMessageToUser(userId, message);
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, message: "Đã gửi tin nhắn thành công" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi gửi tin nhắn", error: error.message });
  }
});

// POST /api/notifications/send-schedule
router.post("/send-schedule", authenticateToken, async (req, res) => {
  try {
    const { userId, schedule } = req.body;
    if (!userId || !schedule || !schedule.date || !Array.isArray(schedule.tasks)) {
      return res.status(400).json({ success: false, message: "Thiếu hoặc sai format dữ liệu" });
    }
    const result = await sendSchedule(userId, schedule);
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, message: "Đã gửi lịch trình thành công" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi gửi lịch trình", error: error.message });
  }
});

// POST /api/notifications/broadcast
router.post("/broadcast", authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: "Thiếu message" });
    const result = await broadcastMessage(message);
    res.json({ success: true, message: `Đã gửi cho ${result.successCount}/${result.total} người dùng`, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi broadcast", error: error.message });
  }
});

// POST /api/notifications/disconnect
router.post("/disconnect", authenticateToken, async (req, res) => {
  try {
    await supabase
      .from("TelegramConnections")
      .update({ TrangThaiKetNoi: false })
      .eq("UserID", req.userId);

    res.json({ success: true, message: "Đã ngắt kết nối Telegram" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi ngắt kết nối", error: error.message });
  }
});

// POST /api/notifications/update-schedule-time
router.post("/update-schedule-time", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { taskReminderTime, dailyScheduleTime, dailySummaryTime } = req.body;

    const updateData = {};
    if (taskReminderTime) updateData.GioNhacNhiemVu = taskReminderTime;
    if (dailyScheduleTime) updateData.GioLichNgay = dailyScheduleTime;
    if (dailySummaryTime) updateData.GioTongKetNgay = dailySummaryTime;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "Không có dữ liệu cập nhật" });
    }

    await supabase.from("TelegramConnections").update(updateData).eq("UserID", userId);

    res.json({ success: true, message: "Đã cập nhật giờ thông báo" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi cập nhật giờ thông báo", error: error.message });
  }
});

module.exports = router;
