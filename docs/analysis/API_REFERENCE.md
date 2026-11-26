# API Reference — Inventory Management System (FIFO)

**Base URLs:**
- **Local:** `http://localhost:3001`
- **Production (Render):** `https://inventory-management-system-191s.onrender.com`

**Route Mounting Summary** (`backend/index.js`):
- `GET /health` → `backend/index.js:20`
- `/api/auth/*` → `backend/index.js:33` → `backend/src/routes/authRoutes.js`
- `/api/*` → `backend/index.js:34` → `backend/src/routes/inventoryRoutes.js`

> **Dead Frontend Reference:** `frontend/src/pages/Login.jsx:15` calls `POST /api/login`, which does **not** exist on the backend (the actual route is `POST /api/auth/login`). `Login.jsx` is unused in `App.jsx`.

---

## 1. `GET /health`

- **Purpose:** Verify API server liveness and PostgreSQL database connectivity.
- **Auth Required:** No
- **Headers:** None required
- **Path / Query Params:** None
- **Request Body:** None
- **Source:** `backend/index.js:20-30`

### Success Response (`200 OK`)
```json
{
  "status": "healthy",
  "db": "connected",
  "kafka_producer": "connected"
}
```
> **Note:** Currently `kafka_producer: "connected"` is hardcoded at `backend/index.js:25` and is **not** actually verified against Kafka.

### Error Responses
- **`500 Internal Server Error`** (when `db.query('SELECT 1')` fails):
```json
{
  "status": "unhealthy",
  "error": "connection terminated unexpectedly"
}
```

---

## 2. `POST /api/auth/register`

- **Purpose:** Create a new user account with a bcrypt-hashed password (`saltRounds = 10`).
- **Auth Required:** No
- **Headers:**
  - `Content-Type: application/json`
- **Path / Query Params:** None
- **Source:**
  - Route: `backend/src/routes/authRoutes.js:7`
  - Validator: `backend/src/validators/authValidator.js:17-23`
  - Controller: `backend/src/controllers/authController.js:6-38`
  - Repository: `backend/src/repositories/authRepository.js:13-21`

### Request Body
| Field | Type | Required | Validation Rules |
|---|---|---|---|
| `full_name` | `string` | Yes | `notEmpty()` |
| `username` | `string` | Yes | `notEmpty()`, `isLength({ min: 3 })` |
| `email` | `string` | Yes | `isEmail()` |
| `password` | `string` | Yes | `isLength({ min: 6 })` |

Example:
```json
{
  "full_name": "Jane Doe",
  "username": "janedoe",
  "email": "jane@example.com",
  "password": "Password123!"
}
```

### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": 2,
    "username": "janedoe",
    "full_name": "Jane Doe"
  }
}
```

### Error Responses
- **`400 Bad Request`** (express-validator failure, `authValidator.js:6`):
```json
{
  "errors": [
    {
      "type": "field",
      "value": "ab",
      "msg": "Username must be at least 3 characters",
      "path": "username",
      "location": "body"
    }
  ]
}
```
- **`409 Conflict`** (duplicate username or email, `authController.js:13, 20`):
```json
{
  "success": false,
  "message": "Username is already taken"
}
```
or
```json
{
  "success": false,
  "message": "Email is already taken"
}
```
- **`500 Internal Server Error`** (`errorHandler.js:6`):
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## 3. `POST /api/auth/login`

- **Purpose:** Authenticate user by username or email and return a signed JWT (`expiresIn: '1d'`).
- **Auth Required:** No
- **Headers:**
  - `Content-Type: application/json`
- **Path / Query Params:** None
- **Source:**
  - Route: `backend/src/routes/authRoutes.js:8`
  - Validator: `backend/src/validators/authValidator.js:11-15`
  - Controller: `backend/src/controllers/authController.js:40-65`
  - Repository: `backend/src/repositories/authRepository.js:8-11`

### Request Body
| Field | Type | Required | Validation Rules |
|---|---|---|---|
| `identifier` | `string` | Yes | `notEmpty()` (matches `users.username` OR `users.email`) |
| `password` | `string` | Yes | `notEmpty()` |

Example:
```json
{
  "identifier": "admin",
  "password": "<your-password>"
}
```

### Success Response (`200 OK`)
```json
{
  "success": true,
  "token": "<jwt-token>",
  "user": {
    "id": 1,
    "username": "admin",
    "full_name": null,
    "email": null
  }
}
```

### Error Responses
- **`400 Bad Request`** (validation error, `authValidator.js:6`):
```json
{
  "errors": [
    {
      "type": "field",
      "value": "",
      "msg": "Username or Email is required",
      "path": "identifier",
      "location": "body"
    }
  ]
}
```
- **`401 Unauthorized`** (user not found or wrong password, `authController.js:46, 52`):
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```
- **`500 Internal Server Error`** (`errorHandler.js:6`):
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## 4. `GET /api/stock`

