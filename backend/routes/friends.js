// friends.js — Express router for friend system
// Endpoints: request, list, pending, accept, reject, unfriend, search
const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

const MAX_FRIENDS = 50;

// POST /api/friends/request — send friend request
router.post("/request", async (req, res) => {
  try {
    const requesterId = req.userId;
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, message: "Email không hợp lệ" });
    }

    const { data: target, error: userErr } = await supabase
      .from("Users")
      .select("UserID")
      .eq("Email", email.trim().toLowerCase())
      .single();

    if (userErr || !target) {
      return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
    }
    if (target.UserID === requesterId) {
      return res.status(400).json({ success: false, message: "Không thể kết bạn với chính mình" });
    }

    // Check existing friendship in either direction
    const { data: existing } = await supabase
      .from("Friends")
      .select("FriendshipID, TrangThai, RequesterID")
      .or(`and(RequesterID.eq.${requesterId},ReceiverID.eq.${target.UserID}),and(RequesterID.eq.${target.UserID},ReceiverID.eq.${requesterId})`);

    if (existing && existing.length > 0) {
      const f = existing[0];
      if (f.TrangThai === "accepted") {
        return res.status(400).json({ success: false, message: "Đã là bạn bè" });
      }
      if (f.TrangThai === "pending") {
        return res.status(400).json({ success: false, message: "Lời mời đã được gửi trước đó" });
      }
      // rejected — allow re-request by updating
      await supabase.from("Friends").update({ TrangThai: "pending", RequesterID: requesterId, ReceiverID: target.UserID, NgayCapNhat: new Date().toISOString() }).eq("FriendshipID", f.FriendshipID);
      return res.json({ success: true, message: "Đã gửi lời mời kết bạn" });
    }

    // Check limit
    const { count } = await supabase
      .from("Friends")
      .select("FriendshipID", { count: "exact", head: true })
      .eq("TrangThai", "accepted")
      .or(`RequesterID.eq.${requesterId},ReceiverID.eq.${requesterId}`);

    if (count >= MAX_FRIENDS) {
      return res.status(400).json({ success: false, message: `Tối đa ${MAX_FRIENDS} bạn bè` });
    }

    const { error: insertErr } = await supabase.from("Friends").insert({
      RequesterID: requesterId,
      ReceiverID: target.UserID,
      TrangThai: "pending",
    });

    if (insertErr) throw insertErr;
    return res.json({ success: true, message: "Đã gửi lời mời kết bạn" });
  } catch (err) {
    console.error("[friends] request error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/friends — list accepted friends
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    const { data, error } = await supabase
      .from("Friends")
      .select(`FriendshipID, RequesterID, ReceiverID, NgayTao,
        Requester:Users!Friends_RequesterID_fkey(UserID, HoTen, Email, AvatarUrl, EquippedBadge),
        Receiver:Users!Friends_ReceiverID_fkey(UserID, HoTen, Email, AvatarUrl, EquippedBadge)`)
      .eq("TrangThai", "accepted")
      .or(`RequesterID.eq.${userId},ReceiverID.eq.${userId}`)
      .order("NgayTao", { ascending: false });

    if (error) throw error;

    const friends = (data || []).map((f) => {
      const friend = f.RequesterID === userId ? f.Receiver : f.Requester;
      return {
        FriendshipID: f.FriendshipID,
        UserID: friend.UserID,
        HoTen: friend.HoTen,
        Email: friend.Email,
        AvatarUrl: friend.AvatarUrl,
        EquippedBadge: friend.EquippedBadge || null,
        NgayTao: f.NgayTao,
      };
    });

    // Enrich with gamification data (streak, level)
    const friendIds = friends.map((f) => f.UserID);
    if (friendIds.length > 0) {
      const { data: gamRows } = await supabase
        .from("UserGamification")
        .select("UserID, Level, XP, Streak")
        .in("UserID", friendIds);
      const gamMap = Object.fromEntries((gamRows || []).map((g) => [g.UserID, g]));
      friends.forEach((f) => {
        const g = gamMap[f.UserID];
        f.Level = g?.Level || 1;
        f.XP = g?.XP || 0;
        f.Streak = g?.Streak || 0;
      });
    }

    return res.json({ success: true, data: friends });
  } catch (err) {
    console.error("[friends] list error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/friends/requests — pending requests received
router.get("/requests", async (req, res) => {
  try {
    const userId = req.userId;

    const { data, error } = await supabase
      .from("Friends")
      .select(`FriendshipID, NgayTao,
        Requester:Users!Friends_RequesterID_fkey(UserID, HoTen, Email, AvatarUrl, EquippedBadge)`)
      .eq("ReceiverID", userId)
      .eq("TrangThai", "pending")
      .order("NgayTao", { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("[friends] requests error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/friends/sent — pending requests I sent
router.get("/sent", async (req, res) => {
  try {
    const userId = req.userId;

    const { data, error } = await supabase
      .from("Friends")
      .select(`FriendshipID, NgayTao,
        Receiver:Users!Friends_ReceiverID_fkey(UserID, HoTen, Email, AvatarUrl, EquippedBadge)`)
      .eq("RequesterID", userId)
      .eq("TrangThai", "pending")
      .order("NgayTao", { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("[friends] sent error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// PUT /api/friends/:id/accept
router.put("/:id/accept", async (req, res) => {
  try {
    const userId = req.userId;
    const friendshipId = parseInt(req.params.id, 10);

    const { data, error } = await supabase
      .from("Friends")
      .update({ TrangThai: "accepted", NgayCapNhat: new Date().toISOString() })
      .eq("FriendshipID", friendshipId)
      .eq("ReceiverID", userId)
      .eq("TrangThai", "pending")
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Không tìm thấy lời mời" });
    }
    return res.json({ success: true, message: "Đã chấp nhận lời mời" });
  } catch (err) {
    console.error("[friends] accept error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// PUT /api/friends/:id/reject
router.put("/:id/reject", async (req, res) => {
  try {
    const userId = req.userId;
    const friendshipId = parseInt(req.params.id, 10);

    const { data, error } = await supabase
      .from("Friends")
      .update({ TrangThai: "rejected", NgayCapNhat: new Date().toISOString() })
      .eq("FriendshipID", friendshipId)
      .eq("ReceiverID", userId)
      .eq("TrangThai", "pending")
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Không tìm thấy lời mời" });
    }
    return res.json({ success: true, message: "Đã từ chối lời mời" });
  } catch (err) {
    console.error("[friends] reject error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// DELETE /api/friends/:id — unfriend
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const friendshipId = parseInt(req.params.id, 10);

    const { data, error } = await supabase
      .from("Friends")
      .delete()
      .eq("FriendshipID", friendshipId)
      .or(`RequesterID.eq.${userId},ReceiverID.eq.${userId}`)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Không tìm thấy" });
    }
    return res.json({ success: true, message: "Đã huỷ kết bạn" });
  } catch (err) {
    console.error("[friends] unfriend error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/friends/search?q=keyword — search users by name or email
router.get("/search", async (req, res) => {
  try {
    const userId = req.userId;
    const q = (req.query.q || "").trim();

    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    // Sanitize for PostgREST ilike filter
    const safeQ = q.replace(/[%_\\]/g, "\\$&");

    const { data, error } = await supabase
      .from("Users")
      .select("UserID, HoTen, Email, AvatarUrl, EquippedBadge")
      .neq("UserID", userId)
      .or(`HoTen.ilike.%${safeQ}%,Email.ilike.%${safeQ}%`)
      .limit(10);

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("[friends] search error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

module.exports = router;
