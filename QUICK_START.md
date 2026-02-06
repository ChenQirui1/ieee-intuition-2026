# Quick Start Guide

## 1. Start Backend (Terminal 1)

```bash
cd server
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Mac/Linux
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

## 2. Start Frontend (Terminal 2)

```bash
cd wxt
pnpm dev
```

**Expected output:**
```
Building extension...
✓ Built in XXXms
Ready in XXXms
```

## 3. Load Extension in Browser

### Chrome:
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select: `wxt/.output/chrome-mv3`

### Firefox:
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in: `wxt/.output/firefox-mv3`

## 4. Test It

1. Navigate to any webpage (try a Wikipedia article or government form)
2. Click the extension icon or open side panel
3. **Summary Tab** should show bullet points about the page
4. **Chat Tab** lets you ask questions about the page
5. **Headings Tab** shows table of contents

## Troubleshooting

### "Failed to generate summary"
- ✅ Check backend is running: http://127.0.0.1:8000/openai-test
- ✅ Check `server/.env` has `OPENAI_API_KEY=your_key_here`
- ✅ Check browser console (F12) for error details

### Backend won't start
- ✅ Activate virtual environment first
- ✅ Install dependencies: `pip install -r requirements.txt`
- ✅ Check port 8000 is not in use

### Extension won't load
- ✅ Run `pnpm dev` first to build the extension
- ✅ Check `.output/chrome-mv3` directory exists
- ✅ Reload extension after code changes

## What's Connected

✅ **Summary Tab** → `/simplify` API → OpenAI → Bullet points
✅ **Chat Tab** → `/chat` API → OpenAI → Contextual answers
✅ **Session Storage** → Maintains context across pages
✅ **Error Handling** → Shows user-friendly error messages

## Need Help?

See `SETUP.md` for detailed setup instructions
See `INTEGRATION_SUMMARY.md` for technical details
