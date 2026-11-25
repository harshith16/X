import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerFacts, addFact, MemoryError } from "@/server/memory/service";
import { CreateFactRequestSchema } from "@/types/brain";
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
            message: "You must be signed in to view facts.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") || undefined;
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50", 10)), 50);

    const result = await getOwnerFacts(user.id, cursor, limit, requestId);

    return NextResponse.json(
      {
        ok: true,
        facts: result.facts,
        items: result.facts,
        next_cursor: result.next_cursor,
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
      msg: `Unexpected error in GET /api/facts: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to fetch facts.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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
            message: "You must be signed in to add facts.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON in request body.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parseResult = CreateFactRequestSchema.safeParse(body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Validation failed.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const rule = parseResult.data.guard || parseResult.data.share_rule || "never";
    const fact = await addFact(
      user.id,
      parseResult.data.text,
      rule,
      requestId,
    );

    return NextResponse.json(
      {
        ok: true,
        fact,
        request_id: requestId,
      },
      { status: 201 },
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
      msg: `Unexpected error in POST /api/facts: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to create fact.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
