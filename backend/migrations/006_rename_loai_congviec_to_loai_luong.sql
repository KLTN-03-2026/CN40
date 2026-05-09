-- =============================================================
-- Migration 006: Rename CongViec.LoaiCongViec -> CongViec.LoaiLuong
-- Reason: "LoaiCongViec" conflicts with the existing LoaiCongViec
-- (category) TABLE name, breaking Supabase embeds like
--   .select("*, LoaiCongViec(TenLoai)")
-- which otherwise collide (the same JSON key is both a scalar and
-- an embedded object). "LoaiLuong" (salary type) is unambiguous.
-- Run AFTER migration 005.
-- =============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='CongViec' AND column_name='LoaiCongViec'
  ) THEN
    ALTER TABLE "CongViec" RENAME COLUMN "LoaiCongViec" TO "LoaiLuong";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='chk_congviec_loai'
  ) THEN
    ALTER TABLE "CongViec" RENAME CONSTRAINT chk_congviec_loai TO chk_congviec_loai_luong;
  END IF;
END $$;

-- Rebuild the partial index with the new column name
DROP INDEX IF EXISTS idx_congviec_hop_dong_period;

CREATE INDEX IF NOT EXISTS idx_congviec_hop_dong_period
  ON "CongViec" ("UserID", "NgayBatDauHopDong", "NgayKetThucHopDong")
  WHERE "LoaiLuong" = 'full_time';

-- =============================================================
-- END OF MIGRATION
--
-- Rollback:
--   ALTER TABLE "CongViec" RENAME COLUMN "LoaiLuong" TO "LoaiCongViec";
--   ALTER TABLE "CongViec" RENAME CONSTRAINT chk_congviec_loai_luong TO chk_congviec_loai;
--   DROP INDEX IF EXISTS idx_congviec_hop_dong_period;
--   CREATE INDEX idx_congviec_hop_dong_period
--     ON "CongViec" ("UserID", "NgayBatDauHopDong", "NgayKetThucHopDong")
--     WHERE "LoaiCongViec" = 'full_time';
-- =============================================================
