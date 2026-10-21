import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import { ApprovalRecord, ResolveApprovalDecision } from "@/types/brain";
import { RelayStore } from "@/server/relay/store";

export class ApprovalError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Returns pending approvals for the signed-in owner, cursor-paginated.
 */
export async function getOwnerApprovals(
  ownerId: string,
  cursor?: string,
  limit: number = 50,
  requestId?: string,
): Promise<{ approvals: ApprovalRecord[]; next_cursor: string | null }> {
  const boundedLimit = Math.min(Math.max(1, limit), 50);
  const db = getServiceClient();

  let query = db
    .from("approvals")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "pending")
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
        msg: `Failed to fetch owner approvals: ${error.message}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
    throw new ApprovalError("DATABASE_ERROR", error.message, 500);
  }

  const approvals = (data || []) as ApprovalRecord[];
  const nextCursor =
    approvals.length === boundedLimit ? approvals[approvals.length - 1]!.created_at : null;

  return {
    approvals,
    next_cursor: nextCursor,
  };
}

/**
 * Resolves an approval:
 * - 'share': status -> 'shared'. If tied to conversation, sends the fact into conversation.
 * - 'not_now': status -> 'denied'.
 * - 'never': status -> 'never' and inserts into blocks table.
 */
export async function resolveApproval(
  ownerId: string,
  approvalId: string,
  decision: ResolveApprovalDecision,
  requestId: string,
): Promise<{ ok: boolean; approval: ApprovalRecord }> {
  const db = getServiceClient();

  // 1. Fetch approval
  const { data: approval, error: findErr } = await db
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (findErr) {
    logger.error({
      msg: `Error finding approval: ${findErr.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ApprovalError("DATABASE_ERROR", findErr.message, 500);
  }

  if (!approval) {
    throw new ApprovalError("NOT_FOUND", "Approval request not found.", 404);
  }

  if (approval.status !== "pending") {
    throw new ApprovalError("APPROVAL_ALREADY_RESOLVED", "This approval has already been resolved.", 400);
  }

  const now = new Date().toISOString();
  let newStatus: "shared" | "denied" | "never";

  if (decision === "share") {
    newStatus = "shared";
  } else if (decision === "not_now") {
    newStatus = "denied";
  } else {
    newStatus = "never";
  }

  // 2. Update approval row
  const { data: updatedApproval, error: updateErr } = await db
    .from("approvals")
    .update({
      status: newStatus,
      resolved_at: now,
    })
    .eq("id", approvalId)
    .select("*")
    .single();

  if (updateErr || !updatedApproval) {
    logger.error({
      msg: `Failed to update approval status: ${updateErr?.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ApprovalError("DATABASE_ERROR", updateErr?.message || "Failed to resolve approval.", 500);
  }

  // 3. Side effects based on decision
  if (decision === "never" && approval.fact_id) {
    // Insert into blocks table
    const { error: blockErr } = await db.from("blocks").insert({
      owner_id: ownerId,
      agent_id: approval.agent_id ?? null,
      fact_id: approval.fact_id,
      created_at: now,
    });

    if (blockErr) {
      logger.warn({
        msg: `Failed to insert block (might already exist): ${blockErr.message}`,
        request_id: requestId,
        owner_id: ownerId,
      });
    }
  }

  if (decision === "share" && approval.conversation_id && approval.fact_id) {
    // Look up fact text
    const { data: fact } = await db
      .from("facts")
      .select("text")
      .eq("id", approval.fact_id)
      .maybeSingle();

    if (fact?.text && approval.agent_id) {
      const idempotencyKey = `approval_resolve_${approval.id}`;
      try {
        await RelayStore.insertMessage(
          approval.conversation_id,
          approval.agent_id,
          fact.text,
          idempotencyKey,
        );

        logger.info({
          msg: `Sent approved answer into conversation ${approval.conversation_id}`,
          request_id: requestId,
          approval_id: approval.id,
        });
      } catch (sendErr) {
        logger.error({
          msg: `Failed to send approved message to conversation: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
          request_id: requestId,
        });
      }
    }
  }

  logger.info({
    msg: `Approval ${approvalId} resolved with ${decision}`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return {
    ok: true,
    approval: updatedApproval as ApprovalRecord,
  };
}
