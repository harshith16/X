import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import { ConversationRecord, MessageRecord } from "@/types/relay";

// ── In-Memory Fallback Store (active if remote Postgres tables are pending migration) ──

const globalForRelay = globalThis as unknown as {
  __relayConversations?: Map<string, ConversationRecord>;
  __relayMessages?: Map<string, MessageRecord>;
};

const memoryConversations = (globalForRelay.__relayConversations ??= new Map<
  string,
  ConversationRecord
>());
const memoryMessages = (globalForRelay.__relayMessages ??= new Map<
  string,
  MessageRecord
>());

export class RelayStore {
  /**
   * Finds or creates a canonical 1:1 conversation between two agents.
   */
  static async getOrCreateConversation(
    agentAId: string,
    agentBId: string,
    requestId: string,
    isRequest: boolean = false,
  ): Promise<ConversationRecord> {
    const [firstId, secondId] = agentAId < agentBId ? [agentAId, agentBId] : [agentBId, agentAId];
    const db = getServiceClient();

    // 1. Try Supabase
    try {
      const { data, error } = await db
        .from("conversations")
        .select("*")
        .eq("agent_a_id", firstId)
        .eq("agent_b_id", secondId)
        .maybeSingle();

      if (!error && data) {
        return data as ConversationRecord;
      }

      if (!error && !data) {
        // Insert new conversation
        let newConv: any = null;
        try {
          const res = await db
            .from("conversations")
            .insert({
              agent_a_id: firstId,
              agent_b_id: secondId,
              kind: "agent_agent",
              is_request: isRequest,
            })
            .select("*")
            .single();
          newConv = res.data;
        } catch {
          // If is_request column not yet in DB, insert without it
          const res = await db
            .from("conversations")
            .insert({
              agent_a_id: firstId,
              agent_b_id: secondId,
              kind: "agent_agent",
            })
            .select("*")
            .single();
          newConv = res.data;
        }

        if (newConv) {
          // Also insert participants
          await db.from("participants").insert([
            { conversation_id: newConv.id, agent_id: firstId },
            { conversation_id: newConv.id, agent_id: secondId },
          ]);
          const convRecord: ConversationRecord = {
            ...newConv,
            is_request: isRequest,
          };
          memoryConversations.set(newConv.id, convRecord);
          return convRecord;
        }
      }
    } catch {
      // Supabase tables not available, fall through to memory
    }

    // 2. Memory fallback
    for (const conv of memoryConversations.values()) {
      if (conv.agent_a_id === firstId && conv.agent_b_id === secondId) {
        return conv;
      }
    }

    const id = "conv_" + Math.random().toString(36).slice(2, 11);
    const now = new Date().toISOString();
    const newConv: ConversationRecord = {
      id,
      kind: "agent_agent",
      agent_a_id: firstId,
      agent_b_id: secondId,
      is_request: isRequest,
      created_at: now,
      updated_at: now,
    };
    memoryConversations.set(id, newConv);
    return newConv;
  }

  /**
   * Registers a conversation into the store (e.g. guest conversations).
   */
  static registerConversation(conv: ConversationRecord): void {
    memoryConversations.set(conv.id, conv);
  }

  /**
   * Accepts a conversation (sets is_request = false).
   */
  static async acceptConversation(conversationId: string): Promise<void> {
    const db = getServiceClient();
    try {
      await db
        .from("conversations")
        .update({ is_request: false })
        .eq("id", conversationId);
    } catch {
      // Ignore DB error
    }

    const mem = memoryConversations.get(conversationId);
    if (mem) {
      mem.is_request = false;
    }
  }

  /**
   * Finds an existing message by sender and idempotency key.
   */
  static async findByIdempotency(
    senderAgentId: string,
    idempotencyKey: string,
  ): Promise<MessageRecord | null> {
    const db = getServiceClient();
    try {
      const { data, error } = await db
        .from("messages")
        .select("*")
        .eq("sender_agent_id", senderAgentId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (!error && data) {
        return data as MessageRecord;
      }
    } catch {
      // Fall through to memory
    }

    for (const msg of memoryMessages.values()) {
      if (msg.sender_agent_id === senderAgentId && msg.idempotency_key === idempotencyKey) {
        return msg;
      }
    }
    return null;
  }

  /**
   * Stores a new message and assigns sequential sequence number.
   */
  static async insertMessage(
    conversationId: string,
    senderAgentId: string | null,
    body: string,
    idempotencyKey: string,
    senderOwnerId: string | null = null,
  ): Promise<MessageRecord> {
    const db = getServiceClient();

    // 1. Try Supabase
    try {
      // Get max seq for conversation
      const { data: lastMsgs, error: seqErr } = await db
        .from("messages")
        .select("seq")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: false })
        .limit(1);

      if (seqErr) {
        throw new Error(`Failed to query message seq: ${seqErr.message}`);
      }

      const nextSeq = lastMsgs && lastMsgs[0] ? Number(lastMsgs[0].seq) + 1 : 1;

      const insertData: any = {
        conversation_id: conversationId,
        seq: nextSeq,
        body,
        idempotency_key: idempotencyKey,
        status: "queued",
      };
      if (senderAgentId) insertData.sender_agent_id = senderAgentId;
      if (senderOwnerId) insertData.sender_owner_id = senderOwnerId;

      const { data: newMsg, error } = await db
        .from("messages")
        .insert(insertData)
        .select("*")
        .single();

      if (!error && newMsg) {
        memoryMessages.set(newMsg.id, newMsg as MessageRecord);
        return newMsg as MessageRecord;
      }
    } catch {
      // Fall through to memory fallback
    }

