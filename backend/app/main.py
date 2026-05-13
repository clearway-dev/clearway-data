"""
ClearWay FastAPI Backend
Main application entry point — app initialization, middleware, and router registration.
"""
import os
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from prometheus_fastapi_instrumentator import Instrumentator

from .routers import auth, health, vehicles, sensors, sessions, measurements

# Configure Loguru for FastAPI process
logger.remove()
is_testing = os.getenv("TESTING", "false").lower() == "true"

if is_testing:
    # Avoid file-system writes in CI/test runs.
    logger.add(sys.stderr, level="INFO")
else:
    os.makedirs("logs", exist_ok=True)
    logger.add(
        "logs/fastapi.log",
        rotation="10 MB",
        retention="14 days",
        level="INFO",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown logging."""
    logger.info("=" * 50)
    logger.info("ClearWay API Starting Up")
    logger.info("=" * 50)
    try:
        yield
    finally:
        logger.info("ClearWay API Shutting Down")


# Initialize FastAPI app
app = FastAPI(
    title="ClearWay API",
    version="0.1.0",
    description="API for road width measurement data collection and processing",
    lifespan=lifespan,
)


# ==============================================
# PROMETHEUS INSTRUMENTATION
# ==============================================

Instrumentator().instrument(app).expose(app)

logger.info("Prometheus instrumentation active — /metrics endpoint exposed")


# ==============================================
# MIDDLEWARE CONFIGURATION
# ==============================================

# allow_origins=["*"] is intentional for development/PoC; restrict to specific domains in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)

logger.info("CORS middleware active — allow_origins=['*'] (development mode)")


# Request Logging Middleware - Production-grade logging with path filtering
# Paths to ignore from standard logging (health checks, docs, static assets)
IGNORED_PATHS = {
    "/health",
    "/",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}


@app.middleware("http")
async def log_requests(request, call_next):
    """
    Production-grade request logging middleware with intelligent filtering.

    Features:
    - Path filtering: Health checks and docs logged only at DEBUG level
    - Dynamic log levels based on HTTP status codes:
      * < 400 (Success): DEBUG level (endpoints already log their own INFO)
      * 400-499 (Client errors): WARNING level
      * >= 500 (Server errors): ERROR level
    - Exception handling with ERROR level logging
    - Performance measurement and client IP tracking
    """
    start_time = time.time()
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path

    try:
        response = await call_next(request)
        status_code = response.status_code

    except Exception as e:
        duration = time.time() - start_time
        logger.error(
            f"{request.method} {path} - "
            f"Status: 500 - Duration: {duration:.3f}s - "
            f"Client: {client_ip} - Error: {str(e)}"
        )
        raise  # Re-raise for FastAPI's exception handlers

    duration = time.time() - start_time

    log_msg = (
        f"{request.method} {path} - "
        f"Status: {status_code} - Duration: {duration:.3f}s - "
        f"Client: {client_ip}"
    )

    # Apply path filtering - health/docs endpoints only at DEBUG
    if path in IGNORED_PATHS:
        logger.debug(log_msg)
        return response

    # Dynamic log level based on status code
    if status_code < 400:
        logger.debug(log_msg)
    elif status_code < 500:
        logger.warning(log_msg)
    else:
        logger.error(log_msg)

    return response


# ==============================================
# ROUTER REGISTRATION
# ==============================================

app.include_router(auth.router,         prefix="/api/v1/auth",   tags=["auth"])
app.include_router(health.router)
app.include_router(vehicles.router)
app.include_router(sensors.router)
app.include_router(sessions.router)
app.include_router(measurements.router)


# ==============================================
# MAIN ENTRY POINT
# ==============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
