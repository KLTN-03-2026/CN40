// 📁 /telegram/schedule-updater.js

const cron = require("node-cron");
const { supabase } = require("../config/database");
// Tránh circular dependency - import bot khi cần
let bot = null;
const getBotInstance = () => {
  if (!bot) {
    bot = require("./bot").bot;
  }
  return bot;
};

class ScheduleUpdater {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Khởi động lại toàn bộ lịch trình từ database
   */
  async restartAllSchedules() {
    try {
      this.stopAllJobs();

      const { data: users, error } = await supabase
        .from("TelegramConnections")
        .select("UserID, GioNhacNhiemVu, GioLichNgay, GioTongKetNgay, ThongBaoNhiemVu")
        .eq("TrangThaiKetNoi", true)
        .eq("ThongBaoNhiemVu", true)
        .order("UserID");

      if (error) throw error;

      this.groupAndScheduleJobs(users || []);
    } catch (error) {
      console.error("❌ Error restarting schedules:", error);
    }
  }

  /**
   * Nhóm người dùng theo giờ và tạo schedule jobs
   */
  groupAndScheduleJobs(users) {
    const schedulesByTime = {
      morning: new Map(),
      afternoon: new Map(),
      evening: new Map(),
    };

    users.forEach((user) => {
      if (user.GioLichNgay) {
        const timeKey = this.formatTimeForCron(user.GioLichNgay);
        if (!schedulesByTime.morning.has(timeKey)) schedulesByTime.morning.set(timeKey, []);
        schedulesByTime.morning.get(timeKey).push(user);
      }
      if (user.GioNhacNhiemVu) {
        const timeKey = this.formatTimeForCron(user.GioNhacNhiemVu);
        if (!schedulesByTime.afternoon.has(timeKey)) schedulesByTime.afternoon.set(timeKey, []);
        schedulesByTime.afternoon.get(timeKey).push(user);
      }
      if (user.GioTongKetNgay) {
        const timeKey = this.formatTimeForCron(user.GioTongKetNgay);
        if (!schedulesByTime.evening.has(timeKey)) schedulesByTime.evening.set(timeKey, []);
        schedulesByTime.evening.get(timeKey).push(user);
      }
    });

    this.createJobsFromGroups(schedulesByTime);
  }

  /**
   * Tạo cron jobs từ các nhóm đã phân loại
   */
  createJobsFromGroups(schedulesByTime) {
    schedulesByTime.morning.forEach((users, cronTime) => {
      this.createJob(`morning-${cronTime}`, cronTime, async () => {
        await this.sendSchedulesForUsers(users, "morning");
      });
    });

    schedulesByTime.afternoon.forEach((users, cronTime) => {
      this.createJob(`afternoon-${cronTime}`, cronTime, async () => {
        await this.sendRemindersForUsers(users);
      });
    });

    schedulesByTime.evening.forEach((users, cronTime) => {
      this.createJob(`evening-${cronTime}`, cronTime, async () => {
        await this.sendSummariesForUsers(users);
      });
    });
  }

  /**
   * Tạo một cron job mới
   */
  createJob(jobId, cronTime, callback) {
    if (this.jobs.has(jobId)) {
      this.jobs.get(jobId).stop();
    }
    try {
      const job = cron.schedule(cronTime, callback, {
        timezone: "Asia/Ho_Chi_Minh",
        scheduled: true,
      });
      this.jobs.set(jobId, job);
    } catch (error) {
      console.error(`Error creating job ${jobId}:`, error);
    }
  }

  /**
   * Cập nhật lịch trình cho một người dùng cụ thể
   */
  async updateUserSchedule(userId) {
    try {
      const { data: user, error } = await supabase
        .from("TelegramConnections")
        .select("GioNhacNhiemVu, GioLichNgay, GioTongKetNgay, ThongBaoNhiemVu, TrangThaiKetNoi")
        .eq("UserID", userId)
        .single();

      if (error || !user) {
        console.log(`⏭️ User ${userId} not found or not connected`);
        return;
      }

      if (!user.TrangThaiKetNoi || !user.ThongBaoNhiemVu) {
        console.log(`⏭️ User ${userId} has notifications disabled`);
        return;
      }

      this.removeUserJobs(userId);

      if (user.GioLichNgay) {
        this.createJob(`user-${userId}-morning`, this.formatTimeForCron(user.GioLichNgay), async () => {
          console.log(`📅 Sending morning schedule for user ${userId}`);
          await this.sendScheduleToUser(userId, "morning");
        });
      }

      if (user.GioNhacNhiemVu) {
        this.createJob(`user-${userId}-afternoon`, this.formatTimeForCron(user.GioNhacNhiemVu), async () => {
          console.log(`⏰ Sending afternoon reminder for user ${userId}`);
          await this.sendReminderToUser(userId);
        });
      }

      if (user.GioTongKetNgay) {
        this.createJob(`user-${userId}-evening`, this.formatTimeForCron(user.GioTongKetNgay), async () => {
          console.log(`🌆 Sending evening summary for user ${userId}`);
          await this.sendSummaryToUser(userId);
        });
      }

      console.log(`✅ Updated schedule for user ${userId}`);
      return { success: true, message: "Cập nhật lịch trình thành công" };
    } catch (error) {
      console.error(`❌ Error updating schedule for user ${userId}:`, error);
      return { success: false, message: error.message };
    }
  }

