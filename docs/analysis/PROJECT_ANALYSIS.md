# Project Analysis Report — Inventory Management System (FIFO)

---

## A. Overall Verdict

**Verdict: PARTLY WORKING (Broken in Production / Kafka Pipeline)**

### Top 3 Reasons
1. **Kafka Consumer Does Not Start in Production (`npm start`):** `backend/package.json` sets `"start": "node index.js"`, which only starts the Express API and Kafka Producer (`backend/index.js:49`). The Kafka Consumer lives in a separate process (`backend/consumerWorker.js`) only started by `npm run dev:all` or `npm run consumer`. On Render (`npm start`), no consumer runs, so events never reach PostgreSQL.
2. **Kafka SSL CA Certificate & Startup Resilience Broken for New Aiven + Render:** `backend/src/kafka/config.js:13-26` only reads `KAFKA_SSL_CA_PATH` from disk (no env-var PEM support such as `KAFKA_SSL_CA` for Render), silently falls back to `{ rejectUnauthorized: false }` when no path is provided, and `backend/index.js:52` calls `process.exit(1)` if Kafka is unreachable at startup — crashing the entire API server. In our live local test, `backend/.env` pointed to an unreachable Kafka host (`ENOTFOUND`), causing `POST /api/simulate` to fail with `500` (`The producer is disconnected`), while `GET /health` falsely reported `kafka_producer: "connected"`.
3. **Critical Repository, Validation, and FIFO Edge-Case Gaps:** `README.md` has unresolved Git merge conflict markers (`<<<<<<< Updated upstream` ... `>>>>>>> Stashed changes`), `fifoService.js` lacks positive-number validation, idempotency keys, and tie-breaker ordering (`id ASC`), and silently records full sale quantity even when stock is insufficient (`remainingToSell > 0`).

---

## 1. Architecture & Process Flow

```text
React Frontend (Vite / Vercel)
   │  (Axios + Bearer JWT from localStorage)
   ▼
Express REST API (backend/index.js)
   ├── GET  /health               ──► PostgreSQL (SELECT 1) [Kafka NOT actually checked]
   ├── POST /api/auth/register    ──► PostgreSQL (users)
   ├── POST /api/auth/login       ──► PostgreSQL (users) ──► Sign JWT (1d)
   ├── GET  /api/stock            ──► PostgreSQL (products + inventory_batches)
   ├── GET  /api/ledger           ──► PostgreSQL (transaction_ledger view)
   └── POST /api/event | /simulate
          │
          ▼
     Kafka Producer (backend/src/kafka/producer.js)
          │  topic: "inventory-events"
          ▼
     Apache Kafka (Aiven SASL SCRAM-SHA-256 + TLS)
          │
          ▼  [SEPARATE PROCESS: backend/consumerWorker.js — NOT run by `npm start`!]
     Kafka Consumer (backend/src/kafka/consumer.js, groupId: "inventory-group")
          │
          ▼
     FIFO Service (backend/src/services/fifoService.js)
          │  BEGIN -> INSERT/SELECT ... FOR UPDATE -> UPDATE batches -> INSERT sales & sale_batch_details -> COMMIT
          ▼
     PostgreSQL (Neon)
          │
          ▼  (Polled every 5s by Dashboard.jsx)
     React Dashboard (Stock Overview + Transaction Ledger)
```

### How the Kafka Consumer Is Started
- `backend/package.json:7`: `"start": "node index.js"` → starts **Express + Kafka Producer only** (`backend/index.js:49`).
- `backend/package.json:9`: `"dev:all": "concurrently \"npm run dev\" \"npm run consumer\""` → runs Express + Consumer locally only.
- `backend/package.json:12`: `"consumer": "node consumerWorker.js"`.
- **Conclusion:** On Render, `npm start` does **NOT** run the Kafka consumer. **Severity: HIGH.**

---

## B. Assignment Requirement Checklist

