-- =============================================================
-- Migration 005: Salary types, shifts, working days, and
--                salary-adjustments table (DieuChinhLuong)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Related plan: plans/260420-0935-salary-reorder-and-full-time-support/
--
-- Naming convention (per existing DB):
--   Vietnamese-no-diacritics PascalCase for user-facing columns
--   English snake_case for internal identifiers (indexes, constraints)
-- =============================================================

-- -----------------------------------------------------------
-- 1. CongViec: add salary-type columns (all Vietnamese names)
--    Additive only; defaulted or nullable for backward compat.
-- -----------------------------------------------------------

ALTER TABLE "CongViec"
  ADD COLUMN IF NOT EXISTS "LoaiCongViec"       TEXT           DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "LuongThang"         NUMERIC(12,2)  NULL,
  ADD COLUMN IF NOT EXISTS "CauHinhCa"          JSONB          NULL,
  ADD COLUMN IF NOT EXISTS "NgayLamViec"        JSONB          NULL,
  ADD COLUMN IF NOT EXISTS "NgayBatDauHopDong"  DATE           NULL,
  ADD COLUMN IF NOT EXISTS "NgayKetThucHopDong" DATE           NULL;

-- Backfill: any pre-DEFAULT inserts get 'none'
UPDATE "CongViec" SET "LoaiCongViec" = 'none' WHERE "LoaiCongViec" IS NULL;

-- -----------------------------------------------------------
-- 2. CHECK constraints
-- -----------------------------------------------------------

DO $$
BEGIN
  -- LoaiCongViec enum: none / part_time / full_time
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_congviec_loai') THEN
    ALTER TABLE "CongViec"
      ADD CONSTRAINT chk_congviec_loai
      CHECK ("LoaiCongViec" IN ('none','part_time','full_time'));
  END IF;

  -- Hop dong date order (only if both present)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_congviec_hop_dong_dates') THEN
    ALTER TABLE "CongViec"
      ADD CONSTRAINT chk_congviec_hop_dong_dates
      CHECK (
        "NgayBatDauHopDong" IS NULL
        OR "NgayKetThucHopDong" IS NULL
        OR "NgayKetThucHopDong" >= "NgayBatDauHopDong"
      );
  END IF;

  -- NgayLamViec: must be JSON array when present (values validated in backend)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_congviec_ngay_lam_viec_type') THEN
    ALTER TABLE "CongViec"
      ADD CONSTRAINT chk_congviec_ngay_lam_viec_type
      CHECK (
        "NgayLamViec" IS NULL
        OR jsonb_typeof("NgayLamViec") = 'array'
      );
  END IF;

  -- CauHinhCa: must be array when present
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_congviec_cau_hinh_ca_type') THEN
    ALTER TABLE "CongViec"
      ADD CONSTRAINT chk_congviec_cau_hinh_ca_type
      CHECK (
        "CauHinhCa" IS NULL
        OR jsonb_typeof("CauHinhCa") = 'array'
      );
  END IF;
END $$;

-- -----------------------------------------------------------
-- 3. Index: full-time overlap detection per user
--    App-level overlap check filters by UserID + date range.
-- -----------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_congviec_hop_dong_period
  ON "CongViec" ("UserID", "NgayBatDauHopDong", "NgayKetThucHopDong")
  WHERE "LoaiCongViec" = 'full_time';

-- -----------------------------------------------------------
-- 4. DieuChinhLuong — per-month delta (bonus/deduction)
--    Separate table for audit trail + easy month aggregation.
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS "DieuChinhLuong" (
  "MaDieuChinh" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "MaCongViec"  INTEGER       NOT NULL REFERENCES "CongViec"("MaCongViec") ON DELETE CASCADE,
  "UserID"      INTEGER       NOT NULL,
  "Thang"       TEXT          NOT NULL,
  "SoTien"      NUMERIC(12,2) NOT NULL,
  "LyDo"        TEXT          NULL,
  "NgayTao"     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  -- Thang format: YYYY-MM (e.g. 2026-04)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_dieu_chinh_luong_thang_fmt') THEN
    ALTER TABLE "DieuChinhLuong"
      ADD CONSTRAINT chk_dieu_chinh_luong_thang_fmt
      CHECK ("Thang" ~ '^[0-9]{4}-[0-9]{2}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dieu_chinh_luong_congviec_thang
  ON "DieuChinhLuong"("MaCongViec", "Thang");

CREATE INDEX IF NOT EXISTS idx_dieu_chinh_luong_user_thang
  ON "DieuChinhLuong"("UserID", "Thang");

-- =============================================================
-- END OF MIGRATION
--
-- Rollback:
--   DROP TABLE IF EXISTS "DieuChinhLuong";
--   DROP INDEX IF EXISTS idx_congviec_hop_dong_period;
--   ALTER TABLE "CongViec"
--     DROP CONSTRAINT IF EXISTS chk_congviec_loai,
--     DROP CONSTRAINT IF EXISTS chk_congviec_hop_dong_dates,
--     DROP CONSTRAINT IF EXISTS chk_congviec_ngay_lam_viec_type,
--     DROP CONSTRAINT IF EXISTS chk_congviec_cau_hinh_ca_type,
--     DROP COLUMN IF EXISTS "LoaiCongViec",
--     DROP COLUMN IF EXISTS "LuongThang",
--     DROP COLUMN IF EXISTS "CauHinhCa",
--     DROP COLUMN IF EXISTS "NgayLamViec",
--     DROP COLUMN IF EXISTS "NgayBatDauHopDong",
--     DROP COLUMN IF EXISTS "NgayKetThucHopDong";
-- =============================================================
