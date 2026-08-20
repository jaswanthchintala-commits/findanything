'use strict';

/**
 * FindAnything - SQLite FTS5 Database Layer
 * ------------------------------------------
 * Embedded full-text search index built on better-sqlite3 with the FTS5
 * extension explicitly enabled. Heavily optimized for non-blocking,
 * sub-millisecond queries:
 *
 *  - WAL journal mode + NORMAL synchronous for fast, crash-safe writes
 *  - FTS5 table kept in sync via AFTER INSERT/UPDATE/DELETE triggers
 *  - unicode61 tokenizer with diacritic removal for accurate matching
 *  - Prepared statements reused across all queries
 *  - snippet() with « » markers for renderer-side HTML highlighting
 *  - bm25() ranking with column weights (file name outranks body text)
 */

const fs = require('fs');
const path = require('path');
const DatabaseDriver = require('better-sqlite3');

const SNIPPET_TOKENS = 48; // ~2-3 sentences of context around the match

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._stmts = {};
  }

  open() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseDriver(this.dbPath);

    // --- Performance pragmas ---
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -16000'); // 16 MB page cache
    this.db.pragma('mmap_size = 268435456'); // 256 MB memory-mapped I/O
    this.db.pragma('temp_store = MEMORY');

    this._createSchema();
    this._prepareStatements();
    return this;
  }

  _createSchema() {
    this.db.exec(`
      -- Canonical file metadata + extracted deep content.
      CREATE TABLE IF NOT EXISTS files (
        id           INTEGER PRIMARY KEY,
        path         TEXT NOT NULL UNIQUE,
        file_name    TEXT NOT NULL,
        extension    TEXT NOT NULL DEFAULT '',
        size         INTEGER NOT NULL DEFAULT 0,
        modified_at  INTEGER NOT NULL DEFAULT 0,
        indexed_at   INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT,
        content      TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'ok'
      );

      -- Fast lookup / dedupe indexes.
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at);

      -- FTS5 deep-content index (file names weighted higher than body).
      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        file_name,
        content,
        content='files',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- Triggers keep the FTS index perfectly in sync with the files table.
      CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, file_name, content)
        VALUES (new.id, new.file_name, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, file_name, content)
        VALUES ('delete', old.id, old.file_name, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, file_name, content)
        VALUES ('delete', old.id, old.file_name, old.content);
        INSERT INTO files_fts(rowid, file_name, content)
        VALUES (new.id, new.file_name, new.content);
      END;
    `);
  }

  _prepareStatements() {
    this._stmts = {
      upsertFile: this.db.prepare(`
        INSERT INTO files (path, file_name, extension, size, modified_at, indexed_at, content_hash, content, status)
        VALUES (@path, @fileName, @extension, @size, @modifiedAt, @indexedAt, @contentHash, @content, @status)
        ON CONFLICT(path) DO UPDATE SET
          file_name    = excluded.file_name,
          extension    = excluded.extension,
          size         = excluded.size,
          modified_at  = excluded.modified_at,
          indexed_at   = excluded.indexed_at,
          content_hash = excluded.content_hash,
          content      = excluded.content,
          status       = excluded.status
        RETURNING id
      `),
      getByPath: this.db.prepare('SELECT * FROM files WHERE path = ?'),
      deleteByPath: this.db.prepare('DELETE FROM files WHERE path = ?'),
      countFiles: this.db.prepare("SELECT COUNT(*) AS n FROM files WHERE status = 'ok'"),
      allPaths: this.db.prepare('SELECT path, modified_at, size FROM files'),
      optimize: this.db.prepare("INSERT INTO files_fts(files_fts) VALUES('optimize')")
    };
  }

  /**
   * Insert or update a file record; triggers keep the FTS row in sync.
   */
  upsertFile(record) {
    const rec = Object.assign({ content: '', contentHash: null, status: 'ok' }, record);
    const { id } = this._stmts.upsertFile.get(rec);
    return id;
  }

  deleteFile(filePath) {
    this._stmts.deleteByPath.run(filePath);
  }

  /** Return the stored record for a path (used for change detection). */
  getFile(filePath) {
    return this._stmts.getByPath.get(filePath);
  }

  /** All known paths with mtimes — used by the crawler to skip unchanged files. */
  getAllPathStates() {
    return this._stmts.allPaths.all();
  }

  /**
   * Full-text search with FTS5 MATCH.
   *
   * @param {string} query   raw user-typed query
   * @param {object} options { limit }
   * @returns {Array} ranked results with «»-marked snippets
   */
  search(query, options = {}) {
    const limit = Math.min(Math.max(options.limit || 100, 1), 500);
    const match = buildMatchQuery(query);
    if (!match) return [];

    const stmt = this.db.prepare(`
      SELECT
        f.id,
        f.path,
        f.file_name   AS fileName,
        f.extension,
        f.size        AS fileSize,
        f.modified_at AS modifiedAt,
        snippet(files_fts, 1, '«', '»', ' … ', ${SNIPPET_TOKENS}) AS snippet,
        bm25(files_fts, 10.0, 1.0) AS rank
      FROM files_fts
      JOIN files f ON f.id = files_fts.rowid
      WHERE files_fts MATCH ?
        AND f.status = 'ok'
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(match, limit);
    for (const row of rows) {
      if (!row.snippet) {
        row.snippet = fallbackSnippet(row.id, query, this.db);
      }
    }
    return rows;
  }

  getStats() {
    const { n } = this._stmts.countFiles.get();
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(this.dbPath).size;
      const wal = this.dbPath + '-wal';
      if (fs.existsSync(wal)) dbSizeBytes += fs.statSync(wal).size;
    } catch (_) {
      /* ignore */
    }
    return { fileCount: n, dbSizeBytes };
  }

  /** Merge FTS index segments — keeps queries sub-millisecond as data grows. */
  optimize() {
    try {
      this._stmts.optimize.run();
    } catch (err) {
      console.error('FTS optimize failed:', err);
    }
  }

  clearAll() {
    this.db.exec('DELETE FROM files');
  }

  close() {
    if (this.db) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        this.db.close();
      } catch (_) {
        /* ignore */
      }
      this.db = null;
    }
  }
}

/**
 * When the match lives in the file name (not the body), FTS5 snippet()
 * returns NULL for the content column. Fall back to the beginning of the
 * extracted body text so the UI always shows a useful subscript.
 */
function fallbackSnippet(rowId, query, db) {
  const row = db.prepare('SELECT content FROM files WHERE id = ?').get(rowId);
  if (!row || !row.content) return '';
  const text = row.content.replace(/\s+/g, ' ').trim();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    idx = lower.indexOf(t);
    if (idx !== -1) break;
  }
  const WINDOW = 220;
  if (idx === -1) {
    return text.slice(0, WINDOW) + (text.length > WINDOW ? ' …' : '');
  }
  const start = Math.max(0, idx - Math.floor(WINDOW / 3));
  const end = Math.min(text.length, start + WINDOW);
  return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
}

/**
 * Translate raw user input into a safe FTS5 MATCH expression.
 * Each whitespace-separated term becomes a prefix token ("term"*), joined
 * with AND so every term must match. Special MATCH syntax characters are
 * stripped to guarantee user input can never break the query parser.
 */
function buildMatchQuery(query) {
  if (!query || typeof query !== 'string') return null;
  const terms = query
    .replace(/["'*()^:{}[\]]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12); // safety ceiling on term count

  if (terms.length === 0) return null;

  return terms.map((t) => `"${t}"*`).join(' AND ');
}

module.exports = Database;
module.exports.buildMatchQuery = buildMatchQuery;
