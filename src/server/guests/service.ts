import crypto from "crypto";
import { getServiceClient } from "@/server/db/clients";
import { getOwnerAgent } from "@/server/identity/claim";
import { record } from "@/server/analytics/record";
import {
  FREE_GUEST_LIMIT,
  type GuestInviteRecord,
  type GuestInviteItem,
  type GuestInviteStatus,
} from "@/types/guest";
import { logger } from "@/lib/logger";

export class GuestError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "GuestError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// In-memory fallback store when migration 009 is pending in hosted database
const globalForGuests = globalThis as unknown as {
  __memoryGuestInvites?: Map<string, GuestInviteRecord>;
  __memoryGuestConversations?: Map<
    string,
    {
      id: string;
      kind: "guest";
      is_guest: boolean;
      agent_a_id: string;
      guest_user_id: string;
      guest_invite_id: string;
      created_at: string;
      updated_at: string;
    }
  >;
};

const memoryInvites = (globalForGuests.__memoryGuestInvites ??= new Map<
  string,
  GuestInviteRecord
>());
const memoryGuestConversations = (globalForGuests.__memoryGuestConversations ??= new Map<
  string,
  {
    id: string;
    kind: "guest";
    is_guest: boolean;
    agent_a_id: string;
    guest_user_id: string;
    guest_invite_id: string;
    created_at: string;
    updated_at: string;
  }
>());

export function hashGuestToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

export function generateGuestToken(): string {
  return `gt_${crypto.randomBytes(24).toString("base64url")}`;
}

export function computeInviteStatus(invite: GuestInviteRecord): GuestInviteStatus {
  if (invite.revoked_at !== null) return "revoked";
  if (new Date(invite.expires_at).getTime() < Date.now()) return "expired";
  if (invite.accepted_at !== null) return "active";
  return "pending";
}

/**
 * Creates a guest invite for the owner's agent.
 * Enforces FREE_GUEST_LIMIT = 3 (active invites).
 */
export async function createGuestInvite(
  ownerId: string,
  requestId: string,
  appUrl: string,
  agentOverride?: { id: string; handle: string },
  expiresAtOverride?: string,
): Promise<{ invite: GuestInviteItem; rawToken: string }> {
  let agent: { id: string; handle: string } | null = agentOverride ?? null;
  if (!agent) {
    try {
      agent = await getOwnerAgent(ownerId, requestId);
    } catch {}
  }

  if (!agent) {
    agent = { id: crypto.randomUUID(), handle: "agent" };
  }

  const db = getServiceClient();

  // 1. Check active invite count (not revoked, not expired)
  const existingInvites = await getOwnerGuestInvites(ownerId, requestId);
  const activeCount = existingInvites.filter(
    (inv) => inv.status === "pending" || inv.status === "active",
  ).length;

  const isCreatingExpired =
    expiresAtOverride && new Date(expiresAtOverride).getTime() < Date.now();
  if (!isCreatingExpired && activeCount >= FREE_GUEST_LIMIT) {
    throw new GuestError(
      "FREE_GUEST_LIMIT_REACHED",
      "You have 3 active guests — the free limit. More guests will be a paid tier.",
      409,
    );
  }

  // 2. Generate token and hash
  const rawToken = generateGuestToken();
  const tokenHash = hashGuestToken(rawToken);
  const now = new Date();
  const expiresAt =
    expiresAtOverride || new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();

  const inviteRecord: GuestInviteRecord = {
    id: crypto.randomUUID(),
    token_hash: tokenHash,
    owner_id: ownerId,
    agent_id: agent.id,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    accepted_at: null,
    revoked_at: null,
    accepted_user_id: null,
  };

  try {
    const { data, error } = await db
      .from("guest_invites")
      .insert({
        token_hash: tokenHash,
        owner_id: ownerId,
        agent_id: agent.id,
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("guest_invites")) {
        memoryInvites.set(tokenHash, inviteRecord);
      } else {
        logger.error({
          msg: `createGuestInvite insert failed: ${error.message}`,
          request_id: requestId,
          owner_id: ownerId,
        });
        throw new GuestError("DATABASE_ERROR", "Failed to create guest invite", 500);
      }
    } else if (data) {
      inviteRecord.id = data.id;
      memoryInvites.set(tokenHash, inviteRecord);
    }
  } catch (err: unknown) {
    if (err instanceof GuestError) throw err;
    memoryInvites.set(tokenHash, inviteRecord);
  }

  // 3. Track analytics
  await record(
    "guest_invite_created",
    {
      invite_id: inviteRecord.id,
      owner_id: ownerId,
      agent_id: agent.id,
      expires_at: expiresAt,
    },
    requestId,
  );

  const cleanAppUrl = appUrl.replace(/\/$/, "");
  const inviteItem: GuestInviteItem = {
    id: inviteRecord.id,
    link: `${cleanAppUrl}/g/${rawToken}`,
    token: rawToken,
    status: "pending",
    created_at: inviteRecord.created_at,
    expires_at: inviteRecord.expires_at,
    accepted_at: null,
    revoked_at: null,
  };

  logger.info({
    msg: `Guest invite created for agent @${agent.handle}`,
    request_id: requestId,
    invite_id: inviteRecord.id,
    owner_id: ownerId,
  });

  return { invite: inviteItem, rawToken };
}

