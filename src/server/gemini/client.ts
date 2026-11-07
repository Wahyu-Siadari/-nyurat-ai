import "server-only";
import { GoogleGenAI, ThinkingLevel, type GenerateContentParameters } from "@google/genai";
import type { z } from "zod";
import { getConfig } from "../config.ts";

const MAX_LOGGED_CHARS = 500;

export type GeminiFailureKind = "quota" | "timeout" | "unavailable";

export class GeminiError extends Error {
  readonly kind: GeminiFailureKind;

  constructor(kind: GeminiFailureKind, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "GeminiError";
    this.kind = kind;
  }
}

export type GeminiSdk = { models: { generateContent(params: GenerateContentParameters): Promise<{ text?: string }> } };

let sdk: GeminiSdk | null = null;

function getSdk(apiKey: string): GeminiSdk {
  sdk ??= new GoogleGenAI({ apiKey });
  return sdk;
}

export function setGeminiSdkForTests(fake: GeminiSdk | null): void { sdk = fake; }

// A daily limit and a per-minute limit both arrive as 429 but recover hours apart.
function quotaIdOf(error: unknown): string {
  return (error instanceof Error ? error.message.match(/quotaId\W+([\w.-]+)/)?.[1] : undefined) ?? "jenis tidak diketahui";
}

function classifyFailure(error: unknown, signal: AbortSignal): GeminiError {
  if (signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return new GeminiError("timeout", "Gemini melewati batas waktu.", { cause: error });
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429 || (error instanceof Error && error.message.includes("RESOURCE_EXHAUSTED"))) {
    return new GeminiError("quota", `Kuota Gemini habis (${quotaIdOf(error)}).`, { cause: error });
  }
  return new GeminiError("unavailable", `Gemini gagal dengan status ${typeof status === "number" ? status : "tanpa kode"}.`, { cause: error });
}

// The SDK's abort is only as prompt as its own fetch path, and the frontend gives up at 15 seconds.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    work.then(resolve, reject);
  });
}

function masked(value: unknown): unknown {
  if (typeof value === "string") return `<${value.length} karakter>`;
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, masked(item)]));
  return value;
}

// Model text can echo a business name, so only the shape of a bad reply reaches the log.
function describeForLog(text: string): string {
  try {
    return JSON.stringify(masked(JSON.parse(text))).slice(0, MAX_LOGGED_CHARS);
  } catch {
    return `<bukan JSON, ${text.length} karakter>`;
  }
}

function parseStructured<T>(text: string | undefined, schema: z.ZodType<T>, requestId: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "");
  } catch (cause) {
    console.error(`[nyurat] ${requestId} keluaran Gemini bukan JSON:`, describeForLog(text ?? ""));
    throw new GeminiError("unavailable", "Keluaran Gemini bukan JSON.", { cause });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.error(`[nyurat] ${requestId} keluaran Gemini tidak sesuai skema:`, describeForLog(text ?? ""));
    throw new GeminiError("unavailable", "Keluaran Gemini tidak sesuai skema.");
  }
  return parsed.data;
}

export type GeminiJsonRequest<T> = {
  system: string;
  contents: GenerateContentParameters["contents"];
  responseJsonSchema: unknown;
  schema: z.ZodType<T>;
  timeoutMs: number;
  requestId: string;
};

export async function generateJson<T>({ system, contents, responseJsonSchema, schema, timeoutMs, requestId }: GeminiJsonRequest<T>): Promise<T> {
  const { geminiApiKey, geminiModel } = getConfig();
  if (!geminiApiKey) throw new GeminiError("unavailable", "GEMINI_API_KEY belum diatur.");

  const signal = AbortSignal.timeout(timeoutMs);
  let text: string | undefined;
  try {
    const response = await untilAborted(getSdk(geminiApiKey).models.generateContent({
      model: geminiModel,
      contents,
      // Sampling parameters stay unset: recent Gemini models ignore or deprecate them.
      config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema, abortSignal: signal, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    }), signal);
    text = response.text;
  } catch (error) {
    throw classifyFailure(error, signal);
  }
  return parseStructured(text, schema, requestId);
}
