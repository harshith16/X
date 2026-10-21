import crypto from "crypto";

/**
 * Normalizes fact text:
 * Strips extra whitespace, converts to lowercase, trims.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Computes deterministic SHA-256 content hash of normalized fact text.
 */
export function computeContentHash(text: string): string {
  const normalized = normalizeText(text);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
