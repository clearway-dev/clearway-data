# FastAPI Backend

Základní FastAPI backend pro projekt Clearway.

## Spuštění

1. Vytvořit virtuální prostředí:
```bash
python -m venv venv
venv\Scripts\activate
```

2. Instalovat závislosti:
```bash
pip install -r requirements.txt
```

3. Nastavit proměnné prostředí v `.env` (v rootu projektu), například:

```env
API_URL=http://localhost:8000
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
CORS_ALLOW_ORIGINS=*
```

`API_URL` backend používá jako výchozí hodnotu pro CORS (pokud není nastaveno `CORS_ALLOW_ORIGINS`) a vrací ji v `/` a `/health` pro kontrolu konfigurace.

4. Spustit server:
```bash
python main.py
```

Server bude dostupný na `http://localhost:${BACKEND_PORT}`

## API dokumentace

- **Swagger UI**: http://localhost:8000/api/v1/docs
- **ReDoc**: http://localhost:8000/api/v1/redoc

## Struktura projektu

```
backend/
├── main.py              # Hlavní aplikace
├── config.py            # Konfigurace
├── requirements.txt     # Závislosti
├── .env.example         # Příklad .env souboru
├── routers/             # API routes
├── models/              # ORM modely
└── schemas/             # Pydantic schémata
```

## Přidání nových routů

Vytvořte nový soubor v `routers/` a zaregistrujte jej v `main.py`:

```python
from routers import my_router
app.include_router(
    my_router.router,
    prefix=settings.API_V1_STR,
)
```
