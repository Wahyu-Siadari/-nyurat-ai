"use client";

import NextImage from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getAuditSummary, validatePhotoDimensions, validatePhotoFile, type PhotoAnalysis } from "../lib/photo-audit";
import { visibilityMotion } from "../lib/motion";
import { nyuratService } from "../lib/service";
import type { FontState } from "./board-preview";
import { SourceDetails } from "./result-details";
import { Skeleton } from "./ui/skeleton";

type Photo = { url: string; file: File; width: number; height: number; revision: number };

export default function PhotoAuditStudio({ active, fontState }: { active: boolean; fontState: FontState }) {
  const reducedMotion = useReducedMotion();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [result, setResult] = useState<PhotoAnalysis | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showAreas, setShowAreas] = useState(true);
  const requestRef = useRef(0);
  const revisionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const analysisButtonRef = useRef<HTMLButtonElement>(null);
  const summary = result ? getAuditSummary(result) : null;

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  // oxlint-disable-next-line react/set-state-in-effect -- Leaving the mounted workspace cancels external work and clears its busy state.
  useEffect(() => { if (!active) { requestRef.current += 1; abortRef.current?.abort(); setUploadBusy(false); setAnalysisBusy(false); } }, [active]);
  useEffect(() => () => { requestRef.current += 1; abortRef.current?.abort(); }, []);

  function focusAction() { requestAnimationFrame(() => { if (analysisButtonRef.current && !analysisButtonRef.current.disabled) analysisButtonRef.current.focus(); else inputRef.current?.focus(); }); }
  function cancel() { requestRef.current += 1; abortRef.current?.abort(); setAnalysisBusy(false); setUploadBusy(false); setFeedback("Proses dibatalkan. Foto sebelumnya tetap tersedia."); focusAction(); }
  function clearResult() { setResult(null); setSelected(null); setError(""); setFeedback(""); }
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const invalid = validatePhotoFile(file); if (invalid) { setError(invalid); return; }
    const request = ++requestRef.current; abortRef.current?.abort(); setAnalysisBusy(false); setUploadBusy(true); setError("");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (request !== requestRef.current) { URL.revokeObjectURL(url); return; }
      const dimensionsError = validatePhotoDimensions(image.naturalWidth, image.naturalHeight);
      if (dimensionsError) throw new Error(dimensionsError);
      const revision = ++revisionRef.current;
      setPhoto({ url, file, width: image.naturalWidth, height: image.naturalHeight, revision });
      clearResult();
    } catch (cause) {
      URL.revokeObjectURL(url);
      if (request === requestRef.current) setError(cause instanceof Error && cause.message.includes("piksel") || cause instanceof Error && cause.message.includes("megapiksel") ? cause.message : "Isi gambar tidak dapat dibaca. Pilih foto JPG, PNG, atau WebP yang dapat dibuka.");
    } finally { if (request === requestRef.current) setUploadBusy(false); }
  }
  function removePhoto() { requestRef.current += 1; abortRef.current?.abort(); setPhoto(null); setAnalysisBusy(false); setUploadBusy(false); clearResult(); if (inputRef.current) inputRef.current.value = ""; inputRef.current?.focus(); }
  async function analyze() {
    if (!photo || uploadBusy || analysisBusy) return;
    const request = ++requestRef.current; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller;
    setAnalysisBusy(true); setError(""); setFeedback("");
    try {
      const next = await nyuratService.auditPhoto(photo.file, photo.revision, controller.signal);
      if (next.image.width !== photo.width || next.image.height !== photo.height) throw new Error("Ukuran gambar pada hasil analisis tidak cocok dengan foto ini. Coba analisis lagi.");
      if (request !== requestRef.current) return;
      setResult(next); setSelected(next.detections[0]?.id ?? null); setFeedback("Analisis selesai.");
    } catch (cause) { if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "Analisis belum berhasil. Foto tetap tersedia."); }
    finally { if (request === requestRef.current) setAnalysisBusy(false); }
  }

  return <motion.div className="audit-studio" aria-busy={uploadBusy || analysisBusy} {...visibilityMotion("stage", active, reducedMotion)}>
    <section className="audit-upload" aria-labelledby="audit-upload-title">
      <div><h2 id="audit-upload-title">Unggah foto papan</h2><p className="helper">JPG, PNG, atau WebP · Maksimal 10 MB dan 24 megapiksel · Minimal 64 × 64 piksel.</p></div>
      <div className="audit-upload-actions">
        <label className="file-action secondary" htmlFor="audit-photo">{photo ? "Ganti foto" : "Pilih foto"}</label>
        <input ref={inputRef} className="photo-file-input" id="audit-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; void choosePhoto(file); event.target.value = ""; }} />
        {photo && <button type="button" className="text-button" onClick={removePhoto}>Hapus foto</button>}
      </div>
      {uploadBusy && <p aria-live="polite">Memuat foto… <button type="button" className="text-button" onClick={cancel}>Batalkan</button></p>}
      {photo && <p className="helper file-description">{photo.file.name} · {(photo.file.size / 1024 / 1024).toFixed(2)} MB · {photo.width} × {photo.height} px. Foto dikirim saat kamu memilih Analisis foto.</p>}
    </section>
    <div className="audit-work-grid">
      <section className="audit-findings" aria-labelledby="audit-findings-title"><h2 id="audit-findings-title">Hasil audit</h2>
        {!result && !error && !analysisBusy && <p className="helper">Belum ada hasil audit.</p>}
        {photo && <div className="audit-process-actions"><button ref={analysisButtonRef} type="button" className="primary" disabled={analysisBusy || uploadBusy} onClick={() => void analyze()}>{analysisBusy ? "Menganalisis foto…" : "Analisis foto"}</button>{analysisBusy && <button type="button" className="text-button" onClick={cancel}>Batalkan analisis</button>}</div>}
        {error && <div className="notice error" role="alert"><strong>{error}</strong></div>}<output className="feedback">{feedback}</output>
        {(uploadBusy || analysisBusy) && (
          <div className="mt-4 grid gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {result && <><p className="helper">{result.note}</p>{result.status === "no_detection" ? <p className="notice neutral">Tidak ada tulisan yang terdeteksi.</p> : <div className="audit-finding-list">{result.detections.map((item, index) => <button key={item.id} type="button" className={selected === item.id ? "is-selected" : ""} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span className="finding-index">{index + 1}</span><span><strong>{item.script === "balinese" ? "Aksara Bali" : "Latin"}{item.uncertain ? " · Belum pasti" : ""}</strong><span lang={item.script === "balinese" && fontState === "ready" ? "ban" : undefined}>{item.script === "balinese" && fontState !== "ready" ? "Font aksara belum siap" : item.text || "Teks belum terbaca"}</span><small>{Math.round(item.box.width * result.image.width)} × {Math.round(item.box.height * result.image.height)} px</small></span></button>)}</div>}{result.status === "uncertain" && <p className="notice warning">Aksara belum pasti. Rasio dan posisi belum dapat ditentukan.</p>}</>}
      </section>
      <section className="audit-proof" aria-labelledby="audit-proof-title"><div className="panel-heading"><h2 id="audit-proof-title">Foto papan</h2>{Boolean(result?.detections.length) && <label className="overlay-toggle"><input type="checkbox" checked={showAreas} onChange={(event) => setShowAreas(event.target.checked)} />Tampilkan area tulisan</label>}</div>
        <div className="audit-canvas">{photo ? <div className="audit-image" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
          <NextImage unoptimized src={photo.url} width={photo.width} height={photo.height} alt={`Foto papan: ${photo.file.name}`} />
          {result && showAreas && result.detections.map((item, index) => <button key={item.id} type="button" className={`audit-area ${selected === item.id ? "is-selected" : ""}`} aria-label={`Area ${index + 1}, ${item.script === "balinese" ? "aksara Bali" : "Latin"}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.width * 100}%`, height: `${item.box.height * 100}%` }}><span>{index + 1} · {item.script === "balinese" ? "Bali" : "Latin"}</span></button>)}
        </div> : <div className="workspace-empty"><p>Belum ada foto.</p></div>}</div>
        {summary && result && <div className="audit-summary"><p className="stage-kicker">{result.provenance.producer === "fixture" ? "Nilai contoh / geometri specimen" : "Geometri dari hasil layanan"}</p><dl className="status-list"><div><dt>Area Latin / Bali</dt><dd>{summary.latinCount} / {summary.balineseCount}</dd></div><div><dt>Posisi aksara Bali</dt><dd>{summary.position === "bali_above" ? "Di atas Latin" : summary.position === "latin_above" ? "Di bawah Latin" : summary.position === "unclear" ? "Area bertumpang tindih" : "Belum dapat dibandingkan"}</dd></div><div><dt>Rasio tinggi Bali / Latin</dt><dd>{summary.ratio === null ? "Belum tersedia" : `${summary.ratio.toLocaleString("id-ID", { maximumFractionDigits: 2 })}×`}</dd></div><div><dt>Status bahasa</dt><dd>Belum diperiksa ahli</dd></div></dl><p className="helper">{summary.note}</p><SourceDetails source={result.provenance} /></div>}
      </section>
    </div>
  </motion.div>;
}
