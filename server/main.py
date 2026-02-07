"""Main FastAPI application - entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize database
from database.firebase_database import FirebaseDatabase

db = FirebaseDatabase()

# Create FastAPI app
app = FastAPI(title="Scraper + Accessibility Simplifier API")

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
from api.routes import router as main_router
from api.test_routes import router as test_router

app.include_router(main_router)
app.include_router(test_router)
