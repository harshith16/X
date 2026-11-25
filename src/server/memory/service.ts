import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import { FactRecord, ShareRule } from "@/types/brain";
import { computeContentHash } from "./normalize";

export class MemoryError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Returns owner's currently valid guard entries, cursor-paginated, max 50.
 * Filter: owner_id = :owner AND invalid_at IS NULL AND share_rule IN ('never', 'ask').
 * Legacy 'share' entries are ignored.
 * Order: created_at desc, id desc.
 */
export async function getOwnerFacts(
  ownerId: string,
  cursor?: string,
  limit: number = 50,
  requestId?: string,
): Promise<{ facts: Array<Pick<FactRecord, "id" | "text" | "share_rule" | "created_at">>; next_cursor: string | null }> {
  const boundedLimit = Math.min(Math.max(1, limit), 50);
  const db = getServiceClient();

  let query = db
    .from("facts")
    .select("id, text, share_rule, created_at")
    .eq("owner_id", ownerId)
    .is("invalid_at", null)
    .in("share_rule", ["never", "ask"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(boundedLimit);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query;

  if (error) {
    if (requestId) {
      logger.error({
        msg: `Failed to fetch facts for owner: ${error.message}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
    throw new MemoryError("DATABASE_ERROR", error.message, 500);
  }

  const facts = (data || []) as Array<Pick<FactRecord, "id" | "text" | "share_rule" | "created_at">>;
  const nextCursor = facts.length === boundedLimit ? facts[facts.length - 1]!.created_at : null;

  return {
    facts,
    next_cursor: nextCursor,
  };
}

/**
 * Adds a new guard entry for the signed-in owner.
 * Deduplicates by content_hash against currently valid facts.
 * Embeddings are no longer computed (column stays null).
 */
export async function addFact(
  ownerId: string,
  text: string,
  shareRule: ShareRule = "never",
  requestId?: string,
): Promise<Pick<FactRecord, "id" | "text" | "share_rule" | "created_at">> {
  const db = getServiceClient();
  const contentHash = computeContentHash(text);
  // 'share' entries are legacy — normalize to 'ask' or 'never' if passed
  const effectiveRule: ShareRule = shareRule === "share" ? "ask" : shareRule;

  // 1. Check for duplicate live fact
  const { data: existing, error: findErr } = await db
    .from("facts")
    .select("id, text, share_rule, created_at")
    .eq("owner_id", ownerId)
    .eq("content_hash", contentHash)
    .is("invalid_at", null)
    .maybeSingle();

  if (findErr) {
    if (requestId) {
      logger.error({
        msg: `Error checking duplicate fact: ${findErr.message}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
    throw new MemoryError("DATABASE_ERROR", findErr.message, 500);
  }

  if (existing) {
    if (requestId) {
      logger.info({
        msg: `Duplicate live fact returned for owner: ${existing.id}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
    return existing as Pick<FactRecord, "id" | "text" | "share_rule" | "created_at">;
  }

  // 2. Resolve owner's agent if one exists
  const { data: agent } = await db
    .from("agents")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  const now = new Date().toISOString();

  // 3. Insert guard entry (embedding remains null; never computed)
  const { data: inserted, error: insertErr } = await db
    .from("facts")
    .insert({
      owner_id: ownerId,
      agent_id: agent?.id ?? null,
      text,
      share_rule: effectiveRule,
      embedding: null,
      content_hash: contentHash,
      valid_at: now,
      invalid_at: null,
      created_at: now,
      updated_at: now,
    })
    .select("id, text, share_rule, created_at")
    .single();

  if (insertErr || !inserted) {
    if (requestId) {
      logger.error({
        msg: `Failed to insert fact: ${insertErr?.message}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
    throw new MemoryError("DATABASE_ERROR", insertErr?.message || "Failed to create fact.", 500);
  }

  if (requestId) {
    logger.info({
      msg: `Added fact ${inserted.id} with rule ${shareRule}`,
      request_id: requestId,
      owner_id: ownerId,
    });
  }

  return inserted as Pick<FactRecord, "id" | "text" | "share_rule" | "created_at">;
}

/**
 * Soft deletes a fact by setting invalid_at = now().
 * Never hard-deletes.
 */
export async function deleteFact(
  ownerId: string,
  factId: string,
  requestId: string,
): Promise<{ ok: boolean }> {
  const db = getServiceClient();

  const { data: fact, error: fetchErr } = await db
    .from("facts")
    .select("id, owner_id, invalid_at")
    .eq("id", factId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (fetchErr) {
    logger.error({
      msg: `Failed to query fact for delete: ${fetchErr.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new MemoryError("DATABASE_ERROR", fetchErr.message, 500);
  }

  if (!fact) {
    throw new MemoryError("NOT_FOUND", "Fact not found.", 404);
  }

  if (fact.invalid_at) {
    return { ok: true };
  }

  const { error: updateErr } = await db
    .from("facts")
    .update({ invalid_at: new Date().toISOString() })
    .eq("id", factId)
    .eq("owner_id", ownerId);

  if (updateErr) {
    logger.error({
      msg: `Failed to soft delete fact: ${updateErr.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new MemoryError("DATABASE_ERROR", updateErr.message, 500);
  }

  logger.info({
    msg: `Soft deleted fact ${factId}`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return { ok: true };
}