    // 2. Memory fallback
    let maxSeq = 0;
    for (const m of memoryMessages.values()) {
      if (m.conversation_id === conversationId && m.seq > maxSeq) {
        maxSeq = m.seq;
      }
    }

    const id = "msg_" + Math.random().toString(36).slice(2, 12);
    const now = new Date().toISOString();
    const msgRecord: MessageRecord = {
      id,
      conversation_id: conversationId,
      seq: maxSeq + 1,
      sender_agent_id: senderAgentId || "",
      sender_owner_id: senderOwnerId,
      body,
      idempotency_key: idempotencyKey,
      status: "queued",
      created_at: now,
    };
    memoryMessages.set(id, msgRecord);
    return msgRecord;
  }

  /**
   * Retrieves messages for an agent's inbox, filtering out own sent messages.
   */
  static async getInboxMessages(
    agentId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<MessageRecord[]> {
    const db = getServiceClient();

    // 1. Try Supabase
    try {
      // Find conversations involving this agent
      const { data: convs, error: convErr } = await db
        .from("conversations")
        .select("id")
        .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`);

      if (!convErr && convs && convs.length > 0) {
        const convIds = convs.map((c) => c.id);
        let query = db
          .from("messages")
          .select("*")
          .in("conversation_id", convIds)
          .or(`sender_agent_id.neq.${agentId},sender_agent_id.is.null`)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (cursor) {
          query = query.lt("created_at", cursor);
        }

        const { data: msgs, error: msgErr } = await query;
        if (!msgErr && msgs) {
          return msgs as MessageRecord[];
        }
      }
    } catch {
      // Fall through to memory
    }

    // 2. Memory fallback
    // Find conversation IDs involving agentId
    const matchingConvIds = new Set<string>();
    for (const c of memoryConversations.values()) {
      if (c.agent_a_id === agentId || c.agent_b_id === agentId) {
        matchingConvIds.add(c.id);
      }
    }

    const result: MessageRecord[] = [];
    for (const m of memoryMessages.values()) {
      if (matchingConvIds.has(m.conversation_id) && m.sender_agent_id !== agentId) {
        if (!cursor || m.created_at < cursor) {
          result.push(m);
        }
      }
    }

    result.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    return result.slice(0, limit);
  }

  /**
   * Updates status of messages (e.g. queued -> delivered).
   */
  static async updateMessagesStatus(
    messageIds: string[],
    newStatus: "delivered" | "read",
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const db = getServiceClient();

    try {
      await db.from("messages").update({ status: newStatus }).in("id", messageIds);
    } catch {
      // Ignore DB error
    }

    const now = new Date().toISOString();
    for (const id of messageIds) {
      const m = memoryMessages.get(id);
      if (m) {
        m.status = newStatus;
        if (newStatus === "delivered" && !m.delivered_at) {
          m.delivered_at = now;
        }
        if (newStatus === "read" && !m.read_at) {
          m.read_at = now;
        }
      }
    }
  }

  /**
   * Finds a message by ID.
   */
  static async getMessageById(messageId: string): Promise<MessageRecord | null> {
    const db = getServiceClient();
    try {
      const { data, error } = await db.from("messages").select("*").eq("id", messageId).maybeSingle();
      if (!error && data) return data as MessageRecord;
    } catch {
      // Fall through to memory
    }
    return memoryMessages.get(messageId) ?? null;
  }

  /**
   * Finds a conversation by ID.
   */
  static async getConversationById(conversationId: string): Promise<ConversationRecord | null> {
    const db = getServiceClient();
    try {
      const { data, error } = await db.from("conversations").select("*").eq("id", conversationId).maybeSingle();
      if (!error && data) return data as ConversationRecord;
    } catch {
      // Fall through to memory
    }
    return memoryConversations.get(conversationId) ?? null;
  }

  /**
   * Finds all conversations for an owner's agent.
   */
  static async getConversationsForAgent(agentId: string): Promise<ConversationRecord[]> {
    const db = getServiceClient();
    const list: ConversationRecord[] = [];
    try {
      const { data, error } = await db
        .from("conversations")
        .select("*")
        .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`);
      if (!error && data) {
        list.push(...(data as ConversationRecord[]));
      }
    } catch {
      // Fall through to memory
    }

    for (const c of memoryConversations.values()) {
      if ((c.agent_a_id === agentId || c.agent_b_id === agentId) && !list.some((existing) => existing.id === c.id)) {
        list.push(c);
      }
    }
    return list;
  }

  /**
   * Gets messages for a conversation.
   */
  static async getMessagesForConversation(conversationId: string): Promise<MessageRecord[]> {
    const db = getServiceClient();
    const list: MessageRecord[] = [];
    try {
      const { data, error } = await db
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: true });
      if (!error && data && data.length > 0) {
        list.push(...(data as MessageRecord[]));
      }
    } catch {
      // Fall through to memory
    }

    for (const m of memoryMessages.values()) {
      if (m.conversation_id === conversationId && !list.some((existing) => existing.id === m.id)) {
        list.push(m);
      }
    }
    list.sort((a, b) => a.seq - b.seq);
    return list;
  }

  /**
   * Cleans up memory store (useful for tests).
   */
  static clearMemory(): void {
    memoryConversations.clear();
    memoryMessages.clear();
  }
}
