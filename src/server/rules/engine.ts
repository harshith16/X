import { ShareRule, ScreeningActivityItem, GuardCategoryKey } from "@/types/brain";
import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import {
  getOwnerCategoryModes,
  getDefaultCategoryMode,
  GUARD_CATEGORIES_CATALOGUE,
} from "./categories";
import { detectSpecifics } from "./detector";

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
  "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what",
  "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's",
  "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd",
  "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
]);

export interface RulesEngineCandidate {
  id: string;
  text: string;
  share_rule: ShareRule;
  invalid_at?: string | null;
}

export interface RulesEngineContext {
  owner_id: string;
  agent_id?: string;
  asker_agent_id?: string;
  conversation_id?: string;
  message_id?: string;
  blocked_fact_ids?: Set<string> | string[];
}

export type RulesEngineResult =
  | { action: "answer"; fact_ids: string[] }
  | {
      action: "ask";
      fact_ids: string[];
      approval: {
        id?: string;
        question: string;
        fact_id: string;
        owner_id: string;
        agent_id?: string;
        conversation_id?: string;
        message_id?: string;
      };
    }
  | { action: "no_answer" };

/**
 * Tokenizes text into lowercase non-stopword tokens of length >= 2.
 */
export function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Normalizes text for screening: lowercase, collapses whitespace.
 */
export function normalizeOutgoingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips punctuation characters for flexible variant matching.
 */
