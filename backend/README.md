# ClearWay Data — Backend

FastAPI application for mobile data ingestion and asynchronous measurement processing.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | FastAPI 0.115 + Uvicorn 0.34 |
| Validation | Pydantic v2 |
| ORM | SQLAlchemy 2.0 + GeoAlchemy2 |
| Database | PostgreSQL + PostGIS |
| GIS | Shapely 2.0, osmnx 1.9, scipy (median filter) |
| Task queue | Celery 5.3 + Redis 7 |
| Auth | JWT — python-jose + bcrypt (passlib) |
| Monitoring | prometheus-fastapi-instrumentator, prometheus-client, Flower |
| Logging | Loguru |

---

## Directory Structure

```
backend/
├── app/
│   ├── main.py               # FastAPI app, middleware, router registration
│   ├── models.py             # SQLAlchemy ORM models
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── database.py           # DB engine, SessionLocal, get_db dependency
│   ├── deps.py               # JWT auth dependency (get_current_active_user)
│   ├── worker.py             # Celery app + process_batch_task
│   ├── tasks.py              # Celery task helpers
│   ├── metrics.py            # Shared Prometheus counters / histograms
│   ├── osm_service.py        # OSM road network download and seeding helpers
│   └── routers/
│       ├── auth.py           # POST /api/v1/auth/login, user management
│       ├── measurements.py   # POST /api/v1/measurements/raw-data/batch
│       ├── sessions.py       # Session CRUD
│       ├── vehicles.py       # Vehicle CRUD
│       ├── sensors.py        # Sensor CRUD
│       └── health.py         # GET /health
│   └── core/
│       ├── config.py         # Application settings (env vars via pydantic-settings)
│       └── security.py       # bcrypt hashing, JWT encode/decode
├── tests/
│   ├── conftest.py           # pytest fixtures (test DB, client, auth headers)
│   ├── unit/                 # Unit tests (worker, schemas, security, deps, osm_service)
│   ├── integration/          # Integration tests (auth, measurements, sessions, vehicles, sensors)
│   └── load/                 # Locust load test scenarios
├── seed_roads.py             # OSM road network seeding script
├── requirements.txt
├── Dockerfile
└── pytest.ini
```

---

## Running

### Docker (recommended)

```bash
# From the project root
docker-compose up --build
```

API: http://localhost:8000 · Swagger: http://localhost:8000/docs

### Locally Without Docker

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set required env vars (or export from .env in the project root)
export DATABASE_URL="postgresql://clearway:clearway_dev_password@127.0.0.1:5432/clearway"
export SECRET_KEY="local-dev-secret"

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## API Endpoints

Full interactive docs at `/docs` (Swagger UI) and `/redoc`.

### Auth (`/api/v1/auth/`)

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/auth/login` | Login — returns JWT | Public |
| GET | `/api/v1/auth/users/me` | Current user profile | Bearer |
| GET | `/api/v1/auth/users` | List users | Bearer |
| POST | `/api/v1/auth/users` | Create new user | Admin |
| PUT | `/api/v1/auth/users` | Update user | Admin |
| DELETE | `/api/v1/auth/users` | Delete user | Admin |


### Measurements (`/api/v1/measurements/`)

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/measurements/raw-data/batch` | Ingest batch from mobile | Bearer |
| GET | `/api/v1/measurements/recent` | Last N raw measurements | Bearer |

### Sessions (`/api/v1/sessions/`)

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/sessions` | Start a new session | Bearer |

### Sessions (`/api/v1/sensors/`)

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/sensors` | Create new senzor | Bearer |
| GET | `/api/v1/sensors` | List senzors | Bearer |

### Sessions (`/api/v1/vehicles/`)

| Method | URL | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/vehicles` | Create new vehicles | Bearer |
| GET | `/api/v1/vehicles` | List vehicles | Bearer |
| POST | `/api/v1/vehicles/{vehicles_id}` | End a session | Bearer |

### default

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/metrics` | Prometheus metrics |

### Health

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/` | Root |
| GET | `/db-check` | Liveness + DB connectivity |
| GET | `/health` | Health Check |

---

## Processing Pipeline

### Phase 1 — Logical Validation

Checks each raw measurement for:
- Negative `distance_left` / `distance_right`
- Both distances zero
- GPS coordinates outside valid Pilsen bounding box
- Speed below `0.1 m/s` (GPS glitch) or above `40 m/s` (unrealistic jump)
- GPS accuracy worse than `25 m`

Invalid records → `is_valid = False` + row in `invalid_measurements`.

### Phase 2 — Map-Matching

Snaps each valid GPS point to the nearest road segment using PostGIS:

1. Bounding-box pre-filter via spatial index, then KNN `<->` ordering — returns **3 candidates**
2. For each candidate, computes `ST_Azimuth` of the segment and compares with vehicle heading (derived from the previous GPS point)
3. Heading check (bidirectional): accepted if `angular_diff ≤ 45°` or `≥ 135°`
4. Falls back to the geometrically closest candidate if none pass the heading check
5. `cleaned_width = distance_left + distance_right + vehicle.width`

### Phase 3 — Median Filter
**1D median filter** (`kernel=5`) applied to the width series across the batch


**Result** → `cleaned_measurements` with snapped geometry.

---

## Authentication

JWT (HS256), validity configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` (default 480 min):

1. `POST /api/v1/auth/login` → JWT token
2. Client attaches `Authorization: Bearer <token>` to every request
3. `deps.py` decodes the token and loads the user from DB

---

## Tests

```bash
cd backend

# Unit tests only (no DB required)
pytest tests/unit/

# All tests (requires running PostgreSQL)
pytest

# With coverage report
pytest --cov=app --cov-report=term-missing
```

Integration tests use a dedicated test database defined in `tests/conftest.py`.

### Load Tests (Locust)

```bash
cd backend/tests/load
cp .env.example .env   # fill in credentials
locust -f locustfile.py --host http://localhost:8000
# Open http://localhost:8089
```

---

## Road Network Seeding

```bash
# From the backend/ directory (requires DB connection)
python seed_roads.py
```

Downloads the Pilsen road network from OpenStreetMap via osmnx, filters to drivable highway types, and inserts `road_segments` rows with PostGIS geometries.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLAlchemy connection string | assembled from `DB_*` |
| `DB_USER` | PostgreSQL user | `clearway` |
| `DB_PASSWORD` | PostgreSQL password | — |
| `DB_HOST` | PostgreSQL host | `clearway-db` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `clearway` |
| `SECRET_KEY` | JWT signing key | — (required) |
| `CELERY_BROKER_URL` | Redis broker URL | `redis://clearway-redis:6379/0` |
| `CELERY_RESULT_BACKEND` | Redis result backend URL | `redis://clearway-redis:6379/0` |
| `CELERY_CONCURRENCY` | Worker process count | `2` |
| `WORKER_METRICS_PORT` | Prometheus metrics port (worker) | `8001` |
