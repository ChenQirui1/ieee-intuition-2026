# IEEE Intuition 2026 - Setup Guide

This project consists of a browser extension (WXT) that connects to a Python FastAPI backend for web accessibility features.

## Architecture

- **Backend (FastAPI)**: Scrapes and simplifies web content using OpenAI
- **Frontend (WXT Extension)**: Browser extension with side panel UI
- **APIs**:
  - `/simplify` - Generates easy-to-read summaries
  - `/chat` - Contextual chatbot for Q&A

## Prerequisites

- Python 3.8+ with pip
- Node.js 18+ with pnpm
- OpenAI API key
- Chrome or Firefox browser

## Backend Setup

1. Navigate to the server directory:
```bash
cd server
```

2. Create a virtual environment:
```bash
python -m venv .venv
```

3. Activate the virtual environment:
- Windows: `.venv\Scripts\activate`
- Mac/Linux: `source .venv/bin/activate`

4. Install dependencies:
```bash
pip install -r requirements.txt
```

5. Create a `.env` file with your OpenAI API key:
```
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-3.5-turbo-0125
```

6. Start the backend server:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The backend should now be running at `http://127.0.0.1:8000`

## Frontend Setup (WXT Extension)

1. Navigate to the wxt directory:
```bash
cd wxt
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm dev
```

4. Load the extension in your browser:
   - Chrome:
     - Go to `chrome://extensions/`
     - Enable "Developer mode"
     - Click "Load unpacked"
     - Select the `.output/chrome-mv3` directory
   - Firefox:
     - Go to `about:debugging#/runtime/this-firefox`
     - Click "Load Temporary Add-on"
     - Select any file in the `.output/firefox-mv3` directory

## Usage

1. Make sure the backend server is running
2. Open any webpage in your browser
3. Click the extension icon or open the side panel
4. The extension will:
   - **Summary Tab**: Generate an easy-to-read summary of the page
   - **Headings Tab**: Show a table of contents for navigation
   - **Chat Tab**: Answer questions about the page content

## API Configuration

The frontend connects to the backend at `http://127.0.0.1:8000`. If you need to change this:

1. Edit `wxt/entrypoints/sidepanel/api.ts`
2. Update the `API_BASE_URL` constant

## Troubleshooting

### Backend Issues

- **"OPENAI_API_KEY is not set"**: Make sure your `.env` file exists in the `server` directory with a valid API key
- **Port already in use**: Change the port in the uvicorn command: `--port 8001`
- **CORS errors**: The backend is configured to allow chrome-extension origins

### Frontend Issues

- **"Failed to generate summary"**: Make sure the backend server is running
- **Extension not loading**: Check the browser console for errors
- **API connection failed**: Verify the backend is accessible at `http://127.0.0.1:8000`

## Development

### Backend Development

The backend uses:
- FastAPI for the API server
- BeautifulSoup for web scraping
- OpenAI API for content simplification
- Firebase Firestore for caching (optional)

### Frontend Development

The frontend uses:
- WXT framework for browser extension development
- React for UI components
- Tailwind CSS for styling
- @wxt-dev/storage for session management

## Testing the Connection

1. Start the backend server
2. Visit: `http://127.0.0.1:8000/openai-test`
3. You should see a JSON response with `{"ok": true, ...}`

## Session Management

The extension stores context in browser session storage:
- `session:sessionId` - Unique session identifier
- `session:pageId:{url}` - Page ID for each URL
- `session:simplificationId:{url}` - Simplification ID for each URL

This allows the chatbot to maintain context across page visits.
