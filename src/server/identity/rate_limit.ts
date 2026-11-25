/**
 * In-memory sliding window rate limiter for Qurelium endpoints.
 * Stateless request handlers fall back to per-instance sliding window in v1.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale records periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    record.timestamps = record.timestamps.filter((ts) => now - ts < 60_000);
    if (record.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000).unref?.();

/**
 * Checks and records an attempt for the given identifier.
 * @param key unique identifier (e.g. owner_id)
 * @param maxAttempts maximum allowed attempts in window
 * @param windowMs time window in milliseconds (default 60s)
 * @returns { allowed: boolean, remaining: number, retryAfterSeconds: number }
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 60_000,
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  let record = rateLimitStore.get(key);

  if (!record) {
    record = { timestamps: [] };
    rateLimitStore.set(key, record);
  }

  // Filter out timestamps outside window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= maxAttempts) {
    const oldest = record.timestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxAttempts - record.timestamps.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Resets rate limit for a key (useful in tests).
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}
