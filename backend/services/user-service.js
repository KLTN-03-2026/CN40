/**
 * user-service.js
 * Pure business logic for Users endpoints — no req/res.
 * Used by user-controller.js.
 */

const { supabase } = require("../config/database");
const bcrypt = require("bcryptjs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_HOCVAN = new Set(["thcs", "thpt", "dai_hoc", "di_lam", "khac"]);
const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const DEFAULT_PRIORITY_COLORS = {
  1: "#10B981",
  2: "#3B82F6",
  3: "#F59E0B",
  4: "#DC2626",
};
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/** GET /api/users/priority-colors */
async function getPriorityColors(userId) {
  const { data: row, error } = await supabase
    .from("Users")
    .select("PriorityColors")
    .eq("UserID", userId)
    .single();

  if (error) {
    // Column missing (migration not yet run) → graceful fallback
    if (error.code === "42703" || /PriorityColors/.test(error.message || "")) {
      return { data: DEFAULT_PRIORITY_COLORS, _fallback: "defaults" };
    }
    throw { status: 500, message: "Load failed" };
  }

  const stored = row?.PriorityColors || null;
  return { data: { ...DEFAULT_PRIORITY_COLORS, ...(stored || {}) } };
}

/** PUT /api/users/priority-colors */
async function updatePriorityColors(userId, payload) {
  const cleaned = {};
  for (const key of ["1", "2", "3", "4"]) {
    if (payload[key] !== undefined) {
      if (!HEX_RE.test(String(payload[key]))) {
        throw { status: 400, message: `Màu ưu tiên ${key} không hợp lệ (cần #RRGGBB)` };
      }
      cleaned[key] = String(payload[key]).toUpperCase();
    }
  }
  if (Object.keys(cleaned).length === 0) {
    throw { status: 400, message: "Không có màu nào để cập nhật" };
  }

  const { data: existingRow } = await supabase
    .from("Users")
    .select("PriorityColors")
    .eq("UserID", userId)
    .single();
  const merged = { ...DEFAULT_PRIORITY_COLORS, ...(existingRow?.PriorityColors || {}), ...cleaned };

  const { error: updateErr } = await supabase
    .from("Users")
    .update({ PriorityColors: merged })
    .eq("UserID", userId);

  if (updateErr) {
    if (updateErr.code === "42703" || /PriorityColors/.test(updateErr.message || "")) {
      throw { status: 503, message: "Tính năng chưa sẵn sàng — chạy migration 002_add_priority_colors.sql" };
    }
    console.error("PUT /priority-colors:", updateErr);
    throw { status: 500, message: "Save failed" };
  }

  return merged;
}

/** GET /api/users/profile */
async function getProfile(userId) {
  const { data, error } = await supabase
    .from("Users")
    .select("UserID, Username, Email, HoTen, HocVan, AvatarUrl")
    .eq("UserID", userId)
    .single();

  if (error || !data) {
    console.error("[getProfile] userId:", userId, "error:", error?.message);
    throw { status: 404, message: "User not found" };
  }

  return {
    usedFallback: false,
    data: {
      id: data.UserID,
      username: data.Username,
      email: data.Email,
      hoten: data.HoTen,
      hocvan: data.HocVan || null,
      avatarUrl: data.AvatarUrl || null,
    },
  };
}

/** GET /api/users/:id */
async function getUser(userId) {
  const { data: user, error } = await supabase
    .from("Users")
    .select("UserID, Username, Email, HoTen, HocVan, AvatarUrl")
    .eq("UserID", userId)
    .single();

  if (error || !user) {
    console.error("[getUser] Not found. userId:", userId, "error:", error?.message);
    throw { status: 404, message: "User not found" };
  }

  return {
    id: user.UserID,
    username: user.Username,
    email: user.Email,
    hoten: user.HoTen,
    hocvan: user.HocVan || null,
    avatarUrl: user.AvatarUrl || null,
  };
}

/** PUT /api/users/:id */
async function updateUser(userId, body) {
  const { hoten, email, hocvan } = body;

  if (!hoten || !email) {
    throw { status: 400, message: "Họ tên và email là bắt buộc" };
  }

  const updatePayload = { HoTen: hoten, Email: email };

  if (hocvan !== undefined && hocvan !== null && hocvan !== "") {
    if (!ALLOWED_HOCVAN.has(String(hocvan))) {
      throw { status: 400, message: "Học vấn không hợp lệ" };
    }
    updatePayload.HocVan = String(hocvan);
  } else if (hocvan === "") {
    updatePayload.HocVan = null;
  }

  const { data: updated, error } = await supabase
    .from("Users")
    .update(updatePayload)
    .eq("UserID", userId)
    .select("UserID, Username, Email, HoTen, HocVan, AvatarUrl");

  if (error || !updated || updated.length === 0) {
    console.error("[updateUser] userId:", userId, "error:", error?.message);
    throw { status: error ? 500 : 404, message: error?.message || "User not found" };
  }

  const u = updated[0];
  return {
    id: u.UserID,
    username: u.Username,
    email: u.Email,
    hoten: u.HoTen,
    hocvan: u.HocVan || null,
    avatarUrl: u.AvatarUrl || null,
  };
}

/** DELETE /api/users/:id */
async function deleteUser(userId) {
  const { error } = await supabase.from("Users").delete().eq("UserID", userId);
  if (error) throw { status: 404, message: "User not found" };
}

/** PUT /api/users/:id/password */
async function changePassword(userId, body) {
  const { oldPassword, newPassword } = body || {};
  if (!oldPassword || !newPassword) {
    throw { status: 400, message: "Thiếu mật khẩu cũ hoặc mới" };
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    throw { status: 400, message: "Mật khẩu mới tối thiểu 6 ký tự" };
  }

  const { data: user, error: loadErr } = await supabase
    .from("Users")
    .select("UserID, Password")
    .eq("UserID", userId)
    .single();
  if (loadErr || !user) throw { status: 404, message: "Không tìm thấy user" };

  const ok = await bcrypt.compare(String(oldPassword), user.Password || "");
  if (!ok) throw { status: 400, message: "Mật khẩu cũ không đúng" };

  const hashed = await bcrypt.hash(String(newPassword), 12);
  const { error: updErr } = await supabase
    .from("Users")
    .update({ Password: hashed })
    .eq("UserID", userId);
  if (updErr) {
    console.error("password update error:", updErr);
    throw { status: 500, message: "Không đổi được mật khẩu" };
  }
}

/** POST /api/users/avatar — decodes dataUrl, uploads to Supabase Storage */
async function uploadAvatar(userId, dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw { status: 400, message: "Thiếu dataUrl hợp lệ" };
  }

  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw { status: 400, message: "dataUrl sai định dạng" };

  const mime = m[1].toLowerCase();
  if (!ALLOWED_AVATAR_MIME.has(mime)) {
    throw { status: 400, message: "Chỉ chấp nhận PNG / JPG / WebP" };
  }

  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_AVATAR_BYTES) {
    throw { status: 413, message: "Ảnh quá lớn (tối đa 2MB)" };
  }

  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const storagePath = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, buf, { contentType: mime, cacheControl: "3600", upsert: true });

  if (upErr) {
    console.error("avatar upload:", upErr);
    if (/bucket/i.test(upErr.message || "")) {
      throw { status: 503, message: 'Chưa có bucket "avatars" trên Supabase Storage — tạo bucket public cùng tên.' };
    }
    throw { status: 500, message: "Upload thất bại" };
  }

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
  const publicUrl = pub?.publicUrl || null;
  if (!publicUrl) throw { status: 500, message: "Không lấy được URL công khai" };

  const { error: saveErr } = await supabase
    .from("Users")
    .update({ AvatarUrl: publicUrl })
    .eq("UserID", userId);
  if (saveErr) {
    console.error("avatar save:", saveErr);
    throw { status: 500, message: "Không lưu được AvatarUrl" };
  }

  return publicUrl;
}

module.exports = {
  getPriorityColors,
  updatePriorityColors,
  getProfile,
  getUser,
  updateUser,
  deleteUser,
  changePassword,
  uploadAvatar,
};
