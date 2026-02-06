# Debugging Guide: Summary API Not Working

## Step 1: Test Backend Directly

Run the test script to verify the backend API works:

```bash
cd server
python test_api.py
```

**Expected output:**
```
✅ Backend is reachable!
✅ SUCCESS!
Page ID: abc123...
Key Points:
  1. Example Domain
  2. This domain is for use in illustrative examples...
```

**If this fails:**
- Make sure backend is running: `uvicorn main:app --reload --host 127.0.0.1 --port 8000`
- Check `.env` file has `OPENAI_API_KEY=your_key_here`
- Check backend terminal for errors

## Step 2: Check Browser Console

1. Open the extension side panel
2. Press F12 to open DevTools
3. Go to Console tab
4. Look for messages starting with `[Sidepanel]` or `[API]`

**What to look for:**

### ✅ Good (API working):
```
[Sidepanel] generatePageSummary called with pageData: {...}
[Sidepanel] Got URL from tab: https://example.com
[Sidepanel] Calling simplifyPage API with URL: https://example.com
[API] Calling /simplify with: {url: "https://example.com", ...}
[API] /simplify response status: 200
[API] /simplify success: {page_id: "...", has_easy_read: true}
[Sidepanel] Extracted key_points: ["...", "..."]
```

### ❌ Bad (CORS error):
```
Access to fetch at 'http://127.0.0.1:8000/simplify' from origin 'chrome-extension://...'
has been blocked by CORS policy
```

**Fix:** Backend CORS should already allow chrome-extension origins. Restart backend server.

### ❌ Bad (Connection refused):
```
Failed to fetch
net::ERR_CONNECTION_REFUSED
```

**Fix:** Backend is not running. Start it with:
```bash
cd server
.venv\Scripts\activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### ❌ Bad (API error):
```
[API] /simplify error: {"detail": "..."}
```

**Fix:** Check backend terminal for the full error message.

## Step 3: Check Backend Terminal

Look for errors in the backend terminal where uvicorn is running.

**Common errors:**

### Error: "OPENAI_API_KEY is not set"
**Fix:** Add to `server/.env`:
```
OPENAI_API_KEY=sk-your-key-here
```

### Error: "Property array contains an invalid nested entity"
**Fix:** Already fixed in firebase_store.py. Restart backend server.

### Error: "Failed to fetch/parse HTML"
**Fix:** The URL might be blocked or invalid. Try a different URL like https://example.com

## Step 4: Check Network Tab

1. Open DevTools (F12)
2. Go to Network tab
3. Reload the extension side panel
4. Look for a request to `http://127.0.0.1:8000/simplify`

**What to check:**
- **Status Code:** Should be 200 (green)
- **Response:** Click on the request → Preview tab → Should see JSON with `ok: true`
- **Headers:** Check Request Headers has `Content-Type: application/json`

## Step 5: Test with Simple URL

Try opening a simple webpage first:
1. Navigate to: https://example.com
2. Open extension side panel
3. Check if summary loads

If this works but other sites don't, the issue might be:
- Site blocks scraping
- Site requires authentication
- Site has complex JavaScript that breaks scraping

## Step 6: Check Extension Reload

After making code changes:
1. Go to `chrome://extensions/`
2. Click the reload icon on your extension
3. Close and reopen the side panel
4. Try again

## Quick Checklist

- [ ] Backend server is running on port 8000
- [ ] `.env` file has OPENAI_API_KEY
- [ ] Browser console shows `[API] Calling /simplify`
- [ ] Network tab shows request to `/simplify`
- [ ] Backend terminal shows no errors
- [ ] Extension has been reloaded after code changes
- [ ] Test script (`python test_api.py`) passes

## Still Not Working?

Share the following information:
1. **Browser console output** (all messages with [Sidepanel] or [API])
2. **Backend terminal output** (any errors or warnings)
3. **Network tab** (status code and response for /simplify request)
4. **Test script result** (output of `python test_api.py`)

This will help identify exactly where the issue is occurring.
