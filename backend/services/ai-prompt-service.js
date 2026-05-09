/**
 * ai-prompt-service.js
 * Prompt building, recurring-pattern analysis, JSON parsing helpers,
 * and Gemini Vision calls for schedule-image import.
 * Used by ai-schedule-service.js and ai-controller.js.
 */

const { genAI, geminiAvailable } = require("./ai-gemini-client");

// ---------------------------------------------------------------------------
// Recurring pattern analysis
// ---------------------------------------------------------------------------

/** Parse free-text instructions to extract recurring schedule patterns. */
function analyzeRecurringPatterns(additionalInstructions) {
  if (!additionalInstructions?.trim()) return [];

  const patterns = [];
  const text = additionalInstructions.toLowerCase().trim();
  console.log(`Analyzing text: "${text}"`);

  const isDailyPattern = /mỗi ngày|hàng ngày|every day|daily|từ.*đến|t2.*cn|thứ 2.*chủ nhật|monday.*sunday|trong tuần|weekday/.test(text);
  const isWeeklyPattern = /hàng tuần|mỗi tuần|every week|weekly|từ.*t\d|được học/.test(text);
  const hasSpecificDays = /t\d|thứ \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|cn|chủ nhật/.test(text);

  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(?:h|giờ|am|pm)(?:\s*(?:sáng|chiều|tối|đêm))?\s*(?:(?:đến|-)\s*)?(\d{1,2})?(?::(\d{2}))?\s*(?:h|giờ|am|pm)?/gi;
  const times = [];
  let timeMatch;
  const seenTimes = new Set();

  while ((timeMatch = timeRegex.exec(text)) !== null) {
    let startHour = parseInt(timeMatch[1]);
    const startMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    let endHour = timeMatch[3] ? parseInt(timeMatch[3]) : null;
    const endMin = timeMatch[4] ? parseInt(timeMatch[4]) : 0;

    const ctx = text.substring(Math.max(0, timeMatch.index - 30), Math.min(text.length, timeMatch.index + 50));
    if ((ctx.includes("tối") || ctx.includes("chiều") || ctx.includes("đêm")) && startHour < 12) {
      startHour += 12;
      if (endHour && endHour < 12) endHour += 12;
    }

    const timeKey = `${startHour}:${startMin}-${endHour || "end"}:${endMin}`;
    if (seenTimes.has(timeKey)) continue;
    seenTimes.add(timeKey);
    times.push({ startHour, startMin, endHour, endMin });
  }

  const dayMap = {
    "\\bt2\\b|thứ\\s*2|thứ\\s*hai|monday": 2,
    "\\bt3\\b|thứ\\s*3|thứ\\s*ba|tuesday": 3,
    "\\bt4\\b|thứ\\s*4|thứ\\s*tư|wednesday": 4,
    "\\bt5\\b|thứ\\s*5|thứ\\s*năm|thursday": 5,
    "\\bt6\\b|thứ\\s*6|thứ\\s*sáu|friday": 6,
    "\\bt7\\b|thứ\\s*7|thứ\\s*bảy|saturday": 7,
    "\\bcn\\b|chủ\\s*nhật|sunday": 1,
  };

  const days = [];
  if (isDailyPattern && !hasSpecificDays) {
    days.push(1, 2, 3, 4, 5, 6, 7);
  } else if (isDailyPattern && hasSpecificDays) {
    Object.entries(dayMap).forEach(([pattern, dayNum]) => {
      if (new RegExp(pattern, "i").test(text) && !days.includes(dayNum)) days.push(dayNum);
    });
    if (days.length === 0) days.push(1, 2, 3, 4, 5, 6, 7);
  } else {
    Object.entries(dayMap).forEach(([pattern, dayNum]) => {
      if (new RegExp(pattern, "i").test(text) && !days.includes(dayNum)) days.push(dayNum);
    });
    if (isWeeklyPattern && days.length === 0) days.push(1, 2, 3, 4, 5, 6, 7);
  }

  if (times.length > 0 && days.length > 0) {
    patterns.push({ frequency: isDailyPattern ? "daily" : "weekly", times, days: days.sort((a, b) => a - b), rawText: additionalInstructions });
  }
  return patterns;
}

