import os
from dotenv import load_dotenv

# Load local .env file from the backend directory if present
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    load_dotenv()

class Settings:
    PROJECT_NAME: str = "Workout Management API"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-key-that-should-be-changed-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # Use SQLite by default for easy development, configurable to PostgreSQL via env var
    # On Vercel, fall back to /tmp/ to avoid read-only filesystem crash
    default_db = "sqlite:////tmp/treinos.db" if os.getenv("VERCEL") else "sqlite:///./treinos.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", default_db)

settings = Settings()