| # | Requirement | Status | Evidence & Notes |
|---|---|---|---|
| 1 | Kafka topic `inventory-events` with `{ product_id, event_type, quantity, unit_price, timestamp }` | **PARTIAL** | Topic is `'inventory-events'` (`producer.js:8`, `consumer.js:9`, `simulator.js:6`). Payload shape works, but consumer/controller lack validation on `event_type`, positive `quantity`, `unit_price` on purchases, and `timestamp` format (`fifoService.js:7`, `inventoryController.js:50`). |
| 2 | PostgreSQL tables: `products`, `inventory_batches`, `sales` (+ audit/ledger) | **PASS** | `backend/setup.sql:16-61` defines `products`, `inventory_batches`, `sales`, `sale_batch_details`, `users`, and `transaction_ledger` view. |
| 3 | FIFO costing: purchase creates batch; sale consumes oldest first; record qty & cost per consumed batch | **PARTIAL** | Core algorithm in `fifoService.js:22-82` passes the `50@100 + 30@120 -> sale 60 = 6200` test and writes `sale_batch_details`. However, missing `id ASC` tie-breaker, JS float math instead of exact decimal/cents, no idempotency, negative quantities allowed, and insufficient stock records unfulfilled sale qty. |
| 4a | Dashboard: Product Stock Overview (`product_id`, `current_quantity`, `total_inventory_cost`, `average_cost_per_unit`) | **PASS** | Implemented in `inventoryRepository.js:3-22` and `Dashboard.jsx:234-258` (all 4 columns rendered). |
| 4b | Dashboard: Transaction Ledger with sale quantity and FIFO cost | **PASS** | Implemented via `transaction_ledger` view (`setup.sql:54-61`), `inventoryRepository.js:24-27`, and `Dashboard.jsx:271-313`. |
| 4c | Dashboard: Live updates (button/simulator pushing 5–10 events + live refresh) | **PARTIAL** | `Dashboard.jsx:111-118` has "Simulate 5 events" button (`POST /api/simulate`) and 5s polling (`Dashboard.jsx:43`). Fails when Kafka is down or consumer isn't running with `npm start`; UI silently swallows errors (`Dashboard.jsx:52-57`). |
| 4d | Dashboard: Login page with ID and password | **PASS** | `SignIn.jsx` + `SignUp.jsx` + JWT auth (`authRoutes.js`). (`Login.jsx` is dead legacy code). |
| 5a | Deliverable: Standalone Kafka simulator script in repo | **PASS** | `simulator/producer.js` emits 5–10 ordered events (default 8) across `PRD001`–`PRD003`, supports `--count`, `--product`, `--interval`, `--dry-run`, and is wired via `npm run simulate` in `backend/package.json` and documented in `README.md`. |
| 5b | Deliverable: README with FIFO brief, how to run producer locally, frontend/backend links | **PASS** | `README.md` rewritten cleanly without conflict markers, covering FIFO logic, architecture, env setup, `simulator/producer.js` usage, tests, Postman path, and Render/Vercel notes. |

---

## 2. FIFO Logic Verification (`backend/src/services/fifoService.js`)

### Test Run Result (Executed Locally Against In-Memory PG Mock)
Running `fifoService.processEvent` directly with Node:
1. Purchase `PRD-TEST`, qty `50`, unit_price `100` → batch #1 (`remaining_quantity = 50`)
2. Purchase `PRD-TEST`, qty `30`, unit_price `120` → batch #2 (`remaining_quantity = 30`)
3. Sale `PRD-TEST`, qty `60` →
   - Consumed `50` from batch #1 (`cost_incurred = 5000.00`)
   - Consumed `10` from batch #2 (`cost_incurred = 1200.00`)
   - Recorded `sales` row: `quantity = 60`, `total_cost = 6200.00`
   - Recorded `sale_batch_details`: 2 rows (`50 @ 5000.00`, `10 @ 1200.00`)
   - Remaining stock: `20` units in batch #2, remaining cost = `2400`, average cost = `120`.

### Edge-Case Audit
- **Ordering (`fifoService.js:36`):** `ORDER BY timestamp ASC FOR UPDATE` — lacks `id ASC` tie-breaker for equal timestamps.
- **Row locking & Transactions (`fifoService.js:14, 36, 84, 86`):** Uses `BEGIN`, `FOR UPDATE`, `COMMIT`, `ROLLBACK`, `client.release()`.
- **Insufficient stock (`fifoService.js:62-69`):** Logs a warning and still inserts `sales` with full requested `quantity` and partial `totalCost`.
- **Sale with no `unit_price`:** Ignored in `fifoService.js`; `inventoryController.js:58` sets `0`.
- **Decimal/Rounding (`fifoService.js:46-47`):** Uses JS floating-point multiplication (`take * batch.unit_price`) rather than integer cents or `DECIMAL` arithmetic in SQL/JS.
- **Out-of-order timestamps:** Backdated purchases are inserted into `inventory_batches` and used by *future* sales (`ORDER BY timestamp ASC`), but do not retroactively recalculate already-committed sales.
- **Duplicate messages / Idempotency:** None. Duplicate Kafka delivery double-counts purchases and sales.
- **Zero / Negative / Non-numeric quantity:** Tested `quantity: -10` → **accepted and inserted `-10` into `inventory_batches`**. Tested `quantity: 'abc'` → passes `fifoService.js:7` guard and fails at SQL integer cast.

