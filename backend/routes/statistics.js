const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// GET /api/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { from, to } = req.query;

    const endDate = to ? new Date(to) : new Date();
    const startDate = from
      ? new Date(from)
      : new Date(endDate.getTime() - 30 * 24 * 3600 * 1000);

    // Lấy tất cả lịch trình trong khoảng
    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("GioBatDau, DaHoanThanh")
      .eq("UserID", userId)
      .gte("GioBatDau", startDate.toISOString())
      .lte("GioBatDau", endDate.toISOString());

    if (error) {
      console.error("Lỗi statistics:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const allRecords = records || [];
    const total = allRecords.length;
    const completed = allRecords.filter((r) => r.DaHoanThanh).length;
    const pending = total - completed;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 10000) / 100;

    // Dữ liệu theo ngày cho biểu đồ
    const dailyMap = {};
    allRecords.forEach((r) => {
      const day = r.GioBatDau ? r.GioBatDau.split("T")[0] : null;
      if (!day) return;
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, total: 0, completed: 0 };
      }
      dailyMap[day].total++;
      if (r.DaHoanThanh) dailyMap[day].completed++;
    });

    const daily = Object.values(dailyMap).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    res.json({
      success: true,
      data: { total, completed, pending, percent, daily },
    });
  } catch (error) {
    console.error("Lỗi statistics:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
