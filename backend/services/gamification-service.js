// gamification-service.js — XP, level, streak, badge logic for UserGamification table
const { supabase } = require("../config/database");

const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 800, 1200, 1700, 2300, 3000, 3800,
  4700, 5700, 6800, 8000, 9500, 11000, 13000, 15000, 17500, 20000,
];

const BADGES = [
  { id: "first_task", name: "Tân binh", desc: "Hoàn thành task đầu tiên", icon: "fa-star" },
  { id: "tasks_10", name: "Chiến binh", desc: "Hoàn thành 10 task", icon: "fa-shield-alt" },
  { id: "tasks_50", name: "Chuyên gia", desc: "Hoàn thành 50 task", icon: "fa-award" },
  { id: "tasks_100", name: "Pro", desc: "Hoàn thành 100 task", icon: "fa-trophy" },
  { id: "tasks_500", name: "VIP Huyền thoại", desc: "Hoàn thành 500 task", icon: "fa-crown" },
  { id: "streak_3", name: "Lửa nhỏ", desc: "Duy trì 3 ngày liên tiếp", icon: "fa-fire" },
  { id: "streak_7", name: "Bền bỉ", desc: "Duy trì 7 ngày liên tiếp", icon: "fa-fire-alt" },
  { id: "streak_14", name: "Kỷ luật thép", desc: "Duy trì 14 ngày liên tiếp", icon: "fa-bolt" },
  { id: "streak_30", name: "Siêu nhân", desc: "Duy trì 30 ngày liên tục", icon: "fa-meteor" },
  { id: "priority_king", name: "Vua ưu tiên", desc: "Hoàn thành 20 task ưu tiên cao", icon: "fa-chess-king" },
  { id: "early_bird", name: "Early Bird", desc: "5 task xong trước 8 giờ sáng", icon: "fa-sun" },
  { id: "level_5", name: "Tay mơ", desc: "Đạt cấp 5", icon: "fa-angle-double-up" },
  { id: "level_10", name: "Pro Player", desc: "Đạt cấp 10", icon: "fa-gem" },
  { id: "level_15", name: "Cao thủ", desc: "Đạt cấp 15", icon: "fa-dragon" },
  { id: "level_20", name: "Grand Master", desc: "Đạt cấp tối đa", icon: "fa-infinity" },
];

function getLevelFromXP(xp) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

