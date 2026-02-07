"""Main FastAPI application - entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Database imports - uses factory pattern to select implementation
from database import get_database

# API routers imports
from api.routes import router as main_router
from api.test_routes import router as test_router


# Initialize database (automatically selects based on DATABASE_TYPE env var)
db = get_database()

# Create FastAPI app
app = FastAPI(title="Scraper + Accessibility Backend API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(main_router)
app.include_router(test_router)