  async sendSchedulesForUsers(users, timeOfDay) {
    for (const user of users) {
      try {
        await this.sendScheduleToUser(user.UserID, timeOfDay);
      } catch (error) {
        console.error(` Error for user ${user.UserID}:`, error.message);
      }
    }
  }

  async sendRemindersForUsers(users) {
    for (const user of users) {
      try {
        await this.sendReminderToUser(user.UserID);
      } catch (error) {
        console.error(` Error for user ${user.UserID}:`, error.message);
      }
    }
  }

  async sendSummariesForUsers(users) {
    for (const user of users) {
      try {
        await this.sendSummaryToUser(user.UserID);
      } catch (error) {
        console.error(` Error for user ${user.UserID}:`, error.message);
      }
    }
  }

  /**
   * Gửi lịch trình cho một người dùng cụ thể
   */
  async sendScheduleToUser(userId, timeOfDay = "morning") {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: tasks, error: tasksError } = await supabase
        .from("CongViec")
        .select("TieuDe, MoTa, GioBatDauCoDinh, TrangThai")
        .eq("UserID", userId)
        .gte("GioBatDauCoDinh", startOfDay.toISOString())
        .lte("GioBatDauCoDinh", endOfDay.toISOString())
        .order("GioBatDauCoDinh");

      if (tasksError) throw tasksError;

      if (!tasks || tasks.length === 0) {
        await this.sendNoTasksMessage(userId, timeOfDay);
        return;
      }

      const { data: connection, error: connError } = await supabase
        .from("TelegramConnections")
        .select("TelegramChatId")
        .eq("UserID", userId)
        .eq("TrangThaiKetNoi", true)
        .single();

      if (connError || !connection) {
        console.log(`⏭️ User ${userId} not connected`);
        return;
      }

      const chatId = connection.TelegramChatId;

      let message = `📅 <b>Lịch trình ngày hôm nay</b>\n\n`;
      message += `Hôm nay bạn có <b>${tasks.length}</b> công việc:\n\n`;

      tasks.forEach((task, index) => {
        const startTime = new Date(task.GioBatDauCoDinh).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        let statusEmoji = "⏳";
        if (task.TrangThai === "completed") statusEmoji = "✅";
        if (task.TrangThai === "in_progress") statusEmoji = "🔄";

        message += `${index + 1}. ${statusEmoji} <b>${task.TieuDe}</b>\n`;
        message += `   ⏰ ${startTime}\n`;
        if (task.MoTa) message += `   📝 ${task.MoTa}\n`;
        message += `\n`;
      });

      message += "Chúc bạn một ngày làm việc hiệu quả! 💪";

