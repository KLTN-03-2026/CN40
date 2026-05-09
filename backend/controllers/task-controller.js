/**
 * task-controller.js
 * Handles req/res for CongViec (tasks) endpoints.
 * Delegates business logic to task-service.js.
 */

const taskService = require("../services/task-service");

/** GET /api/tasks */
async function listTasks(req, res) {
  try {
    const data = await taskService.listTasks(req.userId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi lấy công việc:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });
  }
}

/** GET /api/tasks/full-time-category */
async function getFullTimeCategory(req, res) {
  try {
    const cat = await taskService.getFullTimeCategory(req.userId);
    res.json({ success: true, data: cat || null });
  } catch (err) {
    console.error("Lỗi tìm danh mục full-time:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });
  }
}

/** GET /api/tasks/:id */
async function getTask(req, res) {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) {
      return res.status(400).json({ success: false, message: "ID không hợp lệ" });
    }
    const data = await taskService.getTask(taskId, req.userId);
    res.json({ success: true, data });
  } catch (err) {
    console.error("Lỗi lấy chi tiết công việc:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });
  }
}

/** POST /api/tasks */
async function createTask(req, res) {
  try {
    const task = await taskService.createTask(req.userId, req.body);
    res.status(201).json({
      success: true,
      data: task,
      message: "Tạo công việc thành công",
    });
  } catch (err) {
    console.error("Lỗi tạo công việc:", err);
    const body = { success: false, message: err.message || "Lỗi server khi tạo công việc" };
    if (err.code) body.code = err.code;
    if (err.existing_task) body.existing_task = err.existing_task;
    if (err.devDetail && process.env.NODE_ENV === "development") body.error = err.devDetail;
    res.status(err.status || 500).json(body);
  }
}

/** PUT /api/tasks/:id */
async function updateTask(req, res) {
  try {
    await taskService.updateTask(req.params.id, req.userId, req.body);
    res.json({ success: true, message: "Cập nhật thành công" });
  } catch (err) {
    console.error("Lỗi cập nhật công việc:", err);
    const body = { success: false, message: err.message || "Lỗi server" };
    if (err.code) body.code = err.code;
    if (err.existing_task) body.existing_task = err.existing_task;
    res.status(err.status || 500).json(body);
  }
}

/** DELETE /api/tasks/:id */
async function deleteTask(req, res) {
  const taskId = parseInt(req.params.id);
  if (isNaN(taskId)) {
    return res.status(400).json({ success: false, message: "ID không hợp lệ" });
  }

  try {
    const force = req.query.force === "true" || req.body?.force === true;
    const result = await taskService.deleteTask(taskId, req.userId, force);

    if (result.requireConfirmation) {
      return res.status(200).json({ success: false, ...result });
    }

    const msg = result.scheduleCount > 0
      ? `Đã xóa công việc và ${result.scheduleCount} lịch trình`
      : "Xóa thành công";

    return res.json({
      success: true,
      message: msg,
      ...(result.scheduleCount > 0 ? { deletedSchedules: result.scheduleCount } : {}),
    });
  } catch (err) {
    console.error("Lỗi xóa công việc:", err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Lỗi server khi xóa công việc",
    });
  }
}

module.exports = { listTasks, getFullTimeCategory, getTask, createTask, updateTask, deleteTask };
