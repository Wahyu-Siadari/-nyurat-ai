import "server-only";
import { z } from "zod";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const PHOTO_AUDIT_RATE_WEIGHT = 3;

const envSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/).default(DEFAULT_GEMINI_MODEL),
  // One photo audit costs PHOTO_AUDIT_RATE_WEIGHT, so a smaller limit would block audits for everyone.
  NYURAT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(PHOTO_AUDIT_RATE_WEIGHT).max(100_000).default(30),
  NYURAT_MODE: z.enum(["live", "fixture"]).default("live"),
});

export type AppConfig = { geminiApiKey: string | null; geminiModel: string; rateLimitPerMinute: number; mode: "live" | "fixture" };

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim()).map(([name, value]) => [name, value?.trim()]));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`Variabel lingkungan tidak valid: ${names}. Lihat .env.example.`);
  }
  return { geminiApiKey: parsed.data.GEMINI_API_KEY ?? null, geminiModel: parsed.data.GEMINI_MODEL, rateLimitPerMinute: parsed.data.NYURAT_RATE_LIMIT_PER_MIN, mode: parsed.data.NYURAT_MODE };
}

let cached: AppConfig | null = null;

// Read on first use, not at import: `next build` loads route modules without production secrets.
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

export function resetConfigForTests(): void { cached = null; }
