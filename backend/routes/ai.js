const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { supabase } = require("../config/database");
require("dotenv").config();

// GEMINI AI INITIALIZATION
let geminiModel = null;
let geminiAvailable = false;

try {
  const { GoogleGenerativeAI } = require("@google/generative-ai");

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== "") {
    console.log("Initializing Gemini AI...");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
    console.log(
      "Gemini AI initialized successfully with model: gemini-2.5-flash"
    );
  } else {
    console.warn("GEMINI_API_KEY is missing or empty in .env file");
    console.log("AI will run in simulation mode");
  }
} catch (error) {
  console.error("Error initializing Gemini AI:", error.message);
  console.log("AI will run in simulation mode");
}

// HELPER FUNCTIONS

function analyzeRecurringPatterns(additionalInstructions) {
  if (!additionalInstructions?.trim()) return [];

  const patterns = [];
  const text = additionalInstructions.toLowerCase().trim();

  console.log(`Analyzing text: "${text}"`);

  const isDailyPattern =
    /mỗi ngày|hàng ngày|every day|daily|từ.*đến|t2.*cn|thứ 2.*chủ nhật|monday.*sunday|trong tuần|weekday/.test(
      text
    );
  const isWeeklyPattern =
    /hàng tuần|mỗi tuần|every week|weekly|từ.*t\d|được học/.test(text);
  const hasSpecificDays =
    /t\d|thứ \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|cn|chủ nhật/.test(
      text
    );

  const timeRegex =
    /(\d{1,2})(?::(\d{2}))?\s*(?:h|giờ|am|pm)(?:\s*(?:sáng|chiều|tối|đêm))?\s*(?:(?:đến|-)\s*)?(\d{1,2})?(?::(\d{2}))?\s*(?:h|giờ|am|pm)?/gi;

  const times = [];
  let timeMatch;
  const textLower = additionalInstructions.toLowerCase();
  const seenTimes = new Set();

  while ((timeMatch = timeRegex.exec(textLower)) !== null) {
    let startHour = parseInt(timeMatch[1]);
    const startMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    let endHour = timeMatch[3] ? parseInt(timeMatch[3]) : null;
    const endMin = timeMatch[4] ? parseInt(timeMatch[4]) : 0;

    const beforeText = textLower.substring(
      Math.max(0, timeMatch.index - 30),
      timeMatch.index
    );
    const afterText = textLower.substring(
      timeMatch.index,
      Math.min(textLower.length, timeMatch.index + 50)
    );
    const context = beforeText + afterText;

    if (
      (context.includes("tối") ||
        context.includes("chiều") ||
        context.includes("đêm")) &&
      startHour < 12
    ) {
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
      if (new RegExp(pattern, "i").test(text)) {
        if (!days.includes(dayNum)) days.push(dayNum);
      }
    });
    if (days.length === 0) days.push(1, 2, 3, 4, 5, 6, 7);
  } else {
    Object.entries(dayMap).forEach(([pattern, dayNum]) => {
      if (new RegExp(pattern, "i").test(text)) {
        if (!days.includes(dayNum)) days.push(dayNum);
      }
    });
    if (isWeeklyPattern && days.length === 0) {
      days.push(1, 2, 3, 4, 5, 6, 7);
    }
  }

  if (times.length > 0 && days.length > 0) {
    const pattern = {
      frequency: isDailyPattern ? "daily" : "weekly",
      times: times,
      days: days.sort((a, b) => a - b),
      rawText: additionalInstructions,
    };
    patterns.push(pattern);
  }

  return patterns;
}

