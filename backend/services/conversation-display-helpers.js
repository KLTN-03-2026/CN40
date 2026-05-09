const { supabase } = require("../config/database");

// Builds a map of ConversationID -> other user's HoTen for direct conversations
async function buildDirectDisplayNames(directConvIds, currentUserId) {
  if (!directConvIds.length) return {};

  const { data: others } = await supabase
    .from("ConversationMembers")
    .select("ConversationID, UserID")
    .in("ConversationID", directConvIds)
    .neq("UserID", currentUserId);

  if (!others || others.length === 0) return {};

  const otherUserIds = [...new Set(others.map((o) => o.UserID))];
  const { data: users } = await supabase
    .from("Users")
    .select("UserID, HoTen, EquippedBadge")
    .in("UserID", otherUserIds);

  const userMap = users ? Object.fromEntries(users.map((u) => [u.UserID, u])) : {};
  return Object.fromEntries(others.map((o) => {
    const u = userMap[o.UserID];
    return [o.ConversationID, { name: u?.HoTen || "Unknown", equippedBadge: u?.EquippedBadge || null }];
  }));
}

// Builds a map of GroupID -> TenNhom for group conversations
async function buildGroupDisplayNames(groupIds) {
  if (!groupIds.length) return {};

  const { data: groups } = await supabase
    .from("Groups")
    .select("GroupID, TenNhom")
    .in("GroupID", groupIds);

  return groups ? Object.fromEntries(groups.map((g) => [g.GroupID, g.TenNhom])) : {};
}

module.exports = { buildDirectDisplayNames, buildGroupDisplayNames };
