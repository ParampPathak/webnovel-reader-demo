# Webnovel Reader · Interactive demo

A standalone demonstration of [Webnovel Reader](https://parampathak.com/projects/webnovel-reader/): open original sample stories, turn pages, change reading appearance, and try a short audio excerpt. This is not the private self-hosted application.

## Architecture and privacy

Static HTML, CSS, and JavaScript, served by Cloudflare Pages. Two original stories and original SVG covers are bundled with the source. Reading positions, preferences, and a separate sample-listening cursor live only in this site's browser storage. Reset removes only this demo's storage key.

There is no backend, database, account system, live scraper, analytics, speech-service request, or dependency on the private reader. The importer is explicitly a bundled workflow preview. `connect-src 'none'` blocks fetch, XHR, and WebSocket connections; scripts, images, and media are same-origin. No Pages Functions, Workers, or tunnels are used. Security controls reduce exposure; they are not an absolute-security claim.

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

Tests use desktop WebKit's mobile emulation, not a physical iPhone. In CI, Windows hosts both browsers. The suite complements visual review and does not certify accessibility or hardware behavior.

## Audio and content

`public/assets/signal-room.wav` is a 24-second offline synthetic recording of the opening excerpt in `public/data.js`, generated using eSpeak NG's Emscripten port (`@echogarden/espeak-ng-emscripten` 0.3.5, voice `en-us`, 150 words/minute, 22050 Hz mono PCM). No production speech worker was used. The compiler is a separate GPL-licensed development tool and is not distributed in this runtime; see [eSpeak NG](https://github.com/espeak-ng/espeak-ng) and its license. The recording contains original demonstration prose, not copied library material. The app highlights the recorded excerpt as a whole; it does not claim word-accurate alignment or production Andrew Neural voice quality.

Original demo code, stories, cover artwork, and the original recording are distributed under the accompanying MIT license. Browser-testing dependencies retain their own licenses.

## Deployment

Cloudflare Pages: production branch `main`, build command `npm run verify`, output `dist`, Node.js 24. No environment secrets or runtime bindings are needed. Verify the deployed commit, HTTPS, security headers, exact assets, and browser/network checks before linking a release. Retain a previous Pages deployment for rollback. Never point this project at the private application or publish private source, books, configuration, or caches.
