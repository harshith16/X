import { FactRecord, ShareRule, ApprovalRecord } from "@/types/brain";
import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";

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

/**
 * Pure deterministic rules evaluation function.
 * NO LLM, NO I/O.
 * Default is deny: unmatched or only 'never' facts return 'no_answer'.
 * LOCKED BOX: never-share facts are strictly excluded from 'answer' and 'ask'.
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

  // 1. Filter currently valid facts and score token overlap
  interface ScoredCandidate {
    fact: RulesEngineCandidate;
    score: number;
    effectiveRule: ShareRule;
  }

  const matches: ScoredCandidate[] = [];

  for (const fact of facts) {
    // Ignore soft-deleted / invalidated facts
    if (fact.invalid_at) continue;

    const score = scoreTokenOverlap(questionKeywords, fact.text);
    if (score > 0) {
      // Blocked fact (via blocks row) forces 'never' regardless of fact's share_rule
      const effectiveRule: ShareRule = blockedSet.has(fact.id) ? "never" : fact.share_rule;
      matches.push({ fact, score, effectiveRule });
    }
  }

  if (matches.length === 0) {
    return { action: "no_answer" };
  }

  // Sort matches by overlap score descending
  matches.sort((a, b) => b.score - a.score);

  // Categorize by effective share rule
  const shareMatches = matches.filter((m) => m.effectiveRule === "share");
  const askMatches = matches.filter((m) => m.effectiveRule === "ask");
  const neverMatches = matches.filter((m) => m.effectiveRule === "never");

  // THE LOCKED BOX:
  // Facts with share_rule 'never' must be excluded before any matching result can reach an LLM.
  // If only 'never' facts matched, return 'no_answer'.
  if (neverMatches.length > 0 && shareMatches.length === 0 && askMatches.length === 0) {
    return { action: "no_answer" };
  }

  // If there are 'ask' matches, the answer waits for owner approval
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

  // If there are 'share' matches (and no 'ask' matches)
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
      // Default: insert pending approval into Supabase
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
