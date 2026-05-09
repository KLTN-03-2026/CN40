/**
 * users.js — thin router for /api/users
 * Auth applied at mount level in server.js (authenticateToken sets req.user).
 * Business logic lives in controllers/user-controller.js + services/user-service.js.
 */

const express = require("express");
const router = express.Router();
const controller = require("../controllers/user-controller");

// Static routes before :id to avoid mis-routing
router.get("/priority-colors", controller.getPriorityColors);
router.put("/priority-colors", controller.updatePriorityColors);
router.get("/profile", controller.getProfile);
router.post("/avatar", controller.uploadAvatar);

router.get("/:id", controller.getUser);
router.put("/:id/password", controller.changePassword);
router.put("/:id", controller.updateUser);
router.delete("/:id", controller.deleteUser);

module.exports = router;
