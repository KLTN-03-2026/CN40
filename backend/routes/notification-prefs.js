// Notification preferences endpoints — backed by TelegramConnections.
// Mounted under /api/notifications, behind authenticateToken.
// - GET  /prefs : current user's full pref set (fallbacks if not connected yet)
// - PUT  /prefs : partial update; validates types/ranges
//
// Kept separate from notification.routes.js so the link/send/broadcast
// endpoints stay focused on Telegram plumbing.

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// HH:MM 24h, 00:00 – 23:59. Used for the 3 scheduled-time fields.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_PREFS = {
  // Core (existing schema — used by bot.js today)
  thongBaoNhiemVu:   true,
  thongBaoSuKien:    true,
  thongBaoGoiY:      true,
  gioLichNgay:       "08:00",
  gioNhacNhiemVu:    "14:00",
  gioTongKetNgay:    "18:00",
  // New (this feature)
  thongBao15Phut:    true,
  thongBaoHangNgay:  true,
  thongBaoTuan:      true,
  thongBaoCuoiTuan:  true,
  thongBaoLuong:     false,
  ngayNhanLuong:     1,
  phutNhacTruoc:     15,
};

// DB column ↔ JSON key map (single source of truth for both directions).
const COLS = {
  ThongBaoNhiemVu:   "thongBaoNhiemVu",
  ThongBaoSuKien:    "thongBaoSuKien",
  ThongBaoGoiY:      "thongBaoGoiY",
  GioLichNgay:       "gioLichNgay",
  GioNhacNhiemVu:    "gioNhacNhiemVu",
  GioTongKetNgay:    "gioTongKetNgay",
  ThongBao15Phut:    "thongBao15Phut",
  ThongBaoHangNgay:  "thongBaoHangNgay",
  ThongBaoTuan:      "thongBaoTuan",
  ThongBaoCuoiTuan:  "thongBaoCuoiTuan",
  ThongBaoLuong:     "thongBaoLuong",
  NgayNhanLuong:     "ngayNhanLuong",
  PhutNhacTruoc:     "phutNhacTruoc",
};

function rowToPrefs(row) {
  if (!row) return { connected: false, ...DEFAULT_PREFS };
  const out = { connected: row.TrangThaiKetNoi === true };
  for (const [col, key] of Object.entries(COLS)) {
    out[key] = row[col] ?? DEFAULT_PREFS[key];
  }
  return out;
}

// GET /api/notifications/prefs
router.get("/prefs", async (req, res) => {
  try {
    const userId = req.user?.UserID ?? req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Thiếu userId" });
    }
    const { data, error } = await supabase
      .from("TelegramConnections")
      .select(
        "TrangThaiKetNoi, " + Object.keys(COLS).join(", ")
      )
      .eq("UserID", userId)
      .maybeSingle();

    if (error) {
      // Column missing → migration 008 not yet applied. Return defaults + flag.
      if (/column|schema/i.test(error.message || "")) {
        return res.json({
          success: true,
          data: { connected: false, ...DEFAULT_PREFS },
          _fallback: "missing-columns",
        });
      }
      console.error("GET /prefs:", error);
      return res.status(500).json({ success: false, message: "Lỗi tải cài đặt" });
    }

    res.json({ success: true, data: rowToPrefs(data) });
  } catch (err) {
    console.error("GET /prefs:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// PUT /api/notifications/prefs
// Body: any subset of the JSON keys in COLS. Unknown keys ignored.
router.put("/prefs", async (req, res) => {
  try {
    const userId = req.user?.UserID ?? req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Thiếu userId" });
    }
    const body = req.body || {};
    const update = {};
    const invalid = [];

    for (const [col, key] of Object.entries(COLS)) {
      if (!(key in body)) continue;
      const v = body[key];

      if (col.startsWith("ThongBao")) {
        if (typeof v !== "boolean") { invalid.push(key); continue; }
        update[col] = v;
      } else if (col.startsWith("Gio")) {
        if (typeof v !== "string" || !TIME_RE.test(v)) { invalid.push(key); continue; }
        update[col] = v;
      } else if (col === "NgayNhanLuong") {
        const n = Number.parseInt(v, 10);
        if (!Number.isInteger(n) || n < 1 || n > 28) { invalid.push(key); continue; }
        update[col] = n;
      } else if (col === "PhutNhacTruoc") {
        const n = Number.parseInt(v, 10);
        if (!Number.isInteger(n) || n < 1 || n > 180) { invalid.push(key); continue; }
        update[col] = n;
      }
    }

    if (invalid.length) {
      return res.status(400).json({
        success: false,
        message: "Giá trị không hợp lệ: " + invalid.join(", "),
      });
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: "Không có trường nào để cập nhật" });
    }

    update.NgayCapNhat = new Date().toISOString();

    const { error } = await supabase
      .from("TelegramConnections")
      .update(update)
      .eq("UserID", userId);

    if (error) {
      if (/column|schema/i.test(error.message || "")) {
        return res.status(503).json({
          success: false,
          message: "Chưa chạy migration 008 — cài đặt mới chưa khả dụng",
        });
      }
      // Not yet connected — no row exists. Surface clearly.
      if (/0 rows|no rows/i.test(error.message || "")) {
        return res.status(409).json({
          success: false,
          message: "Bạn chưa kết nối Telegram — kết nối trước khi đổi cài đặt",
        });
      }
      console.error("PUT /prefs:", error);
      return res.status(500).json({ success: false, message: "Lỗi lưu cài đặt" });
    }

    // Re-read so schedule-updater can recompute crons with fresh values if needed.
    try {
      const updater = require("../telegram/schedule-updater");
      if (typeof updater.updateUserSchedule === "function") {
        await updater.updateUserSchedule(userId);
      }
    } catch (_) { /* optional */ }

    res.json({ success: true, message: "Đã lưu cài đặt" });
  } catch (err) {
    console.error("PUT /prefs:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
