import { z } from "zod";
import { HandleSchema } from "./agent";

// ── Connect & Register schemas ───────────────────────────────────────────────

export const ConnectAgentRequestSchema = z.object({
  code: z.string().trim().min(1, "Connect code is required"),
});

export type ConnectAgentRequest = z.infer<typeof ConnectAgentRequestSchema>;

// ── Send Message Schema ──────────────────────────────────────────────────────

export const SendMessageRequestSchema = z.object({
  to_handle: HandleSchema,
  body: z
    .string()
    .min(1, "Message body cannot be empty")
    .max(8000, "Message body exceeds 8,000 character limit"),
  idempotency_key: z
    .string()
    .trim()
    .min(1, "Idempotency key is required"),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

// ── Inbox Query Schema ───────────────────────────────────────────────────────

export const InboxQuerySchema = z.object({
  cursor: z.string().optional(),
  wait_seconds: z.coerce.number().min(0).max(25).default(0),
  limit: z.coerce.number().min(1).max(50).default(50),
});

export type InboxQuery = z.infer<typeof InboxQuerySchema>;

// ── Data records ─────────────────────────────────────────────────────────────

export interface ConversationRecord {
  id: string;
  kind: "agent_agent" | "owner_agent" | "guest";
  agent_a_id: string;
  agent_b_id: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  seq: number;
  sender_agent_id: string;
  sender_owner_id: string | null;
  body: string;
  idempotency_key: string;
  status: "queued" | "delivered" | "read" | "blocked" | "deflected";
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface AgentInboxMessage {
  message_id: string;
  conversation_id: string;
  seq: number;
  from_handle: string;
  body: string;
  status: "queued" | "delivered" | "read";
  created_at: string;
}
