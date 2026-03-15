from app.database import SessionLocal
from app.osm_service import OSMService
from loguru import logger

def main():
    logger.info("Seeding roads...")

    db = SessionLocal()

    try:
        service = OSMService(db)
        service.import_segments_for_place("Plzeň, Czechia")
    except Exception as e:
        logger.exception(f"An error occurred: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()