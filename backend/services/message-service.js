const { supabase } = require("../config/database");

const VALID_MESSAGE_TYPES = ["text", "task_share", "schedule_share"];
const MAX_CONTENT_LENGTH = 2000;
const MAX_METADATA_LENGTH = 5000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

function validateMessage({ noiDung, loaiTinNhan, metaData }) {
  const trimmed = typeof noiDung === "string" ? noiDung.trim() : "";
  if (!trimmed || trimmed.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: "Nội dung tin nhắn phải từ 1-2000 ký tự" };
  }
  if (loaiTinNhan && !VALID_MESSAGE_TYPES.includes(loaiTinNhan)) {
    throw { status: 400, message: "Loại tin nhắn không hợp lệ" };
  }
  if (metaData && JSON.stringify(metaData).length > MAX_METADATA_LENGTH) {
    throw { status: 400, message: "MetaData vượt quá giới hạn cho phép" };
  }
  return trimmed;
}

async function verifyMembership(conversationId, userId) {
  const { data, error } = await supabase
    .from("ConversationMembers")
    .select("ID")
    .eq("ConversationID", conversationId)
    .eq("UserID", userId)
    .single();

  if (error || !data) throw { status: 403, message: "Không có quyền truy cập cuộc hội thoại này" };
}

async function sendMessage(conversationId, senderId, { noiDung, loaiTinNhan = "text", metaData = null }) {
  const trimmedContent = validateMessage({ noiDung, loaiTinNhan, metaData });

  await verifyMembership(conversationId, senderId);

  const { data: msg, error: insertErr } = await supabase
    .from("Messages")
    .insert({
      ConversationID: conversationId,
      SenderID: senderId,
      NoiDung: trimmedContent,
      LoaiTinNhan: loaiTinNhan,
      MetaData: metaData,
      NgayGui: new Date().toISOString(),
      DaXoa: false,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  const now = new Date().toISOString();

  // Update conversation's last message info
  await supabase
    .from("Conversations")
    .update({ TinNhanCuoi: trimmedContent, ThoiGianCuoi: now })
    .eq("ConversationID", conversationId);

  // Reset DaDoc=false for all other members
  await supabase
    .from("ConversationMembers")
    .update({ DaDoc: false })
    .eq("ConversationID", conversationId)
    .neq("UserID", senderId);

  return msg;
}

async function getMessages(conversationId, userId, { before, limit }) {
  const parsedLimit = Math.min(Math.max(parseInt(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  await verifyMembership(conversationId, userId);

  let query = supabase
    .from("Messages")
    .select("MessageID, ConversationID, SenderID, NoiDung, LoaiTinNhan, MetaData, NgayGui, DaXoa")
    .eq("ConversationID", conversationId)
    .eq("DaXoa", false)
    .order("NgayGui", { ascending: false })
    .limit(parsedLimit);

  if (before) {
    query = query.lt("NgayGui", before);
  }

  const { data, error } = await query;
  if (error) throw error;

  const messages = (data || []).reverse();

  const senderIds = [...new Set(messages.map((m) => m.SenderID).filter(Boolean))];
  let nameMap = {};
  if (senderIds.length > 0) {
    const { data: users } = await supabase
      .from("Users")
      .select("UserID, HoTen")
      .in("UserID", senderIds);
    if (users) {
      nameMap = Object.fromEntries(users.map((u) => [u.UserID, u.HoTen]));
    }
  }

  return messages.map((m) => ({ ...m, senderName: nameMap[m.SenderID] || null }));
}

async function deleteMessage(messageId, userId) {
  const { data: msg, error: fetchErr } = await supabase
    .from("Messages")
    .select("MessageID, SenderID, DaXoa")
    .eq("MessageID", messageId)
    .single();

  if (fetchErr || !msg) throw { status: 404, message: "Không tìm thấy tin nhắn" };
  if (msg.DaXoa) throw { status: 404, message: "Tin nhắn không tồn tại" };
  if (msg.SenderID !== userId) throw { status: 403, message: "Không có quyền xóa tin nhắn này" };

  const { error } = await supabase
    .from("Messages")
    .update({ DaXoa: true })
    .eq("MessageID", messageId);

  if (error) throw error;
}

async function editMessage(messageId, userId, noiDung) {
  const trimmed = typeof noiDung === "string" ? noiDung.trim() : "";
  if (!trimmed || trimmed.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: "Nội dung tin nhắn phải từ 1-2000 ký tự" };
  }

  const { data: msg, error: fetchErr } = await supabase
    .from("Messages")
    .select("MessageID, SenderID, DaXoa, ConversationID")
    .eq("MessageID", messageId)
    .single();

  if (fetchErr || !msg) throw { status: 404, message: "Không tìm thấy tin nhắn" };
  if (msg.DaXoa) throw { status: 400, message: "Không thể sửa tin nhắn đã thu hồi" };
  if (msg.SenderID !== userId) throw { status: 403, message: "Không có quyền sửa tin nhắn này" };

  const { error } = await supabase
    .from("Messages")
    .update({ NoiDung: trimmed })
    .eq("MessageID", messageId);

  if (error) throw error;
}

module.exports = { sendMessage, getMessages, deleteMessage, editMessage };