---

## 3. Safe-Mode Runtime & Security Checks

### Local Backend Test Run (Observed Results)
1. `npm ci` in `backend/`: Installed 175 packages cleanly.
2. `npm run migrate` (`backend/migrate.js`): Connected to Neon PostgreSQL and completed (`Database initialized successfully`), emitting a `pg` SSL mode deprecation/security warning (`sslmode=require` vs `verify-full`).
3. Starting `node index.js` on `PORT=3099` with existing `backend/.env`:
   - `GET /health` → **`200`** `{"status":"healthy","db":"connected","kafka_producer":"connected"}` (**false positive** — Kafka was actually failing DNS lookup `getaddrinfo ENOTFOUND` in the background and had not exited yet).
   - `POST /api/auth/login` (`admin` / `<REDACTED>`) → **`200`** `{"success":true,"token":"<REDACTED>","user":{"id":1,"username":"admin","full_name":null,"email":null}}`.
   - `GET /api/stock` → **`200`** returned 3 products (`PRD001`, `PRD003`, `PRD002`).
   - `GET /api/ledger` → **`200`** returned transaction history.
   - `POST /api/simulate` → **`500`** (`Internal Server Error`; server logged `KafkaJSError: The producer is disconnected` because the Kafka broker in `backend/.env` returned `ENOTFOUND`).

### Repository & `npm audit` Summary
- **Tracked secret files (`git ls-files`):** `0` `.env`, `.key`, `.cert`, or `.pem` files are committed.
- **Git index anomaly:** `README.md` is in an **unmerged conflict state** (`git status`: `both modified: README.md`).
- **`.gitignore` gap:** Root `.gitignore` does not ignore `*.pem`, `*.cert`, `*.key`, `*.crt`.
- **`npm audit` — Backend:** `8` total (`0` info, `0` low, `3` moderate, `3` high, `2` critical).
  - Critical (indirect): `proxy-addr`, `shell-quote`.
  - High: `concurrently` (**direct devDependency**), `body-parser` (indirect), `brace-expansion` (indirect).
- **`npm audit` — Frontend:** `10` total (`0` info, `0` low, `2` moderate, `8` high, `0` critical).
  - High: `axios` (**direct**), `react-router-dom` (**direct**), `vite` (**direct devDependency**), plus `browserslist`, `follow-redirects`, `nanoid`, `react-router`, `source-map-js` (indirect).

---

## C. Problems Found (Sorted by Severity)

### HIGH Severity

#### H1. [DONE] Kafka Consumer Does Not Run With `npm start` (Broken in Production on Render)
- **Location:** `backend/package.json:7`, `backend/index.js:40-54`, `backend/consumerWorker.js:1-19`
- **What is wrong:** `npm start` executes `node index.js`, which only starts the Express server and Kafka Producer (`connectProducer()`). The Kafka Consumer is isolated in `consumerWorker.js` and only started by `npm run dev:all` or `npm run consumer`.
- **Why it matters:** On Render (which runs `npm start`), incoming `/api/event` and `/api/simulate` messages pile up in Kafka and are **never** written to PostgreSQL. The dashboard never updates.
- **Suggested Fix:** Optionally start the consumer inside `backend/index.js` when `RUN_CONSUMER_IN_PROCESS !== 'false'` (default enabled for single-service Render deployment), while keeping `consumerWorker.js` for split-worker mode:
```js
// backend/index.js (inside non-blocking background startup)
const { startConsumer } = require('./src/kafka/consumer');

if (process.env.RUN_CONSUMER !== 'false') {
  startConsumer().catch((err) => logger.error('Consumer startup failed', { error: err.message }));
}
```
- **Effort:** Small

