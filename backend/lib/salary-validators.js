/**
 * salary-validators.js
 * Helpers for Phase 03 — tasks + salary backend.
 *
 * Exports:
 *   validateSalaryFields(body)      -> { ok, errors, sanitized }
 *   findOverlappingFullTime(...)    -> existing task blocking a new full-time period (or null)
 *   findFullTimeCategory(userId)    -> category row that looks like "Full time work" (fuzzy)
 */

const { supabase } = require("../config/database");

const ALLOWED_LOAI_LUONG = new Set(["none", "part_time", "full_time"]);
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

// --- validateSalaryFields ---------------------------------------------------
function validateSalaryFields(d = {}) {
  const errors = [];
  const sanitized = {};

  // LoaiLuong
  const raw = d.LoaiLuong ?? "none";
  if (!ALLOWED_LOAI_LUONG.has(raw)) {
    errors.push("LoaiLuong phải là none | part_time | full_time");
  }
  sanitized.LoaiLuong = ALLOWED_LOAI_LUONG.has(raw) ? raw : "none";

  // Full-time branch
  if (sanitized.LoaiLuong === "full_time") {
    const luong = Number(d.LuongThang);
    if (!Number.isFinite(luong) || luong <= 0) {
      errors.push("Lương tháng phải là số dương khi chọn full-time");
    } else {
      sanitized.LuongThang = luong;
    }

    sanitized.NgayBatDauHopDong = d.NgayBatDauHopDong || null;
    sanitized.NgayKetThucHopDong = d.NgayKetThucHopDong || null;
    if (
      sanitized.NgayBatDauHopDong &&
      sanitized.NgayKetThucHopDong &&
      sanitized.NgayKetThucHopDong < sanitized.NgayBatDauHopDong
    ) {
      errors.push("Ngày kết thúc hợp đồng phải sau ngày bắt đầu");
    }

    // WorkingDays: expect array of ints in 1..7
    sanitized.NgayLamViec = coerceWorkingDays(d.NgayLamViec);

    // Shifts ignored for full-time
    sanitized.CauHinhCa = null;
  }
  // Part-time branch
  else if (sanitized.LoaiLuong === "part_time") {
    sanitized.CauHinhCa = coerceShifts(d.CauHinhCa, errors);
    sanitized.LuongThang = null;
    sanitized.NgayBatDauHopDong = null;
    sanitized.NgayKetThucHopDong = null;
    sanitized.NgayLamViec = null;
  }
  // None branch
  else {
    sanitized.LuongThang = null;
    sanitized.CauHinhCa = null;
    sanitized.NgayLamViec = null;
    sanitized.NgayBatDauHopDong = null;
    sanitized.NgayKetThucHopDong = null;
  }

  return { ok: errors.length === 0, errors, sanitized };
}

function coerceWorkingDays(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= 7);
  const unique = Array.from(new Set(cleaned)).sort((a, b) => a - b);
  return unique.length ? unique : null;
}

function coerceShifts(value, errors) {
  if (value == null || value === "") return null;
  if (!Array.isArray(value)) {
    errors.push("CauHinhCa phải là mảng");
    return null;
  }
  const shifts = [];
  for (const s of value) {
    if (!s || typeof s !== "object") continue;
    const name = String(s.name || "").trim();
    const start = String(s.start || "").trim();
    const end = String(s.end || "").trim();
    if (!name) {
      errors.push("Mỗi ca phải có tên");
      continue;
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      errors.push(`Ca "${name}" có giờ không hợp lệ (HH:MM)`);
      continue;
    }
    shifts.push({ name, start, end });
  }
  return shifts;
}

// --- findOverlappingFullTime ------------------------------------------------
// Two full-time contracts overlap when A.start <= B.end AND A.end >= B.start.
// NULL end means open-ended; we treat it as "+infinity" for the filter.
async function findOverlappingFullTime(
  userId,
  newStart,
  newEnd,
  excludeTaskId = null
) {
  // Without dates we cannot assess overlap → skip (backward compat).
  if (!newStart) return null;

  let query = supabase
    .from("CongViec")
    .select('"MaCongViec","TieuDe","NgayBatDauHopDong","NgayKetThucHopDong"')
    .eq("UserID", userId)
    .eq("LoaiLuong", "full_time")
    .neq("TrangThaiThucHien", 3); // exclude cancelled

  if (excludeTaskId != null) query = query.neq("MaCongViec", excludeTaskId);

  const { data, error } = await query;
  if (error) {
    console.error("[salary-validators] overlap query failed:", error);
    return null;
  }

  for (const row of data || []) {
    const exStart = row.NgayBatDauHopDong;
    const exEnd = row.NgayKetThucHopDong; // may be null = open-ended
    // Strict range overlap with open-ended support
    const startsBeforeExEnd = !exEnd || newStart <= exEnd;
    const endsAfterExStart = !exStart || !newEnd || newEnd >= exStart;
    if (startsBeforeExEnd && endsAfterExStart) {
      return row;
    }
  }
  return null;
}

// --- findFullTimeCategory (fuzzy) ------------------------------------------
function normalizeCategoryName(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function findFullTimeCategory(userId) {
  const { data: cats } = await supabase
    .from("LoaiCongViec")
    .select("MaLoai, TenLoai")
    .eq("UserID", userId);

  if (!cats) return null;

  // Match "full time work" / "Full-time work" / "Công việc full time" …
  const TARGETS = ["fulltimework", "fulltime", "congviecfulltime"];
  for (const c of cats) {
    const norm = normalizeCategoryName(c.TenLoai);
    if (TARGETS.some((t) => norm.includes(t))) return c;
  }
  return null;
}

module.exports = {
  validateSalaryFields,
  findOverlappingFullTime,
  findFullTimeCategory,
  // exported for tests
  normalizeCategoryName,
};
