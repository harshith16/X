import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requestContactByHandle,
  getContactsForOwner,
  ContactError,
} from "@/server/contacts/service";
import { AddContactSchema } from "@/types/contact";
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
            message: "You must be signed in to view contacts.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const data = await getContactsForOwner(user.id, requestId);

    return NextResponse.json(
      {
        ok: true,
        ...data,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof ContactError) {
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
      msg: `Unexpected error in GET /api/contacts: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "An unexpected error occurred while fetching contacts.",
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
            message: "You must be signed in to add contacts.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON request body.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parsed = AddContactSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parsed.error.issues[0]?.message || "Invalid handle.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const record = await requestContactByHandle(user.id, parsed.data.handle, requestId);

    return NextResponse.json(
      {
        ok: true,
        contact: record,
        request_id: requestId,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (err instanceof ContactError) {
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
      msg: `Unexpected error in POST /api/contacts: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "An unexpected error occurred while creating contact request.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
