/**
 * task-instance-controller.js
 * Handles req/res for task_instances endpoints.
 * Delegates business logic to task-instance-service.js.
 */

const taskInstanceService = require("../services/task-instance-service");

/** POST /api/task-instances */
async function createInstance(req, res) {
  try {
    console.log("[task-instances] POST: userId =", req.userId, "type:", typeof req.userId);
    const data = await taskInstanceService.createInstance(req.userId, req.body);
    res.status(201).json({ success: true, message: "Instance created", data });
  } catch (err) {
    console.error("POST /api/task-instances error:", err);
    if (err.migration) {
      return res.status(503).json({ success: false, message: err.message });
    }
    if (err.devDetail) {
      return res.status(err.status || 500).json({
        success: false,
        message: err.message,
        error: err.devDetail,
      });
    }
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

/** GET /api/task-instances */
async function listInstances(req, res) {
  try {
    const result = await taskInstanceService.listInstances(req.userId, req.query);
    const response = { success: true, data: result.data };
    if (result._fallback) response._fallback = result._fallback;
    res.json(response);
  } catch (err) {
    console.error("GET /api/task-instances error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

/** PATCH /api/task-instances/:id */
async function updateInstance(req, res) {
  try {
    const updated = await taskInstanceService.updateInstance(
      req.params.id,
      req.userId,
      req.body
    );
    res.json({ success: true, message: "Instance updated", data: updated });
  } catch (err) {
    console.error("PATCH /api/task-instances/:id error:", err);
    if (err.migration) {
      return res.status(503).json({ success: false, message: err.message });
    }
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

/** DELETE /api/task-instances/:id */
async function deleteInstance(req, res) {
  try {
    await taskInstanceService.deleteInstance(req.params.id, req.userId);
    res.json({ success: true, message: "Instance deleted" });
  } catch (err) {
    console.error("DELETE /api/task-instances/:id error:", err);
    if (err.migration) {
      return res.status(503).json({ success: false, message: err.message });
    }
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
}

module.exports = { createInstance, listInstances, updateInstance, deleteInstance };
