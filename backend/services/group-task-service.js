// group-task-service.js — business logic for GroupTasks
const { supabase } = require("../config/database");
const { getMemberRole, isOwnerOrAdmin } = require("./group-service");
const sync = require("./group-task-sync-service");

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const VALID_PRIORITIES = new Set([1, 2, 3, 4]);

async function createTask(actorId, { groupId, assignedTo, tieuDe, moTa, mucDoUuTien, hanChot }) {
  groupId = parseInt(groupId, 10);
  assignedTo = parseInt(assignedTo, 10);
  if (!groupId || !assignedTo) throw { status: 400, message: "groupId và assignedTo là bắt buộc" };

  tieuDe = (tieuDe || "").trim();
  if (!tieuDe || tieuDe.length > 200) throw { status: 400, message: "Tiêu đề từ 1-200 ký tự" };

  const allowed = await isOwnerOrAdmin(groupId, actorId);
  if (!allowed) throw { status: 403, message: "Chỉ chủ nhóm/admin được tạo nhiệm vụ" };

  const assigneeRole = await getMemberRole(groupId, assignedTo);
  if (!assigneeRole) throw { status: 400, message: "Người được giao phải là thành viên nhóm" };

  const priority = mucDoUuTien ? parseInt(mucDoUuTien, 10) : 2;
  if (!VALID_PRIORITIES.has(priority)) throw { status: 400, message: "Mức độ ưu tiên từ 1-4" };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("GroupTasks")
    .insert({
      GroupID: groupId,
      AssignedTo: assignedTo,
      AssignedBy: actorId,
      TieuDe: tieuDe,
      MoTa: moTa || null,
      TrangThai: "pending",
      MucDoUuTien: priority,
      HanChot: hanChot || null,
      NgayTao: now,
      NgayCapNhat: now,
    })
    .select()
    .single();

  if (error) throw error;

  const { data: grp } = await supabase.from("Groups").select("TenNhom").eq("GroupID", groupId).maybeSingle();
  await sync.createPersonalTaskForGroupTask(data, grp?.TenNhom || "Nhóm");

  return data;
}

async function listTasks(actorId, groupId) {
  groupId = parseInt(groupId, 10);
  if (!groupId) throw { status: 400, message: "groupId là bắt buộc" };

  const role = await getMemberRole(groupId, actorId);
  if (!role) throw { status: 403, message: "Bạn không phải thành viên nhóm này" };

  const { data, error } = await supabase
    .from("GroupTasks")
    .select(`*, Assignee:Users!GroupTasks_AssignedTo_fkey(UserID, HoTen, AvatarUrl)`)
    .eq("GroupID", groupId)
    .order("NgayTao", { ascending: false });

  if (error) throw error;

  const gtIds = (data || []).map((t) => t.GroupTaskID);
  const progressMap = await sync.getSessionProgress(gtIds);
  for (const t of data || []) {
    const p = progressMap.get(t.GroupTaskID);
    t.SessionCount = p?.total || 0;
    t.SessionDone = p?.done || 0;
    t.SessionPercent = p?.percent || 0;
    t.HasPersonalTask = p?.hasPersonalTask || false;
  }

  return data || [];
}

async function updateTask(taskId, actorId, patch) {
  const { data: task, error: fetchErr } = await supabase
    .from("GroupTasks")
    .select("*")
    .eq("GroupTaskID", taskId)
    .single();

  if (fetchErr || !task) throw { status: 404, message: "Không tìm thấy nhiệm vụ" };

  const actorRole = await getMemberRole(task.GroupID, actorId);
  if (!actorRole) throw { status: 403, message: "Bạn không phải thành viên nhóm này" };

  const isPrivileged = actorRole === "owner" || actorRole === "admin";
  const isAssignee = task.AssignedTo === actorId;

  if (!isPrivileged && !isAssignee) throw { status: 403, message: "Không có quyền cập nhật nhiệm vụ này" };

  const update = { NgayCapNhat: new Date().toISOString() };

  if (!isPrivileged) {
    // Assignee can only update TrangThai
    if (patch.trangThai !== undefined) {
      if (!VALID_STATUSES.has(patch.trangThai)) throw { status: 400, message: "Trạng thái không hợp lệ" };
      update.TrangThai = patch.trangThai;
    }
  } else {
    if (patch.tieuDe !== undefined) {
      const tieuDe = patch.tieuDe.trim();
      if (!tieuDe || tieuDe.length > 200) throw { status: 400, message: "Tiêu đề từ 1-200 ký tự" };
      update.TieuDe = tieuDe;
    }
    if (patch.moTa !== undefined) update.MoTa = patch.moTa || null;
    if (patch.trangThai !== undefined) {
      if (!VALID_STATUSES.has(patch.trangThai)) throw { status: 400, message: "Trạng thái không hợp lệ" };
      update.TrangThai = patch.trangThai;
    }
    if (patch.mucDoUuTien !== undefined) {
      const p = parseInt(patch.mucDoUuTien, 10);
      if (!VALID_PRIORITIES.has(p)) throw { status: 400, message: "Mức độ ưu tiên từ 1-4" };
      update.MucDoUuTien = p;
    }
    if (patch.hanChot !== undefined) update.HanChot = patch.hanChot || null;
    if (patch.assignedTo !== undefined) {
      const newAssignee = parseInt(patch.assignedTo, 10);
      const assigneeRole = await getMemberRole(task.GroupID, newAssignee);
      if (!assigneeRole) throw { status: 400, message: "Người được giao phải là thành viên nhóm" };
      update.AssignedTo = newAssignee;
    }
  }

  const { data, error } = await supabase
    .from("GroupTasks")
    .update(update)
    .eq("GroupTaskID", taskId)
    .select()
    .single();

  if (error) throw error;

  if (update.TrangThai) {
    await sync.syncStatusToPersonalTask(taskId, update.TrangThai);
  }

  return data;
}

