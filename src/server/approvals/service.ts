import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import { ApprovalRecord, ResolveApprovalDecision } from "@/types/brain";
import { RelayStore } from "@/server/relay/store";
import { addFact } from "@/server/memory/service";
import { screenOutgoingMessage } from "@/server/rules/engine";

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

  // ── 2. Handle Decision ──────────────────────────────────────────────────────

  if (decision === "share") {
    // Re-screen on delivery
    const screenResult = await screenOutgoingMessage({
      ownerId,
      agentId: approval.agent_id ?? "",
      conversationId: approval.conversation_id ?? undefined,
      text: approval.question,
      requestId,
    });

    if (screenResult.action === "block") {
      // Re-screen blocked: mark approval 'blocked' and do not deliver
      const { data: blockedApproval } = await db
        .from("approvals")
        .update({
          status: "blocked",
          resolved_at: now,
        })
        .eq("id", approvalId)
        .select("*")
        .single();

      logger.warn({
        msg: `Approval ${approvalId} blocked on re-screen during share`,
        request_id: requestId,
        owner_id: ownerId,
      });

      return {
        ok: true,
        approval: (blockedApproval ?? { ...approval, status: "blocked", resolved_at: now }) as ApprovalRecord,
      };
    }

    // Clean on re-screen: deliver the held draft
    if (!approval.conversation_id || !approval.agent_id) {
      logger.error({
        msg: `Cannot deliver approved draft: approval ${approvalId} is missing conversation_id or agent_id`,
        request_id: requestId,
        owner_id: ownerId,
      });
      throw new ApprovalError(
        "DELIVERY_FAILED",
        "Approval does not have an associated conversation or agent to deliver to.",
        500,
      );
    }

    const idempotencyKey = `approval_resolve_${approval.id}`;
    try {
      await RelayStore.insertMessage(
        approval.conversation_id,
        approval.agent_id,
        approval.question,
        idempotencyKey,
      );

      logger.info({
        msg: `Delivered held draft into conversation ${approval.conversation_id}`,
        request_id: requestId,
        approval_id: approval.id,
      });
    } catch (sendErr) {
      logger.error({
        msg: `Failed to deliver approved draft to conversation: ${
          sendErr instanceof Error ? sendErr.message : String(sendErr)
        }`,
        request_id: requestId,
      });
      throw new ApprovalError(
        "DELIVERY_FAILED",
        `Failed to deliver approved draft: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
        500,
      );
    }

    const { data: updatedApproval } = await db
      .from("approvals")
      .update({
        status: "shared",
        resolved_at: now,
      })
      .eq("id", approvalId)
      .select("*")
      .single();

    return {
      ok: true,
      approval: (updatedApproval ?? { ...approval, status: "shared", resolved_at: now }) as ApprovalRecord,
    };
  }

  if (decision === "not_now") {
    // Draft discarded
    const { data: updatedApproval } = await db
      .from("approvals")
      .update({
        status: "denied",
        resolved_at: now,
      })
      .eq("id", approvalId)
      .select("*")
      .single();

    return {
      ok: true,
      approval: (updatedApproval ?? { ...approval, status: "denied", resolved_at: now }) as ApprovalRecord,
    };
  }

  // decision === "never"
  // Create a guard entry (guard 'never') from the approval's matched text/topic + blocks row
  let createdFactId = approval.fact_id;
  try {
    const newGuardEntry = await addFact(ownerId, approval.question, "never", requestId);
    createdFactId = newGuardEntry.id;
  } catch (factErr) {
    logger.warn({
      msg: `Could not create fact from approval question: ${
        factErr instanceof Error ? factErr.message : String(factErr)
      }`,
      request_id: requestId,
    });
  }

  try {
    await db.from("blocks").insert({
      owner_id: ownerId,
      agent_id: approval.agent_id ?? null,
      fact_id: createdFactId ?? null,
      created_at: now,
    });
  } catch (blockErr) {
    logger.warn({
      msg: `Failed to insert block (might already exist): ${
        blockErr instanceof Error ? blockErr.message : String(blockErr)
      }`,
      request_id: requestId,
      owner_id: ownerId,
    });
  }

  const { data: updatedApproval } = await db
    .from("approvals")
    .update({
      status: "never",
      resolved_at: now,
    })
    .eq("id", approvalId)
    .select("*")
    .single();

  logger.info({
    msg: `Approval ${approvalId} resolved with never (guard entry created)`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return {
    ok: true,
    approval: (updatedApproval ?? { ...approval, status: "never", resolved_at: now }) as ApprovalRecord,
  };
}