#### H2. [DONE] Kafka SSL Config Does Not Support PEM Env Var for Render & Falls Back to Insecure TLS
- **Location:** `backend/src/kafka/config.js:10-27`
- **What is wrong:** `config.js` only reads certificates via `fs.readFileSync(process.env.KAFKA_SSL_CA_PATH)`. It does not support `KAFKA_SSL_CA` (raw PEM text in an env var, standard on Render), crashes synchronously if a path doesn't exist, and falls back to `ssl: { rejectUnauthorized: false }` when `KAFKA_SSL=true` without paths.
- **Why it matters:** New Aiven Kafka uses SASL `SCRAM-SHA-256` + a CA certificate. Render env vars store PEM text (often with escaped `\n`), so `KAFKA_SSL_CA_PATH` is inconvenient/error-prone, and `rejectUnauthorized: false` disables certificate verification (and may fail strict verification).
- **Suggested Fix:**
```js
// backend/src/kafka/config.js
if (process.env.KAFKA_SSL === 'true') {
  const sslConfig = { rejectUnauthorized: true };
  if (process.env.KAFKA_SSL_CA) {
    sslConfig.ca = [process.env.KAFKA_SSL_CA.replace(/\\n/g, '\n')];
  } else if (process.env.KAFKA_SSL_CA_PATH) {
    sslConfig.ca = [fs.readFileSync(process.env.KAFKA_SSL_CA_PATH, 'utf-8')];
  } else {
    sslConfig.rejectUnauthorized = false; // explicit fallback only if no CA provided
  }
  if (process.env.KAFKA_SSL_CERT) {
    sslConfig.cert = process.env.KAFKA_SSL_CERT.replace(/\\n/g, '\n');
  } else if (process.env.KAFKA_SSL_CERT_PATH) {
    sslConfig.cert = fs.readFileSync(process.env.KAFKA_SSL_CERT_PATH, 'utf-8');
  }
  if (process.env.KAFKA_SSL_KEY) {
    sslConfig.key = process.env.KAFKA_SSL_KEY.replace(/\\n/g, '\n');
  } else if (process.env.KAFKA_SSL_KEY_PATH) {
    sslConfig.key = fs.readFileSync(process.env.KAFKA_SSL_KEY_PATH, 'utf-8');
  }
  kafkaConfig.ssl = sslConfig;
}
```
- **Effort:** Small

#### H3. [DONE] Server Crashes (`process.exit(1)`) if Kafka Is Unreachable at Startup & `/health` Lies
- **Location:** `backend/index.js:20-30, 48-53`, `backend/src/kafka/consumer.js:29-31`
- **What is wrong:** `index.js` calls `process.exit(1)` if `connectProducer()` throws, causing a crash loop on Render whenever Kafka has a DNS/network hiccup. Meanwhile, `/health` hardcodes `kafka_producer: 'connected'` without checking Kafka. Conversely, `consumer.js` catches connection errors and silently returns without retrying.
- **Why it matters:** A temporary Kafka outage kills even PostgreSQL-backed auth/stock/ledger endpoints, while `/health` returns `200 healthy` during active Kafka failures.
- **Suggested Fix:** Track live Kafka connection flags via KafkaJS instrumentation events (`producer.events.CONNECT`/`DISCONNECT`, `consumer.events.CONNECT`/`DISCONNECT`), start Kafka connections with exponential-backoff retry outside `process.exit(1)`, and report real status in `/health`:
```js
// Track state in producer.js / consumer.js
let producerConnected = false;
producer.on(producer.events.CONNECT, () => { producerConnected = true; });
producer.on(producer.events.DISCONNECT, () => { producerConnected = false; });

const connectWithRetry = async (connectFn, label, delayMs = 2000) => {
  try {
    await connectFn();
  } catch (err) {
    logger.error(`${label} failed, retrying in ${delayMs}ms`, { error: err.message });
    setTimeout(() => connectWithRetry(connectFn, label, Math.min(delayMs * 2, 30000)), delayMs);
  }
};
```
- **Effort:** Medium

#### H4. [DONE] Unresolved Git Merge Conflict Markers in `README.md`
- **Location:** `README.md:367-458` (and `git status` shows `both modified: README.md`)
- **What is wrong:** Conflict markers `<<<<<<< Updated upstream`, `=======`, `>>>>>>> Stashed changes` are committed/staged in `README.md`, duplicating sections (`Screenshots`, `Live Demo` with placeholder `https://your-frontend-url`, `Future Enhancements`).
- **Why it matters:** Primary assignment deliverable looks broken/unfinished and prevents clean git operations until resolved.
- **Suggested Fix:** Resolve conflict markers, remove placeholder URLs, update Project Structure (`index.js`, `simulator.js`), document `KAFKA_SSL_CA`, and add a "How to Run the Kafka Producer Locally" section.
- **Effort:** Small

