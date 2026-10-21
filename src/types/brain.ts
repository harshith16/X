import { z } from "zod";

// ── Fact Schemas ────────────────────────────────────────────────────────────

export const ShareRuleSchema = z.enum(["share", "ask", "never"]);
export type ShareRule = z.infer<typeof ShareRuleSchema>;

export const CreateFactRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Fact text cannot be empty")
    .max(2000, "Fact text cannot exceed 2000 characters"),
  share_rule: ShareRuleSchema.default("ask"),
});

export type CreateFactRequest = z.infer<typeof CreateFactRequestSchema>;

export interface FactRecord {
  id: string;
  owner_id: string;
  agent_id?: string | null;
  text: string;
  share_rule: ShareRule;
  embedding?: number[] | string | null;
  content_hash: string;
  metadata?: Record<string, unknown>;
  valid_at: string;
  invalid_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Approval Schemas ────────────────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum(["pending", "shared", "denied", "never"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ResolveApprovalDecisionSchema = z.enum(["share", "not_now", "never"]);
export type ResolveApprovalDecision = z.infer<typeof ResolveApprovalDecisionSchema>;

export const ResolveApprovalRequestSchema = z.object({
  decision: ResolveApprovalDecisionSchema,
});

export type ResolveApprovalRequest = z.infer<typeof ResolveApprovalRequestSchema>;

export interface ApprovalRecord {
  id: string;
  owner_id: string;
  agent_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  fact_id?: string | null;
  question: string;
  status: ApprovalStatus;
  created_at: string;
  resolved_at?: string | null;
}

export interface BlockRecord {
  id: string;
  owner_id: string;
  agent_id?: string | null;
  fact_id: string;
  created_at: string;
}

// ── Think Endpoint Schemas ──────────────────────────────────────────────────

export const ThinkRequestSchema = z.object({
  conversation_id: z.string().min(1, "conversation_id is required"),
  question: z
    .string()
    .trim()
    .min(1, "question cannot be empty")
    .max(2000, "question cannot exceed 2000 characters"),
});

export type ThinkRequest = z.infer<typeof ThinkRequestSchema>;

export interface ThinkResponse {
  ok: boolean;
  outcome: "reply" | "deflect" | "no_answer";
  reply?: string;
  approval_id?: string;
  request_id: string;
}
