# Inventory Management System (FIFO)

An event-driven **Inventory Management System** using **FIFO (First-In, First-Out)** inventory costing. Purchase and sale events are published to **Apache Kafka**, consumed transactionally into **PostgreSQL**, and monitored in real time through a **React** dashboard.

---

## Live Links

- **Frontend (Vercel):** https://inventory-management-system-ebon-beta.vercel.app/
- **Backend API (Render):** https://inventory-management-system-191s.onrender.com
- **Health Check:** https://inventory-management-system-191s.onrender.com/health

---

## Demo Credentials

- **Username:** `admin`
- **Password:** `admin`

*(Seeded locally with `npm run seed` in `backend/`, or register a new account on the Sign Up page.)*

---

## Architecture

```text
Kafka Producer (API / Simulator)
        │
        ▼
Kafka Topic: inventory-events
        │
        ▼
Kafka Consumer (in-process via index.js or standalone consumerWorker.js)
        │  BEGIN -> idempotency check -> FIFO batch allocation -> COMMIT
        ▼
PostgreSQL Database
        │  polled every 5s + refreshed after actions
        ▼
React Dashboard (Stock Overview & Transaction Ledger)
```

---

## FIFO Inventory Logic

- **Purchase (`purchase`):** Auto-creates the product if missing and inserts a new `inventory_batches` row with `quantity`, `remaining_quantity`, `unit_price`, and `timestamp`.
- **Sale (`sale`):** Locks available batches for the product (`remaining_quantity > 0 ORDER BY timestamp ASC, id ASC FOR UPDATE`), consumes oldest batches first (supporting partial batch consumption), writes per-batch audit rows into `sale_batch_details`, and records `sales.total_cost`. If total available stock is less than the requested quantity (or the product does not exist), the whole sale is rejected and rolled back.
- **Exact Money Math:** Costs use PostgreSQL `NUMERIC(14,2)` / `NUMERIC(14,4)` and exact fixed-point minor-unit arithmetic (`BigInt`) without floating-point rounding drift.

### Example (`50@100 + 30@120 -> sale 60 = 6200`)

| Step | Event | Batch State | Cost Breakdown |
|---|---|---|---|
| 1 | Purchase 50 @ 100.00 | Batch 1: `50` remaining @ `100.00` | — |
| 2 | Purchase 30 @ 120.00 | Batch 1: `50`, Batch 2: `30` @ `120.00` | — |
| 3 | Sale 60 units | Batch 1: `0`, Batch 2: `20` remaining | `50 × 100.00 = 5000.00` + `10 × 120.00 = 1200.00` = **6200.00** |

Remaining stock: **20 units**, total inventory cost: **2400.00**, average cost per unit: **120.00**.

---

## Database Tables

- `users` — Registered dashboard/API users (`bcrypt` password hashes)
- `products` — Product catalog (`product_id`, `name`)
- `inventory_batches` — Purchase batches (`quantity`, `remaining_quantity`, `unit_price`, `timestamp`)
- `sales` — Completed FIFO sales (`quantity`, `total_cost`, `timestamp`)
- `sale_batch_details` — Per-batch FIFO audit trail (`sale_id`, `batch_id`, `quantity_taken`, `unit_cost`, `cost_incurred`)
- `processed_events` — Consumer idempotency log (`UNIQUE (topic, partition, "offset")`)
- `failed_events` — Malformed, invalid, or rejected Kafka messages (`raw_payload`, `reason`, `topic`, `partition`, `"offset"`, `created_at`)
- `transaction_ledger` *(View)* — Unified purchases + sales ledger ordered by `timestamp`

---

## API Endpoints

- `GET /health` — Database and Kafka producer/consumer readiness check
- `POST /api/auth/register` — Register a new user
- `POST /api/auth/login` — Authenticate and receive a JWT
- `GET /api/stock` *(JWT required)* — Product stock overview (`product_id`, `current_quantity`, `total_inventory_cost`, `average_cost_per_unit`)
- `GET /api/ledger` *(JWT required)* — Unified transaction ledger
- `POST /api/event` *(JWT required)* — Validate and publish a single event (`400` on invalid input, `409` on insufficient stock, `503` if Kafka is disconnected)
- `POST /api/simulate` *(JWT required)* — Validate and publish simulated purchase/sale events to Kafka

---

## Environment Variables

Copy `.env.example` to `.env` in both `backend/` and `frontend/` before running locally:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Never commit `.env` files. On Render and Vercel, configure these variables in the platform dashboard.

### Backend (`backend/.env`)

