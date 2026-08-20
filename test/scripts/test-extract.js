'use strict';

/**
 * Phase 3 verification: deep text extraction from TXT, MD, CSV, PDF, DOCX,
 * XLSX — plus corrupt-file resilience and the 50MB size safety ceiling.
 */

const path = require('path');
const assert = require('assert');
const Extractor = require('../../src/main/extractor');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

const CASES = [
  { file: 'notes.txt', marker: 'ZEPHYRQUILT', shared: 'ULTRAVIOLETCOMPASS' },
  { file: 'readme.md', marker: 'NEBULOUSCROWN', shared: 'ULTRAVIOLETCOMPASS' },
  { file: 'data.csv', marker: 'QUIXOTICEMBER', shared: 'ULTRAVIOLETCOMPASS' },
  { file: 'report.pdf', marker: 'LABYRINTHFALCON', shared: 'ULTRAVIOLETCOMPASS' },
  { file: 'charter.docx', marker: 'SERENDIPITYHARBOR', shared: 'ULTRAVIOLETCOMPASS' },
  { file: 'sales.xlsx', marker: 'KALEIDOSCOPEMARBLE', shared: 'ULTRAVIOLETCOMPASS' }
];

async function main() {
  const extractor = new Extractor({ maxFileSizeMB: 50 });

  for (const c of CASES) {
    const res = await extractor.extract(path.join(FIXTURE_DIR, c.file));
    assert.strictEqual(res.skipped, false, `${c.file} must not be skipped (${res.reason})`);
    assert.ok(res.content.length > 0, `${c.file} must yield content`);
    assert.ok(
      res.content.includes(c.marker),
      `${c.file} must contain marker ${c.marker} — got: ${res.content.slice(0, 200)}`
    );
    assert.ok(
      res.content.includes(c.shared),
      `${c.file} must contain shared marker ${c.shared}`
    );
    console.log(`  ${c.file}: extracted ${res.content.length} chars, markers found`);
  }

  // Corrupt PDF must be handled gracefully, never crash.
  const corrupt = await extractor.extract(path.join(FIXTURE_DIR, 'corrupt.pdf'));
  assert.strictEqual(corrupt.skipped, true, 'corrupt file must be skipped');
  assert.ok(corrupt.reason, 'corrupt file must carry a reason');
  console.log(`  corrupt.pdf: gracefully skipped (${corrupt.reason})`);

  // 51MB file must hit the size ceiling.
  const huge = await extractor.extract(path.join(FIXTURE_DIR, 'huge.txt'));
  assert.strictEqual(huge.skipped, true, 'oversized file must be skipped');
  assert.ok(/ceiling/.test(huge.reason), 'skip reason must mention the ceiling');
  console.log(`  huge.txt: skipped by size ceiling (${huge.reason})`);

  // Unsupported extension must be skipped without error.
  const unsupported = await extractor.extract(path.join(FIXTURE_DIR, 'binary.exe'));
  assert.strictEqual(unsupported.skipped, true);

  // Missing file must be skipped without throwing.
  const missing = await extractor.extract(path.join(FIXTURE_DIR, 'does-not-exist.txt'));
  assert.strictEqual(missing.skipped, true);

  console.log('PASS: Phase 3 - Deep text extraction pipeline tests (all 6 formats + safety)');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
