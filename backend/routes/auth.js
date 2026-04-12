require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { supabase } = require("../config/database");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";

router.post("/register", async (req, res) => {
  try {
    const { username, email, password, hoten } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Kiểm tra trùng
    const { data: existing } = await supabase
      .from("Users")
      .select("UserID")
      .or(`Username.eq.${username},Email.eq.${email}`);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Tên đăng nhập hoặc email đã tồn tại",
      });
    }

    // Tạo user
    const hashed = await bcrypt.hash(password, 12);
    const { data: newUser, error: insertError } = await supabase
      .from("Users")
      .insert({
        Username: username,
        Password: hashed,
        Email: email,
        HoTen: hoten || username,
        CreatedDate: new Date().toISOString(),
        NgayTao: new Date().toISOString(),
        LuongTheoGio: 29000,
        IsActive: true,
      })
      .select("UserID, Username, Email, HoTen")
      .single();

    if (insertError) {
      console.error("Insert user error:", insertError);
      return res.status(500).json({
        success: false,
        message: "Lỗi khi tạo tài khoản: " + insertError.message,
      });
    }

    // Tạo 4 danh mục mặc định
    const defaultCats = [
      { UserID: newUser.UserID, TenLoai: "Công việc", MoTa: "Công việc hàng ngày" },
      { UserID: newUser.UserID, TenLoai: "Cá nhân", MoTa: "Việc cá nhân" },
      { UserID: newUser.UserID, TenLoai: "Học tập", MoTa: "Học tập và phát triển" },
      { UserID: newUser.UserID, TenLoai: "Sức khỏe", MoTa: "Chăm sóc sức khỏe" },
    ];

    await supabase.from("LoaiCongViec").insert(defaultCats);

    const token = jwt.sign(
      { userId: newUser.UserID, username: newUser.Username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      success: true,
      message: "Đăng ký thành công",
      data: {
        token: token,
        user: {
          id: newUser.UserID,
          username: newUser.Username,
          email: newUser.Email,
          hoten: newUser.HoTen || newUser.Username,
        },
      },
    });
  } catch (err) {
    console.error("Lỗi đăng ký:", err);
    return res.status(500).json({
      success: false,
      message: "Lỗi server: " + err.message,
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const { data: users, error } = await supabase
      .from("Users")
      .select("*")
      .or(`Username.eq.${username},Email.eq.${username}`);

    if (error || !users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Tên đăng nhập hoặc mật khẩu không đúng",
      });
    }

    const user = users[0];

    if (!(await bcrypt.compare(password, user.Password))) {
      return res.status(401).json({
        success: false,
        message: "Tên đăng nhập hoặc mật khẩu không đúng",
      });
    }

    // Cập nhật LastLogin
    await supabase
      .from("Users")
      .update({ LastLogin: new Date().toISOString() })
      .eq("UserID", user.UserID);

    const token = jwt.sign(
      { userId: user.UserID, username: user.Username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: "Đăng nhập thành công",
      data: {
        token,
        user: {
          id: user.UserID,
          username: user.Username,
          email: user.Email,
          hoten: user.HoTen,
          luongTheoGio: user.LuongTheoGio || 0,
        },
      },
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res
      .status(500)
      .json({ success: false, message: "Lỗi server khi đăng nhập" });
  }
});

router.get("/verify", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Không có token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const { data: user, error } = await supabase
      .from("Users")
      .select("UserID, Username, Email, HoTen, LuongTheoGio")
      .eq("UserID", decoded.userId)
      .single();

    if (error || !user) {
      throw new Error("User not found");
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    res
      .status(401)
      .json({ success: false, message: "Token không hợp lệ hoặc đã hết hạn" });
  }
});

router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Đăng xuất thành công" });
});

module.exports = router;
