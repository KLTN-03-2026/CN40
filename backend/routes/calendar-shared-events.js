// calendar-shared-events.js — GET /api/calendar/shared-events
// Returns events from calendars shared with the current user (accepted shares only).
// Annotates each event with owner name and permission level.
const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

const PRIORITY_COLORS = {
  1: "#34D399",
  2: "#60A5FA",
  3: "#FBBF24",
  4: "#F87171",
};

// GET /api/calendar/shared-events?from=ISO&to=ISO
router.get("/shared-events", async (req, res) => {
  try {
    const userId = req.userId;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ success: false, message: "Thiếu tham số from hoặc to" });
    }

    // Validate ISO date strings to prevent injection
    if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return res.status(400).json({ success: false, message: "Tham số ngày không hợp lệ" });
    }

    // Step 1: Get accepted shares where current user is the recipient
    const { data: shares, error: sharesErr } = await supabase
      .from("CalendarShares")
      .select(`ShareID, Permission, OwnerID, Users!CalendarShares_OwnerID_fkey(HoTen, Email)`)
      .eq("SharedWithID", userId)
      .eq("TrangThai", "accepted");

    if (sharesErr) throw sharesErr;
    if (!shares || shares.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Step 2: Build owner lookup map { ownerId: { HoTen, Permission } }
    const ownerMap = {};
    const ownerIds = shares.map((s) => {
      ownerMap[s.OwnerID] = { hoTen: s.Users?.HoTen || s.Users?.Email || "Người dùng", permission: s.Permission };
      return s.OwnerID;
    });

    // Step 3: Query LichTrinh for those owners in date range
    const { data: records, error: lichErr } = await supabase
      .from("LichTrinh")
      .select("*, CongViec(TieuDe, MucDoUuTien, MauSac)")
      .in("UserID", ownerIds)
      .gte("GioBatDau", from)
      .lte("GioBatDau", to)
      .order("GioBatDau", { ascending: true });

    if (lichErr) throw lichErr;

    // Step 4: Format for FullCalendar, annotate with owner info
    const events = (records || []).map((ev) => {
      const owner = ownerMap[ev.UserID] || { hoTen: "Ẩn danh", permission: "viewer" };
      const priorityColor = ev.CongViec?.MucDoUuTien
        ? PRIORITY_COLORS[ev.CongViec.MucDoUuTien] || "#94a3b8"
        : "#94a3b8";
      const color = ev.CongViec?.MauSac || priorityColor;

      return {
        id: `shared-${ev.MaLichTrinh}`,
        MaLichTrinh: ev.MaLichTrinh,
        title: ev.CongViec?.TieuDe || ev.TieuDe || "Lịch trình",
        start: ev.GioBatDau,
        end: ev.GioKetThuc,
        backgroundColor: color,
        borderColor: color,
        textColor: "#FFFFFF",
        classNames: ["shared-event"],
        extendedProps: {
          isShared: true,
          ownerName: owner.hoTen,
          permission: owner.permission,
          completed: ev.DaHoanThanh || false,
          priority: ev.CongViec?.MucDoUuTien || 2,
          ownerId: ev.UserID,
        },
      };
    });

    return res.json({ success: true, data: events });
  } catch (err) {
    console.error("[calendar-shared-events] error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

module.exports = router;
