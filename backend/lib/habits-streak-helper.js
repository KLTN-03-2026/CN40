/**
 * habits-streak-helper.js
 * Calculates the current streak for a habit by counting consecutive
 * completed days backwards from today.
 */
const { supabase } = require("../config/database");

/**
 * Recalculate streak for a habit starting from today going backwards.
 * @param {number} habitId
 * @returns {Promise<number>} streak count
 */
async function recalculateStreak(habitId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: logs, error } = await supabase
    .from("HabitLogs")
    .select("NgayHoanThanh")
    .eq("HabitID", habitId)
    .eq("DaHoanThanh", true)
    .order("NgayHoanThanh", { ascending: false })
    .limit(366);

  if (error || !logs || logs.length === 0) return 0;

  const logSet = new Set(logs.map((l) => l.NgayHoanThanh));
  const todayStr = today.toISOString().split("T")[0];

  let streak = 0;
  const cursor = new Date(today);

  // If today not completed, start counting from yesterday
  if (!logSet.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const dateStr = cursor.toISOString().split("T")[0];
    if (logSet.has(dateStr)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

module.exports = { recalculateStreak };
