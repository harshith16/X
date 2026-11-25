import { EventEmitter } from "events";
import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import {
  generateConnectCode,
  hashConnectCode,
  generateAgentCredential,
  hashAgentCredential,
} from "@/lib/crypto";
import { AgentRecord } from "@/types/agent";
import {
  AgentInboxMessage,
  ConversationRecord,
  MessageRecord,
} from "@/types/relay";
import { RelayStore } from "./store";
import { screenOutgoingMessage } from "@/server/rules/engine";
import { areOwnersAcceptedContacts } from "@/server/contacts/service";

export class RelayError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Event bus for inbox long-poll notifications
const globalForService = globalThis as unknown as {
  __relayInboxEvents?: EventEmitter;
};
const inboxEvents = (globalForService.__relayInboxEvents ??= (() => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  return emitter;
})());

/**
 * Determines whether an agent is considered "online":
 * Online ONLY if the last heartbeat (last_heartbeat_at or last_seen_at)
 * is under 3 minutes old (< 180,000 ms). Otherwise offline with a grey dot.
 */
export function isAgentOnline(agent: {
  last_heartbeat_at?: string | null;
  last_seen_at?: string | null;
}): boolean {
  const last = agent.last_heartbeat_at || agent.last_seen_at;
  if (!last) return false;
  const elapsed = Date.now() - new Date(last).getTime();
  return elapsed < 3 * 60 * 1000;
}

/**
 * Creates a single-use, 15-minute expiry connect code for an owner's agent.
 * Stored HASHED in claim_codes, plaintext returned once.
 */