- **Purpose:** Return remaining stock quantity, total inventory cost (sum of remaining FIFO batch values), and average cost per unit for every product.
- **Auth Required:** Yes (`Authorization: Bearer <token>`)
- **Headers:**
  - `Authorization: Bearer <token>`
- **Path / Query Params:** None
- **Request Body:** None
- **Source:**
  - Route: `backend/src/routes/inventoryRoutes.js:7`
  - Middleware: `backend/src/middlewares/auth.js:6-21`
  - Controller: `backend/src/controllers/inventoryController.js:5-12`
  - Repository: `backend/src/repositories/inventoryRepository.js:3-22`

### Success Response (`200 OK`)
```json
[
  {
    "product_id": "PRD001",
    "current_quantity": 30,
    "total_inventory_cost": 360,
    "average_cost_per_unit": "12.00"
  },
  {
    "product_id": "PRD002",
    "current_quantity": 150,
    "total_inventory_cost": 750,
    "average_cost_per_unit": "5.00"
  }
]
```
> **Type quirk:** `average_cost_per_unit` is a `string` (`"12.00"`) when `current_quantity > 0`, and `number` `0` when `current_quantity === 0` (`inventoryRepository.js:18-20`).

### Error Responses
- **`401 Unauthorized`** (missing token, `auth.js:11`):
```json
{
  "error": "Access denied. No token provided."
}
```
- **`401 Unauthorized`** (expired/invalid token, `auth.js:19`):
```json
{
  "error": "Invalid token."
}
```
- **`500 Internal Server Error`** (`errorHandler.js:6`):
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## 5. `GET /api/ledger`

- **Purpose:** Return unified time-series transaction ledger (`transaction_ledger` view: purchases from `inventory_batches` and sales from `sales`) sorted by `timestamp DESC`.
- **Auth Required:** Yes (`Authorization: Bearer <token>`)
- **Headers:**
  - `Authorization: Bearer <token>`
- **Path / Query Params:** None
- **Request Body:** None
- **Source:**
  - Route: `backend/src/routes/inventoryRoutes.js:8`
  - Middleware: `backend/src/middlewares/auth.js:6-21`
  - Controller: `backend/src/controllers/inventoryController.js:14-21`
  - Repository: `backend/src/repositories/inventoryRepository.js:24-27`

### Success Response (`200 OK`)
```json
[
  {
    "id": 2,
    "type": "sale",
    "product_id": "PRD002",
    "quantity": 50,
    "price": null,
    "total_value": "250.00",
    "timestamp": "2026-07-16T13:50:33.921Z"
  },
  {
    "id": 3,
    "type": "purchase",
    "product_id": "PRD002",
    "quantity": 200,
    "price": "5.00",
    "total_value": "1000.00",
    "timestamp": "2026-07-16T13:50:30.921Z"
  }
]
```
> **Note:** `pg` returns PostgreSQL `DECIMAL(10, 2)` columns (`price`, `total_value`) as strings. For `sale` rows, `price` is `null` and `total_value` is the calculated FIFO `total_cost`.