// Unified streak: consecutive days with ≥1 completed action from ANY source
// Sources: LichTrinh (schedule), CongViec (tasks), HabitLogs (habits)
async function computeStreak(userId) {
  const daysWithActivity = new Set();

  // Source 1: LichTrinh completed events
  const { data: schedRecs } = await supabase
    .from("LichTrinh")
    .select("GioBatDau")
    .eq("UserID", userId)
    .eq("DaHoanThanh", true);
  (schedRecs || []).forEach((r) => {
    const d = r.GioBatDau?.split("T")[0];
    if (d) daysWithActivity.add(d);
  });

  // Source 2: CongViec completed (using UpdatedAt as completion date)
  const { data: taskRecs } = await supabase
    .from("CongViec")
    .select("UpdatedAt")
    .eq("UserID", userId)
    .eq("TrangThaiThucHien", 2);
  (taskRecs || []).forEach((r) => {
    const d = r.UpdatedAt?.split("T")[0];
    if (d) daysWithActivity.add(d);
  });

  // Source 3: HabitLogs completed
  const { data: habitIds } = await supabase
    .from("Habits")
    .select("HabitID")
    .eq("UserID", userId)
    .eq("DangHoatDong", true);
  if (habitIds?.length > 0) {
    const { data: habitLogs } = await supabase
      .from("HabitLogs")
      .select("NgayHoanThanh")
      .in("HabitID", habitIds.map((h) => h.HabitID))
      .eq("DaHoanThanh", true);
    (habitLogs || []).forEach((l) => {
      if (l.NgayHoanThanh) daysWithActivity.add(l.NgayHoanThanh);
    });
  }

  if (daysWithActivity.size === 0) return 0;

  // Count consecutive days backwards from today (or yesterday if today not yet done)
  const todayStr = new Date().toISOString().split("T")[0];
  let streak = 0;
  const startOffset = daysWithActivity.has(todayStr) ? 0 : 1;

  for (let i = startOffset; ; i++) {
    const expected = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    if (daysWithActivity.has(expected)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

async function calculateXP(userId) {
  const { data: tasks, error: taskErr } = await supabase
    .from("CongViec")
    .select("MucDoUuTien")
    .eq("UserID", userId)
    .eq("TrangThaiThucHien", 2);

  if (taskErr) throw new Error("Failed to fetch tasks: " + taskErr.message);

  const completedTasks = tasks?.length || 0;
  const priority4Done = tasks?.filter((t) => t.MucDoUuTien === 4).length || 0;
  const priority3Done = tasks?.filter((t) => t.MucDoUuTien === 3).length || 0;

  // Early tasks: LichTrinh completed before 08:00 local hour
  const { data: scheduleRecords } = await supabase
    .from("LichTrinh")
    .select("GioBatDau")
    .eq("UserID", userId)
    .eq("DaHoanThanh", true);

  const earlyTasks = (scheduleRecords || []).filter((r) => {
    if (!r.GioBatDau) return false;
    const hour = new Date(r.GioBatDau).getHours();
    return hour < 8;
  }).length;

  let baseXP = completedTasks * 10 + priority4Done * 5 + priority3Done * 3;

  const streak = await computeStreak(userId);

  // Streak multiplier applied to recent-days XP portion
  if (streak >= 30) {
    // Compute XP earned in last 30 days separately and apply 2x to that portion
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: recent30 } = await supabase
      .from("CongViec")
      .select("MucDoUuTien")
      .eq("UserID", userId)
      .eq("TrangThaiThucHien", 2)
      .gte("UpdatedAt", cutoff30);

    if (recent30 && recent30.length > 0) {
      const r30xp =
        recent30.length * 10 +
        recent30.filter((t) => t.MucDoUuTien === 4).length * 5 +
        recent30.filter((t) => t.MucDoUuTien === 3).length * 3;
      // Replace that portion with 2x version (add extra r30xp on top)
      baseXP += r30xp;
    }
  } else if (streak >= 7) {
    const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recent7 } = await supabase
      .from("CongViec")
      .select("MucDoUuTien")
      .eq("UserID", userId)
      .eq("TrangThaiThucHien", 2)
      .gte("UpdatedAt", cutoff7);

    if (recent7 && recent7.length > 0) {
      const r7xp =
        recent7.length * 10 +
        recent7.filter((t) => t.MucDoUuTien === 4).length * 5 +
        recent7.filter((t) => t.MucDoUuTien === 3).length * 3;
      baseXP += Math.floor(r7xp * 0.5); // 1.5x = base + 0.5 extra
    }
  }

  return { xp: baseXP, streak, completedTasks, priority4Done, priority3Done, earlyTasks };
}

async function computeStreakStats(userId) {
  const countStreak = (dates) => {
    if (!dates.size) return { current: 0, longest: 0 };
    const todayStr = new Date().toISOString().split("T")[0];
    const startOff = dates.has(todayStr) ? 0 : 1;
    let current = 0;
    for (let i = startOff; ; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
      if (dates.has(d)) current++; else break;
    }
    const sorted = [...dates].sort();
    let longest = 0, run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]).getTime();
      const cur = new Date(sorted[i]).getTime();
      if (cur - prev === 86400000) { run++; if (run > longest) longest = run; }
      else { run = 1; }
    }
    if (sorted.length === 1 || run > longest) longest = Math.max(longest, run);
    return { current, longest };
  };

  // Per-source dates
  const schedDays = new Set();
  const { data: sr } = await supabase.from("LichTrinh").select("GioBatDau").eq("UserID", userId).eq("DaHoanThanh", true);
  (sr || []).forEach((r) => { const d = r.GioBatDau?.split("T")[0]; if (d) schedDays.add(d); });

  const taskDays = new Set();
  const { data: tr } = await supabase.from("CongViec").select("UpdatedAt").eq("UserID", userId).eq("TrangThaiThucHien", 2);
  (tr || []).forEach((r) => { const d = r.UpdatedAt?.split("T")[0]; if (d) taskDays.add(d); });

  const habitDays = new Set();
  const { data: hids } = await supabase.from("Habits").select("HabitID").eq("UserID", userId).eq("DangHoatDong", true);
  if (hids?.length) {
    const { data: hl } = await supabase.from("HabitLogs").select("NgayHoanThanh").in("HabitID", hids.map((h) => h.HabitID)).eq("DaHoanThanh", true);
    (hl || []).forEach((l) => { if (l.NgayHoanThanh) habitDays.add(l.NgayHoanThanh); });
  }

  const allDays = new Set([...schedDays, ...taskDays, ...habitDays]);
  const total = countStreak(allDays);
  return {
    current: total.current,
    longest: total.longest,
    schedule: countStreak(schedDays),
    tasks: countStreak(taskDays),
    habits: countStreak(habitDays),
  };
}

async function formatProfileResponse(row, userId) {
  const { data: user } = await supabase
    .from("Users")
    .select("HoTen, AvatarUrl, EquippedBadge")
    .eq("UserID", userId)
    .single();

  const level = row.Level || 1;
  const xp = row.XP || 0;
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] || 0;
  const nextThreshold = isMaxLevel
    ? currentThreshold
    : LEVEL_THRESHOLDS[level] || currentThreshold;
  const range = nextThreshold - currentThreshold;
  const progress = isMaxLevel ? 1 : range > 0 ? (xp - currentThreshold) / range : 1;

  const streakStats = await computeStreakStats(userId);

  return {
    level,
    xp,
    nextLevelXP: nextThreshold,
    progress: Math.min(Math.max(progress, 0), 1),
    streak: row.Streak || 0,
    streakStats,
    badges: row.Badges || [],
    availableBadges: BADGES,
    name: user?.HoTen || "",
    avatar: user?.AvatarUrl || null,
    equippedBadge: user?.EquippedBadge || null,
  };
}

