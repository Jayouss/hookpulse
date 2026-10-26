<div align="center">

# ⚡ HookPulse
### Resilient Webhook Relay & Event Delivery Engine

[![CI Pipeline](https://github.com/Jayouss/hookpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayouss/hookpulse/actions)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000.svg?logo=express&logoColor=white)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  A high-throughput, enterprise-grade webhook delivery platform featuring <b>HMAC-SHA256 signatures</b>, <b>exponential backoff retries with jitter</b>, <b>idempotency key deduplication</b>, and a <b>Dead Letter Queue (DLQ) with instant manual replay</b>.
</p>

[Architecture](#-system-architecture) • [Key Features](#-key-engineering-highlights) • [Quickstart](#-quickstart) • [Interactive Demo](#-interactive-demo) • [API Reference](#-api-endpoints)

</div>

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    Producer["Event Producer (API / SaaS)"] -->|POST /api/v1/events/publish| Gateway["HookPulse Ingestion Gateway"]

    subgraph "Ingestion & Security Layer"
        Gateway --> Idempotency{"Idempotency Check"}
        Idempotency -->|Duplicate Key| ReturnCached["Return Cached Event (200 OK)"]
        Idempotency -->|New Key| Signer["HMAC-SHA256 Signer"]
    end

    Signer --> Queue["Priority Task Queue (In-Memory / Redis)"]

    subgraph "Delivery & Resiliency Worker"
        Queue --> Dispatcher["HTTP Dispatcher"]
        Dispatcher -->|POST with X-HookPulse-Signature| Destination["Destination Server"]
        
        Destination -->|2xx Success| Delivered[("Status: DELIVERED")]
        Destination -->|5xx / Timeout / 429| BackoffEval{"Attempts < Max?"}
        
        BackoffEval -->|Yes| RetryCalc["Calculate Exponential Backoff + Jitter"]
        RetryCalc -->|Delay Schedule| Queue
        BackoffEval -->|No (Exhausted)| DLQ[("Dead Letter Queue (DLQ)")]
    end

    Admin["Engineer / Dashboard"] -->|POST /api/v1/events/:id/replay| DLQ
    DLQ -->|Replay Trigger| Queue
```

---

## ⚡ Key Engineering Highlights

* **Exponential Backoff with Jitter**: Prevents the "Thundering Herd" problem when client servers recover from outages. Automatically scales delay intervals ($Delay = \min(Initial \times 2.0^{attempt-1}, Max) + Jitter$).
* **Cryptographic HMAC-SHA256 Signatures**: Generates industry-standard signature headers (`X-HookPulse-Signature: t={timestamp},v1={hash}`) using constant-time comparison (`timingSafeEqual`) to prevent timing attacks and payload tampering.
* **Idempotency Key Deduplication**: Enforces strict `Idempotency-Key` headers on incoming event publishing to ensure duplicate network retries do not trigger redundant downstream webhooks.
* **Dead Letter Queue (DLQ) & Manual Replay**: Events that exhaust all retry attempts are safely partitioned into the Dead Letter Queue for audit inspection and one-click programmatic replay (`POST /api/v1/events/:id/replay`).
* **Zero-Friction Local Execution**: Runs with zero external dependencies out of the box using high-performance in-memory queues and stores, or scales horizontally with Redis and Docker Compose.

---

## 🚀 Quickstart

### 1. Clone & Install
```bash
git clone https://github.com/Jayouss/hookpulse.git
cd hookpulse

npm install
npm run build
```

### 2. Run Locally
```bash
npm start
```
* Server running on: `http://localhost:4000`
* Health check: `http://localhost:4000/health`

---

## 🧪 Interactive Resilience Demo

HookPulse comes with an end-to-end simulation script that spins up a mock receiver that fails twice with `500 Internal Server Error` and `503 Service Unavailable`, then recovers on the 3rd attempt:

```bash
# Terminal 1: Start HookPulse
npm start

# Terminal 2: Run Demo Simulation
node scripts/demo.js
```

### Sample Output:
```text
======================================================================
>> STEP 1: PUBLISHING EVENT WITH IDEMPOTENCY KEY
======================================================================
[Event Enqueued] ID: b748d5f3-c599-4b1a-9694-df7eb6ad1152
[Status]: PENDING | Max Attempts: 4

======================================================================
>> STEP 2: TESTING IDEMPOTENCY PROTECTION
======================================================================
[Idempotency Result]: Idempotent request: Event already queued or processed.

======================================================================
>> STEP 3: MONITORING EXPONENTIAL BACKOFF PROGRESSION
======================================================================
  [Mock Receiver] Incoming Webhook Attempt #1
  [Mock Receiver] 💥 Simulating 500 Internal Server Error
  [Dispatcher] Event failed (attempt 1/4). Retrying in 1084ms.

  [Mock Receiver] Incoming Webhook Attempt #2
  [Mock Receiver] 💥 Simulating 503 Service Unavailable
  [Dispatcher] Event failed (attempt 2/4). Retrying in 2147ms.

  [Mock Receiver] Incoming Webhook Attempt #3
  [Mock Receiver] ✅ Success! Returning 200 OK
  [Dispatcher] Event successfully delivered on attempt 3.

======================================================================
>> STEP 4: DELIVERY AUDIT TRAIL
======================================================================
Final Status: DELIVERED
Total Attempts: 3
Audit Logs:
  - Attempt #1: Status 500 | Latency: 12ms | Success: false | Error: HTTP error: Received status 500
  - Attempt #2: Status 503 | Latency: 8ms  | Success: false | Error: HTTP error: Received status 503
  - Attempt #3: Status 200 | Latency: 6ms  | Success: true  | Error: None
```

---

## 📡 API Endpoints

All administrative requests require header:  
`x-api-key: hp_live_master_key_secret_2026`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/events/publish` | Ingest and enqueue event for delivery with optional idempotency key. |
| `GET` | `/api/v1/events` | List events with optional filter (`?status=DEAD_LETTER` or `DELIVERED`). |
| `GET` | `/api/v1/events/:id` | Retrieve full delivery history, payload, and retry attempts for an event. |
| `POST` | `/api/v1/events/:id/replay` | Reset attempt counters and immediately re-enqueue a DLQ/failed event. |
| `POST` | `/api/v1/verify` | Cryptographic signature verification helper for client endpoints. |
| `GET` | `/api/v1/metrics` | System telemetry: delivery success rate, queue depth, and status counts. |
| `GET` | `/health` | Server health check. |

---

## 🧪 Testing & CI

```bash
# Run unit tests
npm test
```

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
