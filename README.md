# CritMon Watchdog Sentinel (Pulse-Check API)

A stateful, production-grade Dead Man's Switch backend service built using NestJS, Prisma, and PostgreSQL. It monitors remote devices (e.g., solar farms, weather stations) that send timely heartbeats. If a device fails to ping before its custom timer expires, the sentinel automatically triggers an alert, logs the outage, and tracks it as an incident.

---

## 1. Architecture Design

The sentinel leverages a hybrid stateful architecture:
*   **Database Persistence (PostgreSQL + Prisma)**: Ensures that monitor settings, last ping timestamps, expiration schedules, and incident history are stored durably.
*   **Active In-Memory Timers (`NodeJS.Timeout`)**: Provides precise, millisecond-level alerting without polling loops.
*   **Startup Recovery**: On server startup, the application queries all active monitors, transitions any that expired during downtime to `DOWN` (triggering alerts), and reschedules active timers for the remaining duration.

### Sequence Diagrams

#### Registering a Monitor (`POST /monitors`)
```mermaid
sequenceDiagram
    autonumber
    actor Client as Device Admin
    participant API as MonitorsController
    participant Svc as WatchdogService
    participant DB as PostgreSQL (Prisma)
    
    Client->>API: POST /monitors {id, timeout, alert_email}
    API->>Svc: registerMonitor(id, timeout, alert_email)
    Svc->>DB: Upsert Monitor (status="OK", last_ping=now, expires_at=now+timeout)
    Svc->>Svc: Clear existing timer if any
    Svc->>Svc: Start active in-memory timer (setTimeout)
    Svc->>API: Return monitor info
    API->>Client: 201 Created
```

#### Heartbeat Reset (`POST /monitors/{id}/heartbeat`)
```mermaid
sequenceDiagram
    autonumber
    actor Client as Remote Device
    participant API as MonitorsController
    participant Svc as WatchdogService
    participant DB as PostgreSQL (Prisma)
    
    Client->>API: POST /monitors/{id}/heartbeat
    API->>Svc: pingMonitor(id)
    Svc->>DB: Find unique Monitor
    alt Monitor not found
        Svc->>API: Return null
        API->>Client: 404 Not Found
    else Monitor found
        Svc->>DB: Update Monitor (status="OK", last_ping=now, expires_at=now+timeout)
        opt Monitor was DOWN
            Svc->>DB: Resolve active incidents (set resolved_at = now)
        end
        Svc->>Svc: Clear existing timer
        Svc->>Svc: Start new active timer (setTimeout)
        Svc->>API: Return updated monitor
        API->>Client: 200 OK
    end
```

#### Downtime / Outage Detection (Watchdog Expiration Trigger)
```mermaid
sequenceDiagram
    autonumber
    participant Timer as NodeJS Timeout
    participant Svc as WatchdogService
    participant DB as PostgreSQL (Prisma)
    
    Timer->>Svc: Trigger timeout callback
    Svc->>DB: Check monitor status in DB
    alt Monitor status is "OK" and expired
        Svc->>DB: Update Monitor status to "DOWN"
        Svc->>DB: Create new active Incident
        Svc->>Svc: Log ALERT JSON to console
    end
```

#### Maintenance Snooze (`POST /monitors/{id}/pause`)
```mermaid
sequenceDiagram
    autonumber
    actor Tech as Maintenance Tech
    participant API as MonitorsController
    participant Svc as WatchdogService
    participant DB as PostgreSQL (Prisma)
    
    Tech->>API: POST /monitors/{id}/pause
    API->>Svc: pauseMonitor(id)
    Svc->>DB: Find Monitor
    alt Monitor not found
        Svc->>API: Return null
        API->>Tech: 404 Not Found
    else Monitor found
        Svc->>DB: Update Monitor (status="PAUSED")
        Svc->>Svc: Clear active in-memory timer
        Svc->>API: Return updated monitor
        API->>Tech: 200 OK
    end
```

---

## 2. API Endpoints Reference

### 1. Register a Monitor
Creates a new monitor or updates an existing one, and starts/resets the countdown timer.

*   **URL**: `/monitors`
*   **Method**: `POST`
*   **Request Body**:
    ```json
    {
      "id": "device-123",
      "timeout": 60,
      "alert_email": "admin@critmon.com"
    }
    ```
*   **Response Code**: `201 Created`
*   **Response Body**:
    ```json
    {
      "message": "Monitor for device 'device-123' registered successfully. Countdown set to 60 seconds.",
      "monitor": {
        "id": "device-123",
        "timeout": 60,
        "alertEmail": "admin@critmon.com",
        "status": "OK",
        "lastPingAt": "2026-07-05T13:54:00.000Z",
        "expiresAt": "2026-07-05T13:55:00.000Z",
        "createdAt": "2026-07-05T13:54:00.000Z",
        "updatedAt": "2026-07-05T13:54:00.000Z"
      }
    }
    ```

