# Inventory Management System (FIFO)

A fully working **Inventory Management System** for a small trading business that uses the **FIFO (First-In, First-Out)** costing method. The application processes purchase and sale events through **Apache Kafka**, stores inventory in **PostgreSQL**, and provides a **real-time React dashboard** to monitor inventory, transaction history, and costing.

---

## 🚀 Features

- 🔐 JWT Authentication (Sign In / Sign Up)
- 👤 Personalized Dashboard Header (Displays Logged-in User)
- 📦 FIFO Inventory Cost Calculation
- ⚡ Real-Time Kafka Event Processing
- 📊 Live Inventory Dashboard
- 📜 Transaction Ledger
- 🧾 FIFO Audit Trail (`sale_batch_details`)
- 📈 Product Stock Overview
- 💰 Average Cost & Inventory Value Calculation
- 🔄 Kafka Event Simulator
- 🛡️ Protected Routes using JWT Authentication
- 📱 Responsive UI
- 🏗️ Modular Backend Architecture

---

## 🛠️ Tech Stack

### Frontend
- React (Vite)
- Tailwind CSS
- React Router
- Axios

### Backend
- Node.js
- Express.js

### Database
- PostgreSQL (Neon)

### Messaging
- Apache Kafka (Aiven / Confluent / Redpanda)

### Authentication
- JWT
- bcrypt

---

## 🏗️ Project Architecture

This project follows a modular, production-ready architecture.

- **Controllers** → Handle HTTP requests & responses
- **Services** → Business logic (FIFO costing)
- **Repositories** → Database access layer
- **Middlewares** → JWT Authentication, Validation & Error Handling
- **Kafka Producer** → Publishes inventory events
- **Kafka Consumer** → Processes purchase/sale events asynchronously
- **PostgreSQL** → Stores inventory, sales, users & audit records

---

## 📁 Project Structure

```text
inventory-management-system/
│
├── backend/
│   ├── controllers/
│   ├── services/
│   ├── repositories/
│   ├── routes/
│   ├── middlewares/
│   ├── kafka/
│   ├── migrations/
│   ├── setup.sql
│   └── server.js
│
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── context/
│   │   ├── services/
│   │   └── App.jsx
│
└── README.md
```

---

# 📦 FIFO Costing Logic

The application uses the **First-In, First-Out (FIFO)** inventory costing method.

### Purchase Event

- Creates a new inventory batch.
- Stores quantity, unit price, and purchase timestamp.

### Sale Event

- Fetches the oldest available inventory batches.
- Consumes stock from the oldest batch first.
- Calculates the sale cost using FIFO.
- Updates remaining inventory.
- Stores an audit trail in the `sale_batch_details` table.

### Example

Purchase:

| Batch | Qty | Price |
|------|----:|------:|
| Batch A | 50 | ₹100 |
| Batch B | 30 | ₹120 |

Sale:

60 Units

FIFO Cost:

```
50 × 100 = 5000

10 × 120 = 1200

Total Cost = ₹6200
```

### Concurrency

To prevent race conditions, inventory batches are fetched using:

```
FOR UPDATE
```

ensuring safe concurrent inventory updates.

---

# 🔐 Authentication

The application includes JWT-based authentication.

Features:

- User Registration
- User Login
- Password Hashing using bcrypt
- Protected Dashboard
- JWT Authentication
- Logout
- Personalized Dashboard Header

---

# 🗄️ Database Tables

- users
- products
- inventory_batches
- sales
- sale_batch_details

---

# 📡 API Endpoints

## Authentication

```
POST /api/auth/register
```

```
POST /api/auth/login
```

---

## Inventory

```
GET /api/products
```

```
GET /api/transactions
```

```
POST /api/events/simulate
```

---

## Health Check

```
GET /health
```

---

# ⚙️ Environment Variables

Create a `.env` file inside the `backend` directory.

```env
DATABASE_URL=postgres://user:password@hostname/dbname?sslmode=require

PORT=3001

JWT_SECRET=your_jwt_secret

KAFKA_BROKERS=your-kafka-broker

KAFKA_SSL=true

KAFKA_SSL_CA_PATH=./ca.pem

KAFKA_SSL_CERT_PATH=./service.cert

KAFKA_SSL_KEY_PATH=./service.key

# Optional SASL

KAFKA_SASL_MECHANISM=scram-sha-256

KAFKA_USERNAME=your-username

KAFKA_PASSWORD=your-password
```

---

# 💻 Local Setup

## 1. Clone Repository

```bash
git clone https://github.com/yourusername/inventory-management-system.git

cd inventory-management-system
```

---

## 2. Backend Setup

```bash
cd backend

npm install
```

Run database migrations

```bash
npm run migrate
```

Seed admin user

```bash
npm run seed
```

Start API + Kafka Consumer

```bash
npm run dev:all
```

Verify API

```
http://localhost:3001/health
```

---

## 3. Frontend Setup

```bash
cd frontend

npm install

npm run dev
```

Open

```
http://localhost:5173
```

---

# 🚀 How to Use

1. Open the application.
2. Register a new account or log in using the demo credentials.
3. Access the Inventory Dashboard.
4. Click **Simulate Events**.
5. Kafka publishes inventory events.
6. Consumer processes purchase/sale events.
7. FIFO costing updates inventory.
8. Dashboard automatically refreshes with the latest data.

---

# 👤 Demo Credentials

Username:

```
admin
```

Password:

```
admin
```

---

# 📸 Screenshots

### Sign-UP Page

![Login](./frontend/src/assets/IMS-2.png)

---
### Login Page

![Login](./frontend/src/assets/IMS-1.png)

---
### Dashboard

![Dashboard](./frontend/src/assets/IMS-3.png)

---

# 🌐 Live Demo

Frontend

```
https://your-frontend-url
```

Backend

```
https://your-backend-url
```

Health Check

```
https://your-backend-url/health
```

---

# 🔮 Future Enhancements

- Role-Based Access Control (Admin/User)
- Inventory Search & Filters
- Export Transactions to CSV
- Inventory Analytics Dashboard
- Charts & Graphs
- Docker Support
- Kubernetes Deployment
- Email Notifications

---

# 📚 Learning Outcomes

This project demonstrates practical experience with:

- React.js
- Node.js
- Express.js
- PostgreSQL
- Apache Kafka
- JWT Authentication
- REST APIs
- FIFO Inventory Costing
- Database Transactions
- Concurrent Data Processing
- Clean Architecture
- Production-Ready Project Structure

---

# 👨‍💻 Author

**Virendra Sahu**

GitHub

https://github.com/virendrasahu

LinkedIn

https://www.linkedin.com/in/virendra-sahu-14117121a/

---

# 📄 License

This project was developed for learning, assessment, and portfolio purposes.
