# ClearWay Data

Data collection and ingestion pipeline for the **ClearWay** system — a road passability analysis platform developed as part of a Master's Thesis.

The system collects road width measurements via a mobile application equipped with ultrasonic sensors, transmits them to a FastAPI backend, and processes them through an asynchronous Celery pipeline that validates, map-matches, and cleans the data before it is consumed by the ClearWay Analytics layer.

---

## Repository Structure

```
clearway-data/
├── backend/                    # FastAPI + Celery worker (Python 3.12)
├── mobileApp/ClearWayApp/      # React Native / Expo mobile application
├── monitoring/                 # Prometheus + Grafana configuration
│   ├── prometheus/             # prometheus.yml — scrape targets
│   ├── grafana/                # Provisioned datasource + dashboard
│   └── postgres-exporter/      # Custom PostgreSQL queries
├── logs/                       # Runtime logs (gitignored)
├── docker-compose.yml          # Full stack orchestration
├── docker-compose.prod.yml     # Production orchestration (Traefik + GHCR images)
└── .env.example                # Environment variable template
```

---

## Architecture

```
Mobile App (Expo / React Native)
        │
        │  POST /api/v1/measurements/raw-data/batch
        ▼
  FastAPI Backend  ──── Redis ────  Celery Worker
        │                                │
        │                         Phase 1: Logical and Geographical validation
        │                         Phase 2: Map-matching (PostGIS)
        │                         Phase 3: Median-filter cleaning
        ▼                                ▼
  PostgreSQL + PostGIS  ◄────────  cleaned_measurements
        │
        ▼
  ClearWay Analytics (separate repo)
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| API | FastAPI 0.115, Uvicorn, Pydantic v2 |
| ORM / GIS | SQLAlchemy 2.0, GeoAlchemy2, Shapely, osmnx |
| Database | PostgreSQL + PostGIS (external — `clearway-infra` repo) |
| Task queue | Celery 5.3, Redis 7 |
| Auth | JWT (python-jose + bcrypt) |
| Mobile | React Native 0.81, Expo 54, TypeScript |
| Monitoring | Prometheus, Grafana, cAdvisor, postgres-exporter, Flower |
| Containerisation | Docker Compose |

---

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Running PostgreSQL + PostGIS instance from the `clearway-infra` repository

### Quick Start

```bash
# 1. Copy and fill in environment variables
cp .env.example .env

# 2. Start all services
docker-compose up --build
```

## Local

| Service | URL |
|---------|-----|
| API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| Flower (Celery monitor) | http://localhost:5555 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

---

## Production

| Service | URL |
|---------|-----|
| API | https://api-mobile.clearway.zephyron.tech |
| Swagger UI | https://api-mobile.clearway.zephyron.tech/docs |
| Grafana | /https://grafana.clearway.zephyron.tech/ |


## Services

### API (`api`)

FastAPI application receiving measurement batches from the mobile app. Validates the payload, persists raw measurements, and dispatches a Celery task for async processing.

### Celery Worker (`celery_worker`)

Asynchronous two-phase processing pipeline:
1. **Logical and Geographical validation** — bounds checks, GPS-jump detection, speed plausibility
2. **Map-matching** — snaps each GPS point to the nearest road segment (PostGIS + heading-aware candidate selection), computes `cleaned_width` and applies a 1D median filter

### Redis (`redis`)

Message broker and result backend for Celery. Configured with AOF persistence and a 512 MB memory cap.

### Flower (`flower`)

Web UI for monitoring Celery task queues and worker state. Exposes Prometheus metrics at `:5555/metrics`.

### Monitoring Stack

- **Prometheus** — scrapes metrics from the API (`/metrics`), Celery worker, Flower, cAdvisor, and postgres-exporter. Retains data for 30 days.
- **Grafana** — provisioned dashboard (`clearway-main-dashboard`) visualising API latency, batch throughput, worker queue depth, and container resource usage.
- **cAdvisor** — per-container CPU and memory metrics.
- **postgres-exporter** — PostgreSQL connection pool, table sizes, and custom query metrics.

---

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_USER` | PostgreSQL user | `clearway` |
| `DB_PASSWORD` | PostgreSQL password | `change_me` |
| `DB_HOST` | PostgreSQL host | `clearway-db` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `clearway` |
| `SECRET_KEY` | JWT signing key (HS256) | `openssl rand -hex 32` |
| `CELERY_CONCURRENCY` | Worker processes per container | `2` |

> `.env` is in `.gitignore` — never commit it.

---

## CI/CD

All workflows are in `.github/workflows/`.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `test_backend.yml` | push/PR → `main`, `dev` (backend paths) | Python 3.12, pytest (SQLite in-memory) |
| `test_mobileApp.yml` | push/PR → `main`, `dev` (mobileApp paths) | Node 20, Jest |
| `deploy.yml` | push → `main` (backend / monitoring / docker-compose paths) | Runs `test_backend.yml`, builds Docker image, pushes to GHCR, deploys to VPS via SSH (pulls `api`, `celery_worker`, `flower`, restarts monitoring stack) |
| `build_mobileApp.yml` | push → `main` (mobileApp paths), manual dispatch | Runs `test_mobileApp.yml`, builds Android APK via EAS (`--profile preview`) |

---

## Related Repositories

| Repository | Description |
|------------|-------------|
| `clearway-infra` | PostgreSQL + PostGIS + pgRouting infrastructure, DB migrations, road network seeding |
| `clearway-analytics` | FastAPI analytics API + React web dashboard |

---

Last commit for Master's Thesis — 13/05/2026
