<div align="center">

# 💸 PayFlow

**A fault-tolerant, distributed payment processing system with live payment tracing.**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-Replica%20Set-47A248?logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio)

</div>

---

## 📖 Overview

PayFlow shows how a real payment backend stays **correct under failure**.

The API accepts a payment, validates it and immediately returns `202 Accepted`. A **separate worker process** then moves the money via a Redis-backed **BullMQ** queue. Every transfer runs inside **one MongoDB transaction**, so wallets and ledger entries are never left half-updated. Idempotency keys prevent double charges, failed jobs retry with exponential backoff, and permanently failed payments land in a **dead-letter queue** that admins can replay.

Users watch each payment move through its lifecycle in **PayFlow Trace**, a live timeline with an automated integrity report.

## ✨ Features

| Area | What you get |
| --- | --- |
| **Architecture** | Producer (API) and consumer (worker) run as separate processes; scale and restart workers independently |
| **Atomic transfers** | Conditional debit + credit + two ledger rows + payment status commit together or not at all |
| **Idempotency** | Unique `(senderId, idempotencyKey)` index; same key + same payload returns the original payment, a different payload returns `409` |
| **Resilience** | Exponential-backoff retries, non-retryable error classification, orphaned-payment recovery sweep, worker heartbeats |
| **Admin tools** | Queue and worker telemetry, dead-letter queue + replay, audit log, logged wallet adjustments, one-shot fault injection |
| **Live updates** | Worker → Redis pub/sub → API → Socket.IO, delivered only to the sender, recipient and admins |
| **PayFlow Trace** | Event timeline built from the audit log + integrity checks (no duplicate debit, atomic wallet update, idempotency enforced) |
| **Security** | JWT auth, role-based access, `helmet`, rate limiting, input validation, JWT-authenticated sockets |

## 🏛️ Architecture

```
React (Vite + Tailwind + Socket.IO client)
      │  REST + JWT                         ▲ payment_status  (rooms: user:<id>, admin)
      ▼                                     │
Express API  :5000 ───subscribe───► Redis pub/sub ◄───publish─── Payment Worker(s)
      │                                                                ▲
      │  validate + idempotency check                                  │ claims job
      │  create Payment(QUEUED) + PaymentJob                           │
      └──────────────► BullMQ queue "payment-processing" (Redis) ──────┘
                                                                       │
MongoDB: users · wallets · payments · payment_jobs · transactions ◄────┘
         audit_logs · worker_heartbeats · system_configs      (one atomic transaction)
```

**Payment lifecycle:** `REQUESTED → QUEUED → WORKER_CLAIMED → PROCESSING → (WORKER_FAILURE → RETRY_SCHEDULED →) SUCCESS | FAILED`

**Recovery:** a reconciler in the worker (every 30 s) re-enqueues payments stuck in `QUEUED` with no live job, for example if the API crashed between the database insert and the queue add.

## 🧰 Tech Stack

