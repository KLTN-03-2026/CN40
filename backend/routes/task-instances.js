/**
 * task-instances.js — thin router for /api/task-instances
 * Auth applied at mount level in server.js (authenticateToken sets req.userId).
 * Business logic lives in controllers/task-instance-controller.js + services/task-instance-service.js.
 *
 * Routes:
 *   POST   /api/task-instances       — schedule a new instance
 *   GET    /api/task-instances       — list instances (?task_id=, ?start=, ?end=, ?status=)
 *   PATCH  /api/task-instances/:id   — update start_at / end_at / status / note / title
 *   DELETE /api/task-instances/:id   — remove a single scheduling
 */

const express = require("express");
const router = express.Router();
const controller = require("../controllers/task-instance-controller");

router.post("/", controller.createInstance);
router.get("/", controller.listInstances);
router.patch("/:id", controller.updateInstance);
router.delete("/:id", controller.deleteInstance);

module.exports = router;
