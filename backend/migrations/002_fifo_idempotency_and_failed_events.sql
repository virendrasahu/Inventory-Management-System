-- Phase 2 Step 2 Migration:
-- 1. Add failed_events table for invalid or rejected Kafka messages
-- 2. Add processed_events table with UNIQUE(topic, partition, "offset") for consumer idempotency
-- 3. Upgrade monetary columns to NUMERIC(14,2) and unit prices/costs to NUMERIC(14,4)
-- 4. Add unit_cost column to sale_batch_details and deterministic FIFO index

CREATE TABLE IF NOT EXISTS failed_events (
    id SERIAL PRIMARY KEY,
    raw_payload TEXT,
    reason TEXT NOT NULL,
    topic VARCHAR(255) NOT NULL,
    partition INT NOT NULL,
    "offset" VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_events_created_at
ON failed_events(created_at DESC);

CREATE TABLE IF NOT EXISTS processed_events (
    id SERIAL PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    partition INT NOT NULL,
    "offset" VARCHAR(100) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_processed_events_topic_partition_offset UNIQUE (topic, partition, "offset")
);

-- Drop dependent view before altering column types, then recreate it
DROP VIEW IF EXISTS transaction_ledger;

ALTER TABLE inventory_batches
    ALTER COLUMN unit_price TYPE NUMERIC(14, 4);

ALTER TABLE sales
    ALTER COLUMN total_cost TYPE NUMERIC(14, 2);

ALTER TABLE sale_batch_details
    ALTER COLUMN cost_incurred TYPE NUMERIC(14, 2);

ALTER TABLE sale_batch_details
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14, 4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inventory_batches_fifo_order
ON inventory_batches(product_id, timestamp, id);

CREATE OR REPLACE VIEW transaction_ledger AS
SELECT
    id,
    'purchase' AS type,
    product_id,
    quantity,
    unit_price AS price,
    ROUND(quantity * unit_price, 2) AS total_value,
    timestamp
FROM inventory_batches
UNION ALL
SELECT
    id,
    'sale' AS type,
    product_id,
    quantity,
    NULL AS price,
    total_cost AS total_value,
    timestamp
FROM sales;
