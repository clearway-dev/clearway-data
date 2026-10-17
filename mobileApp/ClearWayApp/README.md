# ClearWay Data — Mobile App

React Native / Expo application for road width measurement data collection.

The app connects to the ClearWay measuring unit (ESP32, Benewake lidars) over BLE (or generates simulated data in mock mode), records GPS position at 1 Hz, stores measurements locally in SQLite, and syncs them to the backend in the background.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | React Native 0.86, Expo 57 |
| Language | TypeScript 6.0 |
| Navigation | React Navigation 7 (native stack) |
| Local storage | expo-sqlite (SQLite) |
| Auth token | expo-secure-store |
| HTTP | fetch (via `ApiService`) |
| GPS | expo-location |
| BLE | react-native-ble-plx (native), Web Bluetooth (web) |
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

## BLE measuring unit ("měřák")

The app talks to the measuring unit (ESP32-S3 master + ESP32 slave, 4 Benewake lidars each) over
BLE. The authoritative protocol is `ClearWay-FW/specifikace-zarizeni.md`; the app implements
protocol 2 (firmware 4.0.0, per-sensor states) and protocol 1 (firmware up to 3.6). The parser is
checked frame by frame against the reference client `ClearWay-FW/client/meas_client.py` on frames
recorded from the real unit (`__tests__/fixtures/merak-frames.json`, `merakReference.test.ts`).

| What | Where |
|------|-------|
| Wire protocol (frames, replies, sensor states) | `services/merak/protocol.ts` |
| What is stored per sensor state | `services/merak/storage-policy.ts` |
| Console text of a frame | `services/merak/format.ts` |
| Command catalogue and readable results | `services/merak/commands.ts` |
| Live data, counters, event log | `services/merak/merak.store.ts` |
| Native transport (react-native-ble-plx) | `services/merak/transport.ts` |
| Web transport (Web Bluetooth, Chrome/Edge) | `services/merak/transport.web.ts` |
| Connection, command queue, measurement control | `contexts/BleContext.tsx` |
| Setup page: connect button, mode and firmware switch | `screens/MerakSetupScreen.tsx`, `components/merak/MerakConnectCard.tsx` (Home button "Nastavit měření") |
| All commands incl. service diagnostics | `screens/MerakServiceScreen.tsx` |
| All values of the unit during a measurement | `components/merak/MerakLiveCard.tsx` |

Notification types on the DATA characteristic (first byte):
- `0x2A` heartbeat, 1 per second
- `0xAA` data frame: RAW 27 B (8 distances + 8 sensor states), MIN 14 B (minimum and state per unit);
  protocol 1: 25 B / 13 B without states
- `0xBB` machine reply to a command (command letter, status, 16-bit value)
- `0x3E` human readable text reply

**What is stored.** The backend and its pipeline need `distance_left` and `distance_right`
(`cleaned_width = left + right + vehicle width`) and the database schema must not change. Each side
is one unit (master = left, slave = right, swappable in the app), summarised by the firmware rule:
any sensor *too close* > minimum of the OK sensors > *nothing in range* > *fault*.

| Unit state | Stored for that side |
|------------|----------------------|
| OK | the shortest valid distance |
| too close (< 20 cm, dead zone) | `0` cm (worst case; the firmware prefers a false alarm to a missed obstacle) |
| nothing in range | sample skipped and reported |
| fault (sensor silent > 100 ms) | sample skipped and reported |

RAW and MIN mode give the same result. A value is never invented.

**Firmware generations.** The "Verze firmware měřáku" switch selects FW 4.0.0 (protocol 2, default)
or FW 3.6.0 (protocol 1). Frames are decoded by the version in their own byte 1, so a wrong choice
only raises a warning. A frame of an unknown protocol is shown as hex and not stored.

**Console.** The service screen ("Servis měřáku") ends with a console of everything the unit sends:
decoded frames in the same form as `meas_client.py`, commands and replies, optional heartbeats and
raw hex, with pause and clear.

**Running it.**
- Android/iOS: the native module is not part of Expo Go. Use an EAS development or preview build
  (`eas build --profile development --platform android`).
- Web (testing on a PC): `npm run web` and open the page in Chrome or Edge (Web Bluetooth needs
  HTTPS or localhost). `react-dom` and `react-native-web` must be installed for the web build.
- The unit accepts a single BLE connection: disconnect Raspberry Pi / other clients first.

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
