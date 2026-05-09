// gamification.js — routes for XP/level/badge/leaderboard endpoints
const express = require("express");
const router = express.Router();
const {
  getOrCreateProfile,
  getLeaderboard,
  refreshProfile,
  formatProfileResponse,
} = require("../services/gamification-service");

// GET /api/gamification/profile — return cached profile, auto-refresh if stale (>1h)
router.get("/profile", async (req, res) => {
  try {
    const data = await getOrCreateProfile(req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("GET /gamification/profile error:", err.message);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// GET /api/gamification/leaderboard — friends + self ranked by XP
router.get("/leaderboard", async (req, res) => {
  try {
    const data = await getLeaderboard(req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("GET /gamification/leaderboard error:", err.message);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// POST /api/gamification/refresh — force full recalculation (rate-limited to once/min)
router.post("/refresh", async (req, res) => {
  try {
    const { supabase } = require("../config/database");

    const { data: existing } = await supabase
      .from("UserGamification")
      .select("LastXPUpdate")
      .eq("UserID", req.userId)
      .single();

    if (existing?.LastXPUpdate) {
      const elapsedMs = Date.now() - new Date(existing.LastXPUpdate).getTime();
      if (elapsedMs < 60 * 1000) {
        return res.status(429).json({
          success: false,
          message: "Vui lòng chờ ít nhất 1 phút trước khi làm mới lại",
        });
      }
    }

    const rawProfile = await refreshProfile(req.userId);
    const data = await formatProfileResponse(rawProfile, req.userId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error("POST /gamification/refresh error:", err.message);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

// PUT /api/gamification/equip-badge — equip or unequip a badge
router.put("/equip-badge", async (req, res) => {
  try {
    const { supabase } = require("../config/database");
    const { badgeId } = req.body; // null to unequip

    if (badgeId) {
      // Verify user actually earned this badge
      const { data: gam } = await supabase
        .from("UserGamification")
        .select("Badges")
        .eq("UserID", req.userId)
        .single();

      const earned = (gam?.Badges || []).map((b) => b.id);
      if (!earned.includes(badgeId)) {
        return res.status(400).json({
          success: false,
          message: "Bạn chưa đạt được huy hiệu này",
        });
      }
    }

    const { error } = await supabase
      .from("Users")
      .update({ EquippedBadge: badgeId || null })
      .eq("UserID", req.userId);

    if (error) throw error;

    return res.json({ success: true, data: { equippedBadge: badgeId || null } });
  } catch (err) {
    console.error("PUT /gamification/equip-badge error:", err.message);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
