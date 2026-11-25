import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setOwnerCategoryMode } from "@/server/rules/categories";
import { UpdateCategoryModeRequestSchema } from "@/types/brain";
import { newRequestId, logger } from "@/lib/logger";

export async function PUT(request: NextRequest) {
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
            message: "You must be signed in to update guardrails.",
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

    const parseResult = UpdateCategoryModeRequestSchema.safeParse(body);
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

    if (parseResult.data.category === "secrets" && parseResult.data.mode === "open") {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Secrets category cannot be set to 'open'. Only 'never' or 'ask' are permitted.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const updatedMode = await setOwnerCategoryMode(
      user.id,
      parseResult.data.category,
      parseResult.data.mode,
      requestId,
    );

    return NextResponse.json(
      {
        ok: true,
        category: parseResult.data.category,
        mode: updatedMode,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    logger.error({
      msg: `Unexpected error in PUT /api/guardrails/category: ${
        err instanceof Error ? err.message : String(err)
      }`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update category mode.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
