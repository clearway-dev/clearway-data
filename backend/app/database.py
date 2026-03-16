import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Načtení proměnných ze souboru .env
# Hledáme .env v root adresáři projektu (o 2 úrovně výš od tohoto souboru)
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Získání URL databáze
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    raise ValueError("DATABASE_URL není nastavena v prostředí nebo .env souboru!")

# Vytvoření SQLAlchemy Engine
# Engine je hlavní vstupní bod pro spojení s databází
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)

# Vytvoření továrny na databázové sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Základní třída pro tvé modely (z minulé zprávy ji můžeš importovat odsud)
Base = declarative_base()

# Dependency pro FastAPI
def get_db():
    """
    Tato funkce se stará o to, aby každý request dostal svou vlastní 
    databázovou session a po dokončení requestu se session bezpečně uzavřela.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()