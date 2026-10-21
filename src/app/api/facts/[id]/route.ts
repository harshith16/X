import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteFact, MemoryError } from "@/server/memory/service";
import { newRequestId, logger } from "@/lib/logger";

export async function DELETE(
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
            message: "You must be signed in to delete facts.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { id } = await params;
    await deleteFact(user.id, id, requestId);

    return NextResponse.json(
      {
        ok: true,
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
      msg: `Unexpected error deleting fact: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to delete fact.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
