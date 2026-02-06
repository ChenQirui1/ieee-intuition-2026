# IEEE Intuition 2026

A comprehensive accessibility and simplification platform designed to make web content more understandable and actionable. This full-stack project combines web scraping, AI-powered content simplification, and multilingual support into an integrated system with a browser extension, web client, and powerful backend API.

## 🎯 Project Overview

IEEE Intuition 2026 is built to address accessibility challenges by:

- **Web Scraping**: Extract structured content from any public website
- **Content Simplification**: Transform complex content into one of three easy-to-understand formats
- **Multilingual Support**: Provides output in English, Simplified Chinese, Malay, and Tamil
- **Browser Integration**: Seamless extension for direct access while browsing
- **Web Dashboard**: Central hub for managing and viewing simplifications
- **AI-Powered Chat**: Contextual conversations about simplified content

## 📦 Architecture

The project is organized into three main modules:

### To run

### 1. **Server** (`/server`)

FastAPI-based Python backend with Firebase integration for persistent storage.

**Key Technologies:**

- FastAPI 0.128.1 - Modern async Python web framework
- Firebase Admin SDK for Firestore database
- BeautifulSoup 4 for HTML parsing
- HTTPX for async HTTP requests
- Language detection and validation

**Main Components:**

#### `main.py` - Core API

FastAPI application exposing three primary endpoints:

1. **`POST /scrap`** - Web scraping endpoint
   - Accepts a URL and optional session ID
   - Extracts structured content (meta, blocks, links, images)
   - Saves to Firebase for caching
   - Returns page ID and extracted content

2. **`POST /simplify`** - Content simplification endpoint
   - Accepts a page ID and simplification mode
   - Supports three modes:
     - **easy_read**: Overview with key points, sections, glossary
     - **checklist**: Goal-oriented checklist format with requirements, documents, deadlines
     - **step_by_step**: Detailed step-by-step instructions
   - Language-aware output validation
   - Caches results in Firebase

3. **`POST /chat`** - Contextual AI chat endpoint
   - Accepts a page ID and chat message
   - Provides language-aware responses
   - Integrated with simplification context

#### `scraper.py` - Web Scraping

- `fetch_and_parse_html()` - Safely fetch and parse web pages
- `extract_blocks_in_order()` - Extract semantic blocks (headings, paragraphs, lists, tables)
- `extract_meta()` - Extract page metadata (title, description, canonical URL)
- `extract_links_and_images()` - Extract all links and images with context

#### `firebase_store.py` - Data Persistence

- Firebase/Firestore integration
- Caching layer for pages and simplifications
- Session management
- SHA256 content hashing for deduplication

#### `models.py` - Pydantic Data Models

Request/response schemas:

- `ScrapRequest` / `ScrapResponse`
- `SimplifyRequest` / `SimplifyResponse`
- `ChatRequest` / `ChatResponse`

**Scripts:**

- `python main.py` - Start the FastAPI server (runs on port 8000 by default)

**Configuration:**

- CORS configured for localhost:3000 and localhost:5173
- Firebase credentials stored in `secrets/firebase-admin.json`

### 2. **WXT Browser Extension** (`/wxt`)

Browser extension built with WXT framework, React, and TypeScript for Chrome/Firefox.

**Key Technologies:**

- WXT 0.20.6 - Web extension framework
- React 19.2.3
- Tailwind CSS 4 with Vite integration
- TypeScript 5.9.3
- Supports both Chrome and Firefox

**Components:**

- **`entrypoints/background.ts`** - Service worker for background tasks
- **`entrypoints/content.ts`** - Content script for DOM access
- **`entrypoints/options/`** - Options page UI
  - React component with Tailwind styling
  - User preferences and settings
- **`entrypoints/sidepanel/`** - Side panel UI
  - Floating panel for quick access
  - Displays simplifications while browsing

**Scripts:**

- `pnpm dev` - Start development with hot reload
- `pnpm dev:firefox` - Development for Firefox
- `pnpm build` - Production build
- `pnpm build:firefox` - Firefox production build
- `pnpm zip` - Create distributable package
- `pnpm compile` - TypeScript type checking

**Types:**

- `types/userProfile.ts` - User data structures

## 🌐 Supported Languages

The system validates and ensures output is in the target language:

- **English** (en) - Default

WIP

- **Simplified Chinese** (zh) - 简体中文
- **Malay** (ms) - Bahasa Melayu
- **Tamil** (ta) - தமிழ்

Each language includes specialized prompting and validation heuristics.

## � Running the Chrome Extension (Pre-built)

Using the pre-built extension package (`clearweb_chrome_extension.zip`):

1. **Extract the extension:**
   - Unzip `clearweb_chrome_extension.zip` to a folder on your computer

