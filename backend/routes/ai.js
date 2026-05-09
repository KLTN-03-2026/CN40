/**
 * ai.js — thin router for /api/ai
 * Auth applied at mount level in server.js (authenticateToken sets req.userId).
 * Business logic lives in controllers/ai-controller.js and the ai-*-service.js files.
 */

const express = require("express");
const router = express.Router();
const controller = require("../controllers/ai-controller");

router.post("/suggest-schedule", controller.suggestSchedule);
router.post("/save-ai-suggestions", controller.saveAiSuggestionsHandler);
router.get("/ai-events", controller.getAiEvents);
router.get("/test", controller.testAi);
router.delete("/clear-old-suggestions", controller.clearOldSuggestions);
router.get("/events/ai", controller.getEventsAi);
router.get("/debug-ai-events", controller.debugAiEvents);
router.get("/test-database-ai", controller.testDatabaseAi);
router.get("/history", controller.getHistory);
router.put("/history/:id", controller.updateHistory);
router.get("/stats", controller.getStats);
router.post("/parse-schedule-image", controller.parseScheduleImage);

module.exports = router;
