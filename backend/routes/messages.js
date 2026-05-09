const express = require("express");
const router = express.Router();
const svc = require("../services/message-service");

// GET /api/messages?conversationId=X&before=ISO&limit=30
router.get("/", async (req, res) => {
  try {
    const conversationId = parseInt(req.query.conversationId);
    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ success: false, message: "conversationId không hợp lệ" });
    }
    const { before, limit } = req.query;
    const data = await svc.getMessages(conversationId, req.userId, { before, limit });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// POST /api/messages — send a message
router.post("/", async (req, res) => {
  try {
    const { conversationId, noiDung, loaiTinNhan, metaData } = req.body;
    const parsedConvId = parseInt(conversationId);
    if (!parsedConvId || isNaN(parsedConvId)) {
      return res.status(400).json({ success: false, message: "conversationId không hợp lệ" });
    }
    const data = await svc.sendMessage(parsedConvId, req.userId, { noiDung, loaiTinNhan, metaData });
    res.status(201).json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// PUT /api/messages/:id — edit own message
router.put("/:id", async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    if (!messageId || isNaN(messageId)) {
      return res.status(400).json({ success: false, message: "MessageID không hợp lệ" });
    }
    await svc.editMessage(messageId, req.userId, req.body.noiDung);
    res.json({ success: true, message: "Đã cập nhật tin nhắn" });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

// DELETE /api/messages/:id — soft delete own message
router.delete("/:id", async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    if (!messageId || isNaN(messageId)) {
      return res.status(400).json({ success: false, message: "MessageID không hợp lệ" });
    }
    await svc.deleteMessage(messageId, req.userId);
    res.json({ success: true, message: "Đã xóa tin nhắn" });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message || "Lỗi server" });
  }
});

module.exports = router;
