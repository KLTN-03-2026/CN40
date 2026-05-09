/**
 * tasks.js — thin router for /api/tasks
 * Auth applied at mount level in server.js (authenticateToken sets req.userId).
 * Business logic lives in controllers/task-controller.js + services/task-service.js.
 */

const express = require("express");
const router = express.Router();
const controller = require("../controllers/task-controller");

// Static routes must be declared before :id to avoid mismatching
router.get("/full-time-category", controller.getFullTimeCategory);

router.get("/", controller.listTasks);
router.post("/", controller.createTask);
router.get("/:id", controller.getTask);
router.put("/:id", controller.updateTask);
router.delete("/:id", controller.deleteTask);

module.exports = router;