export async function createConnectCode(
  ownerId: string,
  requestId: string,
): Promise<{ code: string; expires_at: string }> {
  const db = getServiceClient();

  // Find owner's agent
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (agentErr || !agent) {
    logger.warn({
      msg: "Cannot create connect code without an agent",
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new RelayError("AGENT_NOT_FOUND", "No agent found for this owner.", 404);
  }

  const plainCode = generateConnectCode();
  const codeHash = hashConnectCode(plainCode);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Insert into claim_codes table
  const { error: insertErr } = await db.from("claim_codes").insert({
    owner_id: ownerId,
    code_hash: codeHash,
    requested_handle: agent.handle,
    expires_at: expiresAt,
  });

  if (insertErr) {
    logger.error({
      msg: `Failed to insert connect code: ${insertErr.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new RelayError("DATABASE_ERROR", "Failed to generate connect code.", 500);
  }

  logger.info({
    msg: `Generated connect code for @${agent.handle}`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return { code: plainCode, expires_at: expiresAt };
}

/**
 * Redeems a connect code:
 * Validates code is unused + unexpired, burns it, and returns the agent's
 * long-lived credential (random, stored hashed) + agent id/handle.
 * Bad/expired/reused code → plain 401.
 */
export async function redeemConnectCode(
  code: string,
  requestId: string,
): Promise<{ agent_id: string; handle: string; credential: string }> {
  const db = getServiceClient();
  const codeHash = hashConnectCode(code);

  // Look up claim code by hash
  const { data: codeRow, error: findErr } = await db
    .from("claim_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (findErr || !codeRow) {
    logger.warn({
      msg: "Connect code lookup failed or code not found",
      request_id: requestId,
    });
    throw new RelayError("CLAIM_CODE_INVALID", "Invalid connect code.", 401);
  }

  // Check already used
  if (codeRow.used_at) {
    logger.warn({
      msg: "Connect code was already used",
      request_id: requestId,
    });
    throw new RelayError("CLAIM_CODE_USED", "This connect code has already been used.", 401);
  }

  // Check expired
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    logger.warn({
      msg: "Connect code has expired",
      request_id: requestId,
    });
    throw new RelayError("CLAIM_CODE_EXPIRED", "This connect code has expired.", 401);
  }

  // Atomically burn the code
  const { error: burnErr } = await db
    .from("claim_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", codeRow.id)
    .is("used_at", null);

  if (burnErr) {
    logger.error({
      msg: `Failed to burn connect code: ${burnErr.message}`,
      request_id: requestId,
    });
    throw new RelayError("CLAIM_CODE_INVALID", "Failed to validate connect code.", 401);
  }

  // Find agent
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", codeRow.owner_id)
    .maybeSingle();

  if (agentErr || !agent) {
    logger.error({
      msg: "Agent not found for redeemed connect code",
      request_id: requestId,
    });
    throw new RelayError("AGENT_NOT_FOUND", "Agent not found.", 404);
  }

  // Generate long-lived agent credential
  const plainCredential = generateAgentCredential();
  const credentialHash = hashAgentCredential(plainCredential);
  const now = new Date().toISOString();

  // Update agent row with hashed credential and active status
  const { error: updateErr } = await db
    .from("agents")
    .update({
      credential_hash: credentialHash,
      status: "active",
      last_seen_at: now,
      last_heartbeat_at: now,
    })
    .eq("id", agent.id);

  if (updateErr) {
    // If last_heartbeat_at column doesn't exist yet, fallback to updating credential_hash & last_seen_at
    await db
      .from("agents")
      .update({
        credential_hash: credentialHash,
        status: "active",
        last_seen_at: now,
      })
      .eq("id", agent.id);
  }

  logger.info({
    msg: `Agent @${agent.handle} connected successfully`,
    request_id: requestId,
    agent_id: agent.id,
  });

  return {
    agent_id: agent.id,
    handle: agent.handle,
    credential: plainCredential,
  };
}

/**
 * Authenticates an agent using Authorization: Bearer <credential>.
 * Resolves credential → exactly one agent.
 */
export async function authenticateAgent(
  authHeader: string | null | undefined,
  requestId: string,
): Promise<AgentRecord> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new RelayError("UNAUTHORIZED", "Missing or invalid Authorization header.", 401);
  }

  const credential = authHeader.slice(7).trim();
  if (!credential) {
    throw new RelayError("UNAUTHORIZED", "Empty credential provided.", 401);
  }

  const credHash = hashAgentCredential(credential);
  const db = getServiceClient();

  const { data: agent, error } = await db
    .from("agents")
    .select("*")
    .eq("credential_hash", credHash)
    .maybeSingle();

  if (error || !agent) {
    logger.warn({
      msg: "Agent authentication failed: invalid credential",
      request_id: requestId,
    });
    throw new RelayError("UNAUTHORIZED", "Invalid agent credential.", 401);
  }

  if (agent.status === "revoked") {
    throw new RelayError("UNAUTHORIZED", "Agent credential has been revoked.", 401);
  }

  return agent as AgentRecord;
}

/**
 * Updates agent heartbeat timestamp.
 */
export async function recordHeartbeat(
  agentId: string,
  requestId: string,
): Promise<{ ok: boolean; server_time: string }> {
  const db = getServiceClient();
  const now = new Date().toISOString();

  // Update last_heartbeat_at & last_seen_at
  const { error } = await db
    .from("agents")
    .update({
      last_heartbeat_at: now,
      last_seen_at: now,
    })
    .eq("id", agentId);

  if (error) {
    // Fallback if last_heartbeat_at not yet in schema
    await db
      .from("agents")
      .update({
        last_seen_at: now,
      })
      .eq("id", agentId);
  }

  logger.info({
    msg: "Recorded agent heartbeat",
    request_id: requestId,
    agent_id: agentId,
  });

  return { ok: true, server_time: now };
}

/**
 * Sends a message from authenticated senderAgent to toHandle.
 * Creates conversation if needed, stores message, returns message id + status.
 * Re-sending same idempotency_key returns original message — never duplicate row.
 * Unknown handle → plain 404.
 */
export async function sendMessage(
  senderAgent: AgentRecord,
  toHandle: string | undefined,
  body: string,
  idempotencyKey: string,
  requestId: string,
  conversationId?: string,
): Promise<{
  ok: boolean;
  message_id: string;
  status: string;
  conversation_id: string;
  seq: number;
}> {
  const db = getServiceClient();

  let conv: ConversationRecord | null = null;
  let recipientAgent: AgentRecord | null = null;

  if (conversationId) {
    conv = await RelayStore.getConversationById(conversationId);
    if (!conv) {
      throw new RelayError("NOT_FOUND", "Conversation not found.", 404);
    }

    if (conv.agent_a_id !== senderAgent.id && conv.agent_b_id !== senderAgent.id) {
      throw new RelayError("FORBIDDEN", "Agent is not a participant in this conversation.", 403);
    }

    if (conv.is_guest || conv.kind === "guest") {
      if (conv.guest_invite_id) {
        const { isGuestInviteRevoked } = await import("@/server/guests/service");
        const isRevoked = await isGuestInviteRevoked(conv.guest_invite_id);
        if (isRevoked) {
          throw new RelayError("INVITE_REVOKED", "This guest conversation has been closed.", 403);
        }
      }
    } else {
      const recipientId = conv.agent_a_id === senderAgent.id ? conv.agent_b_id : conv.agent_a_id;
      if (recipientId) {
        const { data: recAgent } = await db.from("agents").select("*").eq("id", recipientId).maybeSingle();
        recipientAgent = recAgent;
      }
    }
  } else if (toHandle) {
    const cleanToHandle = toHandle.replace(/^@/, "").toLowerCase().trim();
    const { data: foundAgent, error: recipientErr } = await db
      .from("agents")
      .select("*")
      .eq("handle", cleanToHandle)
      .maybeSingle();

    if (recipientErr || !foundAgent) {
      logger.warn({
        msg: `Recipient agent @${cleanToHandle} not found`,
        request_id: requestId,
      });
      throw new RelayError("AGENT_NOT_FOUND", `Recipient agent @${cleanToHandle} not found.`, 404);
    }
    recipientAgent = foundAgent as AgentRecord;

    // Check if receiver owner and sender owner are accepted contacts (or have an existing accepted conversation)
    let isRequest = false;
    try {
      const areContacts = await areOwnersAcceptedContacts(
        senderAgent.owner_id,
        recipientAgent.owner_id,
      );
      if (!areContacts) {
        const existingConvs = await RelayStore.getConversationsForAgent(recipientAgent.id);
        const hasAccepted = existingConvs.some(
          (c) =>
            (c.agent_a_id === senderAgent.id || c.agent_b_id === senderAgent.id) &&
            c.is_request === false,
        );
        if (!hasAccepted) {
          isRequest = true;
        }
      }
    } catch {
      // Default false
    }

    conv = await RelayStore.getOrCreateConversation(
      senderAgent.id,
      recipientAgent.id,
      requestId,
      isRequest,
    );
  } else {
    throw new RelayError("VALIDATION_FAILED", "Either to_handle or conversation_id must be provided.", 400);
  }

  // 2. Check idempotency: re-sending the same idempotency_key returns the ORIGINAL message
  const existingMsg = await RelayStore.findByIdempotency(senderAgent.id, idempotencyKey);
  if (existingMsg) {
    logger.info({
      msg: `Idempotent message replay: ${existingMsg.id}`,
      request_id: requestId,
      idempotency_key: idempotencyKey,
    });
    return {
      ok: true,
      message_id: existingMsg.id,
      status: existingMsg.status,
      conversation_id: existingMsg.conversation_id,
      seq: existingMsg.seq,
    };
  }

  // 3. Screen outgoing message against sender owner's guardrails (pure deterministic code, NO LLM)
  const screenResult = await screenOutgoingMessage({
    ownerId: senderAgent.owner_id,
    agentId: senderAgent.id,
    conversationId: conv.id,
    text: body,
    requestId,
  });

  if (screenResult.action === "block") {
    logger.warn({
      msg: "Outgoing message blocked by rules",
      request_id: requestId,
      sender_handle: senderAgent.handle,
    });
    throw new RelayError("blocked_by_rules", "Message blocked by owner guardrails.", 403);
  }

  // If held for approval, do NOT deliver draft message yet
  if (screenResult.action === "hold") {
    logger.info({
      msg: "Outgoing message held for approval",
      request_id: requestId,
      approval_id: screenResult.approvalId,
      sender_handle: senderAgent.handle,
    });
    return {
      ok: true,
      message_id: "",
      status: "held_for_approval",
      approval_id: screenResult.approvalId,
      conversation_id: conv.id,
      seq: 0,
    } as any;
  }

  // 4. Insert message
  const storedMsg = await RelayStore.insertMessage(
    conv.id,
    senderAgent.id,
    body,
    idempotencyKey,
  );

  if (recipientAgent) {
    logger.info({
      msg: `Message sent from @${senderAgent.handle} to @${recipientAgent.handle} (id: ${storedMsg.id})`,
      request_id: requestId,
      message_id: storedMsg.id,
      conversation_id: conv.id,
    });
    // Notify any waiting long-pollers for this recipient
    inboxEvents.emit(`msg:${recipientAgent.id}`, storedMsg);
  } else {
    logger.info({
      msg: `Message sent from @${senderAgent.handle} to guest conversation (id: ${storedMsg.id})`,
      request_id: requestId,
      message_id: storedMsg.id,
      conversation_id: conv.id,
    });
  }

  return {
    ok: true,
    message_id: storedMsg.id,
    status: storedMsg.status,
    conversation_id: conv.id,
    seq: storedMsg.seq,
  };
}

/**
 * Polls inbox for recipientAgent:
 * Long-poll up to 25s, cursor pagination (max 50),
 * marks new messages as delivered, returns them.
 */
export async function getInbox(
  recipientAgent: AgentRecord,
  cursor: string | undefined,
  waitSeconds: number = 0,
  limit: number = 50,
  requestId: string,
): Promise<{ messages: AgentInboxMessage[]; next_cursor: string | null }> {
  // 1. Initial check for messages
  let msgs = await RelayStore.getInboxMessages(recipientAgent.id, cursor, limit);

  // 2. If no messages and wait requested, long-poll
  if (msgs.length === 0 && waitSeconds > 0) {
    const cappedWait = Math.min(25, Math.max(1, waitSeconds));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        inboxEvents.removeListener(`msg:${recipientAgent.id}`, onNewMessage);
        resolve();
      }, cappedWait * 1000);

      function onNewMessage() {
        clearTimeout(timer);
        inboxEvents.removeListener(`msg:${recipientAgent.id}`, onNewMessage);
        resolve();
      }

      inboxEvents.once(`msg:${recipientAgent.id}`, onNewMessage);
    });

    // Re-check messages after wait
    msgs = await RelayStore.getInboxMessages(recipientAgent.id, cursor, limit);
  }

  // 3. Mark queued messages as delivered
  const queuedIds = msgs.filter((m) => m.status === "queued").map((m) => m.id);
  if (queuedIds.length > 0) {
    await RelayStore.updateMessagesStatus(queuedIds, "delivered");
  }

  // 4. Resolve sender handles
  const db = getServiceClient();
  const senderIds = Array.from(new Set(msgs.map((m) => m.sender_agent_id)));
  const handleMap = new Map<string, string>();

  if (senderIds.length > 0) {
    const { data: agents } = await db.from("agents").select("id, handle").in("id", senderIds);
    if (agents) {
      for (const a of agents) {
        handleMap.set(a.id, a.handle);
      }
    }
  }

  const resultMessages: AgentInboxMessage[] = msgs.map((m) => ({
    message_id: m.id,
    conversation_id: m.conversation_id,
    seq: m.seq,
    from_handle: m.sender_agent_id ? (handleMap.get(m.sender_agent_id) ?? "unknown") : "guest",
    body: m.body,
    status: (queuedIds.includes(m.id) ? "delivered" : m.status) as "queued" | "delivered" | "read",
    created_at: m.created_at,
  }));

  const nextCursor =
    resultMessages.length === limit ? resultMessages[resultMessages.length - 1]!.created_at : null;

  return {
    messages: resultMessages,
    next_cursor: nextCursor,
  };
}

/**
 * Marks a message read (recipient only).
 */
export async function markMessageRead(
  agentId: string,
  messageId: string,
  requestId: string,
): Promise<{ ok: boolean; status: "read" }> {
  const msg = await RelayStore.getMessageById(messageId);
  if (!msg) {
    throw new RelayError("NOT_FOUND", "Message not found.", 404);
  }

  const conv = await RelayStore.getConversationById(msg.conversation_id);
  if (!conv) {
    throw new RelayError("NOT_FOUND", "Conversation not found.", 404);
  }

  // Ensure caller is participant in conversation and NOT the sender (must be recipient)
  const isParticipant = conv.agent_a_id === agentId || conv.agent_b_id === agentId;
  const isSender = msg.sender_agent_id === agentId;

  if (!isParticipant || isSender) {
    logger.warn({
      msg: "Unauthorized attempt to mark message as read",
      request_id: requestId,
      agent_id: agentId,
      message_id: messageId,
    });
    throw new RelayError("FORBIDDEN", "Only recipient can mark message as read.", 403);
  }

  await RelayStore.updateMessagesStatus([messageId], "read");

  logger.info({
    msg: `Message ${messageId} marked read by agent ${agentId}`,
    request_id: requestId,
  });

  return { ok: true, status: "read" };
}

/**
 * Reads back a message status (for sender or recipient).
 */
export async function getMessageStatus(
  agentId: string,
  messageId: string,
  requestId: string,
): Promise<MessageRecord> {
  const msg = await RelayStore.getMessageById(messageId);
  if (!msg) {
    throw new RelayError("NOT_FOUND", "Message not found.", 404);
  }

  const conv = await RelayStore.getConversationById(msg.conversation_id);
  if (!conv) {
    throw new RelayError("NOT_FOUND", "Conversation not found.", 404);
  }

  const isParticipant = conv.agent_a_id === agentId || conv.agent_b_id === agentId;
  if (!isParticipant) {
    logger.warn({
      msg: "Unauthorized attempt to inspect message status",
      request_id: requestId,
      agent_id: agentId,
      message_id: messageId,
    });
    throw new RelayError("NOT_FOUND", "Message not found.", 404);
  }

  return msg;
}

/**
 * Returns conversations for owner's shell view.
 */
export async function getOwnerConversations(
  ownerId: string,
  requestId: string,
) {
  const db = getServiceClient();

  // Find owner's agent
  const { data: ownerAgent } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!ownerAgent) return [];

  const convs = await RelayStore.getConversationsForAgent(ownerAgent.id);
  const result = [];

  for (const conv of convs) {
    if (conv.is_guest || conv.kind === "guest") {
      let guestName = "Guest";
      if (conv.guest_user_id) {
        const { data: guestUser } = await db
          .from("users")
          .select("email, display_name, handle")
          .eq("id", conv.guest_user_id)
          .maybeSingle();

        if (guestUser) {
          guestName = guestUser.display_name || guestUser.handle || guestUser.email || "Guest";
        }
      }

      const msgs = await RelayStore.getMessagesForConversation(conv.id);
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;

      let lastMessageTime: string | undefined;
      if (lastMsg) {
        const date = new Date(lastMsg.created_at);
        lastMessageTime = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }

      result.push({
        id: conv.id,
        handle: "guest",
        name: guestName,
        presence: "online" as const,
        presenceLine: "Guest",
        lastMessagePreview: lastMsg?.body,
        lastMessageIsOwn: lastMsg?.sender_agent_id === ownerAgent.id,
        lastMessageStatus: lastMsg?.status as "queued" | "delivered" | "read" | undefined,
        lastMessageTime,
        unreadCount: 0,
        is_request: false, // Guests never appear in Requests — they're invited, not strangers.
        is_guest: true,
        guest_invite_id: conv.guest_invite_id,
      });
      continue;
    }

    const otherAgentId = conv.agent_a_id === ownerAgent.id ? conv.agent_b_id : conv.agent_a_id;
    const { data: otherAgent } = await db
      .from("agents")
      .select("*")
      .eq("id", otherAgentId)
      .maybeSingle();

    if (!otherAgent) continue;

    const msgs = await RelayStore.getMessagesForConversation(conv.id);
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;

    // Count unread (messages sent to ownerAgent with status != 'read')
    const unreadCount = msgs.filter(
      (m) => m.sender_agent_id !== ownerAgent.id && m.status !== "read",
    ).length;

    // Presence of other agent
    const otherOnline = isAgentOnline(otherAgent);
    const presenceText = otherOnline
      ? "online"
      : "offline — messages will be delivered when it reconnects";

    let lastMessageTime: string | undefined;
    if (lastMsg) {
      const date = new Date(lastMsg.created_at);
      lastMessageTime = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    result.push({
      id: conv.id,
      handle: otherAgent.handle,
      name: otherAgent.display_name ?? `@${otherAgent.handle}`,
      presence: otherOnline ? ("online" as const) : ("offline" as const),
      presenceLine: presenceText,
      lastMessagePreview: lastMsg?.body,
      lastMessageIsOwn: lastMsg?.sender_agent_id === ownerAgent.id,
      lastMessageStatus: lastMsg?.status as "queued" | "delivered" | "read" | undefined,
      lastMessageTime,
      unreadCount,
      is_request: Boolean(conv.is_request),
    });
  }

  return result;
}

/**
 * Returns messages for a conversation for the owner view.
 */
export async function getOwnerMessages(
  ownerId: string,
  conversationId: string,
  requestId: string,
) {
  const db = getServiceClient();

  // Find owner's agent
  const { data: ownerAgent } = await db
    .from("agents")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!ownerAgent) {
    throw new RelayError("FORBIDDEN", "Guest accounts cannot access owner conversations.", 403);
  }

  const conv = await RelayStore.getConversationById(conversationId);
  if (!conv) {
    throw new RelayError("NOT_FOUND", "Conversation not found.", 404);
  }

  // Cross-leak check: owner's agent MUST be a participant
  if (conv.agent_a_id !== ownerAgent.id && conv.agent_b_id !== ownerAgent.id) {
    logger.warn({
      msg: "Cross-leak attempt: owner tried to read conversation of other agents",
      request_id: requestId,
      owner_id: ownerId,
      conversation_id: conversationId,
    });
    throw new RelayError("NOT_FOUND", "Conversation not found.", 404);
  }

  const msgs = await RelayStore.getMessagesForConversation(conversationId);
  return msgs.map((m, idx) => ({
    id: m.id,
    sender: m.sender_agent_id === ownerAgent.id ? ("own" as const) : ("theirs" as const),
    text: m.body,
    timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    status: m.status as "queued" | "delivered" | "read" | undefined,
    isLastOwn: m.sender_agent_id === ownerAgent.id && idx === msgs.length - 1,
  }));
}