```env
# Optional — default: 3001
PORT=3001

# Required — PostgreSQL connection string
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require

# Optional in dev (logs warning + uses fallback-secret-for-dev);
# Required and >= 32 characters when NODE_ENV=production
JWT_SECRET=change_me_to_a_long_random_string

# Optional — default: unset (in-process consumer starts automatically unless 'true')
DISABLE_IN_PROCESS_CONSUMER=false

# Kafka Configuration
# Required for Kafka — default: [] if unset
KAFKA_BROKERS=your-kafka-host:port
# Optional — default: inventory-app
KAFKA_CLIENT_ID=inventory-app
# Optional — default: inventory-consumer-group
KAFKA_GROUP_ID=inventory-consumer-group
# Optional — default: inventory-events
KAFKA_TOPIC=inventory-events
# Optional — default: unset (set to 'true' to enable TLS/SSL)
KAFKA_SSL=true

# CA certificate when KAFKA_SSL=true (choose one):
#   1) KAFKA_SSL_CA: inline PEM text (recommended on Render; '\n' escaped newlines supported)
#   2) KAFKA_SSL_CA_PATH: path to local CA PEM file
# KAFKA_SSL_CA="-----BEGIN CERTIFICATE-----\nYOUR_CA_CERTIFICATE_PEM_CONTENT\n-----END CERTIFICATE-----"
# KAFKA_SSL_CA_PATH=./ca.pem

# Optional mTLS client cert/key — only needed for client-certificate login
# KAFKA_SSL_CERT_PATH=./service.cert
# KAFKA_SSL_KEY_PATH=./service.key

# SASL Authentication (Optional — default mechanism: scram-sha-256)
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_USERNAME=your_kafka_username
KAFKA_PASSWORD=your_kafka_password
```

### Frontend (`frontend/.env`)

```env
# Optional — default: http://localhost:3001
VITE_API_URL=http://localhost:3001
```

---

## Local Setup

### 1. Backend

```bash
cd backend
npm install
npm run migrate
npm run seed
npm run dev:all
```

Verify API health at `http://localhost:3001/health`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## How to Run the Kafka Producer / Simulator Locally

The standalone simulator in `simulator/producer.js` connects directly to Kafka (independent of the Express web server) using the environment variables in `backend/.env` (or exported in your shell). It generates purchases first, followed by sales strictly smaller than the purchased quantities in that run, keyed by `product_id`.

### Commands

From the repository root:

```bash
node simulator/producer.js
```

Or from `backend/`:

```bash
npm run simulate
```

### CLI Options

- `--count N` — Number of events to generate (`5` to `10`, default: `8`)
- `--product ID` — Generate events only for a specific `product_id` (default cycles `PRD001`, `PRD002`, `PRD003`)
- `--interval MS` — Delay in milliseconds between sent events (default: `1000`)
- `--dry-run` — Print generated events without connecting or sending to Kafka
- `--help` — Show CLI help

Examples:

```bash
# Preview 8 generated events without connecting to Kafka
node simulator/producer.js --dry-run

# Send 6 events for PRD001 with 500ms spacing
cd backend && npm run simulate -- --count 6 --product PRD001 --interval 500
```

### Expected Output

```text
Connected to Kafka. Topic: inventory-events
Sent [1/8] partition=0 offset=42 key=PRD001 payload={"product_id":"PRD001","event_type":"purchase","quantity":50,"unit_price":100,"timestamp":"2026-11-26T10:00:00Z"}
...
Sent [8/8] partition=0 offset=49 key=PRD003 payload={"product_id":"PRD003","event_type":"sale","quantity":41,"timestamp":"2026-11-26T10:00:35Z"}
Summary: sent=8/8 topic=inventory-events purchases=5 sales=3
```

---

## Running Tests

Automated backend tests run against an in-memory `pg-mem` database (no real database or live Kafka broker required):

```bash
cd backend
npm test
```

---

## Postman Collection

Import the collection and environment from:

- `docs/analysis/postman/Inventory-FIFO.postman_collection.json`
- `docs/analysis/postman/Inventory-FIFO.postman_environment.json`

---

## Deployment Notes (Render & Vercel)

- **Managed Kafka (Free Tier):** Kafka is hosted on a free-tier managed service (TLS + SASL `SCRAM-SHA-256`). Allow up to a few seconds for initial connection/retry on cold starts.
- **Backend on Render:**
  - Set `NODE_ENV=production` and a strong `JWT_SECRET` (at least 32 characters — the server refuses to start in production if missing or shorter).
  - Set `DATABASE_URL`, `KAFKA_BROKERS`, `KAFKA_SSL=true`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, and paste the CA certificate PEM into `KAFKA_SSL_CA` (escaped `\n` newlines are handled automatically).
  - `npm start` runs both the Express API and the in-process Kafka consumer unless `DISABLE_IN_PROCESS_CONSUMER=true`.
- **Frontend on Vercel:**
  - Set `VITE_API_URL` in the Vercel project dashboard to your Render backend URL.
  - `frontend/vercel.json` includes the SPA rewrite (`/(.*) -> /index.html`) for React Router.
