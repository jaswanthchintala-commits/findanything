# FindAnything

**Super Google Desktop** — an instant, deep-content local file search engine for Windows and macOS, rebuilt on the architectural logic and UI layout of the classic Google Desktop (2011) platform.

FindAnything indexes the **names and entire contents** of your documents and returns ranked results **as you type**, with highlighted snippets showing exactly where your keywords appear inside each file.

![Search results](https://private-us-east-1.manuscdn.com/sessionFile/KHIvUWZgIjb5Z1mAkbKcDN/sandbox/P7qJxMzFVmUhUTWkcrCHmi-images_1787234151954_na1fn_L2hvbWUvdWJ1bnR1L2ZpbmRhbnl0aGluZy90ZXN0L3NjcmVlbnNob3RzLzItc2VhcmNoLXJlc3VsdHM.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvS0hJdlVXWmdJamI1WjFtQWtiS2NETi9zYW5kYm94L1A3cUp4TXpGVm1VaFVUV2tjckNIbWktaW1hZ2VzXzE3ODcyMzQxNTE5NTRfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyWnBibVJoYm5sMGFHbHVaeTkwWlhOMEwzTmpjbVZsYm5Ob2IzUnpMekl0YzJWaGNtTm9MWEpsYzNWc2RITS5wbmciLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3ODk0MzA0MDB9fX1dfQ__&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEUCIBaewUUV1KC2aBqYogPRSeivNG7jwBm91hRluoCI2AYmAiEAh9rIswuNBFzFfXNDBYuR~JWMYKFfkDUJAS5o1HUclDw_)

---

## Features

| Capability | Details |
|---|---|
| **Instant search** | 40 ms keystroke debounce; sub-millisecond FTS5 queries (measured avg ~1.5 ms over 2,000 documents) |
| **Deep content indexing** | Full text extraction from `.txt`, `.md`, `.csv`, `.pdf`, `.docx`, `.xlsx`, `.pptx`, HTML/XML/JSON, logs, and common source-code/configuration files |
| **Google Desktop result layout** | Clickable title line → highlighted content snippet → metadata subscript (OS-native path, size, modified date) |
| **Real-time watcher** | chokidar over native OS APIs (ReadDirectoryChangesW / FSEvents / inotify) — creations, edits and deletions appear instantly |
| **Hardware throttling** | CPU load-average hysteresis; normal keyboard/mouse activity no longer blocks the initial index, while high CPU pressure and manual pause remain respected |
| **Privacy-first** | Everything — config, index database, extracted text — stays strictly on the local machine |
| **Permission gating** | First-launch modal requires explicit authorization before anything is scanned |
| **Safety ceilings** | Files over 50 MB are skipped for content (names still indexed); corrupt files can never crash the app; extracted text is capped at 2 million characters |

## Tech Stack

- **Electron 35** (Node.js + Chromium), plain JavaScript
- **better-sqlite3** with the **FTS5** extension (unicode61 tokenizer, BM25 ranking, `snippet()` highlighting)
- **pdfjs-dist** (Mozilla PDF.js) for PDF text, **mammoth** for DOCX, **SheetJS/xlsx** for Excel
- **JSZip** for cross-platform PowerPoint Open XML slide extraction
- **chokidar** for native file watching
- **electron-builder** for Windows (NSIS `.exe`) and macOS (`.dmg` / `.zip`, x64 + arm64) packaging

## Project Layout

```
findanything/
├── package.json                  # dependencies, scripts, electron-builder config
├── build/
│   ├── entitlements.mac.plist    # macOS hardened-runtime entitlements
│   └── stage-prebuilds.js        # downloads correct better-sqlite3 ABI per target
├── src/
│   ├── main/
│   │   ├── main.js               # app lifecycle, window, permission-gated engine boot
│   │   ├── configStore.js        # JSON config: permission, include/exclude dirs
│   │   ├── database.js           # SQLite FTS5 schema, triggers, search, snippets
│   │   ├── extractor.js          # deep text extraction (txt/md/csv/pdf/docx/xlsx)
│   │   ├── indexer.js            # background crawler, incremental state, queue
│   │   ├── watcher.js            # chokidar native file watcher
│   │   ├── throttle.js           # CPU + user-activity throttle monitor
│   │   └── ipc.js                # all renderer↔main IPC channels
│   ├── preload/preload.js        # contextBridge API (contextIsolation on)
│   └── renderer/
│       ├── index.html            # permission modal, app shell, settings panel
│       ├── css/style.css         # Google Desktop-inspired styling
│       └── js/renderer.js        # debounced search, result rendering, settings
└── test/
    ├── fixtures/                 # generated real PDF/DOCX/XLSX/TXT fixtures
    ├── screenshots/              # captured UI verification shots
    └── scripts/                  # per-phase automated test suites
```

## Running from Source

```bash
npm install          # postinstall auto-rebuilds better-sqlite3 for Electron
npm start            # launch FindAnything
```

On first launch you'll see the permission modal — nothing is scanned until you grant access and choose folders.

## Tests

Every phase ships with an automated suite:

```bash
npm run test:all      # Phases 1–4 (config, FTS5 db, extraction, crawler/watcher/throttle)
npm run test:e2e      # Phase 5: drives the real Electron UI via CDP (needs xvfb on Linux)
```

Verified results:

- **Phase 1** — permission persistence, directory config JSON, dedupe/normalization
- **Phase 2** — FTS5 CRUD, prefix search, snippet markers, BM25 ranking, 2,000-doc bulk insert at 0.10 ms/doc, average query latency **1.5 ms**
- **Phase 3** — unique marker words recovered from real PDF, DOCX, XLSX, TXT, MD, CSV, HTML, JSON, TypeScript, and PPTX content; corrupt PDF handled gracefully; 51 MB file stopped by the size ceiling
- **Phase 4** — initial crawl, incremental skip of unchanged files, real-time add/change/unlink watcher events, CPU-hysteresis throttling, manual pause/resume
- **Phase 5 (E2E)** — permission modal → grant flow → live indexing → result layout (title/highlighted snippet/metadata) → debounce collapses 10 rapid keystrokes into 1 query → bounded file-open IPC round-trip

The production hardening suite also verifies punctuation-normalized queries such as `variable-cycle engine`, which match the words inside the document instead of treating the hyphenated phrase as an impossible literal FTS token.

## Building Installers

```bash
npm run dist:win      # Windows: FindAnything-Setup-1.0.0-x64.exe (NSIS) + portable
npm run dist:mac      # macOS: .dmg + .zip for both Intel (x64) and Apple Silicon (arm64)
npm run dist:all      # everything
```

`build/stage-prebuilds.js` automatically downloads the official better-sqlite3 prebuilt binary matching each target (Electron ABI v133, win32/darwin × x64/arm64) before packing, so cross-builds produce working native modules.

> **Note on macOS DMGs from Linux:** DMG creation requires a macOS host (the `dmg-license` toolchain is darwin-only). Cross-building from Linux produces the signed-ready `.app` bundles inside `.zip` archives for both architectures — verified in this repository. On a macOS machine, `npm run dist:mac` produces the DMGs directly.

## Configuration

All data lives in the OS user-data directory:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\findanything\` |
| macOS | `~/Library/Application Support/findanything/` |
| Linux | `~/.config/findanything/` |

- `findanything-config.json` — permission flag, include/exclude folders, size ceiling
- `findanything-index.db` — SQLite FTS5 index (WAL mode)

## Keyboard Shortcuts

- `Ctrl/Cmd + K` — focus the search box
- `Esc` — close the settings panel
