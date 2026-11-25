import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerCategoryModes } from "@/server/rules/categories";
import { getOwnerFacts, MemoryError } from "@/server/memory/service";
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
            message: "You must be signed in to view guardrails.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // 1. Fetch category modes with defaults
    const categories = await getOwnerCategoryModes(user.id, requestId);

    // 2. Fetch owner's guard entries (never and ask)
    const { facts } = await getOwnerFacts(user.id, undefined, 50, requestId);

    return NextResponse.json(
      {
        ok: true,
        categories,
        entries: facts,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof MemoryError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            request_id: requestId,
          },
        },
        { status: err.statusCode },
      );
    }

    logger.error({
      msg: `Unexpected error in GET /api/guardrails: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch guardrails.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
