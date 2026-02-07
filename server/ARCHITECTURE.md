# Server Architecture - Layered Structure

## Overview
The server has been organized into a clean layered architecture following separation of concerns principles.

## Directory Structure

```
server/
├── api/                    # API Layer - FastAPI routes and endpoints
│   ├── __init__.py
│   ├── routes.py          # Main API routes (scrap, simplify, chat)
│   └── test_routes.py     # Test and utility endpoints
│
├── services/              # Service Layer - Business logic
│   ├── __init__.py
│   ├── scraper.py         # Web scraping logic
│   ├── scraping.py        # Scraping service orchestration
│   └── simplification.py  # Simplification service logic
│
├── database/              # Data Layer - Database abstraction
│   ├── __init__.py
│   ├── interface.py       # Abstract database interface
│   ├── firebase_database.py  # Firebase implementation
│   └── firebase_store.py  # Legacy Firebase utilities
│
├── models/                # Data Models - Pydantic schemas
│   ├── __init__.py
│   └── models.py          # Request/Response models
│
├── utils/                 # Utilities - Helper functions
│   ├── __init__.py
│   ├── openai_client.py   # OpenAI API client
│   ├── language.py        # Language utilities
│   └── validation.py      # Schema validation
│
├── main.py               # Application entry point
├── main_old_backup.py    # Backup of original main.py
└── test_api.py           # API tests
```

## Layer Responsibilities

### 1. API Layer (`api/`)
- **Purpose**: Handle HTTP requests and responses
- **Responsibilities**:
  - Define FastAPI routes
  - Request validation (via Pydantic)
  - Response formatting
  - Error handling
- **Files**:
  - `routes.py`: Core endpoints (/scrap, /simplify, /chat)
  - `test_routes.py`: Test endpoints (/firestore-test, /openai-test, /text-completion)

### 2. Service Layer (`services/`)
- **Purpose**: Business logic and orchestration
- **Responsibilities**:
  - Coordinate between API and data layers
  - Implement business rules
  - Data transformation
  - External API calls (OpenAI)
- **Files**:
  - `scraper.py`: HTML parsing and content extraction
  - `scraping.py`: Scraping orchestration service
  - `simplification.py`: Simplification logic (easy_read, checklist, step_by_step)

### 3. Database Layer (`database/`)
- **Purpose**: Data persistence abstraction
- **Responsibilities**:
  - Abstract database operations
  - Provide consistent interface
  - Handle different database implementations
- **Files**:
  - `interface.py`: Abstract base class (DatabaseInterface)
  - `firebase_database.py`: Firebase/Firestore implementation
  - `firebase_store.py`: Legacy Firebase utilities (can be deprecated)

### 4. Models Layer (`models/`)
- **Purpose**: Data structures and schemas
- **Responsibilities**:
  - Define API request/response models
  - Data validation
  - Type safety
- **Files**:
  - `models.py`: Pydantic models for all endpoints

### 5. Utils Layer (`utils/`)
- **Purpose**: Shared utilities and helpers
- **Responsibilities**:
  - Reusable helper functions
  - Common utilities
  - No business logic
- **Files**:
  - `openai_client.py`: OpenAI API client wrapper
  - `language.py`: Multilingual support utilities
  - `validation.py`: Schema validation helpers

## Benefits of This Architecture

1. **Separation of Concerns**: Each layer has a clear, single responsibility
2. **Testability**: Layers can be tested independently
3. **Maintainability**: Easy to locate and modify code
4. **Scalability**: Easy to add new features or swap implementations
5. **Reusability**: Services and utilities can be reused across endpoints
6. **Database Agnostic**: Easy to switch from Firebase to PostgreSQL/MongoDB

## Import Flow

```
main.py
  ↓
api/routes.py
  ↓
services/scraping.py, services/simplification.py
  ↓
database/firebase_database.py, utils/*
  ↓
models/models.py
```

## Next Steps

1. **Remove Legacy Files**: Delete `firebase_store.py` once fully migrated
2. **Add Tests**: Create unit tests for each layer
3. **Documentation**: Add docstrings to all functions
4. **Type Hints**: Ensure all functions have proper type annotations
5. **Error Handling**: Standardize error handling across layers
6. **Logging**: Add structured logging throughout the application

## Migration Notes

- Old `main.py` backed up as `main_old_backup.py`
- All functionality preserved in new structure
- No breaking changes to API endpoints
- Database interface allows easy migration to other databases
