# clearway-data
Mobile app and data ingestion pipeline for ClearWay. Collects raw measurements from sensors, simulates data, and stores them in the shared PostgreSQL database with optional preprocessing and cleaning.


## 🧩 System Modules

### 1️⃣  Mobile Application
- **Purpose:** Simulates street width measurement and records the GPS location of the mobile device.  
- **Functions:**  
  - Collects GPS data from the device.  
  - Generates random street width values.  
  - Allows the user to input vehicle width.  
  - Stores data locally and sends it to the server.  
- **Technologies:** Flutter, libraries: `geolocator`, `dio`, `sqflite`, format JSON / NDJSON.

### 2️⃣ API Server (FastAPI)
- **Purpose:** Receives and manages data from mobile devices.  
- **Functions:**  
  - Validates incoming data.  
  - Stores raw data in the database (`measurements_raw`).  
  - Manages device metadata.  
  - Triggers data cleaning via worker.  
- **Technologies:** Python + FastAPI, SQLAlchemy + GeoAlchemy2, JWT, Uvicorn / Gunicorn.

### 3️⃣ Worker (Data Cleaning)
- **Purpose:** Automatically processes and cleans data stored in the database.  
- **Functions:**  
  - Loads new raw data.  
  - Performs validation, error correction, and outlier detection.  
  - Stores cleaned data (`measurements_clean`).  
  - Marks records as `cleaned = true`.  
- **Technologies:** Python, pandas, geopandas, shapely, APScheduler / Celery, asyncpg / SQLAlchemy.

---

## 🧩 Moduly systému 

### 1️⃣ Mobilní aplikace  
- **Účel:** Simuluje měření šířky silnice a zaznamenává GPS polohu telefonu.  
- **Funkce:**  
  - Získává data z GPS senzoru telefonu.  
  - Generuje náhodnou šířku silnice.  
  - Umožňuje uživateli zadat šířku vozidla.  
  - Ukládá data lokálně a odesílá je na server.  
- **Technologie:** Flutter, knihovny: `geolocator`, `dio`, `sqflite`, formát JSON / NDJSON.

### 2️⃣ API Server (FastAPI)
- **Účel:** Přijímá a spravuje data z mobilních zařízení.  
- **Funkce:**  
  - Validace příchozích dat.  
  - Ukládání do databáze (`measurements_raw`).  
  - Správa zařízení a metadat.  
  - Spouštění čištění dat přes worker.  
- **Technologie:** Python + FastAPI, SQLAlchemy + GeoAlchemy2, JWT, Uvicorn / Gunicorn.

### 3️⃣ Worker (Čištění dat) 
- **Účel:** Automaticky zpracovává a čistí data uložená v databázi.  
- **Funkce:**  
  - Načítá nová raw data.  
  - Provádí validaci, odstraňuje chyby, detekuje outliery.  
  - Ukládá vyčištěná data (`measurements_clean`).  
  - Označuje záznamy jako `cleaned = true`.  
- **Technologie:** Python, pandas, geopandas, shapely, APScheduler / Celery, asyncpg / SQLAlchemy.  
