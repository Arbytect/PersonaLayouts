const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const QA_DIR = path.join(OUTPUT_DIR, 'qa');
const MIN_REASONABLE_BYTES = 50 * 1024;

function countPdfPages(buffer) {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  if (matches && matches.length > 0) return { count: matches.length, viaFallback: false };

  // Fallback: some PDFs (e.g. ones using cross-reference/object streams) compress leaf
  // /Type /Page objects so a raw text scan finds none, even though the PDF has pages.
  // The /Pages tree root's /Count entry is a second, independent signal of page count and
  // is typically not itself compressed, so use it to avoid a false "0 pages" failure.
  const pagesTreeMatch = text.match(/\/Type\s*\/Pages\b[\s\S]{0,300}?\/Count\s+(\d+)/);
  if (pagesTreeMatch) return { count: Number(pagesTreeMatch[1]), viaFallback: true };

  return { count: 0, viaFallback: false };
}

function hasUnresolvedPlaceholder(buffer) {
  const text = buffer.toString('utf8');
  return /{{[A-Z0-9_]+}}/.test(text);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  console.error('Missing output directory. Generate at least one PDF first.');
  process.exit(1);
}

const pdfFiles = fs.readdirSync(OUTPUT_DIR)
  .filter(fileName => fileName.toLowerCase().endsWith('.pdf'))
  .sort();

if (pdfFiles.length === 0) {
  console.error('No PDF files found in output/.');
  process.exit(1);
}

fs.mkdirSync(QA_DIR, { recursive: true });

const report = {
  generated_at: new Date().toISOString(),
  output_dir: OUTPUT_DIR,
  pdf_count: pdfFiles.length,
  files: []
};

let failureCount = 0;

for (const fileName of pdfFiles) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  const buffer = fs.readFileSync(filePath);
  const sizeBytes = buffer.length;
  const { count: pageCount, viaFallback: pageCountViaFallback } = countPdfPages(buffer);
  const issues = [];

  if (sizeBytes < MIN_REASONABLE_BYTES) {
    issues.push(`PDF is unusually small (${sizeBytes} bytes).`);
  }

  if (pageCount === 0) {
    issues.push('Could not detect any PDF pages.');
  } else if (pageCountViaFallback) {
    // Not a failure, just informational: the primary /Type /Page scan found nothing
    // (likely a compressed object stream), so this count came from the /Pages tree /Count instead.
    issues.push(`Page count (${pageCount}) detected via /Pages tree fallback, not direct /Type /Page scan.`);
  }

  if (hasUnresolvedPlaceholder(buffer)) {
    issues.push('Possible unresolved {{PLACEHOLDER}} token in PDF stream.');
  }

  // Only the "no pages detected at all" and placeholder issues should fail QA; the fallback
  // notice above is informational and shouldn't block delivery on its own.
  const hasBlockingIssue = pageCount === 0 || hasUnresolvedPlaceholder(buffer) || sizeBytes < MIN_REASONABLE_BYTES;
  if (hasBlockingIssue) failureCount++;

  report.files.push({
    file: fileName,
    size_bytes: sizeBytes,
    page_count: pageCount,
    page_count_via_fallback: pageCountViaFallback,
    status: hasBlockingIssue ? 'needs_review' : (issues.length > 0 ? 'ok_with_notes' : 'ok'),
    issues
  });
}

const reportPath = path.join(QA_DIR, 'pdf_qa_report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Checked ${pdfFiles.length} PDF file(s).`);
console.log(`QA report: ${path.relative(ROOT, reportPath)}`);

if (failureCount > 0) {
  console.error(`${failureCount} PDF file(s) need review.`);
  process.exit(1);
}

console.log('PDF QA passed.');
