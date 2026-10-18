import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activateAgent, ClaimError } from "@/server/identity/claim";
import { newRequestId } from "@/lib/logger";

export async function POST() {
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
            message: "You must be signed in to activate an agent.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // 2. Activate agent
    const { agent } = await activateAgent(user.id, requestId);

    return NextResponse.json({
      ok: true,
      agent,
      request_id: requestId,
    });
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
          message: "An unexpected error occurred while activating your agent.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
