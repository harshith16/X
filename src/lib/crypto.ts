import crypto from "crypto";
import { env } from "@/lib/env";

/**
 * Generates an unguessable connect code:
 * e.g. "qc_..." + 32 random hex characters
 */
export function generateConnectCode(): string {
  return "qc_" + crypto.randomBytes(16).toString("hex");
}

/**
 * Hashes a connect code using HMAC-SHA256 with CLAIM_CODE_SECRET.
 */
export function hashConnectCode(code: string): string {
  return crypto
    .createHmac("sha256", env.CLAIM_CODE_SECRET)
    .update(code.trim())
    .digest("hex");
}

/**
 * Generates an agent long-lived credential:
 * e.g. "ag_live_" + 32 random bytes in base64url format.
 */
export function generateAgentCredential(): string {
  return "ag_live_" + crypto.randomBytes(32).toString("base64url");
}

/**
 * Hashes an agent credential using HMAC-SHA256 with AGENT_TOKEN_SECRET.
 */
export function hashAgentCredential(credential: string): string {
  return crypto
    .createHmac("sha256", env.AGENT_TOKEN_SECRET)
    .update(credential.trim())
    .digest("hex");
}
