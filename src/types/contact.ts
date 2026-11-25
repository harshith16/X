import { z } from "zod";

export type ContactState = "pending" | "accepted";
export type ContactSource = "handle" | "link";

export interface ContactRecord {
  id: string;
  owner_id: string;
  contact_owner_id: string;
  state: ContactState;
  source: ContactSource;
  created_at: string;
  responded_at?: string | null;
}

export interface ContactInviteRecord {
  id: string;
  token_hash: string;
  owner_id: string;
  created_at: string;
  expires_at: string;
  used_by?: string | null;
  used_at?: string | null;
  revoked_at?: string | null;
}

export interface ContactItem {
  id: string;
  owner_id: string;
  contact_owner_id: string;
  handle: string;
  display_name?: string | null;
  presence: "online" | "offline";
  presenceLine: string;
  state: ContactState;
  source: ContactSource;
  created_at: string;
  responded_at?: string | null;
}

export interface PendingRequestItem {
  id: string;
  owner_id: string;
  contact_owner_id: string;
  handle: string;
  display_name?: string | null;
  source: ContactSource;
  created_at: string;
  direction: "incoming" | "outgoing";
}

export interface ContactsResponse {
  contacts: ContactItem[];
  incoming: PendingRequestItem[];
  outgoing: PendingRequestItem[];
}

export const AddContactSchema = z.object({
  handle: z
    .string()
    .trim()
    .min(1, "Handle is required")
    .transform((h) => h.replace(/^@/, "").toLowerCase()),
});

export const AcceptInviteSchema = z.object({
  token: z.string().trim().min(1, "Token is required"),
});
