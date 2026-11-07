import type { ProjectDraft, Provenance } from "../lib/contract";
import { isLayoutSample } from "../lib/project";

export const ROUND_TRIP_LABELS = { not_run: "Belum dijalankan", unavailable: "Belum tersedia", pass: "Konsisten pada pemeriksaan teknis", mismatch: "Ada perbedaan", error: "Pemeriksaan gagal" };

export function SourceDetails({ source }: { source: Provenance }) {
  const names = { fixture: "Data contoh", ai: "Layanan AI", rules: "Mesin aturan", dictionary: "Kamus" };
  return <dl className="source-details"><div><dt>Sumber</dt><dd>{names[source.producer]} · {source.delivery === "cache" ? "Cache" : source.delivery === "fresh" ? "Respons baru" : "Contoh pengembangan"}</dd></div><div><dt>Penyedia / model</dt><dd>{source.providerId ?? "Belum tersedia"} / {source.modelVersion ?? "Belum tersedia"}</dd></div><div><dt>Versi artefak</dt><dd>{source.artifactVersion}</dd></div><div><dt>Rujukan sumber</dt><dd>{source.sourceRefs.length ? source.sourceRefs.join("; ") : "Belum tersedia"}</dd></div></dl>;
}

export default function ResultDetails({ project }: { project: ProjectDraft }) {
  const result = project.transliteration;
  const check = project.checks.roundTrip;
  return <section className="result-details" aria-labelledby="result-details-title"><h3 id="result-details-title">Sumber dan pemeriksaan</h3>
    <div className={`technical-check ${check.status === "mismatch" || check.status === "error" ? "has-issue" : ""}`}><h4>Pemeriksaan balik</h4><strong>{ROUND_TRIP_LABELS[check.status]}</strong><p>{check.note}</p>{check.originalLatin !== undefined && <p>Latin sumber: <strong>{check.originalLatin}</strong></p>}{check.returnedLatin !== undefined && <p>Latin hasil balik: <strong>{check.returnedLatin}</strong></p>}<small>Konsistensi teknis tidak menggantikan pemeriksaan bahasa oleh ahli.</small></div>
    {result && <><SourceDetails source={result.provenance} /><dl className="source-details"><div><dt>Mesin / aturan</dt><dd>{result.engineVersion ?? "Belum tersedia"} / {result.rulesVersion ?? "Belum tersedia"}</dd></div><div><dt>Rujukan alih aksara</dt><dd>{result.sourceRefs.length ? result.sourceRefs.join("; ") : "Belum tersedia"}</dd></div><div><dt>Revisi draf</dt><dd>{project.revision} · Layout {project.layout.layoutRevision}</dd></div></dl>{result.unsupportedTokenIds.length > 0 && <div className="notice warning"><strong>Bagian yang belum didukung</strong><ul>{result.unsupportedTokenIds.map((id) => <li key={id}>{project.proposal?.tokens.find((token) => token.tokenId === id)?.original ?? id}</li>)}</ul>{isLayoutSample(project) && <p>Papan ini memuat sampel aksara.</p>}</div>}</>}
  </section>;
}
