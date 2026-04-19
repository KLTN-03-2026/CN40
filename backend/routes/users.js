const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { supabase } = require("../config/database");

// Default palette (mirrors frontend :root --prio-1..4 in main.css).
const DEFAULT_PRIORITY_COLORS = {
  1: "#10B981",
  2: "#3B82F6",
  3: "#F59E0B",
  4: "#DC2626",
};
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// GET /api/users/priority-colors — returns user's stored palette or defaults.
router.get("/priority-colors", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const { data: row, error } = await supabase
      .from("Users")
      .select("PriorityColors")
      .eq("UserID", userId)
      .single();

    if (error) {
      // Column missing (migration not yet run) → graceful fallback.
      if (error.code === "42703" || /PriorityColors/.test(error.message || "")) {
        return res.json({ success: true, data: DEFAULT_PRIORITY_COLORS, _fallback: "defaults" });
      }
      return res.status(500).json({ success: false, message: "Load failed" });
    }

    const stored = row?.PriorityColors || null;
    res.json({ success: true, data: { ...DEFAULT_PRIORITY_COLORS, ...(stored || {}) } });
  } catch (err) {
    console.error("GET /priority-colors:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/users/priority-colors — save palette.
// Body: { "1": "#RRGGBB", "2": ..., ... } — partial accepted, merged with stored.
router.put("/priority-colors", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;
    const payload = req.body || {};

    // Validate each field.
    const cleaned = {};
    for (const key of ["1", "2", "3", "4"]) {
      if (payload[key] !== undefined) {
        if (!HEX_RE.test(String(payload[key]))) {
          return res.status(400).json({ success: false, message: `Màu ưu tiên ${key} không hợp lệ (cần #RRGGBB)` });
        }
        cleaned[key] = String(payload[key]).toUpperCase();
      }
    }
    if (Object.keys(cleaned).length === 0) {
      return res.status(400).json({ success: false, message: "Không có màu nào để cập nhật" });
    }

    // Merge with existing to preserve keys not in payload.
    const { data: existingRow } = await supabase
      .from("Users")
      .select("PriorityColors")
      .eq("UserID", userId)
      .single();
    const merged = { ...DEFAULT_PRIORITY_COLORS, ...(existingRow?.PriorityColors || {}), ...cleaned };

    const { error: updateErr } = await supabase
      .from("Users")
      .update({ PriorityColors: merged })
      .eq("UserID", userId);

    if (updateErr) {
      if (updateErr.code === "42703" || /PriorityColors/.test(updateErr.message || "")) {
        return res.status(503).json({
          success: false,
          message: "Tính năng chưa sẵn sàng — chạy migration 002_add_priority_colors.sql",
        });
      }
      console.error("PUT /priority-colors:", updateErr);
      return res.status(500).json({ success: false, message: "Save failed" });
    }

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error("PUT /priority-colors:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/users/profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;

    const { data: user, error } = await supabase
      .from("Users")
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio")
      .eq("UserID", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        id: user.UserID,
        username: user.Username,
        email: user.Email,
        hoten: user.HoTen,
        phone: user.Phone,
        ngaysinh: user.NgaySinh,
        gioitinh: user.GioiTinh,
        bio: user.Bio,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res
      .status(500)
      .json({ message: "Error fetching profile", error: error.message });
  }
});

// PUT /api/users/:id
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;

    if (userId !== currentUserId && currentUserId !== 1) {
      return res
        .status(403)
        .json({ message: "Không có quyền cập nhật thông tin này" });
    }

    const { hoten, email, phone, ngaysinh, gioitinh, bio } = req.body;

    if (!hoten || !email) {
      return res.status(400).json({ message: "Họ tên và email là bắt buộc" });
    }

    const { data: updated, error } = await supabase
      .from("Users")
      .update({
        HoTen: hoten || "",
        Email: email || "",
        Phone: phone || null,
        NgaySinh: ngaysinh || null,
        GioiTinh: gioitinh || null,
        Bio: bio || null,
      })
      .eq("UserID", userId)
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio");

    if (error || !updated || updated.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const u = updated[0];
    res.json({
      success: true,
      message: "Thông tin cá nhân được cập nhật thành công",
      data: {
        id: u.UserID,
        username: u.Username,
        email: u.Email,
        hoten: u.HoTen,
        phone: u.Phone,
        ngaysinh: u.NgaySinh,
        gioitinh: u.GioiTinh,
        bio: u.Bio,
      },
    });

    console.log(`User ${userId} profile updated`);
  } catch (error) {
    console.error("Error updating user profile:", error);
    res
      .status(500)
      .json({ message: "Error updating profile", error: error.message });
  }
});

// GET /api/users/:id
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;

    if (userId !== currentUserId && currentUserId !== 1) {
      return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    const { data: user, error } = await supabase
      .from("Users")
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio")
      .eq("UserID", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        id: user.UserID,
        username: user.Username,
        email: user.Email,
        hoten: user.HoTen,
        phone: user.Phone,
        ngaysinh: user.NgaySinh,
        gioitinh: user.GioiTinh,
        bio: user.Bio,
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res
      .status(500)
      .json({ message: "Error fetching user", error: error.message });
  }
});

// DELETE /api/users/:id
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;

    if (userId !== currentUserId && currentUserId !== 1) {
      return res
        .status(403)
        .json({ message: "Không có quyền xóa tài khoản này" });
    }

    const { error } = await supabase
      .from("Users")
      .delete()
      .eq("UserID", userId);

    if (error) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Tài khoản được xóa thành công",
    });

    console.log(`User ${userId} account deleted`);
  } catch (error) {
    console.error("Error deleting user:", error);
    res
      .status(500)
      .json({ message: "Error deleting user", error: error.message });
  }
});

module.exports = router;