### 2. Device Heartbeat (Reset)
Resets the countdown timer for a device. If the device was previously in the `DOWN` status, it transitions back to `OK` and automatically resolves the open incident. If the monitor was `PAUSED`, it automatically unpauses it and starts the timer.

*   **URL**: `/monitors/:id/heartbeat`
*   **Method**: `POST`
*   **Response Code**: `200 OK`
*   **Response Body**:
    ```json
    {
      "message": "Heartbeat received. Timer for device 'device-123' reset.",
      "monitor": {
        "id": "device-123",
        "timeout": 60,
        "alertEmail": "admin@critmon.com",
        "status": "OK",
        "lastPingAt": "2026-07-05T13:54:30.000Z",
        "expiresAt": "2026-07-05T13:55:30.000Z"
      }
    }
    ```
*   **Error Response (404 Not Found)**:
    ```json
    {
      "statusCode": 404,
      "message": "Monitor with ID 'unknown-device' not found",
      "error": "Not Found"
    }
    ```

### 3. Pause Monitor (Snooze Button)
Temporarily pauses a monitor for maintenance. Clears active timers and prevents alerts from firing.

*   **URL**: `/monitors/:id/pause`
*   **Method**: `POST`
*   **Response Code**: `200 OK`
*   **Response Body**:
    ```json
    {
      "message": "Monitor for device 'device-123' paused successfully. Alerts are disabled.",
      "monitor": {
        "id": "device-123",
        "timeout": 60,
        "alertEmail": "admin@critmon.com",
        "status": "PAUSED"
      }
    }
    ```

### 4. Fetch All Monitors (Admin View)
Returns all monitors and their status along with their 5 most recent incident records.

*   **URL**: `/monitors`
*   **Method**: `GET`
*   **Response Code**: `200 OK`
*   **Response Body**:
    ```json
    {
      "count": 1,
      "monitors": [
        {
          "id": "device-123",
          "timeout": 60,
          "alertEmail": "admin@critmon.com",
          "status": "DOWN",
          "lastPingAt": "2026-07-05T13:54:00.000Z",
          "expiresAt": "2026-07-05T13:55:00.000Z",
          "incidents": [
            {
              "id": "cuid-xyz",
              "monitorId": "device-123",
              "firedAt": "2026-07-05T13:55:00.000Z",
              "resolvedAt": null
            }
          ]
        }
      ]
    }
    ```

### 5. Server Health Check
Exposes basic diagnostics for monitoring systems, reporting uptime, database availability, and system memory.

*   **URL**: `/health`
*   **Method**: `GET`
*   **Response Code**: `200 OK` (or `503 Service Unavailable` if database is down)
*   **Response Body**:
    ```json
    {
      "status": "OK",
      "timestamp": "2026-07-05T13:56:00.000Z",
      "uptimeSeconds": 120,
      "uptimeFormatted": "2m 0s",
      "services": {
        "database": {
          "status": "UP"
        }
      },
      "system": {
        "memory": {
          "rss": "54 MB",
          "heapTotal": "22 MB",
          "heapUsed": "12 MB"
        }
      }
    }
    ```

---

## 3. Developer's Choice: Extra Features

To make this sentinel production-ready, I implemented the following robustness additions:

### 1. In-Memory Rescheduling with Startup DB Recovery
Unlike simple in-memory APIs that lose all state on a restart, this service utilizes a persistent database to store the state of all devices. On startup, `WatchdogService` runs an initialization hook:
*   It calculates the remaining time for all `OK` devices: `remainingTime = expiresAt - now`.
*   If `remainingTime > 0`, it reschedules the in-memory `setTimeout` timer.
*   If `remainingTime <= 0` (meaning the device went offline while the server was restarting/down), it transitions the status to `DOWN` and immediately triggers the console alert and incident log.

### 2. Incident Log Tracking & Auto-Resolution
Logging alerts to the console is great for debugging, but in a real monitoring system, administrators need historical data to compute SLA metrics (e.g., MTTR - Mean Time to Resolution).
*   When a device timer expires, an **Incident** record is created in the database with a `firedAt` timestamp.
*   When the device recovers and sends a heartbeat, the service automatically closes the incident by setting `resolvedAt = new Date()`.
*   This makes it easy to query active alerts vs. past resolve times.

---

## 4. Setup and Run Instructions

### Prerequisites
*   Node.js (v18+)
*   npm

### Installation
1. Install project dependencies:
   ```bash
   npm install
   ```

2. Setup Environment Variables:
   Create a `.env` file in the root directory (or use the existing one) containing:
   ```env
   DATABASE_URL="postgresql://neondb_owner:npg_dYHsnEo6vW0z@ep-rough-dust-ahz42sza-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
   PORT=3000
   ```

3. Sync Database schema:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

### Execution
*   **Development mode** (with hot reload):
    ```bash
    npm run start:dev
    ```
*   **Production build & run**:
    ```bash
    npm run build
    ```

### Verification (Testing)
To run the full E2E test suite:
```bash
npm run test:e2e
```