async function getTaskDetailsFromDatabase(taskIds, userId) {
  try {
    if (!taskIds || taskIds.length === 0) return [];

    const { data: tasks, error } = await supabase
      .from("CongViec")
      .select("MaCongViec, TieuDe, ThoiGianUocTinh, MucDoUuTien, MucDoPhucTap, MucDoTapTrung, ThoiDiemThichHop, MauSac")
      .in("MaCongViec", taskIds)
      .eq("UserID", userId)
      .eq("TrangThaiThucHien", 0);

    if (error) {
      console.error("Error fetching task details:", error);
      return [];
    }

    const timeMap = {
      1: "morning",
      2: "noon",
      3: "afternoon",
      4: "evening",
      5: "anytime",
    };

    const taskDetails = (tasks || []).map((task) => ({
      id: task.MaCongViec,
      title: task.TieuDe,
      estimatedMinutes: task.ThoiGianUocTinh || 60,
      priority: task.MucDoUuTien || 2,
      complexity: task.MucDoPhucTap || 2,
      focusLevel: task.MucDoTapTrung || 2,
      suitableTime: timeMap[task.ThoiDiemThichHop] || "anytime",
      color: task.MauSac || getColorByPriority(task.MucDoUuTien || 2),
    }));

    console.log(`Loaded ${taskDetails.length} task details from database`);
    return taskDetails;
  } catch (error) {
    console.error("Error fetching task details:", error);
    return [];
  }
}

function getColorByPriority(priority) {
  switch (priority) {
    case 1: return "#10B981";
    case 2: return "#3B82F6";
    case 3: return "#F59E0B";
    case 4: return "#EF4444";
    default: return "#8B5CF6";
  }
}

async function getExistingEvents(userId, startDate, endDate) {
  try {
    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, GioBatDau, GioKetThuc, AI_DeXuat, CongViec(TieuDe, MucDoUuTien)")
      .eq("UserID", userId)
      .gte("GioBatDau", new Date(startDate).toISOString())
      .lte("GioBatDau", new Date(endDate).toISOString())
      .order("GioBatDau", { ascending: true });

    if (error) {
      console.error("Error fetching existing events:", error.message);
      return [];
    }

    console.log(`Found ${(records || []).length} existing events`);
    return (records || []).map((event) => ({
      id: event.MaLichTrinh,
      start: event.GioBatDau,
      end: event.GioKetThuc,
      title: event.CongViec?.TieuDe,
      priority: event.CongViec?.MucDoUuTien,
      AI_DeXuat: event.AI_DeXuat,
    }));
  } catch (error) {
    console.error("Error fetching existing events:", error.message);
    return [];
  }
}

function buildGeminiPrompt(
  taskDetails,
  startDate,
  endDate,
  options,
  existingEvents,
  additionalInstructions = ""
) {
  const taskList = taskDetails
    .map(
      (task) => `
    - Công việc "${task.title}" (ID: ${task.id}):
      + Thời lượng: ${task.estimatedMinutes} phút
      + Ưu tiên: ${task.priority}/4
      + Thời điểm thích hợp: ${task.suitableTime}
      + Độ phức tạp: ${task.complexity}/5
      + Màu: ${task.color}
  `
    )
    .join("\n");

  const existingSchedule = existingEvents
    .map(
      (event) => `
    - "${event.title}": ${new Date(event.start).toLocaleString("vi-VN")}
  `
    )
    .join("\n");

  const recurringPatterns = analyzeRecurringPatterns(additionalInstructions);

  const recurringPatternsText =
    recurringPatterns.length > 0
      ? `\nCÁC YÊU CẦU LẶP LẠI ĐÃ PHÁT HIỆN:
${recurringPatterns
  .map(
    (p, idx) => `
  ${idx + 1}. Tần suất: ${p.frequency === "daily" ? "Hàng ngày" : "Hàng tuần"}
     Ngày: ${p.days
       .map((d) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d])
       .join(", ")}
     Thời gian: ${p.times
       .map(
         (t) =>
           `${t.startHour.toString().padStart(2, "0")}:${t.startMin
             .toString()
             .padStart(2, "0")}${
             t.endHour
               ? ` - ${t.endHour.toString().padStart(2, "0")}:${t.endMin
                   .toString()
                   .padStart(2, "0")}`
               : ""
           }`
       )
       .join(", ")}
