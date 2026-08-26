-- ============================================================
-- 06_branch_type.sql — Add Branch Type (Mother vs Child Branch)
-- ============================================================

-- 1. Add is_mother_branch column to profiles table
alter table profiles 
  add column if not exists is_mother_branch boolean not null default false;

-- 2. Add is_mother_branch column to branches table
alter table branches 
  add column if not exists is_mother_branch boolean not null default false;
