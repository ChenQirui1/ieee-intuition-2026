# ClearWeb

ClearWeb is a Chrome extension and FastAPI backend that makes public web pages easier to read and use. It provides plain-language summaries, grounded checklists and step-by-step guides, image descriptions, read-aloud support, a magnifier, accessible page styles, optional page translation, and English, Chinese, Malay, and Tamil UI support.

## Run it locally on Windows

Prerequisites: Python 3.11 or newer, Node.js 24, and pnpm 10. The automated checks use Python 3.13.

### 1. Configure and start the backend

Open PowerShell in the repository and run:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Open `server/.env` in a text editor and paste your OpenAI key after `OPENAI_API_KEY=`. Do not put the key in the extension or commit `.env`.

Then start the API:

```powershell
.\run_server.ps1
```

The local server listens only on `http://127.0.0.1:8000`. Verify it at [http://127.0.0.1:8000/healthz](http://127.0.0.1:8000/healthz); the response should be `{"ok":true}`.

The default `DATABASE_TYPE=mock` needs no Firebase or MongoDB account. Its cache is cleared when the backend restarts.

### 2. Build and load the Chrome extension

In a second PowerShell window:

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

## Pre-built Chrome package

`clearweb-1.0.0-chrome.zip` contains the current production build. Extract it first, then use **Load unpacked** and select the extracted folder. Chrome cannot load the ZIP file itself.

The older `clearweb_chrome_extension_old.zip` is retained only for historical reference and should not be installed.

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
