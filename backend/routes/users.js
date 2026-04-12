const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { supabase } = require("../config/database");

// GET /api/users/profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.UserID;

    const { data: user, error } = await supabase
      .from("Users")
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio, AvatarUrl")
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
        avatarUrl: user.AvatarUrl || null,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res
      .status(500)
      .json({ message: "Error fetching profile", error: error.message });
  }
});

// POST /api/users/:id/avatar — accepts JSON { imageBase64 }, stores as data URL in AvatarUrl column
router.post("/:id/avatar", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;

    if (userId !== currentUserId && currentUserId !== 1) {
      return res.status(403).json({ message: "Không có quyền cập nhật avatar" });
    }

    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ message: "imageBase64 là bắt buộc" });
    }

    // Validate it is a base64 data URL (data:image/...;base64,...)
    if (!imageBase64.startsWith("data:image/")) {
      return res.status(400).json({ message: "Định dạng ảnh không hợp lệ" });
    }

    // Rough size check: base64 string length * 0.75 ≈ bytes
    const approximateBytes = imageBase64.length * 0.75;
    const maxBytes = 2 * 1024 * 1024; // 2 MB
    if (approximateBytes > maxBytes) {
      return res.status(413).json({ message: "Ảnh quá lớn, tối đa 2MB" });
    }

    const { data: updated, error } = await supabase
      .from("Users")
      .update({ AvatarUrl: imageBase64 })
      .eq("UserID", userId)
      .select("UserID, AvatarUrl");

    if (error) {
      console.error("Supabase avatar update error:", error);
      return res.status(500).json({ message: "Lỗi lưu avatar", error: error.message });
    }

    if (!updated || updated.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Avatar được cập nhật thành công",
      avatarUrl: updated[0].AvatarUrl,
    });

    console.log(`User ${userId} avatar updated`);
  } catch (error) {
    console.error("Error updating avatar:", error);
    res.status(500).json({ message: "Error updating avatar", error: error.message });
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

    // Support both camelCase and PascalCase field names from frontend
    const hoten = req.body.hoten || req.body.HoTen || "";
    const email = req.body.email || req.body.Email || "";
    const phone = req.body.phone || req.body.SoDienThoai || req.body.Phone || null;
    const ngaysinh = req.body.ngaysinh || req.body.NgaySinh || null;
    const gioitinh = req.body.gioitinh || req.body.GioiTinh || null;
    const bio = req.body.bio || req.body.Bio || null;

    if (!hoten || !email) {
      return res.status(400).json({ message: "Họ tên và email là bắt buộc" });
    }

    const { data: updated, error } = await supabase
      .from("Users")
      .update({
        HoTen: hoten,
        Email: email,
        Phone: phone,
        NgaySinh: ngaysinh,
        GioiTinh: gioitinh,
        Bio: bio,
      })
      .eq("UserID", userId)
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio, AvatarUrl");

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
        avatarUrl: u.AvatarUrl || null,
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
      .select("UserID, Username, Email, HoTen, Phone, NgaySinh, GioiTinh, Bio, AvatarUrl")
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
        avatarUrl: user.AvatarUrl || null,
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
