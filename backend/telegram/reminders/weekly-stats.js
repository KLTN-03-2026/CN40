// Weekly stats digest — runs Sunday 20:00 VN time.
// Aggregates completed vs missed events in the last 7 days and sends a
// compact summary. Runs once per user per Sunday (dedup'd by day).

module.exports = {
  kind: "weekly",
  cronExpr: "0 20 * * 0", // Sunday 20:00

  async run({ supabase, getBot, logSent, alreadySent }) {
    const { data: users } = await supabase
      .from("TelegramConnections")
      .select("UserID, TrangThaiKetNoi, ThongBaoTuan")
      .eq("TrangThaiKetNoi", true)
      .eq("ThongBaoTuan", true);

    if (!users?.length) return;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const bot = getBot();

    for (const u of users) {
      // Ensure only one weekly digest per 24h (cron safety net).
      if (await alreadySent(u.UserID, 0, "weekly", 24 * 60)) continue;

      const { data: rows } = await supabase
        .from("LichTrinh")
        .select("MaLichTrinh, DaHoanThanh, GioBatDau, GioKetThuc, TieuDe")
        .eq("UserID", u.UserID)
        .gte("GioBatDau", sevenDaysAgo.toISOString())
        .lte("GioBatDau", now.toISOString());

      const all = rows || [];
      const done = all.filter((r) => r.DaHoanThanh === true);
      const missed = all.filter(
        (r) => !r.DaHoanThanh && new Date(r.GioKetThuc || r.GioBatDau) < now
      );

      // Hours completed
      const hours = done.reduce((sum, r) => {
        const s = new Date(r.GioBatDau).getTime();
        const e = new Date(r.GioKetThuc || r.GioBatDau).getTime();
        return sum + Math.max(0, (e - s) / 3600000);
      }, 0);

      const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;

      const msg =
        `📊 <b>Thống kê tuần qua</b>\n\n` +
        `• Tổng công việc: <b>${all.length}</b>\n` +
        `• Hoàn thành: <b>${done.length}</b> (${pct}%)\n` +
        `• Bỏ lỡ: <b>${missed.length}</b>\n` +
        `• Thời gian đã làm: <b>${hours.toFixed(1)} giờ</b>\n\n` +
        (pct >= 80
          ? "🎉 Tuần năng suất cực đỉnh!"
          : pct >= 50
          ? "💪 Giữ phong độ nha."
          : "🌱 Tuần tới cố thêm chút nữa nhé.");

      try {
        await bot.sendMessageToUser(u.UserID, msg);
        await logSent(u.UserID, 0, "weekly");
      } catch (err) {
        console.error(`[weekly] send failed user ${u.UserID}:`, err.message);
      }
    }
  },
};
