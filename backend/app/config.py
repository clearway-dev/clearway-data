from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Clearway API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = "sqlite:///./test.db"
    
    # CORS
    ALLOWED_HOSTS: list = ["*"]
    
    class Config:
        env_file = ".env"


settings = Settings()
