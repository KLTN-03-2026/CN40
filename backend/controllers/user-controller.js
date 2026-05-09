/**
 * user-controller.js
 * Handles req/res for Users endpoints.
 * Delegates business logic to user-service.js.
 */

const userService = require("../services/user-service");

/** GET /api/users/priority-colors */
async function getPriorityColors(req, res) {
  try {
    const result = await userService.getPriorityColors(req.user.UserID);
    const response = { success: true, data: result.data };
    if (result._fallback) response._fallback = result._fallback;
    res.json(response);
  } catch (err) {
    console.error("GET /priority-colors:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

/** PUT /api/users/priority-colors */
async function updatePriorityColors(req, res) {
  try {
    const merged = await userService.updatePriorityColors(req.user.UserID, req.body || {});
    res.json({ success: true, data: merged });
  } catch (err) {
    console.error("PUT /priority-colors:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

/** GET /api/users/profile */
async function getProfile(req, res) {
  try {
    const result = await userService.getProfile(req.user.UserID);
    const response = { success: true, data: result.data };
    if (result.usedFallback) response._fallback = "missing-columns";
    res.json(response);
  } catch (err) {
    console.error("Error fetching user profile:", err);
    res.status(err.status || 500).json({ message: err.message || "Error fetching profile" });
  }
}

/** GET /api/users/:id */
async function getUser(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;
    if (userId !== currentUserId && currentUserId !== 1) {
      return res.status(403).json({ message: "Không có quyền truy cập" });
    }
    const data = await userService.getUser(userId);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(err.status || 500).json({ message: err.message || "Error fetching user" });
  }
}

/** PUT /api/users/:id */
async function updateUser(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;
    if (userId !== currentUserId && currentUserId !== 1) {
      return res.status(403).json({ message: "Không có quyền cập nhật thông tin này" });
    }
    const data = await userService.updateUser(userId, req.body);
    res.json({ success: true, message: "Thông tin cá nhân được cập nhật thành công", data });
    console.log(`User ${userId} profile updated`);
  } catch (err) {
    console.error("Error updating user profile:", err);
    res.status(err.status || 500).json({ message: err.message || "Error updating profile" });
  }
}

/** DELETE /api/users/:id */
async function deleteUser(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const currentUserId = req.user.UserID;
    if (userId !== currentUserId && currentUserId !== 1) {
      return res.status(403).json({ message: "Không có quyền xóa tài khoản này" });
    }
    await userService.deleteUser(userId);
    res.json({ success: true, message: "Tài khoản được xóa thành công" });
    console.log(`User ${userId} account deleted`);
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(err.status || 500).json({ message: err.message || "Error deleting user" });
  }
}

/** PUT /api/users/:id/password */
async function changePassword(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const currentUserId = req.user.UserID;
    if (userId !== currentUserId) {
      return res.status(403).json({ message: "Không có quyền đổi mật khẩu người khác" });
    }
    await userService.changePassword(userId, req.body);
    res.json({ success: true, message: "Đổi mật khẩu thành công" });
  } catch (err) {
    console.error("PUT /users/:id/password:", err);
    res.status(err.status || 500).json({ message: err.message || "Lỗi server" });
  }
}

/** POST /api/users/avatar */
async function uploadAvatar(req, res) {
  try {
    const publicUrl = await userService.uploadAvatar(req.user.UserID, req.body?.dataUrl);
    res.json({ success: true, data: { avatarUrl: publicUrl } });
  } catch (err) {
    console.error("POST /users/avatar:", err);
    res.status(err.status || 500).json({ message: err.message || "Lỗi server" });
  }
}

module.exports = {
  getPriorityColors,
  updatePriorityColors,
  getProfile,
  getUser,
  updateUser,
  deleteUser,
  changePassword,
  uploadAvatar,
};