- **Backend:** Node.js, Express, Mongoose, BullMQ, ioredis, Socket.IO, JWT, bcryptjs, helmet, express-rate-limit
- **Frontend:** React 18, React Router, Vite, Tailwind CSS, Axios, Lucide icons
- **Infra:** MongoDB 7 (single-node replica set), Redis 7, Docker Compose, GitHub Actions

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** (`node -v`)
- **Docker Desktop**, running (provides MongoDB and Redis). No Docker? See [Running without Docker](#running-without-docker).

> MongoDB **must** be a replica set (or Atlas). Transactions don't work on a standalone server, and the API exits with a clear message if it detects one.

### 1. Start MongoDB + Redis

```bash
npm run infra:up
docker compose ps        # wait until mongo and redis show "healthy" (~15 s)
```

### 2. Configure the server

```bash
cp server/.env.example server/.env          # Windows CMD: copy server\.env.example server\.env
```

Generate a `JWT_SECRET` and write it into `server/.env` (works on macOS, Linux and Windows):

```bash
node -e "const fs=require('fs');const s=require('crypto').randomBytes(48).toString('hex');let t=fs.readFileSync('server/.env','utf8');fs.writeFileSync('server/.env',t.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+s))"
```

Verify it was written (should print `96`):

```bash
node -e "require('dotenv').config({path:'server/.env'});console.log((process.env.JWT_SECRET||'').length)"
```

Optional client config (leave `VITE_API_ORIGIN` empty in development):

```bash
cp client/.env.example client/.env
```

### 3. Install, seed and run

```bash
npm run install:all     # root + server + client dependencies
npm run seed            # resets MongoDB collections AND the Redis queue
npm run dev             # API + worker + client together
```

Open **http://localhost:5173**.

You should see these lines in the terminal:

```
MongoDB transactions supported (replica set "rs0").
🚀 PayFlow API Server listening on port 5000
Ready and actively listening for BullMQ jobs...
```

Prefer separate terminals? Run each from the project root:

```bash
npm run server          # terminal 1: API
npm run worker          # terminal 2: payment worker
npm run client          # terminal 3: React app
```

### Demo accounts

Created by `npm run seed` (local demos only):

| Role | Email | Password | Starting balance |
| --- | --- | --- | --- |
| Admin | `admin@payflow.com` | `Admin@123` | $10,000 |
| Alice | `alice@payflow.com` | `User@123` | $1,000 |
| Bob | `bob@payflow.com` | `User@123` | $0 |

### Running without Docker

1. Create a free **MongoDB Atlas** cluster and set `MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/payflow?retryWrites=true&w=majority` in `server/.env`.
2. Create a free **Upstash** (or any) Redis database and set `REDIS_URL=rediss://default:<password>@<host>:6379`.
3. Skip step 1 above and continue from step 2.

---

## 🎬 Try it

1. **Happy path:** log in as Alice → **Send** → pay Bob $50 → **View Trace**. Status moves QUEUED → PROCESSING → SUCCESS over ~5 s, with the integrity report passing.
2. **Retry:** log in as Admin → turn on the **fault simulation** toggle → send another payment. The first attempt fails, a retry is scheduled with backoff, and the second attempt succeeds.
3. **Idempotency:** submit the same idempotency key twice. Only one payment executes.
4. **Dead-letter queue:** send more than the sender's balance. It fails permanently with no retries, appears in the admin **DLQ** panel, and can be replayed after topping up the wallet via a wallet adjustment.

---

## ⚙️ Configuration

All server settings live in `server/.env` (template: `server/.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | *(required)* | Replica-set / Atlas connection string |
| `JWT_SECRET` | *(required, ≥ 16 chars)* | Signs tokens; the server exits if missing |
| `CLIENT_URL` | `http://localhost:5173` | CORS + Socket.IO origin |
| `PORT` | `5000` | API port |
| `REDIS_URL` *or* `REDIS_HOST` / `PORT` / `USERNAME` / `PASSWORD` | `127.0.0.1:6379` | BullMQ queue + pub/sub |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker |
| `WORKER_HEARTBEAT_INTERVAL` / `WORKER_HEARTBEAT_TIMEOUT` | `2000` / `6000` ms | Worker liveness |
| `RECONCILE_INTERVAL_MS` | `30000` | Orphaned-payment sweep |
| `MAX_JOB_ATTEMPTS` / `RETRY_BACKOFF_DELAY_MS` | `3` / `2000` | Retries at 2 s, 4 s, … |
| `DEMO_PROCESSING_DELAY_MS` | `5000` | Visible processing delay (adjustable live by admins) |
| `SIMULATE_ONE_FAILURE` | `false` | Initial value of the one-shot failure demo flag |
| `MAX_PAYMENT_AMOUNT` | `100000` | Per-payment cap |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `600`/min, `30`/15 min | API and login/register limits |

Client setting (`client/.env`): `VITE_API_ORIGIN` is only needed when the API runs on a different origin.

---

## 📑 API Reference

Base URL: `http://localhost:5000/api` · Auth: `Authorization: Bearer <jwt>`

### Public
| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | MongoDB / Redis / worker health |
| POST | `/auth/register` | Register and auto-create a $0 wallet |
| POST | `/auth/login` | Returns a JWT |

### User
| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/auth/me` | Current user and wallet |
| GET | `/users/recipients` | Eligible recipients (no balances exposed) |
| GET | `/wallet` | Wallet balance |
| GET | `/wallet/transactions` | Ledger history |
| POST | `/payments` | Enqueue a payment. `202` accepted · `200` duplicate · `409` key reused with different payload · `503` queue down |
| GET | `/payments` | History (`page`, `limit` ≤ 100, `status`, `search` = payment id) |
| GET | `/payments/:id` | Payment details |
| GET | `/payments/:id/trace` | Execution timeline and integrity report |

`POST /payments` body: `{ "recipientId": "<user id or email>", "amount": 50, "idempotencyKey": "KEY-123" }`

### Admin
| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/admin/stats` · `/queue-health` · `/workers` · `/users` · `/payments` | Telemetry |
| GET | `/admin/audit-logs` | Audit feed (`action`, `limit` ≤ 500) |
| GET | `/admin/dlq` | Dead-letter jobs |
| POST | `/admin/payments/:id/replay` | Replay a `FAILED` payment (alias: `/admin/dlq/:id/replay`) |
| GET / POST | `/admin/config` | Demo delay and one-shot failure flag |
| POST | `/admin/toggle-fault` | Toggle the one-shot fault (alias: `/admin/simulate-failure`) |
| POST | `/admin/wallet-adjustment` | Logged balance adjustment |

**Socket.IO:** connect with `auth: { token }`. The server emits `payment_status` to the sender, the recipient and admins.

---

## 🗂️ Project Structure

```
PayFlow/
├── docker-compose.yml          # MongoDB replica set + Redis
├── package.json                # root scripts (dev, seed, test, infra:up, ...)
├── .github/workflows/ci.yml    # server tests + client build
├── server/
│   ├── .env.example
│   ├── test/                   # unit tests (node:test)
│   └── src/
│       ├── app.js              # Express app, middleware, health check
│       ├── server.js           # HTTP + Socket.IO + Redis subscriber
│       ├── worker.js           # worker process entry
│       ├── config/             # db.js (replica-set check), redis.js (+ pub/sub)
│       ├── controllers/        # auth, payment, wallet, admin
│       ├── middleware/         # JWT auth, requireAdmin
│       ├── models/             # User, Wallet, Payment, PaymentJob, Transaction,
│       │                       # AuditLog, WorkerHeartbeat, SystemConfig
│       ├── queue/              # BullMQ queue, DLQ, replay, reconciler
│       ├── routes/
│       ├── scripts/            # seed.js, check-db.js
│       ├── utils/              # errors.js, validation.js, realtime.js
│       └── workers/            # paymentWorker.js
└── client/
    ├── .env.example
    ├── vite.config.js          # dev proxy for /api and /socket.io
    └── src/
        ├── pages/              # Dashboard, Send, History, Details, Trace, Admin, Audit, Wallet, Login/Register
        ├── components/         # Navbar, Sidebar, StatusBadge
        ├── context/            # AuthContext
        ├── hooks/              # usePaymentEvents (socket)
        └── services/           # api.js, socket.js
```

## 🧪 Testing

```bash
npm test                              # server unit tests: validation + failure classification
npm run build                         # production build of the client
npm run check:db --prefix server      # verify MongoDB connection and transaction support
```

CI (`.github/workflows/ci.yml`) runs the server tests and the client build on every push.

---

## 🛠️ Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `vite http proxy error ... ECONNREFUSED` | The **API isn't running**. Run `npm run server` and read the error it prints; it is the real cause. |
| `JWT_SECRET is missing or too short` | `server/.env` doesn't exist or `JWT_SECRET=` is blank. Repeat [step 2](#2-configure-the-server). |
| `MONGO_URI is not defined` | The file must be at `server/.env`, not the project root or `.env.example`. |
| `MongoDB is running standalone...` | Use the `MONGO_URI` from `.env.example` (it includes `replicaSet=rs0&directConnection=true`) or Atlas. |
| `Server selection timed out` / Mongo `ECONNREFUSED` | MongoDB isn't up. Run `docker compose ps` (Docker Desktop must be running), then `npm run infra:up`. |
| Port `27017` / `6379` already in use | Stop your local MongoDB/Redis, or `npm run infra:down` and retry. |
| Payments stay `QUEUED` | The worker isn't running. Check `/api/health` (`"worker":"online"`) and start `npm run worker`. |
| Everything is stale after a crash | `npm run seed` resets MongoDB and the Redis queue. |

Stop everything with `Ctrl+C`, then `npm run infra:down`.

## ⚠️ Known Limitations

- Money is stored as JS numbers rounded to cents. Real systems should use integer minor units or `Decimal128`.
- JWTs last 7 days and are kept in `localStorage`; there are no refresh tokens.
- Single currency (USD); no KYC, email or webhooks.
- No end-to-end tests against live MongoDB/Redis yet.

## 📄 License

Add a license of your choice (e.g. MIT) before publishing.
