import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/server/db/clients";
import { getMemoryScreeningActivity } from "@/server/rules/engine";
import { ScreeningActivityItem } from "@/types/brain";
import { newRequestId, logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "You must be signed in to view guardrail activity.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const db = getServiceClient();
    const combined: ScreeningActivityItem[] = [];
    const seenIds = new Set<string>();

    // 1. Fetch approvals for this owner
    try {
      const { data: approvals } = await db
        .from("approvals")
        .select("id, status, question, created_at, resolved_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (approvals) {
        for (const app of approvals) {
          let outcome: "blocked" | "held" | "shared" | "never" = "held";
          if (app.status === "shared") outcome = "shared";
          else if (app.status === "never") outcome = "never";
          else if (app.status === "blocked" || app.status === "denied") outcome = "blocked";
          else outcome = "held";

          combined.push({
            id: app.id,
            timestamp: app.resolved_at || app.created_at,
            outcome,
            category: null,
            text: app.question,
            approval_id: app.status === "pending" ? app.id : null,
          });
          seenIds.add(app.id);
        }
      }
    } catch {
      // DB fallback
    }

    // 2. Fetch blocks for this owner
    try {
      const { data: blocks } = await db
        .from("blocks")
        .select("id, created_at, fact_id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (blocks) {
        // Collect fact_ids to resolve text if present
        const factIds = blocks.map((b) => b.fact_id).filter(Boolean);
        const factMap = new Map<string, string>();
        if (factIds.length > 0) {
          const { data: facts } = await db
            .from("facts")
            .select("id, text")
            .in("id", factIds);
          if (facts) {
            for (const f of facts) {
              factMap.set(f.id, f.text);
            }
          }
        }

        for (const b of blocks) {
          if (seenIds.has(b.id)) continue;
          const text = b.fact_id ? (factMap.get(b.fact_id) || "Blocked content") : "Blocked by category rules";
          combined.push({
            id: b.id,
            timestamp: b.created_at,
            outcome: "blocked",
            category: null,
            text,
            approval_id: null,
          });
          seenIds.add(b.id);
        }
      }
    } catch {
      // DB fallback
    }

    // 3. Merge in-memory activity (from recent sends in session)
    const memItems = getMemoryScreeningActivity(user.id);
    for (const item of memItems) {
      if (!seenIds.has(item.id)) {
        combined.push(item);
        seenIds.add(item.id);
      }
    }

    // Sort by timestamp descending and take top 20
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const activity = combined.slice(0, 20);

    return NextResponse.json(
      {
        ok: true,
        activity,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    logger.error({
      msg: `Unexpected error in GET /api/guardrails/activity: ${
        err instanceof Error ? err.message : String(err)
      }`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch guardrail activity.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
