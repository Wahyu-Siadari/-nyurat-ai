import "server-only";

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

type Bucket = { used: number; resetAt: number };
export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function createRateLimiter(now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();

  // The key comes from a client-controlled header, so the table needs its own ceiling.
  function makeRoom(time: number) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(key);
    while (buckets.size >= MAX_TRACKED_CLIENTS) buckets.delete(buckets.keys().next().value as string);
  }

  return {
    consume(key: string, weight: number, limit: number): RateDecision {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        if (!bucket && buckets.size >= MAX_TRACKED_CLIENTS) makeRoom(time);
        bucket = { used: 0, resetAt: time + WINDOW_MS };
        buckets.set(key, bucket);
      }
      if (bucket.used + weight > limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
      bucket.used += weight;
      return { allowed: true };
    },
    get size() { return buckets.size; },
    reset() { buckets.clear(); },
  };
}

export const rateLimiter = createRateLimiter();

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