async function getOrCreateProfile(userId) {
  const { data: existing, error } = await supabase
    .from("UserGamification")
    .select("*")
    .eq("UserID", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error("Failed to fetch gamification profile: " + error.message);
  }

  let profile;
  if (!existing) {
    profile = await refreshProfile(userId);
  } else {
    const lastUpdate = new Date(existing.LastXPUpdate);
    const staleThresholdMs = 60 * 60 * 1000;
    if (Date.now() - lastUpdate.getTime() > staleThresholdMs) {
      profile = await refreshProfile(userId);
    } else {
      profile = existing;
    }
  }

  return formatProfileResponse(profile, userId);
}

async function evaluateBadges(userId, stats) {
  const { data: row } = await supabase
    .from("UserGamification")
    .select("Badges")
    .eq("UserID", userId)
    .single();

  const currentBadges = row?.Badges || [];
  const earnedIds = new Set(currentBadges.map((b) => b.id));
  const level = getLevelFromXP(stats.xp);

  const conditions = {
    first_task: stats.completedTasks >= 1,
    tasks_10: stats.completedTasks >= 10,
    tasks_50: stats.completedTasks >= 50,
    tasks_100: stats.completedTasks >= 100,
    tasks_500: stats.completedTasks >= 500,
    streak_3: stats.streak >= 3,
    streak_7: stats.streak >= 7,
    streak_14: stats.streak >= 14,
    streak_30: stats.streak >= 30,
    priority_king: stats.priority4Done >= 20,
    early_bird: stats.earlyTasks >= 5,
    level_5: level >= 5,
    level_10: level >= 10,
    level_15: level >= 15,
    level_20: level >= 20,
  };

  const newBadges = [];
  const earnedAt = new Date().toISOString();

  for (const badge of BADGES) {
    if (!earnedIds.has(badge.id) && conditions[badge.id]) {
      newBadges.push({ ...badge, earnedAt });
    }
  }

  const updatedBadges = [...currentBadges, ...newBadges];
  return { currentBadges: updatedBadges, newBadges };
}

async function getLeaderboard(userId) {
  const { data: friendships, error: fErr } = await supabase
    .from("Friends")
    .select("RequesterID, ReceiverID")
    .or(`RequesterID.eq.${userId},ReceiverID.eq.${userId}`)
    .eq("TrangThai", "accepted");

  if (fErr) throw new Error("Failed to fetch friends: " + fErr.message);

  const friendIds = (friendships || []).map((f) =>
    f.RequesterID === userId ? f.ReceiverID : f.RequesterID
  );
  const allIds = [...new Set([userId, ...friendIds])];

  const { data: users, error: uErr } = await supabase
    .from("Users")
    .select("UserID, HoTen, AvatarUrl, EquippedBadge")
    .in("UserID", allIds);

  if (uErr) throw new Error("Failed to fetch user data: " + uErr.message);

  const { data: gamRows } = await supabase
    .from("UserGamification")
    .select("UserID, XP, Level, Streak, Badges")
    .in("UserID", allIds);

  const gamMap = Object.fromEntries(
    (gamRows || []).map((g) => [g.UserID, g])
  );

  // Include ALL friends+self; use defaults for users without gamification rows
  const ranked = (users || [])
    .map((u) => {
      const g = gamMap[u.UserID];
      return {
        userId: u.UserID,
        name: u.HoTen || "Ẩn danh",
        avatar: u.AvatarUrl || null,
        equippedBadge: u.EquippedBadge || null,
        level: g?.Level || 1,
        xp: g?.XP || 0,
        streak: g?.Streak || 0,
      };
    })
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  return ranked;
}

async function refreshProfile(userId) {
  const stats = await calculateXP(userId);
  const level = getLevelFromXP(stats.xp);
  const { currentBadges } = await evaluateBadges(userId, stats);

  const row = {
    UserID: userId,
    XP: stats.xp,
    Level: level,
    Streak: stats.streak,
    Badges: currentBadges,
    LastXPUpdate: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("UserGamification")
    .upsert(row, { onConflict: "UserID" })
    .select()
    .single();

  if (error) throw new Error("Failed to save gamification profile: " + error.message);

  return data;
}

module.exports = {
  BADGES,
  LEVEL_THRESHOLDS,
  getLevelFromXP,
  computeStreak,
  getOrCreateProfile,
  calculateXP,
  evaluateBadges,
  getLeaderboard,
  refreshProfile,
  formatProfileResponse,
};
