# ClearWeb

ClearWeb is a Chrome extension and FastAPI backend that makes public web pages easier to read and use. It provides plain-language summaries, grounded checklists and step-by-step guides, image descriptions, read-aloud support, a magnifier, accessible page styles, optional page translation, and English, Chinese, Malay, and Tamil UI support.

The default branch is **`master`**. The extension runs in Chrome; AI features connect to a backend on your computer at `http://127.0.0.1:8000`. Your OpenAI key belongs in the backend's `server/.env` file. There is no OpenAI-key field in the Chrome extension.

Already installed ClearWeb? Follow [Update an existing installation](#update-an-existing-installation). For the code audit and verification details, see [AUDIT_FIXES.md](AUDIT_FIXES.md).

## Run it locally on Windows

Prerequisites: Python 3.11 or newer, Node.js 24, and pnpm 10. The automated checks use Python 3.13.

For a new checkout, open PowerShell and run:

```powershell
git clone https://github.com/ChenQirui1/ieee-intuition-2026.git
cd ieee-intuition-2026
```

### 1. Configure and start the backend

Open PowerShell in the repository and run:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Open `server/.env` in a text editor and paste your OpenAI key after `OPENAI_API_KEY=`. Do not put the key in the extension or commit `.env`.

Replace the placeholder below with your own key, save the file, and close the editor. Leave the other settings at their defaults for local use.

```dotenv
OPENAI_API_KEY=your-key-here
```

Then start the API:

```powershell
.\run_server.ps1
```

The local server listens only on `http://127.0.0.1:8000`. Verify it at [http://127.0.0.1:8000/healthz](http://127.0.0.1:8000/healthz); the response should be `{"ok":true}`.

Keep this PowerShell window running while using AI features. The health check confirms that the backend is reachable; it does not validate the OpenAI key or make a paid AI request. Restart the backend after changing `.env`.

The default `DATABASE_TYPE=mock` needs no Firebase or MongoDB account. Its cache is cleared when the backend restarts.

### 2. Build and load the Chrome extension

Open a second PowerShell window **at the repository root**, then run:

```powershell
cd wxt
pnpm install --frozen-lockfile
pnpm compile
pnpm build
```

In Chrome:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `wxt/.output/chrome-mv3` (select the folder containing `manifest.json`).
5. Pin ClearWeb, open a normal `http://` or `https://` page, and click the extension icon.

After rebuilding, click ClearWeb's reload button on `chrome://extensions/` and refresh the webpage being tested.

### 3. Check the extension

1. Open a public webpage with text and images, then click the pinned ClearWeb icon to open its side panel.
2. Confirm that the backend connection indicator is connected and request a summary.
3. Enable the magnifier and move it over text. Switch to another tab and back; the lens and controls should match the active page.
4. Turn on selection mode, select a public image, and request a description.
5. Start a summary or chat reply, then switch tabs or reload before it finishes. A response from the previous page must not appear in the new page context.
6. In settings, try Translate Page, breadcrumbs, and ad hiding, then turn them off and check that the page returns to its normal appearance.

AI summaries, chat, and image descriptions require a working OpenAI key. The magnifier and page styling do not require an AI request. Test on ordinary HTTP(S) pages; Chrome's internal pages such as `chrome://extensions/` cannot run the content script. The backend scrapes public page content, so authenticated pages and JavaScript-only sites may not produce useful summaries.

## Update an existing installation

Stop the running backend with **Ctrl+C**. From the repository root, update the merged code and its dependencies:

```powershell
git switch master
git pull --ff-only origin master

Push-Location server
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Pop-Location

Push-Location wxt
pnpm install --frozen-lockfile
pnpm compile
pnpm build
Pop-Location
```

These commands assume the first-time setup has already created `server/.venv`. Keep your existing `server/.env`; do not overwrite it with the example file.

Then:

1. Restart the backend with `cd server` followed by `.\run_server.ps1`.
2. Open `chrome://extensions/`.
3. If ClearWeb was loaded from this checkout's `wxt/.output/chrome-mv3`, click its **Reload** button.
4. If it was loaded from an extracted ZIP in another folder, reloading still uses that folder. Replace it with the new package or load this checkout's `wxt/.output/chrome-mv3` instead. Keep only one ClearWeb installation enabled while testing.
5. Refresh the webpage, reopen ClearWeb, and repeat the checks above.

## Pre-built Chrome package

[Download the Chrome package](clearweb-1.0.0-chrome.zip). It contains the production extension build, configured for the local backend. Extract it first, then use **Load unpacked** and select the extracted folder containing `manifest.json`. Chrome cannot load the ZIP file itself.

The ZIP does not contain the Python backend or an OpenAI key. Complete the backend setup above even if you use the pre-built extension; Node.js and pnpm are only needed when building the extension from source.

The older `clearweb_chrome_extension_old.zip` is retained only for historical reference and should not be installed.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Backend says disconnected | Keep the backend terminal running and open `/healthz`. The default extension expects `http://127.0.0.1:8000`; a different port or custom build needs matching configuration. |
| Health check works, but AI requests fail | Check `OPENAI_API_KEY` in `server/.env`, the configured model, and your API account's quota. Restart the backend after changing the file. Check the terminal for the error. |
| Magnifier or selection does nothing | Reload the updated extension, refresh the webpage, and test on a normal HTTP(S) page. Verify that Chrome loaded the new build folder rather than an older extracted ZIP. |
| Old behavior remains after rebuilding | Check the extension's loaded folder on `chrome://extensions/`. Rebuilding `wxt/.output/chrome-mv3` does not update a ZIP extracted elsewhere. |
| API returns HTTP 429 | The local per-client, per-endpoint request limit has been reached. Wait one minute before trying again. |
| Summary is unavailable on a signed-in site | The server cannot reuse your Chrome login session. Try a publicly accessible page. |

When reporting a problem, include the feature, a public test URL, and the relevant error message. Remove API keys, authorization headers, and private page content from anything you share.

## Configuration

The backend reads `server/.env`:

- `OPENAI_API_KEY` — required for AI features.
- `OPENAI_MODEL` — model used for summaries and chat; defaults to `gpt-5.6-luna`.
- `OPENAI_VISION_MODEL` — image-caption model; defaults to `gpt-5.6-luna`, independently of legacy text-model overrides.
- `DATABASE_TYPE` — `mock`, `firebase`, or `mongodb`.
- `PAGE_CACHE_TTL_SECONDS` — how long scraped page content remains fresh; defaults to 3600.
- `API_RATE_LIMIT_PER_MINUTE` — per-client, per-endpoint limit; defaults to 30.
- `API_ACCESS_KEY` — required when exposing the API to remote clients.
- `ENABLE_TEST_ROUTES` — exposes diagnostic routes only when explicitly set to `true`.

Local requests work without `API_ACCESS_KEY`. Remote requests are denied by default unless an access key is configured or `ALLOW_UNAUTHENTICATED_API=true` is explicitly set. A static access key is suitable only for controlled deployments; a public service should use real user authentication and per-user quotas.

The default model supports text and image input and is called with reasoning disabled for this short-response workload. See [OpenAI's Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna). A configured model must support Chat Completions; caption overrides must also support images.

The launch scripts disable forwarded-client headers. If you deploy behind a proxy, configure trusted proxy addresses deliberately and require an access key. Rate limits are per process; multiple workers need a shared gateway or quota store. Browser requests are restricted to Chrome extension origins and the local development origins listed in `server/api/security.py`.

To point a custom extension build at another backend, create `wxt/.env` before building:

```dotenv
WXT_API_BASE_URL=https://api.example.com
WXT_API_ACCESS_KEY=replace-with-the-server-api-access-key
```

These WXT values are compiled into the extension bundle, so do not treat `WXT_API_ACCESS_KEY` as a secret in a publicly distributed build.

### Persistent databases

For MongoDB:

```dotenv
DATABASE_TYPE=mongodb
MONGO_URL=mongodb://username:password@host:27017/clearweb
```

For Firebase, set `DATABASE_TYPE=firebase` and either `FIREBASE_SERVICE_ACCOUNT` (a JSON string) or `GOOGLE_APPLICATION_CREDENTIALS` (a local service-account file path).

## API

Interactive documentation is available at `/docs` while the backend runs.

- `GET /healthz` — zero-cost liveness check.
- `POST /scrap` — fetch and extract a public HTTP(S) page.
- `POST /simplify` — scrape/cache a URL and return the unified intelligent summary payload.
- `POST /text-completion` — accept either bounded `text` or `messages` input.
- `POST /image-caption` — describe a public HTTP(S) image with a vision-capable model.

`/scrap`, `/simplify`, `/text-completion`, and `/image-caption` are authenticated/rate-limited by the server access policy. `/openai-test` and `/firestore-test` are disabled unless `ENABLE_TEST_ROUTES=true`.

Example simplification request:

```json
{
  "url": "https://example.com",
  "mode": "intelligent",
  "language": "en",
  "force_regen": false
}
```

## Development and verification

Backend:

```powershell
cd server
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
$env:DATABASE_TYPE = "mock"
pytest -q
ruff check api/routes.py api/security.py api/test_routes.py main.py models/models.py services/scraper.py services/scraping.py utils/openai_client.py test_api.py test_scraping.py test_security.py test_openai_client.py conftest.py
bandit -q -r api main.py models services utils
pip-audit -r requirements.txt
```

Extension:

```powershell
cd wxt
pnpm compile
pnpm test
pnpm build
pnpm audit
pnpm zip
```

Build output is written to `wxt/.output/chrome-mv3`; distributable ZIPs are written under `wxt/.output`.

GitHub Actions runs the regression tests, type checks, security checks, and Chrome packaging on pushes and pull requests. Download its `clearweb-chrome` artifact for a build of that exact revision. When updating the checked-in package, run `pnpm zip` and copy `wxt/.output/clearweb-1.0.0-chrome.zip` to the repository root.

## Project layout

```text
server/
  api/                 FastAPI routes and access controls
  database/            mock, Firebase, and MongoDB adapters
  models/              validated request/response schemas
  services/            scraping and simplification logic
  utils/               OpenAI and language helpers
wxt/
  entrypoints/
    background.ts      capture and translation service worker
    content.ts         page accessibility and magnifier behavior
    options/           settings UI
    sidepanel/         summaries, chat, guides, and controls
```

## Security notes

- Scraping accepts only HTTP(S), rejects credentials and non-public IP ranges, validates every redirect destination, pins connections to validated numeric IP addresses while preserving TLS hostname checks, limits redirect count/download size, and does not inherit ambient proxy settings.
- The server defaults to loopback binding; explicitly set `HOST=0.0.0.0` only when remote access is intended and protected.
- OpenAI keys and database credentials belong in `server/.env` or the deployment's secret manager, never in Git.
- Page caches expire, request bodies are bounded, costly endpoints are rate-limited, and test routes are off by default.
