export function getPdfPreviewSize(width: number, height: number): { width: number; height: number; scale: number } {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Ukuran papan untuk PDF tidak valid.");
  const scale = Math.min(3, 4096 / width, 4096 / height, Math.sqrt(4_000_000 / width / height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}
