CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100),
    email VARCHAR(150) UNIQUE,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- For existing database
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

CREATE TABLE IF NOT EXISTS products (
    product_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100)
);

-- Represents purchases (inflow)
CREATE TABLE IF NOT EXISTS inventory_batches (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) REFERENCES products(product_id),
    quantity INT NOT NULL,
    remaining_quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Represents sales (outflow)
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) REFERENCES products(product_id),
    quantity INT NOT NULL,
    total_cost DECIMAL(10, 2) NOT NULL, -- Calculated using FIFO
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- FIFO Audit Trail
CREATE TABLE IF NOT EXISTS sale_batch_details (
    id SERIAL PRIMARY KEY,
    sale_id INT REFERENCES sales(id),
    batch_id INT REFERENCES inventory_batches(id),
    quantity_taken INT NOT NULL,
    cost_incurred DECIMAL(10, 2) NOT NULL
);

-- Indexes for performance on FIFO selection
CREATE INDEX IF NOT EXISTS idx_inventory_batches_fifo 
ON inventory_batches(product_id, timestamp, remaining_quantity);

-- Ledger view to unify events for the UI
CREATE OR REPLACE VIEW transaction_ledger AS
SELECT 
    id, 'purchase' as type, product_id, quantity, unit_price as price, (quantity * unit_price) as total_value, timestamp
FROM inventory_batches
UNION ALL
SELECT 
    id, 'sale' as type, product_id, quantity, NULL as price, total_cost as total_value, timestamp
FROM sales;

-- Insert a default product if not exists
INSERT INTO products (product_id, name) VALUES ('PRD001', 'Default Product') ON CONFLICT DO NOTHING;
