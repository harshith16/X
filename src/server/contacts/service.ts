import crypto from "crypto";
import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import type {
  ContactRecord,
  ContactInviteRecord,
  ContactItem,
  PendingRequestItem,
  ContactsResponse,
} from "@/types/contact";

export class ContactError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "ContactError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Global memory fallbacks for local dev / tests when migration 010 is not yet applied
const globalForContacts = globalThis as unknown as {
  __memoryContacts?: Map<string, ContactRecord>;
  __memoryContactInvites?: Map<string, ContactInviteRecord>;
};

export const memoryContacts = (globalForContacts.__memoryContacts ??= new Map<string, ContactRecord>());
export const memoryContactInvites = (globalForContacts.__memoryContactInvites ??= new Map<string, ContactInviteRecord>());

export function hashContactToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

export function generateContactToken(): string {
  return `ct_${crypto.randomBytes(24).toString("base64url")}`;
}

function isAgentOnline(agent: { status?: string; last_seen_at?: string | null }): boolean {
  if (agent.status !== "active") return false;
  if (!agent.last_seen_at) return false;
  const lastSeen = new Date(agent.last_seen_at).getTime();
  const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
  return lastSeen >= threeMinutesAgo;
}

/**
 * Creates a pending contact request to the owner of the given agent handle.
 */
