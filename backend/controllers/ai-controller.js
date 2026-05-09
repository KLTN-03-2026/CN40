/**
 * ai-controller.js
 * Facade — re-exports handlers from ai-schedule-controller.js and ai-history-controller.js.
 * The ai.js router imports from here to keep a single stable interface.
 */

const {
  suggestSchedule,
  saveAiSuggestionsHandler,
  getAiEvents,
  testAi,
  clearOldSuggestions,
  getEventsAi,
  debugAiEvents,
  testDatabaseAi,
} = require("./ai-schedule-controller");

const {
  getHistory,
  updateHistory,
  getStats,
  parseScheduleImage,
} = require("./ai-history-controller");

module.exports = {
  suggestSchedule,
  saveAiSuggestionsHandler,
  getAiEvents,
  testAi,
  clearOldSuggestions,
  getEventsAi,
  debugAiEvents,
  testDatabaseAi,
  getHistory,
  updateHistory,
  getStats,
  parseScheduleImage,
};