#### H5. [DONE] Missing Input Validation in `POST /api/event` and `fifoService.js` (Negative/Invalid Quantities Accepted)
- **Location:** `backend/src/controllers/inventoryController.js:46-68`, `backend/src/services/fifoService.js:4-10, 22-27`
- **What is wrong:**
  1. `inventoryController.js:50` only checks `!product_id || !event_type || !quantity`. Negative quantities (`-10`), decimals (`1.5`), invalid `event_type` (`"return"`), and missing/negative `unit_price` on purchases are accepted and sent to Kafka.
  2. `fifoService.js:7` allows negative quantities (`-10` was inserted into `inventory_batches` in our test), unvalidated `event_type`, and missing `unit_price` on purchases (causes PG NOT NULL crash).
- **Why it matters:** Corrupts inventory balances and costs; invalid messages crash DB queries in the consumer.
- **Suggested Fix:** Add an `express-validator` middleware on `POST /api/event` AND defensive validation at the top of `fifoService.processEvent`:
```js
if (
  typeof product_id !== 'string' || !product_id.trim() ||
  !['purchase', 'sale'].includes(event_type) ||
  !Number.isInteger(Number(quantity)) || Number(quantity) <= 0 ||
  Number.isNaN(Date.parse(timestamp)) ||
  (event_type === 'purchase' && (unit_price === undefined || unit_price === null || !Number.isFinite(Number(unit_price)) || Number(unit_price) < 0))
) {
  logger.error('Invalid event payload rejected', { event });
  return;
}
```
- **Effort:** Small

#### H6. [DONE] Hardcoded Fallback JWT Secret
- **Location:** `backend/src/middlewares/auth.js:4`
- **What is wrong:** `const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';`
- **Why it matters:** If `JWT_SECRET` is unset in any deployment, attackers can forge arbitrary valid admin JWTs using the public fallback string.
- **Suggested Fix:** Fail fast at startup if `JWT_SECRET` is missing in production (or always require it in `.env`):
```js
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}
```
- **Effort:** Small

---

### MEDIUM Severity

#### M1. [DONE] Insufficient Stock Silently Records Full Unfulfilled Sale Quantity
- **Location:** `backend/src/services/fifoService.js:62-69`
- **What is wrong:** When `remainingToSell > 0`, `fifoService` logs a warning and still inserts `sales.quantity = quantity` (e.g., 100 sold when only 20 existed, with `total_cost` for 20 units).
- **Why it matters:** `sales.quantity` disagrees with `SUM(sale_batch_details.quantity_taken)`, distorting COGS and inventory accounting.
- **Suggested Fix:** Decide policy explicitly — either throw an `InsufficientStockError` (rolling back the transaction) or cap/reject overselling before inserting into `sales`.
- **Effort:** Small

#### M2. [DONE] No Idempotency / Deduplication Key for Kafka Messages
- **Location:** `backend/setup.sql:22-38`, `backend/src/services/fifoService.js:4-92`
- **What is wrong:** Neither events nor DB tables track an `event_id` (or Kafka `topic/partition/offset`).
- **Why it matters:** Kafka provides at-least-once delivery; consumer restarts or duplicate HTTP/simulator sends will double-apply purchases and sales.
- **Suggested Fix:** Add an optional `event_id VARCHAR(100) UNIQUE` column (or `processed_events(event_key PRIMARY KEY)`) and check `ON CONFLICT DO NOTHING` inside the DB transaction.
- **Effort:** Medium

#### M3. [DONE] Missing Tie-Breaker (`id ASC`) & Float Arithmetic in FIFO Costing
- **Location:** `backend/src/services/fifoService.js:36, 46-47`
- **What is wrong:** `ORDER BY timestamp ASC` has no `id ASC` tie-breaker when timestamps are identical, and `take * batch.unit_price` uses IEEE-754 floats instead of integer cents (`Math.round(Number(batch.unit_price) * 100)`).
- **Why it matters:** Non-deterministic batch order on simultaneous inserts and potential float rounding drift (`0.1 + 0.2`) across multi-batch sales.
- **Suggested Fix:** Change query to `ORDER BY timestamp ASC, id ASC FOR UPDATE` and compute `costCents = take * Math.round(Number(batch.unit_price) * 100)` then divide by `100` when persisting.
- **Effort:** Small

