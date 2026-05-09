// group-tasks.js — Express router for GroupTasks
// Mounted at /api/group-tasks
const express = require("express");
const router = express.Router();
const svc = require("../services/group-task-service");

function handleErr(res, err) {
  if (err?.status) return res.status(err.status).json({ success: false, message: err.message });
  console.error("[group-tasks]", err);
  return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
}

// POST / — create task
router.post("/", async (req, res) => {
  try {
    const data = await svc.createTask(req.userId, req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// GET /?groupId=X — list tasks for group
router.get("/", async (req, res) => {
  try {
    const { groupId } = req.query;
    if (!groupId) return res.status(400).json({ success: false, message: "groupId là bắt buộc" });
    const data = await svc.listTasks(req.userId, groupId);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// GET /progress?groupId=X — progress stats per member
router.get("/progress", async (req, res) => {
  try {
    const { groupId } = req.query;
    if (!groupId) return res.status(400).json({ success: false, message: "groupId là bắt buộc" });
    const members = await svc.getProgress(req.userId, groupId);
    return res.json({ success: true, data: { members } });
  } catch (err) {
    return handleErr(res, err);
  }
});

// PUT /:id — update task
router.put("/:id", async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!taskId) return res.status(400).json({ success: false, message: "taskId không hợp lệ" });
    const data = await svc.updateTask(taskId, req.userId, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// GET /my-calendar — group tasks assigned to me with deadlines (for calendar view)
router.get("/my-calendar", async (req, res) => {
  try {
    const data = await svc.getMyCalendarTasks(req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return handleErr(res, err);
  }
});

// DELETE /:id — delete task
router.delete("/:id", async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!taskId) return res.status(400).json({ success: false, message: "taskId không hợp lệ" });
    await svc.deleteTask(taskId, req.userId);
    return res.json({ success: true, message: "Đã xóa nhiệm vụ" });
  } catch (err) {
    return handleErr(res, err);
  }
});

module.exports = router;
