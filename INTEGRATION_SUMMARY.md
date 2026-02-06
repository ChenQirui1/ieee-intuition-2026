# Backend-Frontend Integration Summary

## What Was Done

### 1. Created API Service Layer (`wxt/entrypoints/sidepanel/api.ts`)

**New file** that provides TypeScript functions to communicate with the backend:

- `simplifyPage()` - Calls `/simplify` endpoint to generate easy-to-read summaries
- `sendChatMessage()` - Calls `/chat` endpoint for contextual Q&A
- `testConnection()` - Tests if backend is reachable

**Key Features:**
- Type-safe interfaces matching backend models
- Proper error handling
- Support for all backend parameters (language, mode, session_id, etc.)

### 2. Updated Side Panel UI (`wxt/entrypoints/sidepanel/App.tsx`)

**Replaced mock implementations with real API calls:**

#### Summary Tab
- **Before:** Mock setTimeout with hardcoded bullets
- **After:** Calls `simplifyPage()` API with current URL
- Extracts `key_points` from `easy_read` mode
- Stores `page_id` and `simplification_id` in session storage

#### Chat Tab
- **Before:** Mock setTimeout with template responses
- **After:** Calls `sendChatMessage()` API with:
  - Current URL
  - Message history (last 6 messages)
  - Session context (page_id, simplification_id)
  - Section text when clicking page elements

#### Session Management
- Generates unique `session_id` on first load
- Stores context per URL in browser session storage:
  - `session:sessionId` - Global session ID
  - `session:pageId:{url}` - Page ID for each URL
  - `session:simplificationId:{url}` - Simplification ID for each URL
- Maintains conversation context across page visits

#### Error Handling
- Added error state and display banner
- User-friendly error messages
- Graceful fallbacks when backend is unavailable

### 3. Backend Configuration

**Already configured correctly:**
- CORS allows `chrome-extension://.*` origins
- Runs on `http://127.0.0.1:8000` (matches frontend API_BASE_URL)
- Has all required endpoints: `/simplify`, `/chat`, `/scrap`

## How It Works

### Flow for Summary Tab:

1. User opens side panel on a webpage
2. Extension gets current tab URL
3. Calls `simplifyPage(url, 'easy_read', 'en', sessionId)`
4. Backend:
   - Scrapes the webpage
   - Generates simplified content using OpenAI
   - Caches result in Firestore
   - Returns structured JSON with key_points, sections, etc.
5. Frontend displays key_points as bullet list
6. Stores page_id and simplification_id for chat context

### Flow for Chat Tab:

1. User types a question or clicks page element
2. Extension calls `sendChatMessage(url, message, history, options)`
3. Backend:
   - Retrieves or generates simplified content
   - Uses section_text if provided (from clicked element)
   - Sends question + context to OpenAI
   - Returns contextual answer
4. Frontend displays answer in chat UI
5. Maintains conversation history for follow-up questions

## Testing the Integration

### 1. Start Backend Server

```bash
cd server
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Verify it's running: http://127.0.0.1:8000/openai-test

### 2. Start Frontend Development

```bash
cd wxt
pnpm dev
```

Load the extension in Chrome from `.output/chrome-mv3`

### 3. Test the Features

1. **Summary Tab:**
   - Navigate to any webpage (e.g., a government form, documentation page)
   - Open the extension side panel
   - Should see "Loading page summary..." then bullet points appear
   - Check browser console for API calls

2. **Chat Tab:**
   - Type a question like "What is this page about?"
   - Should get a contextual answer based on the page content
   - Try follow-up questions to test conversation history

3. **Element Click:**
   - Enable "Selection Mode" in the extension
   - Click on a paragraph or heading on the page
   - Should switch to Chat tab with explanation of that element

### 4. Troubleshooting

**If summary doesn't load:**
- Check browser console for errors
- Verify backend is running: `curl http://127.0.0.1:8000/openai-test`
- Check backend logs for errors
- Verify OPENAI_API_KEY is set in server/.env

**If chat doesn't work:**
- Same checks as above
- Verify the summary loaded first (chat needs page context)
- Check if error banner appears at top of side panel

## API Endpoints Used

### POST /simplify
```json
{
  "url": "https://example.com",
  "mode": "easy_read",
  "language": "en",
  "session_id": "session_123",
  "force_regen": false
}
```

Returns: Simplified content with key_points, sections, glossary, etc.

### POST /chat
```json
{
  "url": "https://example.com",
  "message": "What is this about?",
  "history": [{"role": "user", "content": "..."}, ...],
  "mode": "easy_read",
  "language": "en",
  "page_id": "page_123",
  "simplification_id": "simpl_456",
  "section_text": "Optional text from clicked element",
  "session_id": "session_123"
}
```

Returns: AI-generated answer based on page context

## Session Storage Schema

```typescript
// Global session ID (persists across pages)
"session:sessionId" → "session_1738851234_abc123"

// Per-URL context (allows switching between pages)
"session:pageId:https://example.com" → "page_xyz789"
"session:simplificationId:https://example.com" → "simpl_abc456"
```

## Language Support

The backend supports 4 languages:
- `en` - English (default)
- `zh` - Simplified Chinese
- `ms` - Malay
- `ta` - Tamil

To change language, update the API calls in App.tsx:
```typescript
simplifyPage(url, 'easy_read', 'zh', sessionId)  // Chinese
sendChatMessage(url, message, history, { language: 'zh', ... })
```

## Next Steps (Optional Enhancements)

1. **Language Selector:** Add UI dropdown to switch languages
2. **Mode Selector:** Allow users to choose between easy_read, checklist, step_by_step
3. **Connection Status:** Add indicator showing if backend is reachable
4. **Offline Mode:** Cache summaries in local storage for offline access
5. **Settings Page:** Configure API URL, language preference, etc.
6. **Loading States:** Better loading indicators with progress
7. **Error Recovery:** Retry button when API calls fail

## Files Modified

- ✅ `wxt/entrypoints/sidepanel/api.ts` - **NEW** API service layer
- ✅ `wxt/entrypoints/sidepanel/App.tsx` - Updated to use real APIs
- ✅ `SETUP.md` - **NEW** Setup and usage guide
- ✅ `INTEGRATION_SUMMARY.md` - **NEW** This document

## Backend Files (No Changes Needed)

- `server/main.py` - Already has all required endpoints
- `server/models.py` - Already has correct data models
- `server/.env` - Already configured (just needs OPENAI_API_KEY)
