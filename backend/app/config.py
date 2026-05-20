import os

class Settings:
    PROJECT_NAME: str = "Workout Management API"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-key-that-should-be-changed-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # Use SQLite by default for easy development, configurable to PostgreSQL via env var
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./treinos.db")

settings = Settings()
