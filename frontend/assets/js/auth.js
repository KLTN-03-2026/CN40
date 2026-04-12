const AuthManager = {
  async login(username, password) {
    try {


      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Đăng nhập thất bại");
      }

      localStorage.setItem("auth_token", result.data.token);
      localStorage.setItem("user_data", JSON.stringify(result.data.user));

      Utils.showToast("Đăng nhập thành công!", "success");
      setTimeout(() => window.location.replace("/index.html"), 600);
    } catch (err) {
      Utils.showToast(err.message || "Lỗi kết nối server", "error");
      throw err;
    }
  },

  async register(userData) {
    try {


      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Đăng ký thất bại");
      }

      localStorage.setItem("auth_token", result.data.token);
      localStorage.setItem("user_data", JSON.stringify(result.data.user));

      Utils.showToast("Đăng ký thành công! Chào mừng bạn!", "success");
      setTimeout(() => window.location.replace("/index.html"), 800);
    } catch (err) {
      Utils.showToast(err.message || "Lỗi kết nối server", "error");
      throw err;
    }
  },

  logout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_data");
    Utils.showToast("Đăng xuất thành công", "info");
    setTimeout(() => window.location.replace("/login.html"), 600);
  },

  getToken() {
    return localStorage.getItem("auth_token");
  },

  getUserData() {
    const userData = localStorage.getItem("user_data");
    return userData ? JSON.parse(userData) : null;
  },

  isAuthenticated() {
    return !!this.getToken();
  },
};

if (typeof window !== "undefined") {
  window.AuthManager = AuthManager;

}

if (typeof window === "undefined") {
  const express = require("express");
  const router = express.Router();
  const jwt = require("jsonwebtoken");
  const sql = require("mssql");

  const { dbPoolPromise, JWT_SECRET } = require("../config");

  router.get("/tasks", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token)
      return res.status(401).json({
        success: false,
        message: "Không có token",
      });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = req.query.userId || decoded.userId;

      const pool = await dbPoolPromise;
      const result = await pool.request().input("userId", sql.Int, userId)
        .query(`
          SELECT [MaCongViec], [UserID], [MaLoai], [TieuDe], [MoTa], [Tag],
              [CoThoiGianCoDinh], [GioBatDauCoDinh], [GioKetThuc],
              [DanhGiaThucHien], [GhiChu], [TrangThaiThucHien], [NgayTao],
              [ThoiGianUocTinh], [MucDoPhucTap], [MucDoTapTrung],
              [ThoiDiemThichHop], [LuongTheoGio]
          FROM [CongViec]
          WHERE [UserID] = @userId
        `);

      res.json({
        success: true,
        data: result.recordset,
      });
    } catch (err) {
      console.error("Lỗi lấy công việc:", err);
      res.status(500).json({
        success: false,
        message: "Lỗi server",
      });
    }
  });

  module.exports = router;
}
