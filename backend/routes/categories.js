const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "Không có token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res
      .status(403)
      .json({ success: false, message: "Token không hợp lệ" });
  }
};

router.use(authenticateToken);

// GET danh sách danh mục
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("LoaiCongViec")
      .select("MaLoai, TenLoai, MoTa")
      .eq("UserID", req.userId);

    if (error) {
      console.error("Lỗi tải danh mục:", error);
      return res.status(500).json({ success: false, message: "Lỗi tải danh mục" });
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Lỗi tải danh mục:", error);
    res.status(500).json({ success: false, message: "Lỗi tải danh mục" });
  }
});

// POST tạo danh mục
router.post("/", async (req, res) => {
  try {
    const { TenLoai, MoTa } = req.body;

    if (!TenLoai) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tên danh mục",
      });
    }

    const { data, error } = await supabase
      .from("LoaiCongViec")
      .insert({
        UserID: req.userId,
        TenLoai: TenLoai,
        MoTa: MoTa || "",
      })
      .select("MaLoai, TenLoai, MoTa")
      .single();

    if (error) {
      console.error("Lỗi tạo danh mục:", error);
      return res.status(500).json({ success: false, message: "Lỗi tạo danh mục" });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error("Lỗi tạo danh mục:", error);
    res.status(500).json({ success: false, message: "Lỗi tạo danh mục" });
  }
});

// PUT cập nhật danh mục
router.put("/:id", async (req, res) => {
  try {
    const { TenLoai, MoTa } = req.body;

    await supabase
      .from("LoaiCongViec")
      .update({ TenLoai, MoTa: MoTa || "" })
      .eq("MaLoai", req.params.id)
      .eq("UserID", req.userId);

    res.json({ success: true, message: "Cập nhật thành công" });
  } catch (error) {
    console.error("Lỗi cập nhật danh mục:", error);
    res.status(500).json({ success: false, message: "Lỗi cập nhật danh mục" });
  }
});

// DELETE xóa danh mục
router.delete("/:id", async (req, res) => {
  try {
    await supabase
      .from("LoaiCongViec")
      .delete()
      .eq("MaLoai", req.params.id)
      .eq("UserID", req.userId);

    res.json({ success: true, message: "Xóa danh mục thành công" });
  } catch (error) {
    console.error("Lỗi xóa danh mục:", error);
    res.status(500).json({ success: false, message: "Lỗi xóa danh mục" });
  }
});

module.exports = router;