### Error Responses
- **`401 Unauthorized`** (`auth.js:11, 19`): `{ "error": "Access denied. No token provided." }` or `{ "error": "Invalid token." }`
- **`500 Internal Server Error`** (`errorHandler.js:6`): `{ "success": false, "message": "Internal Server Error" }`

---

## 6. `POST /api/event`

- **Purpose:** Publish a single purchase or sale inventory event to Kafka topic `inventory-events`. Processing into PostgreSQL happens asynchronously when `consumerWorker.js` consumes the message.
- **Auth Required:** Yes (`Authorization: Bearer <token>`)
- **Headers:**
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
- **Path / Query Params:** None
- **Source:**
  - Route: `backend/src/routes/inventoryRoutes.js:10`
  - Middleware: `backend/src/middlewares/auth.js:6-21`
  - Controller: `backend/src/controllers/inventoryController.js:46-68`
  - Producer: `backend/src/kafka/producer.js:35-46`

### Request Body
| Field | Type | Required | Current Validation Rules (`inventoryController.js:50`) |
|---|---|---|---|
| `product_id` | `string` | Yes | Truthy check only (`!product_id`) |
| `event_type` | `string` | Yes | Truthy check only (should be `"purchase"` or `"sale"`, **not currently enforced**) |
| `quantity` | `number` | Yes | Truthy check only (`!quantity`), cast via `Number(quantity)` (**negative/non-integer/NaN not rejected**) |
| `unit_price` | `number` | Conditional | Optional in controller; coerced to `0` if falsy (`unit_price ? Number(unit_price) : 0`) |

Example (Purchase):
```json
{
  "product_id": "PRD004",
  "event_type": "purchase",
  "quantity": 50,
  "unit_price": 100.0
}
```

Example (Sale):
```json
{
  "product_id": "PRD004",
  "event_type": "sale",
  "quantity": 20
}
```

> **Note:** Any `timestamp` supplied by the caller is ignored; `inventoryController.js:59` always sets `timestamp: new Date().toISOString()`.

### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Event pushed to Kafka"
}
```

### Error Responses
- **`400 Bad Request`** (missing `product_id`, `event_type`, or `quantity`, `inventoryController.js:51`):
```json
{
  "error": "Missing required fields"
}
```
- **`401 Unauthorized`** (`auth.js:11, 19`): `{ "error": "Access denied. No token provided." }` or `{ "error": "Invalid token." }`
- **`500 Internal Server Error`** (e.g., Kafka producer disconnected, `errorHandler.js:6`):
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```

---

## 7. `POST /api/simulate`

- **Purpose:** Produce 5 hardcoded dummy events (3 for `PRD001`, 2 for `PRD002`) sequentially to Kafka topic `inventory-events`.
- **Auth Required:** Yes (`Authorization: Bearer <token>`)
- **Headers:**
  - `Authorization: Bearer <token>`
- **Path / Query Params:** None
- **Request Body:** None
- **Source:**
  - Route: `backend/src/routes/inventoryRoutes.js:9`
  - Middleware: `backend/src/middlewares/auth.js:6-21`
  - Controller: `backend/src/controllers/inventoryController.js:23-44`
  - Producer: `backend/src/kafka/producer.js:35-46`

### Events Published
1. `PRD001` purchase `100` @ `10.0` (`now - 10s`)
2. `PRD001` purchase `50` @ `12.0` (`now - 8s`)
3. `PRD001` sale `120` (`now - 5s`)
4. `PRD002` purchase `200` @ `5.0` (`now - 4s`)
5. `PRD002` sale `50` (`now - 1s`)

### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Simulated events sent to Kafka"
}
```

### Error Responses
- **`401 Unauthorized`** (`auth.js:11, 19`): `{ "error": "Access denied. No token provided." }` or `{ "error": "Invalid token." }`
- **`500 Internal Server Error`** (e.g., Kafka producer disconnected, `errorHandler.js:6`):
```json
{
  "success": false,
  "message": "Internal Server Error"
}
```
