# 📦 Inventory Management System (FIFO)

A production-ready **Inventory Management System** built for a small trading business using the **FIFO (First-In, First-Out)** inventory costing method. The application processes purchase and sale events through **Apache Kafka**, stores inventory in **PostgreSQL**, and provides a responsive **React Dashboard** for monitoring inventory, transaction history, and stock valuation.

---

## 🚀 Live Demo

### Frontend
[https://inventory-management-system-ebon-beta.vercel.app/](https://inventory-management-system-ebon-beta.vercel.app/)

### Backend API
[https://inventory-management-system-191s.onrender.com](https://inventory-management-system-191s.onrender.com)

### Health Check
[https://inventory-management-system-191s.onrender.com/health](https://inventory-management-system-191s.onrender.com/health)

---

## 📂 GitHub Repository

[https://github.com/YOUR_USERNAME/YOUR_REPOSITORY](https://github.com/virendrasahu/Inventory-Management-System)

---

# ✨ Features

- 🔐 JWT Authentication (Sign Up / Sign In)
- 👤 Personalized Dashboard (Displays Logged-in User)
- 📦 FIFO Inventory Costing Algorithm
- ⚡ Apache Kafka Event Processing
- 📊 Real-Time Inventory Dashboard
- 📜 Transaction Ledger
- 🧾 FIFO Audit Trail
- 📈 Stock Overview
- 💰 Inventory Value Calculation
- 🔄 Simulate Inventory Events
- 🛡️ Protected REST APIs
- 📱 Fully Responsive UI
- 🏗️ Modular Backend Architecture

---

# 🛠️ Tech Stack

## Frontend

- React (Vite)
- Tailwind CSS
- React Router
- Axios

## Backend

- Node.js
- Express.js

## Database

- PostgreSQL (Neon)

## Messaging

- Apache Kafka

## Authentication

- JWT
- bcrypt

## Deployment

- Vercel (Frontend)
- Render (Backend)

---

# 🏗️ Architecture

```
React Frontend
        │
        ▼
Express REST API
        │
        ▼
JWT Authentication
        │
        ▼
Kafka Producer
        │
        ▼
Kafka Topic
        │
        ▼
Kafka Consumer
        │
        ▼
PostgreSQL Database
        │
        ▼
Inventory Dashboard
```

---

# 📁 Project Structure

```
inventory-management-system/

├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── routes/
│   │   ├── validators/
│   │   ├── middlewares/
│   │   ├── kafka/
│   │   └── utils/
│   ├── setup.sql
│   ├── server.js
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

---

# 📦 FIFO Inventory Logic

## Purchase

- Creates a new inventory batch
- Stores purchase quantity
- Stores unit price
- Stores purchase timestamp

## Sale

- Reads the oldest inventory batch first
- Deducts stock using FIFO
- Calculates inventory cost
- Updates remaining stock
- Stores complete audit trail

### Example

| Batch | Quantity | Price |
|--------|---------:|------:|
| Batch A | 50 | ₹100 |
| Batch B | 30 | ₹120 |

Sale Quantity

```
60 Units
```

FIFO Cost

```
50 × 100 = 5000

10 × 120 = 1200

Total Cost = ₹6200
```

Database locking uses

```
FOR UPDATE
```

to safely process concurrent inventory transactions.

---

# 🔐 Authentication

The application uses JWT Authentication.

Features

- User Registration
- User Login
- Password Hashing using bcrypt
- JWT Token Generation
- Protected Dashboard
- Protected APIs
- Logout
- Personalized Welcome Header

---

# 🗄️ Database Tables

- users
- products
- inventory_batches
- sales
- sale_batch_details
- transaction_ledger (View)

---

# 📡 API Endpoints

## Health Check

```
GET /health
```

---

## Authentication

```
POST /api/auth/register

POST /api/auth/login
```

---

## Inventory APIs

```
GET /api/stock

GET /api/ledger

POST /api/event

POST /api/simulate
```

---

# ⚙️ Environment Variables

Create a `.env` file inside the backend folder.

```env
DATABASE_URL=postgres://user:password@hostname/dbname?sslmode=require

PORT=3001

JWT_SECRET=your_jwt_secret

KAFKA_BROKERS=your_kafka_broker

KAFKA_SSL=true

KAFKA_SSL_CA_PATH=./ca.pem

KAFKA_SSL_CERT_PATH=./service.cert

KAFKA_SSL_KEY_PATH=./service.key

KAFKA_SASL_MECHANISM=scram-sha-256

KAFKA_USERNAME=your_username

KAFKA_PASSWORD=your_password
```

---

# 💻 Local Setup

## Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git

cd inventory-management-system
```

---

## Backend

```bash
cd backend

npm install

npm run migrate

npm run seed

npm run dev:all
```

Health Check

```
http://localhost:3001/health
```

---

## Frontend

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

1. Register a new account or login.
2. Open the Inventory Dashboard.
3. View inventory overview.
4. Click **Simulate Events**.
5. Kafka publishes inventory events.
6. Kafka Consumer processes purchase and sale events.
7. FIFO costing updates inventory.
8. Dashboard refreshes automatically.

---

# 👤 Demo Credentials

Username

```
admin
```

Password

```
admin
```

---

# 📸 Screenshots

## Sign Up

![Signup](./frontend/src/assets/IMS-2.png)

---

## Login

![Login](./frontend/src/assets/IMS-1.png)

---

## Dashboard

![Dashboard](./frontend/src/assets/IMS-3.png)

---

# 🧪 Backend API Testing

A complete Postman testing guide is included in this repository.

```
Inventory_Management_System_Interviewer_Guide.pdf
```

The guide contains:

- Step-by-step API testing
- Copy-paste URLs
- Ready-to-use JSON payloads
- JWT Authentication flow
- Expected API responses

---

# 🚀 Future Enhancements

- Role-Based Access Control
- Product CRUD
- Search & Filtering
- Dashboard Charts
- CSV Export
- Docker Support
- GitHub Actions CI/CD
- Kubernetes Deployment

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
- Event-Driven Architecture
- Database Transactions
- Concurrent Data Processing
- Production-Ready Backend Design
- Cloud Deployment

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
