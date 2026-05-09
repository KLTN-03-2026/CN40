/**
 * adjustments.js — CRUD for DieuChinhLuong (monthly salary adjustments).
 * Mounted at /api/adjustments by server.js; protected by authenticateToken.
 *
 * Routes:
 *   GET    /api/adjustments?taskId=&month=     — list (both filters optional)
 *   POST   /api/adjustments                    — create  { MaCongViec, Thang, SoTien, LyDo? }
 *   PUT    /api/adjustments/:id                — update  { SoTien?, LyDo?, Thang? }
 *   DELETE /api/adjustments/:id                — remove
 *
 * Ownership enforced by UserID = req.userId on every read/write.
 */

const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

const MONTH_RE = /^[0-9]{4}-[0-9]{2}$/;

function toInt(x) {
  const n = parseInt(x, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Confirm the target task belongs to this user AND is full_time.
// Adjustments only make sense for full_time; guarding keeps data clean.
async function assertFullTimeTaskOwned(userId, taskId) {
  const { data, error } = await supabase
    .from("CongViec")
    .select("MaCongViec, LoaiLuong")
    .eq("MaCongViec", taskId)
    .eq("UserID", userId)
    .single();
  if (error || !data) return { ok: false, status: 404, message: "Không tìm thấy công việc" };
  if (data.LoaiLuong !== "full_time") {
    return {
      ok: false,
      status: 400,
      message: "Điều chỉnh lương chỉ áp dụng cho công việc full-time",
    };
  }
  return { ok: true };
}

// --- GET /api/adjustments ---
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { taskId, month } = req.query;

    let q = supabase
      .from("DieuChinhLuong")
      .select("MaDieuChinh, MaCongViec, Thang, SoTien, LyDo, NgayTao")
      .eq("UserID", userId)
      .order("NgayTao", { ascending: false });

    if (taskId) {
      const t = toInt(taskId);
      if (t) q = q.eq("MaCongViec", t);
    }
    if (month) {
      if (!MONTH_RE.test(month)) {
        return res
          .status(400)
          .json({ success: false, message: "month phải dạng YYYY-MM" });
      }
      q = q.eq("Thang", month);
    }

    const { data, error } = await q;
    if (error) {
      console.error("[adjustments] list failed:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("GET /api/adjustments:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// --- POST /api/adjustments ---
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { MaCongViec, Thang, SoTien, LyDo } = req.body || {};

    const taskId = toInt(MaCongViec);
    if (!taskId) {
      return res
        .status(400)
        .json({ success: false, message: "MaCongViec là bắt buộc" });
    }
    if (!MONTH_RE.test(String(Thang || ""))) {
      return res
        .status(400)
        .json({ success: false, message: "Thang phải dạng YYYY-MM" });
    }
    const delta = Number(SoTien);
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ success: false, message: "SoTien không hợp lệ" });
    }

    const guard = await assertFullTimeTaskOwned(userId, taskId);
    if (!guard.ok) {
      return res.status(guard.status).json({ success: false, message: guard.message });
    }

    const { data, error } = await supabase
      .from("DieuChinhLuong")
      .insert({
        MaCongViec: taskId,
        UserID: userId,
        Thang,
        SoTien: delta,
        LyDo: LyDo || null,
      })
      .select()
      .single();
    if (error) {
      console.error("[adjustments] create failed:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("POST /api/adjustments:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// --- PUT /api/adjustments/:id ---
router.put("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const id = req.params.id;
    const updates = {};
    if (req.body.SoTien !== undefined) {
      const v = Number(req.body.SoTien);
      if (!Number.isFinite(v)) {
        return res.status(400).json({ success: false, message: "SoTien không hợp lệ" });
      }
      updates.SoTien = v;
    }
    if (req.body.LyDo !== undefined) updates.LyDo = req.body.LyDo || null;
    if (req.body.Thang !== undefined) {
      if (!MONTH_RE.test(req.body.Thang)) {
        return res
          .status(400)
          .json({ success: false, message: "Thang phải dạng YYYY-MM" });
      }
      updates.Thang = req.body.Thang;
    }
    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Không có trường nào để cập nhật" });
    }

    const { data, error } = await supabase
      .from("DieuChinhLuong")
      .update(updates)
      .eq("MaDieuChinh", id)
      .eq("UserID", userId)
      .select();
    if (error) {
      console.error("[adjustments] update failed:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bản ghi" });
    }
    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error("PUT /api/adjustments/:id:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// --- DELETE /api/adjustments/:id ---
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const id = req.params.id;
    const { data, error } = await supabase
      .from("DieuChinhLuong")
      .delete()
      .eq("MaDieuChinh", id)
      .eq("UserID", userId)
      .select("MaDieuChinh");
    if (error) {
      console.error("[adjustments] delete failed:", error);
      return res.status(500).json({ success: false, message: "Lỗi server" });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bản ghi" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/adjustments/:id:", err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
