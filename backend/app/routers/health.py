from fastapi import APIRouter, Depends
from loguru import logger
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/")
async def root():
    """Root endpoint - API status check"""
    return {
        "message": "ClearWay API is running",
        "version": "0.1.0",
        "status": "operational"
    }


@router.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy"}


@router.get("/db-check")
async def check_database_connection(db: Session = Depends(get_db)):
    """
    Database connection check endpoint.
    Verifies that the API can successfully connect to PostgreSQL.
    """
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "success",
            "message": "Připojení k databázi funguje!",
            "database": "PostgreSQL"
        }
    except Exception as e:
        logger.error(f"Database connection failed: {str(e)}")
        return {
            "status": "error",
            "message": f"Chyba připojení: {str(e)}"
        }
