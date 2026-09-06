# ClearWeb audit fixes

This change addresses the previously reported backend, extension, packaging, and documentation defects.

| Area | Fix |
| --- | --- |
| Scraper network access | Validate HTTP(S) URLs and every redirect; reject non-public addresses, including carrier-grade NAT; connect to validated numeric IPs while keeping the original hostname for TLS verification. Disable ambient proxies and close responses on success and failure. |
| API exposure and cost | Bind locally by default, disable trusted forwarded-client headers in launch scripts, require a configured key for remote use, check browser origins, require JSON for POST requests, cap bodies at 96 KB, and rate-limit costly routes. Diagnostic routes are disabled by default and protected when enabled. |
| Health check | Use `/healthz`, which performs no AI or database request. |
| Image descriptions | Implement `/image-caption` with actual multimodal input and an independent vision-model setting. Preserve legacy text-model overrides and reject empty or truncated provider responses. |
| Tab switching and reloads | Cancel abandoned requests immediately, ignore messages from other tabs, clear context on navigation/reload, restore each tab's interaction modes, and prevent abandoned translation jobs from filling a new page's cache. |
| Magnifier | Keep captures below Chrome's quota, reject inactive-tab capture requests, and discard captures when the active tab changes during capture. Restore the page's original cursor and style priorities. |
| Toolbar | Declare the extension action and enable opening ClearWeb from its pinned toolbar icon. |
| Preferences | Wire the legacy `simplifyLanguage` setting to optional page translation, label it “Translate Page,” and implement the page-location breadcrumb display. |
| Page styles | Limit ad hiding to explicit ad markers instead of generic banner/substring matches; restore original hover styles and `!important` priorities. |
| API contract | Validate bounded text/message inputs, remove the unused `/chat` client and commented-out route, support the unified intelligent mode, and keep request cancellation active until response bodies finish. |
| Errors and cache | Preserve deliberate scraper HTTP errors and expire cached page content before reuse. |
| Dependencies and tests | Update vulnerable dependencies, replace false-green boolean tests with assertions, add backend and extension regressions, and add GitHub Actions verification and build artifacts. |
| Install package and docs | Rebuild the production Chrome ZIP and replace stale setup/API documentation with the actual local workflow. |

## Verification

- 32 backend tests and 8 extension tests run without external AI calls.
- TypeScript compilation and the production Chrome ZIP build pass.
- Changed backend files pass Ruff; backend code passes Bandit.
- Python dependency consistency checks pass; Python and pnpm audits report no known vulnerabilities at verification time.
- A real HTTPS scrape of `https://example.com` succeeds with the protected connection implementation.

These checks do not prove the absence of all defects. Live OpenAI output was not tested because this checkout has no configured OpenAI key. Automated access to Chrome's extensions page was blocked by browser security policy, so the installed-extension checks below remain manual.

## Check the updated extension in Chrome

1. Configure `server/.env` using `.env.example`, add `OPENAI_API_KEY`, and start `server/run_server.ps1`.
2. On `chrome://extensions/`, reload ClearWeb if it points to `wxt/.output/chrome-mv3`. If it uses an extracted ZIP elsewhere, extract the updated root ZIP and load that folder.
3. Refresh a public webpage, click the pinned ClearWeb icon, and verify the connection indicator and summary.
4. Enable the magnifier, move it over text, switch tabs, and return. Verify that it shows the correct page and restores its tab's mode.
5. Start a summary or chat reply, then navigate/reload/switch tabs before it finishes. Old content must not appear in the new page context.
6. Select a public image and request a description. Toggle page translation, breadcrumbs, and ad hiding; switch them off again and check that normal page styles remain.

## Deployment limits

The static API access key is for controlled deployments and is extractable from a custom extension bundle. A public service needs user authentication and shared quotas. Current rate limits are in-memory and per process. The scraper is for public HTTP(S) pages; it does not scrape authenticated browser sessions or render JavaScript-only content.

Model compatibility was checked using the OpenAI documentation skill and [OpenAI's Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna). The toolbar behavior follows [Chrome's Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
