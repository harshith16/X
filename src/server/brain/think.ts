import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import { AgentRecord } from "@/types/agent";
import { FactRecord, ThinkResponse } from "@/types/brain";
import { runRulesEngine, RulesEngineCandidate } from "@/server/rules/engine";
import { getDeflectionMessage } from "@/server/rules/deflection";
import { draftAnswer } from "./llm";

export interface ThinkOptions {
  facts?: RulesEngineCandidate[];
  blockedFactIds?: Set<string> | string[];
  approvalCreator?: (data: {
    owner_id: string;
    agent_id?: string;
    conversation_id?: string;
    message_id?: string;
    fact_id: string;
    question: string;
  }) => Promise<string>;
}

/**
 * Handles agent think requests.
 * Evaluates owner facts through the deterministic rules engine.
 * THE LOCKED BOX: Never-share facts are never passed to the LLM.
 */
export async function thinkAgent(
  agent: AgentRecord,
  conversationId: string,
  question: string,
  requestId: string,
  options?: ThinkOptions,
): Promise<ThinkResponse> {
  const db = getServiceClient();

  // 1. Load facts
  let facts: RulesEngineCandidate[] = [];
  if (options?.facts) {
    facts = options.facts;
  } else {
    try {
      const { data, error } = await db
        .from("facts")
        .select("id, text, share_rule, invalid_at")
        .eq("owner_id", agent.owner_id)
        .is("invalid_at", null);

      if (!error && data) {
        facts = data as RulesEngineCandidate[];
      }
    } catch (err: unknown) {
      logger.error({
        msg: `Failed to load facts for agent think: ${err instanceof Error ? err.message : String(err)}`,
        request_id: requestId,
        agent_id: agent.id,
      });
      // Fall through with empty facts -> no_answer deflection
    }
  }

  // 2. Load blocks
  let blockedIds: Set<string> = new Set();
  if (options?.blockedFactIds) {
    blockedIds = new Set(options.blockedFactIds);
  } else {
    try {
      const { data, error } = await db
        .from("blocks")
        .select("fact_id")
        .eq("owner_id", agent.owner_id);

      if (!error && data) {
        blockedIds = new Set(data.map((b) => b.fact_id));
      }
    } catch {
      // Ignore DB error
    }
  }

  // 3. Rules Engine evaluation
  const engineResult = await runRulesEngine(
    facts,
    question,
    {
      owner_id: agent.owner_id,
      agent_id: agent.id,
      conversation_id: conversationId,
      blocked_fact_ids: blockedIds,
    },
    options?.approvalCreator,
  );

  logger.info({
    msg: `Rules engine decision: ${engineResult.action}`,
    request_id: requestId,
    agent_id: agent.id,
  });

  // 4. Branch by outcome
  if (engineResult.action === "answer") {
    // Only approved facts whose share_rule is 'share' and NOT blocked reach the LLM
    const factMap = new Map<string, RulesEngineCandidate>(facts.map((f) => [f.id, f]));
    const approvedFactTexts = engineResult.fact_ids
      .map((id) => factMap.get(id))
      .filter((f): f is RulesEngineCandidate => f !== undefined && f.share_rule === "share" && !blockedIds.has(f.id))
      .map((f) => f.text);

    const reply = await draftAnswer(question, approvedFactTexts, requestId);

    return {
      ok: true,
      outcome: "reply",
      reply,
      request_id: requestId,
    };
  }

  if (engineResult.action === "ask") {
    const reply = getDeflectionMessage(question);
    return {
      ok: true,
      outcome: "deflect",
      reply,
      approval_id: engineResult.approval.id,
      request_id: requestId,
    };
  }

  // action === 'no_answer'
  const reply = getDeflectionMessage(question);
  return {
    ok: true,
    outcome: "no_answer",
    reply,
    request_id: requestId,
  };
}
