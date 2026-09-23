-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 — a real UNIQUE CONSTRAINT on (owner_id, key)
--
-- A REAL DEFECT, found by running supabase/tests/costing.sql against the live
-- database rather than against a double:
--
--     there is no unique or exclusion constraint matching the ON CONFLICT
--     specification
--
-- Migration 0011 enforced "one material per key per account" with a unique
-- INDEX on an EXPRESSION:
--
--     unique (coalesce(owner_id, '000…0'), key)
--
-- The coalesce is there because a system row has a NULL owner, and a plain
-- unique index would treat every NULL as distinct and allow duplicates. It
-- does its job — but `ON CONFLICT (owner_id, key)` cannot match an index on an
-- expression, so every upsert keyed that way fails at runtime. That breaks:
--
--   · `record_purchase` (0013), which is how stage 8 records any price, and
--   · `saveCatalogItem` in the web repository, which sends PostgREST
--     `on_conflict=owner_id,key` — so stage 7's own upsert path was broken
--     against the real database too, and only the in-memory double hid it.
--     No client test could have caught this: the double upserts by looking
--     the row up, which is not what Postgres does.
--
-- Postgres 17 (this project runs 17.6) has `UNIQUE NULLS NOT DISTINCT`, which
-- expresses exactly what the coalesce was imitating: NULL owners compare EQUAL,
-- so two system rows still cannot share a key. As a real constraint it is
-- inferrable by `ON CONFLICT (owner_id, key)`, so both upsert paths work.
--
-- The expression index then has no job left and is dropped, rather than kept as
-- a second index enforcing the same rule at write cost.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.ingredient_catalog
  drop constraint if exists ingredient_catalog_owner_key_key;

alter table public.ingredient_catalog
  add constraint ingredient_catalog_owner_key_key
  unique nulls not distinct (owner_id, key);

drop index if exists public.ingredient_catalog_owner_key_uniq;
