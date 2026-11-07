"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import type { ProjectDraft } from "../lib/contract";
import { motionPreset } from "../lib/motion";
import { getBoardModel, getBoardNotice, getDraftNotice, isLayoutSample, validateLayout } from "../lib/project";

export type FontState = "loading" | "ready" | "failed";

export default function BoardPreview({ project, fontState, onFindings, printable = false }: { project: ProjectDraft; fontState: FontState; onFindings?: (findings: string[]) => void; printable?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const model = getBoardModel(project);
  const ready = Boolean(project.transliteration && project.confirmation);
  const invalid = validateLayout(project.layout);
  const noteY = model.notes[0].y;

  useEffect(() => {
    if (!onFindings || !ready || invalid || fontState !== "ready") { onFindings?.([]); return; }
    const frame = requestAnimationFrame(() => {
      const { marginMm } = project.layout;
      const findings: string[] = [];
      const elements = svgRef.current?.querySelectorAll<SVGTextElement>("[data-board-text]") ?? [];
      for (const element of elements) {
        const bounds = element.getBBox();
        if (bounds.x < marginMm || bounds.x + bounds.width > model.width - marginMm || bounds.y < marginMm || bounds.y + bounds.height > model.height - marginMm) findings.push(`${element.dataset.boardText} melampaui area margin.`);
      }
      const lastLatin = svgRef.current?.querySelector<SVGTextElement>("[data-last-latin]")?.getBBox();
      if (lastLatin && lastLatin.y + lastLatin.height > noteY - 18) findings.push("Tulisan Latin terlalu dekat dengan catatan draf.");
      onFindings([...new Set(findings)]);
    });
    return () => cancelAnimationFrame(frame);
  }, [project.layout, project.transliteration, project.confirmation, project.input.latinName, ready, invalid, fontState, onFindings, model.width, model.height, noteY]);

  return <figure className={printable ? "board-figure print-board" : "board-figure"}>
    <div className={`board-canvas ${ready && !invalid ? "has-board" : ""}`}>
      {!printable && <div className="canvas-label"><span>{ready && !invalid ? "Draf komposisi" : "Pratinjau"}</span><span>Latin / Bali</span></div>}
      {!ready || invalid ? <div className="preview-empty">
        <span className="board-placeholder-label">{invalid ? "Ukuran tidak valid" : "Aksara Bali belum tersedia"}</span>
        <strong className="empty-glyph">{project.input.latinName || "Nama usahamu"}</strong>
        <span className="board-placeholder-rule" aria-hidden="true" />
        {invalid && <p>{invalid}</p>}
        <span className="board-corner corner-tl" aria-hidden="true" />
        <span className="board-corner corner-tr" aria-hidden="true" />
        <span className="board-corner corner-bl" aria-hidden="true" />
        <span className="board-corner corner-br" aria-hidden="true" />
      </div> : (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The inline SVG needs one accessible image name.
      <motion.svg ref={svgRef} {...motionPreset("board", printable ? true : reducedMotion)} viewBox={`0 0 ${model.width} ${model.height}`} width={model.width} height={model.height} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{isLayoutSample(project) ? "Contoh tata letak" : "Draf"} papan {project.input.latinName}. {getBoardNotice(project)}</title>
        <rect width="100%" height="100%" fill="white" />
        <g fill="#171c19" textAnchor={model.anchor}>
          <text data-board-text="Sampel aksara" x={model.x} y={model.sample.y} fontSize={model.sample.size} fontFamily="Noto Sans Balinese" lang="ban" style={{ visibility: fontState === "ready" ? "visible" : "hidden" }}>{model.sample.text}</text>
          {model.latin.map((line, index) => <text key={index} data-board-text="Nama Latin" data-last-latin={index === model.latin.length - 1 ? "true" : undefined} x={model.x} y={line.y} fontSize={line.size} fontFamily="IBM Plex Sans">{line.text}</text>)}
        </g>
        <g fill="#59625c" textAnchor="middle" fontFamily="IBM Plex Sans" fontSize="13">{model.notes.map((note, index) => <text key={index} x={model.width / 2} y={note.y}>{note.text}</text>)}</g>
      </motion.svg>)}
      {!printable && !invalid && <div className="canvas-footer"><span className="dimension-line" aria-hidden="true" /><span>{project.layout.boardMm.width} × {project.layout.boardMm.height} mm</span><span className="dimension-line" aria-hidden="true" /></div>}
    </div>
    <figcaption>{!invalid && <>{project.layout.boardMm.width} × {project.layout.boardMm.height} mm · Skala pratinjau</>}</figcaption>
    {ready && <p className="specimen-note">{getBoardNotice(project)}</p>}
    {ready && <p className="sr-only">{getDraftNotice(project)}</p>}
  </figure>;
}
