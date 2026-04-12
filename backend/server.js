// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");

const { authenticateToken } = require("./middleware/auth");

// Routes
const authRoutes = require("./routes/auth");
const tasksRoutes = require("./routes/tasks");
const taskInstancesRoutes = require("./routes/task-instances");
const calendarRoutes = require("./routes/calendar");
const aiRoutes = require("./routes/ai");
const categoriesRoutes = require("./routes/categories");
const salaryRoutes = require("./routes/salary");
const statisticsRoutes = require("./routes/statistics");
const usersRoutes = require("./routes/users");
const notificationRoutes = require("./routes/notification.routes");

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
app.use("/api/task-instances", authenticateToken, taskInstancesRoutes);
app.use("/api/calendar", authenticateToken, calendarRoutes);
app.use("/api/ai", authenticateToken, aiRoutes);
app.use("/api/categories", authenticateToken, categoriesRoutes);
app.use("/api/salary", authenticateToken, salaryRoutes);
app.use("/api/statistics", authenticateToken, statisticsRoutes);
app.use("/api/users", authenticateToken, usersRoutes);
app.use("/api/notifications", notificationRoutes);

// API cũ vẫn dùng (nếu có)
app.get("/api/work/tasks", authenticateToken, (req, res) =>
  tasksRoutes(req, res)
);

// ===========================
// HTML ROUTES (SPA)
// ===========================
const sendFile = (file) => (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend", file));

app.get("/login", sendFile("login.html"));
app.get("/register", sendFile("register.html"));
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
});
