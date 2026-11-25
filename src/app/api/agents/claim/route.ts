import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimAgent, ClaimError } from "@/server/identity/claim";
import { ClaimAgentRequestSchema } from "@/types/agent";
import { newRequestId } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // 1. Authenticated session owner only
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "You must be signed in to claim an agent.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // 2. Parse and validate payload
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON payload.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parseResult = ClaimAgentRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues[0]?.message ?? "Invalid handle format.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    // 3. Claim agent
    const { agent, isExisting } = await claimAgent(
      user.id,
      parseResult.data.handle,
      requestId,
      parseResult.data.x_handle,
    );

    return NextResponse.json(
      {
        agent,
        request_id: requestId,
      },
      { status: isExisting ? 200 : 201 },
    );
  } catch (err: unknown) {
    if (err instanceof ClaimError) {
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

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred while claiming your agent.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