#### M4. CORS Wide Open (`*`) & Missing DB Pool Error Handler / SSL Strictness
- **Location:** `backend/index.js:14`, `backend/src/repositories/db.js:7-12`, `backend/seed.js:5-10`
- **What is wrong:** `app.use(cors())` allows every origin; `db.js` hardcodes `ssl: { rejectUnauthorized: false }` with no `pool.on('error', ...)` or pool limits; `seed.js` duplicates Pool creation instead of importing `db.js`.
- **Why it matters:** Wide-open CORS exposes API to arbitrary browser origins; unhandled `pg` pool idle errors can crash Node.
- **Suggested Fix:** Configure `cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' })`, reuse `db.js` in `seed.js`, and attach `pool.on('error', (err) => logger.error('PG pool error', err))`.
- **Effort:** Small

#### M5. Registration Username/Email Cross-Field Edge Case & Weak Seed Credentials
- **Location:** `backend/src/controllers/authController.js:10-22`, `backend/seed.js:15-22`
- **What is wrong:** `register` calls `getUserByUsernameOrEmail(username)` then checks `existingUser.username === username` — if a new user's `username` equals an existing user's `email` (or vice versa), it bypasses the 409 check and hits a 500 DB error if colliding. Also `seed.js` seeds `admin / admin` with `null` `full_name` and `email`.
- **Why it matters:** Edge-case 500 on registration and weak default password in production if `seed.js` is executed there.
- **Suggested Fix:** Query specifically (`getUserByUsername(username)` and `getUserByEmail(email)`) and read `ADMIN_PASSWORD` from env in `seed.js` with a warning if default is used.
- **Effort:** Small

#### M6. [PARTIAL] Frontend Auth & UX Gaps (No Token Expiry Check, Stale Polling Closure, Silent Errors)
- **Step 3 Status:** Fixed `Dashboard.jsx` polling (`useCallback` + unmount cleanup + immediate refresh after simulate/push), React list keys (`${tx.type}-${tx.id}`), and `400`/`409`/`503` toast error messages. Remaining optional cleanup: `AuthContext` token expiry check and shared `api.js`.
- **Location:** `frontend/src/context/AuthContext.jsx:15-17`, `frontend/src/pages/Dashboard.jsx:41-81`
- **What is wrong:**
  1. `AuthContext.jsx` decodes JWT with `atob` (breaks on base64url `-`/`_`) and never checks `decoded.exp * 1000 < Date.now()`.
  2. `Dashboard.jsx:41-45` uses `useEffect(..., [])` with `setInterval(fetchData, 5000)`, capturing a stale `token` reference, and doesn't cancel pending timeouts on unmount.
  3. `handleSimulate` and `handlePushEvent` swallow API errors (`console.error` only) without showing `toast.error(...)` to the user.
- **Why it matters:** Users clicking "Simulate 5 events" when Kafka is down get zero UI feedback; expired tokens stay "logged in" until API calls fail.
- **Suggested Fix:** Create centralized `src/services/api.js` with Axios request/response interceptors (attaching Bearer token and handling 401), check `decoded.exp` in `AuthContext`, and add `toast.success` / `toast.error` in `Dashboard.jsx`.
- **Effort:** Medium

#### M7. Broken Legacy Files (`backend/kafka.js`, `frontend/src/pages/Login.jsx`)
- **Location:** `backend/kafka.js:2`, `frontend/src/pages/Login.jsx:15, 21`
- **What is wrong:** `backend/kafka.js` requires non-existent `./db` and is unused; `frontend/src/pages/Login.jsx` calls non-existent `/api/login` and leaks `"Use admin / admin"` in its error text.
- **Why it matters:** Confuses reviewers/developers and fails if imported.
- **Suggested Fix:** Remove both unused legacy files.
- **Effort:** Small

#### M8. `npm audit` High/Critical Vulnerabilities in Direct & Transitive Dependencies
- **Location:** `backend/package-lock.json`, `frontend/package-lock.json`
- **What is wrong:** Backend has 2 critical (`proxy-addr`, `shell-quote` indirect) and 3 high (`concurrently` direct dev, `body-parser`, `brace-expansion`); Frontend has 8 high (`axios`, `react-router-dom`, `vite` direct + 5 indirect).
- **Why it matters:** Known CVEs in HTTP client (`axios`), router (`react-router-dom`), and Express transitive deps (`body-parser`, `proxy-addr`).
- **Suggested Fix:** Run `npm audit fix` (and test builds/routes) in both `backend/` and `frontend/`.
- **Effort:** Small

---

### LOW Severity

