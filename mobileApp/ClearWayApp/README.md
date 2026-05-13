# ClearWay Data — Mobile App

React Native / Expo application for road width measurement data collection.

The app connects to an ESP32 ultrasonic sensor over BLE (or generates simulated data in mock mode), records GPS position at 1 Hz, stores measurements locally in SQLite, and syncs them to the backend in the background.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | React Native 0.81, Expo 54 |
| Language | TypeScript 5.9 |
| Navigation | React Navigation 7 (native stack) |
| Local storage | expo-sqlite (SQLite) |
| Auth token | expo-secure-store |
| HTTP | fetch (via `ApiService`) |
| GPS | expo-location |
| BLE | react-native-ble-plx (ESP32 sensor) |
| Async storage | @react-native-async-storage/async-storage |
| Testing | Jest 29 + jest-expo + @testing-library/react-native |

---

## Directory Structure

```
mobileApp/ClearWayApp/
├── App.tsx                          # AuthProvider, AppNavigator, Zombie Sync
├── index.ts                         # Expo entry point
├── screens/
│   ├── LoginScreen.tsx              # JWT login
│   ├── HomeScreen.tsx               # Session overview
│   ├── SetupScreen.tsx              # Vehicle width, mode selection (mock / BLE)
│   ├── MeasurementScreen.tsx        # Live measurement view
│   ├── SyncErrorsScreen.tsx         # Poison-pill error management
│   ├── AdminScreen.tsx              # Debug tools (DB stats, force sync, clear data)
│   └── BleDevicePickerScreen.tsx    # BLE device scanner
├── services/
│   ├── database.service.ts          # SQLite CRUD (local_measurements table)
│   ├── sync.service.ts              # Background sync (10 s interval), pub-sub
│   ├── api.service.ts               # HTTP client, poison-pill detection
│   ├── auth.service.ts              # JWT auth, token persistence
│   └── session-storage.service.ts  # Session state across app restarts
├── hooks/
│   ├── useLocation.ts               # GPS tracking (1 Hz, 1 m interval)
│   ├── useMeasurement.ts            # START/STOP orchestration, mock + BLE modes
│   ├── useSync.ts                   # Sync status + manual trigger
│   └── useBleScanner.ts             # BLE device discovery
├── config/
│   ├── api.config.ts                # HTTP timeout values
│   ├── sync.config.ts               # MAX_BATCH_SIZE (1500), SYNC_INTERVAL_MS (10 s)
│   ├── measurement.config.ts        # Mock ranges, width thresholds, default vehicle width
│   └── ui.config.ts                 # Design tokens (palette, spacing, font sizes)
├── __tests__/                       # Jest unit tests
└── .env                             # EXPO_PUBLIC_API_URL
```

---

## Running

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`) or use `npx expo`
- Expo Go app on the test device, **or** Android/iOS simulator

### Install and Start

```bash
cd mobileApp/ClearWayApp

npm install

# Copy and fill in the API URL
cp .env.example .env

npm start
# Scan the QR code with Expo Go, or press a (Android) / i (iOS) / w (web)
```

> Use the server's real IP or a public URL in `EXPO_PUBLIC_API_URL` — `localhost` is not reachable from a physical device.

### Platform-Specific Start

```bash
npm run android   # Android emulator or connected device
npm run ios       # iOS simulator (macOS only)
npm run web       # Browser (limited BLE support)
```

---

## Data Flow

```
BLE sensor (ESP32) / Mock data generator
            │
    useMeasurement hook  ←──── useLocation (2 Hz GPS)
            │
    DatabaseService.insertMeasurement()
            │
        SQLite  local_measurements  (synced = 0)
            │
    SyncService  (background, every 60 s)
            │
    ApiService.sendBatch()
            │  POST /api/v1/measurements/raw-data/batch
            ▼
        Backend API
            │
    DatabaseService.deleteMeasurements()  (garbage collected on 2xx)
```

### Sync Error Handling

| HTTP status | `synced` value | Behaviour |
|-------------|----------------|-----------|
| 2xx | deleted | Record removed after successful sync |
| 5xx / network error | `0` | Retried on next cycle |
| 4xx (poison pill) | `-1` | No automatic retry — user resolves via `SyncErrorsScreen` |

---

## Authentication

JWT token flow:
1. `LoginScreen` → `POST /api/v1/auth/login` → JWT stored in `expo-secure-store` under key `auth_token`
2. Every `ApiService` request attaches `Authorization: Bearer <token>`
3. On `401` response → automatic logout and redirect to `LoginScreen`
4. On app restart, token is restored from secure store and validated

---

## BLE Sensor Protocol

The app communicates with an **ESP32** ultrasonic sensor (HC-SR04 × 2) over BLE.

Data frames begin with a single-byte command byte:
- `0xAA` — measurement data (distance_left, distance_right)
- `0x2A` — heartbeat
- `0x3E` — command response

BLE UUIDs and the full command protocol are documented in `AI_kontext.md`.

### Mock Mode

Select **mock mode** on `SetupScreen` to run without hardware. Data is generated using configurable ranges from `config/measurement.config.ts`.

---

## SQLite Schema

Table: `local_measurements`

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT | UUID of the measurement session |
| latitude / longitude | REAL | GPS coordinates |
| distance_left / distance_right | REAL | Sensor readings (m) |
| speed | REAL | GPS-derived speed (m/s) |
| accuracy_gps | REAL | GPS accuracy estimate (m) |
| measured_at | TEXT | ISO 8601 timestamp |
| synced | INTEGER | `0` pending · `-1` poison pill · deleted on success |
| error_message | TEXT | Populated on poison pill |
| error_at | TEXT | Timestamp of the error |

Indexed on `synced` and `session_id`.

---

## Tests

```bash
# Run all unit tests once
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Single test file
npx jest __tests__/services/SyncService.test.ts

# Filter by test name
npx jest --testNamePattern "syncOnce.*poison pill"
```

---

## Configuration

All constants are `as const` objects — edit the config files, not inline values.

| File | Controls |
|------|----------|
| `config/api.config.ts` | HTTP timeouts |
| `config/sync.config.ts` | `MAX_BATCH_SIZE` (1500), `SYNC_INTERVAL_MS` (50 000 ms), `RETRY_DELAY_MS` |
| `config/measurement.config.ts` | Mock simulation ranges, width thresholds (green ≥ 3.5 m, yellow ≥ 3.0 m, red < 3.0 m), default vehicle width |
| `config/ui.config.ts` | Design tokens — palette, spacing, font sizes, border radii |

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | Backend API base URL | `https://api-mobile.clearway.zephyron.tech` |

> After changing `.env`, restart the Expo dev server.
