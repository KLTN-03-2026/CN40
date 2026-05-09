const { supabase } = require("../config/database");
const { buildDirectDisplayNames, buildGroupDisplayNames } = require("./conversation-display-helpers");

async function listConversations(userId) {
  const { data: memberships, error: mErr } = await supabase
    .from("ConversationMembers")
    .select("ConversationID, DaDoc")
    .eq("UserID", userId);

  if (mErr) throw mErr;
  if (!memberships || memberships.length === 0) return [];

  const convIds = memberships.map((m) => m.ConversationID);
  const readMap = Object.fromEntries(memberships.map((m) => [m.ConversationID, m.DaDoc]));

  const { data: convs, error: cErr } = await supabase
    .from("Conversations")
    .select("ConversationID, LoaiHoiThoai, GroupID, TinNhanCuoi, ThoiGianCuoi")
    .in("ConversationID", convIds)
    .order("ThoiGianCuoi", { ascending: false, nullsFirst: false });

  if (cErr) throw cErr;
  if (!convs || convs.length === 0) return [];

  const directIds = convs.filter((c) => c.LoaiHoiThoai === "direct").map((c) => c.ConversationID);
  const groupIds = convs.filter((c) => c.LoaiHoiThoai === "group" && c.GroupID).map((c) => c.GroupID);

  const [directNameMap, groupNameMap] = await Promise.all([
    buildDirectDisplayNames(directIds, userId),
    buildGroupDisplayNames(groupIds),
  ]);

  return convs.map((c) => {
    const direct = directNameMap[c.ConversationID];
    return {
      conversationId: c.ConversationID,
      type: c.LoaiHoiThoai,
      displayName:
        c.LoaiHoiThoai === "direct"
          ? (direct?.name || "Unknown")
          : groupNameMap[c.GroupID] || "Group",
      equippedBadge:
        c.LoaiHoiThoai === "direct" ? (direct?.equippedBadge || null) : null,
      lastMessage: c.TinNhanCuoi,
      lastMessageAt: c.ThoiGianCuoi,
      isRead: readMap[c.ConversationID] !== false,
    };
  });
}

async function getOrCreateDirect(userId, targetUserId) {
  const { data: friendship } = await supabase
    .from("Friends")
    .select("FriendshipID")
    .or(
      `and(RequesterID.eq.${userId},ReceiverID.eq.${targetUserId}),and(RequesterID.eq.${targetUserId},ReceiverID.eq.${userId})`
    )
    .eq("TrangThai", "accepted")
    .single();

  if (!friendship) throw { status: 403, message: "Chưa kết bạn với người dùng này" };
  const { data: userConvs } = await supabase
    .from("ConversationMembers")
    .select("ConversationID")
    .eq("UserID", userId);

  if (userConvs && userConvs.length > 0) {
    const userConvIds = userConvs.map((c) => c.ConversationID);

    const { data: targetConvs } = await supabase
      .from("ConversationMembers")
      .select("ConversationID")
      .eq("UserID", targetUserId)
      .in("ConversationID", userConvIds);

    if (targetConvs && targetConvs.length > 0) {
      const sharedIds = targetConvs.map((c) => c.ConversationID);
      const { data: direct } = await supabase
        .from("Conversations")
        .select("*")
        .in("ConversationID", sharedIds)
        .eq("LoaiHoiThoai", "direct")
        .single();

      if (direct) return { conversation: direct, created: false };
    }
  }

  const { data: conv, error: cErr } = await supabase
    .from("Conversations")
    .insert({ LoaiHoiThoai: "direct", NgayTao: new Date().toISOString() })
    .select()
    .single();

  if (cErr) throw cErr;
  const { error: mErr } = await supabase.from("ConversationMembers").insert([
    { ConversationID: conv.ConversationID, UserID: userId, NgayThamGia: new Date().toISOString() },
    { ConversationID: conv.ConversationID, UserID: targetUserId, NgayThamGia: new Date().toISOString() },
  ]);

  if (mErr) throw mErr;

  return { conversation: conv, created: true };
}

async function getGroupConversation(groupId, userId) {
  const { data: member } = await supabase
    .from("GroupMembers")
    .select("MemberID")
    .eq("GroupID", groupId)
    .eq("UserID", userId)
    .single();

  if (!member) throw { status: 403, message: "Không phải thành viên của nhóm này" };

  const { data: conv, error } = await supabase
    .from("Conversations")
    .select("*")
    .eq("GroupID", groupId)
    .eq("LoaiHoiThoai", "group")
    .single();

  if (error || !conv) throw { status: 404, message: "Không tìm thấy cuộc hội thoại nhóm" };

  return conv;
}

async function markAsRead(conversationId, userId) {
  const { error } = await supabase
    .from("ConversationMembers")
    .update({ DaDoc: true })
    .eq("ConversationID", conversationId)
    .eq("UserID", userId);

  if (error) throw error;
}

async function createGroupConversation(groupId, memberUserIds) {
  const { data: conv, error: cErr } = await supabase
    .from("Conversations")
    .insert({ LoaiHoiThoai: "group", GroupID: groupId, NgayTao: new Date().toISOString() })
    .select()
    .single();

  if (cErr) throw cErr;

  const now = new Date().toISOString();
  const members = memberUserIds.map((uid) => ({
    ConversationID: conv.ConversationID,
    UserID: uid,
    NgayThamGia: now,
  }));

  const { error: mErr } = await supabase.from("ConversationMembers").insert(members);
  if (mErr) throw mErr;

  return conv;
}

async function addMemberToGroupConversation(groupId, userId) {
  const { data: conv } = await supabase
    .from("Conversations")
    .select("ConversationID")
    .eq("GroupID", groupId)
    .eq("LoaiHoiThoai", "group")
    .single();

  if (!conv) return;

  const { data: existing } = await supabase
    .from("ConversationMembers")
    .select("ID")
    .eq("ConversationID", conv.ConversationID)
    .eq("UserID", userId)
    .single();

  if (existing) return;

  await supabase.from("ConversationMembers").insert({
    ConversationID: conv.ConversationID,
    UserID: userId,
    NgayThamGia: new Date().toISOString(),
  });
}

async function getUnreadCount(userId) {
  const { count, error } = await supabase
    .from("ConversationMembers")
    .select("*", { count: "exact", head: true })
    .eq("UserID", userId)
    .eq("DaDoc", false);

  if (error) throw error;
  return count || 0;
}

module.exports = {
  listConversations,
  getOrCreateDirect,
  getGroupConversation,
  markAsRead,
  createGroupConversation,
  addMemberToGroupConversation,
  getUnreadCount,
};
