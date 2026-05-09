-- =============================================================
-- Migration 007: AvatarUrl column on Users
-- Run in Supabase SQL Editor.
--
-- Also: create a PUBLIC storage bucket named "avatars" in the
-- Supabase Dashboard → Storage. The backend uploads to that bucket
-- and stores the returned public URL in Users.AvatarUrl.
-- =============================================================

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "AvatarUrl" TEXT NULL;

-- Roll back:
--   ALTER TABLE "Users" DROP COLUMN IF EXISTS "AvatarUrl";
