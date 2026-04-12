const cron = require("node-cron");
const { supabase } = require("../config/database");
const { sendSchedule, sendMessageToUser } = require("./bot");

class ScheduleSender {
  constructor() {
    this.jobs = new Map();
    console.log(" ScheduleSender initialized");
  }

  start() {
    this.jobs.set(
      "morning-schedule",
      cron.schedule("0 8 * * *", async () => {
        console.log("🌅 Sending morning schedules...");
        await this.sendMorningSchedules();
      })
    );

    this.jobs.set(
      "afternoon-reminder",
      cron.schedule("0 14 * * *", async () => {
        console.log("☀️ Sending afternoon reminders...");
        await this.sendAfternoonReminders();
      })
    );

    this.jobs.set(
      "evening-summary",
      cron.schedule("0 18 * * *", async () => {
        console.log("🌆 Sending evening summaries...");
        await this.sendEveningSummaries();
      })
    );

    console.log(" All schedule jobs started");
    console.log(" Morning schedule: 8:00 AM");
    console.log(" Afternoon reminder: 2:00 PM");
    console.log(" Evening summary: 6:00 PM");
  }

  async sendMorningSchedules() {
    try {
      const { data: users, error: usersError } = await supabase
        .from("TelegramConnections")
        .select("UserID, TelegramChatId, ThongBaoNhiemVu")
        .eq("TrangThaiKetNoi", true)
        .eq("ThongBaoNhiemVu", true);

      if (usersError) throw usersError;

      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      let successCount = 0;
      let failCount = 0;

      for (const user of users || []) {
        try {
          const { data: tasks, error: tasksError } = await supabase
            .from("CongViec")
            .select("TieuDe, MoTa, GioBatDau, GioKetThuc")
            .eq("UserID", user.UserID)
            .gte("GioBatDau", startOfDay.toISOString())
            .lte("GioBatDau", endOfDay.toISOString())
            .order("GioBatDau");

          if (tasksError) throw tasksError;

          if (!tasks || tasks.length === 0) {
            console.log(`⏭️ No tasks for user ${user.UserID}`);
            continue;
          }

          const schedule = {
            date: this.formatDate(today),
            tasks: tasks.map((task) => ({
              time: new Date(task.GioBatDau).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              title: task.TieuDe,
              description: task.MoTa || "",
            })),
          };

          const result = await sendSchedule(user.UserID, schedule);
          if (result.success) successCount++;
          else failCount++;
        } catch (error) {
          console.error(` Error for user ${user.UserID}:`, error.message);
          failCount++;
        }
      }

      console.log(` Morning schedules: ${successCount} sent, ${failCount} failed`);
      return { successCount, failCount };
    } catch (error) {
      console.error(" Error sending morning schedules:", error);
      throw error;
    }
  }

  async sendAfternoonReminders() {
    try {
      const { data: users, error: usersError } = await supabase
        .from("TelegramConnections")
        .select("UserID, TelegramChatId")
        .eq("TrangThaiKetNoi", true)
        .eq("ThongBaoNhiemVu", true);

      if (usersError) throw usersError;

      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      let successCount = 0;

      for (const user of users || []) {
        try {
          const { data: tasks, error: tasksError } = await supabase
            .from("CongViec")
            .select("TieuDe, GioBatDau")
            .eq("UserID", user.UserID)
            .gte("GioBatDau", now.toISOString())
            .lte("GioBatDau", endOfDay.toISOString())
            .order("GioBatDau");

          if (tasksError) throw tasksError;
          if (!tasks || tasks.length === 0) continue;

          let message = " <b>Nhắc nhở buổi chiều</b>\n\n";
          message += `Bạn còn <b>${tasks.length}</b> công việc cần chú ý:\n\n`;

          tasks.forEach((task, index) => {
            const time = new Date(task.GioBatDau).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            });
            message += `${index + 1}. ${task.TieuDe}\n`;
            message += `   ⏱️ ${time}\n`;
          });

          message += "\nHãy cố gắng hoàn thành nhé! 💪";

          const result = await sendMessageToUser(user.UserID, message);
          if (result.success) successCount++;
        } catch (error) {
          console.error(` Error for user ${user.UserID}:`, error.message);
        }
      }

      console.log(` Afternoon reminders: ${successCount} sent`);
      return { successCount };
    } catch (error) {
      console.error(" Error sending afternoon reminders:", error);
      throw error;
    }
  }

  async sendEveningSummaries() {
    try {
      const { data: users, error: usersError } = await supabase
        .from("TelegramConnections")
        .select("UserID, TelegramChatId")
        .eq("TrangThaiKetNoi", true)
        .eq("ThongBaoNhiemVu", true);

      if (usersError) throw usersError;

      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      let successCount = 0;

      for (const user of users || []) {
        try {
          const { data: tasks, error: tasksError } = await supabase
            .from("CongViec")
            .select("TrangThai")
            .eq("UserID", user.UserID)
            .gte("GioBatDau", startOfDay.toISOString())
            .lte("GioBatDau", endOfDay.toISOString());

          if (tasksError) throw tasksError;
          if (!tasks || tasks.length === 0) continue;

          const total = tasks.length;
          const completed = tasks.filter((t) => t.TrangThai === "completed").length;
          const inProgress = tasks.filter((t) => t.TrangThai === "in_progress").length;
          const notStarted = tasks.filter((t) => !t.TrangThai || t.TrangThai === "pending").length;

          let message = "🌆 <b>Tổng kết ngày hôm nay</b>\n\n";
          message += ` Hoàn thành: <b>${completed}</b> công việc\n`;
          message += ` Đang làm: <b>${inProgress}</b> công việc\n`;
          message += ` Chưa làm: <b>${notStarted}</b> công việc\n\n`;

          if (completed > 0) {
            const percentage = Math.round((completed / total) * 100);
            message += ` Tỷ lệ hoàn thành: <b>${percentage}%</b>\n\n`;
          }

          if (completed >= total * 0.8) {
            message += " Xuất sắc! Bạn đã có một ngày làm việc hiệu quả!";
          } else if (completed >= total * 0.5) {
            message += "👍 Tốt lắm! Tiếp tục phát huy nhé!";
          } else {
            message += "💪 Ngày mai sẽ tốt hơn! Cố gắng lên!";
          }

          const result = await sendMessageToUser(user.UserID, message);
          if (result.success) successCount++;
        } catch (error) {
          console.error(` Error for user ${user.UserID}:`, error.message);
        }
      }

      console.log(` Evening summaries: ${successCount} sent`);
      return { successCount };
    } catch (error) {
      console.error(" Error sending evening summaries:", error);
      throw error;
    }
  }

  async sendScheduleToUser(userId, schedule) {
    try {
      return await sendSchedule(userId, schedule);
    } catch (error) {
      console.error(` Error sending schedule to user ${userId}:`, error);
      return { success: false, message: error.message };
    }
  }

  async sendNotificationToUser(userId, message) {
    try {
      return await sendMessageToUser(userId, message);
    } catch (error) {
      console.error(` Error sending notification to user ${userId}:`, error);
      return { success: false, message: error.message };
    }
  }

  stop() {
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
    }
    this.jobs.clear();
  }

  formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

const scheduleSender = new ScheduleSender();
module.exports = scheduleSender;