#### L1. [DONE] Hardcoded Topic Name & Consumer Group ID
- **Location:** `backend/src/kafka/producer.js:8`, `backend/src/kafka/consumer.js:8-9`, `backend/simulator.js:6`
- **What is wrong:** `'inventory-events'` and `'inventory-group'` are hardcoded instead of `process.env.KAFKA_TOPIC || 'inventory-events'`.
- **Suggested Fix:** Centralize `TOPIC` and `GROUP_ID` exports in `backend/src/kafka/config.js` with env var overrides.
- **Effort:** Small

#### L2. Inconsistent `average_cost_per_unit` Type & Currency Symbol Mismatch
- **Location:** `backend/src/repositories/inventoryRepository.js:18-20`, `frontend/src/pages/Dashboard.jsx:88`
- **What is wrong:** `average_cost_per_unit` is a string `"12.00"` when `> 0` and number `0` when `0`; Dashboard formats `$` USD while README shows `₹` INR.
- **Suggested Fix:** Return `Number((total / qty).toFixed(2))` consistently in `inventoryRepository.js`.
- **Effort:** Small

#### L3. Missing `.gitignore` Patterns for Kafka Certificates & Missing `engines` in `package.json`
- **Location:** `.gitignore`, `backend/package.json`
- **What is wrong:** `*.pem`, `*.cert`, `*.key` are not in `.gitignore`; `backend/package.json` lacks `"engines": { "node": ">=18" }`.
- **Suggested Fix:** Add certificate/key patterns to `.gitignore` and `"engines"` to `backend/package.json`.
- **Effort:** Small

#### L4. Missing DB `CHECK` Constraints & `TIMESTAMPTZ` in `setup.sql`
- **Location:** `backend/setup.sql:22-38`
- **What is wrong:** `inventory_batches` and `sales` lack `CHECK (quantity > 0)` / `CHECK (remaining_quantity >= 0)` and use `TIMESTAMP` instead of `TIMESTAMPTZ`.
- **Suggested Fix:** Add `CHECK` constraints (and `TIMESTAMPTZ` migration if appropriate) in `setup.sql`.
- **Effort:** Small

#### L5. [DONE] `backend/simulator.js` Only Sends 2 Events & Uses `console.log`
- **Resolution:** Added standalone `simulator/producer.js` (5–10 ordered events, `--count`, `--product`, `--interval`, `--dry-run`) and `"simulate"` npm script in `backend/package.json`.
- **Location:** `backend/simulator.js:14-17`, `backend/package.json`
- **What is wrong:** Assignment specifies 5–10 dummy events and a documented script; `simulator.js` only emits 2 events and has no `"simulate"` npm script.
- **Suggested Fix:** Expand `simulator.js` to 6–8 realistic purchase/sale events across products and add `"simulate": "node simulator.js"` to `backend/package.json`.
- **Effort:** Small

---

## D. What Is Missing for the Assignment

1. **[DONE]** **In-process Kafka Consumer (or Render Background Worker config)** so `npm start` actually processes Kafka events in deployment.
2. **[DONE]** **PEM-text Env Var (`KAFKA_SSL_CA`) support** in `backend/src/kafka/config.js` for Render + new Aiven SASL `SCRAM-SHA-256`.
3. **[DONE]** **Clean, conflict-free `README.md`** containing accurate project structure, FIFO example, `"How to run the Kafka producer/simulator locally"`, tests, Postman path, deployment notes (`KAFKA_SSL_CA`), and live Vercel/Render links.
4. **[DONE]** **5–10 events in standalone `simulator/producer.js`** + `"simulate"` script in `backend/package.json`.
5. **[DONE]** **Strict validation on `POST /api/event`, `POST /api/simulate`, and `fifoService.js`** (reject negative/zero/non-integer quantity, invalid `event_type`, negative/missing purchase `unit_price`, invalid ISO 8601 `timestamp`; invalid consumer messages logged and saved to `failed_events`).
6. **[DONE]** **Real `/health` check & non-crashing Kafka startup retry**.

---

## E. Step-by-Step Fix Plan (Recommended Order)

1. **Fix Repo & Hygiene First (Partially DONE):**
   - **[DONE]** Resolve `README.md` merge conflict (`git status`); still pending: remove dead `backend/kafka.js` and `frontend/src/pages/Login.jsx`, update `.gitignore` (`*.pem`, `*.cert`, `*.key`).
