import { z } from "zod";

// ── Guard Rule & Entry Schemas ──────────────────────────────────────────────

export const GuardRuleSchema = z.enum(["never", "ask"]);
export type GuardRule = z.infer<typeof GuardRuleSchema>;

// ShareRule includes legacy 'share' for backwards compatibility
export const ShareRuleSchema = z.enum(["never", "ask", "share"]);
export type ShareRule = z.infer<typeof ShareRuleSchema>;

export const CreateFactRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Guard entry text cannot be empty")
    .max(2000, "Guard entry text cannot exceed 2000 characters"),
  guard: GuardRuleSchema.optional(),
  share_rule: ShareRuleSchema.optional(),
  category: z.string().optional(),
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

// ── Sensitive Specifics Categories Catalogue ────────────────────────────────

export const GuardCategoryKeySchema = z.enum([
  "secrets",
  "home_address",
  "phone_number",
  "personal_email",
  "live_location",
  "money_figures",
  "health_specifics",
  "family_specifics",
]);

export type GuardCategoryKey = z.infer<typeof GuardCategoryKeySchema>;

export const GuardCategoryModeSchema = z.enum(["open", "ask", "never"]);
export type GuardCategoryMode = z.infer<typeof GuardCategoryModeSchema>;

export interface GuardCategoryDefinition {
  id: GuardCategoryKey;
  label: string;
  description: string;
  defaultMode: GuardCategoryMode;
  allowedModes?: GuardCategoryMode[];
  registeredEntries?: string[];
}

export const UpdateCategoryModeRequestSchema = z.object({
  category: GuardCategoryKeySchema,
  mode: GuardCategoryModeSchema,
});

export type UpdateCategoryModeRequest = z.infer<typeof UpdateCategoryModeRequestSchema>;

export interface GuardCategoryState {
  category: GuardCategoryKey;
  label: string;
  description: string;
  mode: GuardCategoryMode;
}

export interface ScreeningActivityItem {
  id: string;
  timestamp: string;
  outcome: "blocked" | "held" | "shared" | "never";
  category?: string | null;
  text: string;
  approval_id?: string | null;
}

// ── Approval Schemas ────────────────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum(["pending", "shared", "denied", "never", "blocked"]);
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
  fact_id?: string | null;
  created_at: string;
}
