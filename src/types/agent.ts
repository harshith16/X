import { z } from "zod";

/**
 * Handle validation schema:
 * Lowercase letters, numbers, underscores, 3–24 characters.
 */
export const HandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Handle must be at least 3 characters")
  .max(24, "Handle must be at most 24 characters")
  .regex(
    /^[a-z0-9_]{3,24}$/,
    "Handle must contain only lowercase letters, numbers, and underscores",
  );

export const ClaimAgentRequestSchema = z.object({
  handle: HandleSchema,
  x_handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^@?[a-z0-9_]{1,15}$/, "X handle must be 1–15 letters, numbers, or underscores")
    .transform((s) => s.replace(/^@/, ""))
    .optional(),
});

export type ClaimAgentRequest = z.infer<typeof ClaimAgentRequestSchema>;

export const VerifyTweetRequestSchema = z.object({
  tweet_url: z.string().trim(),
});

export type VerifyTweetRequest = z.infer<typeof VerifyTweetRequestSchema>;

export interface VerifyTweetResponse {
  verified: boolean;
  reason?: string;
  agent?: AgentRecord;
  request_id: string;
}

export type HandleAvailabilityStatus = "available" | "taken" | "invalid_format";

export interface HandleAvailabilityResponse {
  available: boolean;
  status: HandleAvailabilityStatus;
  handle: string;
  request_id: string;
}

export interface AgentRecord {
  id: string;
  owner_id: string;
  handle: string;
  display_name: string | null;
  x_handle?: string | null;
  status: "pending_claim" | "active" | "suspended" | "revoked";
  credential_hash: string | null;
  last_seen_at: string | null;
  last_heartbeat_at?: string | null;
  tweet_claimed_at?: string | null;
  created_at: string;
}
