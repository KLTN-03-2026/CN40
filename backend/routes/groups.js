// groups.js — Express router for Group management
// Mounted at /api/groups
const express = require("express");
const router = express.Router();
const svc = require("../services/group-service");
const memberSvc = require("../services/group-member-service");

function handleErr(res, err) {
  if (err?.status) return res.status(err.status).json({ success: false, message: err.message });
  console.error("[groups]", err);
  return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
}

// POST / — create group
router.post("/", async (req, res) => {
  try {
    const group = await svc.createGroup(req.userId, req.body);
    return res.status(201).json({ success: true, data: group });
  } catch (err) {
    return handleErr(res, err);
  }
});

// GET / — list my groups
router.get("/", async (req, res) => {
  try {
    const data = await svc.listMyGroups(req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// GET /:id — group detail + members
router.get("/:id", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    if (!groupId) return res.status(400).json({ success: false, message: "GroupID không hợp lệ" });
    const data = await svc.getGroupDetail(groupId, req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// PUT /:id — update group info
router.put("/:id", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    if (!groupId) return res.status(400).json({ success: false, message: "GroupID không hợp lệ" });
    const data = await svc.updateGroup(groupId, req.userId, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// DELETE /:id — delete group (owner only)
router.delete("/:id", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    if (!groupId) return res.status(400).json({ success: false, message: "GroupID không hợp lệ" });
    await svc.deleteGroup(groupId, req.userId);
    return res.json({ success: true, message: "Đã xóa nhóm" });
  } catch (err) {
    return handleErr(res, err);
  }
});

// POST /:id/members — add member
router.post("/:id/members", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const targetUserId = parseInt(req.body.userId, 10);
    if (!groupId || !targetUserId) {
      return res.status(400).json({ success: false, message: "groupId và userId là bắt buộc" });
    }
    await memberSvc.addMember(groupId, req.userId, targetUserId);
    return res.status(201).json({ success: true, message: "Đã thêm thành viên" });
  } catch (err) {
    return handleErr(res, err);
  }
});

// PUT /:id/members/:userId/role — change member role (owner only)
router.put("/:id/members/:userId/role", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const targetUserId = parseInt(req.params.userId, 10);
    const { role } = req.body;
    if (!groupId || !targetUserId) {
      return res.status(400).json({ success: false, message: "groupId và userId không hợp lệ" });
    }
    await memberSvc.changeMemberRole(groupId, req.userId, targetUserId, role);
    return res.json({ success: true, message: "Đã cập nhật vai trò" });
  } catch (err) {
    return handleErr(res, err);
  }
});

// DELETE /:id/members/:userId — remove member or leave group
router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const targetUserId = parseInt(req.params.userId, 10);
    if (!groupId || !targetUserId) {
      return res.status(400).json({ success: false, message: "groupId và userId không hợp lệ" });
    }
    await memberSvc.removeMember(groupId, req.userId, targetUserId);
    return res.json({ success: true, message: "Đã xóa thành viên" });
  } catch (err) {
    return handleErr(res, err);
  }
});

module.exports = router;
