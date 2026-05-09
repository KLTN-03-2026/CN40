// group-service.js — CRUD for Groups table + shared auth helpers
const { supabase } = require("../config/database");

const MAX_GROUPS_OWNED = 10;
const MAX_MEMBERS = 20;

async function getMemberRole(groupId, userId) {
  const { data } = await supabase
    .from("GroupMembers")
    .select("VaiTro")
    .eq("GroupID", groupId)
    .eq("UserID", userId)
    .single();
  return data?.VaiTro || null;
}

async function isOwnerOrAdmin(groupId, userId) {
  const role = await getMemberRole(groupId, userId);
  return role === "owner" || role === "admin";
}

async function createGroup(ownerId, { tenNhom, moTa }) {
  tenNhom = (tenNhom || "").trim();
  if (!tenNhom || tenNhom.length > 100) throw { status: 400, message: "Tên nhóm từ 1-100 ký tự" };
  if (moTa && moTa.length > 500) throw { status: 400, message: "Mô tả tối đa 500 ký tự" };

  const { count } = await supabase
    .from("Groups")
    .select("GroupID", { count: "exact", head: true })
    .eq("OwnerID", ownerId);

  if (count >= MAX_GROUPS_OWNED) {
    throw { status: 400, message: `Tối đa ${MAX_GROUPS_OWNED} nhóm do bạn tạo` };
  }

  const now = new Date().toISOString();
  const { data: group, error } = await supabase
    .from("Groups")
    .insert({ TenNhom: tenNhom, MoTa: moTa || null, OwnerID: ownerId, MaxMembers: MAX_MEMBERS, NgayTao: now, NgayCapNhat: now })
    .select()
    .single();

  if (error) throw error;

  const { error: memberErr } = await supabase
    .from("GroupMembers")
    .insert({ GroupID: group.GroupID, UserID: ownerId, VaiTro: "owner", NgayThamGia: now });

  if (memberErr) throw memberErr;

  // Attempt to create group conversation — skip if service unavailable
  try {
    const convService = require("./conversation-service");
    if (typeof convService.createGroupConversation === "function") {
      await convService.createGroupConversation(group.GroupID, [ownerId]);
    }
  } catch (_) {}

  return group;
}

async function listMyGroups(userId) {
  const { data, error } = await supabase
    .from("GroupMembers")
    .select(`VaiTro, NgayThamGia, Groups(GroupID, TenNhom, MoTa, AvatarUrl, OwnerID, MaxMembers, NgayTao)`)
    .eq("UserID", userId);

  if (error) throw error;

  const groupIds = (data || []).map((m) => m.Groups?.GroupID).filter(Boolean);
  if (groupIds.length === 0) return [];

  const { data: counts } = await supabase.from("GroupMembers").select("GroupID").in("GroupID", groupIds);

  const countMap = {};
  (counts || []).forEach(({ GroupID }) => { countMap[GroupID] = (countMap[GroupID] || 0) + 1; });

  return (data || []).map((m) => ({
    ...m.Groups,
    myRole: m.VaiTro,
    joinedAt: m.NgayThamGia,
    memberCount: countMap[m.Groups?.GroupID] || 0,
  }));
}

async function getGroupDetail(groupId, userId) {
  const role = await getMemberRole(groupId, userId);
  if (!role) throw { status: 403, message: "Bạn không phải thành viên nhóm này" };

  const { data: group, error: gErr } = await supabase.from("Groups").select("*").eq("GroupID", groupId).single();
  if (gErr || !group) throw { status: 404, message: "Không tìm thấy nhóm" };

  const { data: members, error: mErr } = await supabase
    .from("GroupMembers")
    .select(`MemberID, VaiTro, NgayThamGia, Users(UserID, HoTen, Email, AvatarUrl, EquippedBadge)`)
    .eq("GroupID", groupId);

  if (mErr) throw mErr;
  return { ...group, myRole: role, members: members || [] };
}

async function updateGroup(groupId, userId, { tenNhom, moTa, avatarUrl }) {
  const allowed = await isOwnerOrAdmin(groupId, userId);
  if (!allowed) throw { status: 403, message: "Chỉ chủ nhóm/admin được sửa" };

  const patch = { NgayCapNhat: new Date().toISOString() };
  if (tenNhom !== undefined) {
    tenNhom = tenNhom.trim();
    if (!tenNhom || tenNhom.length > 100) throw { status: 400, message: "Tên nhóm từ 1-100 ký tự" };
    patch.TenNhom = tenNhom;
  }
  if (moTa !== undefined) {
    if (moTa && moTa.length > 500) throw { status: 400, message: "Mô tả tối đa 500 ký tự" };
    patch.MoTa = moTa || null;
  }
  if (avatarUrl !== undefined) patch.AvatarUrl = avatarUrl || null;

  const { data, error } = await supabase.from("Groups").update(patch).eq("GroupID", groupId).select().single();
  if (error || !data) throw error || { status: 404, message: "Không tìm thấy nhóm" };
  return data;
}

async function deleteGroup(groupId, userId) {
  const role = await getMemberRole(groupId, userId);
  if (role !== "owner") throw { status: 403, message: "Chỉ chủ nhóm được xóa" };
  const { error } = await supabase.from("Groups").delete().eq("GroupID", groupId);
  if (error) throw error;
}

module.exports = { getMemberRole, isOwnerOrAdmin, createGroup, listMyGroups, getGroupDetail, updateGroup, deleteGroup };
