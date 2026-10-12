import { PDFDocument } from "pdf-lib";

// Anthropic accepts at most 600 pages per request, but only 100 when the context window is under 1M tokens,
// and 32 MB per request. The byte limit is lower because PDFs are base64-encoded in the request.
export const MAX_PDF_PAGES = 100;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

type PdfUnit = { file: File; pages: number };

// Groups PDFs into batches that each fit in one model request. A PDF within the limits is passed through
// untouched; only one that exceeds the page or size limit is split into smaller PDFs.
export async function batchPdfs(files: File[]): Promise<File[][]> {
  const units: PdfUnit[] = [];
  for (const file of files) {
    units.push(...(await splitPdf(file)));
  }

  const batches: File[][] = [];
  let current: File[] = [];
  let pages = 0;
  let bytes = 0;
  for (const unit of units) {
    if (
      current.length > 0 &&
      (pages + unit.pages > MAX_PDF_PAGES || bytes + unit.file.size > MAX_PDF_BYTES)
    ) {
      batches.push(current);
      current = [];
      pages = 0;
      bytes = 0;
    }
    current.push(unit.file);
    pages += unit.pages;
    bytes += unit.file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function splitPdf(file: File): Promise<PdfUnit[]> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch {
    // Unreadable or encrypted: send it as is and let the model provider report any problem.
    return [{ file, pages: 1 }];
  }

  const total = source.getPageCount();
  if (total <= MAX_PDF_PAGES && file.size <= MAX_PDF_BYTES) {
    return [{ file, pages: total }];
  }

  const baseName = file.name.replace(/\.pdf$/i, "");
  return extractRange(source, 0, total, file.size, baseName);
}

// Halves the page range until every piece fits the limits (or is a single page).
async function extractRange(
  source: PDFDocument,
  start: number,
  end: number,
  knownSize: number | undefined,
  baseName: string,
): Promise<PdfUnit[]> {
  const count = end - start;
  if (count > MAX_PDF_PAGES) {
    const mid = start + Math.ceil(count / 2);
    return [
      ...(await extractRange(source, start, mid, undefined, baseName)),
      ...(await extractRange(source, mid, end, undefined, baseName)),
    ];
  }

  const part = await PDFDocument.create();
  const pages = await part.copyPages(
    source,
    Array.from({ length: count }, (_, i) => start + i),
  );
  for (const page of pages) part.addPage(page);
  const bytes = await part.save();

  if (bytes.length > MAX_PDF_BYTES && count > 1) {
    const mid = start + Math.ceil(count / 2);
    return [
      ...(await extractRange(source, start, mid, undefined, baseName)),
      ...(await extractRange(source, mid, end, undefined, baseName)),
    ];
  }

  const file = new File([bytes], `${baseName} (pages ${start + 1}-${end}).pdf`, {
    type: "application/pdf",
  });
  return [{ file, pages: count }];
}
