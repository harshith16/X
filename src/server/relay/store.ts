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
        const { data: newConv, error: insertErr } = await db
          .from("conversations")
          .insert({
            agent_a_id: firstId,
            agent_b_id: secondId,
            kind: "agent_agent",
          })
          .select("*")
          .single();

        if (!insertErr && newConv) {
          // Also insert participants
          await db.from("participants").insert([
            { conversation_id: newConv.id, agent_id: firstId },
            { conversation_id: newConv.id, agent_id: secondId },
          ]);
          return newConv as ConversationRecord;
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
      created_at: now,
      updated_at: now,
    };
    memoryConversations.set(id, newConv);
    return newConv;
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
    senderAgentId: string,
    body: string,
    idempotencyKey: string,
  ): Promise<MessageRecord> {
    const db = getServiceClient();

    // 1. Try Supabase
    try {
      // Get max seq for conversation
      const { data: lastMsgs } = await db
        .from("messages")
        .select("seq")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: false })
        .limit(1);

      const nextSeq = lastMsgs && lastMsgs[0] ? Number(lastMsgs[0].seq) + 1 : 1;

      const { data: newMsg, error } = await db
        .from("messages")
        .insert({
          conversation_id: conversationId,
          seq: nextSeq,
          sender_agent_id: senderAgentId,
          body,
          idempotency_key: idempotencyKey,
          status: "queued",
        })
        .select("*")
        .single();

      if (!error && newMsg) {
        return newMsg as MessageRecord;
      }
    } catch {
      // Fall through to memory
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
      sender_agent_id: senderAgentId,
      sender_owner_id: null,
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
          .neq("sender_agent_id", agentId)
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
    try {
      const { data, error } = await db
        .from("conversations")
        .select("*")
        .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`);
      if (!error && data) return data as ConversationRecord[];
    } catch {
      // Fall through to memory
    }

    const list: ConversationRecord[] = [];
    for (const c of memoryConversations.values()) {
      if (c.agent_a_id === agentId || c.agent_b_id === agentId) {
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
    try {
      const { data, error } = await db
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("seq", { ascending: true });
      if (!error && data) return data as MessageRecord[];
    } catch {
      // Fall through to memory
    }

    const list: MessageRecord[] = [];
    for (const m of memoryMessages.values()) {
      if (m.conversation_id === conversationId) {
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
