# Webnovel Reader · Interactive demo

A standalone demonstration of [Webnovel Reader](https://parampathak.com/projects/webnovel-reader/): open original sample stories, turn pages, change reading appearance, and try a short audio excerpt. This is not the private self-hosted application.

## Architecture and privacy

Static HTML, CSS, and JavaScript, served by Cloudflare Pages. Two original stories and original SVG covers are bundled with the source. Reading positions, preferences, and a separate sample-listening cursor live only in this site's browser storage. Reset removes only this demo's storage key.

There is no backend, database, account system, live scraper, application analytics, speech-service request, or dependency on the private reader. The importer is explicitly a bundled workflow preview. CSP allows connections only to this static site's own origin: one fixed MP3 asset is fetched without credentials and prebuffered into a local Blob for reliable seeking on hosts without byte-range support. Media is limited to same-origin assets and local blobs; other origins remain blocked. No Pages Functions, Workers, or tunnels are used. Provider-level security reporting on a custom domain is a separate hosting configuration and is not an application dependency. These controls are not an absolute-security claim.

The custom domain preserves its existing Cloudflare client-side security monitoring. Cloudflare may add a report-only policy and send browser security reports to `https://csp-reporting.cloudflare.com`; therefore the hosted domain is not represented as having zero external provider reporting. Browser release checks explicitly record only standard CSP-report POSTs to that exact provider origin and continue to reject every other unexpected origin. The application bundles no analytics or private-service endpoints. No zone-wide security monitoring is disabled by this project.

## Try it locally

Node.js 22+:

```sh
npm ci
npm run verify
npm run dev
```

Open the loopback preview reported by the server. Production files are in `dist/`. Runtime has no package dependencies; development dependencies are only for browser verification. The HTTP-only local preview omits CSP's HTTPS-upgrade directive; the deployed `_headers` retains it.

## Verification

```sh
npx playwright install chromium webkit
npm run test:browser
```

Start the preview first. Browser checks cover five widths, WebKit protocol-dispatched trusted touch input, pagination, chapter transitions, typography, themes, reload recovery, native audio playback, headphones ON/OFF, pause/resume, ±15-second seeking, 2× playback, importer preview, and reset. Network interception rejects every origin except the demo's origin, making private infrastructure unreachable to the test session. `DEMO_URL` can target the deployed static site. Browser receipts and screenshots go to ignored `test-results/`.

Acceptance runs locally on Windows with both WebKit and Chromium. Tests use mobile emulation, not physical iPhone hardware. Hosted Windows Server WebKit stalled before navigation in observed CI runs, so hosted CI retains the same assertions across Windows Chromium and macOS WebKit. No browsers run on the private Ubuntu server. The manual Public release verification workflow checks deployed bytes and the public site from hosted machines outside the homelab. Tests complement visual review; they are not hardware or accessibility certification.

## Audio and content

`public/assets/signal-room.mp3` is a 24-second static synthetic recording of the opening excerpt in `public/data.js`. Speech was generated offline with eSpeak NG 0.3.5 (Emscripten port, en-us voice, 150 words/minute), then encoded with FFmpeg as 64 kbit/s, 22050 Hz mono MP3 with a seek header. No production TTS worker was used. The GPL-licensed compilers are development tools, not distributed runtime dependencies. The recording contains original prose, not private library material. Highlighting identifies the recorded excerpt, not individual words or production Andrew Neural voice quality.

Original demo code, stories, cover artwork, and the original recording are distributed under the accompanying MIT license. Browser-testing dependencies retain their own licenses.

## Deployment

Cloudflare Pages: production branch `main`, build command `npm run verify`, output `dist`, Node.js 24. No environment secrets or runtime bindings are needed. Verify the deployed commit, HTTPS, security headers, exact assets, and browser/network checks before linking a release. Retain a previous Pages deployment for rollback. Never point this project at the private application or publish private source, books, configuration, or caches.

The deterministic build replaces source asset paths with SHA-256-fingerprinted filenames, including JavaScript, CSS, the data module, SVGs and MP3. Dependencies are rewritten before their importing script is hashed. HTML revalidates; fingerprinted assets are immutable. The generated manifest records exact bytes and hashes, and deployment checks compare all referenced files against that tested build. Windows and hosted builds normalize text line endings identically. Old edge/browser cache entries cannot masquerade as a new filename. No zone-wide cache policy changes are required; prior deployment artifacts remain available for rollback.
