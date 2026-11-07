import "server-only";
import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function shortHash(text: string): string {
  return hashText(text).slice(0, 12);
}