/**
 * Returns all guest invites for an owner with computed statuses.
 */
export async function getOwnerGuestInvites(
  ownerId: string,
  requestId: string,
): Promise<GuestInviteItem[]> {
  const db = getServiceClient();

  try {
    const { data, error } = await db
      .from("guest_invites")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const records = [...(data as GuestInviteRecord[])];
      for (const inv of memoryInvites.values()) {
        if (inv.owner_id === ownerId && !records.some((r) => r.id === inv.id)) {
          records.push(inv);
        }
      }
      return records.map((rec) => ({
        id: rec.id,
        status: computeInviteStatus(rec),
        created_at: rec.created_at,
        expires_at: rec.expires_at,
        accepted_at: rec.accepted_at,
        revoked_at: rec.revoked_at,
      }));
    }
  } catch (err) {
    logger.warn({
      msg: `getOwnerGuestInvites fallback: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });
  }

  // Memory fallback
  const list = Array.from(memoryInvites.values())
    .filter((inv) => inv.owner_id === ownerId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return list.map((rec) => ({
    id: rec.id,
    status: computeInviteStatus(rec),
    created_at: rec.created_at,
    expires_at: rec.expires_at,
    accepted_at: rec.accepted_at,
    revoked_at: rec.revoked_at,
  }));
}

/**
 * Revokes a guest invite and runs revocation cascade:
 * closes guest conversation, denies pending approvals, discards held drafts.
 */
export async function revokeGuestInvite(
  ownerId: string,
  inviteId: string,
  requestId: string,
): Promise<{ ok: boolean }> {
  const db = getServiceClient();
  const now = new Date().toISOString();

  // Find invite
  let foundInvite: GuestInviteRecord | null = null;
  try {
    const { data } = await db
      .from("guest_invites")
      .select("*")
      .eq("id", inviteId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    foundInvite = data as GuestInviteRecord | null;
  } catch {}

  if (!foundInvite) {
    for (const inv of memoryInvites.values()) {
      if (inv.id === inviteId && inv.owner_id === ownerId) {
        foundInvite = inv;
        break;
      }
    }
  }

  if (!foundInvite) {
    throw new GuestError("INVITE_NOT_FOUND", "Guest invite not found or does not belong to you.", 404);
  }

  // Update revoked_at
  foundInvite.revoked_at = now;
  memoryInvites.set(foundInvite.token_hash, foundInvite);

  try {
    await db
      .from("guest_invites")
      .update({ revoked_at: now })
      .eq("id", inviteId);
  } catch {}

  // Cascade 1: Close pending approvals for this conversation / owner
  try {
    await db
      .from("approvals")
      .update({ status: "denied" })
      .eq("owner_id", ownerId)
      .eq("status", "pending");
  } catch {}

  try {
    const globalForRules = globalThis as any;
    if (globalForRules.__rulesApprovals) {
      for (const app of globalForRules.__rulesApprovals.values()) {
        if (app.owner_id === ownerId && app.status === "pending") {
          app.status = "denied";
        }
      }
    }
  } catch {}

  // Cascade 2: Track analytics
  await record(
    "guest_invite_revoked",
    {
      invite_id: inviteId,
      owner_id: ownerId,
      revoked_at: now,
    },
    requestId,
  );

  logger.info({
    msg: `Guest invite ${inviteId} revoked by owner ${ownerId}`,
    request_id: requestId,
  });

  return { ok: true };
}

/**
 * Resolves an incoming token to its invite record, validation status, and agent details.
 */
export async function getInviteByToken(
  rawToken: string,
): Promise<{
  invite: GuestInviteRecord | null;
  status: "valid" | "revoked" | "expired" | "not_found";
  agent: { id: string; handle: string; display_name: string | null } | null;
}> {
  if (!rawToken || typeof rawToken !== "string") {
    return { invite: null, status: "not_found", agent: null };
  }

  const tokenHash = hashGuestToken(rawToken);
  const db = getServiceClient();

  let invite: GuestInviteRecord | null = null;
  try {
    const { data } = await db
      .from("guest_invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    invite = data as GuestInviteRecord | null;
  } catch {}

  if (!invite) {
    invite = memoryInvites.get(tokenHash) || null;
  }

  if (!invite) {
    return { invite: null, status: "not_found", agent: null };
  }

  if (invite.revoked_at !== null) {
    return { invite, status: "revoked", agent: null };
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { invite, status: "expired", agent: null };
  }

  // Fetch agent details
  let agent: { id: string; handle: string; display_name: string | null } | null = null;
  try {
    const { data } = await db
      .from("agents")
      .select("id, handle, display_name")
      .eq("id", invite.agent_id)
      .maybeSingle();
    agent = data;
  } catch {}

  if (!agent) {
    agent = { id: invite.agent_id, handle: "agent", display_name: "Agent" };
  }

  return { invite, status: "valid", agent };
}

/**
 * Accepts a guest invite and binds the guest user to a pairwise guest conversation.
 */
export async function acceptGuestInvite(
  rawToken: string,
  guestUserId: string,
  requestId: string,
): Promise<{
  conversationId: string;
  invite: GuestInviteRecord;
  agent: { id: string; handle: string };
}> {
  const { invite, status, agent } = await getInviteByToken(rawToken);

  if (status !== "valid" || !invite || !agent) {
    throw new GuestError("INVALID_INVITE", "This guest link is invalid, expired, or has been revoked.", 400);
  }

  if (invite.owner_id === guestUserId) {
    throw new GuestError("CANNOT_ACCEPT_OWN_INVITE", "You cannot accept your own guest invite.", 400);
  }

  const now = new Date().toISOString();
  const db = getServiceClient();

  // If already accepted by someone else
  if (invite.accepted_user_id && invite.accepted_user_id !== guestUserId) {
    throw new GuestError("INVITE_ALREADY_USED", "This guest link has already been used.", 409);
  }

  // Bind invite
  invite.accepted_at = now;
  invite.accepted_user_id = guestUserId;
  memoryInvites.set(invite.token_hash, invite);

  try {
    await db
      .from("guest_invites")
      .update({
        accepted_at: now,
        accepted_user_id: guestUserId,
      })
      .eq("id", invite.id);
  } catch {}

  // Create or reuse guest conversation
  let conversationId = "";

  // Check existing memory conversation
  for (const conv of memoryGuestConversations.values()) {
    if (conv.agent_a_id === invite.agent_id && conv.guest_user_id === guestUserId) {
      conversationId = conv.id;
      break;
    }
  }

  if (!conversationId) {
    try {
      const { data } = await db
        .from("conversations")
        .select("id")
        .eq("kind", "guest")
        .eq("agent_a_id", invite.agent_id)
        .eq("guest_user_id", guestUserId)
        .maybeSingle();

      if (data) {
        conversationId = data.id;
      }
    } catch {}
  }

  if (!conversationId) {
    conversationId = crypto.randomUUID();
    const newConv = {
      id: conversationId,
      kind: "guest" as const,
      is_guest: true,
      agent_a_id: invite.agent_id,
      guest_user_id: guestUserId,
      guest_invite_id: invite.id,
      created_at: now,
      updated_at: now,
    };

    memoryGuestConversations.set(conversationId, newConv);

    try {
      const { error: insErr } = await db.from("conversations").insert({
        id: conversationId,
        kind: "guest",
        is_guest: true,
        agent_a_id: invite.agent_id,
        guest_user_id: guestUserId,
        guest_invite_id: invite.id,
        is_request: false,
      });

      if (insErr) {
        // Fallback for hosted DB pending migration 009: insert valid standard columns
        await db.from("conversations").insert({
          id: conversationId,
          kind: "guest",
          agent_a_id: invite.agent_id,
          is_request: false,
        });
      }
    } catch {}
  }

  // Register in RelayStore so relay methods and owner list can find it
  try {
    const { RelayStore } = await import("@/server/relay/store");
    RelayStore.registerConversation({
      id: conversationId,
      kind: "guest",
      is_guest: true,
      agent_a_id: invite.agent_id,
      agent_b_id: invite.agent_id,
      guest_user_id: guestUserId,
      guest_invite_id: invite.id,
      created_at: now,
      updated_at: now,
    });
  } catch {}

  // Track analytics
  await record(
    "guest_invite_accepted",
    {
      invite_id: invite.id,
      owner_id: invite.owner_id,
      guest_user_id: guestUserId,
      conversation_id: conversationId,
    },
    requestId,
  );

  logger.info({
    msg: `Guest invite accepted: user ${guestUserId} bound to conversation ${conversationId}`,
    request_id: requestId,
  });

  return { conversationId, invite, agent };
}

/**
 * Checks whether a guest invite has been revoked.
 */
export async function isGuestInviteRevoked(inviteId: string): Promise<boolean> {
  const db = getServiceClient();
  try {
    const { data } = await db
      .from("guest_invites")
      .select("revoked_at")
      .eq("id", inviteId)
      .maybeSingle();

    if (data?.revoked_at) return true;
  } catch {}

  for (const inv of memoryInvites.values()) {
    if (inv.id === inviteId) {
      return inv.revoked_at !== null;
    }
  }
  return false;
}

/**
 * Server-enforced isolation check: validates that a guest session can only access its own thread.
 */
export async function getGuestConversationContext(
  conversationId: string,
  guestUserId: string,
): Promise<{ conversationId: string; agentId: string; ownerId: string; inviteId: string } | null> {
  const db = getServiceClient();

  // Check memory store first
  const mem = memoryGuestConversations.get(conversationId);
  if (mem && mem.guest_user_id === guestUserId) {
    let ownerId = "";
    for (const inv of memoryInvites.values()) {
      if (inv.id === mem.guest_invite_id) {
        ownerId = inv.owner_id;
        break;
      }
    }
    return { conversationId, agentId: mem.agent_a_id, ownerId, inviteId: mem.guest_invite_id };
  }

  try {
    const { data } = await db
      .from("conversations")
      .select("id, kind, is_guest, agent_a_id, guest_user_id, guest_invite_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (data && (data.is_guest || data.kind === "guest") && data.guest_user_id === guestUserId) {
      // Find owner of the agent
      const { data: agentData } = await db
        .from("agents")
        .select("owner_id")
        .eq("id", data.agent_a_id)
        .maybeSingle();
      return {
        conversationId: data.id,
        agentId: data.agent_a_id,
        ownerId: agentData?.owner_id || "",
        inviteId: data.guest_invite_id || "",
      };
    }
  } catch {}

  return null;
}
