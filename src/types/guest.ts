import { z } from "zod";

export const FREE_GUEST_LIMIT = 3;

export type GuestInviteStatus = "pending" | "active" | "revoked" | "expired";

export interface GuestInviteRecord {
  id: string;
  token_hash: string;
  owner_id: string;
  agent_id: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  accepted_user_id: string | null;
}

export interface GuestInviteItem {
  id: string;
  link?: string;
  token?: string;
  status: GuestInviteStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export const CreateGuestInviteResponseSchema = z.object({
  invite: z.object({
    id: z.string(),
    link: z.string(),
    token: z.string(),
    expires_at: z.string(),
    status: z.enum(["pending", "active", "revoked", "expired"]),
  }),
  request_id: z.string(),
});

export interface GuestConversationContext {
  conversation_id: string;
  agent_id: string;
  agent_handle: string;
  owner_id: string;
  guest_user_id: string;
  invite_id: string;
}
