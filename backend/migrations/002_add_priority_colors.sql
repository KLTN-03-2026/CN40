-- =============================================================
-- Migration 002: Add PriorityColors (JSONB) to Users
-- Run in Supabase SQL Editor.
-- =============================================================

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "PriorityColors" JSONB NULL;

-- Shape: { "1": "#10B981", "2": "#3B82F6", "3": "#F59E0B", "4": "#DC2626" }
-- NULL means "use system defaults" (muted palette in frontend/assets/css/main.css).
