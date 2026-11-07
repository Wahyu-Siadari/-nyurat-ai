"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ExportFile, Layout, ProjectDraft, Selection } from "../lib/contract";
import { ServiceError } from "../lib/contract";
import { nyuratService } from "../lib/service";
import { motionPreset } from "../lib/motion";
import { confirmProject, consultationText, createInitialProject, DEFAULT_LAYOUT, getBoardNotice, getDraftNotice, invalidateConfirmation, invalidateInput, isLayoutSample, selectedPronunciations, updateLayout, validateInput, validateLayout, validateSelections, validateSnapshot } from "../lib/project";
import BoardPreview, { type FontState } from "./board-preview";
import ProcessDialog, { Checkmark } from "./process-dialog";
import PhotoAuditStudio from "./photo-audit-studio";
import ResultDetails, { ROUND_TRIP_LABELS, SourceDetails } from "./result-details";

const panelTitles = { name: "Nama usaha", pronunciation: "Pelafalan", layout: "Tata letak", exports: "Pemeriksaan dan berkas" };
type Panel = keyof typeof panelTitles;

function downloadFile(file: ExportFile) {
  const url = URL.createObjectURL(new Blob([file.contents], { type: file.mimeType }));
  const link = document.createElement("a"); link.href = url; link.download = file.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasLayoutLintFailure(status: ProjectDraft["checks"]["layout"]["status"]) {
  return status === "issues" || status === "error";
}

export default function Workflow() {
  const reducedMotion = useReducedMotion();
  const [project, setProject] = useState<ProjectDraft>(createInitialProject);
  const [view, setView] = useState<"new" | "audit">("new");
  const [panel, setPanel] = useState<Panel>("name");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"proposal" | "render" | "export" | "package" | "pdf" | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [fontState, setFontState] = useState<FontState>("loading");
  const [fontAttempt, setFontAttempt] = useState(0);
  const [findings, setFindings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [success, setSuccess] = useState<{ title: string; detail: string } | null>(null);
  const requestRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  const workspaceTitleRef = useRef<HTMLHeadingElement>(null);
  const messageRevisionRef = useRef<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousLocation = useRef({ view, panel });
  const nameRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const layoutError = validateLayout(project.layout);
  const selectionsError = validateSelections(project, selections);
  const snapshotReady = !validateSnapshot(project);
  const reportedLintFailure = hasLayoutLintFailure(project.checks.layout.status);
  const lintFindings = reportedLintFailure ? [...new Set([...project.checks.layout.findings, ...findings])] : findings;
  const layoutLintFailed = reportedLintFailure || findings.length > 0;
  const canExport = snapshotReady && !busy && !layoutError && !layoutLintFailed && fontState === "ready";

  useEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = { view, panel };
    if (previous.view !== view) workspaceTitleRef.current?.focus();
    else if (previous.panel !== panel) titleRef.current?.focus();
  }, [view, panel]);
  useEffect(() => {
    if (panel !== "exports" || !project.confirmation || messageRevisionRef.current === project.revision) return;
    setMessage(consultationText(project));
    messageRevisionRef.current = project.revision;
  }, [panel, project]);
  useEffect(() => {
    let active = true;
    Promise.all([document.fonts.load("24px 'Noto Sans Balinese'", "ᬅ"), document.fonts.load("16px 'IBM Plex Sans'")]).then((fonts) => {
      if (active) setFontState(fonts.every((faces) => faces.length > 0) ? "ready" : "failed");
    }).catch(() => { if (active) setFontState("failed"); });
    return () => { active = false; };
  }, [fontAttempt]);

  function clearPending() { requestRef.current += 1; exportAbortRef.current?.abort(); setBusy(null); setError(null); setFeedback(""); setSuccess(null); }
  function changeInput(field: "latinName" | "businessType" | "sourceLanguage", value: string) {
    clearPending();
    setProject((current) => invalidateInput(current, { latinName: current.input.latinName, businessType: current.input.businessType, sourceLanguage: current.input.sourceLanguage, [field]: field === "latinName" ? value : value || null }));
    setSelections([]); setAcknowledged(false); setInputError(null); setFindings([]);
  }
  function reportError(cause: unknown) { setError({ code: cause instanceof ServiceError ? cause.code : "REQUEST_FAILED", message: cause instanceof Error ? cause.message : "Proses belum berhasil. Pilihanmu tetap tersedia." }); }
  function editPanel(next: Panel) { clearPending(); setPanel(next); }

  async function requestProposal() {
    const invalid = validateInput(project.input);
    if (invalid) { setInputError(invalid); nameRef.current?.focus(); return; }
    const request = ++requestRef.current;
    setBusy("proposal"); setError(null); setFeedback(""); setSuccess(null);
    try {
      const proposal = await nyuratService.suggestPronunciation(project);
      if (request !== requestRef.current) return;
      if (proposal.inputRevision !== project.input.inputRevision) throw new ServiceError("STALE_REVISION", "Usulan berasal dari input sebelumnya.");
      setProject((current) => ({ ...current, proposal, confirmation: null, transliteration: null, render: null, artifacts: [] }));
      setSelections([]); setAcknowledged(false); setPanel("pronunciation");
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }

  function selectToken(selection: Selection) {
    clearPending(); setAcknowledged(false);
    setSelections((current) => [...current.filter((item) => item.tokenId !== selection.tokenId), selection]);
    setProject((current) => current.confirmation ? invalidateConfirmation(current) : current);
  }

  async function confirmPronunciation() {
    if (selectionsError || !acknowledged) return;
    const confirmed = confirmProject(project, selections);
    setProject(confirmed);
    const request = ++requestRef.current; setBusy("render"); setError(null); setSuccess(null);
    try {
      const result = await nyuratService.renderBoard(confirmed);
      if (request !== requestRef.current) return;
      const next = { ...confirmed, ...result };
      const invalid = validateSnapshot(next); if (invalid) throw new ServiceError("STALE_REVISION", invalid);
      setProject(next); setPanel("layout");
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }

  function changeLayout(next: Layout) { clearPending(); setProject((current) => updateLayout(current, next)); }
  async function openReview() {
    if (layoutError || findings.length || fontState !== "ready") return;
    const request = ++requestRef.current; setBusy("render"); setError(null); setSuccess(null);
    try {
      const result = await nyuratService.renderBoard(project);
      if (request !== requestRef.current) return;
      const next = { ...project, ...result };
      const invalid = validateSnapshot(next); if (invalid) throw new ServiceError("STALE_REVISION", invalid);
      setProject(next);
      if (hasLayoutLintFailure(result.checks.layout.status)) return;
      setPanel("exports");
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }

  function measuredSnapshot(): ProjectDraft {
    return { ...project, checks: { ...project.checks, layout: { status: fontState !== "ready" ? "not_run" : findings.length ? "issues" : "pass", findings: [...findings, "Pemeriksaan terbatas pada batas teks di pratinjau peramban; belum validasi cetak atau kepatuhan."] } } };
  }
  async function exportSvg() {
    if (!canExport) return;
    const request = ++requestRef.current; setBusy("export"); setError(null); setFeedback(""); setSuccess(null);
    try {
      const file = await nyuratService.exportBoard(measuredSnapshot());
      if (request !== requestRef.current) return;
      downloadFile(file);
      setProject((current) => ({ ...current, artifacts: [...current.artifacts.filter((item) => item.kind !== "svg"), { kind: "svg", state: "ready", basedOnRevision: current.revision, validation: "not_tested" }] }));
      setFeedback(`SVG ${isLayoutSample(project) ? "contoh" : "draf"} sudah dibuat. Berkas belum diperiksa ahli atau divalidasi untuk cetak.`);
      setSuccess({ title: `Berkas SVG ${isLayoutSample(project) ? "contoh" : "draf"} berhasil dibuat.`, detail: "Unduhan dimulai. Draf belum divalidasi untuk cetak." });
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }
  async function downloadPackage() {
    if (!canExport) return;
    const request = ++requestRef.current; setBusy("package"); setError(null); setSuccess(null);
    try {
      const file = await nyuratService.createReviewPackage(measuredSnapshot());
      if (request === requestRef.current) { downloadFile(file); setFeedback("Data paket pemeriksaan draf sudah dibuat."); setSuccess({ title: "Paket pemeriksaan berhasil dibuat.", detail: "Unduhan data JSON dimulai dengan status draf sebenarnya." }); }
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }
  async function exportPdf() {
    if (!canExport) return;
    const request = ++requestRef.current; const controller = new AbortController(); exportAbortRef.current = controller;
    setBusy("pdf"); setError(null); setFeedback(""); setSuccess(null);
    try {
      const { createDraftPdf } = await import("../lib/pdf-export");
      const bytes = await createDraftPdf(measuredSnapshot(), { fontsReady: fontState === "ready", signal: controller.signal });
      if (request !== requestRef.current) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a"); link.href = url; link.download = `nyurat-draf-revisi-${project.revision}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProject((current) => ({ ...current, artifacts: [...current.artifacts.filter((item) => item.kind !== "pdf"), { kind: "pdf", state: "ready", basedOnRevision: current.revision, validation: "not_tested" }] }));
      setSuccess({ title: "PDF draf berhasil dibuat.", detail: "Unduhan dimulai. Lembar A4 berskala; belum diperiksa ahli atau divalidasi untuk cetak." });
      setFeedback("Proof PDF raster A4 dibuat dari revisi ini dengan font lokal.");
    } catch (cause) { if (request === requestRef.current) reportError(cause); }
    finally { if (request === requestRef.current) setBusy(null); }
  }
  async function copyMessage() {
    try { await navigator.clipboard.writeText(message); setFeedback("Pesan disalin. Periksa kembali sebelum mengirimnya sendiri."); }
    catch { messageRef.current?.focus(); messageRef.current?.select(); setFeedback("Penyalinan otomatis belum tersedia. Teks sudah dipilih untuk disalin sendiri."); }
  }
  function reset() {
    if (!window.confirm("Mulai ulang dan hapus isian dalam sesi ini?")) return;
    clearPending(); messageRevisionRef.current = null; setProject(createInitialProject()); setView("new"); setPanel("name"); setSelections([]); setAcknowledged(false); setInputError(null); setFindings([]); setMessage("");
  }

  const reviewRows = [
    ["Nama asli", project.input.latinName],
    ["Pelafalan dipilih", selectedPronunciations(project, project.confirmation?.selections ?? []).join(" ")],
    ["Sumber hasil", project.transliteration?.provenance.producer === "fixture" ? "Data contoh" : "Layanan alih aksara"],
    ["Alih aksara nama", project.transliteration?.matchesInput ? "Hasil layanan; perlu pemeriksaan bahasa" : "Belum tersedia; papan memakai sampel tata letak"],
    ["Konsistensi teknis", `${ROUND_TRIP_LABELS[project.checks.roundTrip.status]}. ${project.checks.roundTrip.note}`],
    ["Review bahasa", "Belum diperiksa ahli"],
    ["Kesiapan berkas", project.artifacts.length ? "Berkas draf dibuat; validasi cetak belum dilakukan" : "Draf; validasi cetak belum dilakukan"],
  ];

  return <>
    <a className="skip-link" href="#workspace">Lewati ke ruang kerja</a>
    <div className="app-shell">
      <aside className="rail">
        <div className="wordmark"><span className="brand-mark" aria-hidden="true">n.</span>NYURAT<span>.AI</span></div>
        <p className="rail-caption">Studio papan nama</p>
        <nav className="workspace-nav" aria-label="Ruang kerja">
          <button type="button" aria-current={view === "new" ? "page" : undefined} disabled={Boolean(busy)} onClick={() => setView("new")}>Papan nama</button>
          <button type="button" aria-current={view === "audit" ? "page" : undefined} disabled={Boolean(busy)} onClick={() => setView("audit")}>Audit foto</button>
        </nav>
        <div className="rail-foot">
          <div className="rail-note-mark" aria-hidden="true">Aa<span> / </span><span style={{ visibility: fontState === "ready" ? "visible" : "hidden" }}>ᬅ</span></div>
          <strong>Nama tetap dikenal.<br />Aksara ikut terjaga.</strong>
          <p>Draf papan nama beraksara Bali, disiapkan untuk diperiksa.</p>
        </div>
      </aside>
      <div className="main-frame">
        <header className="topbar"><p><span className="breadcrumb-label">Ruang kerja</span><span className="breadcrumb-slash">/</span>{view === "new" ? project.input.latinName || "Papan baru" : "Audit foto"}</p>{view === "new" && <button className="reset-button" type="button" onClick={reset}><span aria-hidden="true">↺</span> Mulai ulang</button>}</header>
        <main id="workspace" className="workspace">
          <div className="workspace-heading">
            <h1 ref={workspaceTitleRef} tabIndex={-1}>{view === "new" ? "Papan nama" : "Audit foto"}</h1>
          </div>
          <div hidden={view !== "new"}>
          {success && <motion.div className="success-notice" {...motionPreset("success", reducedMotion)}><span className="success-icon"><Checkmark /></span><div aria-live="polite" aria-atomic="true"><strong>{success.title}</strong><p>{success.detail}</p></div><button type="button" className="dismiss-button" aria-label="Tutup pemberitahuan sukses" onClick={() => setSuccess(null)}>×</button></motion.div>}
          <div className="work-grid">
            <section className="stage-panel" aria-labelledby="stage-title" aria-busy={Boolean(busy)}>
              <div className="stage-panel-heading"><h2 ref={titleRef} tabIndex={-1} id="stage-title">{panelTitles[panel]}</h2></div>
              {error && <div className="notice error" role="alert"><strong>{error.message}</strong></div>}
              <motion.div key={panel} {...motionPreset("stage", panel === "name" ? true : reducedMotion)}>
              {panel === "name" && <form onSubmit={(event) => { event.preventDefault(); void requestProposal(); }} noValidate>
                <div className="field"><label htmlFor="latin-name">Nama usaha (huruf Latin) <span className="required-note">Wajib</span></label><input ref={nameRef} id="latin-name" autoComplete="organization" value={project.input.latinName} onChange={(event) => changeInput("latinName", event.target.value)} aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "name-error" : undefined} />{inputError && <p id="name-error" className="field-error" role="alert">{inputError}</p>}</div>
                <div className="field-pair">
                  <div className="field"><label htmlFor="business-type">Jenis usaha <span className="optional">Opsional</span></label><select id="business-type" value={project.input.businessType ?? ""} onChange={(event) => changeInput("businessType", event.target.value)}><option value="">Pilih jenis usaha</option><option value="warung">Warung</option><option value="toko">Toko</option><option value="kafe">Kafe</option><option value="vila">Vila</option><option value="lainnya">Lainnya</option></select></div>
                  <div className="field"><label htmlFor="source-language">Bahasa asal <span className="optional">Opsional</span></label><select id="source-language" value={project.input.sourceLanguage ?? ""} onChange={(event) => changeInput("sourceLanguage", event.target.value)}><option value="">Belum diketahui</option><option value="id">Indonesia</option><option value="ban">Bali</option><option value="en">Inggris</option><option value="mixed">Campuran / lainnya</option></select></div>
                </div>
                <div className="stage-actions"><button className="primary" type="submit" disabled={Boolean(busy)}>{busy === "proposal" ? "Memuat pelafalan…" : error ? "Coba lagi" : "Periksa pelafalan"}<span aria-hidden="true">→</span></button></div>
              </form>}
              {panel === "pronunciation" && project.proposal && <div>
                <p className="original-name">Nama asli <strong>{project.input.latinName}</strong></p>
                <details className="source-disclosure"><summary>Sumber pilihan pelafalan</summary><SourceDetails source={project.proposal.provenance} /></details>
                {project.proposal.serviceState === "quota_exhausted" && <p className="notice warning">Kuota AI habis. Pilihan pelafalan dari sumber yang tersedia tetap bisa digunakan.</p>}
                <div className="token-list">{project.proposal.tokens.map((token) => {
                  const selection = selections.find((item) => item.tokenId === token.tokenId);
                  return <fieldset key={token.tokenId} className="token-field"><legend>{token.original} <span>Perlu pilihanmu</span></legend>{token.options.map((option) => <label key={option.optionId} aria-label={`${option.pronunciation}. ${option.reason}`} className={`pronunciation-option ${selection?.kind === "option" && selection.optionId === option.optionId ? "is-selected" : ""}`}><input type="radio" name={token.tokenId} checked={selection?.kind === "option" && selection.optionId === option.optionId} onChange={() => selectToken({ tokenId: token.tokenId, kind: "option", optionId: option.optionId })} /><span><strong>{option.pronunciation}</strong><small>{option.reason}</small></span></label>)}<label className="custom-choice"><input type="radio" name={token.tokenId} checked={selection?.kind === "custom"} onChange={() => selectToken({ tokenId: token.tokenId, kind: "custom", pronunciation: "" })} />Tulis pelafalan sendiri</label>{selection?.kind === "custom" && <div className="field custom-field"><label htmlFor={`custom-${token.tokenId}`}>Pelafalan untuk {token.original}</label><input id={`custom-${token.tokenId}`} value={selection.pronunciation} maxLength={120} onChange={(event) => selectToken({ tokenId: token.tokenId, kind: "custom", pronunciation: event.target.value })} /></div>}</fieldset>;
                })}</div>
                <div className="selection-summary"><p>Pelafalan yang kamu pilih</p><strong>{selectedPronunciations(project, selections).filter(Boolean).join(" ") || "Belum ada pilihan"}</strong></div>
                <label className="acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />Saya sudah memeriksa pilihan pelafalan di atas.</label>
                <div className="stage-actions"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => editPanel("name")}>Ubah nama usaha</button><button className="primary" type="button" disabled={Boolean(busy) || Boolean(selectionsError) || !acknowledged} onClick={() => void confirmPronunciation()}>Susun papan</button></div>
              </div>}
              {panel === "layout" && <div>
                <div className="dimension-grid">{([ ["Lebar papan", "width"], ["Tinggi papan", "height"] ] as const).map(([label, key]) => <div className="field" key={key}><label htmlFor={`board-${key}`}>{label} <span className="unit">mm</span></label><input id={`board-${key}`} type="number" min="100" max="10000" value={Number.isFinite(project.layout.boardMm[key]) ? project.layout.boardMm[key] : ""} onChange={(event) => changeLayout({ ...project.layout, boardMm: { ...project.layout.boardMm, [key]: event.target.value === "" ? NaN : Number(event.target.value) } })} /></div>)}{([ ["Margin", "marginMm"], ["Ukuran aksara", "balineseSizeMm"], ["Ukuran Latin", "latinSizeMm"] ] as const).map(([label, key]) => <div className="field" key={key}><label htmlFor={key}>{label} <span className="unit">mm</span></label><input id={key} type="number" min={key === "marginMm" ? 0 : 5} max={key === "marginMm" ? 5000 : 500} value={Number.isFinite(project.layout[key]) ? project.layout[key] : ""} onChange={(event) => changeLayout({ ...project.layout, [key]: event.target.value === "" ? NaN : Number(event.target.value) })} /></div>)}</div>
                <div className="field"><label htmlFor="alignment">Perataan tulisan</label><select id="alignment" value={project.layout.alignment} onChange={(event) => changeLayout({ ...project.layout, alignment: event.target.value as Layout["alignment"] })}><option value="center">Rata tengah</option><option value="left">Rata kiri</option></select></div>
                <div className="field"><label htmlFor="line-breaks">Baris nama Latin</label><select id="line-breaks" value={project.layout.lineBreaks} onChange={(event) => changeLayout({ ...project.layout, lineBreaks: event.target.value as Layout["lineBreaks"] })}><option value="single">Satu baris</option><option value="two_lines">Dua baris, pisah di antara kata</option></select></div>
                <button className="text-button" type="button" onClick={() => changeLayout(structuredClone(DEFAULT_LAYOUT))}>Pulihkan ukuran awal</button>
                {layoutError && <p className="field-error" role="alert">{layoutError}</p>}
                <div className="stage-actions"><button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => editPanel("pronunciation")}>Ubah pelafalan</button><button className="primary" type="button" disabled={Boolean(busy) || Boolean(layoutError) || Boolean(findings.length) || fontState !== "ready"} onClick={() => void openReview()}>{reportedLintFailure ? "Periksa ulang tata letak" : "Periksa draf"}</button></div>
              </div>}
              {panel === "exports" && <div>
                <div className="notice warning"><strong>{getDraftNotice(project)}</strong></div>
                <dl className="review-list">{reviewRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                <section className="draft-files" aria-labelledby="draft-files-title"><h3 id="draft-files-title">Berkas draf</h3><p className="helper">Draf pemeriksaan · A4 lanskap. Ukuran papan asli: {project.layout.boardMm.width} × {project.layout.boardMm.height} mm; margin {project.layout.marginMm} mm.</p><div className="export-actions"><button className="primary" type="button" disabled={!canExport} onClick={() => void exportPdf()}>{busy === "pdf" ? "Menyiapkan PDF draf…" : error?.code.startsWith("PDF_") ? "Coba unduh PDF lagi" : "Unduh PDF draf"}</button><button className="secondary" type="button" disabled={!canExport} onClick={() => void exportSvg()}>{busy === "export" ? "Menyiapkan SVG…" : error?.code === "EXPORT_FAILED" ? "Coba unduh SVG lagi" : project.transliteration?.kind === "layout_sample" ? "Unduh SVG contoh" : "Unduh SVG draf"}</button><button className="secondary" type="button" disabled={!canExport} onClick={() => { window.print(); setFeedback("Dialog cetak dibuka. Penyimpanan atau pencetakan ditentukan melalui peramban."); }}>Cetak lembar pemeriksaan</button><button className="text-button" type="button" disabled={!canExport} onClick={() => void downloadPackage()}>Unduh data paket (.json)</button></div><p className="helper">PDF memuat proof raster dari font lokal. A4 berskala; belum divalidasi untuk cetak. SVG memakai ukuran papan dalam mm. Tidak ada berkas yang dinyatakan siap produksi.</p></section>
                {!canExport && !busy && <p className="helper">Unduhan menunggu font siap, ukuran valid, dan pratinjau yang masih sesuai revisi.</p>}
                <div className="consultation"><h3>Siapkan pesan konsultasi</h3><p className="helper">Sunting lalu salin untuk dikirim sendiri.</p><label className="sr-only" htmlFor="consultation-message">Pesan konsultasi</label><textarea ref={messageRef} id="consultation-message" rows={8} value={message} onChange={(event) => setMessage(event.target.value)} /><button className="secondary" type="button" onClick={() => void copyMessage()}>Salin pesan</button></div>
                <div className="stage-actions"><button className="secondary" type="button" onClick={() => editPanel("layout")}>Ubah tata letak</button></div>
              </div>}
              </motion.div><p className="feedback" aria-live="polite">{feedback}</p>
            </section>
            <section className="preview-panel" aria-labelledby="preview-heading"><div className="panel-heading"><h2 id="preview-heading">Di atas papan</h2></div>
              <BoardPreview project={project} fontState={fontState} onFindings={setFindings} />
              {project.confirmation && <>
                {fontState !== "ready" && <div className={`notice ${fontState === "failed" ? "error" : "neutral"}`} aria-live="polite"><strong>{fontState === "loading" ? "Memuat font aksara Bali…" : "Font aksara Bali gagal dimuat."}</strong>{fontState === "failed" && <button type="button" className="text-button" onClick={() => { setFontState("loading"); setFontAttempt((attempt) => attempt + 1); }}>Muat ulang font</button>}</div>}
                {layoutLintFailed && <div className="notice warning" role="alert"><strong>Pemeriksaan tata letak gagal</strong>{lintFindings.length > 0 && <ul>{lintFindings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}</div>}
                <dl className="status-list"><div><dt>Sumber</dt><dd>{project.transliteration?.provenance.producer === "fixture" ? "Data contoh" : project.transliteration?.provenance.producer ?? "Belum tersedia"}</dd></div><div><dt>Bahasa</dt><dd>Belum diperiksa ahli</dd></div><div><dt>Konsistensi</dt><dd>{ROUND_TRIP_LABELS[project.checks.roundTrip.status]}</dd></div><div><dt>Layout</dt><dd>{layoutError ? "Ukuran belum valid" : fontState !== "ready" ? "Menunggu font" : layoutLintFailed ? "Perlu penyesuaian" : "Batas tampilan diperiksa"}</dd></div></dl>
                <ResultDetails project={project} />
                <p className="helper preview-limit">Pemeriksaan layout hanya membandingkan batas teks dengan margin di peramban. Ketepatan bahasa, hasil cetak, dan kepatuhan belum dinilai.</p>
              </>}
            </section>
          </div>
          </div>
          <div hidden={view !== "audit"}><PhotoAuditStudio active={view === "audit"} fontState={fontState} /></div>
          <footer className="workspace-footer"><p>Disiapkan untuk ditinjau, dengan status yang terlihat.</p><span>NYURAT.AI · Studio papan nama</span></footer>
        </main>
      </div>
    </div>
    <ProcessDialog operation={busy} onCancel={clearPending} />
    <article className="print-sheet"><h1>Lembar pemeriksaan papan nama</h1><p>{getDraftNotice(project)}</p><p>{getBoardNotice(project)}</p><dl className="review-list">{reviewRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><BoardPreview project={project} fontState={fontState} printable /><p>Revisi {project.revision} · Ukuran {project.layout.boardMm.width} × {project.layout.boardMm.height} mm · Margin {project.layout.marginMm} mm</p><p>Validasi cetak belum dilakukan.</p><h2>Catatan pemeriksa</h2><p>Nama pemeriksa: ____________________ Tanggal: ____________________</p><p>Koreksi / tindak lanjut: ____________________________________________________</p></article>
  </>;
}