2. **Load in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right corner)
   - Click **Load unpacked**
   - Select the unzipped extension folder
   - The IEEE Intuition 2026 extension should now appear in your toolbar

3. **Start using:**
   - Click the extension icon while browsing any website
   - The extension will connect to the backend API to simplify content

**Note:** Make sure the backend server is running at `https://ieee-intuition-2026-production.up.railway.app` or update the API endpoint in the extension settings.

## 🛠️ Building in Local Environment

To build and develop the project locally from source:

### Backend (Server)

```bash
cd server

# Create and activate virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run development server
python main.py
# Server runs on http://localhost:8000
```

### Browser Extension (WXT)

```bash
cd wxt

# Install dependencies
pnpm install

# Development mode (with hot reload)
pnpm dev
# For Firefox:
pnpm dev:firefox

# Production build
pnpm build
# For Firefox:
pnpm build:firefox

# Create distributable package
pnpm zip
```

The built extension will be in `wxt/.output/` directory. Load the appropriate build folder in your browser's extension manager.

## �🚀 Getting Started

### Prerequisites

#### System Requirements

- **Windows, macOS, or Linux**
- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)
- **Python 3.10+** - Download from [python.org](https://www.python.org)
- **Git** - For version control
- **pnpm** (recommended over npm) - Install with `npm install -g pnpm`
- **Firebase project** with Firestore enabled

#### Verification

Check your versions:

```bash
node --version        # Should be v18.0.0 or higher
python --version      # Should be 3.10 or higher
pnpm --version        # Should be 8.0.0 or higher
```

### Step-by-Step Setup

#### Step 1: Firebase Configuration (Required First)

This step must be done before running the server.

1. **Create a Firebase Project:**
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Click "Add project"
   - Enter project name (e.g., "IEEE Intuition 2026")
   - Accept terms and click "Create project"
   - Wait for project to initialize

2. **Enable Firestore Database:**
   - In Firebase Console, navigate to "Firestore Database" (under Build menu)
   - Click "Create database"
   - Start in **test mode** (for development)
   - Select a region (e.g., `us-east1`)
   - Click "Create"

3. **Generate Service Account Key:**
   - In Firebase Console, go to **Project Settings** (gear icon)
   - Click **Service Accounts** tab
   - Click **Generate New Private Key**
   - A JSON file downloads automatically
   - **Save this file as:** `server/secrets/firebase-admin.json`

4. **Create secrets directory:**
   ```bash
   # From project root
   mkdir -p server/secrets
   # Move or copy firebase-admin.json into this directory
   ```

**Note:** This file contains credentials - never commit to git. It's already in `.gitignore`.

#### Step 2: Install Backend Environment

**On Windows:**

```bash
cd server

# Create virtual environment
python -m venv .venv

# Activate virtual environment
.venv\Scripts\activate

# Verify activation (should show (.venv) prefix)
# Then install dependencies
pip install -r requirements.txt

# Verify installation
pip list
```

**On macOS/Linux:**

```bash
cd server

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Verify activation (should show (.venv) prefix)
# Then install dependencies
pip install -r requirements.txt

# Verify installation
pip list
```

**Troubleshooting:**

- If `python -m venv` fails, try `python3 -m venv`
- If `pip install` is slow, try: `pip install --upgrade pip`
- Ensure you're in the `server/` directory before running commands

#### Step 4: Install Browser Extension Dependencies

```bash
# Navigate to extension directory
cd ../wxt

# Install dependencies
pnpm install

# Verify TypeScript compilation
pnpm compile
```

#### Step 5: Environment Configuration

**Backend (.env or Configuration)**
The server uses environment variables. No `.env` file is required for local development, but you may want to create one:

```bash
# server/.env (optional for development)
DATABASE_URL=firestore
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
```

**Client (.env)**
No additional setup needed for local development. The client is configured to connect to `http://localhost:8000` by default.

#### Step 6: Verify All Environments

**Backend Python:**

```bash
cd server
# Ensure .venv is activated
python -c "import fastapi; import firebase_admin; print('✓ Backend dependencies OK')"
```

**Frontend Node:**

```bash
cd ../client
node -v
pnpm list next react
```

**Extension Node:**

```bash
cd ../wxt
pnpm compile
```

### Running Development Servers

Once all environments are set up, you can start the development servers:

**Terminal 1 - Backend API:**

```bash
cd server

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Start server
python main.py
```

**Expected output:**

```
Uvicorn running on http://127.0.0.1:8000
Press CTRL+C to quit
```

Visit `http://localhost:8000/docs` to see the interactive API documentation.

**Browser Extension Frontend:**

```bash
cd wxt
pnpm dev
```

**Expected output:**

```
  ➜  Local:   http://localhost:5173
```

To use the extension:

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the clearweb_chrome_extension.zip
5. The extension should appear in your toolbar

### First Run Checklist

- [ ] Python virtual environment created and activated
- [ ] Firebase credentials saved to `server/secrets/firebase-admin.json`
- [ ] Backend dependencies installed (`pip list` shows packages)
- [ ] Frontend dependencies installed (`pnpm list` shows packages)
- [ ] Backend starts without errors (`python main.py`)
- [ ] API docs accessible at `https://ieee-intuition-2026-production.up.railway.app/docs`

### Common Setup Issues

| Issue                                      | Solution                                                           |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Python venv not activating                 | Use full path: `./.venv/Scripts/activate` on Windows               |
| `pip install` fails                        | Upgrade pip: `pip install --upgrade pip`                           |
| Firebase credentials error                 | Check path is `server/secrets/firebase-admin.json` and file exists |
| Port 8000 already in use                   | Change in `main.py` or kill existing process                       |
| Port 3000 already in use                   | Next.js auto-uses 3001, or kill existing process                   |
| `pnpm` command not found                   | Install globally: `npm install -g pnpm`                            |
| TypeScript compilation errors in extension | Run `pnpm compile` for detailed errors                             |
| Browser extension not loading              | Ensure `wxt/dist` folder exists; run `pnpm build` first            |

## 📋 API Endpoints

### Scrap Endpoint

**POST** `/scrap`

Request:

```json
{
  "url": "https://example.com/page",
  "session_id": "optional-session-id"
}
```

Response:

```json
{
  "page_id": "generated-id",
  "url": "https://example.com/page",
  "meta": {
    "title": "Page Title",
    "description": "Page description",
    "canonical_url": "https://example.com/page"
  },
  "blocks": [...],
  "links": [...],
  "images": [...],
  "source_text": "extracted text content"
}
```

### Simplify Endpoint

**POST** `/simplify`

Request:

```json
{
  "page_id": "page-id",
  "mode": "easy_read",
  "language": "en"
}
```

Modes: `easy_read`, `checklist`, `step_by_step`

Response varies by mode with appropriate schema for each.

### Chat Endpoint

**POST** `/chat`

Request:

```json
{
  "page_id": "page-id",
  "message": "User question",
  "language": "en"
}
```

Response:

```json
{
  "reply": "AI generated response"
}
```

## 📁 Project Structure

```
ieee-intuition-2026/
├── server/                # FastAPI backend
│   ├── main.py           # Main application
│   ├── models.py         # Pydantic schemas
│   ├── scraper.py        # Web scraping utilities
│   ├── firebase_store.py # Database layer
│   ├── requirements.txt   # Python dependencies
│   ├── secrets/          # Firebase config (gitignored)
│   └── __pycache__/
└── wxt/                  # Browser extension
    ├── entrypoints/      # Extension entry points
    ├── types/            # TypeScript types
    ├── public/           # Extension assets
    ├── package.json
    └── wxt.config.ts     # WXT configuration
```

## 🔒 Security Notes

- API has CORS configured for localhost development
- Firebase credentials are kept in `secrets/` (gitignored)
- Public hostname validation on scraped URLs
- Content sanitization in scraper

## 📝 Development Workflow

1. Make changes to code
2. Backend auto-reloads with FastAPI
3. Client auto-reloads with Next.js HMR
4. Extension reloads on save (dev mode)
5. Test via API endpoints or UI

## 🐛 Troubleshooting

**Backend won't start:**

- Ensure Python venv is activated
- Check Firebase credentials are in `firebase-admin.json`
- Verify port 8000 is not in use

**Client won't load:**

- Ensure backend is running on port 8000
- Clear `.next` folder and rebuild: `pnpm build`
- Check CORS settings match your localhost port

**Extension not working:**

- Run `pnpm dev` in wxt folder
- Load `wxt/dist` folder in Chrome Extensions developer mode
- Check Console for errors

## 📚 Dependencies

### Backend Key Packages

- `fastapi` - Web framework
- `beautifulsoup4` - HTML parsing
- `firebase-admin` - Database
- `httpx` - Async HTTP
- `pydantic` - Data validation

### Frontend Key Packages

- `next` - React framework
- `react` - UI library
- `tailwindcss` - Styling
- `typescript` - Type safety

### Extension Key Packages

- `wxt` - Extension framework
- `react` - UI
- `tailwindcss` - Styling

## 📄 License

[Add your license information here]

## 👥 Contributors

[Add contributor information here]

## 🎓 Context: IEEE Intuition

This project is part of the IEEE Intuition 2026 initiative, focused on making the web more intuitive and accessible through intelligent content simplification and transformation.

---

**Last Updated:** February 6, 2026
