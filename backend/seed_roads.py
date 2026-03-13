from app.database import SessionLocal
from app.osm_service import OSMService

def main():
    print("Seeding roads...")

    db = SessionLocal()

    try:
        service = OSMService(db)
        service.import_segments_for_place("Plzeň, Czechia")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()