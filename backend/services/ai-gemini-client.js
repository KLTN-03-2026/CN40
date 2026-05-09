/**
 * ai-gemini-client.js
 * Singleton Gemini AI client — initialised once at module load.
 * Exports: { geminiModel, geminiAvailable, genAI }
 *
 * Import this wherever a Gemini model instance is needed instead of
 * re-initialising per-file. Module-level singleton ensures a single
 * connection pool and a single log line on startup.
 */

require("dotenv").config();

let geminiModel = null;
let geminiAvailable = false;
let genAI = null;

try {
  const { GoogleGenerativeAI } = require("@google/generative-ai");

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== "") {
    console.log("Initializing Gemini AI...");

    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 4096,
      },
    });

    geminiAvailable = true;
    console.log("Gemini AI initialized successfully with model: gemini-2.5-flash");
  } else {
    console.warn("GEMINI_API_KEY is missing or empty in .env file");
    console.log("AI will run in simulation mode");
  }
} catch (error) {
  console.error("Error initializing Gemini AI:", error.message);
  console.log("AI will run in simulation mode");
}

module.exports = { geminiModel, geminiAvailable, genAI };