`
  )
  .join("\n")}
`
      : "";

  const dayNames = {
    1: "Chủ nhật",
    2: "Thứ hai",
    3: "Thứ ba",
    4: "Thứ tư",
    5: "Thứ năm",
    6: "Thứ sáu",
    7: "Thứ bảy",
  };

  return `Bạn là trợ lý lập lịch thông minh chuyên biệt. NHIỆM VỤ: Sắp xếp TẤT CẢ ${
    taskDetails.length
  } công việc dưới đây vào lịch.

QUAN TRỌNG: BẠN PHẢI TẠO SUGGESTIONS CHO TẤT CẢ CÁC CÔNG VIỆC SAU, KHÔNG ĐƯỢC BỎ SÓT CÔNG VIỆC NÀO:

CÁC CÔNG VIỆC BẮT BUỘC PHẢI SẮP XẾP (${taskDetails.length} cái):
${taskList}

KHOẢNG THỜI GIAN: Từ ${startDate} đến ${endDate}

LỊCH HIỆN CÓ (TRÁNH TRÙNG):
${existingEvents.length > 0 ? existingSchedule : "Không có lịch hiện tại"}

YÊU CẦU CẤU HÌNH CHUNG:
1. ${options.considerPriority ? "Ưu tiên việc quan trọng trước" : "Không cần ưu tiên"}
2. ${options.avoidConflict ? "Tránh trùng với lịch hiện tại" : "Không cần tránh trùng"}
3. ${options.balanceWorkload ? "Cân bằng công việc giữa các ngày" : "Không cần cân bằng"}
4. Mỗi ngày không quá 8 tiếng làm việc
5. Làm việc trong khung giờ 08:00 đến 22:00

YÊU CẦU TỪ NGƯỜI DÙNG:
${additionalInstructions.trim() ? additionalInstructions : "(Không có yêu cầu đặc biệt)"}

HƯỚNG DẪN XỬ LÝ CHI TIẾT:

QUAN TRỌNG: NẾU YÊU CẦU CÓ "LẶP LẠI", "HÀNG NGÀY", "HÀNG TUẦN", v.v:
   → TẠO NHIỀU ENTRIES (một cho mỗi ngày/lần lặp)

PHÂN TÍCH NGÀY TRONG YÊU CẦU:
   - "T2" = Thứ 2 (${dayNames[2]})
   - "T3" = Thứ 3 (${dayNames[3]})
   - "T4" = Thứ 4 (${dayNames[4]})
   - "T5" = Thứ 5 (${dayNames[5]})
   - "T6" = Thứ 6 (${dayNames[6]})
   - "T7" = Thứ 7 (${dayNames[7]})
   - "CN" = Chủ nhật (${dayNames[1]})
   - "hằng ngày" / "mỗi ngày" / "trong tuần" = T2-CN (7 ngày)

THỰC HIỆN LẶP LẠI TRONG KHOẢNG NGÀY:
   - Khoảng ngày: ${startDate} đến ${endDate}
   - Nếu yêu cầu "hàng ngày", tạo 1 event cho mỗi ngày trong khoảng
   - KHÔNG chỉ tạo 1 event duy nhất!

ĐỊNH DẠNG RESPONSE (CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG GIẢI THÍCH):

{
  "suggestions": [
    {
      "taskId": 3013,
      "scheduledTime": "2025-12-15T06:00:00",
      "durationMinutes": 60,
      "reason": "Công việc ABCD 6h sáng T2",
      "isRecurring": true
    }
  ],
  "summary": "Đã tạo X events",
  "statistics": {
    "totalTasks": 1,
    "totalHours": 7,
    "daysUsed": 7,
    "recurringEvents": 7
  }
}

LUẬT BẮT BUỘC:
1. LUÔN trả JSON hợp lệ, không kèm giải thích
2. scheduledTime PHẢI nằm trong khoảng: ${startDate} - ${endDate}
3. Nếu là lặp lại, PHẢI có nhiều entries
4. Mỗi entry = 1 event cụ thể tại 1 ngày/giờ
5. "reason" bằng Tiếng Việt
6. Nếu không hiểu yêu cầu, dùng "suitableTime" từ danh sách công việc`;
}