2. **[DONE] Fix Kafka Config & Resilience (Unblocks New Aiven + Render):**
   - **[DONE]** Add `KAFKA_SSL_CA` (PEM string) support + optional cert/key handling in `backend/src/kafka/config.js`.
   - **[DONE]** Replace `process.exit(1)` in `backend/index.js` with exponential-backoff retry; add real `producerConnected` / `consumerRunning` tracking in `/health`, plus `503` handling in `/api/simulate` & `/api/event` and graceful `SIGTERM`/`SIGINT` shutdown.
   - **[DONE]** Start `startConsumerWithRetry()` in `backend/index.js` (togglable via `DISABLE_IN_PROCESS_CONSUMER=true`) with in-process duplicate guard so `npm start` runs both API and consumer on Render, and keep `consumerWorker.js` working.
3. **[DONE] Harden FIFO Service & Validation:**
   - **[DONE]** Added shared `eventValidator.js` for `POST /api/event`, `POST /api/simulate`, and the Kafka consumer (invalid consumer messages recorded in `failed_events` and skipped).
   - **[DONE]** Added `id ASC` tie-breaker (`ORDER BY timestamp ASC, id ASC FOR UPDATE`), `BigInt` fixed-point money math + `NUMERIC(14,2)`/`NUMERIC(14,4)` migration (`002_fifo_idempotency_and_failed_events.sql`), idempotency via `processed_events(topic, partition, "offset")`, and strict insufficient-stock rollback/rejection (HTTP `409` on `/api/event`, `failed_events` + skip in consumer).
   - **[DONE]** Fixed `average_cost_per_unit` numeric consistency in `inventoryRepository.js`.
4. **Harden Auth, DB & CORS (Partially DONE):**
   - **[DONE]** Refuse startup in `production` when `JWT_SECRET` is missing or `< 32` chars in `auth.js` (warning logged when fallback used in dev).
   - Pending (optional): fix `register` cross-field check in `authController.js`, configure `CORS_ORIGIN` in `index.js`, add `pool.on('error', ...)` in `db.js`, and add `CHECK` constraints in `setup.sql`.
5. **[DONE] Upgrade Standalone Simulator & `README.md`:**
   - **[DONE]** Created `simulator/producer.js` (5–10 events, `--count`, `--product`, `--interval`, `--dry-run`), added `"simulate"` npm script in `backend/package.json`, and updated `README.md` with local producer instructions, tests, Postman path, and Render/Vercel env vars (`KAFKA_SSL_CA`).
6. **Improve Frontend UX & Security:**
   - Create `frontend/src/services/api.js` with Axios interceptors, add `exp` check in `AuthContext.jsx`, fix `Dashboard.jsx` polling/toast error feedback, and run `npm audit fix`.

---

## F. How to Test Everything in Postman

1. **Import Files into Postman:**
   - Import `docs/analysis/postman/Inventory-FIFO.postman_collection.json`
   - Import `docs/analysis/postman/Inventory-FIFO.postman_environment.json`
   - Select the **"Inventory FIFO - Local"** environment in the top-right dropdown (to test Render instead, change `baseUrl` to `https://inventory-management-system-191s.onrender.com`).
2. **Set Credentials:**
   - Open the environment and enter your `password` for `username` (`admin` locally, or run **Auth → Register User** first and update `username`/`password`).
3. **Run Health & Login:**
   - Run **Health → Health Check** (verify `200`, `db: "connected"`).
   - Run **Auth → Login** (verify `200`; the Tests script automatically saves the JWT into `{{token}}`).
4. **Run the FIFO Scenario Folder (Collection Runner):**
   - Ensure both the API server and Kafka consumer are running (`npm run dev:all` locally) and `PRD-TEST` has 0 prior stock.
   - Run the **"FIFO scenario"** folder in order:
     1. `Purchase PRD-TEST 50 @ 100`
     2. `Purchase PRD-TEST 30 @ 120`
     3. `Sale PRD-TEST 60 units`
     4. `Verify Stock` (waits 2.5s for Kafka consumer, asserts remaining qty = `20`, cost = `2400`, avg = `120`)
     5. `Verify Ledger` (asserts sale FIFO cost = `6200`)
5. **Run Negative Tests:**
   - Run the **"Negative Tests"** folder. All negative tests (`Sale Exceeding Available Stock` -> `409`, `Invalid event_type` -> `400`, `Missing product_id` -> `400`, `Negative quantity` -> `400`, `Purchase Without unit_price` -> `400`, `Protected Route Without Token` -> `401`, `Login With Wrong Password` -> `401`) are updated for Phase 2 Step 2.
