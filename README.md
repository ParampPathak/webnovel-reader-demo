# Webnovel Reader — Browser Reader Mode

A browser-only adaptation of the real Webnovel Reader frontend: the actual compact library, near-black reading surface, CSS-column pagination, native mobile gestures, toolbar, five themes, typography controls, bookmarks, progress recovery and virtualized Contents list. The original private application and its services are separate and unchanged.

**[Open Browser Reader](https://reader.parampathak.com)**

## Read your own EPUBs, locally

Choose **Import EPUB** and select a file from your device; it imports once, automatically. ZIP parsing happens in a local worker; book files and progress are stored in IndexedDB on this browser profile. Nothing is uploaded to a book server, Flask API, TTS worker or cloud library. Book navigation identifiers stay in URL fragments, not HTTP query strings. There are no accounts or cross-device synchronization. Other people using the same browser profile can access that profile's library; this is device-local storage, not an account isolation system.

Use the book menu to export a local JSON backup containing the original EPUB, reading settings/progress and bookmarks. Restore it using the library's backup control. Originals can also be downloaded from reader settings. Deletion removes this browser's book, files, bookmarks and progress. Keep external backups: browser cleanup, private browsing, storage pressure or device management may erase local storage. The optional persistence request is controlled by the browser and is not a durability promise. This site does not install a service worker or promise app-shell availability offline.

## One licensed audio sample

The included original book, **The Signal Room**, has a bundled Kokoro Michael neural recording of its opening paragraph. Headphones start/stop listening, with one mini-player, expanded controls, pause/resume, ±15 seconds, playback speeds through 2×, progress, a sleep timer and excerpt-level highlighting. There is no autoplay. Its full generation/license provenance is [documented](docs/audio-provenance.md).

Imported EPUBs are **reading only**. Live audiobook generation, online novel importing and cross-device syncing are unavailable. The persistent **Browser Reader Mode** notice keeps local-storage and backup guidance visible, with expandable capability and hosting details. The app never silently sends book text to a speech service or connects to the private installation.

## EPUB safety and compatibility

- Maximum 20 MiB compressed EPUB, 8 MiB per extracted member, 64 MiB total expansion, 10,000 ZIP entries and 5,000 spine sections; maximum 100 imported books and 100 MiB local-library accounting budget. Browser quotas can be lower.
- ZIP directory/local-header consistency, unsafe/duplicate paths, symlinks, encryption, unsupported compression, expansion bounds, CRC and extraction timeout checks. ZIP64/multipart/DRM archives are rejected. Extraction is isolated in a terminable worker.
- EPUB 2/3 package/spine handling, EPUB 3 navigation and EPUB 2 NCX. Chapter XML is parsed inertly on demand; external DTD declarations are discarded without resolving, and entity/internal-subset declarations are rejected. Active element names, event handlers and resource attributes are made inert before native XML parsing, then a DOM allowlist reconstructs safe chapter content.
- Only allowlisted structural XHTML survives. Publication scripts, event handlers, forms, frames, SVG, executable URLs, publisher CSS, remote fonts/resources and media are removed. Safe bounded PNG/JPEG/GIF images use browser-local Blob URLs. No external book resource requests are permitted.
- The real reader frame retains same-origin parent navigation and the WebKit gesture compatibility sandbox setting, but its first-head CSP explicitly sets `script-src 'none'`, `default-src 'none'`, Blob-only images, no base URLs and no forms. Both sanitization and native script-blocking tests are required; sandbox tokens alone are not treated as protection.
- This edition is a reflowable text reader. Complex fixed-layout publications, publisher typography, embedded scripts/media, SVG/WebP illustrations, DRM, malformed/non-UTF-8 XML and oversized books may be unsupported or simplified. Without navigation labels, sections use numbered fallback titles. Original files remain unmodified and exportable.

## Build and verify

Node 22+; dependencies are pinned/locked. No runtime secrets or backend configuration.

```sh
npm ci
npm run verify
npx playwright install webkit chromium
node scripts/check-browsers.mjs
```

Browser acceptance uses Windows Playwright WebKit/iPhone-like viewports and Chromium. It imports real generated original-fiction EPUB archives, including hostile content and a 3,001-chapter book. It verifies native trusted touch, reading position/themes/bookmarks/reload, local backup/delete/restore, no upload/API/private/external-content traffic, native CSP script blocking, archive limits, storage failure, actual list geometry/virtualization, sample audio and accessibility. No homelab browser is needed. Synthetic fixtures contain no copyrighted novel content.

The focused library suite (`npm run test:polish`) checks 320/375/390/768/1280/1920px layouts, a real device file-picker interaction, duplicate imports, Unicode/long metadata, missing authors/covers, keyboard menus, filters/favorites, 50 imported/sample books across three pages and deletion of the final page's last item. It also verifies genuine Chromium 200% browser zoom using an isolated temporary profile, and captures real library, import, reader-theme and playing-audio screenshots. Pagination appears only when more than 24 matching books exist.

All runtime scripts/styles/media are content-addressed. Both HTML entry points revalidate; hashed resources are immutable. `asset-manifest.json` records full SHA-256/byte lengths. Deployments must match the exact tested manifest, then pass acceptance on the actual public domain, not just a local preview. Existing public Pages deployments/history remain available for rollback; local browser data must not be reset as part of a code rollback.

## Hosting privacy distinction

The app contains no analytics or private-service endpoint. The custom domain preserves its existing Cloudflare security monitoring, which can emit report-only CSP warnings and standard security-report POSTs to `https://csp-reporting.cloudflare.com`. Existing NEL/reporting headers may also be present. This is not a promise of zero hosting-provider reporting or access logs. Release receipts distinguish verified hosting policy/delivery diagnostics from application errors; unexpected origins, uploads, HTTP API calls and enforced CSP failures still fail acceptance. No zone-wide security setting is disabled for this project.

## Source and licenses

Only the separately audited browser repository is public. The original production repository remains private. See [THIRD_PARTY.md](THIRD_PARTY.md), the retained MIT license, exact frontend provenance and audio/fflate license notices. No production databases, caches, books, service credentials, internal network configuration or backend/container dependencies are published.
