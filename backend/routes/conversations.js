const express = require("express");
const router = express.Router();
const svc = require("../services/conversation-service");

// GET /api/conversations — list user's conversations
router.get("/", async (req, res) => {
  try {
    const data = await svc.listConversations(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// GET /api/conversations/unread-count — must be before /:id
router.get("/unread-count", async (req, res) => {
  try {
    const count = await svc.getUnreadCount(req.userId);
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// GET /api/conversations/direct/:userId — get or create direct conversation
router.get("/direct/:userId", async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: "UserID không hợp lệ" });
    }
    if (targetUserId === req.userId) {
      return res.status(400).json({ success: false, message: "Không thể tạo hội thoại với chính mình" });
    }
    const result = await svc.getOrCreateDirect(req.userId, targetUserId);
    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// GET /api/conversations/group/:groupId — get group conversation
router.get("/group/:groupId", async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId);
    if (!groupId || isNaN(groupId)) {
      return res.status(400).json({ success: false, message: "GroupID không hợp lệ" });
    }
    const data = await svc.getGroupConversation(groupId, req.userId);
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// PUT /api/conversations/:id/read — mark conversation as read
router.put("/:id/read", async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ success: false, message: "ConversationID không hợp lệ" });
    }
    await svc.markAsRead(conversationId, req.userId);
    res.json({ success: true, message: "Đã đánh dấu đã đọc" });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

module.exports = router;
