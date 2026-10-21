import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveApproval, ApprovalError } from "@/server/approvals/service";
import { ResolveApprovalRequestSchema } from "@/types/brain";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
            message: "You must be signed in to resolve approvals.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { id } = await params;

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

    const parseResult = ResolveApprovalRequestSchema.safeParse(body);
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

    const result = await resolveApproval(
      user.id,
      id,
      parseResult.data.decision,
      requestId,
    );

    return NextResponse.json(
      {
        ok: true,
        approval: result.approval,
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
      msg: `Unexpected error in POST /api/approvals/[id]/resolve: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to resolve approval.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
