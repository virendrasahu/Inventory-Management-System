-- Phase 2 Step 3 Migration:
-- Backfill sale_batch_details.unit_cost for legacy rows where unit_cost = 0.
-- Safe to run twice (idempotent).

UPDATE sale_batch_details
SET unit_cost = ROUND(cost_incurred / NULLIF(quantity_taken, 0), 4)
WHERE unit_cost = 0
  AND quantity_taken <> 0;
