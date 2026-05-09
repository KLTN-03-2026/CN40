// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");

const { authenticateToken } = require("./middleware/auth");

// Routes
const authRoutes = require("./routes/auth");
const tasksRoutes = require("./routes/tasks");
const calendarRoutes = require("./routes/calendar");
const aiRoutes = require("./routes/ai");
const categoriesRoutes = require("./routes/categories");
const salaryRoutes = require("./routes/salary");
const statisticsRoutes = require("./routes/statistics");
const usersRoutes = require("./routes/users");
const eventSubtasksRoutes = require("./routes/event-subtasks");
const taskInstancesRoutes = require("./routes/task-instances");
const applyScheduleRoutes = require("./routes/apply-schedule");
const scheduleCompletionRoutes = require("./routes/schedule-completion");
const aiReferenceRoutes = require("./routes/ai-reference");
const adjustmentsRoutes = require("./routes/adjustments");
const notificationRoutes = require("./routes/notification.routes");
const notificationPrefsRoutes = require("./routes/notification-prefs");
const chatAdvisorRoutes = require("./routes/chat-advisor");
const pomodoroRoutes = require("./routes/pomodoro");
const tagsRoutes = require("./routes/tags");
const calendarSharesRoutes = require("./routes/calendar-shares");
const calendarSharedEventsRoute = require("./routes/calendar-shared-events");
const habitsRoutes = require("./routes/habits");
const friendsRoutes = require("./routes/friends");
const groupsRoutes = require("./routes/groups");
const groupTasksRoutes = require("./routes/group-tasks");
const conversationsRoutes = require("./routes/conversations");
const messagesRoutes = require("./routes/messages");
const configRoutes = require("./routes/config");
const googleCalendarRoutes = require("./routes/google-calendar");
const gamificationRoutes = require("./routes/gamification");

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================
// CẤU HÌNH CƠ BẢN
// ===========================
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
];

// Thêm frontend URL từ env (cho Vercel deploy)
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // In production, be more permissive for Vercel preview URLs
        if (process.env.NODE_ENV === "production" && origin.endsWith(".vercel.app")) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all origins for now during migration
        }
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../frontend")));

// ===========================
// ROUTES
// ===========================
app.use("/api/auth", authRoutes);
app.use("/api/tasks", authenticateToken, tasksRoutes);
app.use("/api/calendar", authenticateToken, calendarRoutes);
app.use("/api/ai", authenticateToken, aiRoutes);
app.use("/api/categories", authenticateToken, categoriesRoutes);
app.use("/api/salary", authenticateToken, salaryRoutes);
app.use("/api/statistics", authenticateToken, statisticsRoutes);
app.use("/api/users", authenticateToken, usersRoutes);
app.use("/api/event-subtasks", eventSubtasksRoutes);
app.use("/api/task-instances", authenticateToken, taskInstancesRoutes);
app.use("/api/schedule", authenticateToken, applyScheduleRoutes);
app.use("/api/schedule", authenticateToken, scheduleCompletionRoutes);
app.use("/api/ai-reference", authenticateToken, aiReferenceRoutes);
app.use("/api/adjustments", authenticateToken, adjustmentsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notifications", authenticateToken, notificationPrefsRoutes);
app.use("/api/chat-advisor", authenticateToken, chatAdvisorRoutes);
app.use("/api/pomodoro", authenticateToken, pomodoroRoutes);
app.use("/api/tags", authenticateToken, tagsRoutes);
app.use("/api/calendar-shares", authenticateToken, calendarSharesRoutes);
app.use("/api/calendar", authenticateToken, calendarSharedEventsRoute);
app.use("/api/habits", authenticateToken, habitsRoutes);
app.use("/api/friends", authenticateToken, friendsRoutes);
app.use("/api/groups", authenticateToken, groupsRoutes);
app.use("/api/group-tasks", authenticateToken, groupTasksRoutes);
app.use("/api/conversations", authenticateToken, conversationsRoutes);
app.use("/api/messages", authenticateToken, messagesRoutes);
app.use("/api/config", configRoutes);
// google-calendar: /callback has no auth (uses signed JWT state); other routes apply auth internally
app.use("/api/google-calendar", googleCalendarRoutes);
app.use("/api/gamification", authenticateToken, gamificationRoutes);

// API cũ vẫn dùng (nếu có)
app.get("/api/work/tasks", authenticateToken, (req, res) =>
  tasksRoutes(req, res)
);

// ===========================
// HTML ROUTES (SPA)
// ===========================
const sendFile = (file) => (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend", file));

app.get("/login", sendFile("index.html"));
app.get("/register", sendFile("index.html"));
app.get(
  [
    "/",
    "/dashboard",
    "/home",
    "/work",
    "/salary",
    "/profile",
    "/calendar",
    "/settings",
    "/groups",
    "/chat",
  ],
  sendFile("index.html")
);

// Catch-all
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ success: false, message: "API không tồn tại" });
  }
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ===========================
// KHỞI ĐỘNG
// ===========================
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Start Telegram bot polling + per-user cron jobs.
  // Guarded: token missing → skip gracefully, don't crash the HTTP server.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const telegramBot = require("./telegram/bot");
      telegramBot.initializeSchedules?.();
      console.log("Telegram bot polling started");

      // Reminder engine (15-min-before, weekly, monthly salary, weekend AI)
      try {
        const reminderEngine = require("./telegram/reminder-engine");
        reminderEngine.start?.();
      } catch (e) {
        console.warn("Reminder engine not available:", e.message);
      }
    } catch (err) {
      console.error("Telegram bot failed to start:", err.message);
    }
  } else {
    console.log("TELEGRAM_BOT_TOKEN not set — skipping Telegram bot startup");
  }
});
