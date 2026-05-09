// group-member-service.js — member add/remove/role logic for GroupMembers table
const { supabase } = require("../config/database");
const { getMemberRole, isOwnerOrAdmin } = require("./group-service");

const MAX_MEMBERS = 20;
const VALID_ROLES = new Set(["admin", "member"]);

async function addMember(groupId, actorId, targetUserId) {
  const allowed = await isOwnerOrAdmin(groupId, actorId);
  if (!allowed) throw { status: 403, message: "Chỉ chủ nhóm/admin được thêm thành viên" };

  const { data: friendship } = await supabase
    .from("Friends")
    .select("FriendshipID")
    .or(`and(RequesterID.eq.${actorId},ReceiverID.eq.${targetUserId}),and(RequesterID.eq.${targetUserId},ReceiverID.eq.${actorId})`)
    .eq("TrangThai", "accepted")
    .single();

  if (!friendship) throw { status: 400, message: "Người dùng phải là bạn bè đã chấp nhận" };

  const { count: memberCount } = await supabase
    .from("GroupMembers")
    .select("MemberID", { count: "exact", head: true })
    .eq("GroupID", groupId);

  if (memberCount >= MAX_MEMBERS) throw { status: 400, message: `Nhóm đã đủ ${MAX_MEMBERS} thành viên` };

  const existing = await getMemberRole(groupId, targetUserId);
  if (existing) throw { status: 400, message: "Người dùng đã là thành viên" };

  const { error } = await supabase
    .from("GroupMembers")
    .insert({ GroupID: groupId, UserID: targetUserId, VaiTro: "member", NgayThamGia: new Date().toISOString() });

  if (error) throw error;

  try {
    const convService = require("./conversation-service");
    await convService.addMemberToGroupConversation(groupId, targetUserId);
  } catch (_) {}
}

async function changeMemberRole(groupId, actorId, targetUserId, role) {
  const actorRole = await getMemberRole(groupId, actorId);
  if (actorRole !== "owner") throw { status: 403, message: "Chỉ chủ nhóm được đổi vai trò" };
  if (!VALID_ROLES.has(role)) throw { status: 400, message: "Vai trò không hợp lệ (admin/member)" };

  const targetRole = await getMemberRole(groupId, targetUserId);
  if (!targetRole) throw { status: 404, message: "Không tìm thấy thành viên" };
  if (targetRole === "owner") throw { status: 400, message: "Không thể đổi vai trò chủ nhóm" };

  const { error } = await supabase
    .from("GroupMembers")
    .update({ VaiTro: role })
    .eq("GroupID", groupId)
    .eq("UserID", targetUserId);

  if (error) throw error;
}

async function removeMember(groupId, actorId, targetUserId) {
  const actorRole = await getMemberRole(groupId, actorId);
  const isSelf = actorId === targetUserId;

  if (isSelf) {
    if (actorRole === "owner") throw { status: 400, message: "Chủ nhóm không thể rời nhóm" };
  } else {
    if (actorRole !== "owner" && actorRole !== "admin") {
      throw { status: 403, message: "Chỉ chủ nhóm/admin được xóa thành viên" };
    }
    const targetRole = await getMemberRole(groupId, targetUserId);
    if (!targetRole) throw { status: 404, message: "Không tìm thấy thành viên" };
    if (targetRole === "owner") throw { status: 400, message: "Không thể xóa chủ nhóm" };
  }

  const { error } = await supabase
    .from("GroupMembers")
    .delete()
    .eq("GroupID", groupId)
    .eq("UserID", targetUserId);

  if (error) throw error;
}

module.exports = { addMember, changeMemberRole, removeMember };