async function callGeminiAI(prompt) {
  try {
    console.log("Calling Gemini AI API...");

    if (!geminiAvailable || !geminiModel) {
      throw new Error("Gemini AI is not available");
    }

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries}`);

        if (attempt > 1) {
          const delayMs = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("Gemini AI response received");

        let jsonMatch = text.match(/{[\s\S]*}/);

        if (!jsonMatch) {
          const backtickMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (backtickMatch) {
            const cleaned = backtickMatch[1].trim();
            jsonMatch = cleaned.match(/{[\s\S]*}/);
          }
        }

        if (!jsonMatch && text.trim().startsWith("{")) {
          jsonMatch = [text.trim()];
        }

        if (!jsonMatch) {
          throw new Error("No JSON found in response");
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
          throw new Error("Invalid response format: missing suggestions array");
        }

        if (parsed.suggestions.length === 0) {
          throw new Error("AI returned empty suggestions array");
        }

        console.log(`Parsed ${parsed.suggestions.length} suggestions successfully`);
        return parsed;
      } catch (attemptError) {
        lastError = attemptError;
        console.log(`Attempt ${attempt} failed:`, attemptError.message);
      }
    }

    throw lastError;
  } catch (error) {
    console.error("Gemini AI API error:", error.message);
    throw error;
  }
}

async function generateSimulatedSchedule(
  taskDetails,
  startDate,
  endDate,
  options,
  existingEvents
) {
  const suggestions = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const days = Math.max(1, Math.min(daysDiff, 7));

  const sortedTasks = [...taskDetails].sort((a, b) => b.priority - a.priority);

  const dailySlots = [
    { hour: 9, label: "sáng" },
    { hour: 13, label: "chiều" },
    { hour: 16, label: "chiều muộn" },
    { hour: 19, label: "tối" },
  ];

  for (let i = 0; i < sortedTasks.length; i++) {
    const task = sortedTasks[i];

    const dayIndex = i % days;
    const scheduleDate = new Date(start);
    scheduleDate.setDate(scheduleDate.getDate() + dayIndex);

    let slotIndex = 0;
    switch (task.suitableTime) {
      case "morning": slotIndex = 0; break;
      case "noon": slotIndex = 1; break;
      case "afternoon": slotIndex = 2; break;
      case "evening": slotIndex = 3; break;
      default: slotIndex = i % dailySlots.length;
    }

    const slot = dailySlots[slotIndex];
    scheduleDate.setHours(slot.hour, 0, 0, 0);

    if (options.avoidConflict && existingEvents.length > 0) {
      const taskEnd = new Date(
        scheduleDate.getTime() + task.estimatedMinutes * 60000
      );
      const hasConflict = existingEvents.some((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        return scheduleDate < eventEnd && taskEnd > eventStart;
      });

      if (hasConflict) {
        slotIndex = (slotIndex + 1) % dailySlots.length;
        scheduleDate.setHours(dailySlots[slotIndex].hour);
      }
    }

    const reasons = [
      `Ưu tiên ${task.priority}, xếp vào buổi ${slot.label}`,
      `Phù hợp với thời điểm ${task.suitableTime}`,
      `Công việc quan trọng, cần hoàn thành sớm`,
      `Phân bố hợp lý trong kế hoạch tuần`,
    ];

    suggestions.push({
      taskId: task.id,
      scheduledTime: scheduleDate.toISOString(),
      durationMinutes: task.estimatedMinutes,
      reason: reasons[Math.floor(Math.random() * reasons.length)],
      color: task.color,
    });
  }

  const uniqueDays = new Set(
    suggestions.map((s) => new Date(s.scheduledTime).toDateString())
  ).size;

  const totalMinutes = suggestions.reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  );

  return {
    suggestions,
    summary: `Đã tạo ${suggestions.length} khung giờ trong ${uniqueDays} ngày. Tổng thời lượng: ${Math.round(totalMinutes / 60)} giờ.`,
    statistics: {
      totalTasks: suggestions.length,
      totalHours: Math.round(totalMinutes / 60),
      daysUsed: uniqueDays,
    },
  };
}

async function generateSimulatedScheduleWithInstructions(
  taskDetails,
  startDate,
  endDate,
  options,
  existingEvents,
  additionalInstructions = ""
) {
  const recurringPatterns = analyzeRecurringPatterns(additionalInstructions);

  const suggestions = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

  if (recurringPatterns.length > 0) {
    for (const pattern of recurringPatterns) {
      let selectedTask = null;
      const instructionLower = additionalInstructions.toLowerCase();

      for (const task of taskDetails) {
        if (instructionLower.includes(task.title.toLowerCase())) {
          selectedTask = task;
          break;
        }
      }

      if (!selectedTask) selectedTask = taskDetails[0];

      for (let i = 0; i <= daysDiff; i++) {
        const currentDate = new Date(start);
        currentDate.setDate(currentDate.getDate() + i);
        const dayOfWeek = currentDate.getDay() === 0 ? 7 : currentDate.getDay();

        if (pattern.days.includes(dayOfWeek)) {
          for (const time of pattern.times) {
            const eventDate = new Date(currentDate);
            eventDate.setHours(time.startHour, time.startMin, 0, 0);

            let durationMinutes = selectedTask.estimatedMinutes || 60;
            if (time.endHour !== null) {
              const startTotalMin = time.startHour * 60 + time.startMin;
              const endTotalMin = time.endHour * 60 + time.endMin;
              durationMinutes = endTotalMin - startTotalMin;
            }

            suggestions.push({
              taskId: selectedTask.id,
              scheduledTime: eventDate.toISOString(),
              durationMinutes: Math.max(durationMinutes, 30),
              reason: `${selectedTask.title} - Lúc ${time.startHour
                .toString()
                .padStart(2, "0")}:${time.startMin
                .toString()
                .padStart(2, "0")}${
                time.endHour
                  ? ` - ${time.endHour.toString().padStart(2, "0")}:${time.endMin
                      .toString()
                      .padStart(2, "0")}`
                  : ""
              }`,
              color: selectedTask.color,
              isRecurring: true,
            });
          }
        }
      }
    }
  }

  if (suggestions.length === 0) {
    const baseSchedule = await generateSimulatedSchedule(
      taskDetails, startDate, endDate, options, existingEvents
    );
    return {
      ...baseSchedule,
      summary: baseSchedule.summary + " (Chế độ mặc định)",
    };
  }

  const uniqueDays = new Set(
    suggestions.map((s) => new Date(s.scheduledTime).toDateString())
  ).size;

  const totalMinutes = suggestions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const recurringCount = suggestions.filter((s) => s.isRecurring).length;

  return {
    suggestions: suggestions.map(({ isRecurring, ...rest }) => rest),
    summary: `Đã tạo ${suggestions.length} khung giờ (bao gồm ${recurringCount} events lặp lại) trong ${uniqueDays} ngày. Tổng thời lượng: ${Math.round(totalMinutes / 60)} giờ.`,
    statistics: {
      totalTasks: suggestions.length,
      totalHours: Math.round(totalMinutes / 60),
      daysUsed: uniqueDays,
      recurringEvents: recurringCount,
    },
  };
}

// API ENDPOINTS

router.post("/suggest-schedule", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { tasks: taskIds, startDate, endDate, options = {} } = req.body;
    const additionalInstructions = req.body.additionalInstructions || "";

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn ít nhất một công việc",
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn khoảng thời gian",
      });
    }

    const taskDetails = await getTaskDetailsFromDatabase(taskIds, userId);
    if (taskDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy công việc được chọn",
      });
    }

    let existingEvents = [];
    if (options.avoidConflict) {
      try {
        existingEvents = await getExistingEvents(userId, startDate, endDate);
      } catch (eventError) {
        existingEvents = [];
      }
    }

    let aiResult;
    let mode = "simulation";

    if (geminiAvailable) {
      try {
        const prompt = buildGeminiPrompt(
          taskDetails, startDate, endDate, options, existingEvents, additionalInstructions
        );

        aiResult = await callGeminiAI(prompt);
        mode = "gemini";
      } catch (aiError) {
        console.error("Gemini AI failed:", aiError.message);
        aiResult = await generateSimulatedScheduleWithInstructions(
          taskDetails, startDate, endDate, options, existingEvents, additionalInstructions
        );
        mode = "simulation_fallback";
      }
    } else {
      aiResult = await generateSimulatedScheduleWithInstructions(
        taskDetails, startDate, endDate, options, existingEvents, additionalInstructions
      );
      mode = "simulation";
    }

    if (!aiResult.suggestions || !Array.isArray(aiResult.suggestions)) {
      throw new Error("Invalid response format from AI");
    }

    const response = {
      success: true,
      data: {
        suggestions: aiResult.suggestions.map((suggestion) => ({
          taskId: suggestion.taskId,
          scheduledTime: suggestion.scheduledTime,
          durationMinutes: suggestion.durationMinutes,
          reason: suggestion.reason || "Được xếp tự động",
          color: suggestion.color || "#8B5CF6",
        })),
        summary: aiResult.summary || `Đã tạo ${aiResult.suggestions.length} khung giờ`,
        statistics: aiResult.statistics || {
          totalTasks: aiResult.suggestions.length,
          totalHours: Math.round(
            aiResult.suggestions.reduce((sum, s) => sum + s.durationMinutes, 0) / 60
          ),
          daysUsed: new Set(
            aiResult.suggestions.map((s) => new Date(s.scheduledTime).toDateString())
          ).size,
        },
        mode: mode,
      },
      message:
        mode === "gemini"
          ? "AI đã tạo lịch trình thành công"
          : "Đã tạo lịch trình (chế độ mô phỏng)",
    };

    res.json(response);
  } catch (error) {
    console.error("AI processing failed:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi xử lý AI",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      mode: "error",
    });
  }
});

router.post("/save-ai-suggestions", authenticateToken, async (req, res) => {
  const { suggestions } = req.body;
  const userId = req.userId;

  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    return res.status(400).json({ success: false, message: "Danh sách rỗng" });
  }

  // Prevent duplicate saves
  const uniqueKey = `${userId}_${suggestions.map((s) => s.taskId).sort().join("_")}`;
  if (
    global.lastAISaveKey === uniqueKey &&
    Date.now() - global.lastAISaveTime < 5000
  ) {
    return res.json({ success: true, saved: 0, message: "Đã lưu rồi, không lưu lại" });
  }
  global.lastAISaveKey = uniqueKey;
  global.lastAISaveTime = Date.now();

  try {
    // 1. Xóa AI suggestions cũ
    const { data: deletedData } = await supabase
      .from("LichTrinh")
      .delete()
      .eq("UserID", userId)
      .eq("AI_DeXuat", true)
      .select("MaLichTrinh");

    const deletedCount = deletedData?.length || 0;
    console.log(`Deleted ${deletedCount} old AI events`);

    // 2. Lưu AI suggestions mới
    const savedIds = [];

    for (const s of suggestions) {
      const start = new Date(s.scheduledTime);
      const end = new Date(start.getTime() + s.durationMinutes * 60000);

      // Check duplicate
      const { data: existing } = await supabase
        .from("LichTrinh")
        .select("MaLichTrinh")
        .eq("MaCongViec", s.taskId)
        .eq("GioBatDau", start.toISOString())
        .eq("UserID", userId)
        .eq("AI_DeXuat", true)
        .limit(1);

      if (existing && existing.length > 0) {
        savedIds.push(existing[0].MaLichTrinh);
        continue;
      }

      const { data: result, error } = await supabase
        .from("LichTrinh")
        .insert({
          MaCongViec: s.taskId,
          GioBatDau: start.toISOString(),
          GioKetThuc: end.toISOString(),
          GhiChu: s.reason || "Được đề xuất bởi AI",
          AI_DeXuat: true,
          UserID: userId,
        })
        .select("MaLichTrinh")
        .single();

      if (result) {
        savedIds.push(result.MaLichTrinh);
      }
    }

    console.log(`Saved ${savedIds.length}/${suggestions.length} AI suggestions`);

    // 3. Track AI proposal (optional table)
    try {
      const summaryContent = suggestions
        .map((s, i) => `${i + 1}. ${s.title || "Công việc"} - ${s.durationMinutes || 60} phút`)
        .join("\n");

      await supabase
        .from("PhienAIDeXuat")
        .insert({
          UserID: userId,
          NgayDeXuat: new Date().toISOString(),
          NoiDungYeuCau: `AI Proposal:\n${summaryContent}`,
          DaApDung: true,
          ThoiGianApDung: new Date().toISOString(),
        });
    } catch (trackError) {
      console.warn("Could not track AI proposal:", trackError.message);
    }

    res.json({
      success: true,
      saved: savedIds.length,
      savedIds: savedIds,
      deletedOld: deletedCount,
    });
  } catch (err) {
    console.error("Lỗi lưu AI suggestions:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/ai/ai-events
router.get("/ai-events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, GhiChu, AI_DeXuat, CongViec(TieuDe, MucDoUuTien, MauSac)")
      .eq("UserID", userId)
      .eq("AI_DeXuat", true)
      .order("GioBatDau", { ascending: false });

    if (error) {
      console.error("Error fetching AI events:", error);
      return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }

    // Deduplicate
    const eventMap = new Map();
    (records || []).forEach((r) => {
      const key = `${r.MaCongViec}_${new Date(r.GioBatDau).getTime()}`;
      if (!eventMap.has(key)) {
        eventMap.set(key, r);
      }
    });

    const events = Array.from(eventMap.values()).map((ev) => ({
      MaLichTrinh: ev.MaLichTrinh,
      MaCongViec: ev.MaCongViec,
      TieuDe: ev.CongViec?.TieuDe || "Lịch trình AI",
      GioBatDau: ev.GioBatDau,
      GioKetThuc: ev.GioKetThuc,
      GhiChu: ev.GhiChu || "Được AI tối ưu",
      Color: ev.CongViec?.MauSac || getColorByPriority(ev.CongViec?.MucDoUuTien || 2),
      priority: ev.CongViec?.MucDoUuTien,
      AI_DeXuat: ev.AI_DeXuat,
    }));

    res.json({ success: true, data: events });
  } catch (error) {
    console.error("Error fetching AI events:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

router.get("/test", authenticateToken, (req, res) => {
  res.json({
    success: true,
    geminiAvailable: geminiAvailable,
    model: "gemini-2.5-flash",
    message: geminiAvailable
      ? "Gemini AI is ready to use"
      : "Gemini AI is not available (check GEMINI_API_KEY in .env)",
    timestamp: new Date().toISOString(),
  });
});

router.delete("/clear-old-suggestions", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: countData } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh", { count: "exact" })
      .eq("UserID", userId)
      .eq("AI_DeXuat", true);

    const oldCount = countData?.length || 0;

    await supabase
      .from("LichTrinh")
      .delete()
      .eq("UserID", userId)
      .eq("AI_DeXuat", true);

    res.json({
      success: true,
      clearedCount: oldCount,
      message: `Đã xóa ${oldCount} lịch trình AI cũ`,
    });
  } catch (error) {
    console.error("Error clearing old AI suggestions:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa lịch trình AI cũ",
      error: error.message,
    });
  }
});

router.get("/events/ai", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: records, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, GhiChu, CongViec!inner(TieuDe, MucDoUuTien, MauSac)")
      .eq("UserID", userId)
      .eq("AI_DeXuat", true)
      .order("GioBatDau", { ascending: false });

    if (error) {
      console.error("Lỗi lấy lịch AI:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    const events = (records || []).map((ev) => ({
      MaLichTrinh: ev.MaLichTrinh,
      MaCongViec: ev.MaCongViec,
      TieuDe: ev.CongViec?.TieuDe,
      GioBatDau: ev.GioBatDau,
      GioKetThuc: ev.GioKetThuc,
      GhiChu: ev.GhiChu || "AI đề xuất",
      Color: ev.CongViec?.MauSac || getColorByPriority(ev.CongViec?.MucDoUuTien || 2),
      priority: ev.CongViec?.MucDoUuTien,
      AI_DeXuat: 1,
    }));

    res.json({ success: true, data: events });
  } catch (err) {
    console.error("Lỗi lấy lịch AI:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/debug-ai-events", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: countData } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh", { count: "exact" })
      .eq("UserID", userId)
      .eq("AI_DeXuat", true);

    const { data: detailData } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat, CongViec(TieuDe, UserID)")
      .eq("UserID", userId)
      .eq("AI_DeXuat", true)
      .order("GioBatDau", { ascending: false });

    res.json({
      success: true,
      debug: {
        totalAIEvents: countData?.length || 0,
        events: detailData || [],
        queryConditions: { userId, AI_DeXuat: true },
      },
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/test-database-ai", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: allEvents } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat, UserID")
      .eq("UserID", userId)
      .order("GioBatDau", { ascending: false });

    const { data: recentEvents } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, MaCongViec, GioBatDau, GioKetThuc, AI_DeXuat")
      .eq("UserID", userId)
      .order("MaLichTrinh", { ascending: false })
      .limit(10);

    res.json({
      success: true,
      data: {
        totalEvents: (allEvents || []).length,
        allEvents: allEvents || [],
        recentEvents: recentEvents || [],
        userInfo: {
          userId,
          hasAIEvents: (allEvents || []).some((e) => e.AI_DeXuat === true),
        },
      },
    });
  } catch (error) {
    console.error("Test database error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ai/history
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { limit = 20, offset = 0 } = req.query;

    // Try to get from PhienAIDeXuat table
    const { data: records, error } = await supabase
      .from("PhienAIDeXuat")
      .select("*")
      .eq("UserID", userId)
      .order("NgayDeXuat", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      console.warn("PhienAIDeXuat table may not exist:", error.message);
      return res.json({
        success: true,
        data: [],
        stats: { total: 0, totalProposals: 0, appliedCount: 0, pendingCount: 0, appliedPercentage: 0 },
        pagination: { limit: parseInt(limit), offset: parseInt(offset), total: 0 },
      });
    }

    const { count } = await supabase
      .from("PhienAIDeXuat")
      .select("*", { count: "exact", head: true })
      .eq("UserID", userId);

    const total = count || 0;

    const { data: allRecords } = await supabase
      .from("PhienAIDeXuat")
      .select("DaApDung")
      .eq("UserID", userId);

    const appliedCount = (allRecords || []).filter((r) => r.DaApDung).length;
    const pendingCount = (allRecords || []).length - appliedCount;

    res.json({
      success: true,
      data: records || [],
      stats: {
        total,
        totalProposals: (allRecords || []).length,
        appliedCount,
        pendingCount,
        appliedPercentage: (allRecords || []).length
          ? Math.round((appliedCount / (allRecords || []).length) * 100)
          : 0,
      },
      pagination: { limit: parseInt(limit), offset: parseInt(offset), total },
    });
  } catch (error) {
    console.error("Error getting AI history:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/ai/history/:id
router.put("/history/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const proposalId = req.params.id;
    const { DaApDung } = req.body;

    const { data: existing } = await supabase
      .from("PhienAIDeXuat")
      .select("MaPhienDeXuat")
      .eq("MaPhienDeXuat", proposalId)
      .eq("UserID", userId)
      .single();

    if (!existing) {
      return res.status(403).json({
        success: false,
        message: "Không có quyền truy cập proposal này",
      });
    }

    const updateData = { DaApDung: DaApDung ? true : false };
    if (DaApDung) {
      updateData.ThoiGianApDung = new Date().toISOString();
    } else {
      updateData.ThoiGianApDung = null;
    }

    await supabase
      .from("PhienAIDeXuat")
      .update(updateData)
      .eq("MaPhienDeXuat", proposalId);

    res.json({ success: true, message: `Đã cập nhật proposal #${proposalId}` });
  } catch (error) {
    console.error("Error updating proposal:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ai/stats
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: records, error } = await supabase
      .from("PhienAIDeXuat")
      .select("DaApDung, ThoiGianApDung, NgayDeXuat")
      .eq("UserID", userId);

    if (error) {
      return res.json({
        success: true,
        data: {
          totalRequests: 0,
          appliedRequests: 0,
          pendingRequests: 0,
          appliedPercentage: 0,
          lastUsed: null,
        },
      });
    }

    const allRecords = records || [];
    const totalRequests = allRecords.length;
    const appliedRequests = allRecords.filter((r) => r.DaApDung).length;
    const pendingRequests = totalRequests - appliedRequests;
    const appliedPercentage = totalRequests
      ? Math.round((appliedRequests / totalRequests) * 100)
      : 0;

    const lastApplied = allRecords
      .filter((r) => r.DaApDung && r.ThoiGianApDung)
      .sort((a, b) => new Date(b.ThoiGianApDung) - new Date(a.ThoiGianApDung))[0];

    const lastRequested = allRecords
      .sort((a, b) => new Date(b.NgayDeXuat) - new Date(a.NgayDeXuat))[0];

    res.json({
      success: true,
      data: {
        totalRequests,
        appliedRequests,
        pendingRequests,
        appliedPercentage,
        lastUsed: lastApplied?.ThoiGianApDung || lastRequested?.NgayDeXuat || null,
      },
    });
  } catch (error) {
    console.error("Error getting AI stats:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