export function cleanPunctuation(text: string): string {
  return text
    .replace(/[.,!?;:'"`~@#$%^&*()_+\-=\[\]{}|<>\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure deterministic matcher between a guard entry / registered term and outgoing text.
 * Handles case, whitespace variants, punctuation, and keyword inclusion.
 */
export function matchesGuardText(entryText: string, outgoingText: string): boolean {
  const normEntry = normalizeOutgoingText(entryText);
  const normOut = normalizeOutgoingText(outgoingText);

  if (!normEntry || !normOut) return false;

  // 1. Direct normalized substring match
  if (normOut.includes(normEntry)) return true;

  // 2. Clean punctuation match
  const cleanEntry = cleanPunctuation(normEntry);
  const cleanOut = cleanPunctuation(normOut);
  if (cleanEntry.length > 0 && cleanOut.includes(cleanEntry)) return true;

  // 3. Keyword overlap match for phrases
  const entryTokens = extractKeywords(entryText);
  if (entryTokens.size >= 2) {
    const outTokens = extractKeywords(outgoingText);
    let matched = 0;
    for (const t of entryTokens) {
      if (outTokens.has(t)) matched++;
    }
    if (matched === entryTokens.size) return true;
  }

  return false;
}

/**
 * Computes token-overlap score between question and candidate fact text.
 */
export function scoreTokenOverlap(questionKeywords: Set<string>, factText: string): number {
  if (questionKeywords.size === 0) return 0;
  const factKeywords = extractKeywords(factText);
  let overlap = 0;
  for (const qWord of questionKeywords) {
    if (factKeywords.has(qWord)) {
      overlap++;
    }
  }
  return overlap;
}

// ── In-Memory Fallback Approvals & Blocks Store ─────────────────────────────

const globalForRules = globalThis as unknown as {
  __rulesApprovals?: Map<string, { id: string; owner_id: string; question: string; status: string }>;
  __rulesBlocks?: Array<{ owner_id: string; fact_id?: string | null; category?: string | null; text?: string }>;
  __rulesActivity?: Map<string, ScreeningActivityItem[]>;
};

const memoryApprovals = (globalForRules.__rulesApprovals ??= new Map());
const memoryBlocks = (globalForRules.__rulesBlocks ??= []);
const memoryActivity = (globalForRules.__rulesActivity ??= new Map());

export function recordScreeningActivity(ownerId: string, item: ScreeningActivityItem) {
  let list = memoryActivity.get(ownerId);
  if (!list) {
    list = [];
    memoryActivity.set(ownerId, list);
  }
  list.unshift(item);
  if (list.length > 50) list.pop();
}

export function getMemoryScreeningActivity(ownerId: string): ScreeningActivityItem[] {
  return memoryActivity.get(ownerId) ?? [];
}

export interface ScreenResult {
  action: "deliver" | "block" | "hold";
  approvalId?: string;
  matchedFactId?: string | null;
  category?: string | null;
}

/**
 * Deterministic Send-Path Screen (pure TypeScript, NO external model calls).
 * Normalizes text, screens against:
 * 1. Owner's NEVER guard entries and NEVER-mode categories' registered entries -> BLOCK
 * 2. Owner's ASK guard entries and ASK-mode categories' registered entries -> HOLD
 * 3. Otherwise -> DELIVER
 *
 * Precedence: NEVER beats ASK beats DELIVER.
 * Fails safe on NEVER, fails open on un-guarded content.
 */
export async function screenOutgoingMessage({
  ownerId,
  agentId,
  conversationId,
  text,
  requestId,
  overrideFacts,
  overrideBlockedIds,
  overrideCategories,
}: {
  ownerId: string;
  agentId: string;
  conversationId?: string;
  text: string;
  requestId?: string;
  overrideFacts?: RulesEngineCandidate[];
  overrideBlockedIds?: Set<string>;
  overrideCategories?: Array<{ category: string; mode: string }>;
}): Promise<ScreenResult> {
  const db = getServiceClient();

  // 1. Fetch live guard entries for this owner
  let facts: RulesEngineCandidate[] = [];
  if (overrideFacts) {
    facts = overrideFacts;
  } else {
    try {
      const { data, error } = await db
        .from("facts")
        .select("id, text, share_rule, invalid_at")
        .eq("owner_id", ownerId)
        .is("invalid_at", null)
        .in("share_rule", ["never", "ask"]);

      if (!error && data) {
        facts = data as RulesEngineCandidate[];
      }
    } catch {
      // Memory fallback if DB unavailable
    }
  }

  // 2. Fetch blocked fact IDs for this owner
  const blockedIds = new Set<string>(overrideBlockedIds ?? []);
  if (!overrideBlockedIds) {
    try {
      const { data, error } = await db
        .from("blocks")
        .select("fact_id")
        .eq("owner_id", ownerId);

      if (!error && data) {
        for (const b of data) {
          if (b.fact_id) blockedIds.add(b.fact_id);
        }
      }
    } catch {
      // Memory fallback
      for (const b of memoryBlocks) {
        if (b.owner_id === ownerId && b.fact_id) {
          blockedIds.add(b.fact_id);
        }
      }
    }
  }

  // 3. Fetch category modes for this owner
  const categoryModes = overrideCategories
    ? overrideCategories
    : await getOwnerCategoryModes(ownerId, requestId);

  const categoryModeMap = new Map<string, string>();
  for (const cat of categoryModes) {
    categoryModeMap.set(cat.category, cat.mode);
  }

  // Run specifics detector on outgoing message
  const detectedKeys = detectSpecifics(text);

  // ── PHASE 1: Check NEVER rules (LOCKED BOX) ──
  // Check owner's never guard entries + any entries in blocks
  for (const fact of facts) {
    if (fact.invalid_at) continue;
    const isNever = fact.share_rule === "never" || blockedIds.has(fact.id);
    if (isNever && matchesGuardText(fact.text, text)) {
      // Write audit row to blocks
      try {
        await db.from("blocks").insert({
          owner_id: ownerId,
          agent_id: agentId,
          fact_id: fact.id,
          text,
        });
      } catch {
        try {
          await db.from("blocks").insert({
            owner_id: ownerId,
            agent_id: agentId,
            fact_id: fact.id,
          });
        } catch {
          memoryBlocks.push({ owner_id: ownerId, fact_id: fact.id, text });
        }
      }

      recordScreeningActivity(ownerId, {
        id: "act_" + Math.random().toString(36).slice(2, 11),
        timestamp: new Date().toISOString(),
        outcome: "blocked",
        category: null,
        text,
      });

      if (requestId) {
        logger.info({
          msg: "Outgoing message blocked by rules (never guard entry)",
          request_id: requestId,
        });
      }

      return { action: "block", matchedFactId: fact.id };
    }
  }

  // Check detected specifics categories set to 'never'
  for (const catKey of detectedKeys) {
    const mode = categoryModeMap.get(catKey) ?? getDefaultCategoryMode(catKey);
    if (mode === "never") {
      // Write audit row to blocks
      try {
        await db.from("blocks").insert({
          owner_id: ownerId,
          agent_id: agentId,
          fact_id: null,
          category: catKey,
          text,
        });
      } catch {
        try {
          await db.from("blocks").insert({
            owner_id: ownerId,
            agent_id: agentId,
            fact_id: null,
          });
        } catch {
          memoryBlocks.push({ owner_id: ownerId, fact_id: null, category: catKey, text });
        }
      }

      recordScreeningActivity(ownerId, {
        id: "act_" + Math.random().toString(36).slice(2, 11),
        timestamp: new Date().toISOString(),
        outcome: "blocked",
        category: catKey,
        text,
      });

      if (requestId) {
        logger.info({
          msg: "Outgoing message blocked by rules (never category specifics)",
          request_id: requestId,
          category: catKey,
        });
      }

      return { action: "block", matchedFactId: null, category: catKey };
    }
  }

  // ── PHASE 2: Check ASK rules (HOLD FOR APPROVAL) ──
  // Check ask guard entries
  for (const fact of facts) {
    if (fact.invalid_at) continue;
    if (fact.share_rule === "ask" && !blockedIds.has(fact.id)) {
      if (matchesGuardText(fact.text, text)) {
        // Create approval holding the draft
        let approvalId = "app_" + Math.random().toString(36).slice(2, 11);
        try {
          const { data, error } = await db
            .from("approvals")
            .insert({
              owner_id: ownerId,
              agent_id: agentId,
              conversation_id: conversationId ?? null,
              fact_id: fact.id,
              question: text, // carry draft text
              status: "pending",
            })
            .select("id")
            .single();

          if (!error && data) {
            approvalId = data.id;
          }
        } catch {
          // In-memory fallback
          memoryApprovals.set(approvalId, {
            id: approvalId,
            owner_id: ownerId,
            question: text,
            status: "pending",
          });
        }

        recordScreeningActivity(ownerId, {
          id: approvalId,
          timestamp: new Date().toISOString(),
          outcome: "held",
          category: null,
          text,
          approval_id: approvalId,
        });

        if (requestId) {
          logger.info({
            msg: "Outgoing message held for approval (ask guard entry)",
            request_id: requestId,
            approval_id: approvalId,
          });
        }

        return { action: "hold", approvalId, matchedFactId: fact.id };
      }
    }
  }

  // Check detected specifics categories set to 'ask'
  for (const catKey of detectedKeys) {
    const mode = categoryModeMap.get(catKey) ?? getDefaultCategoryMode(catKey);
    if (mode === "ask") {
      let approvalId = "app_" + Math.random().toString(36).slice(2, 11);
      try {
        const { data, error } = await db
          .from("approvals")
          .insert({
            owner_id: ownerId,
            agent_id: agentId,
            conversation_id: conversationId ?? null,
            fact_id: null,
            question: text, // carry draft text
            status: "pending",
          })
          .select("id")
          .single();

        if (!error && data) {
          approvalId = data.id;
        }
      } catch {
        memoryApprovals.set(approvalId, {
          id: approvalId,
          owner_id: ownerId,
          question: text,
          status: "pending",
        });
      }

      recordScreeningActivity(ownerId, {
        id: approvalId,
        timestamp: new Date().toISOString(),
        outcome: "held",
        category: catKey,
        text,
        approval_id: approvalId,
      });

      if (requestId) {
        logger.info({
          msg: "Outgoing message held for approval (ask category specifics)",
          request_id: requestId,
          approval_id: approvalId,
          category: catKey,
        });
      }

      return { action: "hold", approvalId, matchedFactId: null, category: catKey };
    }
  }

  // ── PHASE 3: Clean sends deliver ──
  return { action: "deliver" };
}

/**
 * Pure evaluation function for question matching against candidate facts.
 */
export function evaluateRules(
  facts: RulesEngineCandidate[],
  question: string,
  context: RulesEngineContext,
): RulesEngineResult {
  const questionKeywords = extractKeywords(question);
  if (questionKeywords.size === 0) {
    return { action: "no_answer" };
  }

  const blockedSet = new Set<string>(
    Array.isArray(context.blocked_fact_ids)
      ? context.blocked_fact_ids
      : context.blocked_fact_ids
      ? Array.from(context.blocked_fact_ids)
      : [],
  );

  interface ScoredCandidate {
    fact: RulesEngineCandidate;
    score: number;
    effectiveRule: ShareRule;
  }

  const matches: ScoredCandidate[] = [];

  for (const fact of facts) {
    if (fact.invalid_at) continue;

    const score = scoreTokenOverlap(questionKeywords, fact.text);
    if (score > 0) {
      const effectiveRule: ShareRule = blockedSet.has(fact.id) ? "never" : fact.share_rule;
      matches.push({ fact, score, effectiveRule });
    }
  }

  if (matches.length === 0) {
    return { action: "no_answer" };
  }

  matches.sort((a, b) => b.score - a.score);

  const shareMatches = matches.filter((m) => m.effectiveRule === "share");
  const askMatches = matches.filter((m) => m.effectiveRule === "ask");
  const neverMatches = matches.filter((m) => m.effectiveRule === "never");

  if (neverMatches.length > 0 && shareMatches.length === 0 && askMatches.length === 0) {
    return { action: "no_answer" };
  }

  if (askMatches.length > 0) {
    const primaryAskFact = askMatches[0]!.fact;
    return {
      action: "ask",
      fact_ids: askMatches.map((m) => m.fact.id),
      approval: {
        question,
        fact_id: primaryAskFact.id,
        owner_id: context.owner_id,
        agent_id: context.agent_id,
        conversation_id: context.conversation_id,
        message_id: context.message_id,
      },
    };
  }

  if (shareMatches.length > 0) {
    return {
      action: "answer",
      fact_ids: shareMatches.map((m) => m.fact.id),
    };
  }

  return { action: "no_answer" };
}

/**
 * Runs the rules engine and, if action is 'ask', creates the pending approval row.
 */
export async function runRulesEngine(
  facts: RulesEngineCandidate[],
  question: string,
  context: RulesEngineContext,
  approvalCreator?: (approvalData: {
    owner_id: string;
    agent_id?: string;
    conversation_id?: string;
    message_id?: string;
    fact_id: string;
    question: string;
  }) => Promise<string>,
): Promise<RulesEngineResult> {
  const result = evaluateRules(facts, question, context);

  if (result.action === "ask") {
    let approvalId: string | undefined;

    if (approvalCreator) {
      approvalId = await approvalCreator(result.approval);
    } else {
      const db = getServiceClient();
      const { data: created, error } = await db
        .from("approvals")
        .insert({
          owner_id: result.approval.owner_id,
          agent_id: result.approval.agent_id ?? null,
          conversation_id: result.approval.conversation_id ?? null,
          message_id: result.approval.message_id ?? null,
          fact_id: result.approval.fact_id,
          question: result.approval.question,
          status: "pending",
        })
        .select("id")
        .single();

      if (!error && created) {
        approvalId = created.id;
      }
    }

    result.approval.id = approvalId;
  }

  return result;
}
