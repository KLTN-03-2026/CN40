// Reminder engine — orchestrates the 4 non-core notification types:
// 15-min-before, weekly stats, monthly salary, weekend AI suggestions.
// Each kind lives in its own module under ./reminders/ and exports:
//   { cronExpr, run(ctx) }
// This file just schedules them and provides the shared ctx.
//
// Cron semantics are all Asia/Ho_Chi_Minh. Every run is idempotent per day
// via TelegramReminderLog (see migration 008).

const cron = require("node-cron");
const { supabase } = require("../config/database");

const TZ = "Asia/Ho_Chi_Minh";

// Lazy bot ref to avoid circular deps with telegram/bot.js.
function getBot() {
  return require("./bot");
}

const reminders = [
  require("./reminders/fifteen-min-before"),
  require("./reminders/weekly-stats"),
  require("./reminders/monthly-salary"),
  require("./reminders/weekend-ai-suggest"),
];

const jobs = new Map();

async function logSent(userId, taskId, kind) {
  try {
    await supabase.from("TelegramReminderLog").insert({
      UserID: userId,
      TaskID: taskId ?? 0,
      Kind: kind,
      SentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[reminder/${kind}] log insert failed:`, err.message);
  }
}

async function alreadySent(userId, taskId, kind, sinceMinutes = 60) {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("TelegramReminderLog")
    .select("Id")
    .eq("UserID", userId)
    .eq("TaskID", taskId ?? 0)
    .eq("Kind", kind)
    .gte("SentAt", since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

function start() {
  if (jobs.size > 0) return; // already started

  const ctx = { supabase, getBot, logSent, alreadySent, tz: TZ };

  for (const r of reminders) {
    if (!r?.cronExpr || typeof r.run !== "function") continue;
    try {
      const job = cron.schedule(
        r.cronExpr,
        async () => {
          try {
            await r.run(ctx);
          } catch (err) {
            console.error(`[reminder/${r.kind || "?"}] run failed:`, err.message);
          }
        },
        { timezone: TZ, scheduled: true }
      );
      jobs.set(r.kind, job);
      console.log(`[reminder] scheduled ${r.kind} @ ${r.cronExpr}`);
    } catch (err) {
      console.error(`[reminder] failed to schedule ${r.kind}:`, err.message);
    }
  }
}

function stop() {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}

module.exports = { start, stop };
