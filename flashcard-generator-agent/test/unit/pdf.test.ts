import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { batchPdfs, MAX_PDF_PAGES } from "../../src/pdf";

async function makePdf(name: string, pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return new File([await doc.save()], name, { type: "application/pdf" });
}

async function pageCount(file: File): Promise<number> {
  return (await PDFDocument.load(await file.arrayBuffer())).getPageCount();
}

describe("batchPdfs", () => {
  test("passes a PDF within the limits through untouched", async () => {
    const file = await makePdf("small.pdf", 10);
    const batches = await batchPdfs([file]);
    expect(batches).toEqual([[file]]);
    expect(batches[0]?.[0]).toBe(file);
  });

  test("splits a PDF over the page limit into parts that fit", async () => {
    const batches = await batchPdfs([await makePdf("big.pdf", 250)]);
    const files = batches.flat();
    const counts = await Promise.all(files.map(pageCount));

    expect(counts.reduce((a, b) => a + b, 0)).toBe(250);
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_PDF_PAGES);
    expect(files[0]?.name).toBe("big (pages 1-63).pdf");
    for (const batch of batches) {
      const pages = (await Promise.all(batch.map(pageCount))).reduce((a, b) => a + b, 0);
      expect(pages).toBeLessThanOrEqual(MAX_PDF_PAGES);
    }
  });

  test("batches several small PDFs so a request stays under the page limit", async () => {
    const files = await Promise.all([60, 60, 30].map((n, i) => makePdf(`f${i}.pdf`, n)));
    const batches = await batchPdfs(files);
    expect(batches.map((batch) => batch.length)).toEqual([1, 2]);
  });

  test("passes through a file it cannot parse", async () => {
    const broken = new File(["not a pdf"], "broken.pdf", { type: "application/pdf" });
    expect(await batchPdfs([broken])).toEqual([[broken]]);
  });
});
