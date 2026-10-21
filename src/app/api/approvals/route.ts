import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerApprovals, ApprovalError } from "@/server/approvals/service";
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
            message: "You must be signed in to view approvals.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") || undefined;
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50", 10)), 50);

    const result = await getOwnerApprovals(user.id, cursor, limit, requestId);

    return NextResponse.json(
      {
        ok: true,
        approvals: result.approvals,
        items: result.approvals,
        next_cursor: result.next_cursor,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof ApprovalError) {
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
      msg: `Unexpected error in GET /api/approvals: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to fetch approvals.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