// ---------------------------------------------------------------------------
// Gemini prompt builder
// ---------------------------------------------------------------------------

const DAY_NAMES = { 1: "Chủ nhật", 2: "Thứ hai", 3: "Thứ ba", 4: "Thứ tư", 5: "Thứ năm", 6: "Thứ sáu", 7: "Thứ bảy" };
const DAY_ABBR  = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function buildGeminiPrompt(taskDetails, startDate, endDate, options, existingEvents, additionalInstructions = "") {
  const taskList = taskDetails.map((task) =>
    `\n    - Công việc "${task.title}" (ID: ${task.id}):\n      + Thời lượng: ${task.estimatedMinutes} phút\n      + Ưu tiên: ${task.priority}/4\n      + Thời điểm thích hợp: ${task.suitableTime}\n      + Độ phức tạp: ${task.complexity}/5\n      + Màu: ${task.color}`
  ).join("\n");

  const existingSchedule = existingEvents.map((event) =>
    `\n    - "${event.title}": ${new Date(event.start).toLocaleString("vi-VN")}`
  ).join("\n");

  const recurringPatterns = analyzeRecurringPatterns(additionalInstructions);
  const recurringPatternsText = recurringPatterns.length > 0
    ? `\nCÁC YÊU CẦU LẶP LẠI ĐÃ PHÁT HIỆN:\n${recurringPatterns.map((p, idx) =>
        `\n  ${idx + 1}. Tần suất: ${p.frequency === "daily" ? "Hàng ngày" : "Hàng tuần"}\n     Ngày: ${p.days.map((d) => DAY_ABBR[d]).join(", ")}\n     Thời gian: ${p.times.map((t) => `${String(t.startHour).padStart(2, "0")}:${String(t.startMin).padStart(2, "0")}${t.endHour ? ` - ${String(t.endHour).padStart(2, "0")}:${String(t.endMin).padStart(2, "0")}` : ""}`).join(", ")}`
      ).join("\n")}\n`
    : "";

  return `Bạn là trợ lý lập lịch thông minh chuyên biệt. NHIỆM VỤ: Sắp xếp TẤT CẢ ${taskDetails.length} công việc dưới đây vào lịch.\n\nQUAN TRỌNG: BẠN PHẢI TẠO SUGGESTIONS CHO TẤT CẢ CÁC CÔNG VIỆC SAU, KHÔNG ĐƯỢC BỎ SÓT CÔNG VIỆC NÀO:\n\nCÁC CÔNG VIỆC BẮT BUỘC PHẢI SẮP XẾP (${taskDetails.length} cái):\n${taskList}\n\nKHOẢNG THỜI GIAN: Từ ${startDate} đến ${endDate}\n\nLỊCH HIỆN CÓ (TRÁNH TRÙNG):\n${existingEvents.length > 0 ? existingSchedule : "Không có lịch hiện tại"}\n${recurringPatternsText}\nYÊU CẦU CẤU HÌNH CHUNG:\n1. ${options.considerPriority ? "Ưu tiên việc quan trọng trước" : "Không cần ưu tiên"}\n2. ${options.avoidConflict ? "Tránh trùng với lịch hiện tại" : "Không cần tránh trùng"}\n3. ${options.balanceWorkload ? "Cân bằng công việc giữa các ngày" : "Không cần cân bằng"}\n4. Mỗi ngày không quá 8 tiếng làm việc\n5. Làm việc trong khung giờ 08:00 đến 22:00\n\nYÊU CẦU TỪ NGƯỜI DÙNG:\n${additionalInstructions.trim() ? additionalInstructions : "(Không có yêu cầu đặc biệt)"}\n\nĐỊNH DẠNG RESPONSE (CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG GIẢI THÍCH):\n\n{\n  "suggestions": [\n    {\n      "taskId": 3013,\n      "scheduledTime": "2025-12-15T06:00:00",\n      "durationMinutes": 60,\n      "reason": "Công việc ABCD 6h sáng T2",\n      "isRecurring": true\n    }\n  ],\n  "summary": "Đã tạo X events",\n  "statistics": {\n    "totalTasks": 1,\n    "totalHours": 7,\n    "daysUsed": 7,\n    "recurringEvents": 7\n  }\n}\n\nLUẬT BẮT BUỘC:\n1. LUÔN trả JSON hợp lệ, không kèm giải thích\n2. scheduledTime PHẢI nằm trong khoảng: ${startDate} - ${endDate}\n3. Nếu là lặp lại, PHẢI có nhiều entries\n4. Mỗi entry = 1 event cụ thể tại 1 ngày/giờ\n5. "reason" bằng Tiếng Việt`;
}

