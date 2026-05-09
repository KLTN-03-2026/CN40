-- Add EquippedBadge column to Users table for displaying badges next to user names
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "EquippedBadge" TEXT DEFAULT NULL;
