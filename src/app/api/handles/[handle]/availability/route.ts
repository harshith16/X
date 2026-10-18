import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkHandleAvailability, ClaimError } from "@/server/identity/claim";
import { newRequestId } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ handle: string }> },
) {
  const requestId = newRequestId();
  const { handle } = await context.params;

  try {
    // 1. Verify authenticated owner session
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "You must be signed in to check handle availability.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // 2. Check handle availability
    const result = await checkHandleAvailability(handle, requestId);

    return NextResponse.json({
      ...result,
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
          message: "An unexpected error occurred.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
