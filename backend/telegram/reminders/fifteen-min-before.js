// Pre-event reminder.
// Runs every minute; for each connected user with ThongBao15Phut on,
// finds LichTrinh rows starting in (PhutNhacTruoc ± 1) minutes,
// sends a nudge, logs to prevent duplicates.
//
// Kind stays "15min" for back-compat with TelegramReminderLog rows.

module.exports = {
  kind: "15min",
  cronExpr: "* * * * *", // every minute

  async run({ supabase, getBot, logSent, alreadySent }) {
    const now = Date.now();

    // 1) Pull all opt-in users + their custom minutes.
    const { data: prefs, error: prefErr } = await supabase
      .from("TelegramConnections")
      .select("UserID, TelegramChatId, TrangThaiKetNoi, ThongBao15Phut, PhutNhacTruoc")
      .eq("TrangThaiKetNoi", true)
      .eq("ThongBao15Phut", true);

    if (prefErr) {
      console.error("[15min] prefs query failed:", prefErr.message);
      return;
    }
    if (!prefs?.length) return;

    const prefMap = new Map(prefs.map((p) => [p.UserID, p]));
    const minutesList = prefs.map((p) => Number(p.PhutNhacTruoc) || 15);
    const minM = Math.min(...minutesList);
    const maxM = Math.max(...minutesList);

    // 2) Query a single window covering the union of user offsets (±1 min slack).
    const windowStart = new Date(now + (minM - 1) * 60 * 1000).toISOString();
    const windowEnd   = new Date(now + (maxM + 1) * 60 * 1000).toISOString();

    const { data: events, error } = await supabase
      .from("LichTrinh")
      .select("MaLichTrinh, UserID, MaCongViec, TieuDe, GioBatDau, GioKetThuc, DaHoanThanh")
      .in("UserID", prefs.map((p) => p.UserID))
      .gte("GioBatDau", windowStart)
      .lte("GioBatDau", windowEnd)
      .eq("DaHoanThanh", false);

    if (error) {
      console.error("[15min] events query failed:", error.message);
      return;
    }
    if (!events?.length) return;

    const bot = getBot();

    for (const ev of events) {
      const p = prefMap.get(ev.UserID);
      if (!p) continue;

      // 3) Match per-user offset: only fire when (start - now) ≈ user's M.
      const M = Number(p.PhutNhacTruoc) || 15;
      const diffMin = (new Date(ev.GioBatDau).getTime() - now) / 60000;
      if (diffMin < M - 1 || diffMin > M + 1) continue;

      // Dedup against multi-tick overlap.
      if (await alreadySent(ev.UserID, ev.MaLichTrinh, "15min", 60)) continue;

      const start = new Date(ev.GioBatDau);
      const hhmm = start.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh",
      });

      const msg =
        `⏰ <b>Sắp đến lịch</b>\n\n` +
        `<b>${ev.TieuDe || "Công việc"}</b>\n` +
        `Bắt đầu lúc <b>${hhmm}</b> (còn ~${M} phút)\n\n` +
        `Dùng /daily để xem và đánh dấu hoàn thành.`;

      try {
        await bot.sendMessageToUser(ev.UserID, msg);
        await logSent(ev.UserID, ev.MaLichTrinh, "15min");
      } catch (err) {
        console.error(`[15min] send failed user ${ev.UserID}:`, err.message);
      }
    }
  },
};
