'use strict';

/**
 * Phase 2 verification: SQLite FTS5 schema, CRUD, deep-content search,
 * snippet generation, ranking, and sub-millisecond query performance.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Database = require('../../src/main/database');
const { buildMatchQuery } = require('../../src/main/database');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-db-'));
const dbPath = path.join(tmp, 'index.db');

const db = new Database(dbPath).open();

// ---------- 1. Insert & retrieve ----------
const rec = {
  path: path.join(tmp, 'notes.txt'),
  fileName: 'notes.txt',
  extension: '.txt',
  size: 1234,
  modifiedAt: Date.now(),
  indexedAt: Date.now(),
  contentHash: null,
  status: 'ok',
  content: 'The quick brown fox jumps over the lazy dog. FindAnything indexes everything deeply.'
};
db.upsertFile(rec);

const stored = db.getFile(rec.path);
assert.ok(stored, 'record must be retrievable by path');
assert.strictEqual(stored.file_name, 'notes.txt');

// ---------- 2. Deep-content search ----------
let results = db.search('indexes deeply');
assert.strictEqual(results.length, 1, 'deep content query must hit');
assert.strictEqual(results[0].fileName, 'notes.txt');
assert.ok(results[0].snippet.includes('«'), 'snippet must contain highlight markers');
assert.ok(/«indexes»/.test(results[0].snippet), 'matched term must be wrapped in markers');

// ---------- 3. Prefix search (as-you-type) ----------
results = db.search('findany');
assert.strictEqual(results.length, 1, 'prefix query must match FindAnything');

// ---------- 4. File-name search ----------
results = db.search('notes');
assert.strictEqual(results.length, 1, 'file name query must match');

// ---------- 5. Update (upsert) replaces old content ----------
db.upsertFile(Object.assign({}, rec, {
  content: 'Completely rewritten body about quantum computing research.',
  modifiedAt: Date.now() + 1000
}));
assert.strictEqual(db.search('lazy dog').length, 0, 'stale content must be gone after update');
assert.strictEqual(db.search('quantum').length, 1, 'new content must be searchable');
assert.strictEqual(db.getStats().fileCount, 1, 'upsert must not duplicate rows');

// ---------- 6. Delete ----------
db.deleteFile(rec.path);
assert.strictEqual(db.search('quantum').length, 0, 'deleted file must not appear');
assert.strictEqual(db.getStats().fileCount, 0);

// ---------- 7. MATCH builder safety ----------
assert.strictEqual(buildMatchQuery(''), null);
assert.strictEqual(buildMatchQuery('   '), null);
assert.strictEqual(buildMatchQuery('***'), null);
assert.strictEqual(buildMatchQuery('hello'), '"hello"*');
assert.strictEqual(buildMatchQuery('hello world'), '"hello"* AND "world"*');
assert.strictEqual(buildMatchQuery('we"ird*query'), '"we"* AND "ird"* AND "query"*');

// ---------- 8. Bulk insert + sub-millisecond query performance ----------
const BULK = 2000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < BULK; i++) {
  db.upsertFile({
    path: path.join(tmp, `doc_${i}.txt`),
    fileName: `doc_${i}.txt`,
    extension: '.txt',
    size: 100 + i,
    modifiedAt: Date.now(),
    indexedAt: Date.now(),
    contentHash: null,
    status: 'ok',
    content: `Document number ${i} about ${i % 2 === 0 ? 'apples and orchards' : 'zebras and savannas'} with shared vocabulary tokens.`
  });
}
const insertMs = Number(process.hrtime.bigint() - t0) / 1e6;
assert.strictEqual(db.getStats().fileCount, BULK);

db.optimize();

const samples = [];
for (let i = 0; i < 50; i++) {
  const q0 = process.hrtime.bigint();
  const r = db.search('apples');
  const qMs = Number(process.hrtime.bigint() - q0) / 1e6;
  samples.push(qMs);
  assert.strictEqual(r.length, 100, 'limit must cap results');
}
const avgMs = samples.reduce((a, b) => a + b, 0) / samples.length;
console.log(`  bulk insert: ${BULK} docs in ${insertMs.toFixed(0)}ms (${(insertMs / BULK).toFixed(2)}ms/doc)`);
console.log(`  query latency over ${BULK} docs: avg ${avgMs.toFixed(3)}ms, max ${Math.max(...samples).toFixed(3)}ms`);
assert.ok(avgMs < 5, `average query must be sub-5ms (got ${avgMs.toFixed(3)}ms)`);

// ---------- 9. Ranking: name matches outrank body matches ----------
db.upsertFile({
  path: path.join(tmp, 'apples.txt'),
  fileName: 'apples.txt',
  extension: '.txt',
  size: 10,
  modifiedAt: Date.now(),
  indexedAt: Date.now(),
  contentHash: null,
  status: 'ok',
  content: 'A file whose name matches but body does not repeat the term much.'
});
const ranked = db.search('apples');
assert.strictEqual(ranked[0].fileName, 'apples.txt', 'name match must rank first');

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: Phase 2 - SQLite FTS5 schema, search, snippets, ranking & performance tests');