export async function requestContactByHandle(
  ownerId: string,
  rawHandle: string,
  requestId: string,
): Promise<ContactRecord> {
  const cleanHandle = rawHandle.replace(/^@/, "").toLowerCase().trim();
  const db = getServiceClient();

  // 1. Look up target agent
  let targetAgent: { id: string; owner_id: string; handle: string; display_name?: string | null } | null = null;
  try {
    const { data } = await db
      .from("agents")
      .select("id, owner_id, handle, display_name")
      .ilike("handle", cleanHandle)
      .maybeSingle();
    if (data) targetAgent = data;
  } catch {}

  // Memory fallback for agents if DB query failed
  if (!targetAgent) {
    const globalAgents = (globalThis as any).__memoryAgents as Map<string, any> | undefined;
    if (globalAgents) {
      for (const a of globalAgents.values()) {
        if (a.handle?.toLowerCase() === cleanHandle) {
          targetAgent = a;
          break;
        }
      }
    }
  }

  if (!targetAgent) {
    logger.info({
      msg: `Contact request target handle @${cleanHandle} not found`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ContactError(
      "AGENT_NOT_FOUND",
      `We couldn't find an agent with handle @${cleanHandle}.`,
      404,
    );
  }

  // 2. Prevent adding yourself
  if (targetAgent.owner_id === ownerId) {
    throw new ContactError(
      "CANNOT_ADD_SELF",
      "You cannot add your own agent as a contact.",
      400,
    );
  }

  const targetOwnerId = targetAgent.owner_id;

  // 3. Check existing relationship in DB or memory
  let existingContact: ContactRecord | null = null;
  try {
    const { data } = await db
      .from("contacts")
      .select("*")
      .or(
        `and(owner_id.eq.${ownerId},contact_owner_id.eq.${targetOwnerId}),and(owner_id.eq.${targetOwnerId},contact_owner_id.eq.${ownerId})`,
      );
    if (data && data.length > 0) {
      existingContact = data[0] as ContactRecord;
    }
  } catch {}

  if (!existingContact) {
    for (const c of memoryContacts.values()) {
      if (
        (c.owner_id === ownerId && c.contact_owner_id === targetOwnerId) ||
        (c.owner_id === targetOwnerId && c.contact_owner_id === ownerId)
      ) {
        existingContact = c;
        break;
      }
    }
  }

  if (existingContact) {
    if (existingContact.state === "accepted") {
      throw new ContactError("ALREADY_CONTACTS", "You are already contacts.", 409);
    }
    if (existingContact.state === "pending") {
      throw new ContactError(
        "REQUEST_ALREADY_PENDING",
        "A contact request is already pending with this user.",
        409,
      );
    }
  }

  // 4. Create pending contact request
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const record: ContactRecord = {
    id: newId,
    owner_id: ownerId,
    contact_owner_id: targetOwnerId,
    state: "pending",
    source: "handle",
    created_at: now,
    responded_at: null,
  };

  memoryContacts.set(newId, record);

  try {
    const { error } = await db.from("contacts").insert({
      id: newId,
      owner_id: ownerId,
      contact_owner_id: targetOwnerId,
      state: "pending",
      source: "handle",
      created_at: now,
    });
    if (error && error.code !== "PGRST205") {
      logger.warn({
        msg: `Failed to insert contact row to DB: ${error.message}`,
        request_id: requestId,
      });
    }
  } catch {}

  logger.info({
    msg: `Contact request created from owner ${ownerId} to @${cleanHandle} (${targetOwnerId})`,
    request_id: requestId,
    contact_id: newId,
  });

  return record;
}

/**
 * Returns all contacts (accepted), incoming requests, and outgoing requests for the owner.
 */
export async function getContactsForOwner(
  ownerId: string,
  requestId: string,
): Promise<ContactsResponse> {
  const db = getServiceClient();

  let allContacts: ContactRecord[] = [];
  try {
    const { data } = await db
      .from("contacts")
      .select("*")
      .or(`owner_id.eq.${ownerId},contact_owner_id.eq.${ownerId}`);
    if (data) {
      allContacts = data as ContactRecord[];
    }
  } catch {}

  // Fallback to memoryContacts
  for (const c of memoryContacts.values()) {
    if (
      (c.owner_id === ownerId || c.contact_owner_id === ownerId) &&
      !allContacts.some((x) => x.id === c.id)
    ) {
      allContacts.push(c);
    }
  }

  // Categorize
  const acceptedRows = allContacts.filter(
    (c) => c.owner_id === ownerId && c.state === "accepted",
  );
  const incomingRows = allContacts.filter(
    (c) => c.contact_owner_id === ownerId && c.state === "pending",
  );
  const outgoingRows = allContacts.filter(
    (c) => c.owner_id === ownerId && c.state === "pending",
  );

  // Helper to fetch agent info for owners
  async function getAgentForOwner(uid: string) {
    try {
      const { data } = await db
        .from("agents")
        .select("id, owner_id, handle, display_name, status, last_seen_at")
        .eq("owner_id", uid)
        .maybeSingle();
      if (data) return data;
    } catch {}

    const globalAgents = (globalThis as any).__memoryAgents as Map<string, any> | undefined;
    if (globalAgents) {
      for (const a of globalAgents.values()) {
        if (a.owner_id === uid) return a;
      }
    }
    return null;
  }

  // Build accepted contacts list
  const contacts: ContactItem[] = [];
  for (const row of acceptedRows) {
    const agent = await getAgentForOwner(row.contact_owner_id);
    const handle = agent?.handle ?? "unknown";
    const displayName = agent?.display_name ?? `@${handle}`;
    const online = agent ? isAgentOnline(agent) : false;

    contacts.push({
      id: row.id,
      owner_id: row.owner_id,
      contact_owner_id: row.contact_owner_id,
      handle,
      display_name: displayName,
      presence: online ? "online" : "offline",
      presenceLine: online
        ? "online"
        : "offline — messages will be delivered when it reconnects",
      state: row.state,
      source: row.source,
      created_at: row.created_at,
      responded_at: row.responded_at,
    });
  }

  // Build incoming pending list
  const incoming: PendingRequestItem[] = [];
  for (const row of incomingRows) {
    const agent = await getAgentForOwner(row.owner_id);
    const handle = agent?.handle ?? "unknown";
    const displayName = agent?.display_name ?? `@${handle}`;

    incoming.push({
      id: row.id,
      owner_id: row.owner_id,
      contact_owner_id: row.contact_owner_id,
      handle,
      display_name: displayName,
      source: row.source,
      created_at: row.created_at,
      direction: "incoming",
    });
  }

  // Build outgoing pending list
  const outgoing: PendingRequestItem[] = [];
  for (const row of outgoingRows) {
    const agent = await getAgentForOwner(row.contact_owner_id);
    const handle = agent?.handle ?? "unknown";
    const displayName = agent?.display_name ?? `@${handle}`;

    outgoing.push({
      id: row.id,
      owner_id: row.owner_id,
      contact_owner_id: row.contact_owner_id,
      handle,
      display_name: displayName,
      source: row.source,
      created_at: row.created_at,
      direction: "outgoing",
    });
  }

  return { contacts, incoming, outgoing };
}

/**
 * Responds to a pending contact request (accept or decline).
 * Only the recipient (contact_owner_id) can respond.
 * On accept: writes the reciprocal accepted row (symmetry).
 * On decline: removes the pending request.
 */
export async function respondToContactRequest(
  contactId: string,
  currentUserId: string,
  action: "accept" | "decline",
  requestId: string,
): Promise<{ ok: boolean; state: string }> {
  const db = getServiceClient();

  let targetRow: ContactRecord | null = null;
  try {
    const { data } = await db.from("contacts").select("*").eq("id", contactId).maybeSingle();
    if (data) targetRow = data as ContactRecord;
  } catch {}

  if (!targetRow) {
    targetRow = memoryContacts.get(contactId) ?? null;
  }

  if (!targetRow) {
    throw new ContactError("NOT_FOUND", "Contact request not found.", 404);
  }

  if (targetRow.state !== "pending") {
    throw new ContactError("ALREADY_RESPONDED", "This contact request is no longer pending.", 400);
  }

  // Only the recipient can respond
  if (targetRow.contact_owner_id !== currentUserId) {
    logger.warn({
      msg: `Unauthorized response attempt to contact request ${contactId} by ${currentUserId}`,
      request_id: requestId,
    });
    throw new ContactError(
      "FORBIDDEN",
      "Only the recipient can respond to this contact request.",
      403,
    );
  }

  const now = new Date().toISOString();

  if (action === "accept") {
    // 1. Update original row to accepted
    targetRow.state = "accepted";
    targetRow.responded_at = now;
    memoryContacts.set(targetRow.id, targetRow);

    try {
      await db
        .from("contacts")
        .update({ state: "accepted", responded_at: now })
        .eq("id", targetRow.id);
    } catch {}

    // 2. Insert reciprocal accepted row
    const reciprocalId = crypto.randomUUID();
    const reciprocalRow: ContactRecord = {
      id: reciprocalId,
      owner_id: currentUserId,
      contact_owner_id: targetRow.owner_id,
      state: "accepted",
      source: targetRow.source,
      created_at: now,
      responded_at: now,
    };
    memoryContacts.set(reciprocalId, reciprocalRow);

    try {
      await db.from("contacts").insert({
        id: reciprocalId,
        owner_id: currentUserId,
        contact_owner_id: targetRow.owner_id,
        state: "accepted",
        source: targetRow.source,
        created_at: now,
        responded_at: now,
      });
    } catch {}

    logger.info({
      msg: `Contact request ${contactId} accepted; reciprocal row ${reciprocalId} created`,
      request_id: requestId,
    });

    return { ok: true, state: "accepted" };
  } else {
    // action === 'decline'
    memoryContacts.delete(targetRow.id);
    try {
      await db.from("contacts").delete().eq("id", targetRow.id);
    } catch {}

    logger.info({
      msg: `Contact request ${contactId} declined and removed`,
      request_id: requestId,
    });

    return { ok: true, state: "declined" };
  }
}

/**
 * Removes a contact relationship bilaterally (both directions).
 * Silently deletes both rows.
 */
export async function removeContact(
  contactIdOrOtherOwnerId: string,
  currentUserId: string,
  requestId: string,
): Promise<{ ok: boolean }> {
  const db = getServiceClient();

  // Find the contact relationship
  let otherOwnerId: string | null = null;

  // Check if contactIdOrOtherOwnerId matches a contact row id
  let targetRow: ContactRecord | null = null;
  try {
    const { data } = await db
      .from("contacts")
      .select("*")
      .eq("id", contactIdOrOtherOwnerId)
      .maybeSingle();
    if (data) targetRow = data as ContactRecord;
  } catch {}

  if (!targetRow) {
    targetRow = memoryContacts.get(contactIdOrOtherOwnerId) ?? null;
  }

  if (targetRow) {
    otherOwnerId =
      targetRow.owner_id === currentUserId
        ? targetRow.contact_owner_id
        : targetRow.owner_id;
  } else {
    // Treat as otherOwnerId directly
    otherOwnerId = contactIdOrOtherOwnerId;
  }

  if (!otherOwnerId) {
    return { ok: true };
  }

  // Delete both ways from memoryContacts
  for (const [id, c] of memoryContacts.entries()) {
    if (
      (c.owner_id === currentUserId && c.contact_owner_id === otherOwnerId) ||
      (c.owner_id === otherOwnerId && c.contact_owner_id === currentUserId)
    ) {
      memoryContacts.delete(id);
    }
  }

  // Delete both ways from DB
  try {
    await db
      .from("contacts")
      .delete()
      .or(
        `and(owner_id.eq.${currentUserId},contact_owner_id.eq.${otherOwnerId}),and(owner_id.eq.${otherOwnerId},contact_owner_id.eq.${currentUserId})`,
      );
  } catch {}

  logger.info({
    msg: `Bilateral contact removal between ${currentUserId} and ${otherOwnerId}`,
    request_id: requestId,
  });

  return { ok: true };
}

/**
 * Creates a one-time contact invite link /c/<token>.
 */
export async function createContactInvite(
  ownerId: string,
  requestId: string,
  appUrl: string,
): Promise<{ invite_id: string; link: string; expires_at: string }> {
  const db = getServiceClient();
  const rawToken = generateContactToken();
  const tokenHash = hashContactToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const newId = crypto.randomUUID();

  const inviteRecord: ContactInviteRecord = {
    id: newId,
    token_hash: tokenHash,
    owner_id: ownerId,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    used_by: null,
    used_at: null,
    revoked_at: null,
  };

  memoryContactInvites.set(tokenHash, inviteRecord);

  try {
    const { error } = await db.from("contact_invites").insert({
      id: newId,
      token_hash: tokenHash,
      owner_id: ownerId,
      created_at: inviteRecord.created_at,
      expires_at: expiresAt,
    });
    if (error && error.code !== "PGRST205") {
      logger.warn({
        msg: `Failed to insert contact_invites row to DB: ${error.message}`,
        request_id: requestId,
      });
    }
  } catch {}

  const cleanAppUrl = appUrl.replace(/\/$/, "");
  const link = `${cleanAppUrl}/c/${rawToken}`;

  logger.info({
    msg: `Contact invite created for owner ${ownerId}`,
    request_id: requestId,
    invite_id: newId,
  });

  return {
    invite_id: newId,
    link,
    expires_at: expiresAt,
  };
}

export type InviteResolution =
  | {
      status: "valid";
      inviteId: string;
      inviterOwnerId: string;
      inviterHandle: string;
      inviterDisplayName: string;
    }
  | {
      status: "invalid" | "expired" | "used" | "revoked";
      message: string;
    };

/**
 * Resolves a contact invite token and verifies its status.
 */
export async function resolveContactInvite(
  rawToken: string,
  currentUserId?: string,
): Promise<InviteResolution> {
  const tokenHash = hashContactToken(rawToken);
  const db = getServiceClient();

  let invite: ContactInviteRecord | null = null;
  try {
    const { data } = await db
      .from("contact_invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (data) invite = data as ContactInviteRecord;
  } catch {}

  if (!invite) {
    invite = memoryContactInvites.get(tokenHash) ?? null;
  }

  if (!invite) {
    return {
      status: "invalid",
      message: "This invite link is invalid or does not exist.",
    };
  }

  if (invite.revoked_at) {
    return {
      status: "revoked",
      message: "This invite link was revoked.",
    };
  }

  if (invite.used_at || invite.used_by) {
    return {
      status: "used",
      message: "This invite link has already been used.",
    };
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return {
      status: "expired",
      message: "This invite link has expired.",
    };
  }

  // Look up inviter's agent
  let agent: { handle: string; display_name?: string | null } | null = null;
  try {
    const { data } = await db
      .from("agents")
      .select("handle, display_name")
      .eq("owner_id", invite.owner_id)
      .maybeSingle();
    if (data) agent = data;
  } catch {}

  if (!agent) {
    const globalAgents = (globalThis as any).__memoryAgents as Map<string, any> | undefined;
    if (globalAgents) {
      for (const a of globalAgents.values()) {
        if (a.owner_id === invite.owner_id) {
          agent = a;
          break;
        }
      }
    }
  }

  const handle = agent?.handle ?? "agent";
  const displayName = agent?.display_name ?? `@${handle}`;

  return {
    status: "valid",
    inviteId: invite.id,
    inviterOwnerId: invite.owner_id,
    inviterHandle: handle,
    inviterDisplayName: displayName,
  };
}

/**
 * Consumes a contact invite, binding the two owners as accepted contacts immediately.
 */
export async function acceptContactInvite(
  rawToken: string,
  currentUserId: string,
  requestId: string,
): Promise<{ ok: boolean; inviterHandle: string }> {
  const resolution = await resolveContactInvite(rawToken, currentUserId);

  if (resolution.status !== "valid") {
    throw new ContactError("INVITE_INVALID", resolution.message, 400);
  }

  if (resolution.inviterOwnerId === currentUserId) {
    throw new ContactError(
      "CANNOT_ADD_SELF",
      "You cannot add yourself from your own invite link.",
      400,
    );
  }

  // Check if already contacts
  if (await areOwnersAcceptedContacts(currentUserId, resolution.inviterOwnerId)) {
    throw new ContactError("ALREADY_CONTACTS", "You are already contacts with this user.", 409);
  }

  const db = getServiceClient();
  const tokenHash = hashContactToken(rawToken);
  const now = new Date().toISOString();

  // Mark invite as used
  try {
    await db
      .from("contact_invites")
      .update({ used_by: currentUserId, used_at: now })
      .eq("token_hash", tokenHash);
  } catch {}

  const memInvite = memoryContactInvites.get(tokenHash);
  if (memInvite) {
    memInvite.used_by = currentUserId;
    memInvite.used_at = now;
  }

  // Insert bilateral accepted contact rows (inviter pre-consented)
  const rowAId = crypto.randomUUID();
  const rowBId = crypto.randomUUID();

  const rowA: ContactRecord = {
    id: rowAId,
    owner_id: resolution.inviterOwnerId,
    contact_owner_id: currentUserId,
    state: "accepted",
    source: "link",
    created_at: now,
    responded_at: now,
  };

  const rowB: ContactRecord = {
    id: rowBId,
    owner_id: currentUserId,
    contact_owner_id: resolution.inviterOwnerId,
    state: "accepted",
    source: "link",
    created_at: now,
    responded_at: now,
  };

  memoryContacts.set(rowAId, rowA);
  memoryContacts.set(rowBId, rowB);

  try {
    await db.from("contacts").insert([
      {
        id: rowAId,
        owner_id: resolution.inviterOwnerId,
        contact_owner_id: currentUserId,
        state: "accepted",
        source: "link",
        created_at: now,
        responded_at: now,
      },
      {
        id: rowBId,
        owner_id: currentUserId,
        contact_owner_id: resolution.inviterOwnerId,
        state: "accepted",
        source: "link",
        created_at: now,
        responded_at: now,
      },
    ]);
  } catch {}

  logger.info({
    msg: `Contact invite ${resolution.inviteId} accepted by user ${currentUserId}; contact formed with inviter ${resolution.inviterOwnerId}`,
    request_id: requestId,
  });

  return { ok: true, inviterHandle: resolution.inviterHandle };
}

/**
 * Checks if two owners are accepted contacts.
 */
export async function areOwnersAcceptedContacts(
  ownerAId: string,
  ownerBId: string,
): Promise<boolean> {
  if (!ownerAId || !ownerBId || ownerAId === ownerBId) return false;

  const db = getServiceClient();

  try {
    const { data } = await db
      .from("contacts")
      .select("id")
      .eq("owner_id", ownerAId)
      .eq("contact_owner_id", ownerBId)
      .eq("state", "accepted")
      .maybeSingle();

    if (data) return true;
  } catch {}

  // Check memoryContacts fallback
  for (const c of memoryContacts.values()) {
    if (
      c.owner_id === ownerAId &&
      c.contact_owner_id === ownerBId &&
      c.state === "accepted"
    ) {
      return true;
    }
  }

  return false;
}