// ---------------------------------------------------------------------------
// Vision JSON parsing helpers
// ---------------------------------------------------------------------------

/** Extract the first complete JSON object via brace-depth counting. */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Sanitize common Gemini JSON quirks: smart quotes, trailing commas. */
function sanitizeLooseJson(raw) {
  return raw.replace(/[""]/g, '"').replace(/['']/g, "'").replace(/,(\s*[}\]])/g, "$1");
}

/** Extract the first complete JSON array via bracket-depth counting. */
function extractFirstJsonArray(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Parse vision JSON with multiple fallback strategies. */
function parseVisionJson(text) {
  let raw = extractFirstJsonObject(text);
  let asArray = false;
  if (!raw) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced) raw = extractFirstJsonObject(fenced[1]);
  }
  if (!raw) { raw = extractFirstJsonArray(text); asArray = !!raw; }
  if (!raw) {
    console.log("[vision] raw response snippet:", text.slice(0, 300));
    throw new Error("No JSON in vision response");
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e1) {
    try { parsed = JSON.parse(sanitizeLooseJson(raw)); }
    catch (e2) {
      const posMatch = /position (\d+)/i.exec(e2.message);
      if (posMatch) {
        const pos = Number(posMatch[1]);
        throw new Error(`${e2.message} | near: ...${raw.slice(Math.max(0, pos - 60), pos + 60)}...`);
      }
      throw e2;
    }
  }
  if (asArray) parsed = { items: parsed, warnings: [] };
  return parsed;
}

// ---------------------------------------------------------------------------
// Gemini Vision call
// ---------------------------------------------------------------------------

const VISION_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];

/** Call Gemini Vision with retry and model fallback rotation. */
async function callGeminiVision(prompt, imageBase64, mimeType) {
  if (!geminiAvailable || !genAI) throw new Error("Gemini AI is not available");

  const parts = [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }];
  const maxRetries = VISION_MODEL_FALLBACKS.length + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const modelName =
      attempt <= 2
        ? VISION_MODEL_FALLBACKS[0]
        : VISION_MODEL_FALLBACKS[attempt - 2] || VISION_MODEL_FALLBACKS[VISION_MODEL_FALLBACKS.length - 1];
    try {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt - 1) + Math.random() * 800));
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 4096 },
      });
      const text = ((await result.response).text() || "").trim();
      if (!text) throw new Error("Empty response from AI (service busy)");
      const parsed = parseVisionJson(text);
      if (!Array.isArray(parsed.items)) throw new Error("Invalid response: missing items array");
      return parsed;
    } catch (err) {
      lastError = err;
      console.log(`[vision] attempt ${attempt} (${modelName}) failed: ${err.message}`);
      const msg = String(err.message || "").toLowerCase();
      const transient = msg.includes("503") || msg.includes("overload") || msg.includes("busy") || msg.includes("unavailable") || msg.includes("high demand") || msg.includes("empty response") || msg.includes("no json") || msg.includes("expected") || msg.includes("position") || msg.includes("unexpected");
      if (!transient) break;
    }
  }
  throw lastError;
}

module.exports = {
  analyzeRecurringPatterns,
  buildGeminiPrompt,
  parseVisionJson,
  callGeminiVision,
  extractFirstJsonObject,
  sanitizeLooseJson,
  extractFirstJsonArray,
};
