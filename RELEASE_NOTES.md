# FindAnything v1.1.0

FindAnything is a modern desktop indexing and search application inspired by the classic Google Desktop experience. It indexes file names and deep document content locally so users can search their own files instantly.

## Downloads

| Platform | File |
|---|---|
| Windows 10/11 x64 | `FindAnything-Setup-1.1.0-x64.exe` |
| macOS Intel | `FindAnything-1.1.0-x64.zip` |
| macOS Apple Silicon | `FindAnything-1.1.0-arm64.zip` |

## Included in this release

- Fixed an indexing deadlock where normal keyboard/mouse activity paused the initial crawl indefinitely, leaving the search index empty for active users
- Fixed punctuation-normalized search so queries such as `variable-cycle engine` match document content correctly
- Added deep extraction for PPTX, HTML, XML, JSON, logs, and common source/configuration files
- Added visible counts for files indexed and files containing searchable text
- Added a cross-platform PowerPoint Open XML extractor using JSZip
- Added production regression coverage for real deep-content queries and the Electron UI flow

- Instant local search with a lightweight debounced search box
- Deep-content indexing for TXT, Markdown, CSV, PDF, DOCX, XLSX, PPTX, HTML/XML/JSON, and common source files
- Google Desktop-style result layout with clickable file titles, highlighted snippets, and metadata subscripts
- Background crawler with incremental re-indexing
- Native file watching for created, modified, and deleted files
- Hardware throttling that pauses for high CPU pressure or explicit user pause, without blocking the initial crawl during normal activity
- Local-only configuration and index storage

## Install notes

### Windows

Download and run `FindAnything-Setup-1.1.0-x64.exe`.

### macOS

Download the ZIP for your Mac architecture, extract it, and move `FindAnything.app` to `Applications`.

The macOS bundles are unsigned. If macOS blocks the first launch, right-click the app and choose **Open**.

## Checksums

```text
2c3499865e2d5e5f973d75f5533d566d77ada2b24ca563811d5c4656cacdbc1a  FindAnything-Setup-1.0.0-x64.exe
785b78bac6636f53cf547d7f8559063689a753d1cd5a25bbf555a25b72d68a5a  FindAnything-1.0.0-x64.zip
cc1b7c851aebbac96ba41fa6ff7bf71a572259ca0b44b679c0673b1936974813  FindAnything-1.0.0-arm64.zip
```
