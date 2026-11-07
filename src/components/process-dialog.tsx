"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { motionPreset, visibilityMotion } from "../lib/motion";
import { Skeleton } from "./ui/skeleton";

export type Operation = "proposal" | "render" | "export" | "package" | "pdf";

const operations = {
  proposal: ["Membaca sebuah nama.", "Menyiapkan pilihan pelafalan untuk kamu periksa.", "Pelafalan"],
  render: ["Memberi ruang pada aksara.", "Menyusun pratinjau dari pilihan dan ukuran papanmu.", "Komposisi"],
  export: ["Merapikan lembar terakhir.", "Menyiapkan berkas SVG dan menyisipkan font lokal.", "Berkas SVG"],
  package: ["Merangkum keputusanmu.", "Menyiapkan data draf untuk pemeriksaan selanjutnya.", "Paket pemeriksaan"],
  pdf: ["Menyusun lembar pemeriksaan.", "Membuat PDF draf A4 dari pratinjau dan font lokal.", "PDF draf"],
} satisfies Record<Operation, string[]>;

export function Checkmark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

export default function ProcessDialog({ operation, onCancel }: { operation: Operation | null; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reducedMotion = useReducedMotion();
  const writingClipId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (operation && !dialog?.open) dialog?.showModal();
    if (!operation && dialog?.open) dialog.close();
  }, [operation]);

  const content = operations[operation ?? "proposal"];
  return <motion.dialog ref={dialogRef} className="process-dialog" aria-labelledby="process-title" aria-describedby="process-description" onCancel={(event) => { event.preventDefault(); onCancel(); }} {...visibilityMotion("dialog", Boolean(operation), reducedMotion)}>
    <div className="process-content" aria-busy={Boolean(operation)}>
      <span className="process-label">NYURAT <span> / {content[2]}</span></span>
      <div className="writing-animation" aria-hidden="true">
        <svg viewBox="0 0 280 140" fill="none">
          <defs>
            <clipPath id={writingClipId}>
              <motion.rect
                key={operation ?? "idle"}
                width="240"
                height="140"
                fill="white"
                style={{ transformOrigin: "0px 0px" }}
                {...motionPreset("writing", operation ? reducedMotion : true)}
              />
            </clipPath>
          </defs>
          <rect x="30" y="30" width="220" height="88" rx="3" />
          <path
            className="writing-stroke"
            clipPath={`url(#${writingClipId})`}
            d="M45 89V59l20 30V59 M77 59l11 16 11-16m-11 16v14 M111 59v20q0 18 22 0V59 M145 89V59h11q17 0 0 16h-11m11 0 11 14 M179 89l11-30 11 30m-17-9h12 M213 59h22m-11 0v30"
          />
        </svg>
      </div>
      <div aria-live="polite" aria-atomic="true"><h2 id="process-title">{content[0]}</h2><p id="process-description">{content[1]}</p></div>
      {operation && (
        <div className="mx-auto grid w-40 gap-2" aria-hidden="true">
          <Skeleton className="h-2" />
          <Skeleton className="mx-auto h-2 w-2/3" />
        </div>
      )}
      <button className="text-button" type="button" onClick={onCancel}>Batalkan proses</button>
    </div>
  </motion.dialog>;
}
