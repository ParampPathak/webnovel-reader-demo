# Browser Reader provenance and licenses

Original application source is MIT, Copyright (c) 2026 Param Pathak. This browser edition adapts selected original frontend files from `ParampPathak/Webnovel-Reader` revision `4ba14ec34e9c0bb786cba528e0acd9efb8edac6d`, not its backend or private operational data. Exact source paths and Git-blob SHA-256 values are recorded in [frontend-provenance.json](docs/frontend-provenance.json).

Reused: library/reader templates, library/reader JavaScript, rendered-column pagination, narration markup, library CSS and immersive CSS. Browser-specific differences replace server API calls with IndexedDB operations, use fragment-only book routes, bundle local resources, scope narration to the licensed sample, validate persisted preferences, and add the storage-mode notice/accessibility corrections. No second EPUB pagination engine was introduced.

The source review found no Readest implementation/assets/dependencies in these selected frontend files. Similar reading gestures/style alone are not a claim of copying or a reason to relicense independently authored code. This is a scoped source/provenance review, not a forensic guarantee about undisclosed influences. No Python, EbookLib, Piper, edge-tts, FFmpeg, private database, container or voice-model binary is included in this distribution. Their separate private-runtime licensing questions do not become browser dependencies by reusing original frontend code.

## Bundled ZIP dependency

`fflate` **0.8.3**, from the official npm package and [upstream repository](https://github.com/101arrowz/fflate), MIT, Copyright (c) 2026 Arjun Barrett. Version and registry integrity are locked in `package-lock.json`. Its UMD browser build is bundled during the build, with no CDN dependency. Full notice: [fflate-MIT.txt](docs/licenses/fflate-MIT.txt). ZIP validation/limits, XML parsing and strict content sanitization are application code; fflate alone is not treated as an EPUB security boundary.

## Sample fiction and audio

The Signal Room and its SVG cover are original demo content. Only one sample book is seeded. The unchanged bundled MP3 uses Kokoro `am_michael`, not Microsoft Andrew. Apache model/tool notices, exact recording/model/voice hashes, generation provenance and review limitations remain in [audio-provenance.md](docs/audio-provenance.md). No visitor text is sent to a speech service. Precise word timestamps are not fabricated; the recorded opening paragraph is highlighted as a whole.

Uploaded EPUB contents are not distributed with the application. Users must have the rights to read their files. No copyrighted novels/covers, private caches, credentials, private infrastructure endpoints, private hostnames or owner library data were copied into this repository.
