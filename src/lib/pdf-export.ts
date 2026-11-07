import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ServiceError, type ProjectDraft } from "./contract.ts";
import { getBoardModel, selectedPronunciations, validateLayout, validateSnapshot } from "./project.ts";
import { getPdfPreviewSize } from "./pdf-layout.ts";

export async function createDraftPdf(project: ProjectDraft, options: { fontsReady: boolean; notes?: string; signal?: AbortSignal }): Promise<Uint8Array> {
  const invalid = validateSnapshot(project) ?? validateLayout(project.layout);
  if (invalid) throw new ServiceError("INVALID_PDF_SNAPSHOT", invalid);
  if (!options.fontsReady) throw new ServiceError("PDF_FONT_NOT_READY", "Tunggu font lokal siap sebelum membuat PDF. Muat ulang font lalu coba lagi.");
  options.signal?.throwIfAborted();
  const loaded = await Promise.all([document.fonts.load("24px 'Noto Sans Balinese'", project.transliteration!.balineseUnicode), document.fonts.load("16px 'IBM Plex Sans'")]);
  if (!loaded.every((faces) => faces.length > 0)) throw new ServiceError("PDF_FONT_NOT_READY", "Font lokal belum tersedia untuk PDF. Draf tetap tersimpan; coba muat font kembali.");
  options.signal?.throwIfAborted();
  const model = getBoardModel(project);
  const size = getPdfPreviewSize(model.width, model.height);
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ServiceError("PDF_EXPORT_FAILED", "Peramban belum dapat menyiapkan gambar papan untuk PDF. Coba lagi atau gunakan SVG.");
  context.fillStyle = "#fffefd"; context.fillRect(0, 0, size.width, size.height);
  context.scale(size.width / model.width, size.height / model.height);
  context.fillStyle = "#171c19"; context.textAlign = model.anchor === "middle" ? "center" : "left"; context.textBaseline = "alphabetic";
  context.font = `${model.sample.size}px 'Noto Sans Balinese'`; context.fillText(model.sample.text, model.x, model.sample.y);
  for (const line of model.latin) { context.font = `${line.size}px 'IBM Plex Sans'`; context.fillText(line.text, model.x, line.y); }
  context.fillStyle = "#59625c"; context.textAlign = "center"; context.font = "13px 'IBM Plex Sans'";
  for (const note of model.notes) context.fillText(note.text, model.width / 2, note.y);
  async function pngBytes(target: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob>((resolve, reject) => target.toBlob((value) => value ? resolve(value) : reject(new ServiceError("PDF_EXPORT_FAILED", "Gambar PDF belum dapat dibuat. Coba lagi; draf tidak dihapus.")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }
  const boardBytes = await pngBytes(canvas);
  options.signal?.throwIfAborted();
  const pdf = await PDFDocument.create(); pdf.setTitle("NYURAT.AI - Draf pemeriksaan"); pdf.setSubject(`Unreviewed draft, revision ${project.revision}; A4 scaled raster proof, not production`); pdf.setCreator("NYURAT.AI local frontend");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([841.89, 595.28]);
  const ink = rgb(.176, .188, .165); const muted = rgb(.412, .412, .373);
  page.drawText("NYURAT.AI / Draf pemeriksaan", { x: 32, y: 558, size: 19, font, color: ink });
  page.drawText(`Revisi ${project.revision} | Papan ${model.width} x ${model.height} mm | Margin ${project.layout.marginMm} mm`, { x: 32, y: 536, size: 11, font, color: muted });
  page.drawText("Belum diperiksa ahli | A4 berskala, bukan berkas produksi atau cetak 1:1", { x: 32, y: 516, size: 10, font, color: muted });
  const board = await pdf.embedPng(boardBytes);
  const scale = Math.min(777 / board.width, 286 / board.height);
  const boardWidth = board.width * scale; const boardHeight = board.height * scale;
  page.drawRectangle({ x: 32, y: 202, width: 777, height: 296, color: rgb(.96, .95, .93), borderColor: rgb(.91, .9, .87), borderWidth: 1 });
  page.drawImage(board, { x: 32 + (777 - boardWidth) / 2, y: 207 + (286 - boardHeight) / 2, width: boardWidth, height: boardHeight });
  const source = project.transliteration!.provenance;
  const lines = [
    `Nama asli: ${project.input.latinName}`,
    `Pelafalan dipilih: ${selectedPronunciations(project, project.confirmation!.selections).join(" ")}`,
    `Sumber: ${source.producer} / ${source.delivery}; artefak ${source.artifactVersion}; mesin ${project.transliteration!.engineVersion ?? "belum tersedia"}; aturan ${project.transliteration!.rulesVersion ?? "belum tersedia"}`,
    `Pemeriksaan balik: ${project.checks.roundTrip.status}. ${project.checks.roundTrip.note}`,
    `Layout: ${project.checks.layout.status}. Bahasa: belum diperiksa ahli. Cetak: belum divalidasi.`,
    `Catatan: ${options.notes?.trim() || "Belum ada catatan pemeriksa."}`,
    `Proof raster memakai font lokal. ${model.notes[0].text}`,
  ];
  const summaryCanvas = document.createElement("canvas"); summaryCanvas.width = 1600;
  const measure = summaryCanvas.getContext("2d");
  if (!measure) throw new ServiceError("PDF_EXPORT_FAILED", "Ringkasan PDF belum dapat disiapkan. Coba lagi.");
  measure.font = "23px 'IBM Plex Sans'";
  const wrapped: string[] = [];
  for (const line of lines) {
    let current = "";
    for (const word of line.split(/\s+/u)) {
      const parts: string[] = []; let part = "";
      for (const { segment } of new Intl.Segmenter("id", { granularity: "grapheme" }).segment(word)) {
        if (part && measure.measureText(part + segment).width > 1540) { parts.push(part); part = segment; } else part += segment;
      }
      if (part) parts.push(part);
      for (const piece of parts) {
        if (current && measure.measureText(`${current} ${piece}`).width > 1540) { wrapped.push(current); current = piece; }
        else current = current ? `${current} ${piece}` : piece;
      }
    }
    wrapped.push(current);
  }
  const firstPageCount = wrapped.length > 10 ? 9 : 10;
  const firstLines = wrapped.slice(0, firstPageCount);
  summaryCanvas.height = 310;
  const summaryContext = summaryCanvas.getContext("2d")!;
  summaryContext.fillStyle = "#fffefd"; summaryContext.fillRect(0, 0, 1600, 310); summaryContext.fillStyle = "#2d302a"; summaryContext.font = "23px 'IBM Plex Sans'";
  firstLines.forEach((line, index) => summaryContext.fillText(line, 0, 26 + index * 29, 1560));
  if (wrapped.length > 10) summaryContext.fillText("Ringkasan dilanjutkan pada halaman berikutnya.", 0, 300, 1560);
  const summary = await pdf.embedPng(await pngBytes(summaryCanvas)); page.drawImage(summary, { x: 32, y: 42, width: 777, height: 150.54 });
  for (let offset = firstPageCount; offset < wrapped.length; offset += 25) {
    const appendix = pdf.addPage([841.89, 595.28]); appendix.drawText(`Catatan draf / revisi ${project.revision} / belum diperiksa ahli`, { x: 32, y: 558, size: 14, font, color: ink });
    const rows = wrapped.slice(offset, offset + 25); const extra = document.createElement("canvas"); extra.width = 1600; extra.height = rows.length * 32 + 20;
    const extraContext = extra.getContext("2d")!; extraContext.fillStyle = "#fffefd"; extraContext.fillRect(0, 0, extra.width, extra.height); extraContext.fillStyle = "#2d302a"; extraContext.font = "23px 'IBM Plex Sans'"; rows.forEach((line, index) => extraContext.fillText(line, 0, 28 + index * 32, 1560));
    const image = await pdf.embedPng(await pngBytes(extra)); const height = Math.min(490, image.height / image.width * 777); appendix.drawImage(image, { x: 32, y: 530 - height, width: 777, height });
  }
  options.signal?.throwIfAborted();
  return pdf.save();
}
