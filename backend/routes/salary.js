const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

// GET /api/salary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { from, to } = req.query;
    const endDate = to ? new Date(to) : new Date();
    const startDate = from
      ? new Date(from)
      : new Date(endDate.getTime() - 30 * 24 * 3600 * 1000);

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, GioBatDau, GioKetThuc, GhiChu, DaHoanThanh, MaCongViec, CongViec(MaCongViec, TieuDe, LuongTheoGio, ThoiGianUocTinh)")
      .eq("UserID", userId)
      .eq("DaHoanThanh", true)
      .gte("GioKetThuc", startDate.toISOString())
      .lte("GioKetThuc", endDate.toISOString())
      .order("GioKetThuc", { ascending: false });

    if (error) {
      console.error("Lỗi salary:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }

    const entries = (records || []).map((r) => {
      let hours = 0;
      if (r.GioBatDau && r.GioKetThuc) {
        const start = new Date(r.GioBatDau);
        const end = new Date(r.GioKetThuc);
        hours = Math.round(((end - start) / (1000 * 60) / 60) * 100) / 100;
      } else if (r.CongViec?.ThoiGianUocTinh) {
        hours = Math.round((r.CongViec.ThoiGianUocTinh / 60) * 100) / 100;
      }

      const rate = r.CongViec?.LuongTheoGio ? parseFloat(r.CongViec.LuongTheoGio) : 0;
      const amount = Math.round(hours * rate * 100) / 100;

      return {
        id: r.MaLichTrinh,
        title: r.CongViec?.TieuDe || "(Không có tiêu đề)",
        date: r.GioKetThuc || r.GioBatDau,
        rate,
        hours,
        note: r.GhiChu || "",
        amount,
      };
    });

    const totalAmount = entries.reduce((s, e) => s + (e.amount || 0), 0);

    res.json({ success: true, data: { entries, totalAmount } });
  } catch (error) {
    console.error("Lỗi salary:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
