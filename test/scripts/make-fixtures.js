'use strict';

/**
 * Generate real binary fixtures (PDF, DOCX, XLSX) plus text files with
 * unique marker words, used to verify the deep text extraction pipeline.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const XLSX = require('xlsx');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

const MARKERS = {
  txt: 'ZEPHYRQUILT',
  md: 'NEBULOUSCROWN',
  csv: 'QUIXOTICEMBER',
  pdf: 'LABYRINTHFALCON',
  docx: 'SERENDIPITYHARBOR',
  xlsx: 'KALEIDOSCOPEMARBLE',
  shared: 'ULTRAVIOLETCOMPASS'
};

async function main() {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  // --- Plain text ---
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'notes.txt'),
    `Meeting notes\n\nThe ${MARKERS.txt} project kicked off on Tuesday.\n` +
      `Everyone agreed the ${MARKERS.shared} milestone matters most.\n`.repeat(3)
  );

  // --- Markdown ---
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'readme.md'),
    `# Design Doc\n\nThe ${MARKERS.md} architecture uses a local FTS5 index.\n\n` +
      `See also ${MARKERS.shared} for the shared glossary.\n`
  );

  // --- CSV ---
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'data.csv'),
    `id,name,description\n1,alpha,The ${MARKERS.csv} experiment\n2,beta,Related to ${MARKERS.shared}\n`
  );

  // --- PDF (real binary, generated with pdf-lib) ---
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([612, 792]);
  page.drawText(`Quarterly Report`, { x: 72, y: 720, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText(`The ${MARKERS.pdf} initiative exceeded all expectations this quarter.`, {
    x: 72, y: 680, size: 12, font
  });
  page.drawText(`Cross-reference: ${MARKERS.shared} remains the shared vocabulary token.`, {
    x: 72, y: 660, size: 12, font
  });
  fs.writeFileSync(path.join(FIXTURE_DIR, 'report.pdf'), await pdfDoc.save());

  // --- DOCX (real binary, generated with docx) ---
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun('Project Charter')] }),
          new Paragraph({
            children: [new TextRun(`The ${MARKERS.docx} working group approved the roadmap.`)]
          }),
          new Paragraph({
            children: [new TextRun(`It references the ${MARKERS.shared} glossary entry.`)]
          })
        ]
      }
    ]
  });
  fs.writeFileSync(path.join(FIXTURE_DIR, 'charter.docx'), await Packer.toBuffer(doc));

  // --- XLSX (real binary, generated with SheetJS) ---
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Region', 'Product', 'Notes'],
    ['North', MARKERS.xlsx, 'Flagship launch'],
    ['South', 'Other', `Ties into ${MARKERS.shared} planning`]
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  XLSX.writeFile(wb, path.join(FIXTURE_DIR, 'sales.xlsx'));

  // --- Corrupt file (must not crash the extractor) ---
  fs.writeFileSync(path.join(FIXTURE_DIR, 'corrupt.pdf'), '%PDF-1.4 this is not really a pdf at all {{{{');

  // --- Oversized file (must be skipped by the size ceiling) ---
  const big = Buffer.alloc(51 * 1024 * 1024, 'x');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'huge.txt'), big);

  console.log('Fixtures written to', FIXTURE_DIR);
  console.log('Markers:', JSON.stringify(MARKERS, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
