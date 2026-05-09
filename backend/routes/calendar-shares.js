// calendar-shares.js — Express router for collaborative calendar sharing
// Endpoints: invite, list, invitations, accept, reject, revoke/leave
const express = require("express");
const router = express.Router();
const { supabase } = require("../config/database");

const MAX_SHARES_PER_OWNER = 10;

// POST /api/calendar-shares/invite
// Body: { email, permission }
router.post("/invite", async (req, res) => {
  try {
    const ownerId = req.userId;
    const { email, permission = "viewer" } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, message: "Email không hợp lệ" });
    }
    if (!["viewer", "editor"].includes(permission)) {
      return res.status(400).json({ success: false, message: "Quyền không hợp lệ" });
    }

    // Look up recipient — use generic error to avoid user enumeration
    const { data: targetUser, error: userErr } = await supabase
      .from("Users")
      .select("UserID")
      .eq("Email", email.trim().toLowerCase())
      .single();

    if (userErr || !targetUser) {
      return res.status(400).json({ success: false, message: "Không thể gửi lời mời" });
    }

    const sharedWithId = targetUser.UserID;

    if (sharedWithId === ownerId) {
      return res.status(400).json({ success: false, message: "Không thể chia sẻ với chính mình" });
    }

    // Check max shares limit
    const { count, error: countErr } = await supabase
      .from("CalendarShares")
      .select("ShareID", { count: "exact", head: true })
      .eq("OwnerID", ownerId);

    if (countErr) throw countErr;
    if (count >= MAX_SHARES_PER_OWNER) {
      return res.status(400).json({ success: false, message: `Chỉ được chia sẻ tối đa ${MAX_SHARES_PER_OWNER} người` });
    }

    // Insert — conflict on UNIQUE(OwnerID, SharedWithID) returns error
    const { data: share, error: insertErr } = await supabase
      .from("CalendarShares")
      .insert({ OwnerID: ownerId, SharedWithID: sharedWithId, Permission: permission })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        return res.status(409).json({ success: false, message: "Đã chia sẻ với người này rồi" });
      }
      throw insertErr;
    }

    return res.json({ success: true, data: share });
  } catch (err) {
    console.error("[calendar-shares] invite error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/calendar-shares — shares I sent (accepted) + shares I received (accepted)
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    // Shares I sent (as owner), all statuses except rejected for display
    const { data: sent, error: sentErr } = await supabase
      .from("CalendarShares")
      .select(`ShareID, Permission, TrangThai, NgayTao, SharedWithID, Users!CalendarShares_SharedWithID_fkey(HoTen, Email)`)
      .eq("OwnerID", userId)
      .neq("TrangThai", "rejected");

    if (sentErr) throw sentErr;

    // Shares I received (accepted only)
    const { data: received, error: recvErr } = await supabase
      .from("CalendarShares")
      .select(`ShareID, Permission, TrangThai, NgayTao, OwnerID, Users!CalendarShares_OwnerID_fkey(HoTen, Email)`)
      .eq("SharedWithID", userId)
      .eq("TrangThai", "accepted");

    if (recvErr) throw recvErr;

    return res.json({ success: true, data: { sent: sent || [], received: received || [] } });
  } catch (err) {
    console.error("[calendar-shares] list error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// GET /api/calendar-shares/invitations — pending invitations for current user
router.get("/invitations", async (req, res) => {
  try {
    const userId = req.userId;

    const { data, error } = await supabase
      .from("CalendarShares")
      .select(`ShareID, Permission, NgayTao, OwnerID, Users!CalendarShares_OwnerID_fkey(HoTen, Email)`)
      .eq("SharedWithID", userId)
      .eq("TrangThai", "pending");

    if (error) throw error;

    return res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("[calendar-shares] invitations error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// PUT /api/calendar-shares/:id/accept
router.put("/:id/accept", async (req, res) => {
  try {
    const userId = req.userId;
    const shareId = parseInt(req.params.id, 10);

    if (isNaN(shareId)) return res.status(400).json({ success: false, message: "ID không hợp lệ" });

    // Verify ownership and status
    const { data: share, error: findErr } = await supabase
      .from("CalendarShares")
      .select("ShareID, TrangThai, SharedWithID")
      .eq("ShareID", shareId)
      .single();

    if (findErr || !share) return res.status(404).json({ success: false, message: "Không tìm thấy lời mời" });
    if (share.SharedWithID !== userId) return res.status(403).json({ success: false, message: "Không có quyền" });
    if (share.TrangThai !== "pending") return res.status(400).json({ success: false, message: "Lời mời đã xử lý" });

    const { data: updated, error: updateErr } = await supabase
      .from("CalendarShares")
      .update({ TrangThai: "accepted", NgayCapNhat: new Date().toISOString() })
      .eq("ShareID", shareId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[calendar-shares] accept error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// PUT /api/calendar-shares/:id/reject
router.put("/:id/reject", async (req, res) => {
  try {
    const userId = req.userId;
    const shareId = parseInt(req.params.id, 10);

    if (isNaN(shareId)) return res.status(400).json({ success: false, message: "ID không hợp lệ" });

    const { data: share, error: findErr } = await supabase
      .from("CalendarShares")
      .select("ShareID, TrangThai, SharedWithID")
      .eq("ShareID", shareId)
      .single();

    if (findErr || !share) return res.status(404).json({ success: false, message: "Không tìm thấy lời mời" });
    if (share.SharedWithID !== userId) return res.status(403).json({ success: false, message: "Không có quyền" });
    if (share.TrangThai !== "pending") return res.status(400).json({ success: false, message: "Lời mời đã xử lý" });

    const { data: updated, error: updateErr } = await supabase
      .from("CalendarShares")
      .update({ TrangThai: "rejected", NgayCapNhat: new Date().toISOString() })
      .eq("ShareID", shareId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[calendar-shares] reject error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

// DELETE /api/calendar-shares/:id — revoke (owner) or leave (recipient)
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const shareId = parseInt(req.params.id, 10);

    if (isNaN(shareId)) return res.status(400).json({ success: false, message: "ID không hợp lệ" });

    const { data: share, error: findErr } = await supabase
      .from("CalendarShares")
      .select("ShareID, OwnerID, SharedWithID")
      .eq("ShareID", shareId)
      .single();

    if (findErr || !share) return res.status(404).json({ success: false, message: "Không tìm thấy" });

    // Must be owner or recipient
    if (share.OwnerID !== userId && share.SharedWithID !== userId) {
      return res.status(403).json({ success: false, message: "Không có quyền" });
    }

    const { error: delErr } = await supabase
      .from("CalendarShares")
      .delete()
      .eq("ShareID", shareId);

    if (delErr) throw delErr;

    return res.json({ success: true });
  } catch (err) {
    console.error("[calendar-shares] delete error:", err);
    return res.status(500).json({ success: false, message: "Lỗi máy chủ" });
  }
});

module.exports = router;