      await getBotInstance().sendMessage(chatId, message, { parse_mode: "HTML" });
      console.log(`✅ Sent schedule to user ${userId}`);
    } catch (error) {
      console.error(`❌ Error sending schedule to user ${userId}:`, error);
    }
  }

  /**
   * Gửi nhắc nhở cho một người dùng
   */
  async sendReminderToUser(userId) {
    try {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: tasks, error: tasksError } = await supabase
        .from("CongViec")
        .select("TieuDe, GioBatDauCoDinh")
        .eq("UserID", userId)
        .gte("GioBatDauCoDinh", now.toISOString())
        .lte("GioBatDauCoDinh", endOfDay.toISOString())
        .neq("TrangThai", "completed")
        .order("GioBatDauCoDinh");

      if (tasksError) throw tasksError;

      const { data: connection, error: connError } = await supabase
        .from("TelegramConnections")
        .select("TelegramChatId")
        .eq("UserID", userId)
        .eq("TrangThaiKetNoi", true)
        .single();

      if (connError || !connection) return;

      const chatId = connection.TelegramChatId;

      if (!tasks || tasks.length === 0) {
        await getBotInstance().sendMessage(
          chatId,
          "🎉 <b>Nhắc nhở buổi chiều</b>\n\nTất cả công việc hôm nay đã hoàn thành! Xuất sắc! 🎯",
          { parse_mode: "HTML" }
        );
        return;
      }

      let message = "⏰ <b>Nhắc nhở buổi chiều</b>\n\n";
      message += `Bạn còn <b>${tasks.length}</b> công việc cần chú ý:\n\n`;

      tasks.forEach((task, index) => {
        const time = new Date(task.GioBatDauCoDinh).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        message += `${index + 1}. ${task.TieuDe}\n`;
        message += `   ⏱️ ${time}\n`;
      });

      message += "\nHãy cố gắng hoàn thành nhé! 💪";

      await getBotInstance().sendMessage(chatId, message, { parse_mode: "HTML" });
      console.log(`✅ Sent reminder to user ${userId}`);
    } catch (error) {
      console.error(`❌ Error sending reminder to user ${userId}:`, error);
    }
  }

  /**
   * Gửi tổng kết cho một người dùng
   */
  async sendSummaryToUser(userId) {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: tasks, error: tasksError } = await supabase
        .from("CongViec")
        .select("TrangThai")
        .eq("UserID", userId)
        .gte("GioBatDauCoDinh", startOfDay.toISOString())
        .lte("GioBatDauCoDinh", endOfDay.toISOString());

      if (tasksError) throw tasksError;

      const { data: connection, error: connError } = await supabase
        .from("TelegramConnections")
        .select("TelegramChatId")
        .eq("UserID", userId)
        .eq("TrangThaiKetNoi", true)
        .single();

      if (connError || !connection) return;

      const chatId = connection.TelegramChatId;

      if (!tasks || tasks.length === 0) {
        await getBotInstance().sendMessage(
          chatId,
          "📊 <b>Tổng kết ngày hôm nay</b>\n\nHôm nay bạn không có công việc nào. Hãy tận hưởng ngày nghỉ nhé! 😊",
          { parse_mode: "HTML" }
        );
        return;
      }

      const total = tasks.length;
      const completed = tasks.filter((t) => t.TrangThai === "completed").length;
      const inProgress = tasks.filter((t) => t.TrangThai === "in_progress").length;
      const notStarted = tasks.filter((t) => !t.TrangThai || t.TrangThai === "pending").length;

      let message = "🌆 <b>Tổng kết ngày hôm nay</b>\n\n";
      message += `📊 Tổng số: <b>${total}</b> công việc\n`;
      message += `✅ Hoàn thành: <b>${completed}</b>\n`;
      message += `🔄 Đang làm: <b>${inProgress}</b>\n`;
      message += `⏳ Chưa làm: <b>${notStarted}</b>\n\n`;

      if (completed > 0) {
        const percentage = Math.round((completed / total) * 100);
        message += `🎯 Tỷ lệ hoàn thành: <b>${percentage}%</b>\n\n`;
        if (percentage >= 80) {
          message += "🌟 Xuất sắc! Bạn đã có một ngày làm việc hiệu quả!";
        } else if (percentage >= 50) {
          message += "👍 Tốt lắm! Tiếp tục phát huy nhé!";
        } else {
          message += "💪 Ngày mai sẽ tốt hơn! Cố gắng lên!";
        }
      } else {
        message += "📌 Bạn chưa hoàn thành công việc nào. Hãy bắt đầu từ sớm vào ngày mai nhé!";
      }

      await getBotInstance().sendMessage(chatId, message, { parse_mode: "HTML" });
      console.log(`✅ Sent summary to user ${userId}`);
    } catch (error) {
      console.error(`❌ Error sending summary to user ${userId}:`, error);
    }
  }

  /**
   * Gửi thông báo không có công việc
   */
  async sendNoTasksMessage(userId, timeOfDay) {
    try {
      const { data: connection, error } = await supabase
        .from("TelegramConnections")
        .select("TelegramChatId")
        .eq("UserID", userId)
        .eq("TrangThaiKetNoi", true)
        .single();

      if (error || !connection) return;

      const chatId = connection.TelegramChatId;
      let message = "";

      if (timeOfDay === "morning") {
        message = "📅 <b>Lịch trình ngày hôm nay</b>\n\nHôm nay bạn không có công việc nào. Hãy tận hưởng một ngày thoải mái! 😊";
      } else if (timeOfDay === "afternoon") {
        message = "⏰ <b>Nhắc nhở buổi chiều</b>\n\nKhông còn công việc nào cần nhắc nhở. Tuyệt vời! 🎉";
      }

      if (message) {
        await getBotInstance().sendMessage(chatId, message, { parse_mode: "HTML" });
      }
    } catch (error) {
      console.error(`❌ Error sending no tasks message:`, error);
    }
  }

  removeUserJobs(userId) {
    [`user-${userId}-morning`, `user-${userId}-afternoon`, `user-${userId}-evening`].forEach((jobId) => {
      if (this.jobs.has(jobId)) {
        this.jobs.get(jobId).stop();
        this.jobs.delete(jobId);
      }
    });
  }

  stopAllJobs() {
    this.jobs.forEach((job) => job.stop());
    this.jobs.clear();
  }

  /**
   * Format thời gian từ database thành cron expression
   */
  formatTimeForCron(timeValue) {
    if (!timeValue) return "0 8 * * *";

    let hours, minutes;

    if (typeof timeValue === "string") {
      const [h, m] = timeValue.split(":");
      hours = parseInt(h);
      minutes = parseInt(m);
    } else if (timeValue instanceof Date) {
      hours = timeValue.getHours();
      minutes = timeValue.getMinutes();
    } else {
      hours = 8;
      minutes = 0;
    }

    return `${minutes} ${hours} * * *`;
  }

  getCurrentSchedules() {
    const schedules = [];
    this.jobs.forEach((job, jobId) => {
      schedules.push({
        jobId,
        isRunning: job.running || false,
        nextDate: job.nextDate ? job.nextDate() : null,
      });
    });
    return schedules;
  }
}

const scheduleUpdater = new ScheduleUpdater();
module.exports = scheduleUpdater;
