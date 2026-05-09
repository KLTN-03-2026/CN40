/**
 * calendar.js — thin router for /api/calendar
 * Auth applied at mount level in server.js (authenticateToken sets req.userId).
 * Business logic lives in controllers/calendar-controller.js + services/calendar-service.js.
 */

const express = require("express");
const router = express.Router();
const controller = require("../controllers/calendar-controller");

router.get("/events", controller.getEvents);
router.get("/range", controller.getEventsInRange);
router.get("/ai-events", controller.getAiEvents);
router.post("/events", controller.createEvent);
router.put("/events/:id", controller.updateEvent);
router.delete("/events/:id", controller.deleteEvent);

module.exports = router;
