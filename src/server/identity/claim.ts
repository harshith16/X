import { getServiceClient } from "@/server/db/clients";
import { HandleSchema, type AgentRecord, type HandleAvailabilityStatus } from "@/types/agent";
import { logger } from "@/lib/logger";

export class ClaimError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/**
 * Checks whether a handle is available to be claimed.
 * Uses index `agents_handle_idx` (DB_SCHEMA.md).
 * Never creates anything in the database.
 */
export async function checkHandleAvailability(
  handle: string,
  requestId: string,
): Promise<{ available: boolean; status: HandleAvailabilityStatus; handle: string }> {
  const parseResult = HandleSchema.safeParse(handle);

  if (!parseResult.success) {
    throw new ClaimError(
      "INVALID_HANDLE_FORMAT",
      parseResult.error.issues[0]?.message ??
        "Invalid handle format. Must be 3–24 lowercase letters, numbers, or underscores.",
      400,
    );
  }

  const cleanHandle = parseResult.data;
  const db = getServiceClient();

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Database check timed out after 5000ms"));
    }, 5000);
    timer.unref?.();
  });

  // Query index agents_handle_idx
  const queryPromise = db
    .from("agents")
    .select("id")
    .eq("handle", cleanHandle)
    .maybeSingle();

  const { data, error } = (await Promise.race([queryPromise, timeoutPromise])) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) {
    logger.error({
      msg: `checkHandleAvailability failed: ${error.message}`,
      request_id: requestId,
      route: "/api/handles/[handle]/availability",
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to check handle availability", 500);
  }

  if (data) {
    return {
      available: false,
      status: "taken",
      handle: cleanHandle,
    };
  }

  return {
    available: true,
    status: "available",
    handle: cleanHandle,
  };
}

/**
 * Claims an agent handle for the authenticated owner.
 * One agent per owner in v1 — repeat claim returns existing agent.
 * Uses index `agents_owner_id_idx` and `agents_handle_idx` (DB_SCHEMA.md).
 */
export async function claimAgent(
  ownerId: string,
  handle: string,
  requestId: string,
): Promise<{ agent: AgentRecord; isExisting: boolean }> {
  const parseResult = HandleSchema.safeParse(handle);
  if (!parseResult.success) {
    throw new ClaimError(
      "VALIDATION_FAILED",
      parseResult.error.issues[0]?.message ?? "Invalid handle format",
      400,
    );
  }

  const cleanHandle = parseResult.data;
  const db = getServiceClient();

  // 1. One agent per owner check using index agents_owner_id_idx
  const { data: existingAgent, error: existingError } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existingError) {
    logger.error({
      msg: `claimAgent existing check failed: ${existingError.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to verify existing agent", 500);
  }

  if (existingAgent) {
    logger.info({
      msg: "Owner already has an agent; returning existing agent",
      request_id: requestId,
      owner_id: ownerId,
    });
    return { agent: existingAgent as AgentRecord, isExisting: true };
  }

  // 2. Insert new agent with status "pending_claim"
  const insertPayload = {
    owner_id: ownerId,
    handle: cleanHandle,
    display_name: cleanHandle,
    status: "pending_claim",
  };

  const { data: newAgent, error: insertError } = await db
    .from("agents")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    // Check for Postgres unique violation on agents_handle_idx
    if (insertError.code === "23505" || insertError.message.includes("unique")) {
      logger.warn({
        msg: `Handle ${cleanHandle} conflict during claim`,
        request_id: requestId,
        owner_id: ownerId,
      });
      throw new ClaimError("HANDLE_TAKEN", "That name was just taken.", 409);
    }

    logger.error({
      msg: `claimAgent insert failed: ${insertError.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to claim agent", 500);
  }

  logger.info({
    msg: `Agent claimed with status ${newAgent.status}: @${cleanHandle}`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return { agent: newAgent as AgentRecord, isExisting: false };
}

/**
 * Activates an agent after the owner confirms posting on X.
 * Sets status to "active" and records tweet_claimed_at.
 * Uses index `agents_owner_id_idx` (DB_SCHEMA.md).
 */
export async function activateAgent(
  ownerId: string,
  requestId: string,
): Promise<{ agent: AgentRecord }> {
  const db = getServiceClient();

  // Find owner's agent using index agents_owner_id_idx
  const { data: agent, error: findError } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (findError) {
    logger.error({
      msg: `activateAgent query failed: ${findError.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to retrieve agent", 500);
  }

  if (!agent) {
    throw new ClaimError("AGENT_NOT_FOUND", "No agent found for this owner.", 404);
  }

  // Update status to active and record tweet_claimed_at
  const now = new Date().toISOString();
  let { data: updatedAgent, error: updateError } = await db
    .from("agents")
    .update({
      status: "active",
      tweet_claimed_at: now,
    })
    .eq("id", agent.id)
    .eq("owner_id", ownerId)
    .select("*")
    .single();

  // Fallback if migration 003 hasn't added tweet_claimed_at column yet
  if (
    updateError &&
    (updateError.code === "42703" || updateError.message.includes("tweet_claimed_at"))
  ) {
    const fallback = await db
      .from("agents")
      .update({
        status: "active",
      })
      .eq("id", agent.id)
      .eq("owner_id", ownerId)
      .select("*")
      .single();

    if (fallback.data) {
      updatedAgent = {
        ...fallback.data,
        tweet_claimed_at: now,
      };
      updateError = null;
    }
  }

  if (updateError) {
    logger.error({
      msg: `activateAgent update failed: ${updateError.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to activate agent", 500);
  }

  logger.info({
    msg: `Agent @${agent.handle} activated`,
    request_id: requestId,
    owner_id: ownerId,
  });

  return { agent: updatedAgent as AgentRecord };
}

/**
 * Retrieves the owner's agent if one exists.
 * Uses index `agents_owner_id_idx` (DB_SCHEMA.md).
 */
export async function getOwnerAgent(
  ownerId: string,
  requestId: string,
): Promise<AgentRecord | null> {
  const db = getServiceClient();

  const { data, error } = await db
    .from("agents")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    logger.error({
      msg: `getOwnerAgent failed: ${error.message}`,
      request_id: requestId,
      owner_id: ownerId,
    });
    throw new ClaimError("DATABASE_ERROR", "Failed to retrieve owner agent", 500);
  }

  return (data as AgentRecord) ?? null;
}