async function deleteTask(taskId, actorId) {
  const { data: task, error: fetchErr } = await supabase
    .from("GroupTasks")
    .select("GroupID")
    .eq("GroupTaskID", taskId)
    .single();

  if (fetchErr || !task) throw { status: 404, message: "Không tìm thấy nhiệm vụ" };

  const allowed = await isOwnerOrAdmin(task.GroupID, actorId);
  if (!allowed) throw { status: 403, message: "Chỉ chủ nhóm/admin được xóa nhiệm vụ" };

  await supabase.from("CongViec").update({ TrangThaiThucHien: 3 }).eq("GroupTaskID", taskId);

  const { error } = await supabase.from("GroupTasks").delete().eq("GroupTaskID", taskId);
  if (error) throw error;
}

async function getProgress(actorId, groupId) {
  groupId = parseInt(groupId, 10);
  if (!groupId) throw { status: 400, message: "groupId là bắt buộc" };

  const role = await getMemberRole(groupId, actorId);
  if (!role) throw { status: 403, message: "Bạn không phải thành viên nhóm này" };

  const { data: members, error: mErr } = await supabase
    .from("GroupMembers")
    .select(`UserID, Users(HoTen)`)
    .eq("GroupID", groupId);

  if (mErr) throw mErr;

  const { data: tasks, error: tErr } = await supabase
    .from("GroupTasks")
    .select("AssignedTo, TrangThai")
    .eq("GroupID", groupId);

  if (tErr) throw tErr;

  const statsMap = {};
  (members || []).forEach(({ UserID, Users }) => {
    statsMap[UserID] = { userId: UserID, hoTen: Users?.HoTen || "", total: 0, completed: 0 };
  });

  (tasks || []).forEach(({ AssignedTo, TrangThai }) => {
    if (!statsMap[AssignedTo]) return;
    statsMap[AssignedTo].total += 1;
    if (TrangThai === "completed") statsMap[AssignedTo].completed += 1;
  });

  const result = Object.values(statsMap).map((s) => ({
    ...s,
    percent: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
  }));

  return result;
}

async function getMyCalendarTasks(userId) {
  const { data, error } = await supabase
    .from("GroupTasks")
    .select(`*, Groups(GroupID, TenNhom), Assignee:Users!GroupTasks_AssignedTo_fkey(HoTen)`)
    .eq("AssignedTo", userId)
    .not("HanChot", "is", null)
    .neq("TrangThai", "cancelled")
    .neq("TrangThai", "completed")
    .order("HanChot", { ascending: true });

  if (error) throw error;

  const PRIO_COLORS = { 1: "#F87171", 2: "#60A5FA", 3: "#FBBF24", 4: "#94a3b8" };

  return (data || []).map((t) => {
    const color = PRIO_COLORS[t.MucDoUuTien] || "#60A5FA";
    const deadline = new Date(t.HanChot);
    return {
      id: `gt-${t.GroupTaskID}`,
      title: t.TieuDe,
      start: deadline.toISOString().slice(0, 10),
      allDay: true,
      backgroundColor: color,
      borderColor: color,
      textColor: "#FFFFFF",
      classNames: ["group-task-event"],
      extendedProps: {
        isGroupTask: true,
        groupTaskId: t.GroupTaskID,
        groupId: t.GroupID,
        groupName: t.Groups?.TenNhom || "",
        description: t.MoTa || "",
        priority: t.MucDoUuTien || 2,
        status: t.TrangThai,
        deadline: t.HanChot,
        completed: t.TrangThai === "completed",
      },
    };
  });
}

module.exports = { createTask, listTasks, updateTask, deleteTask, getProgress, getMyCalendarTasks };
