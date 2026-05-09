// Monthly salary digest — runs daily at 09:00 VN time.
// For each opted-in user whose NgayNhanLuong == today's day-of-month,
// compute the 1-month window ending today (e.g. 15/4 => 15/3..15/4),
// aggregate hourly pay per task, send a per-job breakdown.
//
// Kept intentionally simple: only handles hourly pay (LuongTheoGio * hours).
// Monthly-fixed salaries and shift-bonus logic live in routes/salary.js and
// aren't duplicated here — they need the shift-matcher runtime that's only
// meaningful for a full report in the web UI.

module.exports = {
  kind: "salary",
  cronExpr: "0 9 * * *", // daily 09:00

  async run({ supabase, getBot, logSent, alreadySent }) {
    const today = new Date();
    const dom = today.getDate();

    const { data: users } = await supabase
      .from("TelegramConnections")
      .select("UserID, TrangThaiKetNoi, ThongBaoLuong, NgayNhanLuong")
      .eq("TrangThaiKetNoi", true)
      .eq("ThongBaoLuong", true)
      .eq("NgayNhanLuong", dom);

    if (!users?.length) return;

    // Window: [dom of previous month .. today 23:59]
    const endAt = new Date(today);
    endAt.setHours(23, 59, 59, 999);
    const startAt = new Date(today);
    startAt.setMonth(startAt.getMonth() - 1);
    startAt.setHours(0, 0, 0, 0);

    const bot = getBot();

    for (const u of users) {
      if (await alreadySent(u.UserID, 0, "salary", 20 * 60)) continue;

      const { data: done } = await supabase
        .from("LichTrinh")
        .select("MaCongViec, GioBatDau, GioKetThuc")
        .eq("UserID", u.UserID)
        .eq("DaHoanThanh", true)
        .gte("GioKetThuc", startAt.toISOString())
        .lte("GioKetThuc", endAt.toISOString())
        .not("MaCongViec", "is", null);

      if (!done?.length) {
        await safeSend(bot, u.UserID, noEarningsMsg(startAt, endAt));
        await logSent(u.UserID, 0, "salary");
        continue;
      }

      const taskIds = [...new Set(done.map((r) => r.MaCongViec))];
      const { data: tasks } = await supabase
        .from("CongViec")
        .select("MaCongViec, TieuDe, LuongTheoGio")
        .in("MaCongViec", taskIds)
        .eq("UserID", u.UserID);

      const taskMap = new Map((tasks || []).map((t) => [t.MaCongViec, t]));

      const perJob = new Map(); // taskId -> { title, hours, pay }
      for (const r of done) {
        const t = taskMap.get(r.MaCongViec);
        if (!t || !t.LuongTheoGio) continue;
        const hrs = hoursBetween(r.GioBatDau, r.GioKetThuc);
        const cur = perJob.get(t.MaCongViec) || { title: t.TieuDe || "Công việc", hours: 0, pay: 0 };
        cur.hours += hrs;
        cur.pay += hrs * Number(t.LuongTheoGio || 0);
        perJob.set(t.MaCongViec, cur);
      }

      if (perJob.size === 0) {
        await safeSend(bot, u.UserID, noEarningsMsg(startAt, endAt));
        await logSent(u.UserID, 0, "salary");
        continue;
      }

      const lines = [];
      let total = 0;
      for (const job of perJob.values()) {
        lines.push(`• <b>${job.title}</b> — ${job.hours.toFixed(1)}h → ${fmtVND(job.pay)}`);
        total += job.pay;
      }

      const msg =
        `💰 <b>Bảng lương tháng</b>\n` +
        `${fmtDate(startAt)} → ${fmtDate(endAt)}\n\n` +
        lines.join("\n") +
        `\n\n<b>Tổng: ${fmtVND(total)}</b>`;

      await safeSend(bot, u.UserID, msg);
      await logSent(u.UserID, 0, "salary");
    }
  },
};

// ----- helpers ------------------------------------------------------------

function hoursBetween(startIso, endIso) {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return (e - s) / 3600000;
}

function fmtVND(n) {
  return Math.round(Number(n) || 0).toLocaleString("vi-VN") + " ₫";
}

function fmtDate(d) {
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function noEarningsMsg(startAt, endAt) {
  return (
    `💰 <b>Bảng lương tháng</b>\n` +
    `${fmtDate(startAt)} → ${fmtDate(endAt)}\n\n` +
    `Không có công việc có lương hoàn thành trong kỳ này.`
  );
}

async function safeSend(bot, userId, msg) {
  try {
    await bot.sendMessageToUser(userId, msg);
  } catch (err) {
    console.error(`[salary] send failed user ${userId}:`, err.message);
  }
}
